// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the color wheel Theme Settings uses (colorWheel.js). Hue is the angle, saturation the
// distance from the centre, brightness its own bar. D-pad or left stick moves on the wheel, LB / RB
// change brightness, Y types a hex code, X undoes, A applies, B cancels.
import QtQuick
import QtQuick.Effects

Rectangle {
    id: cw
    property Theme th
    property string heading: ""
    property real hue: 0
    property real sat: 0
    property real val: 1
    property string orig: "#ffffff"
    property var resolve: null
    readonly property string hex: hsvToHex(hue, sat, val)
    readonly property real wheelSize: Math.min(36 * th.vh, 30 * th.rem)
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.82)

    function hsvToHex(h, s, v) {
        var f = function (n) {
            var k = (n + h / 60) % 6
            return v - v * s * Math.max(0, Math.min(k, 4 - k, 1))
        }
        return "#" + [f(5), f(3), f(1)].map(function (x) { var t = Math.round(x * 255).toString(16); return t.length < 2 ? "0" + t : t }).join("")
    }
    function hexToHsv(hx) {
        var n = parseInt(hx.slice(1), 16)
        var r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
        var mx = Math.max(r, g, b), d = mx - Math.min(r, g, b), h = 0
        if (d) h = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4
        return { h: h * 60, s: mx ? d / mx : 0, v: mx }
    }
    function open(title, start, cb) {
        orig = /^#[0-9a-f]{6}$/i.test(start) ? start : "#ffffff"
        var c = hexToHsv(orig)
        hue = c.h; sat = c.s; val = c.v
        heading = title
        resolve = cb
        visible = true
        canvas.requestPaint()
    }
    function finish(r) {
        visible = false
        var f = resolve
        resolve = null
        if (f) f(r)
    }
    function move(dx, dy) {
        var a = hue * Math.PI / 180
        var x = sat * Math.cos(a) + dx, y = sat * Math.sin(a) + dy
        var len = Math.hypot(x, y)
        if (len > 1) { x /= len; y /= len }
        sat = Math.min(1, len)
        if (len > 0.0001) hue = ((Math.atan2(y, x) * 180 / Math.PI) + 360) % 360
    }
    function press(a) {
        var step = 0.04
        if (a === "left") move(-step, 0)
        else if (a === "right") move(step, 0)
        else if (a === "up") move(0, -step)
        else if (a === "down") move(0, step)
        else if (a === "lb") { val = Math.max(0, val - 0.05); canvas.requestPaint() }
        else if (a === "rb") { val = Math.min(1, val + 0.05); canvas.requestPaint() }
        else if (a === "x") { var c = hexToHsv(orig); hue = c.h; sat = c.s; val = c.v; canvas.requestPaint() }
        else if (a === "a") finish({ color: hex })
        else if (a === "y") finish({ hex: true, color: hex })
        else if (a === "b") finish(null)
        th.moved("c|" + heading)
    }
    MouseArea { anchors.fill: parent; onClicked: cw.press("b") }

    Rectangle {
        id: box
        anchors.centerIn: parent
        width: Math.min(47.5 * th.rem, 90 * th.vw)
        height: body.height + 56
        radius: th.radius + 4
        color: th.panel
        layer.enabled: true
        layer.effect: MultiEffect { shadowEnabled: true; shadowColor: Qt.rgba(0, 0, 0, 0.6); shadowBlur: 1; blurMax: 64; shadowVerticalOffset: 24 }
        MouseArea { anchors.fill: parent }
        Column {
            id: body
            x: 32
            y: 28
            width: box.width - 64
            spacing: 16
            Text { width: parent.width; text: cw.heading; color: th.muted; font.pixelSize: 1.3 * th.rem; font.weight: Font.DemiBold; wrapMode: Text.Wrap }
            Row {
                spacing: 28
                Item {
                    width: cw.wheelSize
                    height: cw.wheelSize
                    Canvas {
                        id: canvas
                        anchors.fill: parent
                        onPaint: {
                            var ctx = getContext("2d")
                            var r = width / 2
                            ctx.reset()
                            ctx.save()
                            ctx.beginPath()
                            ctx.arc(r, r, r - 0.5, 0, Math.PI * 2)
                            ctx.clip()
                            // hue around the circle (clockwise from the right, as the angle runs on screen) ...
                            var cg = ctx.createConicalGradient(r, r, 0)
                            for (var i = 0; i <= 12; i++) cg.addColorStop(i / 12, cw.hsvToHex(((1 - i / 12) * 360) % 360, 1, cw.val))
                            ctx.fillStyle = cg
                            ctx.fillRect(0, 0, width, height)
                            // ... and the pale of low saturation toward the middle
                            var g = Math.round(cw.val * 255)
                            var rg = ctx.createRadialGradient(r, r, 0, r, r, r)
                            rg.addColorStop(0, "rgba(" + g + "," + g + "," + g + ",1)")
                            rg.addColorStop(1, "rgba(" + g + "," + g + "," + g + ",0)")
                            ctx.fillStyle = rg
                            ctx.fillRect(0, 0, width, height)
                            ctx.restore()
                        }
                    }
                    Rectangle {      // where the colour is
                        width: 18; height: 18; radius: 9
                        x: parent.width / 2 * (1 + cw.sat * Math.cos(cw.hue * Math.PI / 180)) - 9
                        y: parent.height / 2 * (1 + cw.sat * Math.sin(cw.hue * Math.PI / 180)) - 9
                        color: "transparent"
                        border.width: 3
                        border.color: "#ffffff"
                        Rectangle { anchors.fill: parent; anchors.margins: -2; radius: width / 2; color: "transparent"; border.width: 1; border.color: Qt.rgba(0, 0, 0, 0.6) }
                    }
                }
                Column {
                    spacing: 14
                    width: body.width - cw.wheelSize - 28
                    Row {
                        spacing: 10
                        Rectangle { width: 56; height: 56; radius: 10; color: cw.orig; border.width: 1; border.color: th.border }
                        Rectangle { width: 56; height: 56; radius: 10; color: cw.hex; border.width: 1; border.color: th.border }
                    }
                    Text { text: cw.hex.toUpperCase(); color: th.text; font.pixelSize: 1.5 * th.rem; font.weight: Font.DemiBold }
                    Rectangle {      // brightness
                        width: parent.width; height: 0.9 * th.rem; radius: 4
                        color: th.alpha(th.text, 0.13)
                        Rectangle { width: parent.width * cw.val; height: parent.height; radius: 4; color: th.accent }
                    }
                    Text {
                        width: parent.width
                        wrapMode: Text.Wrap
                        color: th.muted
                        font.pixelSize: 0.85 * th.rem
                        lineHeight: 1.3
                        text: "D-pad or left stick: move on the wheel\nLB / RB: brightness\nY: type a hex code   X: undo\nA: apply   B: cancel"
                    }
                }
            }
        }
    }
    onValChanged: canvas.requestPaint()
}
