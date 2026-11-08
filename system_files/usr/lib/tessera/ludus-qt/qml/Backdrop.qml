// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): what's behind everything: the theme's color, its picture (dimmed), its backdrop
// effect (glow, mystic, mosaic tiles, drifting cubes, pinstripes; style.css body::after) and the
// selection's art filling the screen (part "spot").
import QtQuick

Item {
    id: back
    property Theme th
    property string picture: ""      // a data: URL from the main process (settings › themeImage)
    property string spotArt: ""      // image://art/… of the selection, for part "spot"

    Rectangle { anchors.fill: parent; color: th.bg }
    Image {
        anchors.fill: parent
        visible: th.hasPicture && back.picture !== ""
        source: th.hasPicture ? back.picture : ""
        fillMode: Image.PreserveAspectCrop
        asynchronous: true
    }
    Rectangle { anchors.fill: parent; visible: th.hasPicture && back.picture !== ""; color: th.bg; opacity: th.bgDim }

    Canvas {
        id: fx
        anchors.fill: parent
        visible: th.fx !== "none"
        property real drift: 0
        onPaint: {
            var c = getContext("2d"), w = width, h = height
            c.reset()
            function rgba(col, a) { return "rgba(" + Math.round(col.r * 255) + "," + Math.round(col.g * 255) + "," + Math.round(col.b * 255) + "," + a + ")" }
            function ellipse(cx, cy, rx, ry, col, a) {
                c.save()
                c.translate(cx, cy)
                c.scale(1, ry / rx)
                var g = c.createRadialGradient(0, 0, 0, 0, 0, rx)
                g.addColorStop(0, rgba(col, a))
                g.addColorStop(0.7, rgba(col, 0))
                c.fillStyle = g
                c.fillRect(-rx * 1.2, -rx * 1.2, rx * 2.4, rx * 2.4)
                c.restore()
            }
            var light = th.tone === "light"
            if (th.fx === "glow") {
                ellipse(0.08 * w, 0, 0.6 * w, 0.5 * h, th.accent, light ? 0.24 : 0.38)
                ellipse(w, h, 0.55 * w, 0.45 * h, th.ok, light ? 0.20 : 0.32)
            } else if (th.fx === "mystic") {
                ellipse(0.5 * w, -0.1 * h, 0.7 * w, 0.55 * h, th.accent, 0.34)
                ellipse(0.9 * w, 1.1 * h, 0.5 * w, 0.4 * h, th.ok, 0.2)
                var stars = [[18, 28, .55], [74, 18, .45], [42, 72, .35], [88, 58, .5], [8, 82, .4], [60, 40, .3]]
                for (var i = 0; i < stars.length; i++) {
                    c.fillStyle = "rgba(255,255,255," + stars[i][2] + ")"
                    c.beginPath(); c.arc(stars[i][0] / 100 * w, stars[i][1] / 100 * h, 1.4, 0, Math.PI * 2); c.fill()
                }
            } else if (th.fx === "tiles") {
                // pastel (or jewel, on a dark page) tiles in a 6x6 pattern, fading out toward the middle
                var dark = th.tone === "dark"
                var cols = dark ? ["#ff6b9a", "#ff9f5a", "#ffd75e", "#5fe0a8", "#4cc9f0", "#6f8bff", "#b07cff"]
                                : ["#ffc4d6", "#ffd9b0", "#fff0b3", "#d2f2c4", "#bdeee5", "#c4dcff", "#dccbff"]
                var op = dark ? 0.24 : 0.62
                var cell = 40 * th.auto, pat = [[0, 0, .35], [2, 0, .65], [4, 0, .65], [5, 0, .35], [1, 1, .65], [3, 1, .35], [0, 2, .35], [1, 2, 1], [4, 2, .65], [5, 2, 1],
                           [0, 3, .65], [1, 3, .35], [2, 3, 1], [4, 3, 1], [5, 3, .35], [2, 4, .35], [3, 4, 1], [5, 4, .65], [0, 5, .65], [1, 5, .35], [2, 5, .65]]
                for (var by = 0; by < h; by += cell * 6) for (var bx = 0; bx < w; bx += cell * 6) for (var k = 0; k < pat.length; k++) {
                    var x = bx + pat[k][0] * cell + 3 * th.auto, y = by + pat[k][1] * cell + 3 * th.auto
                    var dx = (x / w - 0.5) / 0.6, dy = (y / h - 0.5) / 0.55, d = Math.sqrt(dx * dx + dy * dy)
                    var fade = Math.max(0, Math.min(1, (d - 0.38) / 0.62))
                    if (fade <= 0) continue
                    var t = (x / w + y / h * 0.47) / 1.47
                    c.fillStyle = cols[Math.min(cols.length - 1, Math.floor(t * cols.length))]
                    c.globalAlpha = op * pat[k][2] * fade
                    var s = 34 * th.auto, r = 7 * th.auto
                    c.beginPath(); c.roundedRect(x, y, s, s, r, r); c.fill()
                }
                c.globalAlpha = 1
            } else if (th.fx === "cubes") {
                ellipse(0.3 * w, 0.2 * h, 0.6 * w, 0.6 * h, th.accent, 0.16)
                c.strokeStyle = "rgba(185,168,255,0.13)"
                c.lineWidth = 2
                var tw = 360, tht = 312
                function cube(x, y, s) {
                    c.beginPath()
                    c.moveTo(x, y - s); c.lineTo(x + 0.87 * s, y - s / 2); c.lineTo(x + 0.87 * s, y + s / 2); c.lineTo(x, y + s)
                    c.lineTo(x - 0.87 * s, y + s / 2); c.lineTo(x - 0.87 * s, y - s / 2); c.closePath()
                    c.moveTo(x - 0.87 * s, y - s / 2); c.lineTo(x, y); c.lineTo(x + 0.87 * s, y - s / 2); c.moveTo(x, y); c.lineTo(x, y + s)
                    c.stroke()
                }
                var ox = (fx.drift * tw) % tw, oy = -(fx.drift * tht) % tht
                for (var ty = -tht; ty < h + tht; ty += tht) for (var tx = -tw; tx < w + tw; tx += tw) {
                    cube(tx + ox + 90, ty + oy + 104, 90)
                    cube(tx + ox + 270, ty + oy + 262, 62)
                }
            } else if (th.fx === "stripes") {
                var g2 = c.createLinearGradient(0, 0, 0, h * 0.4)
                g2.addColorStop(0, "rgba(255,255,255,0.65)"); g2.addColorStop(1, "rgba(255,255,255,0)")
                c.fillStyle = g2; c.fillRect(0, 0, w, h * 0.4)
                c.fillStyle = "rgba(0,0,0,0.035)"
                for (var sy = 3; sy < h; sy += 4) c.fillRect(0, sy, w, 1)
            }
        }
        NumberAnimation on drift { running: th.fx === "cubes" && th.motion; from: 0; to: 1; duration: 60000; loops: Animation.Infinite }
        onDriftChanged: if (th.fx === "cubes") requestPaint()
        Connections { target: th; function onFxChanged() { fx.requestPaint() } function onToneChanged() { fx.requestPaint() } function onAccentChanged() { fx.requestPaint() } }
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
    }

    // ---- part "spot": the selection's art behind everything, shaded so the menu stays readable
    Item {
        anchors.fill: parent
        visible: th.parts.spot === "on"
        Image {
            anchors.fill: parent
            source: back.spotArt
            fillMode: Image.PreserveAspectCrop
            verticalAlignment: Image.AlignTop
            asynchronous: true
            opacity: status === Image.Ready ? 1 : 0
            Behavior on opacity { enabled: th.motion; NumberAnimation { duration: 500 } }
        }
        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: th.alpha(th.bg, 0.92) }
                GradientStop { position: 0.45; color: th.alpha(th.bg, 0.55) }
                GradientStop { position: 1; color: th.alpha(th.bg, 0.2) }
            }
        }
        Rectangle {
            anchors.fill: parent
            gradient: Gradient {
                GradientStop { position: 0; color: th.alpha(th.bg, 0.7) }
                GradientStop { position: 0.28; color: "transparent" }
                GradientStop { position: 0.5; color: "transparent" }
                GradientStop { position: 1; color: th.bg }
            }
        }
    }
}
