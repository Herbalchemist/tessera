// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the LB / RB marks beside the tab bar (style.css .hint; round in the curved bar).
import QtQuick

Rectangle {
    id: key
    property Theme th
    property string label: ""
    property bool round: false
    readonly property real d: th.clamp(56, 11 * th.vh, 108)
    implicitWidth: round ? d : txt.implicitWidth + 24
    implicitHeight: round ? d : txt.implicitHeight + 8
    width: implicitWidth
    height: implicitHeight
    radius: round ? d / 2 : 8
    color: "transparent"
    border.width: round ? 3 : 2
    border.color: round ? th.border : th.muted
    gradient: round ? fill : null
    Gradient {
        id: fill
        GradientStop { position: 0; color: th.card }
        GradientStop { position: 0.7; color: th.panel }
    }
    Text {
        id: txt
        anchors.centerIn: parent
        text: key.label
        color: th.muted
        font.pixelSize: (key.round ? 1.05 : 0.85) * th.rem
        font.weight: Font.Bold
    }
}
