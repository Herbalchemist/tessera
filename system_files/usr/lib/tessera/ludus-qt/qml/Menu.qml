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
    property var canceled: null
    property string body: ""
    property string yLabel: ""       // a second thing Y can do on the row (Profiles: Options); the answer carries pressedY: true
    property double holdUntil: 0     // don't redraw underneath a hand that is still turning a bar
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.82)

    function pickable(i) { var it = items[i]; return Boolean(it) && (!it.header || Boolean(it.fold)) && !it.info }
    function fixSel(dir) {      // headings and notes can't be chosen: land on the next row that can
        var n = items.length, i = sel
        for (var k = 0; k < n; k++) { if (pickable(i)) { sel = i; return } i = (i + dir + n) % n }
    }
    // live menus (Wi-Fi, Bluetooth, Sound): new rows and text, the cursor stays on the same row (by key)
    function update(its, b) {
        if (!visible || Date.now() < holdUntil) return
        var cur = items[sel], key = cur && cur.key, j = -1
        if (key) for (var i = 0; i < its.length; i++) if (its[i].key === key) j = i
        items = its
        body = b || ""
        sel = j >= 0 ? j : Math.max(0, Math.min(sel, its.length - 1))
        fixSel(1)
    }
    function open(h, its, cb, index, cancel, opts) {
        canceled = cancel || null
        heading = h
        body = (opts && opts.body) || ""
        yLabel = (opts && opts.yLabel) || ""
        holdUntil = 0
        items = its
        sel = Math.max(0, Math.min(its.length - 1, index || 0))
        fixSel(1)
        done = cb
        visible = true
        th.moved("m|" + h + "|" + sel)
    }
    function close() { visible = false; done = null; canceled = null }
    function press(a) {
        if (!items.length) { if (a === "b" || a === "a") close(); return }
        if (a === "up" || a === "down") {
            var d = a === "up" ? -1 : 1, n = items.length, i = sel
            for (var k = 0; k < n; k++) { i = (i + d + n) % n; if (pickable(i)) { sel = i; break } }
        }
        else if ((a === "left" || a === "right") && items[sel] && items[sel].adjust) { items[sel].adjust(a === "right" ? 1 : -1); items = items.slice() }
        else if (a === "a" && !pickable(sel)) { }
        else if (a === "b") { var c = canceled; close(); if (c) c() }
        else if (a === "a") { var it = items[sel], cb = done; close(); if (cb) cb(it) }
        else if (a === "y" && yLabel && pickable(sel) && !items[sel].fold) { var yi = Object.assign({}, items[sel], { pressedY: true }), ycb = done; close(); if (ycb) ycb(yi) }
        th.moved("m|" + heading + "|" + sel)
    }
    MouseArea { anchors.fill: parent; onClicked: menu.press("b") }

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
                bottomPadding: menu.body ? 8 : 16
            }
            Text {
                visible: menu.body !== ""
                width: parent.width
                height: visible ? implicitHeight + 18 : 0
                text: menu.body
                color: th.text
                font.pixelSize: 1.05 * th.rem
                lineHeight: 1.3
                wrapMode: Text.Wrap
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
                onModelChanged: Qt.callLater(function () { list.positionViewAtIndex(list.currentIndex, ListView.Contain) })
                delegate: Rectangle {
                    id: row
                    readonly property bool hdr: modelData.header === true && !modelData.fold
                    readonly property bool hasBar: modelData.bar !== undefined && modelData.bar !== null
                    readonly property bool picked: index === menu.sel && !hdr && modelData.info !== true
                    readonly property color tone: modelData.danger ? th.danger : modelData.ok ? th.ok : th.accent
                    readonly property color ink: modelData.danger ? th.dangerInk : modelData.ok ? th.okInk : th.accentInk
                    readonly property bool toned: modelData.danger === true || modelData.ok === true
                    width: list.width
                    height: hdr ? lbl.implicitHeight + 24 : Math.max(lbl.implicitHeight, sub.implicitHeight) + 28 + (hasBar ? 0.95 * th.rem + 12 : 0)
                    radius: 10
                    color: picked ? tone : toned ? th.alpha(tone, 0.16) : "transparent"
                    border.width: toned ? (picked ? 2 : 1) : picked && th.pastel ? 2 : 0
                    border.color: toned ? (picked ? th.alpha(ink, 0.4) : th.alpha(tone, 0.6)) : th.glowRing
                    Text {
                        id: lbl
                        x: 18
                        y: row.hdr ? 16 : row.hasBar ? 14 : (row.height - implicitHeight) / 2
                        width: parent.width - 36 - (sub.text ? sub.width + 24 : 0)
                        text: row.hdr ? String(modelData.label).toUpperCase() : modelData.label
                        font.letterSpacing: row.hdr ? 0.08 * 0.85 * th.rem : 0
                        elide: Text.ElideRight
                        color: row.picked ? row.ink : row.toned ? th.mix(row.tone, th.text, 0.55) : (modelData.dim || row.hdr || modelData.info) ? th.muted : th.text
                        font.pixelSize: (row.hdr ? 0.85 : 1.3) * th.rem
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
                    Row {     // a level bar (Sound): the filled part, then the rest
                        visible: row.hasBar
                        x: 18
                        y: parent.height - height - 14
                        width: parent.width - 36
                        height: 0.95 * th.rem
                        spacing: 3
                        Rectangle {
                            id: filled
                            width: Math.max(3, (parent.width - 3) * Math.max(0, Math.min(100, row.hasBar ? modelData.bar.pct : 0)) / 100)
                            height: parent.height
                            radius: 3
                            color: row.hasBar && modelData.bar.mute ? (row.picked ? th.alpha(row.ink, 0.5) : th.alpha(th.text, 0.38)) : (row.picked ? row.ink : th.accent)
                        }
                        Rectangle { width: Math.max(0, parent.width - filled.width - 3); height: parent.height; radius: 3; color: row.picked ? th.alpha(row.ink, 0.2) : th.alpha(th.text, 0.13); visible: row.hasBar && modelData.bar.pct < 100 }
                    }
                    MouseArea {
                        anchors.fill: parent
                        hoverEnabled: true
                        enabled: !row.hdr && modelData.info !== true
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
                    model: {
                        var cur = menu.items[menu.sel], h = []
                        if (cur && cur.adjust) h.push(["← / →", "Adjust"])
                        if (cur && (!cur.header || cur.fold) && !cur.info) h.push(["A", cur.fold ? "Fold" : "Select"])
                        if (menu.yLabel && cur && (!cur.header || cur.fold) && !cur.info) h.push(["Y", menu.yLabel])
                        h.push(["B", "Back"])
                        return h
                    }
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
