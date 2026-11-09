// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): "press the button" (modal.js capture): waits for the next controller button (the
// number it arrives as is the job it does) and hands it back; Esc, or waiting ten seconds, cancels.
import QtQuick

Rectangle {
    id: cap
    property Theme th
    property string label: ""
    property string hint: ""
    property var done: null
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.82)

    // only: the jobs (0-5) it takes, or null for any button
    function open(text, only, note, cb) {
        label = text; hint = note || ""; done = cb
        visible = true
        padState.capture(only || [])
        timeout.restart()
    }
    function finish(role) {
        if (!visible) return
        timeout.stop(); visible = false
        padState.cancelCapture()
        var cb = done; done = null
        if (cb) cb(role)
    }
    function press(a) { if (a === "b") finish(null) }          // Esc cancels (the controller's own buttons are what it waits for)
    Timer { id: timeout; interval: 10000; onTriggered: cap.finish(null) }
    Connections { target: padState; function onCaptured(role) { cap.finish(role) } }

    Rectangle {
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.7, 720); height: col.implicitHeight + 3 * th.rem
        radius: th.radius; color: th.panel
        border.width: 2; border.color: th.alpha(th.accent, 0.6)
        Column {
            id: col
            anchors.centerIn: parent
            width: parent.width - 3 * th.rem
            spacing: 12
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.text; font.pixelSize: 1.3 * th.rem; font.weight: Font.DemiBold; wrapMode: Text.Wrap; text: cap.label }
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.accent; font.pixelSize: 1.1 * th.rem; text: "Press the button now…" }
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.muted; font.pixelSize: 0.85 * th.rem; wrapMode: Text.Wrap; text: cap.hint || "Esc cancels." }
        }
    }
}
