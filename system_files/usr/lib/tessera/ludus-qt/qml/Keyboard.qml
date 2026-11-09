// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the on-screen keyboard (modal.js ask(); style.css #modal.keys): the name being typed
// in a field up the screen, the keys docked to the bottom. The buttons are the user's own keyboard
// buttons (Settings › Controls; view.keys): by default X deletes, Y types a space, L3 is shift,
// Menu is done and B cancels.
import QtQuick
import QtQuick.Effects

Rectangle {
    id: kb
    property Theme th
    property var keys: ({ back: 2, space: 3, shift: 10, done: 9, cancel: 1 })
    property string heading: ""
    property string typed: ""
    property var done: null
    property int row: 1
    property int col: 0
    property bool shift: false
    property int maxText: 40
    property bool secret: false
    property var canceled: null
    readonly property var baseRows: ["1234567890".split(""), "qwertyuiop".split(""), "asdfghjkl'".split(""), "zxcvbnm-.&".split("")]
    readonly property var symMap: ["!@#$%^&*()".split(""), "`~-_=+[]{}".split(""), "\\|;:'\",.<>".split(""), ["/", "?", "", "", "", "", "", "", "", ""]]
    property bool sym: false
    property bool reveal: false
    property bool digits: false
    property bool url: false              // a web address: a row of its usual pieces (www. .com / : ? =)
    property bool fresh: false            // the starting text is selected, so the first key typed replaces it
    property string doneLabel: ""
    property var rows: baseRows.concat([["shift", "space", "back", "cancel", "done"]])
    readonly property var special: ({ shift: "⇧", sym: "#+=", show: reveal ? "Hide" : "Show", space: "space", back: "⌫", cancel: "Cancel", done: doneLabel !== "" ? doneLabel : "Done" })
    function glyph(k, r, c) { return sym && special[k] === undefined && symMap[r] ? (symMap[r][c] || "") : k }
    readonly property var buttonOf: ({ a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, select: 8, start: 9, l3: 10, r3: 11 })
    readonly property var names: ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "View", "Menu", "L3", "R3"]
    readonly property real key: th.clamp(36, Math.min(4.6 * th.vw, 7.4 * th.vh), 88)
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.82)

    function open(h, start, cb, opts) {
        heading = h
        maxText = (opts && opts.max) || 40
        secret = Boolean(opts && opts.secret)
        digits = Boolean(opts && opts.digits)
        url = Boolean(opts && opts.url)
        doneLabel = (opts && opts.doneLabel) || ""
        sym = false; reveal = false
        canceled = (opts && opts.cancel) || null
        if (digits) rows = [["1", "2", "3"], ["4", "5", "6"], ["7", "8", "9"], ["back", "0", "done"], ["cancel"]]
        else if (secret) rows = baseRows.concat([["shift", "sym", "show", "space", "back", "cancel", "done"]])
        else if (url) rows = baseRows.concat([["www.", ".com", ".org", ".net", "/", ":", "?", "="], ["shift", "sym", "space", "back", "cancel", "done"]])
        else if (opts && opts.symbols) rows = baseRows.concat([["shift", "sym", "space", "back", "cancel", "done"]])
        else rows = baseRows.concat([["shift", "space", "back", "cancel", "done"]])
        typed = (start || "").slice(0, maxText)
        fresh = Boolean(opts && opts.selectAll && start)
        done = cb
        row = digits ? 0 : 1; col = 0; shift = false
        visible = true
        panel.y = kb.height
        panel.y = Qt.binding(function () { return kb.height - panel.height })
    }
    function typeChar(ch) {
        if (fresh) { typed = ""; fresh = false }
        if (typed.length + ch.length > maxText) return
        typed += shift ? ch.toUpperCase() : ch
        shift = false
    }
    function keyAction(k) {
        if (k === "shift") shift = !shift
        else if (k === "sym") sym = !sym
        else if (k === "show") reveal = !reveal
        else if (k === "space") typeChar(" ")
        else if (k === "back") { typed = fresh ? "" : typed.slice(0, -1); fresh = false }
        else if (k === "cancel") finish(false)
        else if (k === "done") finish(true)
        else if (k === "") return
        else if (digits && !/^[0-9]$/.test(k)) return
        else typeChar(k)
    }
    function finish(accept) {
        var cb = done, ca = canceled, t = secret ? typed : typed.trim()
        visible = false
        done = null
        canceled = null
        if (accept && cb && (t || secret)) cb(t)
        else if (ca) ca()
    }
    function press(a) {
        var n = buttonOf[a]
        if (n !== undefined && n !== 0) {
            for (var k in keys) if (keys[k] === n) return keyAction(k)
        }
        if (a === "up") { row = Math.max(0, row - 1); col = Math.min(col, rows[row].length - 1) }
        else if (a === "down") { row = Math.min(rows.length - 1, row + 1); col = Math.min(col, rows[row].length - 1) }
        else if (a === "left") col = (col - 1 + rows[row].length) % rows[row].length
        else if (a === "right") col = (col + 1) % rows[row].length
        else if (a === "a") keyAction(glyph(rows[row][col], row, col))
        else if (a === "b") finish(false)
        th.moved("k|" + row + "|" + col)
    }

    // ---- the field, up the screen
    Column {
        x: (kb.width - width) / 2
        y: kb.height * 0.3 - height / 2
        width: Math.min(900, 84 * th.vw)
        spacing: 14
        Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: kb.heading
            color: "#ffffff"
            font.pixelSize: kb.key * 0.4
            font.weight: Font.DemiBold
            style: Text.Raised
            styleColor: Qt.rgba(0, 0, 0, 0.7)
            wrapMode: Text.Wrap
        }
        Rectangle {
            width: parent.width
            height: Math.max(kb.key * 1.2, field.implicitHeight + kb.key * 0.4)
            radius: kb.key * 0.2
            color: th.panel
            border.width: 2
            border.color: th.alpha(th.text, 0.25)
            clip: true
            Row {
                x: kb.key * 0.35
                anchors.verticalCenter: parent.verticalCenter
                Rectangle {
                    width: field.width; height: field.height; radius: 4
                    color: kb.fresh ? th.alpha(th.accent, 0.34) : "transparent"
                    Text { id: field; text: kb.secret && !kb.reveal ? "•".repeat(kb.typed.length) : kb.typed; color: th.text; font.pixelSize: kb.key * 0.6 }
                }
                Rectangle {
                    visible: !kb.fresh
                    width: 3; height: field.font.pixelSize * 0.9
                    anchors.verticalCenter: parent.verticalCenter
                    color: th.accent
                    SequentialAnimation on opacity {
                        running: kb.visible && th.motion
                        loops: Animation.Infinite
                        PropertyAction { value: 1 } PauseAnimation { duration: 500 }
                        PropertyAction { value: 0 } PauseAnimation { duration: 500 }
                    }
                }
            }
        }
    }

    // ---- the keys, docked to the bottom
    Rectangle {
        id: panel
        width: kb.width
        height: grid.height + hint.height + kb.key * 0.5
        y: kb.height - height
        Behavior on y { enabled: th.motion; NumberAnimation { duration: 300; easing.type: Easing.BezierSpline; easing.bezierCurve: [0.2, 0.9, 0.3, 1, 1, 1] } }
        color: th.panel
        topLeftRadius: kb.key * 0.4
        topRightRadius: kb.key * 0.4
        layer.enabled: true
        layer.effect: MultiEffect { shadowEnabled: true; shadowColor: Qt.rgba(0, 0, 0, 0.5); shadowBlur: 1; blurMax: 64; shadowVerticalOffset: -20 }
        Column {
            id: grid
            y: kb.key * 0.3
            readonly property real w: Math.min(96 * th.vw, kb.key * 14.5)
            readonly property real gap: kb.key * 0.12
            x: (kb.width - w) / 2
            width: w
            spacing: gap
            Repeater {
                model: kb.rows.length
                delegate: Row {
                    id: line
                    readonly property int r: index
                    readonly property var ks: kb.rows[r]
                    readonly property int wide: ks.filter(function (k) { return kb.special[k] !== undefined }).length
                    readonly property real wideW: wide ? (grid.w - (ks.length - 1) * grid.gap - (ks.length - wide) * kb.key) / wide : 0
                    anchors.horizontalCenter: parent.horizontalCenter
                    spacing: grid.gap
                    Repeater {
                        model: line.ks
                        delegate: Rectangle {
                            id: cap
                            readonly property string k: modelData
                            readonly property bool picked: line.r === kb.row && index === kb.col
                            readonly property bool isSpecial: kb.special[k] !== undefined
                            readonly property bool toned: k === "cancel" || k === "done"
                            readonly property color tone: k === "cancel" ? th.danger : th.ok
                            readonly property color ink: k === "cancel" ? th.dangerInk : th.okInk
                            width: isSpecial ? line.wideW : kb.key
                            height: kb.key
                            radius: kb.key * 0.18
                            scale: picked ? 1.06 : 1
                            Behavior on scale { enabled: th.motion; NumberAnimation { duration: 120 } }
                            color: picked ? (toned ? tone : th.accent) : toned ? th.mix(th.card, tone, 0.16) : th.card
                            border.width: (k === "shift" && kb.shift) ? 3 : toned ? (picked ? 2 : 1) : picked && th.pastel ? 2 : 0
                            border.color: (k === "shift" && kb.shift) ? th.accent : toned ? th.alpha(picked ? ink : tone, picked ? 0.4 : 0.6) : th.glowRing
                            Text {
                                anchors.centerIn: parent
                                text: cap.isSpecial ? kb.special[cap.k] : kb.shift ? kb.glyph(cap.k, line.r, index).toUpperCase() : kb.glyph(cap.k, line.r, index)
                                color: cap.picked ? (cap.toned ? cap.ink : th.accentInk) : cap.toned ? th.mix(cap.tone, th.text, 0.55) : th.text
                                font.pixelSize: kb.key * ((cap.k.length > 1 && !cap.isSpecial && !kb.digits) ? 0.27 : 0.42)
                                font.weight: Font.DemiBold
                            }
                            MouseArea {
                                anchors.fill: parent
                                onClicked: { kb.row = line.r; kb.col = index; kb.press("a") }
                            }
                        }
                    }
                }
            }
        }
        Row {
            id: hint
            anchors.horizontalCenter: parent.horizontalCenter
            anchors.top: grid.bottom
            topPadding: 12
            spacing: kb.key * 0.4
            Repeater {
                model: [[kb.names[0], "type"], [kb.names[kb.keys.back], "delete"], [kb.names[kb.keys.space], "space"],
                        [kb.names[kb.keys.shift], "shift"], [kb.names[kb.keys.done], "done"], [kb.names[kb.keys.cancel], "cancel"]]
                Text {
                    textFormat: Text.StyledText
                    text: "<b><font color='" + th.text + "'>" + modelData[0] + "</font></b>&nbsp;&nbsp;" + modelData[1]
                    color: th.muted
                    font.pixelSize: kb.key * 0.26
                }
            }
        }
    }
}
