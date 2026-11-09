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
}
