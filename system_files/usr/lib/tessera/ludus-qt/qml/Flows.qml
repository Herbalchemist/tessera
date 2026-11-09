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
}
