// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the button hints along the bottom (index.html footer; style.css footer and the hints part).
import QtQuick

Item {
    id: foot
    property Theme th
    property bool ruled: false        // the "bottom" menu: a line above the hints
    property var items: [["A", "Open"], ["B", "Back"], ["Y", "Options"], ["LB / RB", "Switch tab"]]
    readonly property string nav: th.parts.nav
    readonly property string align: th.parts.hints
    readonly property real small: nav === "bottom-bar" || nav === "left" ? 0.85 : 1
    readonly property real padV: nav === "bottom" ? th.clamp(8, 1.4 * th.vh, 14) : nav === "bottom-bar" ? 5 : nav === "left" ? th.clamp(8, 1.3 * th.vh, 16) : 18
    readonly property real padH: nav === "top-left" || th.parts.row === "start" ? th.edge : nav === "bottom-dock" ? th.clamp(12, 3 * th.vw, 52) : nav === "left" || nav === "bottom" ? 0 : 18
    implicitHeight: line.implicitHeight + 2 * padV
    height: implicitHeight
    Rectangle { visible: foot.ruled; width: parent.width; height: 1; color: th.alpha(th.text, 0.25) }
    Row {
        id: line
        y: foot.padV
        spacing: foot.align === "left" ? th.clamp(14, 2.5 * th.vw, 40) : 40
        x: foot.align === "left" ? foot.padH : foot.align === "right" ? foot.width - foot.padH - width : (foot.width - width) / 2
        Repeater {
            model: foot.items
            Text {
                textFormat: Text.StyledText     // the key in the theme's text color, the words muted
                text: "<b><font color='" + th.text + "'>" + modelData[0] + "</font></b>&nbsp;&nbsp;" + modelData[1]
                color: th.muted
                font.pixelSize: foot.small * th.rem
            }
        }
    }
}
