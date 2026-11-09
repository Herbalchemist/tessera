// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): Settings › Sound, Bluetooth and Wi-Fi (launcher/screens.js). The same steps as the
// full Ludus: they only send operation names, ids that came from a list the system just gave, and
// the text the person typed; devices.js in the main process checks everything again.
// Written as Promise chains (the QML engine here has no async/await).
import QtQuick

QtObject {
    id: f
    property var w          // Main.qml's window: pick, ask, notice, confirmYes, gated, liveList, watchJob, dev ...

    readonly property var kindWord: ({ controller: "Controller", headset: "Headset", speaker: "Speaker", keyboard: "Keyboard", mouse: "Mouse", phone: "Phone", computer: "Computer", device: "Device" })
    readonly property var audioWord: ({ bluetooth: "Bluetooth", tv: "TV", usb: "USB", headphones: "Headphones", speakers: "Speakers" })
    readonly property var secWord: ({ open: "Open", secured: "Secured", enterprise: "Sign-in needed", wep: "Old security" })
    readonly property string yes: "A"

    function join(parts) { return parts.filter(Boolean).join(" · ") }
    function again(step) { return step() }       // a loop is a function that calls itself from .then

    // ------------------------------------------------------------------ Sound
    function mac(s) { var m = /([0-9A-F]{2}[_:]){5}[0-9A-F]{2}/i.exec(s || ""); return m ? m[0].replace(/:/g, "_").toUpperCase() : "" }
    function sameDevice(a, b) { return Boolean(a && b && mac(a) && mac(a) === mac(b)) }

    function volumeItem(st, kind, dev, label) {
        var level = function () { return dev.volume === null || dev.volume === undefined ? 0 : dev.volume }
        var note = function () { return dev.mute ? "Muted" : level() + "%" }
        var item = {
            key: "v:" + kind, label: label, sub: note(), op: "mute", kind: kind, dev: dev,
            bar: { pct: level(), mute: Boolean(dev.mute) },
            adjust: function (dir) {
                var v = Math.max(0, Math.min(100, level() + dir * 5))
                var unmute = dev.mute && dir > 0
                if (v === level() && !unmute) return
                dev.volume = v
                if (unmute) { dev.mute = false; w.dev("audio", "mute", { kind: kind, id: dev.id, on: false }) }
                item.sub = note()
                item.bar = { pct: level(), mute: Boolean(dev.mute) }
                w.holdMenu(2500)          // don't redraw underneath a hand that is still turning it
                st.volPending = { kind: kind, dev: dev }
                var seq = st.volSeq = (st.volSeq || 0) + 1
                w.sleepMs(150).then(function () { if (st.volSeq === seq) flushVolume(st) })
            }
        }
        return item
    }
    // sends the last volume that was dialled in (turning the bar quickly would otherwise send dozens)
    function flushVolume(st) {
        var p = st.volPending
        st.volPending = null
        if (!p) return Promise.resolve()
        return w.dev("audio", "volume", { kind: p.kind, id: p.dev.id, pct: p.dev.volume }).then(function (r) { if (!r.ok) st.note = r.error || "Couldn't change the volume." })
    }
    function soundItems(st) {
        var d = st.data, out = []
        var o = d.outputs.filter(function (x) { return x.isDefault })[0]
        var i = d.inputs.filter(function (x) { return x.isDefault })[0]
        out.push({ label: "Volume", header: true, key: "h:vol" })
        if (o) out.push(volumeItem(st, "output", o, "Volume"))
        else out.push({ label: "No sound output found", info: true, key: "none" })
        if (i) out.push(volumeItem(st, "input", i, "Microphone"))
        if (d.outputs.length) {
            out.push({ label: "Play sound through", header: true, key: "h:out" })
            d.outputs.forEach(function (x) { out.push({ key: "o:" + x.id, label: x.label, sub: join([audioWord[x.kind] || "", x.isDefault ? "In use" : ""]), op: "out", dev: x }) })
        }
        if (d.inputs.length > 1) {
            out.push({ label: "Microphone", header: true, key: "h:in" })
            d.inputs.forEach(function (x) { out.push({ key: "i:" + x.id, label: x.label, sub: join([audioWord[x.kind] || "", x.isDefault ? "In use" : ""]), op: "in", dev: x }) })
        }
        var card = o && d.cards.filter(function (c) { return sameDevice(c.id, o.id) })[0]
        if (card && card.profiles.length > 1) {
            out.push({ label: "Headset mode", header: true, key: "h:mode" })
            card.profiles.forEach(function (pr) { out.push({ key: "p:" + pr.id, label: pr.label, sub: card.profile === pr.id ? "In use" : "", op: "profile", card: card.id, profile: pr.id }) })
        }
        return out
    }
    function sound() {
        if (w.menuUp()) return
        var st = { data: null, note: "", at: "", volPending: null, volSeq: 0, error: "" }
        var reload = function (s) {
            return w.dev("audio", "info").then(function (r) { if (r.ok) s.data = r; else if (!s.data) s.error = r.error || "Couldn't read the sound devices." })
        }
        w.setStatus("Looking for sound devices…")
        reload(st).then(function () {
            w.setStatus("")
            if (!st.data) return w.notice("Sound", st.error)
            var loop = function () {
                return w.liveList(st, {
                    title: "Sound", items: soundItems, reload: reload, every: 5000,
                    body: function (s) { return s.note || "Left and right change the volume. A on a volume bar mutes it." }
                }).then(function (it) {
                    st.note = ""
                    if (!it) return null
                    return flushVolume(st).then(function () {
                        var r = Promise.resolve(null)
                        if (it.op === "mute") r = w.dev("audio", "mute", { kind: it.kind, id: it.dev.id, on: !it.dev.mute })
                        else if (it.op === "out" || it.op === "in") {
                            r = w.dev("audio", "setDefault", { kind: it.op === "out" ? "output" : "input", id: it.dev.id }).then(function (x) { if (x.ok) st.note = "Now using " + it.dev.label + "."; return x })
                        } else if (it.op === "profile") {
                            r = w.dev("audio", "profile", { card: it.card, profile: it.profile }).then(function (x) { return x.ok ? w.sleepMs(700).then(function () { return x }) : x })   // the headset needs a moment
                        }
                        return r.then(function (x) { if (x && !x.ok) st.note = x.error || "That did not work."; return reload(st) }).then(loop)
                    })
                })
            }
            return loop().then(function () { return flushVolume(st) })
        }).then(function () { w.refreshTileNotes(true) })
    }

    // ------------------------------------------------------------------ Bluetooth
    function btSub(d) {
        var parts = [kindWord[d.kind] || "Device"]
        if (d.paired) parts.push(d.connected ? "Connected" : "Not connected")
        else parts.push("Ready to pair")
        if (typeof d.battery === "number") parts.push(d.battery + "%")
        return parts.join(" · ")
    }
    function btItems(st) {
        var d = st.data
        var out = [{ label: "Bluetooth", header: true, key: "h:bt" }]
        out.push({ key: "power", label: d.adapter.powered ? "Bluetooth is on" : "Bluetooth is off", sub: yes + (d.adapter.powered ? " switches it off" : " switches it on"), op: "power" })
        if (!d.adapter.powered) return out
        var mine = d.devices.filter(function (x) { return x.paired }), near = d.devices.filter(function (x) { return !x.paired })
        if (mine.length) {
            out.push({ label: "My devices", header: true, key: "h:mine" })
            mine.forEach(function (x) { out.push({ key: "d:" + x.id, label: x.name, sub: btSub(x), op: "dev", dev: x }) })
        }
        out.push({ label: st.scanning ? "Nearby · searching…" : "Nearby", header: true, key: "h:near" })
        if (!near.length) out.push({ key: "empty", label: st.scanning ? "Put your device in pairing mode" : "Nothing found yet", info: true })
        near.forEach(function (x) { out.push({ key: "d:" + x.id, label: x.name, sub: btSub(x), op: "dev", dev: x }) })
        out.push({ key: "scan", label: st.scanning ? "Stop searching" : "Search for devices", op: "scan" })
        return out
    }
    function btWait(name, op) {
        return function (p, stopping) {
            if (stopping) return "Canceling…"
            var what = op === "pair" && p.stage !== "Connecting" ? "Pairing with " + name : "Connecting to " + name
            var tip = op === "pair" ? "Keep it switched on, in pairing mode, and close by." : "Keep it switched on and close by."
            return what + " · " + w.clockText(p.elapsed) + "\n" + tip
        }
    }
    function btAct(st, dev, op) {
        return w.gated(function () { return w.rawCall("bluetooth", [op, { id: dev.id }]) }).then(function (r) {
            if (!r.ok) { st.note = r.canceled ? "" : r.error || "That did not work."; return }
            return w.watchJob("bluetooth", op === "pair" ? "Pairing" : "Connecting", btWait(dev.name, op)).then(function (res) {
                if (op === "pair") st.scanning = false      // pairing stops the search
                if (res.result === "connected") st.note = dev.name + " is connected."
                else if (res.result === "canceled") st.note = "Canceled."
                else if (res.result === "paired") st.note = (dev.name + " is paired, but not connected. " + (res.error || "")).trim()
                else st.note = [res.error || "That didn't work.", res.detail ? "(" + res.detail + ")" : ""].filter(Boolean).join(" ")
            })
        })
    }
    function bluetooth() {
        if (w.menuUp()) return
        var st = { data: null, note: "", at: "", scanning: false, error: "" }
        var reload = function (s) {
            return w.dev("bluetooth", "info").then(function (r) { if (r.ok) s.data = r; else if (!s.data) s.error = r.error || "Couldn't read Bluetooth." })
        }
        var scan = function (on) { return w.dev("bluetooth", "scan", { on: on }) }
        w.setStatus("Looking for Bluetooth…")
        reload(st).then(function () {
            w.setStatus("")
            if (!st.data) return w.notice("Bluetooth", st.error)
            if (!st.data.adapter.present) return w.notice("Bluetooth", "No Bluetooth adapter was found on this machine.")
            var start = st.data.adapter.powered ? scan(true).then(function (r) { st.scanning = Boolean(r.ok) }) : Promise.resolve()
            return start.then(function () {
                var loop = function () {
                    return w.liveList(st, {
                        title: "Bluetooth", items: btItems, reload: reload, every: 3000,
                        body: function (s) { return s.note || (s.data.adapter.powered ? "To pair a controller or headset, put it in pairing mode, then choose it from Nearby." : "") }
                    }).then(function (it) {
                        st.note = ""
                        if (!it) return null
                        var work = Promise.resolve()
                        if (it.op === "power") {
                            var on = !st.data.adapter.powered
                            work = w.dev("bluetooth", "power", { on: on }).then(function (r) {
                                if (!r.ok) { st.note = r.error || "Couldn't change Bluetooth."; return }
                                if (on) return scan(true).then(function (s) { st.scanning = Boolean(s.ok) })
                                st.scanning = false
                            })
                        } else if (it.op === "scan") {
                            work = scan(!st.scanning).then(function (r) { if (r.ok) st.scanning = !st.scanning; else st.note = r.error || "Couldn't search." })
                        } else if (it.op === "dev") {
                            var d = it.dev
                            if (!d.paired) work = btAct(st, d, "pair")
                            else work = w.pick(d.name, [
                                d.connected ? { label: "Disconnect", op: "disconnect" } : { label: "Connect", op: "connect" },
                                { label: "Forget this device", op: "forget" },
                                { label: "Back" }
                            ], 0, { body: btSub(d) }).then(function (c) {
                                if (!c) return
                                if (c.op === "connect") return btAct(st, d, "connect")
                                if (c.op === "disconnect") return w.dev("bluetooth", "disconnect", { id: d.id }).then(function (r) { st.note = r.ok ? d.name + " is disconnected." : r.error || "Couldn't disconnect." })
                                if (c.op === "forget") return w.confirmYes("Forget " + d.name + "? You would have to pair it again.", "Forget").then(function (y) {
                                    if (!y) return
                                    return w.gated(function () { return w.rawCall("bluetooth", ["forget", { id: d.id }]) }).then(function (r) { st.note = r.ok ? d.name + " was removed." : r.canceled ? "" : r.error || "Couldn't remove it." })
                                })
                            })
                        }
                        return work.then(function () { return reload(st) }).then(loop)
                    })
                }
                return loop()
            })
        }).then(function () { return w.dev("bluetooth", "stop") }).then(function () { w.refreshTileNotes(true) })
    }

    // ------------------------------------------------------------------ Wi-Fi
    function wifiItems(st) {
        var d = st.data
        var out = [{ label: "Wi-Fi", header: true, key: "h:wifi" }]
        out.push({ key: "radio", label: d.radio ? "Wi-Fi is on" : "Wi-Fi is off", sub: yes + (d.radio ? " switches it off" : " switches it on"), op: "radio" })
        if (d.wired) out.push({ key: "wired", label: "Connected by cable", sub: "Ethernet", info: true })
        if (!d.radio) return out
        out.push({ label: "Networks", header: true, key: "h:nets" })
        if (!d.networks.length) out.push({ key: "empty", label: "Looking for networks…", info: true })
        d.networks.forEach(function (n) {
            out.push({ key: "n:" + n.ssid, label: n.ssid, sub: join([n.inUse ? "Connected" : n.saved ? "Saved" : "", n.word, secWord[n.security] || ""]), op: "net", net: n })
        })
        out.push({ key: "hidden", label: "Join a hidden network…", op: "hidden" })
        out.push({ key: "again", label: "Look again", op: "again" })
        return out
    }
    function wifiWait(name) { return function (p, stopping) { return stopping ? "Canceling…" : "Joining " + name + " · " + w.clockText(p.elapsed) + "\nThis can take up to half a minute." } }
    function wifiFinish(st, ssid, started) {
        if (!started.ok) { st.note = started.canceled ? "" : started.error || "That did not work."; return Promise.resolve() }
        return w.watchJob("wifi", "Joining", wifiWait(ssid)).then(function (res) {
            if (res.result === "connected") st.note = "Connected to " + ssid + "."
            else if (res.result === "canceled") st.note = "Canceled."
            else st.note = [res.error || "Couldn't join that network.", res.detail ? "(" + res.detail + ")" : ""].filter(Boolean).join(" ")
        })
    }
    function wifiJoin(st, ssid, security, hidden) {
        if (security === "enterprise") { st.note = "Networks that ask for a user name aren't supported here yet. Use Opus for this one."; return Promise.resolve() }
        if (security === "wep") { st.note = "This network uses old WEP security, which isn't supported."; return Promise.resolve() }
        var getPassword = (security === "secured" || security === "hiddenAsk") ? w.ask("Password for " + ssid, "", { max: 63, secret: true }) : Promise.resolve("")
        return getPassword.then(function (password) {
            if (password === null) return
            if (security === "secured" || security === "hiddenAsk") {
                if (hidden && !password) { /* a hidden network that is open */ }
                else if (!/^[\x20-\x7e]{8,63}$/.test(password)) { st.note = "A Wi-Fi password has 8 to 63 characters."; return }
            }
            return w.gated(function () { return w.rawCall("wifi", ["join", { ssid: ssid, password: password, hidden: Boolean(hidden) }]) }).then(function (r) { return wifiFinish(st, ssid, r) })
        })
    }
    function wifi() {
        if (w.menuUp()) return
        var st = { data: null, note: "", at: "", error: "" }
        var reload = function (s) {
            return w.dev("wifi", "info").then(function (r) { if (r.ok) s.data = r; else if (!s.data) s.error = r.error || "Couldn't read the network." })
        }
        var rescan = function () { return w.dev("wifi", "rescan") }
        w.setStatus("Looking for networks…")
        reload(st).then(function () {
            w.setStatus("")
            if (!st.data) return w.notice("Wi-Fi", st.error)
            if (!st.data.present) return w.notice("Wi-Fi", st.data.wired ? "No Wi-Fi was found. This machine is connected by cable." : "No Wi-Fi was found on this machine.")
            if (st.data.radio) rescan()       // a fresh look in the background; the list updates on its own
            var loop = function () {
                return w.liveList(st, {
                    title: "Wi-Fi", items: wifiItems, reload: reload, every: 4000,
                    body: function (s) { return s.note || (s.data.networks.some(function (n) { return n.inUse }) ? "" : s.data.radio ? "Not connected to a network." : "") }
                }).then(function (it) {
                    st.note = ""
                    if (!it) return null
                    var work = Promise.resolve()
                    if (it.op === "radio") {
                        var on = !st.data.radio
                        work = w.gated(function () { return w.rawCall("wifi", ["radio", { on: on }]) }).then(function (r) {
                            if (!r.ok && !r.canceled) st.note = r.error || "Couldn't change Wi-Fi."
                            else if (r.ok && on) return w.sleepMs(1500).then(function () { rescan() })
                        })
                    } else if (it.op === "again") {
                        work = rescan().then(function () { st.note = "Looking again…"; return w.sleepMs(2500) })
                            .then(function () { return w.dev("wifi", "info", { rescan: false }) })
                            .then(function (r) { if (r.ok) st.data = r; st.note = "" })
                    } else if (it.op === "hidden") {
                        work = w.ask("Network name", "", { max: 32, symbols: true }).then(function (name) { if (name) return wifiJoin(st, name, "hiddenAsk", true) })
                    } else if (it.op === "net") {
                        var n = it.net
                        if (n.inUse || n.saved) {
                            work = w.pick(n.ssid, [
                                n.inUse ? { label: "Disconnect", op: "disconnect" } : { label: "Connect", op: "connect" },
                                { label: "Forget this network", op: "forget" },
                                { label: "Back" }
                            ], 0, { body: join([n.word, secWord[n.security]]) }).then(function (c) {
                                if (!c) return
                                if (c.op === "connect") return w.dev("wifi", "connect", { ssid: n.ssid }).then(function (r) { return wifiFinish(st, n.ssid, r) })
                                if (c.op === "disconnect") return w.dev("wifi", "disconnect").then(function (r) { st.note = r.ok ? "Disconnected." : r.error || "Couldn't disconnect." })
                                if (c.op === "forget") return w.confirmYes("Forget " + n.ssid + "? You would have to enter the password again.", "Forget").then(function (y) {
                                    if (!y) return
                                    return w.gated(function () { return w.rawCall("wifi", ["forget", { ssid: n.ssid }]) }).then(function (r) { st.note = r.ok ? n.ssid + " was forgotten." : r.canceled ? "" : r.error || "Couldn't forget it." })
                                })
                            })
                        } else work = wifiJoin(st, n.ssid, n.security, false)
                    }
                    return work.then(function () { return reload(st) }).then(loop)
                })
            }
            return loop()
        }).then(function () { w.refreshTileNotes(true) })
    }

    // ------------------------------------------------------------------ shared by the settings menus
    // rows after a folded heading are left out until it is opened again
    function folded(items, closed) {
        var out = [], skip = false
        items.forEach(function (it) {
            if (it.header) { skip = Boolean(it.fold && closed[it.fold]); if (it.fold) it.label = (closed[it.fold] ? "▸ " : "▾ ") + it.label.replace(/^[▸▾] /, "") }
            else if (skip) return
            out.push(it)
        })
        return out
    }
    function indexOfKey(items, key) { var i = items.findIndex(function (x) { return x.key === key }); return i < 0 ? 0 : i }
    // what is still to come in this version: said plainly, and the full Ludus does it meanwhile
    function notYet(title) { return w.notice(title, "This part comes to this version next. It is in the full Ludus (Settings › Go back) until then.") }
    function choose(title, table, current, apply) {
        var opts = Object.keys(table)
        return w.pick(title, opts.map(function (v) { return { label: table[v], sub: v === current ? "current" : "", v: v } }), Math.max(0, opts.indexOf(current))).then(function (it) { return it ? apply(it.v) : null })
    }
    function chooseNumber(title, current, lo, hi, step, apply) {
        var vals = []
        for (var v = lo; v <= hi; v += step) vals.push(v)
        return w.pick(title, vals.map(function (x) { return { label: x + "%", sub: x === current ? "current" : "", v: x } }), Math.max(0, vals.indexOf(current))).then(function (it) { return it ? apply(it.v) : null })
    }

    // ------------------------------------------------------------------ Controller
    readonly property var padLabels: ({
        rumble: { off: "Off", low: "Low", normal: "Normal", high: "High" },
        style: { split: "Left trigger = left motor, right = right", both: "Both motors together", pulse: "Pulsing" },
        glyphs: { auto: "Automatic (match my controller)", xbox: "Xbox  (A B X Y)", playstation: "PlayStation  (✕ ○ □ △)", nintendo: "Nintendo  (B A Y X)" },
        joycons: { ask: "Ask me: I press SL + SR, or L + R (like a Switch)", together: "Join a left and a right by themselves", separate: "Every Joy-Con its own player (sideways)" },
        repeat: { slow: "Slower", standard: "Standard", fast: "Faster" },
        confirm: { auto: "Automatic: the right button on Switch controllers, the bottom one on others", bottom: "The bottom button confirms, the right one goes back (every controller)", right: "The right button confirms, the bottom one goes back (every controller)" },
        browserCursor: { right: "Right stick moves the cursor, left stick scrolls", left: "Left stick moves the cursor, right stick scrolls" },
        guideButton: { "menu-home": "Press opens the guide, hold goes Home", "home-menu": "Press goes Home, hold opens the guide", menu: "Press or hold opens the guide" },
        guideDesktop: { auto: "On, except while Steam is running", on: "Always on", off: "Off" },
        oskSize: { dock: "Docked: a compact panel in the middle", wide: "Wide: bigger keys across the whole screen" },
        guideStyle: { side: "A panel from the side", float: "A floating card in the middle", compact: "Compact: a narrow panel, smaller text" }
    })
    function padItems(st) {
        var p = st.pad, L = padLabels
        var lab = function (t, k, d) { return L[t][p[k]] || L[t][d] }
        var remapped = Object.keys(p.remap || {}).length > 0
        return [
            { key: "test", label: "Test your controller", sub: "live buttons, sticks and triggers", op: "test" },
            { key: "guideButton", label: "Guide button", sub: lab("guideButton", "guideButton", "menu-home"), op: "guideButton" },
            { key: "guideStyle", label: "Guide style", sub: lab("guideStyle", "guideStyle", "side"), op: "guideStyle" },
            { key: "guideDesktop", label: "Guide on the desktop", sub: lab("guideDesktop", "guideDesktop", "auto"), op: "guideDesktop" },
            { key: "mapping", label: "Button mapping", sub: remapped ? "Changed" : "Standard", op: "mapping" },
            { key: "h:sticks", label: "Sticks and triggers", header: true, fold: "pad.sticks" },
            { key: "repeat", label: "Repeat speed", sub: (L.repeat[p.repeat] || "Standard") + " · holding a direction, in menus and the browser", op: "repeat" },
            { key: "deadzone", label: "Stick deadzone", sub: p.deadzone + "%", op: "deadzone" },
            { key: "calib", label: "Calibrate sticks", sub: "", op: "calib" },
            { key: "trigger", label: "Trigger sensitivity", sub: p.trigger + "% to register", op: "trigger" },
            { key: "h:rumble", label: "Vibration", header: true, fold: "pad.rumble" },
            { key: "rumble", label: "Vibration strength", sub: L.rumble[p.rumble], op: "rumble" },
            { key: "style", label: "Vibration style", sub: L.style[p.style], op: "style" },
            { key: "h:labels", label: "Labels", header: true },
            { key: "glyphs", label: "Button labels", sub: L.glyphs[p.glyphs].split("  (")[0], op: "glyphs" },
            { key: "confirm", label: "Confirm button", sub: remapped ? "Your own (Button mapping) where set" : (L.confirm[p.confirm] || L.confirm.auto).split(":")[0].split(" confirms")[0], op: "confirm" },
            { key: "osk", label: "On-screen keyboard", sub: (L.oskSize[p.oskSize] || L.oskSize.dock).split(":")[0], op: "oskSize" },
            { key: "h:joycon", label: "Joy-Con", header: true },
            { key: "grip", label: "Change grip/order", sub: "join or split Joy-Cons, see who is which player", op: "grip" },
            { key: "joycons", label: "Joy-Con setup", sub: L.joycons[p.joycons] || L.joycons.ask, op: "joycons" },
            { key: "h:browser", label: "Browser", header: true, fold: "pad.browser" },
            { key: "bcursor", label: "Cursor stick", sub: p.browserCursor === "left" ? "Left stick (right stick scrolls)" : "Right stick (left stick scrolls)", op: "browserCursor" },
            { key: "cspeed", label: "Cursor speed", sub: p.cursorSpeed + "%", op: "cursorSpeed" },
            { key: "sspeed", label: "Scroll speed", sub: p.scrollSpeed + "%", op: "scrollSpeed" },
            { key: "clicks", label: "Clicks", sub: "RT clicks, LT right-clicks", info: true }
        ]
    }
    function padSet(st, key, value) {
        return w.dev("settings", "padSet", { key: key, value: value }).then(function (r) { if (r.ok) st.pad = Object.assign({}, st.pad, r.pad); else w.setStatus(r.error || "Couldn't save that.", true) })
    }
    function pad() {
        if (w.menuUp()) return
        w.dev("settings", "padGet").then(function (r) {
            if (!r.pad) return w.notice("Controller", "Couldn't read the controller settings.")
            var st = { pad: r.pad, at: "", closed: {} }
            var L = padLabels
            var choice = function (title, key) { return choose(title, L[key], st.pad[key], function (v) { return padSet(st, key, v) }) }
            var number = function (title, key, lo, hi, step) { return chooseNumber(title, st.pad[key], lo, hi, step, function (v) { return padSet(st, key, v) }) }
            var loop = function () {
                var items = folded(padItems(st), st.closed)
                return w.pick("Controller", items, indexOfKey(items, st.at)).then(function (it) {
                    if (!it) return null
                    st.at = it.key
                    if (it.info) return loop()
                    var work = Promise.resolve()
                    if (it.fold) st.closed[it.fold] = !st.closed[it.fold]
                    else if (it.op === "test" || it.op === "mapping" || it.op === "calib" || it.op === "grip") work = notYet(it.label)
                    else if (it.op === "guideButton") work = choice("The Guide button (Xbox, PS or Home button)", "guideButton")
                    else if (it.op === "oskSize") work = choice("On-screen keyboard size", "oskSize")
                    else if (it.op === "guideStyle") work = choice("How the guide looks (notifications sit beside it on the right)", "guideStyle")
                    else if (it.op === "guideDesktop") work = choice("The guide in Opus (Steam takes the button for itself while it runs)", "guideDesktop")
                    else if (it.op === "browserCursor") work = choice("In the browser, which stick moves the cursor?", "browserCursor")
                    else if (it.op === "cursorSpeed") work = number("Cursor speed · how fast the browser cursor moves", "cursorSpeed", 10, 100, 10)
                    else if (it.op === "scrollSpeed") work = number("Scroll speed · how fast pages scroll at full tilt", "scrollSpeed", 10, 100, 10)
                    else if (it.op === "deadzone") work = number("Stick deadzone · ignore small movements", "deadzone", 0, 40, 5)
                    else if (it.op === "trigger") work = number("Trigger sensitivity · how far to pull before it counts", "trigger", 0, 50, 5)
                    else if (it.op === "rumble") work = choice("Vibration strength", "rumble")
                    else if (it.op === "style") work = choice("Vibration style (the test uses this)", "style")
                    else if (it.op === "glyphs") work = choice("Button labels", "glyphs")
                    else if (it.op === "repeat") work = choice("How fast a held stick or D-pad keeps moving (in menus, on tiles and in the browser)", "repeat")
                    else if (it.op === "confirm") work = choice("Which button confirms? By position: the other of the two goes back; the left and top buttons stay. The launcher, browser and dialogs all use this.", "confirm")
                    else if (it.op === "joycons") work = choice("How Joy-Cons are set up", "joycons")
                    return work.then(loop)
                })
            }
            return loop()
        })
    }

    // ------------------------------------------------------------------ Keyboard & mouse
    readonly property var kbLabels: ({
        hints: { auto: "Automatic (whatever I used last)", controller: "Always controller buttons", keyboard: "Always keyboard keys" },
        wheel: { move: "Moves the selection", tabs: "Switches tabs (menus still scroll)", off: "Does nothing" }
    })
    function keyboardMenu() {
        if (w.menuUp()) return
        Promise.all([w.rawCall("__qt", ["kbm"]), w.rawCall("__qt", ["kb"])]).then(function (r) {
            var kbm = r[0], st = { kb: r[1], at: "", closed: {} }
            if (!kbm || !st.kb) return w.notice("Keyboard & mouse", "Couldn't read the keyboard settings.")
            var presetTable = kbm.PRESET_NAMES
            var set = function (op, payload) {
                return w.dev("settings", op, payload).then(function (x) { if (x.ok) st.kb = x.kb; else if (x.error) w.setStatus(x.error, true); return x })
            }
            var labelsFor = function () {
                var all = []
                kbm.ACTIONS.forEach(function (a) { all = all.concat(st.kb.bindings[a] || []) })
                return w.rawCall("__qt", ["keyLabels", all]).then(function (names) {
                    var map = {}
                    all.forEach(function (c, i) { map[c] = (names && names[i]) || c })
                    return map
                })
            }
            var loop = function () {
                return labelsFor().then(function (names) {
                    var k = st.kb
                    var items = [
                        { key: "preset", label: "Key layout", sub: presetTable[k.preset] || presetTable.standard, op: "preset" },
                        { key: "hints", label: "Button hints", sub: kbLabels.hints[k.hints] || kbLabels.hints.auto, op: "hints" },
                        { key: "h:keys", label: "Keys", header: true, fold: "kb.keys" }
                    ]
                    kbm.ACTIONS.forEach(function (a) { items.push({ key: "a:" + a, label: kbm.ACTION_LABELS[a], sub: (k.bindings[a] || []).map(function (c) { return names[c] }).join("  ·  "), act: a }) })
                    var changed = JSON.stringify(k.bindings) !== JSON.stringify(kbm.PRESETS[k.preset])
                    items.push({ key: "reset", label: "Reset keys to the layout", sub: changed ? "you changed some keys" : "nothing changed", op: "reset" })
                    items.push({ key: "always", label: "Always", sub: "Volume keys change the volume. Esc + ← / → switches tabs, even inside a web page.", info: true })
                    items.push({ key: "h:mouse", label: "Mouse", header: true, fold: "kb.mouse" })
                    items.push({ key: "mouseHide", label: "Hide the pointer after", sub: k.mouseHide ? k.mouseHide + " s without moving" : "Never (while using the mouse)", op: "mouseHide" })
                    items.push({ key: "wheel", label: "Scroll wheel", sub: kbLabels.wheel[k.wheel] || kbLabels.wheel.move, op: "wheel" })
                    items.push({ key: "buttons", label: "Buttons", sub: "Click opens · right-click or the back thumb button goes back · middle click shows options · forward thumb button: next tab", info: true })
                    items = folded(items, st.closed)
                    return w.pick("Keyboard & mouse", items, indexOfKey(items, st.at)).then(function (it) {
                        if (!it) return null
                        st.at = it.key
                        if (it.info) return loop()
                        var work = Promise.resolve()
                        if (it.fold) st.closed[it.fold] = !st.closed[it.fold]
                        else if (it.act) work = notYet(it.label + " · keys")
                        else if (it.op === "reset") work = set("kbReset", {})
                        else if (it.op === "preset" || it.op === "hints" || it.op === "wheel") {
                            var table = it.op === "preset" ? presetTable : kbLabels[it.op]
                            var titles = { preset: "Key layout (the arrow keys always work)", hints: "Button hints at the bottom of the screen", wheel: "The scroll wheel" }
                            work = choose(titles[it.op], table, k[it.op], function (v) {
                                if (it.op === "preset" && changed && v !== k.preset)
                                    return w.pick("Switching layout replaces the keys you changed", [{ label: "Switch", v: true }, { label: "Keep my keys" }]).then(function (ok) { if (ok && ok.v) return set("kbSet", { key: it.op, value: v }) })
                                return set("kbSet", { key: it.op, value: v })
                            })
                        } else if (it.op === "mouseHide") {
                            var vals = [1, 2, 3, 5, 10, 30, 0]
                            work = w.pick("Hide the pointer after", vals.map(function (v) { return { label: v ? v + " second" + (v === 1 ? "" : "s") : "Never", sub: v === k.mouseHide ? "current" : "", v: v } }), Math.max(0, vals.indexOf(k.mouseHide))).then(function (c) { if (c) return set("kbSet", { key: "mouseHide", value: c.v }) })
                        }
                        return work.then(loop)
                    })
                })
            }
            return loop()
        })
    }

    // ------------------------------------------------------------------ Update software
    function fmtDate(ms) { return ms ? new Date(ms).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "" }
    function buildLabel(b) { return b && b.version ? "Version " + b.version : b && b.time ? "The build from " + fmtDate(b.time) : "The new version" }
    function buildName(g, v) { return (g && g.names && g.names[v]) || v }
    readonly property string updateAbout: "Updates keep your games, saves and settings. The new version starts after a restart, and the previous one is kept in case you need to go back."
    readonly property string graphicsAbout: "Tessera comes in a build for each kind of graphics card, because the NVIDIA driver is part of the system. Switching builds works like an update: your games, saves and settings stay, the new build starts after a restart, and the old one stays in the boot menu."
    function graphicsItems(g, closed) {
        if (!g || !g.have) return []
        var out = [{ key: "h:gfx", label: "Graphics", header: true, fold: "update.graphics" }]
        if (closed["update.graphics"] === undefined) closed["update.graphics"] = !g.mismatch      // opens by itself when the card and the build disagree
        out.push({ key: "gfxcard", label: g.cards.length ? g.cards.join(" + ") : "Graphics card", sub: "This build: " + buildName(g, g.have), info: true })
        if (g.switching) out.push({ key: "gfxready", label: "The " + buildName(g, g.need) + " build is ready", sub: "Restart to finish switching", info: true })
        else if (g.mismatch) out.push({ key: "gfxswitch", label: "Switch to the " + buildName(g, g.need) + " build", sub: "Made for this card · games and settings stay", op: "graphics", variant: g.need })
        out.push({ key: "gfxpick", label: "Choose a build myself…", sub: "For special setups, like an external card", op: "graphicsPick" })
        return out
    }
    function updateItems(info, closed) {
        if (!info.supported || !info.booted) return [{ key: "retry", label: "Try again", op: "retry" }]
        var b = info.booted
        var out = [{ key: "h:inst", label: "Installed", header: true }]
        out.push({ key: "installed", label: ("Tessera " + (info.launcher || "")).trim(), sub: [b.version ? "System " + b.version : "", b.time ? "built " + fmtDate(b.time) : ""].filter(Boolean).join(" · "), info: true })
        out.push({ key: "h:upd", label: "Update", header: true })
        if (info.rollbackQueued) {
            out.push({ key: "reboot", label: "Restart now", sub: info.rollback ? "Goes back to " + buildLabel(info.rollback) : "Goes back to the previous version", op: "reboot" })
            return out
        }
        if (info.staged) out.push({ key: "reboot", label: "Restart now", sub: buildLabel(info.staged) + " is ready", op: "reboot" })
        out.push({ key: "update", label: "Update now", sub: info.staged ? "Look for something newer" : "Get the newest version", op: "update" })
        if (info.rollback && !info.staged) {
            out.push({ key: "h:prev", label: "Previous version", header: true })
            out.push({ key: "rollback", label: "Go back to the previous version", sub: buildLabel(info.rollback), op: "rollback" })
        }
        return out.concat(graphicsItems(info.graphics, closed))
    }
    function updateStart(kind, extra) {
        var p = Object.assign({ job: kind }, extra || {})
        var fin = function (r) { return r.ok ? null : { result: "error", error: r.error || "Couldn't start the update.", detail: "" } }
        return w.dev("update", "start", p).then(function (r) {
            if (!r.needPin) return fin(r)
            return w.requirePin().then(function (ok) { return ok ? w.dev("update", "start", p).then(fin) : { result: "canceled", quiet: true } })
        })
    }
    function updateEnd(r) {
        switch (r.result) {
        case "canceled": return r.quiet ? "" : "Stopped. Nothing was changed."
        case "error": return r.error + (r.detail ? " (" + r.detail + ")" : "")
        case "uptodate": return "You're up to date. This is the newest version."
        case "rolledback": return "Done. The previous version starts after the next restart."
        case "staged": return buildLabel(r) + " is downloaded. Restart to finish installing it."
        default: return null
        }
    }
    // follows one system job until it ends; B or Stop asks first
    function updateWatch(kind, hint) {
        hint = hint || {}
        var titles = { bootmenu: "Boot menu", boot: "Boot screen", check: "Checking for updates", rollback: "Going back", graphics: "Switching graphics build" }
        var asks = { boot: "Stop changing the boot screen?\nNothing is changed until it finishes.", bootmenu: "Stop changing the boot screen?\nNothing is changed until it finishes.", rollback: "Stop going back?\nNothing is changed until it finishes." }
        return w.watchJob("update", titles[kind] || "Updating", function (p, stopping) {
            if (stopping) return ""
            var what = kind === "bootmenu" ? "Setting the boot menu to " + (hint.name || "your choice")
                : kind === "boot" ? "Setting the boot screen to " + (hint.name || "your choice")
                : kind === "rollback" ? "Setting up the previous version"
                : kind === "check" ? "Looking for a newer version"
                : kind === "graphics" ? "Downloading the " + (hint.name || "new") + " build"
                : hint.version ? "Downloading version " + hint.version : "Downloading the update"
            var status = [what, kind === "apply" && hint.size ? "about " + hint.size : "", w.clockText(p.elapsed)].filter(Boolean).join(" · ")
            var big = kind === "apply" || kind === "graphics"
            return [status, big ? "Keep the console on until this finishes." : "", big ? p.line : ""].filter(Boolean).join("\n")
        }, { ask: asks[kind] || "Stop the update?\nWhat is already downloaded is kept for next time.", noAck: true, otherwise: { result: "unknown" } })
    }
    // check, then fetch if there is something to fetch; "resume" joins a job that is already running
    function updateNow(resume) {
        var checked = resume === "apply" ? Promise.resolve({ hint: {} }) : (resume ? Promise.resolve(null) : updateStart("check")).then(function (bad) {
            return (bad ? Promise.resolve(bad) : updateWatch("check")).then(function (r) {
                var end = updateEnd(r)
                return end !== null ? { end: end } : { hint: { version: r.version, size: r.size } }
            })
        })
        return checked.then(function (c) {
            if (c.end !== undefined) return c.end
            return (resume === "apply" ? Promise.resolve(null) : updateStart("apply")).then(function (bad) {
                return bad ? bad : updateWatch("apply", c.hint)
            }).then(function (r) {
                var end = updateEnd(r)
                return end !== null ? end : "The update finished, but I couldn't tell whether anything new was installed. Open this screen again to see."
            })
        })
    }
    function graphicsSwitch(g, variant) {
        var why = g && g.mismatch && variant === g.need
            ? "This machine has " + (g.cards.join(" + ") || "a different graphics card") + ", but Tessera is running the build for " + buildName(g, g.have) + "."
            : "Switch to the " + buildName(g, variant) + " build?"
        return w.confirmYes(why + " The " + buildName(g, variant) + " build downloads now and starts after a restart. Games, saves and settings stay.", "Switch").then(function (yes) {
            if (!yes) return ""
            return w.requirePin().then(function (ok) {
                if (!ok) return ""
                return updateStart("graphics", { variant: variant }).then(function (bad) { return bad || updateWatch("graphics", { name: buildName(g, variant) }) }).then(function (r) {
                    var end = updateEnd(r)
                    if (r.result === "staged") return "The " + buildName(g, variant) + " build is downloaded. Restart to finish switching."
                    return end !== null ? end : "I couldn't tell whether that worked. Open this screen again to see."
                })
            })
        })
    }
    function update() {
        if (w.menuUp()) return
        var st = { info: null, note: "", resume: "", at: "", closed: {}, done: false }
        var loop = function () {
            var load = Promise.resolve()
            if (!st.info) {
                w.setStatus("Checking what is installed…")
                load = w.dev("update", "info").then(function (r) {
                    w.setStatus("")
                    if (!r.ok) { w.setStatus(r.error || "Couldn't read the system version.", true); st.done = true; return }
                    st.info = r
                    if (r.job) st.resume = r.job
                })
            }
            return load.then(function () {
                if (st.done) return null
                if (st.resume) { var job = st.resume; st.resume = ""; return updateNow(job).then(function (n) { st.note = n; st.info = null; return loop() }) }
                var info = st.info
                var items = updateItems(info, st.closed)
                var shown = folded(items, st.closed)
                var problem = info.supported ? "" : [info.problem, info.detail ? "(" + info.detail + ")" : ""].filter(Boolean).join(" ")
                var gfx = info.graphics && info.graphics.mismatch && !info.graphics.switching
                var first = gfx ? shown.findIndex(function (x) { return x.op === "graphics" }) : shown.findIndex(function (x) { return x.op })
                var at = st.at ? indexOfKey(shown, st.at) : Math.max(0, first)
                var body = st.note || problem || (gfx ? "Your graphics card changed. Tessera is running the build for " + buildName(info.graphics, info.graphics.have) + "; switch to the one made for this card below." : updateAbout)
                return w.pick("Update software", shown, at, { body: body }).then(function (it) {
                    st.note = ""
                    if (!it) return null
                    if (it.info || it.fold) { st.at = it.key; if (it.fold) st.closed[it.fold] = !st.closed[it.fold]; return loop() }
                    st.at = ""
                    var work = Promise.resolve()
                    if (it.op === "retry") st.info = null
                    else if (it.op === "reboot") {
                        work = w.requirePin().then(function (ok) {
                            if (!ok) return
                            return w.dev("update", "reboot").then(function (r0) {
                                return r0.needPin ? w.requirePin().then(function (ok2) { return ok2 ? w.dev("update", "reboot") : { canceled: true } }) : r0
                            }).then(function (r) {
                                if (r.canceled) return
                                if (r.ok) return w.pick("Restarting…", [{ label: "Close", op: "close" }], 0, { body: "The console is restarting. This takes a moment." }).then(function () { st.done = true })
                                st.note = r.error || "Couldn't restart from here. Use the power button, or Opus."
                            })
                        })
                    } else if (it.op === "update") {
                        work = w.requirePin().then(function (ok) { if (ok) return updateNow("").then(function (n) { st.note = n; st.info = null }) })
                    } else if (it.op === "graphics") {
                        work = graphicsSwitch(info.graphics, it.variant).then(function (n) { st.note = n; st.info = null })
                    } else if (it.op === "graphicsPick") {
                        var g = info.graphics, opts = ["standard", "nvidia", "nvidia-open"]
                        work = w.pick("Which build?", opts.map(function (v) { return { label: buildName(g, v), sub: v === g.have ? "running now" : v === g.need ? "suits this card" : "", v: v } }), Math.max(0, opts.indexOf(g.need || g.have)), { body: graphicsAbout }).then(function (c) {
                            if (c && c.v !== g.have) return graphicsSwitch(g, c.v).then(function (n) { st.note = n; st.info = null })
                        })
                    } else if (it.op === "rollback") {
                        work = w.confirmYes("Go back to " + buildLabel(info.rollback).toLowerCase() + "? It starts after the next restart. Your games, saves and settings are kept.", "Go back").then(function (yes) {
                            if (!yes) return
                            return updateStart("rollback").then(function (bad) { return bad || updateWatch("rollback") }).then(function (r) { st.note = updateEnd(r) || "I couldn't tell whether that worked. Open this screen again to see."; st.info = null })
                        })
                    }
                    return work.then(loop)
                })
            })
        }
        loop().then(function () { w.refreshTileNotes(true) })
    }

    // ------------------------------------------------------------------ Report a problem
    readonly property string issuesUrl: "https://github.com/Herbalchemist/tessera/issues"
    readonly property int issueUrlMax: 7500
    readonly property var issueSections: ["Tessera", "System", "Hardware", "Crashes and errors (the start before)", "Login screen log (the start before)", "Login screen log (this boot)", "Tessera session log (this session)", "Tessera session log (the session before)", "Controllers and Bluetooth (kernel, this boot)", "Settings"]
    function reportSections(text) {
        var out = {}, cur = null
        String(text).split("\n").forEach(function (line) {
            var m = /^== (.+)$/.exec(line)
            if (m) { cur = m[1].trim(); out[cur] = [] } else if (cur) out[cur].push(line)
        })
        return out
    }
    function issueBody(r, what) {
        var secs = reportSections(r.text)
        var body = ["**What happened**", "", what || "_(not described)_", "", "_Sent from Tessera's Report a problem. The full report is `" + r.folder + "/" + r.name + "` on that machine: attach it here if asked._", ""].join("\n")
        var fence = function (title, lines) { return "<details><summary>" + title + "</summary>\n\n```\n" + lines.join("\n").trim() + "\n```\n</details>\n" }
        var room = function () { return issueUrlMax - encodeURIComponent(body).length }
        for (var n = 0; n < issueSections.length; n++) {
            var title = issueSections[n], lines = secs[title]
            if (!lines || !lines.join("").trim() || lines.join("").trim() === "(nothing)") continue
            var keep = lines.slice(-60), part = fence(title, keep)
            while (keep.length > 3 && encodeURIComponent(part).length > room()) { keep = keep.slice(Math.ceil(keep.length / 4)); part = fence(title + " (last lines)", keep) }
            if (encodeURIComponent(part).length > room()) break
            body += "\n" + part
        }
        return body
    }
    function issueUrl(title, body) { return issuesUrl + "/new?title=" + encodeURIComponent(title) + "&body=" + encodeURIComponent(body) }
    function reportRows(lines) { return lines.map(function (l) { return /^== /.test(l) ? { label: l.slice(3), header: true } : { label: l || " ", info: true } }) }
    function openInBrowser(url) { return notYet("The browser") }      // until the built-in browser is ported
    function reportToGitHub(r) {
        return w.ask("What happened? (optional)", "", { max: 300 }).then(function (what) {
            if (what === null) return reportMade(r)
            var text = what && what.trim()
            var title = (text ? text.split("\n")[0].slice(0, 80) : "Problem report from Tessera " + ((/launcher (\S+)/.exec(r.text) || [])[1] || "")).trim()
            var body = issueBody(r, text)
            var loop = function () {
                var lines = ["Title: " + title, ""].concat(body.replace(/<\/?details>|<\/?summary>|```/g, "").split("\n")).slice(0, 700)
                return w.pick("Report it on GitHub", [
                    { label: "Open the issue on GitHub", sub: "in the browser: sign in to GitHub if asked, look it over, then press Submit there", op: "open" },
                    { label: "Read what goes in it", sub: lines.length + " lines (names and addresses already replaced)", op: "read" },
                    { label: "Just keep the saved report", op: "saved" },
                    { label: "Nothing is sent until you press Submit on GitHub's page. GitHub issues are public.", info: true }
                ], 0, { body: "The report is saved too: " + r.folder + "/" + r.name }).then(function (it) {
                    if (!it) return null
                    if (it.info) return loop()
                    if (it.op === "read") return w.pick("What goes in the issue", lines.map(function (l) { return { label: l || " ", info: true } })).then(loop)
                    if (it.op === "saved") return reportMade(r)
                    return openInBrowser(issueUrl(title, body))
                })
            }
            return loop()
        })
    }
    function reportMade(r) {
        var loop = function () {
            return w.pick("Report saved", [
                { label: "Read it", sub: "every line, before you share it", op: "read" },
                { label: "Report it on GitHub", sub: "a new issue with this report filled in", op: "github" },
                { label: "Open the issues page", sub: "in the browser, to describe what happened", op: "issues" },
                { label: "Delete it", op: "delete", danger: true },
                { label: "To share it", sub: "On " + issuesUrl.replace("https://", "") + ", start a new issue (or answer yours) and attach the file. It's in " + r.folder + " (from Opus, or copy it to a USB drive).", info: true }
            ], 0, { body: r.folder + "/" + r.name }).then(function (it) {
                if (!it) return null
                if (it.info) return loop()
                if (it.op === "read") return w.pick(r.name, reportRows(r.text.split("\n").slice(0, 900))).then(loop)
                if (it.op === "github") return reportToGitHub(r)
                if (it.op === "issues") return openInBrowser(issuesUrl)
                if (it.op === "delete") return w.confirmYes("Delete " + r.name + "?", "Delete").then(function (yes) {
                    if (!yes) return loop()
                    return w.dev("report", "delete", { name: r.name }).then(function () { w.setStatus("Report deleted.") })
                })
            })
        }
        return loop()
    }
    function report() {
        if (w.menuUp()) return
        w.dev("report", "contents").then(function (info) {
            if (!info.contents) return w.notice("Report a problem", info.error || "Couldn't read what a report holds.")
            var loop = function () {
                var items = [
                    { label: "Report it on GitHub", sub: "opens a new issue with the report filled in; you see it first, and send it yourself", op: "github" },
                    { label: "Save a report", sub: "only to your Tessera folder, to read or share later", op: "make" },
                    { label: "What goes in it", header: true }
                ].concat(info.contents.map(function (c) { return { label: c, info: true } }))
                items.push({ label: "Never in it: PINs, passwords, Wi-Fi names. Your account and computer names, and network and hardware addresses, are replaced with [brackets].", info: true })
                return w.pick("Report a problem", items, 0, { body: "Tessera writes a report file to the Reports folder in your Tessera folder. Nothing is sent by itself: on GitHub you see the issue before you send it." }).then(function (it) {
                    if (!it) return null
                    if (it.info) return loop()
                    w.setStatus("Making the report…")
                    return w.dev("report", "make").then(function (r) {
                        if (!r.ok) { w.setStatus(r.error || "Couldn't make the report.", true); return null }
                        w.setStatus("Saved " + r.folder + "/" + r.name)
                        return it.op === "github" ? reportToGitHub(r) : reportMade(r)
                    })
                })
            }
            return loop()
        })
    }
}
