// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the active theme, worked out from the settings the full Ludus's main process sends
// (prefs.theme.settings: every value already checked there) the same way the full Ludus's page
// does it (renderer/look.js applyTheme, style.css). Everything on screen reads its look from here.
import QtQuick
import "color.js" as Color

QtObject {
    id: th
    property var theme: null          // view.prefs.theme
    property real screenW: 1920
    property real screenH: 1080
    property var shell: ({})          // shellData from ludus.py (shell-layout.js)

    function find(id) {
        var list = theme && theme.settings ? theme.settings : []
        for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i]
        return null
    }
    function val(id, fallback) { var s = find(id); return s && s.value !== undefined && s.value !== null ? s.value : fallback }
    function hex(id, fallback) { var v = val(id, fallback); return /^#[0-9a-fA-F]{6}$/.test(v) ? v : fallback }
    function px(id, fallback) { var v = parseFloat(val(id, fallback)); return isNaN(v) ? parseFloat(fallback) : v }
    function pct(id, fallback) { var s = find(id); return s ? s.value * (s.scale || 1) : fallback }

    // ---- scale: --auto follows the resolution, the person's choices sit on top
    readonly property real auto: Math.min(2.5, Math.max(0.6, Math.min(screenW / 1920, screenH / 1080)))
    readonly property real fontScale: pct("fontScale", 1)
    readonly property real rem: 16 * auto * fontScale
    readonly property real use: pct("screenUse", 1)
    readonly property real vw: screenW / 100
    readonly property real vh: screenH / 100
    function clamp(lo, v, hi) { return Math.max(lo, Math.min(hi, v)) }
    readonly property real edge: clamp(18, 5 * vw, 96)

    // ---- colors
    readonly property color bg: hex("bg", "#10151c")
    readonly property color card: hex("card", "#1a222c")
    readonly property color panel: hex("panel", "#161d27")
    readonly property color text: hex("text", "#e9e4d8")
    readonly property color muted: hex("muted", "#8b95a3")
    readonly property color accent: hex("accent", "#7fb2ff")
    readonly property color border: hex("border", "#3b475a")
    readonly property color ok: hex("confirm", "#3ddc97")
    readonly property color danger: hex("cancel", "#ff6b6b")
    readonly property color accentInk: Color.onColor(hex("accent", "#7fb2ff"))
    readonly property color okInk: Color.onColor(hex("confirm", "#3ddc97"))
    readonly property color dangerInk: Color.onColor(hex("cancel", "#ff6b6b"))
    readonly property string tone: Color.lumOf(hex("bg", "#10151c")) < 0.3 ? "dark" : "light"
    function mix(a, b, t) { return Qt.rgba(a.r * (1 - t) + b.r * t, a.g * (1 - t) + b.g * t, a.b * (1 - t) + b.b * t, a.a * (1 - t) + b.a * t) }
    function alpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }

    // ---- shape
    readonly property real cardRadius: parts.card === "metro" ? 2 : px("radius", "14px")
    readonly property real radius: px("radius", "14px")
    readonly property real borderW: px("borderW", "0px")
    readonly property real shadow: pct("shadow", 1)
    readonly property real tabShadow: pct("tabShadow", 1)
    readonly property string addTile: ["dashed", "solid", "none"].indexOf(val("addTile", "dashed")) >= 0 ? val("addTile", "dashed") : "dashed"
    readonly property string setIcons: ["animated", "still", "off"].indexOf(val("setIcons", "animated")) >= 0 ? val("setIcons", "animated") : "animated"
    readonly property real clockScale: pct("clockScale", 1)
    readonly property string tabAlign: ["center", "flex-start", "flex-end"].indexOf(val("tabAlign", "center")) >= 0 ? val("tabAlign", "center") : "center"
    readonly property real ring: px("selectRing", "3px")

    // ---- background
    readonly property string fx: val("backdrop", "none")
    readonly property bool hasPicture: val("background", "") !== ""
    readonly property real bgDim: pct("bgDim", 0.5)
    readonly property bool motion: val("motion", true) !== false
    readonly property bool pastel: val("selColor", "accent") === "pastel"
    readonly property string widgetStyle: ["glass", "frosted", "outline", "solid"].indexOf(val("widgetStyle", "frosted")) >= 0 ? val("widgetStyle", "frosted") : "frosted"
    readonly property real widgetTint: pct("widgetTint", 0.3)       // frosted: how much of the card color
    readonly property real widgetClear: pct("widgetClear", 0.6)     // glass: how see-through
    readonly property color widgetColor: hex("widgetColor", "#ffffff")  // solid
    readonly property bool widgetSheen: val("widgetSheen", true) !== false

    // ---- layout (renderer/home.js layoutCfg)
    readonly property string mode: ["grid", "flow"].indexOf(val("layout", "rails")) >= 0 ? val("layout", "rails") : "rails"
    readonly property var gridSize: {
        var m = /^c(\d+)r(\d+)$/.exec(val("gridPreset", "c5r3") || "")
        var c = m ? Number(m[1]) : Number(val("gridCols", 5)) || 5
        var r = m ? Number(m[2]) : Number(val("gridRows", 3)) || 3
        return { cols: clamp(2, c, 12), rows: clamp(1, r, 8) }
    }
    readonly property real gapPct: clamp(20, Number(val("tileGap", 100)) || 100, 240)

    // ---- the arrangement and its parts (shell-layout.js resolveParts)
    readonly property string shellLayout: (shell.presets && shell.presets[val("shellLayout", "classic")]) ? val("shellLayout", "classic") : "classic"
    readonly property var parts: {
        var base = (shell.presetParts && shell.presetParts[shellLayout]) || { nav: "top", tabs: "pills", clock: "off", frame: "glow", title: "below", tile: "portrait", size: "medium", row: "center", card: "standard", spot: "off", emblem: "none", hints: "center" }
        var ids = { nav: "partNav", tabs: "partTabs", clock: "partClock", frame: "partFrame", title: "partTitle", tile: "partTile", size: "partSize", row: "partRow", card: "partCard", spot: "partSpot", emblem: "partEmblem", hints: "partHints" }
        var out = {}
        for (var k in base) out[k] = base[k]
        for (var p in ids) {
            var v = val(ids[p], "auto")
            if (shell.parts && shell.parts[p] && shell.parts[p].indexOf(v) >= 0) out[p] = v
        }
        return out
    }
    readonly property bool vertical: parts.nav === "left"
    readonly property bool navBottom: parts.nav === "bottom" || parts.nav === "bottom-dock" || parts.nav === "bottom-bar"
    readonly property string contentEntry: vertical ? "right" : navBottom ? "up" : "down"

    // ---- tile size (style.css: --card-w / --card-h by tile shape and size)
    readonly property var cardSize: {
        var t = parts.tile, s = parts.size
        if (t === "square") {
            var w = s === "small" ? clamp(92, 18 * vh, 200) : s === "large" ? clamp(140, 30 * vh, 330) : clamp(110, 24 * vh, 260)
            return { w: w, h: w, aspect: 1 }
        }
        if (t === "wide") {
            if (s === "small") return { w: clamp(130, 220 * auto, 250), h: clamp(80, 132 * auto, 150), aspect: 0.6 }
            if (s === "large") return { w: clamp(220, 380 * auto, 440), h: clamp(132, 228 * auto, 264), aspect: 0.6 }
            return { w: clamp(168, 290 * auto, 330), h: clamp(110, 174 * auto, 200), aspect: 0.6 }
        }
        if (s === "small") return { w: 180 * auto, h: 225 * auto, aspect: 0 }
        if (s === "large") return { w: 300 * auto, h: 375 * auto, aspect: 0 }
        return { w: 240 * auto, h: 300 * auto, aspect: 0 }
    }
    readonly property real railGap: 28 * auto

    // ---- the selector glow: the highlight color, or a new random pastel at every new place
    property color glow: accent
    property color glowRing: accent
    property string glowAt: ""
    function moved(sig) {
        if (!pastel) { glow = accent; glowRing = accent; glowAt = ""; return }
        if (sig === glowAt) return
        glowAt = sig
        var p = Color.nextPastel(tone)
        glow = p.glow
        glowRing = p.ring
    }
    onPastelChanged: moved("")
    onAccentChanged: if (!pastel) { glow = accent; glowRing = accent }
}
