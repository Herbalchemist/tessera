// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the controller test (padTest.js). What the system sees, live: every button and stick
// is drawn, and raw numbers sit underneath. Hold B for a second to close (a quick B is a test of B).
// The numbers come from ludus.py (padState.snapshot, read straight from Linux), after the person's
// stick calibration and deadzone.
import QtQuick

Rectangle {
    id: pt
    property Theme th
    property var pad: ({ deadzone: 15, trigger: 10 })      // view.prefs.pad
    property var calib: ({})                                // view.prefs.calibration-by-pad (offsets per controller id)
    property var snap: ({})
    signal closed()
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.9)
    readonly property var names: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "L3", "R3", "Up", "Down", "Left", "Right", "Guide"]
    property double bSince: 0
    property real bFrac: 0

    function snapshotNow() { return padState.snapshot() }
    function open() { snap = padState.snapshot(); bSince = 0; bFrac = 0; visible = true; art.requestPaint() }
    function close() { visible = false; closed() }
    // keys: with no controller there is nothing to hold, so B (Escape) just closes
    function press(a) { if (a === "b" && !(snap && snap.id)) close() }
    function ax(i) {
        var offs = (snap && snap.id && calib && calib[snap.id]) || []
        var v = (snap.axes ? snap.axes[i] : 0) - (offs[i] || 0)
        var dz = (pad.deadzone || 0) / 100, a = Math.abs(v)
        return a < dz ? 0 : (v < 0 ? -1 : 1) * Math.min(1, (a - dz) / (1 - dz))
    }
    function trig(n) { var v = snap.buttons ? snap.buttons[n] : 0; return v * 100 < (pad.trigger || 0) ? 0 : v }
    function on(n) { return snap.buttons ? snap.buttons[n] > 0.5 : false }

    Timer {
        interval: 33; repeat: true; running: pt.visible
        onTriggered: {
            pt.snap = padState.snapshot()
            art.requestPaint()
            if (pt.on(1)) {
                if (!pt.bSince) pt.bSince = Date.now()
                pt.bFrac = Math.min(1, (Date.now() - pt.bSince) / 1000)
                if (pt.bFrac >= 1) pt.close()
            } else { pt.bSince = 0; pt.bFrac = 0 }
        }
    }

    Column {
        anchors.centerIn: parent
        width: Math.min(pt.width * 0.92, 980)
        spacing: 8
        Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.text; font.pixelSize: 1.4 * th.rem; font.weight: Font.DemiBold; elide: Text.ElideRight
               text: pt.snap.id ? pt.snap.name : "No controller detected" }
        Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.muted; font.pixelSize: 0.85 * th.rem; wrapMode: Text.Wrap
               text: pt.snap.id ? "Standard layout  ·  17 buttons  ·  4 axes" + (pt.snap.count > 1 ? "  ·  " + pt.snap.count + " controllers connected" : "") : "Plug one in or turn it on, then press a button." }
        Canvas {
            id: art
            anchors.horizontalCenter: parent.horizontalCenter
            width: Math.min(parent.width, pt.height * 0.5 * 600 / 340); height: width * 340 / 600
            property real k: width / 600
            onPaint: {
                var c = getContext("2d")
                c.reset()
                c.scale(k, k)
                var lit = th.accent, line = th.border, fill = th.card
                var dot = function (x, y, r, on) { c.beginPath(); c.arc(x, y, r, 0, 6.2832); c.fillStyle = on ? lit : fill; c.fill(); c.lineWidth = 2; c.strokeStyle = on ? lit : line; c.stroke() }
                var box = function (x, y, w, h, r, on) { c.beginPath(); c.roundedRect(x, y, w, h, r, r); c.fillStyle = on ? lit : fill; c.fill(); c.lineWidth = 2; c.strokeStyle = on ? lit : line; c.stroke() }
                var label = function (t, x, y, on) { c.fillStyle = on ? th.accentInk : th.muted; c.font = "bold 13px sans-serif"; c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(t, x, y) }
                // body
                c.beginPath()
                c.moveTo(120, 70); c.lineTo(480, 70); c.quadraticCurveTo(560, 70, 575, 170); c.lineTo(590, 290); c.quadraticCurveTo(595, 330, 560, 322)
                c.quadraticCurveTo(520, 316, 495, 262); c.lineTo(105, 262); c.quadraticCurveTo(80, 316, 40, 322); c.quadraticCurveTo(5, 330, 10, 290)
                c.lineTo(25, 170); c.quadraticCurveTo(40, 70, 120, 70); c.closePath()
                c.fillStyle = th.panel; c.fill(); c.lineWidth = 2; c.strokeStyle = line; c.stroke()
                // shoulders and triggers
                box(95, 36, 120, 26, 10, pt.on(4)); label("LB", 155, 49, pt.on(4))
                box(385, 36, 120, 26, 10, pt.on(5)); label("RB", 445, 49, pt.on(5))
                box(105, 4, 100, 22, 6, false); c.fillStyle = lit; c.fillRect(105, 4, 100 * pt.trig(6), 22); label("LT", 155, 15, false)
                box(395, 4, 100, 22, 6, false); c.fillStyle = lit; c.fillRect(395, 4, 100 * pt.trig(7), 22); label("RT", 445, 15, false)
                // sticks: the ring lights on press, the dot follows the stick
                dot(170, 150, 46, pt.on(10)); dot(385, 245, 46, pt.on(11))
                dot(170 + pt.ax(0) * 26, 150 + pt.ax(1) * 26, 20, true)
                dot(385 + pt.ax(2) * 26, 245 + pt.ax(3) * 26, 20, true)
                // d-pad
                box(218, 200, 28, 34, 6, pt.on(12)); box(218, 250, 28, 34, 6, pt.on(13)); box(186, 232, 34, 28, 6, pt.on(14)); box(246, 232, 34, 28, 6, pt.on(15))
                // face buttons
                dot(480, 185, 22, pt.on(0)); label("A", 480, 185, pt.on(0))
                dot(520, 148, 22, pt.on(1)); label("B", 520, 148, pt.on(1))
                dot(440, 148, 22, pt.on(2)); label("X", 440, 148, pt.on(2))
                dot(480, 111, 22, pt.on(3)); label("Y", 480, 111, pt.on(3))
                // centre
                dot(262, 130, 13, pt.on(8)); dot(338, 130, 13, pt.on(9)); dot(300, 100, 16, pt.on(16))
            }
        }
        Text {
            width: parent.width; horizontalAlignment: Text.AlignHCenter; wrapMode: Text.Wrap; color: th.muted; font.pixelSize: 0.8 * th.rem
            text: pt.snap.id ? "Left stick " + pt.ax(0).toFixed(2) + ", " + pt.ax(1).toFixed(2) + "   ·   Right stick " + pt.ax(2).toFixed(2) + ", " + pt.ax(3).toFixed(2)
                               + "   ·   LT " + pt.trig(6).toFixed(2) + "   RT " + pt.trig(7).toFixed(2) : ""
        }
        // the raw numbers: which number is my A button?
        Flow {
            width: parent.width; spacing: 6
            layoutDirection: Qt.LeftToRight
            Repeater {
                model: pt.snap.id ? 17 : 0
                delegate: Rectangle {
                    width: 30; height: 26; radius: 6
                    color: pt.on(index) ? th.accent : th.card
                    Text { anchors.centerIn: parent; text: index; color: pt.on(index) ? th.accentInk : th.muted; font.pixelSize: 0.75 * th.rem }
                }
            }
        }
        Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: 22
            visible: pt.snap.id !== undefined
            Repeater {
                model: 4
                delegate: Column {
                    spacing: 3
                    Text { text: "axis " + index; color: th.muted; font.pixelSize: 0.7 * th.rem; anchors.horizontalCenter: parent.horizontalCenter }
                    Rectangle {
                        width: 110; height: 8; radius: 4; color: th.card
                        Rectangle { width: 12; height: 12; radius: 6; color: th.accent; y: -2; x: (pt.ax(index) + 1) * 0.5 * (parent.width - 12) }
                    }
                    Text { text: pt.ax(index).toFixed(2); color: th.text; font.pixelSize: 0.7 * th.rem; anchors.horizontalCenter: parent.horizontalCenter }
                }
            }
        }
        Text {
            width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.muted; font.pixelSize: 0.8 * th.rem; wrapMode: Text.Wrap
            text: "Press anything to see it light up.   Hold B to close."
        }
        Rectangle {
            anchors.horizontalCenter: parent.horizontalCenter
            width: 260; height: 5; radius: 3; color: th.card
            Rectangle { width: parent.width * pt.bFrac; height: parent.height; radius: 3; color: th.accent }
        }
    }
}
