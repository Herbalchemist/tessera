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
        return w.dev("settings", "padSet", { key: key, value: value }).then(function (r) { if (r.ok) { st.pad = Object.assign({}, st.pad, r.pad); w.setPad(st.pad) } else w.setStatus(r.error || "Couldn't save that.", true) })
    }
    // ------------------------------------------------------------------ Button mapping (input-actions.js)
    readonly property var glyphSets: ({
        xbox: { 0: "A", 1: "B", 2: "X", 3: "Y", 4: "LB", 5: "RB", 6: "LT", 7: "RT", 8: "View", 9: "Menu", 10: "L3", 11: "R3", 16: "Guide" },
        playstation: { 0: "✕", 1: "○", 2: "□", 3: "△", 4: "L1", 5: "R1", 6: "L2", 7: "R2", 8: "Create", 9: "Options", 10: "L3", 11: "R3", 16: "PS" },
        nintendo: { 0: "B", 1: "A", 2: "Y", 3: "X", 4: "L", 5: "R", 6: "ZL", 7: "ZR", 8: "−", 9: "+", 10: "LS", 11: "RS", 16: "Home" }
    })
    // the family of the controller in use (its USB vendor, then its name)
    function padFamily() {
        var s = padState.snapshot(), m = /vendor:\s*([0-9a-f]{4})/i.exec((s && s.id) || ""), v = m ? m[1].toLowerCase() : "", n = ((s && s.name) || "").toLowerCase()
        return v === "054c" || /dualsense|dualshock|playstation|sony/.test(n) ? "playstation" : v === "057e" || /nintendo|joy-?con|switch|pro controller/.test(n) ? "nintendo" : "xbox"
    }
    // a map says how a controller's buttons are read: a remap list, or true when the right button confirms
    function padMapFor(family, pad) {
        var r = pad && pad.remap && pad.remap[family]
        // a list that came over the bridge can be a Qt sequence, not a JS array (Array.isArray says no, and a map that is not an array reads as "swap A and B"): copy it
        if (r && r.length === 6) { var cp = []; for (var i = 0; i < 6; i++) cp.push(Number(r[i])); if (cp.slice().sort().join() === "0,1,2,3,4,5") return cp }
        var c = pad && pad.confirm
        return c === "right" || (c !== "bottom" && c !== "right" && family === "nintendo")
    }
    function mapRole(p, map) { return Array.isArray(map) ? (p >= 0 && p < 6 ? map[p] : p) : (map && (p === 0 || p === 1) ? 1 - p : p) }
    function mapPhysical(role, map) {
        if (Array.isArray(map)) { var i = map.indexOf(role); return role >= 0 && role < 6 && i >= 0 ? i : role }
        return mapRole(role, map)
    }
    function mapAssign(map, role, physical) {
        var m = [0, 1, 2, 3, 4, 5].map(function (n) { return mapRole(n, map) })
        var had = m.indexOf(role), t = m[had]
        m[had] = m[physical]; m[physical] = t
        return m
    }
    readonly property var keyActions: [["shift", "Shift (capital letters)"], ["space", "Space"], ["back", "Delete"], ["done", "Done"], ["cancel", "Cancel"]]
    readonly property var padJobs: [[0, "Select / open"], [1, "Back"], [2, "X · resize a tile, next link in the browser"], [3, "Options · hold to move a tile"], [4, "Previous tab"], [5, "Next tab"]]
    readonly property var familyNames: ({ xbox: "Xbox", playstation: "PlayStation", nintendo: "Nintendo" })
    function press(label, only, hint) { return new Promise(function (resolve) { w.capture.open(label, only, hint, resolve) }) }
    function controls() {
        var st = { at: "", closed: {} }
        var loop = function () {
            return w.dev("settings", "padGet").then(function (pr) {
                return w.dev("settings", "getKeys").then(function (kr) {
                    var pad = pr.pad || {}, keys = kr.keys || {}
                    var fam = padFamily(), map = padMapFor(fam, pad)
                    var set = glyphSets[pad.glyphs] || glyphSets[fam]
                    var roleName = function (n) { var b = mapPhysical(n, map); return set[b] || "Button " + b }
                    var changed = Boolean(pad.remap && pad.remap[fam])
                    var items = [{ key: "h:kb", label: "Keyboard", header: true, fold: "map.keyboard" }]
                    keyActions.forEach(function (a) { items.push({ key: "k:" + a[0], label: a[1], sub: roleName(keys[a[0]]), id: a[0] }) })
                    items.push({ key: "reset", label: "Reset keyboard buttons", op: "reset" })
                    items.push({ key: "h:pad", label: familyNames[fam] + " controller buttons", header: true, fold: "map.pad" })
                    padJobs.forEach(function (j) { items.push({ key: "r:" + j[0], label: j[1], sub: roleName(j[0]), role: j[0] }) })
                    items.push({ key: "padReset", label: "Put these buttons back", sub: changed ? "the usual " + familyNames[fam] + " layout" : "nothing changed", op: "padReset" })
                    items.push({ key: "always", label: "Always", sub: "The D-pad and left stick move, and the Guide button opens the guide.", info: true })
                    var shown = folded(items, st.closed)
                    return w.pick("Button mapping", shown, Math.max(1, indexOfKey(shown, st.at))).then(function (it) {
                        if (!it) return null
                        st.at = it.key
                        if (it.info) return loop()
                        if (it.fold) { st.closed[it.fold] = !st.closed[it.fold]; return loop() }
                        if (it.op === "reset") return w.dev("settings", "resetKeys").then(loop)
                        if (it.op === "padReset") return (changed ? w.dev("settings", "padRemap", { family: fam, map: null }).then(function (r) { if (r.ok) w.setPad(r.pad) }) : Promise.resolve()).then(loop)
                        if (it.role !== undefined) {
                            return press(it.label, [0, 1, 2, 3, 4, 5], "Press the button it's on now (" + roleName(it.role) + ") to keep it. Esc cancels.").then(function (n) {
                                if (n === null) return loop()
                                var next = mapAssign(map, it.role, mapPhysical(n, map))
                                return w.dev("settings", "padRemap", { family: fam, map: next }).then(function (r) {
                                    if (r.ok) w.setPad(r.pad); else w.setStatus("Couldn't change that.", true)
                                }).then(loop)
                            })
                        }
                        return press(it.label, null, "").then(function (n) {
                            if (n === null) return loop()
                            return w.dev("settings", "setKey", { action: it.id, button: n }).then(function (r) { if (!r.ok) w.setStatus(r.error, true) }).then(loop)
                        })
                    })
                })
            })
        }
        return loop()
    }

    // the live test: resolves when it is closed

    // ------------------------------------------------------------------ the guide (renderer/guide.js)
    // The Guide button (main process: guide.js, unchanged) sends {action, inGame, title}. One press
    // opens or closes this panel from anywhere; a hold goes Home. Over a running game it holds
    // Resume / Close.
    property bool guideOn: false
    property var gameOn: null
    property bool notesHidden: false
    property var guideAll: []
    property var guideClosed: ({ "guide.power": true })
    property var clearedLow: ({})
    property int guideSeq: 0
    function ago(t) { var m = Math.round((Date.now() - t) / 60000); return m < 1 ? "just now" : m < 60 ? m + " min ago" : Math.round(m / 60) + " h ago" }
    function guideEvent(msg) {
        if (!msg) return
        if (msg.inGame) gameOn = { title: msg.title || "Game", since: gameOn ? gameOn.since : Date.now() }
        if (msg.action === "home") return guideHome()
        if (guideOn) return closeGuide(false)
        openGuide()
    }
    function guideHome() {
        if (guideOn) closeGuide(true)
        if (w.guideMenu.visible) w.guideMenu.close()
        w.leaveBrowser()
        w.goHome()
        if (gameOn) w.setStatus(gameOn.title + " is still running. Press Guide to go back to it.")
    }
    function closeGuide(stay) {
        if (!guideOn) return
        guideOn = false
        guideSeq++
        if (w.guideMenu.visible) w.guideMenu.close()
        if (w.browserOpen) browserInput.setActive(true)
        if (gameOn && !stay) resumeGame()
        if (guideOnly && !stay) w.dev("guide", "hideHelper")     // the desktop helper: the see-through window goes away again
    }
    function resumeGame() {
        if (!gameOn) return
        gameOn = null
        w.dev("guide", "resume")
    }
    function notes() {
        var out = [], low = (w.view.prefs && w.view.prefs.storage && w.view.prefs.storage.low) || []
        low.forEach(function (l) { if (!clearedLow[l.name + "|" + l.free]) out.push({ text: "Low storage on " + l.name, sub: fmtBytes(l.free) + " left", error: true }) })
        w.statusLog.forEach(function (m) { out.push({ text: m.msg.length > 90 ? m.msg.slice(0, 88) + "…" : m.msg, sub: ago(m.at), error: m.isError }) })
        return out
    }
    function guideNotes() {
        var m = w.guideMenu
        m.notes = notes()
        m.notesHidden = notesHidden
    }
    function openGuide() {
        if (guideOn) return
        var seq = ++guideSeq
        guideOn = true
        w.dismissAll()
        if (w.browserOpen) browserInput.setActive(false)       // the page waits behind the guide
        var q = function (p) { return Promise.race([Promise.resolve(p).catch(function () { return null }), w.sleepMs(1500).then(function () { return null })]) }
        Promise.all([q(w.systemInfo()), q(w.dev("audio", "info")), q(w.dev("profiles", "list")), q(w.dev("wifi", "info")), q(w.dev("bluetooth", "info")), q(w.dev("guide", "status"))]).then(function (r) {
            if (!guideOn || seq !== guideSeq) return
            var info = r[0] || {}, audio = r[1], prof = r[2] || { profiles: [], active: null }, wifi = r[3], bt = r[4], st = r[5] || {}
            if (st.running && !gameOn) gameOn = { title: st.title || "Game", since: st.since || Date.now() }
            var out = audio && audio.ok ? audio.outputs.find(function (o) { return o.isDefault }) : null
            var items = []
            if (w.view.prefs && w.view.prefs.live && !guideOnly) items.push({ label: "Install Tessera", sub: "on this computer", op: "install", ok: true })
            if (gameOn) {
                items.push({ label: "Playing · " + gameOn.title, header: true })
                items.push({ label: "Resume " + gameOn.title, sub: "started " + ago(gameOn.since), op: "resume" })
                items.push({ label: "Close " + gameOn.title, op: "closeGame", danger: true })
            }
            items.push({ label: "Go", header: true })
            if (guideOnly) items.push({ label: "Return to Ludus", sub: "Closes Opus and starts Ludus", op: "returnTessera" })
            else {
                items.push({ label: "Home", op: "home" })
                if (w.browserOpen) items.push({ label: "Back to the browser", op: "close" })
                items.push({ label: "Settings", op: "settings" })
            }
            items.push({ label: "Quick settings", header: true })
            if (out) {
                var vol = { label: "Volume", sub: out.mute ? "Muted" : out.volume + "%", op: "mute", adjust: function (dir) {
                    var v = Math.max(0, Math.min(100, (out.volume || 0) + dir * 5))
                    if (v === out.volume && !out.mute) return
                    out.volume = v
                    if (out.mute && dir > 0) { out.mute = false; w.dev("audio", "mute", { kind: "output", id: out.id, on: false }) }
                    vol.sub = out.mute ? "Muted" : v + "%"
                    w.dev("audio", "volume", { kind: "output", id: out.id, pct: v })
                } }
                items.push(vol)
            }
            if (wifi && wifi.ok && wifi.present) {
                var cur = (wifi.networks || []).find(function (n) { return n.active || n.connected || n.inUse })
                items.push({ label: "Wi-Fi", sub: wifi.radio ? (cur ? "On · " + cur.ssid : "On") : "Off", op: "wifi", on: Boolean(wifi.radio) })
            }
            if (bt && bt.ok && bt.adapter && bt.adapter.present) items.push({ label: "Bluetooth", sub: bt.adapter.powered ? "On" : "Off", op: "bt", on: Boolean(bt.adapter.powered) })
            ;(info.pads || []).forEach(function (pad) {
                var level = pad.pct !== null && pad.pct !== undefined ? pad.pct + "%" : (pad.level || "unknown")
                items.push({ label: pad.name, sub: "Battery " + level + (pad.charging ? ", charging" : ""), info: true })
            })
            items.push({ label: "Profiles", header: true })
            ;(prof.profiles || []).forEach(function (pr) { items.push({ label: pr.name, sub: pr.id === prof.active ? "playing now" : "", op: "profile", id: pr.id }) })
            if ((prof.profiles || []).length && (!prof.guest || prof.guest.show !== false || !prof.active)) items.push({ label: "Guest", sub: prof.active ? "" : "playing now", op: "profile", id: null })
            if (!guideOnly) {
                items.push({ label: (prof.profiles || []).length ? "Manage profiles…" : "Add a profile…", op: "profiles" })
                items.push({ label: "Help", header: true })
                items.push({ label: "Take the tour", sub: "a quick look around Tessera", op: "tour" })
                items.push({ label: "Report a problem", sub: "a file to attach to an issue; nothing is sent", op: "report" })
            }
            items.push({ label: "Power", header: true, fold: "guide.power" })
            items.push({ label: "Sleep", op: "sleep" })
            items.push({ label: "Restart", op: "restart" })
            items.push({ label: "Shut down", op: "shutdown" })
            if (!guideOnly) items.push({ label: "Opus", op: "desktop" })
            var who = (prof.profiles || []).find(function (p) { return p.id === prof.active })
            var bits = [Qt.formatTime(new Date(), "h:mm AP")]
            if (info.battery && info.battery.present && info.battery.pct !== null) bits.push("Battery " + info.battery.pct + "%" + (info.battery.charging ? " ⚡" : ""))
            if (wifi && wifi.ok && wifi.present && wifi.radio) { var c2 = (wifi.networks || []).find(function (n) { return n.active || n.connected || n.inUse }); if (c2) bits.push(c2.ssid) }
            if (who) bits.push(who.name)
            guideAll = items
            var gs = w.view.prefs && w.view.prefs.pad ? w.view.prefs.pad.guideStyle : "side"
            var opts = { body: bits.join("  ·  "), stay: true, notes: notes(), guide: ["side", "float", "compact"].indexOf(w.shotGuide || gs) >= 0 ? (w.shotGuide || gs) : "side" }
            var menuItems = folded(items, guideClosed)
            opts.onX = function () { notesHidden = !notesHidden; guideNotes() }
            opts.onY = function () {
                ;((w.view.prefs && w.view.prefs.storage && w.view.prefs.storage.low) || []).forEach(function (l) { clearedLow[l.name + "|" + l.free] = true })
                w.statusLog = []; notesHidden = false; w.setStatus(""); w.statusLog = []; guideNotes()
            }
            w.pick("Guide", menuItems, 0, opts)
            // the menu stays open across answers: keep listening for the next A
            w.guideMenu.done = function (it) { guideChoose(it, seq) }
            w.guideMenu.canceled = function () { if (guideOn && seq === guideSeq) closeGuide(false) }
        })
    }
    function guideChoose(it, seq) {
        if (!it || it.info || !guideOn || seq !== guideSeq) return
        var op = it.op, m = w.guideMenu
        var leaveTo = function (fn) { closeGuide(true); fn() }
        if (it.fold) { guideClosed[it.fold] = !guideClosed[it.fold]; var keep = m.sel; m.items = folded(guideAll, guideClosed); m.sel = keep; return }
        if (op === "returnTessera") return w.dev("guide", "returnToTessera")
        if (op === "close") return closeGuide(true)
        if (op === "resume") return closeGuide(false)
        if (op === "home") return guideHome()
        if (op === "closeGame") {
            var title = gameOn ? gameOn.title : "the game"
            closeGuide(true)
            return w.confirmYes("Close " + title + "? Anything you haven't saved in it is lost.", "Close it").then(function (y) {
                if (!y) return openGuide()
                return w.dev("guide", "closeGame").then(function (r) { w.setStatus(r && r.ok ? "Closing " + title + "…" : (r && r.error) || "Couldn't close it.", !(r && r.ok)) })
            })
        }
        if (op === "mute") {
            return w.dev("audio", "info").then(function (a) {
                var o = a && a.ok && a.outputs.find(function (x) { return x.isDefault })
                if (!o) return
                return w.dev("audio", "mute", { kind: "output", id: o.id, on: !o.mute }).then(function () { it.sub = !o.mute ? "Muted" : o.volume + "%"; m.items = m.items.slice() })
            })
        }
        if (op === "wifi" || op === "bt") {
            return w.requirePin().then(function (ok) {
                if (!ok) return
                return (op === "wifi" ? w.dev("wifi", "radio", { on: !it.on }) : w.dev("bluetooth", "power", { on: !it.on })).then(function (r) {
                    if (r && r.ok) { it.on = !it.on; it.sub = it.on ? "On" : "Off"; m.items = m.items.slice() }
                    else w.setStatus((r && r.error) || "Couldn't change that.", true)
                })
            })
        }
        if (op === "profile") {
            return switchProfile(it.id, it.label).then(function (r) {
                if (r && guideOn) { m.items.forEach(function (x) { if (x.op === "profile") x.sub = x.id === it.id ? "playing now" : "" }); m.items = m.items.slice() }
            })
        }
        if (op === "install") return leaveTo(function () { usbFlow("install") })
        if (op === "settings") return leaveTo(function () { w.goSettings() })
        if (op === "profiles") return leaveTo(function () { profiles() })
        if (op === "tour") return leaveTo(function () { w.runTour() })
        if (op === "report") return leaveTo(function () { report() })
        if (op === "sleep" || op === "restart" || op === "shutdown" || op === "desktop") {
            closeGuide(true)
            var words = { sleep: ["Go to sleep?", "Sleep"], restart: ["Restart the computer?", "Restart"], shutdown: ["Shut down the computer?", "Shut down"], desktop: ["Switch to Opus?", "Switch"] }[op]
            if (gameOn && op !== "sleep") { w.setStatus("Close " + gameOn.title + " first.", true); return openGuide() }
            return w.confirmYes(words[0], words[1]).then(function (y) {
                if (!y) return
                if (op === "desktop") return w.flowDesktop()
                return w.gated(function () { return w.dev("power", op) }).then(function (r) {
                    if (r.canceled) return
                    if (r.ok === false) w.setStatus(r.error || "That did not work.", true)
                })
            })
        }
    }
    function grip(auto) {
        return new Promise(function (resolve) {
            var g = w.grip
            var done = function () { g.closed.disconnect(done); resolve() }
            g.closed.connect(done)
            g.open(auto)
        })
    }
    function padTest() {
        return w.dev("settings", "padGet").then(function (r) {
            var t = w.padtest
            t.calib = r.calib || {}
            if (r.pad) t.pad = r.pad
            return new Promise(function (resolve) {
                var done = function () { t.closed.disconnect(done); resolve() }
                t.closed.connect(done)
                t.open()
            })
        })
    }
    // resting offsets of the sticks: let go of everything, then the average of what they report
    function calibratePad(st) {
        var first = w.padtest.snapshotNow()
        if (!first || !first.id) { w.setStatus("No controller detected. Press a button on it first.", true); return Promise.resolve() }
        var id = first.id
        return w.pick("Let go of both sticks and triggers, then choose Calibrate", [
            { label: "Calibrate now", op: "go" }, { label: "Clear calibration", op: "clear" }, { label: "Cancel" }
        ]).then(function (it) {
            if (!it || !it.op) return
            var offsets = null
            var run = it.op === "go" ? (function () {
                var sums = [0, 0, 0, 0], n = 0
                var sample = function (i) {
                    if (i >= 8) return Promise.resolve()
                    return w.sleepMs(100).then(function () {
                        var p = w.padtest.snapshotNow()
                        if (!p || p.id !== id) return
                        for (var k = 0; k < 4; k++) sums[k] += p.axes[k] || 0
                        n++
                        return sample(i + 1)
                    })
                }
                return sample(0).then(function () {
                    if (!n) return false
                    offsets = sums.map(function (s) { return Math.abs(s / n) <= 0.4 ? s / n : 0 })     // a trigger resting at -1 isn't a drift
                    return true
                })
            })() : Promise.resolve(true)
            return run.then(function (ok) {
                if (!ok) return w.setStatus("Lost the controller. Try again.", true)
                return w.dev("settings", "padCalib", { id: id, offsets: offsets }).then(function (r) {
                    if (r.ok) w.setStatus(it.op === "go" ? "Sticks calibrated." : "Calibration cleared.")
                    else w.setStatus(r.error || "Couldn't save that.", true)
                })
            })
        })
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
                    else if (it.op === "test") work = padTest()
                    else if (it.op === "calib") work = calibratePad(st)
                    else if (it.op === "mapping") work = controls()
                    else if (it.op === "grip") work = grip()
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
                return w.dev("settings", op, payload).then(function (x) { if (x.ok) { st.kb = x.kb; w.loadKb() } else if (x.error) w.setStatus(x.error, true); return x })
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
            // the keys of one action: add one (press it), remove one (Y), or move one to the front (A)
            var keyAct = function (act, at) {
                return labelsFor().then(function (names) {
                    var keys = st.kb.bindings[act] || []
                    var items = [{ label: "Add a key", sub: "up to " + kbm.MAX_PER_ACTION + " keys, the first one shows in hints", op: "add" }]
                    keys.forEach(function (code, i) { items.push({ label: names[code] || code, sub: i === 0 ? "shown in hints · A: make another one first, Y: remove" : "A: show this one in hints · Y: remove", code: code }) })
                    return new Promise(function (resolve) {
                        w.guideMenu.open(kbm.ACTION_LABELS[act] + " · keys", items, function (it) { resolve(it) }, at, function () { resolve(null) }, { yLabel: "Remove" })
                    }).then(function (it) {
                        if (!it) return null
                        var idx = items.findIndex(function (x) { return x.label === it.label && x.code === it.code })
                        if (it.pressedY) return it.code ? set("kbUnbind", { action: act, code: it.code }).then(function () { return keyAct(act, idx) }) : keyAct(act, idx)
                        if (it.op === "add") {
                            return w.captureKey(kbm.ACTION_LABELS[act]).then(function (code) {
                                if (!code) return keyAct(act, idx)
                                var other = ""
                                kbm.ACTIONS.forEach(function (a) { if ((st.kb.bindings[a] || []).indexOf(code) >= 0) other = a })
                                var go = other && other !== act
                                    ? w.rawCall("__qt", ["keyLabels", [code]]).then(function (nm) {
                                        return w.pick((nm && nm[0] || code) + " is used for " + kbm.ACTION_LABELS[other], [{ label: "Use it for " + kbm.ACTION_LABELS[act] + " instead", v: true }, { label: "Cancel" }]).then(function (ok) { return Boolean(ok && ok.v) })
                                    })
                                    : Promise.resolve(true)
                                return go.then(function (yes) { return yes ? set("kbBind", { action: act, code: code }).then(function () { w.loadKb() }) : null }).then(function () { return keyAct(act, idx) })
                            })
                        }
                        if (it.code && idx > 1) return set("kbBind", { action: act, code: it.code }).then(function () { w.loadKb(); return keyAct(act, 1) })
                        return keyAct(act, idx)
                    })
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
                        else if (it.act) work = keyAct(it.act, 0)
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
    // Main noticed at start that the graphics card and this build don't match
    function offerGraphics(g) {
        if (w.menuUp() || gameOn) return w.setStatus("New graphics card? Settings > Update software can switch to the build made for it.")
        return w.pick("New graphics card?", [
            { label: "Switch to the " + buildName(g, g.need) + " build", sub: "Recommended", op: "go", ok: true },
            { label: "Not now", sub: "Settings > Update software has it too", op: "later" }
        ], 0, { body: "This machine has " + (g.cards.join(" + ") || "a different graphics card") + ", but Tessera is running the build for " + buildName(g, g.have) + ". The build made for this card gets the most out of it. Switching keeps your games, saves and settings." }).then(function (it) {
            if (!it || it.op !== "go") return null
            return graphicsSwitch(g, g.need)
        }).then(function (note) {
            if (!note) return null
            var staged = /Restart to finish/.test(note)
            return w.pick(staged ? "Ready" : "Graphics build", staged ? [{ label: "Restart now", op: "reboot", ok: true }, { label: "Later", op: "later" }] : [{ label: "OK" }], 0, { body: note }).then(function (x) {
                if (x && x.op === "reboot") return w.dev("update", "reboot").then(function (r) { if (r && !r.ok) w.setStatus(r.error, true) })
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
    function openInBrowser(url) { return w.openInBrowser(url) }
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

    // ------------------------------------------------------------------ PIN
    function askPin(title) { return w.ask(title, "", { digits: true, secret: true, max: 8 }) }
    function setPin(old) {
        return askPin("Choose a PIN (4 to 8 digits)").then(function (a) {
            if (a === null) return false
            if (!/^\d{4,8}$/.test(a)) { w.setStatus("Use 4 to 8 digits.", true); return false }
            return askPin("Enter it again").then(function (b) {
                if (b === null) return false
                if (a !== b) { w.setStatus("Those didn't match.", true); return false }
                return w.dev("settings", "pinSet", { pin: a, old: old }).then(function (r) {
                    w.setStatus(r.ok ? "PIN set." : r.error || "Couldn't set the PIN.", !r.ok)
                    return Boolean(r.ok)
                })
            })
        })
    }
    function pin() {
        if (w.menuUp()) return
        var st = { at: "pin", info: null }
        var loop = function () {
            return w.dev("settings", "pinStatus").then(function (info) {
                st.info = info
                var out = [{ key: "h:state", label: info.set ? "A PIN is set" : "No PIN yet", header: true }]
                if (!info.set) out.push({ key: "set", label: "Set a PIN", sub: "keeps Settings, adding and deleting behind a code", op: "set" })
                else {
                    out.push({ key: "change", label: "Change PIN", op: "change" })
                    out.push({ key: "remove", label: "Remove PIN", op: "remove" })
                    out.push({ key: "lock", label: "Lock now", sub: "ask for the PIN again right away", op: "lock" })
                    out.push({ key: "browser", label: "Also protect the browser", sub: info.browser ? "On" : "Off", op: "browser" })
                    out.push({ key: "xbox", label: "Allow Xbox games", sub: info.xbox ? "On. Starting one asks for the PIN" : "Off", op: "xbox" })
                }
                if (!info.set) out.push({ key: "xboxinfo", label: "Xbox games", sub: "Need a PIN: set one first", info: true })
                out.push({ key: "h:good", label: "Good to know", header: true })
                out.push({ key: "forgot", label: "Forgot it?", sub: "Opus, then run tessera-reset-pin (needs your login)", info: true })
                return w.pick("PIN", out, indexOfKey(out, st.at)).then(function (it) {
                    if (!it) return null
                    st.at = it.key
                    if (it.info) return loop()
                    var work = Promise.resolve()
                    if (it.op === "set") work = setPin()
                    else if (it.op === "change") work = askPin("Enter the current PIN").then(function (old) { if (old !== null) return setPin(old) })
                    else if (it.op === "remove") work = askPin("Enter the PIN to remove it").then(function (p) {
                        if (p === null) return
                        return w.dev("settings", "pinRemove", { pin: p }).then(function (r) { w.setStatus(r.ok ? (info.xbox ? "PIN removed. Xbox games are off." : "PIN removed.") : r.error || "Couldn't remove it.", !r.ok) })
                    })
                    else if (it.op === "lock") work = w.dev("settings", "pinLock").then(function () { w.setStatus("Locked.") })
                    else if (it.op === "xbox") work = w.dev("settings", "xboxEnabled", { value: !info.xbox }).then(function (r) {
                        if (r.needPin) return w.requirePin().then(function (ok) { return ok ? w.dev("settings", "xboxEnabled", { value: !info.xbox }) : r })
                        return r
                    }).then(function (r) { if (r && r.error) w.setStatus(r.error, true) })
                    else if (it.op === "browser") work = w.dev("settings", "pinBrowser", { value: !info.browser }).then(function (r) { if (r.error) w.setStatus(r.error, true) })
                    return work.then(loop)
                })
            })
        }
        loop().then(function () { w.refreshTileNotes(true); w.reloadPrefs() })
    }

    // ------------------------------------------------------------------ Profiles
    readonly property string profileOwn: "Their own controls and button layout, keyboard keys, Home and mosaics, Recently played, browser logins and theme. Games are shared. Press Y on Guest to choose what Guest may do."
    readonly property var guestLabels: [["games", "Play games"], ["apps", "Open apps"], ["browser", "Use the browser"], ["pages", "Change Home and the mosaics"], ["look", "Change the look (themes)"], ["controls", "Change the controls"]]
    function noBusy(r, def) { return r && typeof r === "object" ? r : { ok: false, error: def || "Something went wrong." } }
    // their PIN (or the admin PIN), asked until it's right, cancelled, or too many tries
    function profilePin(name, attempt) {
        var tries = 0
        var again = function () {
            if (tries++ >= 5) return Promise.resolve(null)
            return askPin(name + "'s PIN").then(function (pin) {
                if (pin === null) return null
                return attempt(pin).then(function (r) {
                    if (r && r.ok) return r
                    w.setStatus((r && r.error) || "That isn't the PIN.", true)
                    if (!r || r.wait) return null
                    return again()
                })
            })
        }
        return again()
    }
    function switchProfile(id, name) {
        return w.leaveBrowser().then(function () { return w.dev("profiles", "use", { id: id }) }).then(function (r) {
            if (r.needProfilePin) return profilePin(r.name || name, function (pin) { return w.dev("profiles", "use", { id: id, pin: pin }) })
            if (r.needPin && !r.ok) return w.requirePin("Enter the admin PIN to switch to Guest").then(function (ok) { return ok ? w.dev("profiles", "use", { id: id }) : r })
            return r
        }).then(function (r) {
            if (!r || !r.ok) { w.setStatus((r && r.error) || "Couldn't switch.", true); return null }
            if (r.view) w.applyView(r.view)       // their pages, controls, keys and theme
            else if (r.theme) w.applyTheme(r.theme)
            w.goHome()
            w.setStatus(id ? "Hi, " + name + "!" : "Playing as Guest.")
            return r
        })
    }
    function addProfile() {
        return w.ask("Name this profile", "", { max: 24 }).then(function (name) {
            if (name === null) return null
            if (!name.trim()) { w.setStatus("Give them a name.", true); return null }
            return w.pick("Start " + name.trim() + " with", [
                { label: "A copy of Guest's setup", sub: "Guest's Home, mosaics and controls, to change from there", op: "copy" },
                { label: "A fresh start", sub: "An empty Home and the usual controls", op: "fresh" }
            ]).then(function (start) {
                if (!start) return null
                var go = function () { return w.dev("profiles", "add", { name: name, start: start.op }) }
                return go().then(function (r) { return r.needPin ? w.requirePin().then(function (ok) { return ok ? go() : null }) : r }).then(function (r) {
                    if (!r) return null
                    w.setStatus(r.ok ? "Added " + name.trim() + "." : r.error || "Couldn't add that.", !r.ok)
                    return r.ok ? r.id : null
                })
            })
        })
    }
    function guestOptions() {
        var st = { at: "" }
        var loop = function () {
            return w.dev("profiles", "list").then(function (pr) {
                var g = pr.guest || {}
                var items = [{ key: "h:may", label: "Guest may", header: true }]
                guestLabels.forEach(function (x) { items.push({ key: x[0], label: x[1], sub: g[x[0]] ? "Allowed" : "Not allowed" }) })
                items.push({ key: "show", label: "Offer Guest in \"Who's playing?\"", sub: g.show !== false ? "Yes" : "No: only the admin can switch to Guest" })
                return w.pick("Guest", items, indexOfKey(items, st.at || "games"), { body: (pr.profiles || []).length ? "Guest is Tessera with nobody's profile. It only does what you allow here; the admin PIN allows anything else on the spot." : "These apply once someone has a profile. Until then Tessera is all yours." }).then(function (it) {
                    if (!it) return null
                    st.at = it.key
                    var value = !(it.key === "show" ? g.show !== false : g[it.key])
                    var set = function () { return w.dev("profiles", "guestSet", { key: it.key, value: value }) }
                    return set().then(function (r) {
                        if (r.needPin) return w.requirePin("Enter the admin PIN").then(function (ok) { return ok ? set() : null })
                        return r
                    }).then(function (r) { if (r && !r.ok && r.error) w.setStatus(r.error, true) }).then(loop)
                })
            })
        }
        return loop()
    }
    function profileOptions(id, name) {
        return w.dev("profiles", "list").then(function (info) {
            var me = (info.profiles || []).filter(function (x) { return x.id === id })[0] || {}
            var items = [
                { label: "Switch to them", op: "use" },
                { label: "Rename…", op: "rename" },
                { label: "Their theme…", sub: "what they pick while playing is kept too", op: "theme" },
                { label: "PIN", header: true }
            ]
            if (me.admin) {
                items.push({ label: "Logs in with", sub: me.login === "own" ? "A PIN of their own (the admin PIN is asked for admin things)" : "The admin PIN", op: "adminLogin" })
                if (me.login === "own") items.push({ label: "Change their login PIN…", op: "pin" })
            } else {
                items.push({ label: me.ownPin ? "Change their PIN…" : "Give them a PIN…", sub: me.ownPin ? "" : "to log in as them and open their own things; never admin rights", op: "pin" })
                if (me.ownPin) items.push({ label: "Remove their PIN", op: "nopin" })
            }
            if (me.locked) items.push({ label: "Their PIN also opens their browser", sub: me.browserLock ? "On: asked again after a few minutes" : "Off", op: "browserLock" })
            if (info.adminPin) items.push({ label: me.admin ? "This is the admin profile" : "Make this the admin profile", sub: me.admin ? "" : "their login can be the admin PIN", op: "admin", info: Boolean(me.admin) })
            items.push({ label: "Remove this profile…", sub: "their pages, controls and browser logins go with it", op: "remove" })
            return w.pick(name, items).then(function (it) {
                if (!it || it.info) return null
                // PIN changes: by them (logged in, PIN fresh) or with the admin PIN
                var asOwnerOrAdmin = function (op, payload) {
                    return w.dev("profiles", op, payload).then(function (r) {
                        if (!r.needPin) return r
                        return w.requirePin("Enter the admin PIN").then(function (ok) { return ok ? w.dev("profiles", op, payload) : null })
                    })
                }
                var newPin = function (title) {
                    return askPin(title).then(function (a) {
                        if (a === null) return null
                        if (!/^\d{4,8}$/.test(a)) { w.setStatus("Use 4 to 8 digits.", true); return null }
                        return askPin("Enter it again").then(function (b) {
                            if (b === null) return null
                            if (a !== b) { w.setStatus("Those didn't match.", true); return null }
                            return a
                        })
                    })
                }
                var say = function (r, good) { if (r) w.setStatus(r.ok ? good : r.error || "That did not work.", !r.ok) }
                if (it.op === "pin") return newPin("A PIN for " + name + " (4 to 8 digits)").then(function (a) { if (a !== null) return asOwnerOrAdmin("setPin", { id: id, pin: a }).then(function (r) { say(r, name + " has a PIN now.") }) })
                if (it.op === "nopin") return asOwnerOrAdmin("setPin", { id: id, pin: null }).then(function (r) { say(r, name + "'s PIN is removed.") })
                if (it.op === "browserLock") return asOwnerOrAdmin("browserLock", { id: id, on: !me.browserLock }).then(function (r) { if (r && !r.ok) w.setStatus(r.error, true) })
                if (it.op === "admin") return asOwnerOrAdmin("setAdmin", { id: id }).then(function (r) { say(r, name + " is the admin profile. They log in with the admin PIN.") })
                if (it.op === "adminLogin") {
                    return w.pick(name + " logs in with", [
                        { label: "The admin PIN", sub: "one PIN for logging in and for admin things", v: "admin" },
                        { label: "A PIN of their own", sub: "for logging in and their own things; the admin PIN is asked for admin things", v: "own" }
                    ], me.login === "own" ? 1 : 0).then(function (how) {
                        if (!how || how.v === me.login) return
                        if (how.v === "own") return newPin(name + "'s login PIN (not the admin PIN)").then(function (a) { if (a !== null) return asOwnerOrAdmin("setPin", { id: id, pin: a }).then(function (r) { say(r, name + " logs in with their own PIN now.") }) })
                        return asOwnerOrAdmin("adminLogin", { login: "admin" }).then(function (r) { say(r, name + " logs in with the admin PIN.") })
                    })
                }
                if (it.op === "use") return switchProfile(id, name)
                if (it.op === "rename") return w.ask("Rename this profile", name, { max: 24 }).then(function (nn) {
                    if (nn === null || !nn.trim()) return
                    var go = function () { return w.dev("profiles", "rename", { id: id, name: nn }) }
                    return go().then(function (r) { return r.needPin ? w.requirePin().then(function (ok) { return ok ? go() : null }) : r }).then(function (r) { if (r) w.setStatus(r.ok ? "Renamed." : r.error || "Couldn't rename that.", !r.ok) })
                })
                if (it.op === "theme") return w.dev("settings", "themeGet").then(function (t) {
                    return w.pick("Theme for " + name, (t.themes || []).map(function (x) { return { label: x.name, sub: x.dup ? "#" + x.id : x.author, id: x.id } })).then(function (choice) {
                        if (!choice) return
                        return w.dev("profiles", "setTheme", { id: id, themeId: choice.id }).then(function (r) {
                            if (r.ok && r.theme) w.applyTheme(r.theme)
                            w.setStatus(r.ok ? name + " now uses " + choice.label + "." : r.error || "Couldn't set that.", !r.ok)
                        })
                    })
                })
                if (it.op === "remove") return w.confirmYes("Remove “" + name + "”? Their own Home and mosaics, controls, Recently played and browser logins are deleted. Games stay installed.", "Remove").then(function (yes) {
                    if (!yes) return
                    var go = function () { return w.dev("profiles", "remove", { id: id }) }
                    return go().then(function (r) { return r.needPin ? w.requirePin().then(function (ok) { return ok ? go() : null }) : r }).then(function (r) {
                        if (r && r.ok && r.view) w.applyView(r.view)
                        if (r) w.setStatus(r.ok ? "Removed " + name + "." : r.error || "Couldn't remove that.", !r.ok)
                    })
                })
            })
        })
    }
    function profiles() {
        if (w.menuUp()) return
        var st = { at: "" }
        var loop = function () {
            return Promise.all([w.dev("profiles", "list"), w.dev("settings", "themeGet")]).then(function (res) {
                var pr = res[0], t = res[1], list = pr.profiles || []
                var themeName = function (id) { var x = (t.themes || []).filter(function (th) { return th.id === id })[0]; return x ? x.name : id }
                var items = [{ key: "h:who", label: "Who's playing", header: true }]
                list.forEach(function (p) {
                    items.push({ key: "p:" + p.id, label: p.name, sub: [p.id === pr.active ? "Playing now" : "Switch to them", p.admin ? "Admin" : "", p.locked ? "PIN" : "", p.themeId ? themeName(p.themeId) : ""].filter(Boolean).join(" · "), id: p.id, who: true })
                })
                items.push({ key: "guest", label: "Guest", sub: [pr.active ? "Switch to Guest" : "Playing now", "nobody's profile", pr.guest && pr.guest.show === false ? "hidden" : ""].filter(Boolean).join(" · "), id: null, who: true, guestRow: true })
                items.push({ key: "add", label: "Add a profile…", op: "add" })
                if (list.length) items.push({ key: "ask", label: "Ask who's playing when Tessera starts", sub: pr.ask ? "On" : "Off", op: "ask" })
                var body = "Each profile has " + profileOwn.charAt(0).toLowerCase() + profileOwn.slice(1)
                return w.pick("Profiles", items, indexOfKey(items, st.at || (list.length ? "p:" + list[0].id : "guest")), { body: body, yLabel: "Options" }).then(function (it) {
                    if (!it) return null
                    st.at = it.key
                    var work = Promise.resolve()
                    if (it.pressedY) {
                        if (it.guestRow) work = guestOptions()
                        else if (it.id) work = profileOptions(it.id, it.label)
                    } else if (it.who) { if (it.id !== pr.active) work = switchProfile(it.id, it.label) }
                    else if (it.op === "add") {
                        work = addProfile().then(function (id) {
                            if (!id) return
                            return w.confirmYes("Switch to them now?", "Switch").then(function (yes) {
                                if (!yes) return
                                return w.dev("profiles", "list").then(function (np) {
                                    var me = (np.profiles || []).filter(function (x) { return x.id === id })[0]
                                    return switchProfile(id, me ? me.name : "")
                                })
                            })
                        })
                    } else if (it.op === "ask") work = w.dev("profiles", "ask", { on: !pr.ask })
                    return work.then(loop)
                })
            })
        }
        loop().then(function () { w.reloadPrefs() })
    }

    // ------------------------------------------------------------------ Storage
    function fmtBytes(n) {
        if (n === null || n === undefined || isNaN(n)) return "–"
        var u = ["B", "KB", "MB", "GB", "TB"], i = 0, v = n
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
        return (i >= 3 ? v.toFixed(v >= 100 ? 0 : 1) : Math.round(v)) + " " + u[i]
    }
    function lib(op, p) {
        return w.dev("library", op, p).then(function (r) {
            if (r && r.view) w.applyView(r.view)
            if (r) w.setStatus(r.ok ? r.message : r.error, !r.ok)
            return r || { ok: false }
        })
    }
    function takePrefs(r) {
        if (r && r.prefs) w.applyView(Object.assign({}, w.view, { prefs: Object.assign({}, w.view.prefs, r.prefs) }))
    }
    function frac(n, total) { return total > 0 ? Math.max(0, n) / total : 0 }
    function driveRow(d, measured) {
        var other = Math.max(0, d.used - d.games - d.tessera)
        var low = !d.muted && (d.free < 10 * 1073741824 || d.free / d.total < 0.1)
        var parts = measured
            ? [{ c: "g", n: d.games, t: "Games & apps" }, { c: "t", n: d.tessera, t: "Tessera" }, { c: "o", n: other, t: "Other" }, { c: "f", n: d.free, t: "Free" }]
            : [{ c: "o", n: d.used, t: "Used" }, { c: "f", n: d.free, t: "Free" }]
        var tags = [d.system ? "Main storage" : d.external ? "Plugged in" : "", d.library ? "Game library" : "", low ? "Low space" : "", d.muted ? "Warnings off" : "", measured ? "" : "Measuring…"].filter(Boolean)
        return {
            key: "d:" + d.key, label: d.name, sub: fmtBytes(d.free) + " free of " + fmtBytes(d.total), op: "drive", drive: d, danger: false,
            segs: parts.filter(function (x) { return x.n > 0 }).map(function (x) { return { c: x.c, frac: frac(x.n, d.total) } }),
            legend: parts.filter(function (x) { return x.n > 0 || x.c === "f" }).map(function (x) { return x.t + " " + fmtBytes(x.n) }).join("  ·  ") + (tags.length ? "    " + tags.join(" · ") : "")
        }
    }
    function storageItems(ov, measured, hint) {
        var items = [{ key: "h:drives", label: "Drives", header: true }]
        ov.drives.forEach(function (d) { items.push(driveRow(d, measured)) })
        items.push({ key: "h:games", label: "Games & apps", header: true })
        items.push({ key: "manage", label: "Manage games by size", sub: "Biggest first", op: "manage" })
        items.push({ key: "scan", label: "Scan for games", sub: "Look for new games now", op: "scan" })
        items.push({ key: "add", label: "Add a game library", sub: "Point Tessera at a folder of games", op: "add" })
        items.push({ key: "roots", label: "Library folders", sub: "See or stop scanning", op: "roots" })
        items.push({ key: "install", label: "New games install to", sub: ov.install || "Tessera folder", op: "install" })
        items.push({ key: "h:vault", label: "Tessera folder", header: true })
        var parts = (ov.vault.parts || []).filter(function (x) { return x.bytes > 0 }).sort(function (a, b) { return b.bytes - a.bytes })
        var vrow = { key: "vault", label: ov.vault.path, sub: measured ? fmtBytes(ov.vault.bytes) : "", op: "vault" }
        if (parts.length) {
            vrow.segs = parts.map(function (x, i) { return { c: i === 0 ? "g" : i === 1 ? "t" : "o", frac: frac(x.bytes, ov.vault.bytes) } })
            vrow.legend = parts.map(function (x) { return x.name + " " + fmtBytes(x.bytes) }).join("  ·  ")
        } else vrow.legend = ""
        if (!parts.length) vrow.sub = measured ? "Empty so far" : "Measuring…"
        items.push(vrow)
        items.push({ key: "downloads", label: "Downloads", sub: "See or clear what you downloaded", op: "downloads" })
        items.push({ key: "h:house", label: "Housekeeping", header: true })
        items.push({ key: "clean", label: "Clean up", sub: hint || "Broken and duplicate entries, old logs", op: "clean" })
        items.push({ key: "backup", label: "Back up my setup", sub: "Layout, library and settings", op: "backup" })
        items.push({ key: "restore", label: "Restore a backup", sub: "Put a saved setup back", op: "restore" })
        items.push({ key: "drives", label: "Name your drives", sub: "Friendly names for disks", op: "drives" })
        items.push({ key: "hidden", label: "Hidden drives", sub: ov.hiddenCount ? ov.hiddenCount + " hidden" : "None", op: "hidden" })
        return items
    }
    function storage() {
        if (w.menuUp()) return
        var st = { at: "games" }
        var loop = function () {
            return w.dev("storage", "overview", {}).then(function (ov) {
                if (!ov || !ov.ok) { w.setStatus((ov && ov.error) || "Couldn't read your drives.", true); return null }
                st.ov = ov; st.measured = Boolean(ov.measured); st.hint = ""
                return w.liveList(st, {
                    title: "Storage", every: 1200,
                    items: function (s) { return storageItems(s.ov, s.measured, s.hint) },
                    body: function () { return "" },
                    reload: function (s) {      // measuring folders takes a moment on a big library: drives first, the rest after
                        if (s.measured) return Promise.resolve()
                        return w.dev("storage", "overview", { measure: true }).then(function (r) {
                            if (!r || !r.ok) return
                            s.ov = r; s.measured = true
                            return w.dev("storage", "cleanScan", {}).then(function (sc) {
                                var n = sc && sc.ok ? sc.broken + sc.dupes + sc.orphans : 0
                                s.hint = n ? n + " thing" + (n === 1 ? "" : "s") + " to tidy" : "Nothing to tidy right now"
                            })
                        })
                    }
                }).then(function (it) {
                    if (!it) return null
                    var again = function () { return loop() }
                    switch (it.op) {
                    case "drive": return driveMenu(it.drive).then(again)
                    case "manage": return manage().then(again)
                    case "scan": return scan().then(again)
                    case "add": return browse("addRoot").then(again)
                    case "roots": return roots().then(again)
                    case "install": return installTo().then(again)
                    case "vault": w.setStatus("Your games, apps, themes and downloads live in " + (st.ov.vault.path || "~/Tessera") + "."); return again()
                    case "downloads": return downloads().then(again)
                    case "clean": return clean().then(again)
                    case "backup": return w.requirePin().then(function (ok) { return ok ? browse("backupTo") : null }).then(again)
                    case "restore": return restore().then(again)
                    case "drives": return drives().then(again)
                    case "hidden": return hidden().then(again)
                    }
                    return again()
                })
            })
        }
        loop()
    }
    function driveMenu(d) {
        var items = []
        if (!d.library && !d.system) items.push({ label: "Use for games", sub: "Make a Games folder and scan it", op: "use" })
        if (d.ejectable) items.push({ label: "Eject safely", sub: "Then it can be unplugged", op: "eject" })
        items.push({ label: "Name this drive…", op: "name" })
        items.push({ label: "Low space warning", sub: d.muted ? "Off · Select to turn on" : "On · Select to turn off", op: "mute" })
        items.push({ label: "Hide this drive", sub: "Brings back from Hidden drives", op: "hide" })
        return w.pick(d.name + " · " + fmtBytes(d.free) + " free of " + fmtBytes(d.total), items).then(function (it) {
            if (!it) return null
            return w.requirePin().then(function (ok) {
                if (!ok) return null
                if (it.op === "name") return renameDrive(d.key, "").then(function (y) { if (y) w.setStatus("Renamed.") })
                var call = it.op === "mute" ? w.dev("storage", "muteDrive", { key: d.key, muted: !d.muted })
                    : it.op === "hide" ? w.dev("storage", "hideDrive", { key: d.key, hidden: true })
                    : w.dev("storage", it.op === "use" ? "useDrive" : "eject", { key: d.key })
                return call.then(function (r) {
                    if (!r) return null
                    if (r.prefs) { takePrefs(r); r.message = it.op === "hide" ? d.name + " is hidden." : d.muted ? "Low space warning is on for " + d.name + "." : "Low space warning is off for " + d.name + "." }
                    w.setStatus(r.message || r.error, !r.ok)
                    if (r.ok && it.op === "use") return scan()
                })
            })
        })
    }
    function hidden() {
        return w.dev("storage", "hiddenDrives", {}).then(function (r) {
            var items = (r.drives || []).length
                ? r.drives.map(function (d) { return { label: d.name, sub: fmtBytes(d.total) + " · Select to show again", key: d.key } })
                : [{ label: "No hidden drives", sub: "Hide one from its menu in Storage", header: true }]
            return w.pick("Hidden drives", items, 0).then(function (it) {
                if (!it || !it.key) return null
                return w.requirePin().then(function (ok) {
                    if (!ok) return
                    return w.dev("storage", "hideDrive", { key: it.key, hidden: false }).then(function (u) { takePrefs(u); w.setStatus(it.label + " is showing again.") })
                }).then(hidden)
            })
        })
    }
    function manage() {
        var build = function (res, measured) {
            var total = res.games.reduce(function (a, g) { return a + (g.bytes || 0) }, 0)
            var max = Math.max.apply(null, [1].concat(res.games.map(function (g) { return g.bytes || 0 })))
            var items = [{ key: "h:top", label: measured ? "Biggest first · " + fmtBytes(total) + " in all" : "Biggest first · measuring…", header: true }]
            if (!res.games.length) items.push({ key: "h:none", label: "No games or apps yet", header: true })
            res.games.forEach(function (g) {
                var row = { key: "g:" + g.id, id: g.id, game: g, label: g.title,
                    sub: g.offline ? (g.offline === "drive" ? "Drive not connected" : "Files missing") : g.bytes === null ? "Measuring…" : fmtBytes(g.bytes) }
                if (!g.offline && g.bytes !== null) {
                    row.segs = [{ c: g.deletable ? "g" : "o", frac: frac(g.bytes, max) }, { c: "f", frac: 1 - frac(g.bytes, max) }]
                    row.legend = g.drive || ""
                }
                items.push(row)
            })
            if (res.games.some(function (g) { return g.bytes })) items.push({ key: "h:note", label: "Bright bars: files you can delete here  ·  Grey: outside your Tessera folder", header: true })
            return items
        }
        return w.dev("storage", "games", {}).then(function (r) {
            if (!r || !r.ok) return null
            var st = { res: r, measured: false, at: "" }
            return w.liveList(st, {
                title: "Manage games by size", every: 1200,
                items: function (s) { return build(s.res, s.measured) },
                body: function () { return "" },
                reload: function (s) {
                    if (s.measured) return Promise.resolve()
                    return w.dev("storage", "games", { measure: true }).then(function (res) { if (res && res.ok) { s.res = res; s.measured = true } })
                }
            }).then(function (it) {
                if (!it) return null
                if (!it.game) return manage()
                var g = it.game, menu = []
                if (g.deletable) menu.push({ label: "Delete the files…", sub: g.bytes ? "Frees " + fmtBytes(g.bytes) : "", op: "files" })
                menu.push({ label: "Remove from library…", sub: "Keeps the files", op: "remove" })
                return w.pick(g.title, menu).then(function (pk) {
                    if (!pk) return
                    return w.requirePin().then(function (ok) {
                        if (!ok) return
                        if (pk.op === "files") return w.confirmYes("Delete “" + g.title + "” and its files from your Tessera folder? This can't be undone.", "Delete files").then(function (y) { if (y) return lib("deleteFiles", { id: g.id }) })
                        return w.confirmYes("Remove “" + g.title + "” from your library?", "Remove (files are kept)").then(function (y) { if (y) return lib("deleteItem", { id: g.id }) })
                    })
                }).then(manage)
            })
        })
    }
    function installTo() {
        return w.dev("storage", "installRoots", {}).then(function (r) {
            var items = r.roots.map(function (x, i) { return { label: x.name, sub: [x.current ? "✓ in use" : "", x.free !== null ? fmtBytes(x.free) + " free" : ""].filter(Boolean).join("  ·  "), i: i } })
            var cur = 0
            r.roots.forEach(function (x, i) { if (x.current) cur = i })
            return w.pick("New games install to", items, cur).then(function (it) {
                if (!it) return null
                return w.requirePin().then(function (ok) {
                    if (!ok) return
                    return w.dev("storage", "setInstallRoot", { index: it.i }).then(function (res) { w.setStatus(res.message || res.error, !res.ok) })
                })
            })
        })
    }
    function downloads() {
        return w.dev("storage", "downloads", {}).then(function (d) {
            var items = [{ label: d.count ? d.count + " item" + (d.count === 1 ? "" : "s") + " · " + fmtBytes(d.bytes) : "Nothing downloaded", sub: d.path, header: true }]
            if (d.count) items.push({ label: "Clear Downloads…", sub: "Deletes what is inside, keeps the folder", op: "clear" })
            return w.pick("Downloads", items, 1).then(function (it) {
                if (!it || it.op !== "clear") return null
                return w.requirePin().then(function (ok) {
                    if (!ok) return null
                    return w.confirmYes("Delete everything in Downloads (" + fmtBytes(d.bytes) + ")? This can't be undone.", "Clear Downloads").then(function (y) {
                        if (!y) return null
                        return w.dev("storage", "clearDownloads", {}).then(function (r) { w.setStatus(r.message || r.error, !r.ok) })
                    })
                })
            })
        })
    }
    function clean() {
        return w.dev("storage", "cleanScan", {}).then(function (s) {
            var rows = [
                { what: "broken", label: "Broken entries", sub: s.broken ? s.broken + " whose files are gone" : "None", n: s.broken },
                { what: "dupes", label: "Duplicate entries", sub: s.dupes ? s.dupes + " pointing at the same game" : "None", n: s.dupes },
                { what: "orphans", label: "Stray tiles", sub: s.orphans ? s.orphans + " left over in mosaics" : "None", n: s.orphans },
                { what: "logs", label: "Old logs", sub: s.logFiles > 1 ? s.logFiles + " files · " + fmtBytes(s.logBytes) : "None", n: s.logFiles > 1 ? s.logFiles : 0 }
            ]
            var on = {}
            rows.forEach(function (r) { on[r.what] = r.n > 0 })
            var st = { at: "" }
            var loop = function () {
                var items = [{ key: "h", label: "Games on an unplugged drive are not touched", header: true }]
                rows.forEach(function (r) { items.push({ key: r.what, what: r.what, label: r.label, sub: (on[r.what] ? "✓ " : r.n ? "Skip · " : "") + r.sub, n: r.n }) })
                items.push({ key: "go", label: "Clean up selected", op: "go", ok: true })
                return w.pick("Clean up", items, indexOfKey(items, st.at || "go")).then(function (it) {
                    if (!it) return null
                    st.at = it.key
                    if (it.what) { if (it.n) on[it.what] = !on[it.what]; return loop() }
                    var what = rows.filter(function (r) { return on[r.what] }).map(function (r) { return r.what })
                    if (!what.length) { w.setStatus("Nothing selected."); return loop() }
                    return w.requirePin().then(function (ok) {
                        if (!ok) return loop()
                        return w.dev("storage", "cleanRun", { what: what }).then(function (r) {
                            if (r.ok) return w.dev("library", "refresh", {}).then(function (v) { if (v && v.view) w.applyView(v.view); w.setStatus(r.message) })
                            w.setStatus(r.message || r.error, !r.ok)
                        })
                    })
                })
            }
            return loop()
        })
    }
    function restore() {
        return w.requirePin().then(function (ok) {
            if (!ok) return null
            return w.confirmYes("Restore a backup? It replaces your layout, library and settings. A copy of what you have now is kept.", "Choose a backup folder").then(function (y) { return y ? browse("restoreFrom") : null })
        })
    }
    // Name a drive, in your words
    function renameDrive(key, current) {
        return w.ask("Name this drive (empty = automatic name)", current || "").then(function (name) {
            if (name === null) return false
            return w.dev("settings", "driveName", { key: key, name: name }).then(function () { return true })
        })
    }
    function drives() {
        var st = { at: "" }
        var loop = function () {
            return w.dev("settings", "drives").then(function (r) {
                var items = (r.drives || []).map(function (d) { return { key: d.key, label: d.name, sub: d.tech, custom: d.custom } })
                if (!items.length) items.push({ label: "No extra drives found", sub: "Plug one in and open this again", header: true })
                return w.pick("Your drives · Select to rename", items, indexOfKey(items, st.at)).then(function (it) {
                    if (!it) return null
                    if (!it.key) return loop()
                    st.at = it.key
                    return renameDrive(it.key, it.custom ? it.label : "").then(loop)
                })
            })
        }
        return loop()
    }
    function roots() {
        return w.dev("settings", "get").then(function (r) {
            var items = [{ label: "+  Add a folder…", op: "add" }, { label: "Name your drives…", op: "drives" }]
            r.roots.forEach(function (p, i) { items.push({ label: p.name, sub: p.tech || "Select to remove", op: "rm", i: i }) })
            return w.pick("Library folders (scanned for games)", items).then(function (it) {
                if (!it) return null
                if (it.op === "add") return browse("addRoot").then(roots)
                if (it.op === "drives") return drives().then(roots)
                return w.confirmYes("Stop scanning " + it.label + "?", "Remove from list (files are not touched)").then(function (y) {
                    if (!y) return
                    return w.dev("settings", "removeRoot", { index: it.i })
                }).then(roots)
            })
        })
    }
    // Look for new games, then pick which to add
    function scan(into) {
        w.setStatus("Scanning your library folders…")
        return w.dev("scan", "run").then(function (r) {
            if (!r || !r.found) { w.setStatus("Couldn't scan.", true); return null }
            if (!r.found.length) return w.setStatus(r.notes || "No new games found. Heroic, Lutris and installed games are checked automatically; add library folders for Steam and PS5 games.", Boolean(r.notes))
            w.setStatus(r.notes || "", Boolean(r.notes))
            var on = {}
            r.found.forEach(function (f) { on[f.cid] = !f.optional })
            var st = { at: "" }
            var loop = function () {
                var items = [{ key: "go", label: "Add selected games", op: "go", ok: true }]
                r.found.forEach(function (f) { items.push({ key: "c:" + f.cid, cid: f.cid, label: f.title, sub: (on[f.cid] ? "✓ Adding · " : "Skipping · ") + f.source }) })
                return w.pick("Found " + r.found.length + " new game" + (r.found.length === 1 ? "" : "s"), items, indexOfKey(items, st.at || "go")).then(function (it) {
                    if (!it) { w.setStatus("Nothing added."); return null }
                    st.at = it.key
                    if (it.cid !== undefined) { on[it.cid] = !on[it.cid]; return loop() }
                    var cids = r.found.filter(function (f) { return on[f.cid] }).map(function (f) { return f.cid })
                    return w.dev("scan", "add", { cids: cids, into: into }).then(function (res) {
                        if (res.view) w.applyView(res.view)
                        w.setStatus(res.ok ? res.message : res.error, !res.ok)
                    })
                })
            }
            return loop()
        })
    }
    // Browse folders through main; we only ever say "enter entry N"
    function browse(purpose, into, item) {
        return w.dev("browse", "start", { purpose: purpose, into: into, item: item }).then(function (r) { return browseShow(r, purpose) })
    }
    function browseShow(r, purpose) {
        if (!r || r.error) { w.setStatus((r && r.error) || "Could not open that.", true); return Promise.resolve(null) }
        var items = []
        if (r.canUp) items.push({ key: "up", label: "⬆  Up one level", op: "up" })
        if (r.canChooseHere) items.push({ key: "here", label: purpose === "backupTo" ? "✔  Save the backup in this folder" : purpose === "restoreFrom" ? "✔  Restore from this folder" : "✔  Use this folder", op: "here" })
        r.entries.forEach(function (e, i) { items.push({ key: "e:" + i, label: e.isDir && !r.renamable ? e.name + "/" : e.name, sub: e.sub, drv: e.key, op: e.isDir ? "enter" : "choose", i: i }) })
        var index = r.canUp ? (r.entries.length ? 1 + Number(Boolean(r.canChooseHere)) : 0) : 0
        var next = function (res) { return browseShow(res, purpose) }
        return w.pick(r.crumb + (r.truncated ? "  (first 500 shown)" : ""), items, index, { yLabel: r.renamable ? "Rename" : "" }).then(function (it) {
            if (!it) {
                if (r.canUp) return w.dev("browse", "up").then(next)
                return w.dev("browse", "close").then(function () { return null })
            }
            if (it.pressedY) {
                if (!it.drv) return browseShow(r, purpose)
                return renameDrive(it.drv, "").then(function () { return w.dev("browse", "refresh") }).then(next)
            }
            if (it.op === "up") return w.dev("browse", "up").then(next)
            if (it.op === "enter") return w.dev("browse", "enter", { index: it.i }).then(next)
            return w.dev("browse", "choose", { index: it.op === "here" ? -1 : it.i }).then(function (res) {
                if (res.error) { w.setStatus(res.error, true); return browseShow(r, purpose) }
                if (res.view) w.applyView(res.view)
                if (res.theme) w.applyTheme(res.theme)
                w.setStatus(res.message)
                return res
            })
        })
    }

    // ------------------------------------------------------------------ Add-ons
    function inert(label, sub) { return { label: label, sub: sub, info: true } }
    function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s") }
    // the shards request; the PIN only if main says it needs one
    function shardsCall(op, p) {
        return w.dev("shards", op, p).then(function (r) {
            if (r && r.needPin) return w.requirePin().then(function (ok) { return ok ? w.dev("shards", op, p) : null })
            return r
        })
    }
    function addonsCall(op, p) {
        return w.dev("addons", op, p).then(function (r) {
            if (r && r.needPin) return w.requirePin().then(function (ok) { return ok ? w.dev("addons", op, p) : null })
            return r
        })
    }
    function addons() {
        if (w.menuUp()) return
        var st = { view: "top", op: "list", at: "" }
        var loop = function () {
            return w.dev("addons", st.op).then(function (info) {
                st.op = "list"
                if (!info || !info.widgets) { w.setStatus("Couldn't read your add-ons.", true); return null }
                var items, title, body = ""
                var v = st.view
                if (v === "top") {
                    title = "Add-ons"
                    items = [
                        { key: "h:inst", label: "Installed", header: true },
                        { key: "widgets", label: "Widgets", sub: info.widgets.length + " installed" + (info.rejected.length ? " · " + plural(info.rejected.length, "problem") : ""), view: "widgets" },
                        { key: "themes", label: "Themes", sub: info.themes.length ? info.themes.length + " installed" : "none installed", view: "themes" },
                        { key: "packs", label: "Shards", sub: info.packs.length + " installed" + (info.rejectedPacks.length ? " · " + plural(info.rejectedPacks.length, "problem") : ""), view: "packs" },
                        { key: "builtin", label: "Built in", sub: info.presets.map(function (x) { return x.name }).join(", "), view: "builtin" },
                        { key: "h:more", label: "Get more", header: true },
                        { key: "store", label: "Get add-ons", sub: "from the Tessera add-on list (needs internet)", op: "store" },
                        { key: "folders", label: "Where to put downloads", sub: "widgets, themes, shards, art, fonts, sounds", view: "folders" },
                        { key: "reload", label: "↻  Reload add-ons", op: "reload" }
                    ]
                } else if (v === "widgets") {
                    title = "Add-ons · Widgets (Select removes one)"
                    items = info.widgets.map(function (x) { return { key: "w:" + x.id, label: x.name, sub: [x.author, x.size.w + " × " + x.size.h + (x.resizable ? " · resizable" : "")].filter(Boolean).join(" · "), rm: { dir: "widgets", id: x.id } } })
                    info.rejected.forEach(function (x) { items.push(Object.assign(inert("⚠  " + x.id, x.reason), { key: "x:" + x.id })) })
                    if (!items.length) items.push(inert("No widgets installed yet", info.dirs.widgets))
                } else if (v === "themes") {
                    title = "Add-ons · Themes (Select to switch)"
                    items = info.allThemes.map(function (t) { return { key: "t:" + t.id, label: t.name, sub: t.builtin ? "built in" : (t.author || ""), theme: t.id } })
                    if (info.themes.length) items.push({ key: "rmthemes", label: "Remove a theme…", view: "rmthemes" })
                    items.push(Object.assign(inert("Theme packs go in", info.dirs.themes), { key: "dir" }))
                } else if (v === "rmthemes") {
                    title = "Add-ons · Remove a theme (Select removes it)"
                    items = info.themes.map(function (t) { return { key: "t:" + t.id, label: t.name, sub: t.author || "", rm: { dir: "themes", id: t.id } } })
                    if (!items.length) items.push(inert("No downloaded themes", ""))
                } else if (v === "packs") {
                    title = "Add-ons · Shards"
                    items = info.packs.map(function (p) { return { key: "p:" + p.id, label: p.name, sub: [p.running ? "On" : p.enabled ? "On, but not running" : "Off", p.official ? "Official" : "Unverified", p.author, p.version].filter(Boolean).join(" · "), shard: p.id } })
                    info.rejectedPacks.forEach(function (x) { items.push(Object.assign(inert("⚠  " + x.id, x.reason), { key: "x:" + x.id })) })
                    items.push({ key: "safety", label: "Shard safety…", view: "packsSettings" })
                    if (!info.packs.length && !info.rejectedPacks.length) items.push(Object.assign(inert("No shards installed yet", info.dirs.packs), { key: "none" }))
                } else if (v === "packsSettings") {
                    title = "Add-ons · Shard safety"
                    body = "What a shard is: A shard is real code with Tessera's own access to this device: your files, your hardware, your settings. It is not sandboxed the way a widget is, and nothing here checks that it's safe, only whose it is.\n\nOfficial: Signed by the Tessera project itself, a real check against a key only the project holds, not just a label a shard can give itself.\n\nUnverified: Nobody vouches for this one; it didn't come signed by the Tessera project. It runs with the same reach Tessera itself has: your files, your hardware, your settings. Same deal as running any program you downloaded from somewhere other than an app store. This toggle is just how you tell Tessera you're making that choice."
                    items = [
                        { key: "pin", label: "Require PIN to install or remove a shard", sub: info.codeAddons.pinRequired ? "On" : "Off", op: "togglePacksPin" },
                        { key: "unv", label: "Allow unverified shards", sub: info.codeAddons.allowUnverified ? "On: anything, not just Official" : "Off: Official (signed by Tessera) only", op: "toggleUnverified" }
                    ]
                } else if (v === "builtin") {
                    title = "Add-ons · Built in"
                    items = info.presets.map(function (x) { return Object.assign(inert(x.name, x.description || ""), { key: "b:" + x.name }) })
                } else {
                    title = "Add-ons · Where downloads go"
                    items = [["Widgets", info.dirs.widgets], ["Themes", info.dirs.themes], ["Shards", info.dirs.packs], ["Art", info.dirs.art], ["Fonts", info.dirs.fonts], ["Sounds", info.dirs.sounds]].map(function (x) { return Object.assign(inert(x[0], x[1]), { key: "f:" + x[0] }) })
                }
                var at = v === "top" ? Math.max(1, indexOfKey(items, st.at)) : 0
                return w.pick(title, items, at, { body: body }).then(function (it) {
                    if (!it) {
                        if (v === "top") return null
                        st.view = v === "rmthemes" ? "themes" : v === "packsSettings" ? "packs" : "top"
                        return loop()
                    }
                    if (v === "top") st.at = it.key
                    if (it.rm) {
                        return w.confirmYes("Remove “" + it.label + "”? Its folder is deleted from your Tessera folder.", "Remove").then(function (y) {
                            if (!y) return
                            return w.requirePin().then(function (ok) {
                                if (!ok) return
                                return w.dev("addons", "remove", it.rm).then(function (r) {
                                    w.setStatus(r.ok ? "Removed " + it.label + "." : r.error, !r.ok)
                                    if (r.ok && it.rm.dir === "widgets") return w.dev("library", "none", {}).then(function (lr) { if (lr && lr.view) w.applyView(lr.view) })
                                })
                            })
                        }).then(loop)
                    }
                    if (it.op === "store") return addonStore().then(loop)
                    if (it.shard) return shard(it.shard).then(loop)
                    if (it.op === "togglePacksPin" || it.op === "toggleUnverified") {
                        var apiOp = it.op === "togglePacksPin" ? "packsPinRequired" : "packsAllowUnverified"
                        var next = it.op === "togglePacksPin" ? !info.codeAddons.pinRequired : !info.codeAddons.allowUnverified
                        return addonsCall(apiOp, { value: next }).then(function (r) { if (r) w.setStatus(r.ok ? "Updated." : r.error || "Couldn't change that.", !r.ok) }).then(loop)
                    }
                    if (it.view) st.view = it.view
                    else if (it.op === "reload") st.op = "rescan"
                    else if (it.theme) {
                        return w.dev("settings", "themeUse", { id: it.theme }).then(function (r) {
                            if (r && r.theme) w.applyTheme(r.theme)
                            w.setStatus("Theme: " + it.label)
                        }).then(loop)
                    }
                    return loop()
                })
            })
        }
        loop()
    }
    // One shard: what it is, on or off, its pages, and removing it
    function shard(id) {
        return w.dev("addons", "list").then(function (info) {
            var s = (info.packs || []).filter(function (x) { return x.id === id })[0]
            if (!s) return null
            var items = []
            if (s.running) s.panels.forEach(function (pn) { items.push({ label: pn.title, sub: "open", panel: pn.index }) })
            items.push(s.enabled ? { label: "Turn off", op: "disable" } : { label: "Turn on", sub: s.official ? "Official: signed by Tessera" : "Unverified: nobody vouches for it", op: "enable" })
            items.push({ label: "Remove…", op: "remove", danger: true })
            var body = [s.description, s.official ? "Official: signed by the Tessera project." : "Unverified: " + s.reason + ". It would run with Tessera's own access to this device.", s.error ? "Not running: " + s.error : ""].filter(Boolean).join("\n\n")
            return w.pick("Shards · " + s.name, items, 0, { body: body }).then(function (it) {
                if (!it) return null
                if (it.panel !== undefined) return shardPanel(id, it.panel, it.label).then(function () { return shard(id) })
                if (it.op === "remove") {
                    return w.confirmYes("Remove “" + s.name + "”? Its folder is deleted from your Tessera folder.", "Remove").then(function (y) {
                        if (!y) return shard(id)
                        return addonsCall("remove", { dir: "packs", id: id }).then(function (r) {
                            w.setStatus(r && r.ok ? "Removed " + s.name + "." : (r && r.error) || "Couldn't remove that.", !(r && r.ok))
                            return r && r.ok ? null : shard(id)
                        })
                    })
                }
                var go = function () {
                    return shardsCall(it.op, { id: id }).then(function (r) { if (r) w.setStatus(r.ok ? r.message : r.error, !r.ok) }).then(function () { return shard(id) })
                }
                if (it.op === "enable" && !s.official) return w.confirmYes("Turn on “" + s.name + "”? It isn't signed by Tessera, and it would run with Tessera's own access to this device: your files, your hardware, your settings.", "Turn on").then(function (y) { return y ? go() : shard(id) })
                return go()
            })
        })
    }
    // A page a shard draws: its text, and rows that can each run one of its actions
    function shardPanel(id, panel, title) {
        var inner = false
        var show = function (r) {
            if (!r) return null
            if (!r.ok) { w.setStatus(r.error, true); return null }
            var v = r.view
            if (v.message) w.setStatus(v.message)
            if (v.openUrl) return w.openInBrowser(v.openUrl)
            var items = v.items.length ? v.items.map(function (x, i) { return x.action ? { key: "a" + i, label: x.label, sub: x.sub, act: x.action } : { key: "a" + i, label: x.label, sub: x.sub, info: true } }) : [{ label: "Nothing to show", info: true }]
            var first = items.findIndex(function (x) { return x.act })
            return w.pick(title, items, Math.max(0, first), { body: v.body }).then(function (it) {
                if (!it) {
                    if (!inner) return null
                    inner = false
                    return shardsCall("panel", { id: id, panel: panel }).then(show)
                }
                if (!it.act) return show(r)
                return shardsCall("action", { id: id, panel: panel, action: it.act }).then(function (res) {
                    if (res && res.ok && (res.view.items.length || res.view.body)) inner = true
                    if (res && res.ok && !res.view.items.length && !res.view.body && !res.view.openUrl) {      // only a message: show it and stay on this page
                        if (res.view.message) w.setStatus(res.view.message)
                        return shardsCall("panel", { id: id, panel: panel }).then(function (again) { if (again && again.ok) delete again.view.message; return show(again) })
                    }
                    return show(res)
                })
            })
        }
        return shardsCall("panel", { id: id, panel: panel }).then(show)
    }
    // Get add-ons: the Tessera add-on list, installed with one press
    function addonStore() {
        w.setStatus("Getting the add-on list…")
        return shardsCall("catalog", { fresh: true }).then(function (r) {
            w.setStatus("")
            if (!r) return null
            if (!r.ok) { w.setStatus(r.error, true); return null }
            var kinds = { shard: "Shard", widget: "Widget", theme: "Theme" }
            var loop = function (r) {
                var items = r.addons.map(function (a, i) {
                    return { key: "a:" + a.id, label: a.name, addon: a, sub: [kinds[a.kind], a.version, a.installed ? (a.update ? "update from " + a.installedVersion : "installed") : fmtBytes(a.size)].filter(Boolean).join(" · ") }
                })
                if (!items.length) items.push({ label: "The list is empty for now", info: true })
                return w.pick("Get add-ons", items, 0, { body: "Add-ons from the Tessera project. Shards are code: they only run once you turn them on in Add-ons > Shards." }).then(function (it) {
                    if (!it || !it.addon) return null
                    var a = it.addon
                    var what = [a.description, a.author ? "By " + a.author + "." : "", a.requires ? "Needs " + a.requires + "." : "", a.kind === "shard" ? "A shard is code with Tessera's own access to this device. Installing it does not turn it on." : ""].filter(Boolean).join(" ")
                    var verb = a.update ? "Update" : a.installed ? "Install again" : "Install"
                    return w.confirmYes(verb + " “" + a.name + "” (" + fmtBytes(a.size) + ")? " + what, a.update ? "Update" : "Install").then(function (y) {
                        if (!y) return loop(r)
                        w.setStatus("Downloading " + a.name + "…")
                        return shardsCall("install", { id: a.id }).then(function (done) {
                            w.setStatus(done ? (done.ok ? done.message : done.error) : "", Boolean(done && !done.ok))
                            return shardsCall("catalog", {})
                        }).then(function (again) { return loop(again && again.ok ? again : r) })
                    })
                })
            }
            return loop(r)
        })
    }

    // ------------------------------------------------------------------ Appearance and Theme Settings
    readonly property var colorPresets: [
        ["Blue", "#7fb2ff"], ["Sky", "#5ad1ff"], ["Teal", "#3ddc97"], ["Green", "#7ed957"], ["Yellow", "#ffd166"],
        ["Orange", "#ff9f45"], ["Red", "#ff6b6b"], ["Pink", "#ff7ac8"], ["Purple", "#b794f6"], ["White", "#ffffff"],
        ["Light gray", "#c9ced6"], ["Gray", "#3b475a"], ["Charcoal", "#1a222c"], ["Midnight", "#10151c"], ["Black", "#000000"]
    ]
    readonly property var bootScreens: ({
        tessera: { name: "Tessera", sub: "The Tessera symbol building itself" },
        bgrt: { name: "Bazzite", sub: "Your computer maker's logo and a spinner" },
        spinner: { name: "Spinner", sub: "A plain spinner" },
        details: { name: "Text", sub: "Startup messages, handy for troubleshooting" }
    })
    function themeValueText(s) {
        if (s.type === "range") return s.value + (s.unit || "")
        if (s.type === "choice") { var o = s.options.filter(function (x) { return x.value === s.value })[0]; return o ? o.label : String(s.value) }
        if (s.type === "toggle") return s.value ? "On" : "Off"
        if (s.type === "image") return s.value || "None"
        var hit = colorPresets.filter(function (x) { return x[1] === s.value })[0]
        return hit ? hit[0] + "  " + s.value : s.value
    }
    function themeSet(id, value) {
        return w.dev("settings", "themeSet", { id: id, value: value }).then(function (r) {
            if (r && r.theme) w.applyTheme(r.theme)
            if (r && !r.ok) w.setStatus(r.error, true)
        })
    }
    function appearance() {
        if (w.menuUp()) return
        var st = { at: "" }
        var loop = function () {
            var items = [
                { key: "theme", label: "Theme Settings", sub: "colors, layout, motion, boot screen", op: "theme" },
                { key: "screens", label: "Screens", sub: "which screen, resolution, refresh rate", op: "screens" },
                { key: "cal", label: "Display calibration", sub: "", op: "cal" }
            ]
            return w.pick("Appearance", items, indexOfKey(items, st.at)).then(function (it) {
                if (!it) return null
                st.at = it.key
                if (it.op === "theme") return themeSettings().then(loop)
                if (it.op === "screens") return screens().then(function (r) { return r === "restarted" ? null : loop() })
                return calibration().then(loop)
            })
        }
        loop()
    }
    function bootScreen(info) {
        var shown = info.pending || info.current
        return w.pick("Boot screen", info.themes.map(function (id) {
            return { label: bootScreens[id].name, sub: id === shown ? (info.pending ? "after the next restart" : "current") : bootScreens[id].sub, id: id }
        }), Math.max(0, info.themes.indexOf(shown)), { body: "Shown while the machine starts and shuts down, for everyone. It changes after a restart, and needs the admin PIN." }).then(function (b) {
            if (!b || b.id === shown) return null
            return w.requirePin().then(function (ok) {
                if (!ok) return null
                return updateStart("boot", { theme: b.id }).then(function (bad) { return bad || updateWatch("boot", { name: bootScreens[b.id].name }) }).then(function (r) {
                    if (r.result === "bootset") w.setStatus("Done. The " + bootScreens[b.id].name + " boot screen shows from the next restart.")
                    else { var end = updateEnd(r); if (end) w.setStatus(end, r.result === "error") }
                })
            })
        })
    }
    function bootMenu(info) {
        return w.pick("Boot menu", [
            { label: "Tessera", sub: info.menu === "on" ? "current" : "wait screen; O opens Boot options", id: "on" },
            { label: "GRUB's menu", sub: info.menu === "off" ? "current" : "the list of system versions", id: "off" }
        ], info.menu === "off" ? 1 : 0, { body: "Shown for 3 seconds when the machine starts. Tessera's shows the empty tile spots; press O (or F2) on a keyboard for Boot options: Opus, safe settings, a repair console, the previous version. Needs the admin PIN." }).then(function (m) {
            if (!m || m.id === info.menu) return null
            return w.requirePin().then(function (ok) {
                if (!ok) return null
                return updateStart("bootmenu", { menu: m.id }).then(function (bad) { return bad || updateWatch("bootmenu", { name: m.label }) }).then(function (r) {
                    if (r.result === "bootmenu") w.setStatus(m.id === "on" ? "Done. Tessera's boot menu shows from the next start." : "Done. GRUB's menu shows from the next start.")
                    else { var end = updateEnd(r); if (end) w.setStatus(end, r.result === "error") }
                })
            })
        })
    }
    function themeSettings() {
        var st = { at: "", closed: {} }
        var loop = function () {
            return Promise.all([w.dev("settings", "themeGet"), w.dev("update", "bootInfo", {})]).then(function (res) {
                var t = res[0], boot = res[1]
                if (!t || !t.themes) return null
                w.applyTheme(t)
                var active = t.themes.filter(function (x) { return x.id === t.active })[0]
                var items = [{ key: "h:theme", label: "Theme", header: true },
                             { key: "switch", label: active ? active.name : "Tessera Bright", sub: t.themes.length > 1 ? "Select to switch" : "more themes: Add-ons", op: "switch" }]
                var group = null, sizes = {}
                t.settings.forEach(function (x) { sizes[x.group] = (sizes[x.group] || 0) + 1 })
                t.settings.forEach(function (x) {
                    if (x.group !== group) {
                        group = x.group
                        items.push(sizes[group] > 1 ? { key: "f:" + group, label: group, header: true, fold: "theme." + group } : { key: "h:" + group, label: group, header: true })
                    }
                    items.push({ key: "s:" + x.id, label: x.label, sub: themeValueText(x), op: "set", s: x })
                })
                // the boot screen is the machine's, not this theme's: one for everyone, set with the admin PIN
                if (boot && boot.ok) {
                    var shown = boot.pending || boot.current
                    items.push({ key: "h:boot", label: "Boot screen", header: true })
                    items.push({ key: "boot", label: bootScreens[shown].name, sub: boot.pending ? "shows after the next restart" : "for everyone on this machine", op: "boot", boot: boot })
                    items.push({ key: "h:bootmenu", label: "Boot menu", header: true })
                    items.push({ key: "bootmenu", label: boot.menu === "off" ? "GRUB's menu" : "Tessera", sub: boot.menu === "off" ? "the list of system versions" : "wait screen; O opens Boot options", op: "bootmenu", boot: boot })
                }
                items.push({ key: "h:yours", label: "Your themes", header: true })
                items.push({ key: "saveNew", label: "Save current as a new theme…", op: "saveNew" })
                if (active && !active.builtin) {
                    items.push({ key: "rename", label: "Rename this theme…", op: "rename" })
                    items.push({ key: "overwrite", label: "Overwrite this theme with current", op: "overwrite" })
                    items.push({ key: "delete", label: "Delete this theme…", op: "delete", danger: true })
                }
                items.push({ key: "h:reset", label: "Reset", header: true })
                items.push({ key: "reset", label: "Reset this theme to defaults", op: "reset" })
                items = folded(items, st.closed)
                return w.pick("Theme Settings", items, Math.max(1, indexOfKey(items, st.at))).then(function (it) {
                    if (!it) return null
                    st.at = it.key
                    if (it.fold) { st.closed[it.fold] = !st.closed[it.fold]; return loop() }
                    var say = function (r, good) { if (r) { if (r.ok) { if (r.theme) w.applyTheme(r.theme); w.setStatus(good) } else w.setStatus(r.error, true) } }
                    var name = function (title, start) {
                        return w.ask(title, start).then(function (n) {
                            if (n === null) return null
                            if (!n.trim()) { w.setStatus("Give it a name.", true); return null }
                            return n
                        })
                    }
                    var work = Promise.resolve()
                    if (it.op === "bootmenu") work = bootMenu(it.boot)
                    else if (it.op === "boot") work = bootScreen(it.boot)
                    else if (it.op === "reset") work = w.confirmYes("Reset every Theme Setting to its default?", "Reset").then(function (y) {
                        if (y) return w.dev("settings", "themeReset").then(function (r) { if (r && r.theme) w.applyTheme(r.theme) })
                    })
                    else if (it.op === "switch") work = w.pick("Choose a theme", t.themes.map(function (x) {
                        return { label: x.name, sub: [x.id === t.active ? "current" : x.author, x.dup ? "#" + x.id : ""].filter(Boolean).join("  ·  "), id: x.id }
                    }), Math.max(0, t.themes.findIndex(function (x) { return x.id === t.active }))).then(function (c) {
                        if (c) return w.dev("settings", "themeUse", { id: c.id }).then(function (r) { if (r && r.theme) w.applyTheme(r.theme) })
                    })
                    else if (it.op === "saveNew") work = name("Name this theme", "").then(function (n) {
                        if (n !== null) return w.dev("addons", "saveTheme", { name: n }).then(function (r) { say(r, "Saved as “" + n.trim() + "”.") })
                    })
                    else if (it.op === "rename") work = name("Rename this theme", active.name).then(function (n) {
                        if (n !== null) return w.dev("addons", "renameTheme", { id: active.id, name: n }).then(function (r) { say(r, "Renamed.") })
                    })
                    else if (it.op === "overwrite") work = w.confirmYes("Overwrite “" + active.name + "” with the Theme Settings you have now?", "Overwrite").then(function (y) {
                        if (y) return w.dev("addons", "overwriteTheme", { id: active.id }).then(function (r) { say(r, "Saved.") })
                    })
                    else if (it.op === "delete") work = w.confirmYes("Delete “" + active.name + "”? This removes its folder from your Tessera folder.", "Delete").then(function (y) {
                        if (!y) return
                        var go = function () { return w.dev("addons", "remove", { dir: "themes", id: active.id }) }
                        return go().then(function (r) {
                            // only in-use themes land here: an unused one deletes with no PIN prompt at all
                            if (r && r.needPin) return w.requirePin("This theme is being used by another profile. Enter your PIN to continue deleting.").then(function (ok) { return ok ? go() : null })
                            return r
                        }).then(function (r) {
                            if (!r) return
                            if (r.ok) {
                                if (r.theme) w.applyTheme(r.theme)
                                w.setStatus(r.fellBack && r.fellBack.length ? "Deleted “" + active.name + "”. " + r.fellBack.join(" and ") + " fell back to Tessera Bright." : "Deleted “" + active.name + "”.")
                            } else w.setStatus(r.error || "Couldn't delete that.", true)
                        })
                    })
                    else if (it.op === "set") work = editThemeSetting(it.s)
                    return work.then(loop)
                })
            })
        }
        return loop()
    }
    function editThemeSetting(s) {
        if (s.type === "toggle") return themeSet(s.id, !s.value)
        if (s.type === "range") {
            var vals = []
            for (var v = s.min; v <= s.max + 1e-9; v += s.step) vals.push(Math.round(v * 1000) / 1000)
            return w.pick(s.label + (s.hint ? "  ·  " + s.hint : ""), vals.slice(0, 60).map(function (x) { return { label: x + (s.unit || ""), sub: x === s.value ? "current" : "", v: x } }), Math.max(0, vals.indexOf(s.value))).then(function (it) { if (it) return themeSet(s.id, it.v) })
        }
        if (s.type === "choice") {
            return w.pick(s.label, s.options.map(function (o) { return { label: o.label, sub: o.value === s.value ? "current" : "", v: o.value } }), Math.max(0, s.options.findIndex(function (o) { return o.value === s.value }))).then(function (it) { if (it) return themeSet(s.id, it.v) })
        }
        if (s.type === "color") {
            var items = [
                { key: "wheel", label: "Color wheel…", sub: "pick by eye", op: "wheel" },
                { key: "hex", label: "Hex code…", sub: s.value.toUpperCase(), op: "hex" },
                { key: "h:presets", label: "Presets", header: true, fold: "color.presets" }
            ].concat(colorPresets.map(function (c) { return { key: "c:" + c[1], label: c[0], sub: c[1] + (c[1] === s.value ? "  ·  current" : ""), v: c[1] } }))
            items.push({ key: "default", label: "Default", sub: s.default, v: s.default })
            var closed = {}
            var show = function (at) {
                var shown = folded(items.map(function (x) { return Object.assign({}, x) }), closed)
                return w.pick(s.label, shown, indexOfKey(shown, at)).then(function (it) {
                    if (!it) return null
                    if (it.fold) { closed[it.fold] = !closed[it.fold]; return show(it.key) }
                    if (it.op !== "wheel" && it.op !== "hex") return themeSet(s.id, it.v)
                    var hex = s.value, typing = it.op === "hex"
                    var next = function () {
                        if (typing) {
                            return w.ask("Hex code, like #ff8800", hex, { symbols: true }).then(function (txt) {
                                if (txt === null) return null
                                var m = /^#?([0-9a-f]{6})$/i.exec(txt.trim())
                                if (!m) { w.setStatus("That is not a 6-digit hex code.", true); return next() }
                                hex = "#" + m[1].toLowerCase()
                                typing = false
                                return next()
                            })
                        }
                        return w.pickColor(s.label, hex).then(function (res) {
                            if (!res) return null
                            hex = res.color
                            if (res.hex) { typing = true; return next() }
                            return themeSet(s.id, hex)
                        })
                    }
                    return next()
                })
            }
            return show("wheel")
        }
        if (s.type === "image") {
            var rows = [{ label: "Choose a picture…", sub: "PNG, JPEG or WebP, up to 12 MB", op: "pick" }]
            if (s.value) rows.push({ label: "Remove picture", op: "none" })
            return w.pick(s.label, rows).then(function (it) {
                if (!it) return null
                if (it.op === "none") return themeSet(s.id, "")
                return browse("pickImage")
            })
        }
        return Promise.resolve()
    }

    // ------------------------------------------------------------------ Screens
    readonly property var orientWord: ({ normal: "Normal", left: "Turned left", right: "Turned right", upsidedown: "Upside down" })
    function screenName(s) { return (s.label ? s.label + " (" + s.name + ")" : s.name) + (s.internal ? " · built in" : "") }
    function modeWord(m) { return m.width + " × " + m.height }
    function hzWord(m) { return Math.round(m.hz || m.refresh) + " Hz" }
    function displayList() {
        w.setStatus("Looking at the screens…")
        return w.dev("display", "list", {}).then(function (d) { w.setStatus(""); return d })
    }
    function screens() {
        return displayList().then(function (d) {
            if (!d || !d.ok) return w.notice("Screens", (d && d.error) || "Couldn't read the screens.")
            if (d.nested) return w.notice("Screens", "Ludus is open on top of Opus, so it uses Opus's screen settings: the main screen, at the resolution set there. Change screens, resolution and orientation in Opus's display settings.")
            var list = d.screens || []
            if (!list.length) return w.notice("Screens", "No connected screen was found. (Ludus's own screen should always be listed: please make a problem report.)")
            var set = d.settings || {}
            var shown = list.filter(function (x) { return x.current })[0] || list[0]
            var draft = { output: set.output || shown.name, width: set.width, height: set.height, refresh: set.refresh, orientation: set.orientation || "normal" }
            var at = ""
            var loop = function () {
                var s = list.filter(function (x) { return x.name === draft.output })[0] || list[0]
                var best = s.modes.filter(function (m) { return m.preferred })[0] || s.modes[0]
                var res = draft.width ? draft.width + " × " + draft.height : modeWord(best) + " (the screen's own)"
                var rate = draft.refresh ? draft.refresh + " Hz" : "the highest it offers"
                var items = [
                    { key: "screen", label: "Screen", sub: screenName(s), op: "screen" },
                    { key: "res", label: "Resolution", sub: res, op: "res" },
                    { key: "rate", label: "Refresh rate", sub: rate, op: "rate" }
                ]
                if (s.internal) items.push({ key: "orient", label: "Orientation", sub: orientWord[draft.orientation || "normal"], op: "orient" })
                items.push({ key: "apply", label: "Apply", sub: "Ludus starts again with these, then asks to keep them", op: "apply", ok: true })
                items.push({ key: "auto", label: "Use the screen's own choice", sub: "clears these settings", op: "auto" })
                var others = list.length - 1
                var body = ["Ludus shows on one screen at a time" + (others ? "; the other" + (others > 1 ? "s stay" : " stays") + " dark while it runs" : "") + ". Opus can use them all, mirrored or side by side.",
                            s.internal ? "" : "Turning a screen on its side is done in Opus for external screens (Ludus can only turn a built-in screen)."].filter(Boolean).join("\n")
                return w.pick("Screens", items, indexOfKey(items, at), { body: body }).then(function (it) {
                    if (!it) return null
                    at = it.key
                    if (it.op === "screen") {
                        return w.pick("Show Ludus on", list.map(function (x) { return { label: screenName(x), sub: x.current ? "showing Ludus now" : x.modes.length + " modes", s: x, ok: x.name === draft.output } })).then(function (c) {
                            if (c && c.s.name !== draft.output) draft = { output: c.s.name, orientation: "normal" }
                            return loop()
                        })
                    }
                    if (it.op === "res") {
                        var sizes = []
                        s.modes.forEach(function (m) { if (!m.interlaced && !sizes.some(function (x) { return x.width === m.width && x.height === m.height })) sizes.push(m) })
                        var rows = [{ label: "The screen's own (" + modeWord(best) + ")", auto: true, ok: !draft.width }].concat(sizes.map(function (m) {
                            return { label: modeWord(m), sub: m.width === best.width && m.height === best.height ? "recommended" : "", m: m, ok: draft.width === m.width && draft.height === m.height }
                        }))
                        return w.pick("Resolution", rows).then(function (c) {
                            if (c) { if (c.auto) { delete draft.width; delete draft.height; delete draft.refresh } else { draft.width = c.m.width; draft.height = c.m.height; delete draft.refresh } }
                            return loop()
                        })
                    }
                    if (it.op === "rate") {
                        var ww = draft.width || best.width, hh = draft.height || best.height
                        var rates = s.modes.filter(function (m) { return m.width === ww && m.height === hh && !m.interlaced })
                        return w.pick("Refresh rate", [{ label: "The highest it offers", auto: true, ok: !draft.refresh }].concat(rates.map(function (m) { return { label: hzWord(m), sub: m.hz + " Hz", m: m, ok: draft.refresh === m.refresh } })), 0, { body: "At " + ww + " × " + hh + "." }).then(function (c) {
                            if (c) { if (c.auto) delete draft.refresh; else { draft.width = ww; draft.height = hh; draft.refresh = c.m.refresh } }
                            return loop()
                        })
                    }
                    if (it.op === "orient") {
                        return w.pick("Orientation", Object.keys(orientWord).map(function (k) { return { label: orientWord[k], k: k, ok: draft.orientation === k } })).then(function (c) {
                            if (c) draft.orientation = c.k
                            return loop()
                        })
                    }
                    // apply or auto
                    var payload = it.op === "auto" ? { auto: true } : Object.assign({ output: draft.output }, draft.width ? { width: draft.width, height: draft.height } : {}, draft.refresh ? { refresh: draft.refresh } : {}, s.internal ? { orientation: draft.orientation } : {})
                    var go = function () { return w.dev("display", "try", payload) }
                    return go().then(function (r) {
                        if (r && r.needPin) return w.requirePin("Enter the admin PIN to change screens").then(function (ok) { return ok ? go() : { ok: true, cancelled: true } })
                        return r
                    }).then(function (r) {
                        if (r && r.cancelled) return loop()
                        if (!r || !r.ok) return w.notice("Can't use that", (r && r.error) || "Something went wrong.").then(displayList).then(loop)
                        if (r.restarted) { w.setStatus("Starting Ludus again on the new settings…"); return "restarted" }
                        return w.notice("Saved", "These are used the next time Ludus starts. You will be asked to keep them.")
                    })
                })
            }
            return loop()
        })
    }
    // After a restart on new settings: keep them, or they go back by themselves in 15 seconds
    function displayKeep() {
        return w.dev("display", "list", {}).then(function (d) {
            if (!d || !d.ok || !d.trying || !d.tried || d.nested) return null
            var st = { left: 15, at: "" }
            var items = [{ key: "keep", label: "Keep these settings", op: "keep", ok: true }, { key: "back", label: "Change back", op: "back" }]
            return w.liveList(st, {
                title: "Keep these screen settings?", every: 1000,
                items: function () { return items },
                body: function (s) { return "Can you see this clearly? If not, Ludus goes back to the settings before in " + s.left + " second" + (s.left === 1 ? "" : "s") + "." },
                reload: function (s) { s.left -= 1; if (s.left <= 0) w.menuCancel(); return Promise.resolve() }
            }).then(function (it) {
                if (it && it.op === "keep") return w.dev("display", "confirm", {}).then(function () { w.setStatus("Screen settings kept.") })
                return w.dev("display", "revert", { restart: true }).then(function (r) { w.setStatus(r && r.restarted ? "Going back to the settings before…" : "Going back to the settings before at the next start.") })
            })
        })
    }

    // ------------------------------------------------------------------ Display calibration
    readonly property string calIntro: "Set your screen to its normal picture mode first and turn off any dynamic contrast, energy saving or motion smoothing. Let it warm up for a few minutes, dim the room, and turn HDR off."
    function calDate(iso) {
        try { var d = new Date(iso); return isNaN(d) ? "" : d.getDate() + " " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getMonth()] } catch (e) { return "" }
    }
    function calibrate(mode) {
        var quick = mode === "quick"
        return w.pick(quick ? "Quick calibration" : "Thorough calibration", [
            { label: "Start", sub: quick ? "4 short steps · about a minute" : "12 steps · about 5 minutes", op: "go" },
            { label: "Cancel", op: "no" }
        ], 0, { body: calIntro + (quick ? " This one sets brightness, gamma and white balance." : " This one also sets white level, gamma at three levels, each colour on its own, tint and colour strength.") }).then(function (it) {
            if (!it || it.op !== "go") return null
            return w.runCalibration(mode).then(function (cal) {
                if (!cal) return null
                return w.dev("settings", "calSet", { cal: cal }).then(function (r) {
                    if (r && r.prefs) { takePrefs(r); w.setStatus("Calibration saved.") } else w.setStatus((r && r.error) || "Couldn't save the calibration.", true)
                })
            })
        })
    }
    function calibration() {
        var st = { at: "" }
        var loop = function () {
            var p = (w.view.prefs && w.view.prefs.calibration) || { cal: null }, c = p.cal
            var items = [{ key: "h", label: c ? "Calibrated " + calDate(c.at) + " · " + (c.mode === "thorough" ? "Thorough" : "Quick") + (c.enabled ? "" : " · off") : "Not calibrated yet",
                           sub: c ? "Gamma ≈ " + (2.2 / ((c.gamma[0] + c.gamma[1] + c.gamma[2]) / 3)).toFixed(2) : "", header: true },
                         { key: "quick", label: "Quick calibration", sub: "About a minute", op: "quick" },
                         { key: "thorough", label: "Thorough calibration", sub: "About 5 minutes", op: "thorough" }]
            if (c) {
                items.push({ key: "toggle", label: "Calibration", sub: c.enabled ? "On · Select to turn off" : "Off · Select to turn on", op: "toggle" })
                items.push({ key: "system", label: "Apply to games too", sub: p.system ? "On · experimental" : "Off · experimental", op: "system" })
                items.push({ key: "reset", label: "Reset to default", op: "reset" })
            }
            var body = p.systemFailed ? "Applying it to games failed, so it was switched off. Tessera itself is still calibrated." : p.system && !p.systemActive ? "Applying it to games takes effect the next time Tessera starts." : ""
            return w.pick("Display calibration", items, Math.max(1, indexOfKey(items, st.at)), { body: body }).then(function (it) {
                if (!it) return null
                st.at = it.key
                if (it.op === "quick" || it.op === "thorough") return calibrate(it.op).then(loop)
                return w.requirePin().then(function (ok) {
                    if (!ok) return loop()
                    var call
                    if (it.op === "toggle") call = w.dev("settings", "calToggle", { enabled: !c.enabled })
                    else if (it.op === "system") {
                        call = (p.system ? Promise.resolve(true) : w.confirmYes("Also apply the calibration to games? Tessera gives it to Gamescope when it starts, so it takes effect after a restart. If anything goes wrong it switches itself off.", "Turn it on")).then(function (y) { return y ? w.dev("settings", "calSystem", { on: !p.system }) : null })
                    } else call = w.confirmYes("Go back to the screen as it is, with no calibration?", "Reset").then(function (y) { return y ? w.dev("settings", "calReset", {}) : null })
                    return call.then(function (r) {
                        if (r && r.prefs) { takePrefs(r); w.setStatus(it.op === "reset" ? "Calibration reset." : it.op === "toggle" ? (c.enabled ? "Calibration is off." : "Calibration is on.") : p.system ? "Games will no longer be calibrated." : "Games will be calibrated from the next start.") }
                        else if (r) w.setStatus(r.error, true)
                    }).then(loop)
                })
            })
        }
        return loop()
    }

    // ------------------------------------------------------------------ at start, and when something is plugged in
    property bool welcomed: false
    property bool askedWho: false
    // Shown once, the first time Tessera starts
    function welcome() {
        if (welcomed) return Promise.resolve()
        welcomed = true
        var profileId = null, wantTour = false
        return w.pick("Welcome to Tessera", [
            { label: "Get started", op: "go" },
            { label: "Skip setup", sub: "Everything here is in Settings too", op: "skip" }
        ], 0, { body: "Let's set a few things up: who's playing, how Tessera looks, and whether to lock things behind a PIN. It takes about a minute." }).then(function (hi) {
            var go = hi && hi.op === "go"
            var part1 = Promise.resolve()
            if (go) {
                part1 = w.pick("Who's playing?", [
                    { label: "Add my name", op: "name" },
                    { label: "Skip", sub: "Profiles can be added later in Settings > Profiles", op: "skip" }
                ], 0, { body: "A profile keeps your own controls, Home and mosaics, browser logins and theme, and the guide shows who is playing. More people can be added later." }).then(function (who) {
                    if (!who || who.op !== "name") return null
                    return w.ask("Your name", "", { max: 24 }).then(function (name) {
                        if (!name || !name.trim()) return null
                        return w.dev("profiles", "add", { name: name }).then(function (r) {
                            if (r && r.ok) {
                                var mine = (r.profiles || []).filter(function (p) { return p.name === name.trim() })[0] || (r.profiles || []).slice(-1)[0]
                                if (mine) { profileId = mine.id; return w.dev("profiles", "use", { id: mine.id }).then(function (u) { if (u && u.view) w.applyView(u.view) }) }
                            } else if (r && r.error) w.setStatus(r.error, true)
                        })
                    })
                }).then(function () {
                    // how it looks: the screen is shown behind the menu, so each choice is seen whole
                    var look = function () {
                        return w.dev("settings", "themeGet").then(function (t) {
                            var list = t.themes.map(function (x) { return { label: x.name, sub: x.id === t.active ? "this one" : "", id: x.id } })
                            var cur = Math.max(0, list.findIndex(function (x) { return x.id === t.active }))
                            return w.pick("Pick a look", list.concat([{ label: "Keep this one", op: "keep", ok: true }]), cur, { body: "Choose one to see it. Every part of it can be changed later in Theme Settings." }).then(function (it) {
                                if (!it || it.op === "keep") return t.active
                                return w.dev("settings", "themeUse", { id: it.id }).then(function (r) { if (r && r.ok) w.applyTheme(r.theme); return look() })
                            })
                        })
                    }
                    return look().then(function (active) { if (profileId) return w.dev("profiles", "setTheme", { id: profileId, themeId: active }) })
                })
            }
            return part1.then(function () {
                return w.pick(go ? "A PIN?" : "Welcome to Tessera", [
                    { label: "Set a PIN", sub: "Choose 4 to 8 digits", op: "set" },
                    { label: "Skip for now", sub: "You can set one later in Settings", op: "skip" }
                ], 0, { body: "Want an extra layer of security? With a PIN set, changing settings, adding or deleting games and apps, and opening the browser all ask for it first. Handy if you like a little peace of mind day to day." })
            }).then(function (pinIt) {
                if (!pinIt || pinIt.op !== "set") return null
                return setPin().then(function (ok) { if (!ok) w.setStatus("No PIN was set. You can set one in Settings > PIN.") })
            }).then(function () {
                if (!go) return null
                return w.pick("You're all set", [{ label: "Start playing", ok: true }, { label: "Take a quick tour", sub: "a minute, shows where everything is", tour: true }], 0, {
                    body: "Press the Guide button any time for quick settings, profiles and power, even during a game. LB and RB switch tabs."
                }).then(function (end) { wantTour = Boolean(end && end.tour) })
            })
        }).then(function () {
            return w.dev("settings", "firstRunDone").then(function (r) {
                if (r && r.prefs) takePrefs(r)
                if (wantTour) return w.runTour()
            })
        })
    }
    // "Who's playing?" (at start, when that's turned on)
    function whoIsPlaying() {
        return w.dev("profiles", "list").then(function (pr) {
            if (!pr || !pr.profiles || !pr.profiles.length) return null
            var items = pr.profiles.map(function (p) { return { key: "p:" + p.id, label: p.name, sub: [p.id === pr.active || p.id === pr.lockedOut ? "last played" : "", p.locked ? "PIN" : ""].filter(Boolean).join(" · "), id: p.id } })
            if (pr.guest.show !== false) items.push({ key: "guest", label: "Guest", sub: "only what the admin allows", id: null })
            var at = Math.max(0, items.findIndex(function (x) { return x.id === (pr.lockedOut || pr.active) }))
            return w.pick("Who's playing?", items, at).then(function (it) {
                if (it && it.id !== pr.active) return switchProfile(it.id, it.label)
            })
        })
    }
    // once, as Tessera starts
    // ---- Install Tessera and Recover (the USB's own steps run in the bridge: backend/flowhost.js);
    // each of their menus and questions comes here and the answer goes back
    property bool usbShown: false
    property var usbMenu: null          // the progress menu open now (an install, a backup, a disk check)
    function usbFlow(which) {
        usbShown = true
        return w.rawCall("__flow", ["start", which]).then(function (r) {
            if (r === false) w.setStatus("That is already open.")
        })
    }
    function usbAnswer(id, v) { if (id) w.rawCall("__flow", ["answer", id, v]) }
    function flowUi(d) {
        if (d.kind === "status") return w.setStatus(d.text, d.error)
        if (d.kind === "pick") {
            d.items.forEach(function (it, i) { it._i = i })
            return w.pick(d.title, d.items, d.index || 0, { body: d.body, welcome: d.welcome }).then(function (it) { usbAnswer(d.id, it ? it._i : -1) })
        }
        if (d.kind === "ask") return w.ask(d.title, d.initial, d.opts).then(function (t) { usbAnswer(d.id, t) })
        if (d.kind === "progress") { usbMenu = d; return showProgress() }
        if (d.kind === "progress-set") { if (usbMenu) { usbMenu.items = d.items; usbMenu.body = d.body; if (w.guideMenu.visible) w.guideMenu.update(d.items, d.body) } return }
        if (d.kind === "progress-close") { if (usbMenu && w.guideMenu.visible) w.guideMenu.close(); usbMenu = null; return }
    }
    // B on the progress menu asks the flow (a backup or a check stops; an install ignores it) and the menu stays
    function showProgress() {
        var m = usbMenu
        w.guideMenu.open(m.title, m.items, function () {}, 0, function () { w.rawCall("__flow", ["back"]); if (usbMenu === m) showProgress() }, { body: m.body })
    }
    function startup(payload) {
        var p = (payload && payload.prefs) || {}
        if (payload && payload.error) w.setStatus(payload.error, true)
        else if (p.safe) w.setStatus("Started with safe settings: display calibration and shards are off until the next restart.")
        else if (p.storage && p.storage.low && p.storage.low.length) w.setStatus("Low storage: " + p.storage.low[0].name + " has " + fmtBytes(p.storage.low[0].free) + " left. Settings > Storage can help free some up.", true)
        if (p.live && !usbShown) { usbShown = true; return usbFlow("install") }
        if (p.pin && p.pin.firstRun && !welcomed) return welcome()
        if (askedWho) return Promise.resolve()
        askedWho = true
        return w.dev("profiles", "list").then(function (pr) {
            if (pr && (pr.ask || pr.lockedOut) && pr.profiles && pr.profiles.length && !w.menuUp()) return whoIsPlaying()
        })
    }
    // waits for the menu to be free, up to about two minutes
    function whenFree(tries) {
        if (!w.menuUp()) return Promise.resolve(true)
        if (tries >= 40) return Promise.resolve(false)
        return w.sleepMs(3000).then(function () { return whenFree(tries + 1) })
    }
    // A drive was plugged in while Tessera was open: offer to use it for games
    function offerDrive(d) {
        return whenFree(0).then(function (free) {
            if (!free) return null
            return w.pick("“" + d.name + "” was plugged in · " + fmtBytes(d.free) + " free of " + fmtBytes(d.total), [
                { label: "Use it for games", sub: "Makes a Games folder and scans it", op: "use" },
                { label: "Not now", op: "no" },
                { label: "Don’t ask about this drive again", op: "never" }
            ], 0, { body: "Want to keep games on it?" }).then(function (it) {
                if (!it || it.op === "no") return null
                return w.requirePin().then(function (ok) {
                    if (!ok) return null
                    if (it.op === "never") return w.dev("storage", "ignoreDrive", { key: d.key }).then(function () { w.setStatus("OK. You can still use it from Settings > Storage.") })
                    return w.dev("storage", "useDrive", { key: d.key }).then(function (r) {
                        w.setStatus(r.message || r.error, !r.ok)
                        if (r.ok) return scan()
                    })
                })
            })
        })
    }
    // A screen was plugged in while Ludus runs: show Ludus there?
    property bool screenAsking: false
    function displayNew(e) {
        if (screenAsking) return Promise.resolve()
        return w.dev("display", "list", {}).then(function (d) {
            if (!d || !d.ok || d.nested) return null
            var s = (d.screens || []).filter(function (x) { return (e.outputs || []).indexOf(x.name) >= 0 })[0]
            if (!s) return null
            if (w.menuUp()) { w.setStatus("New screen: " + screenName(s) + ". Settings > Appearance > Screens can show Ludus there."); return null }
            screenAsking = true
            return w.pick("New screen", [
                { label: "Show Ludus there", sub: "Ludus starts again on it, at its own best mode", op: "use", ok: true },
                { label: "Not now", op: "later" },
                { label: "Don't ask for this screen", op: "ignore" }
            ], 0, { body: screenName(s) + " was connected." }).then(function (it) {
                if (!it) return null
                if (it.op === "ignore") return w.dev("display", "ignore", { output: s.name })
                if (it.op !== "use") return null
                var go = function () { return w.dev("display", "try", { output: s.name }) }
                return go().then(function (r) {
                    if (r && r.needPin) return w.requirePin("Enter the admin PIN to change screens").then(function (ok) { return ok ? go() : null })
                    return r
                }).then(function (r) { if (r && !r.ok) return w.notice("Can't use that", r.error || "Something went wrong.") })
            }).then(function () { screenAsking = false }, function () { screenAsking = false })
        })
    }

    // ------------------------------------------------------------------ Adding things, and the Options menu (flows.js)
    // things in your library that aren't on this page yet
    function libraryChoices(into) {
        var v = w.view
        var have = {}
        ;((v.folders[into] || {}).tiles || []).forEach(function (t) { have[t.id] = true })
        var rowTiles = function (tab, row) { var r = (v.tabs[tab] || []).filter(function (x) { return x.id === row })[0]; return r ? r.tiles : [] }
        var things = rowTiles("library", "_all_games").concat(rowTiles("apps", "_all_apps"))
        var folders = Object.keys(v.folders).filter(function (id) { return id !== "_home" }).map(function (id) { return { id: id, title: v.folders[id].title, kind: "folder" } })
        return things.concat(folders).filter(function (t) { return t.id !== into && !have[t.id] })
    }
    // what "+" offers depends on where it is: ctx { catId } on a page, { tab, kind } in Library and Apps
    function add(ctx) {
        return w.requirePin().then(function (ok) {
            if (!ok) return null
            var into = ctx.catId
            var onlyGame = ctx.kind === "game", onlyApp = ctx.kind === "app"
            var items = []
            if (into && libraryChoices(into).length) items.push({ label: "Add something from your library…", op: "existing" })
            if (into === "_home") items.push({ label: "Add a widget…", op: "inlay" })
            if (!onlyApp && ctx.tab !== "apps") items.push({ label: "Add a game from a file…", op: "game" })
            if (!onlyGame && ctx.tab !== "library") items.push({ label: "Add an app from a file…", op: "app" })
            if (!onlyApp && ctx.tab !== "apps") items.push({ label: "Scan for games", op: "scan" })
            if (into === "_home") items.push({ label: "New mosaic…", op: "mosaic" })
            else if (into) items.push({ label: "New folder here…", op: "folder" })
            var run = function (it) {
                if (!it) return null
                switch (it.op) {
                case "existing": return addExisting(into)
                case "inlay": return w.addWidget()
                case "game": return browse("addGame", into)
                case "app": return browse("addApp", into)
                case "scan": return scan(into)
                case "mosaic": return w.newMosaic()
                case "folder": return w.newFolder(into)
                }
            }
            if (items.length === 1) return run(items[0])
            return w.pick("Add", items).then(run)
        })
    }
    function addExisting(into) {
        var choices = libraryChoices(into)
        var on = {}, st = { at: "" }
        var loop = function () {
            var items = [{ key: "go", label: "Add selected", op: "go", ok: true }]
            choices.forEach(function (t) { items.push({ key: "t:" + t.id, id: t.id, label: t.title, sub: (on[t.id] ? "✓ Adding · " : "") + ({ folder: "Folder", app: "App", game: "Game" }[t.kind] || "") }) })
            return w.pick("Add to this page", items, indexOfKey(items, st.at || "go")).then(function (it) {
                if (!it) return null
                st.at = it.key
                if (it.id !== undefined) { on[it.id] = !on[it.id]; return loop() }
                var ids = choices.filter(function (t) { return on[t.id] }).map(function (t) { return t.id })
                var n = 0, last = null
                var next = function (i) {
                    if (i >= ids.length) { if (ids.length) w.setStatus(n ? "Added " + n + "." : (last && last.error), !n); return null }
                    return w.dev("library", "addEntry", { catId: into, ref: ids[i] }).then(function (r) { last = r; if (r && r.view) w.applyView(r.view); if (r && r.ok) n++; return next(i + 1) })
                }
                return next(0)
            })
        }
        return loop()
    }
    function rename(op, id, current) {
        return w.ask("Rename", current).then(function (text) { if (text !== null) return lib(op, { id: id, title: text }) })
    }
    function addTo(t, rowId) {
        var f = w.view.folders
        var targets = Object.keys(f).filter(function (id) { return id !== t.id && id !== rowId }).map(function (id) { return { label: f[id].title, id: id } })
        if (!targets.length) { w.setStatus("Make a mosaic first (the + Mosaic tab).", true); return Promise.resolve() }
        return w.pick("Add “" + t.title + "” to…", targets).then(function (c) { if (c) return lib("addEntry", { catId: c.id, ref: t.id }) })
    }
    // rows and columns for this page only; rails, grid and flow stay a Theme Settings choice for everything
    function pageGrid(ctx) {
        var lc = ctx.grid, has = ctx.ownGrid
        var save = function (payload) {
            return w.dev("settings", "pageGridSet", Object.assign({ key: ctx.pageKey }, payload)).then(function (r) {
                if (r && r.prefs) takePrefs(r)
                else if (r && !r.ok) w.setStatus("That size isn't allowed.", true)
            })
        }
        var presets = [[3, 2], [4, 2], [5, 3], [6, 3], [6, 4], [8, 4]]
        var items = [{ label: "Use the Theme Settings size", sub: has ? "for this page" : "current", reset: true }]
            .concat(presets.map(function (x) { return { label: x[0] + " × " + x[1], sub: has && lc.cols === x[0] && lc.rows === x[1] ? "current" : "", c: x[0], r: x[1] } }))
            .concat([{ label: "Custom…", sub: "pick columns and rows", custom: true }])
        return w.pick("Grid size for this page (columns × rows)", items).then(function (it) {
            if (!it) return null
            if (it.reset) return save({})
            if (!it.custom) return save({ cols: it.c, rows: it.r })
            var range = function (lo, hi) { var o = []; for (var i = lo; i <= hi; i++) o.push(i); return o }
            return w.pick("Columns", range(2, 12).map(function (v) { return { label: String(v), sub: v === lc.cols ? "current" : "", v: v } }), Math.max(0, lc.cols - 2)).then(function (cp) {
                if (!cp) return null
                return w.pick("Rows on screen", range(1, 8).map(function (v) { return { label: String(v), sub: v === lc.rows ? "current" : "", v: v } }), Math.max(0, lc.rows - 1)).then(function (rp) {
                    if (rp) return save({ cols: cp.v, rows: rp.v })
                })
            })
        })
    }
    // the Options menu of a tile, or of the page when opened from the tab bar
    function options(ctx) {
        var t = ctx.t, catRow = Boolean(ctx.catId)
        var renamable = catRow && ctx.catId !== "_home"
        var isThing = t && (t.kind === "game" || t.kind === "app" || t.kind === "folder")
        var items = []
        if (isThing) {
            items.push({ label: "Add to a mosaic or folder…", op: "addTo" })
            if (catRow) items.push({ label: "Remove from this page", op: "removeFromRow" })
            if (t.kind === "folder") {
                items.push({ label: "Rename this folder…", op: "renameTile" })
                items.push({ label: "Delete this folder…", op: "deleteTile" })
            } else {
                items.push({ label: "Rename…", op: "renameItem" })
                items.push({ label: "Change picture…", op: "pickArt" })
                if (t.custom) items.push({ label: "Use the automatic picture", op: "clearArt" })
                items.push({ label: "Remove from library…", op: "deleteItem" })
                if (t.deletable) items.push({ label: "Delete the files…", op: "deleteFiles" })
            }
        } else if (t && t.kind === "inlay") {
            if (!t.missing) items.push({ label: t.resizable ? "Move / resize…" : "Move…", op: "resize" })
            if (catRow) items.push({ label: "Remove this widget", op: "removeFromRow" })
        }
        if (ctx.homeMode) items.push({ label: "Add a widget…", op: "addWidget" })
        if (renamable) {
            items.push({ label: ctx.inFolder ? "Rename the open folder…" : "Rename this mosaic…", op: "renameRow" })
            if (!ctx.inFolder) {
                items.push({ label: "Move this mosaic left", op: "moveL" })
                items.push({ label: "Move this mosaic right", op: "moveR" })
            }
            items.push({ label: ctx.inFolder ? "Delete the open folder…" : "Delete this mosaic…", op: "deleteRow", danger: true })
        }
        if (catRow) items.push({ label: "New folder here…", op: "newFolder" })
        if (ctx.mode !== "rails" && !ctx.homeMode) items.push({ label: "Grid size for this page…", sub: ctx.grid.cols + " × " + ctx.grid.rows + (ctx.ownGrid ? " (this page)" : " (from Theme Settings)"), op: "pageGrid" })
        items.push({ label: "New mosaic…", op: "newCat" })
        items.push({ label: "Add a game from a file…", op: "addGame" })
        items.push({ label: "Add an app from a file…", op: "addApp" })
        items.push({ label: "Scan for games", op: "scan" })
        return w.pick("Options", items).then(function (it) { return it ? runOption(it.op, t, ctx) : null })
    }
    function runOption(op, t, ctx) {
        var pinOps = { addGame: 1, addApp: 1, scan: 1, addWidget: 1, deleteItem: 1, deleteTile: 1, deleteRow: 1, deleteFiles: 1, removeFromRow: 1 }
        return (pinOps[op] ? w.requirePin() : Promise.resolve(true)).then(function (ok) {
            if (!ok) return null
            var into = ctx.catId || undefined
            var yes = function (q, label, then) { return w.confirmYes(q, label).then(function (y) { if (y) return then() }) }
            switch (op) {
            case "addWidget": return w.addWidget()
            case "pageGrid": return pageGrid(ctx)
            case "addTo": return addTo(t, ctx.catId)
            case "resize": return w.placeExisting(t)
            case "removeFromRow": return lib("removeEntry", { catId: ctx.catId, ref: t.id })
            case "renameTile": return rename("renameCategory", t.id, t.title)
            case "renameItem": return rename("renameItem", t.id, t.title)
            case "pickArt": return browse("pickArt", undefined, t.id)
            case "clearArt": return lib("clearArt", { id: t.id })
            case "deleteTile": return yes("Delete “" + t.title + "”?", "Delete (things inside are kept)", function () { return lib("deleteCategory", { id: t.id }) })
            case "deleteItem": return yes("Remove “" + t.title + "” from your library?", "Remove (files are not touched)", function () { return lib("deleteItem", { id: t.id }) })
            case "deleteFiles": return yes("Delete “" + t.title + "” and its files from your Tessera folder? This can't be undone.", "Delete files", function () { return lib("deleteFiles", { id: t.id }) })
            case "renameRow": return rename("renameCategory", ctx.catId, ctx.catTitle)
            case "moveL": case "moveR": return lib("moveTab", { id: ctx.page, dir: op === "moveL" ? -1 : 1 })
            case "deleteRow": return yes("Delete “" + ctx.catTitle + "”?", "Delete (your games and apps are kept)", function () {
                if (ctx.inFolder) w.leaveFolder(); else w.leavePage()
                return lib("deleteCategory", { id: ctx.catId })
            })
            case "newFolder": return w.newFolder(into)
            case "newCat": return w.newMosaic()
            case "addGame": return browse("addGame", into)
            case "addApp": return browse("addApp", into)
            case "scan": return scan(into)
            }
        })
    }
}
