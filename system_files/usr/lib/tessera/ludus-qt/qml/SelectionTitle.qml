// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the name of what's selected (style.css h1#title, with its title part and shell looks).
import QtQuick

Text {
    id: title
    property Theme th
    property bool leftAligned: false
    property bool inset: true          // away from the screen edge (not beside the left menu)
    readonly property string part: th.parts.title
    readonly property string nav: th.parts.nav
    readonly property string tabs: th.parts.tabs
    readonly property bool big: part === "big"
    readonly property bool above: part === "above"
    readonly property real side: !leftAligned || !inset ? 0 : big || nav === "top-left" ? th.edge : nav === "bottom-dock" ? th.clamp(12, 3 * th.vw, 52) : 0

    leftPadding: side
    rightPadding: side
    topPadding: big ? th.clamp(8, 3 * th.vh, 36) : above ? 0 : 4
    horizontalAlignment: leftAligned || big ? Text.AlignLeft : Text.AlignHCenter
    elide: Text.ElideRight
    maximumLineCount: 1
    height: Math.max(implicitHeight, (above ? 1.4 : 1.3) * font.pixelSize + topPadding)
    color: above ? th.accent : nav === "bottom-bar" && !big ? th.muted : th.text
    readonly property real px: (above ? 1.45 : big ? 3.4 : tabs === "pivots" ? 1.5 : tabs === "chunky" ? 1.9
                     : nav === "bottom-bar" ? 1.25 : nav === "left" || nav === "bottom-dock" ? 2.1 : 2.2) * th.rem
    font.pixelSize: px
    font.weight: big ? Font.ExtraBold : above ? Font.Bold : tabs === "pivots" ? Font.Light : tabs === "chunky" ? Font.ExtraBold : Font.DemiBold
    font.letterSpacing: big ? -0.02 * px : -0.01 * px
    style: big || tabs === "chunky" ? Text.Raised : Text.Normal
    styleColor: Qt.rgba(0, 0, 0, big ? 0.6 : 0.3)
}
