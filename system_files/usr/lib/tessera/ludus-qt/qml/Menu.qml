// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): a menu over the page (Options, choices, confirmations), drawn like the full Ludus's
// #modal .box: a panel with a muted heading, rows that light up in the highlight color, and
// red (danger) or green (ok) rows that glow in their own color.
import QtQuick
import QtQuick.Effects

Rectangle {
    id: menu
    property Theme th
    property string heading: ""
    property var items: []
    property int sel: 0
    property var done: null
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.82)

    function open(h, its, cb, index) {
        heading = h
        items = its
        sel = Math.max(0, Math.min(its.length - 1, index || 0))
        done = cb
        visible = true
        th.moved("m|" + h + "|" + sel)
    }
    function close() { visible = false; done = null }
    function press(a) {
        if (!items.length) { if (a === "b" || a === "a") close(); return }
        if (a === "up") sel = (sel - 1 + items.length) % items.length
        else if (a === "down") sel = (sel + 1) % items.length
        else if (a === "b") close()
        else if (a === "a") { var it = items[sel], cb = done; close(); if (cb) cb(it) }
        th.moved("m|" + heading + "|" + sel)
    }
    MouseArea { anchors.fill: parent; onClicked: menu.close() }

    Rectangle {
        id: box
        anchors.centerIn: parent
        width: Math.min(47.5 * th.rem, 90 * th.vw)
        height: content.height + 56
        radius: th.radius + 4
        color: th.panel
        layer.enabled: true
        layer.effect: MultiEffect { shadowEnabled: true; shadowColor: Qt.rgba(0, 0, 0, 0.6); shadowBlur: 1; blurMax: 64; shadowVerticalOffset: 24 }
        MouseArea { anchors.fill: parent }
        Column {
            id: content
            x: 32
            y: 28
            width: box.width - 64
            spacing: 0
            Text {
                width: parent.width
                text: menu.heading
                color: th.muted
                font.pixelSize: 1.3 * th.rem
                font.weight: Font.DemiBold
                wrapMode: Text.Wrap
                bottomPadding: 16
            }
            ListView {
                id: list
                width: parent.width
                height: Math.min(contentHeight, 56 * th.vh)
                clip: true
                interactive: false
                model: menu.items
                currentIndex: menu.sel
                highlightFollowsCurrentItem: false
                onCurrentIndexChanged: positionViewAtIndex(currentIndex, ListView.Contain)
                delegate: Rectangle {
                    id: row
                    readonly property bool picked: index === menu.sel
                    readonly property color tone: modelData.danger ? th.danger : modelData.ok ? th.ok : th.accent
                    readonly property color ink: modelData.danger ? th.dangerInk : modelData.ok ? th.okInk : th.accentInk
                    readonly property bool toned: modelData.danger === true || modelData.ok === true
                    width: list.width
                    height: Math.max(lbl.implicitHeight, sub.implicitHeight) + 28
                    radius: 10
                    color: picked ? tone : toned ? th.alpha(tone, 0.16) : "transparent"
                    border.width: toned ? (picked ? 2 : 1) : picked && th.pastel ? 2 : 0
                    border.color: toned ? (picked ? th.alpha(ink, 0.4) : th.alpha(tone, 0.6)) : th.glowRing
                    Text {
                        id: lbl
                        x: 18
                        anchors.verticalCenter: parent.verticalCenter
                        width: parent.width - 36 - (sub.text ? sub.width + 24 : 0)
                        text: modelData.label
                        elide: Text.ElideRight
                        color: row.picked ? row.ink : row.toned ? th.mix(row.tone, th.text, 0.55) : modelData.dim ? th.muted : th.text
                        font.pixelSize: 1.3 * th.rem
                    }
                    Text {
                        id: sub
                        anchors.right: parent.right
                        anchors.rightMargin: 18
                        anchors.baseline: lbl.baseline
                        width: Math.min(implicitWidth, parent.width * 0.55)
                        text: modelData.sub || ""
                        elide: Text.ElideRight
                        color: row.picked ? row.ink : row.toned ? th.mix(row.tone, th.text, 0.55) : th.muted
                        opacity: row.picked && !row.toned ? 0.7 : row.toned && !row.picked ? 0.8 : 1
                        font.pixelSize: 0.85 * th.rem
                    }
                    MouseArea {
                        anchors.fill: parent
                        hoverEnabled: true
                        onEntered: menu.sel = index
                        onClicked: { menu.sel = index; menu.press("a") }
                    }
                }
            }
            Row {     // what this menu takes (modal.js listHints)
                anchors.horizontalCenter: parent.horizontalCenter
                topPadding: 16
                spacing: 28
                Repeater {
                    model: [["A", "Select"], ["B", "Back"]]
                    Text {
                        textFormat: Text.StyledText
                        text: "<b><font color='" + th.text + "'>" + modelData[0] + "</font></b>&nbsp;&nbsp;" + modelData[1]
                        color: th.muted
                        font.pixelSize: 0.9 * th.rem
                    }
                }
            }
        }
    }
}
