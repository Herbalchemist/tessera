// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): Settings, for now. Every Settings screen of the full Ludus comes to this version in
// the next part of the port; until then this page leaves for the full Ludus (which has them all)
// or for the desktop.
import QtQuick

Item {
    id: page
    property Theme th
    property bool active: false
    property int sel: 0
    signal leave()
    readonly property var items: [
        { label: "Go back to the full Ludus", sub: "Every setting is there", run: function () { session.useFullLudus() } },
        { label: "Opus (desktop)", sub: "Switch to the desktop", run: function () { session.goToOpus() } }
    ]
    function press(a) {
        if (a === "up") { if (sel > 0) sel--; else leave() }
        else if (a === "down") sel = Math.min(items.length - 1, sel + 1)
        else if (a === "b") leave()
        else if (a === "a") items[sel].run()
        th.moved("s|" + sel)
    }
    Column {
        anchors.centerIn: parent
        width: Math.min(47.5 * th.rem, 90 * th.vw)
        spacing: 6
        Text {
            width: parent.width
            text: "Settings are coming to this version next."
            color: th.muted
            font.pixelSize: 1.1 * th.rem
            bottomPadding: 12
            wrapMode: Text.Wrap
        }
        Repeater {
            model: page.items
            Rectangle {
                readonly property bool picked: page.active && index === page.sel
                width: parent.width
                height: lbl.implicitHeight + 28
                radius: 10
                color: picked ? th.accent : th.alpha(th.card, 0.6)
                border.width: picked && th.pastel ? 2 : 0
                border.color: th.glowRing
                Text { id: lbl; x: 18; anchors.verticalCenter: parent.verticalCenter; text: modelData.label; color: parent.picked ? th.accentInk : th.text; font.pixelSize: 1.3 * th.rem }
                Text { anchors.right: parent.right; anchors.rightMargin: 18; anchors.baseline: lbl.baseline; text: modelData.sub; color: parent.picked ? th.accentInk : th.muted; opacity: parent.picked ? 0.7 : 1; font.pixelSize: 0.85 * th.rem }
                MouseArea { anchors.fill: parent; onClicked: { page.sel = index; page.press("a") } }
            }
        }
    }
}
