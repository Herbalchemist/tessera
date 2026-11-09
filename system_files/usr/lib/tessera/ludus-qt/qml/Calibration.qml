// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): display calibration, the test patterns and the steps (calibration.js). Done by eye, so it
// is a good correction rather than a lab one. The result is a few numbers; Main.qml draws them over the
// whole screen with a shader (calibrate.frag) while the steps run and afterwards.
import QtQuick

Rectangle {
    id: cal
    property Theme th
    property string mode: "quick"
    property int idx: 0
    property var work: ({})
    property bool compare: false
    property var resolve: null
    property var defs: []
    signal filter(var c)          // what should show through the screen right now (null: none)
    visible: false
    color: def ? def.bg : "#000"

    readonly property var ranges: ({ black: [-0.1, 0.1], white: [0.8, 1], gamma: [0.6, 1.6], gain: [0.85, 1], sat: [0.5, 1.5] })
    readonly property real targetGamma: 2.2
    readonly property var chips: [[0.85, 0.25, 0.25], [0.9, 0.85, 0.25], [0.25, 0.75, 0.35], [0.25, 0.8, 0.85], [0.3, 0.4, 0.9], [0.85, 0.3, 0.8]]
    readonly property var flows: ({
        quick: ["black", "gamma50", "warm", "review"],
        thorough: ["black", "white", "gamma25", "gamma50", "gamma75", "gammaR", "gammaG", "gammaB", "warm", "tint", "sat", "review"]
    })
    readonly property var def: defs.length ? defs[idx] : null
    readonly property color ink: def && def.bg === "#000" ? "#9a9a9a" : "#111111"
    readonly property var names: ["A", "B", "X", "Y", "LB", "RB"]

    function clamp(v, r) { return Math.min(r[1], Math.max(r[0], v)) }
    function newWork() { return { brightness: 0, whiteLevel: 100, g25: 2.2, g50: 2.2, g75: 2.2, gr: 2.2, gg: 2.2, gb: 2.2, warm: 0, tint: 0, sat: 100 } }
    function fromWork(w, mode, layers) {
        var all = !layers
        var on = function (l) { return all || layers.indexOf(l) >= 0 }
        var c = { black: 0, white: 1, gamma: [1, 1, 1], gain: [1, 1, 1], sat: 1 }
        if (on("black")) c.black = clamp(-w.brightness / 100, ranges.black)
        if (on("white")) c.white = clamp(w.whiteLevel / 100, ranges.white)
        if (on("gamma")) {
            var lum = mode === "quick" ? w.g50 : (w.g25 + w.g50 + w.g75) / 3
            var mean = (w.gr + w.gg + w.gb) / 3
            var per = mode === "quick" ? [0, 0, 0] : [w.gr - mean, w.gg - mean, w.gb - mean]
            c.gamma = per.map(function (d) { return clamp(targetGamma / (lum + d), ranges.gamma) })
        }
        if (on("gain")) {
            var t = w.warm / 10, u = w.tint / 10, g = [1, 1, 1]
            if (t > 0) g[2] *= 1 - 0.12 * t; else g[0] *= 1 + 0.12 * t
            if (u > 0) g[1] *= 1 - 0.1 * u; else { g[0] *= 1 + 0.06 * u; g[2] *= 1 + 0.06 * u }
            c.gain = g.map(function (x) { return clamp(x, ranges.gain) })
        }
        if (on("sat")) c.sat = clamp(w.sat / 100, ranges.sat)
        return c
    }
    function round(v, n) { return Number(v.toFixed(n || 0)) }
    function signed(v) { return (v > 0 ? "+" : "") + v }
    function grey(v) { v = Math.min(1, Math.max(0, v)); return Qt.rgba(v, v, v, 1) }
    function rgbOf(c) { return Qt.rgba(c[0], c[1], c[2], 1) }
    function luma(c) { return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] }
    function region(fw, fh) {
        var ww = Math.round(width * fw), hh = Math.round(height * fh)
        return { x: Math.round((width - ww) / 2), y: Math.round((height - hh) / 2) + Math.round(height * 0.02), w: ww, h: hh }
    }

    // ---- the steps: what to show, what to adjust, and which parts of the correction are visible while it does
    function gammaStep(id, title, key, light, tint, extra) {
        return {
            id: id, title: title, bg: "#000", layers: [], kind: "gamma", light: light, tint: tint, key: key,
            help: "Sit back from the screen and squint a little. Adjust until the middle square looks the same brightness as the lines around it." + (extra || ""),
            min: 1.6, max: 3.2, step: 0.02, coarse: 0.1, dflt: 2.2,
            get: function (w) { return w[key] }, set: function (w, v) { w[key] = round(v, 2) },
            label: function (v) { return "Gamma " + v.toFixed(2) }
        }
    }
    function stepDef(id) {
        switch (id) {
        case "black": return { id: id, title: "Brightness", bg: "#000", layers: ["black"], kind: "bars", levels: [0.02, 0.04, 0.06, 0.08, 0.12], text: 0.4, min: -10, max: 10, step: 1, coarse: 3, dflt: 0,
            help: "Adjust until bar 1 just disappears into the black, and bar 2 is faintly visible.",
            get: function (w) { return w.brightness }, set: function (w, v) { w.brightness = Math.round(v) }, label: function (v) { return "Brightness " + signed(v) } }
        case "white": return { id: id, title: "White level", bg: "#ffffff", layers: ["black", "white"], kind: "bars", levels: [0.98, 0.96, 0.94, 0.92, 0.88], text: 0.3, min: 85, max: 100, step: 1, coarse: 3, dflt: 100,
            help: "Lower it until you can just tell bar 1 apart from the white background. Leave it at 100% if you already can.",
            get: function (w) { return w.whiteLevel }, set: function (w, v) { w.whiteLevel = Math.round(v) }, label: function (v) { return "White level " + v + "%" } }
        case "gamma25": return gammaStep(id, "Gamma · dark tones", "g25", 0.25, [1, 1, 1], " (This one is the dark tones.)")
        case "gamma50": return gammaStep(id, "Gamma · middle tones", "g50", 0.5, [1, 1, 1])
        case "gamma75": return gammaStep(id, "Gamma · bright tones", "g75", 0.75, [1, 1, 1], " (This one is the bright tones.)")
        case "gammaR": return gammaStep(id, "Red balance", "gr", 0.5, [1, 0, 0], " Only red is lit here.")
        case "gammaG": return gammaStep(id, "Green balance", "gg", 0.5, [0, 1, 0], " Only green is lit here.")
        case "gammaB": return gammaStep(id, "Blue balance", "gb", 0.5, [0, 0, 1], " Only blue is lit here.")
        case "warm": return { id: id, title: "White balance", bg: "#808080", layers: ["black", "white", "gamma", "gain"], kind: "greys", min: -10, max: 10, step: 1, coarse: 3, dflt: 0,
            help: "These greys should look neutral. If they look blue, move toward Warmer. If they look yellow or orange, move toward Cooler.",
            get: function (w) { return w.warm }, set: function (w, v) { w.warm = Math.round(v) }, label: function (v) { return v === 0 ? "Neutral" : v > 0 ? "Warmer " + v : "Cooler " + (-v) } }
        case "tint": return { id: id, title: "Tint", bg: "#808080", layers: ["black", "white", "gamma", "gain"], kind: "greys", min: -10, max: 10, step: 1, coarse: 3, dflt: 0,
            help: "Still neutral grey? If they look green, move toward Pinker. If they look pink or purple, move toward Greener.",
            get: function (w) { return w.tint }, set: function (w, v) { w.tint = Math.round(v) }, label: function (v) { return v === 0 ? "Neutral" : v > 0 ? "Pinker " + v : "Greener " + (-v) } }
        case "sat": return { id: id, title: "Colour", bg: "#808080", layers: ["black", "white", "gamma", "gain", "sat"], kind: "chips", min: 60, max: 140, step: 2, coarse: 10, dflt: 100,
            help: "Pick the colour strength that looks natural: rich, but not glowing. The grey swatches show what no colour looks like.",
            get: function (w) { return w.sat }, set: function (w, v) { w.sat = Math.round(v) }, label: function (v) { return "Colour " + v + "%" } }
        }
        return { id: "review", title: "Check the result", bg: "#808080", layers: null, review: true, kind: "review" }
    }

    // ---- the patterns, as plain rectangles (drawn at the screen's own pixels, so lines stay one pixel wide)
    function pattern(d, w) {
        var out = [], r, i
        if (d.kind === "bars") {
            r = region(0.7, 0.4)
            var n = d.levels.length, bw = Math.round(r.w / (n * 1.6)), gap = Math.round(bw * 0.6)
            var total = n * bw + (n - 1) * gap, x0 = Math.round((width - total) / 2)
            for (i = 0; i < n; i++) out.push({ x: x0 + i * (bw + gap), y: r.y, w: bw, h: r.h, c: grey(d.levels[i]), t: String(i + 1), tc: grey(d.text), ty: r.y + r.h + Math.round(height * 0.06) })
        } else if (d.kind === "gamma") {
            r = region(0.62, 0.5)
            var v = Math.pow(d.light, 1 / w[d.key]), s = Math.round(Math.min(r.w, r.h) * 0.5)
            out.push({ x: r.x + Math.round((r.w - s) / 2), y: r.y + Math.round((r.h - s) / 2), w: s, h: s, c: Qt.rgba(v * d.tint[0], v * d.tint[1], v * d.tint[2], 1), z: 1 })
        } else if (d.kind === "greys") {
            r = region(0.78, 0.46)
            var lv = [0.15, 0.3, 0.5, 0.7, 0.85], gw = Math.round(r.w / lv.length)
            for (i = 0; i < lv.length; i++) out.push({ x: r.x + i * gw, y: r.y, w: gw, h: r.h, c: grey(lv[i]) })
        } else if (d.kind === "chips") {
            r = region(0.78, 0.5)
            var cw = Math.round(r.w / chips.length)
            for (i = 0; i < chips.length; i++) {
                out.push({ x: r.x + i * cw, y: r.y, w: cw, h: Math.round(r.h * 0.62), c: rgbOf(chips[i]) })
                out.push({ x: r.x + i * cw, y: r.y + Math.round(r.h * 0.62), w: cw, h: Math.round(r.h * 0.38), c: grey(luma(chips[i])) })
            }
        } else {
            r = region(0.78, 0.5)
            var ramp = 48, rw = Math.round(r.w / ramp)
            for (i = 0; i < ramp; i++) out.push({ x: r.x + i * rw, y: r.y, w: rw, h: Math.round(r.h * 0.2), c: grey(i / (ramp - 1)) })
            var cy = r.y + Math.round(r.h * 0.24), bw2 = Math.round(r.w / (chips.length + 1)), ch = Math.round(r.h * 0.34)
            for (i = 0; i < chips.length; i++) out.push({ x: r.x + i * bw2, y: cy, w: bw2, h: ch, c: rgbOf(chips[i]) })
            out.push({ x: r.x + chips.length * bw2, y: cy, w: bw2, h: ch, c: Qt.rgba(224 / 255, 172 / 255, 140 / 255, 1) })     // a skin tone
            var levels = [0.1, 0.25, 0.4, 0.55, 0.7, 0.85, 1], gw2 = Math.round(r.w / levels.length)
            for (i = 0; i < levels.length; i++) out.push({ x: r.x + i * gw2, y: cy + ch + Math.round(r.h * 0.04), w: gw2, h: Math.round(r.h * 0.18), c: grey(levels[i]) })
        }
        return out
    }
    property var rects: []
    property int tick: 0
    property int lineStep: -1
    function redraw() {
        if (!def) { rects = []; return }
        rects = pattern(def, work)
        var f
        if (compare) f = null
        else if (def.layers && def.layers.length === 0) f = null      // gamma steps measure the screen as it is
        else f = fromWork(work, mode, def.layers)
        filter(f)
        tick++
    }
    readonly property var lineRect: region(0.62, 0.5)
    // a 2 x 2 BMP, made here: which of its pixels are lit says how much light the lines give
    function tileOf(light, tint) {
        var hi = [Math.round(tint[0] * 255), Math.round(tint[1] * 255), Math.round(tint[2] * 255)]
        var lit = function (x, y) {
            if (light === 0.5) return y === 0
            if (light === 0.25) return x === 0 && y === 0
            return !(x === 0 && y === 0)
        }
        var bytes = []
        var le = function (v, n) { for (var k = 0; k < n; k++) bytes.push((v >> (8 * k)) & 255) }
        bytes.push(0x42, 0x4d); le(70, 4); le(0, 4); le(54, 4)                       // file header
        le(40, 4); le(2, 4); le(2, 4); le(1, 2); le(24, 2); le(0, 4); le(16, 4); le(0, 4); le(0, 4); le(0, 4); le(0, 4)     // 2 x 2, 24 bits, no compression
        for (var row = 1; row >= 0; row--) {      // bottom row first
            for (var x = 0; x < 2; x++) {
                var on = lit(x, row)
                bytes.push(on ? hi[2] : 0, on ? hi[1] : 0, on ? hi[0] : 0)
            }
            bytes.push(0, 0)
        }
        var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/", out = ""
        for (var i = 0; i < bytes.length; i += 3) {
            var n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0)
            out += chars[(n >> 18) & 63] + chars[(n >> 12) & 63] + (i + 1 < bytes.length ? chars[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? chars[n & 63] : "=")
        }
        return "data:image/bmp;base64," + out
    }
    function summary() {
        var w = work
        var lum = mode === "quick" ? w.g50 : (w.g25 + w.g50 + w.g75) / 3
        var lines = ["Brightness " + signed(w.brightness), "Gamma " + lum.toFixed(2) + " (target " + targetGamma + ")"]
        if (mode !== "quick") lines.splice(1, 0, "White level " + w.whiteLevel + "%")
        lines.push(w.warm || w.tint ? "Balance " + (w.warm ? (w.warm > 0 ? "warmer" : "cooler") : "") + (w.warm && w.tint ? ", " : "") + (w.tint ? (w.tint > 0 ? "pinker" : "greener") : "") : "Balance neutral")
        if (mode !== "quick") lines.push("Colour " + w.sat + "%")
        return lines.join("   ·   ")
    }
    function begin(m, cb) {
        mode = m
        defs = flows[m].map(stepDef)
        idx = 0; compare = false; lineStep = -1
        work = newWork()
        resolve = cb
        visible = true
        redraw()
    }
    function end(save) {
        var c = save ? Object.assign(fromWork(work, mode), { mode: mode }) : null
        visible = false
        var f = resolve
        resolve = null
        filter(undefined)         // back to the saved calibration
        if (f) f(c)
    }
    function adjust(dir, big) {
        if (!def || def.review) return
        def.set(work, clamp(def.get(work) + (big ? def.coarse : def.step) * dir, [def.min, def.max]))
        work = Object.assign({}, work)
        redraw()
    }
    function press(a) {
        if (a === "left") return adjust(-1, false)
        if (a === "right") return adjust(1, false)
        if (a === "down" || a === "lb") return adjust(-1, true)
        if (a === "up" || a === "rb") return adjust(1, true)
        if (a === "x") { if (!def.review) { def.set(work, def.dflt); work = Object.assign({}, work); redraw() } return }
        if (a === "y") { compare = !compare; redraw(); return }
        if (a === "a") { if (def.review) return end(true); idx++; compare = false; return redraw() }
        if (a === "b") { if (idx === 0) return end(false); idx--; compare = false; return redraw() }
    }
    onWidthChanged: if (visible) { lineStep = -1; Qt.callLater(redraw) }
    onHeightChanged: if (visible) Qt.callLater(redraw)

    Repeater {
        model: cal.rects
        delegate: Item {
            x: modelData.x; y: modelData.y; width: modelData.w; height: modelData.h
            z: modelData.z || 0
            Rectangle { anchors.fill: parent; color: modelData.c }
            Text {
                visible: !!modelData.t
                x: (parent.width - width) / 2
                y: modelData.ty ? modelData.ty - modelData.y - font.pixelSize : 0
                text: modelData.t || ""
                color: modelData.tc || "#999"
                font.pixelSize: Math.round(cal.height * 0.035)
            }
        }
    }
    Image {       // the fine lines of a gamma step: a 2 x 2 pixel tile, repeated (the middle square sits on top)
        x: cal.lineRect.x; y: cal.lineRect.y; width: cal.lineRect.w; height: cal.lineRect.h
        visible: Boolean(cal.def && cal.def.kind === "gamma")
        source: cal.def && cal.def.kind === "gamma" ? cal.tileOf(cal.def.light, cal.def.tint) : ""
        fillMode: Image.Tile
        smooth: false
        mipmap: false
        cache: false
    }
    Column {
        x: 0.04 * cal.width; y: 0.012 * cal.height
        width: cal.width * 0.92
        spacing: 0.006 * cal.height
        Text { text: (cal.mode === "quick" ? "Quick" : "Thorough") + " calibration · step " + (cal.idx + 1) + " of " + cal.defs.length + " · " + (cal.def ? cal.def.title : ""); color: cal.ink; opacity: 0.8; font.pixelSize: 0.022 * cal.height }
        Text {
            width: cal.width * 0.8
            wrapMode: Text.Wrap
            color: cal.ink
            font.pixelSize: 0.026 * cal.height
            text: !cal.def ? "" : cal.def.review ? (cal.compare ? "Showing your screen as it was." : "Showing the corrected screen.") + " Press Y to compare with how it was." : cal.def.help
        }
    }
    Column {
        anchors.bottom: parent.bottom
        x: 0.04 * cal.width
        width: cal.width * 0.92
        bottomPadding: 0.012 * cal.height
        spacing: 0.01 * cal.height
        Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            color: cal.ink
            font.pixelSize: 0.034 * cal.height
            text: !cal.def ? "" : cal.def.review ? cal.summary() : cal.def.label(cal.def.get(cal.work))
        }
        Rectangle {
            visible: Boolean(cal.def && !cal.def.review)
            anchors.horizontalCenter: parent.horizontalCenter
            width: cal.width * 0.4; height: 0.008 * cal.height; radius: height
            color: Qt.rgba(0.5, 0.5, 0.5, 0.35)
            Rectangle { height: parent.height; radius: height; color: cal.ink; width: cal.def && !cal.def.review ? parent.width * (cal.def.get(cal.work) - cal.def.min) / (cal.def.max - cal.def.min) : 0 }
        }
        Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            color: cal.ink
            opacity: 0.8
            font.pixelSize: 0.02 * cal.height
            text: !cal.def ? "" : "◀ ▶ adjust   " + cal.names[4] + " / " + cal.names[5] + " bigger steps   " + cal.names[0] + " " + (cal.def.review ? "Save" : "Next") + "   " + cal.names[1] + " " + (cal.idx === 0 ? "Cancel" : "Back") + "   " + cal.names[2] + " reset   " + cal.names[3] + " " + (cal.def.review ? "compare" : "see it as it was")
        }
    }
}
