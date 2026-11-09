// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the tiles of a page, laid out the way home.js render()/sizeGrid()/update() and
// style.css lay them out, for each Theme Settings layout:
//   rails: one sideways row per list; each row keeps its own selection in the middle (or, with the
//          "start" row part, at the front and grown), and the selected row sits in the middle.
//   grid:  `cols` across and `rows` down sized to fit, each row centered; scrolls just enough to
//          keep the selection in view.
//   flow:  two extra columns wait off the sides; the grid slides so the selection stays centered.
import QtQuick
import QtQuick.Effects

Item {
    id: root
    property Theme th
    property var rows: []
    property int selRow: 0
    property int selCol: 0
    property var cols: []             // rails: each row's own selected column
    property bool active: false       // the tiles have focus (not the tab bar or a menu)
    property string artRev: ""
    property string pageKey: ""
    property var grid: ({ cols: 5, rows: 3 })

    readonly property string mode: th.mode
    readonly property string rowPart: th.parts.row
    readonly property real dur: th.motion ? 280 : 0
    readonly property var ease: [0.2, 0.9, 0.3, 1, 1, 1]

    // ---- sizes
    readonly property real bigW: Math.min(60 * th.rem, 72 * th.vw)
    readonly property real gGap: th.rem * 1.2 * th.gapPct / 100
    readonly property real padv: 1.1 * th.rem
    readonly property var gridCard: {
        var w = Math.max(200, width - gGap * 2 - 24), h = Math.max(160, height)
        var n = grid.cols, r = grid.rows
        var cw = (w - (n - 1) * gGap) / n
        var fitH = (h - padv - r * gGap) / r
        var a = th.cardSize.aspect, ch
        if (a > 0) { ch = Math.max(90, Math.min(cw * a, fitH)); cw = Math.min(cw, ch / a) }
        else ch = Math.max(90, Math.min(cw * 1.5, fitH))
        return { w: cw, h: ch }
    }
    readonly property real cw: mode === "rails" ? th.cardSize.w : gridCard.w
    readonly property real ch: mode === "rails" ? th.cardSize.h : gridCard.h
    readonly property real gap: mode !== "rails" ? gGap : rowPart === "start" ? th.clamp(10, 1.2 * th.vw, 18) : th.railGap
    readonly property real grow: mode === "rails" && rowPart === "start" ? 1.32 : 1
    readonly property bool titles: mode === "rails" && rowPart !== "focus" && rowPart !== "start"
    readonly property real titleH: titles ? titleProbe.implicitHeight + 6 : 0
    readonly property real portPad: mode !== "rails" ? 0 : rowPart === "start" ? 26 : 28
    readonly property real rowGap: mode === "rails" ? 24 : gGap
    readonly property real rowH: titleH + portPad * 2 + ch * grow + rowGap
    readonly property real rowsTop: mode === "rails" ? 0 : padv
    readonly property real fullH: rowsTop + rows.length * rowH
    Text { id: titleProbe; visible: false; text: "Ag"; font.pixelSize: 1.2 * th.rem; font.weight: Font.DemiBold }

    function tileW(t) { return t && t.big ? bigW : cw }
    // Where tile n starts in its row (the "start" row part grows the selected tile in place).
    function leftOf(row, n, sel) {
        var x = 0
        for (var i = 0; i < n; i++) x += tileW(row.tiles[i]) * (grow > 1 && i === sel ? grow : 1) + gap
        return x
    }
    function railW(row, sel) { return row.tiles.length ? leftOf(row, row.tiles.length, sel) - gap : 0 }

    // ---- vertical position of the whole column of rows (a row's height includes the space under it)
    readonly property var memo: ({ ty: 0 })    // grid: where it was scrolled to, kept without a binding
    onPageKeyChanged: memo.ty = 0
    function placeY() {
        if (!rows.length) return 0
        var t = rowsTop + selRow * rowH, b = t + rowH
        if (mode === "rails" && rowPart === "start") return -t     // the one row sits at the top of its short page
        if (mode === "rails") return height / 2 - (t + rowH / 2)
        var minTy = Math.min(0, height - fullH)
        var y = memo.ty
        if (mode === "flow") y = height / 2 - (t + rowH / 2)
        else if (t + y < padv - 0.5) y = padv - t
        else if (b + y > height) y = height - b
        y = Math.max(minTy, Math.min(0, y))
        memo.ty = y
        return y
    }
    readonly property real colY: { selRow; rows; height; rowH; mode; pageKey; return placeY() }

    // flow: every row slides by the same amount, so the selected column sits in the middle
    readonly property real flowX: {
        var r = rows[selRow]
        if (mode !== "flow" || !r) return 0
        return width / 2 - (leftOf(r, selCol, -1) + tileW(r.tiles[selCol]) / 2)
    }

    Item {
        id: column
        width: root.width
        height: root.fullH
        y: root.colY
        Behavior on y { NumberAnimation { duration: root.dur; easing.type: Easing.BezierSpline; easing.bezierCurve: root.ease } }

        Repeater {
            model: root.rows
            delegate: Item {
                id: rowItem
                readonly property var row: modelData
                readonly property int r: index
                readonly property bool here: r === root.selRow
                readonly property int col: root.mode === "rails" ? (root.cols[r] || 0) : (here ? root.selCol : -1)
                readonly property int pick: root.active && here ? (root.mode === "rails" ? col : root.selCol) : -1
                readonly property bool near: Math.abs(r - root.selRow) <= (root.mode === "rails" ? 2 : root.grid.rows + 1)
                y: root.rowsTop + r * root.rowH
                width: root.width
                height: root.rowH
                opacity: {
                    if (root.mode === "grid") return 1
                    if (root.mode === "flow") return here && root.active ? 1 : 0.55
                    if (here && root.active) return 1
                    if (!root.active) return 0.45
                    return root.rowPart === "focus" ? 0.16 : root.rowPart === "start" ? 0 : 0.45
                }
                Behavior on opacity { NumberAnimation { duration: th.motion ? 200 : 0 } }

                Text {
                    visible: root.titles
                    x: 56
                    text: rowItem.row.title || ""
                    color: th.muted
                    font.pixelSize: 1.2 * th.rem
                    font.weight: Font.DemiBold
                }
                Item {     // the row's own strip; "start" cuts it off a little before the screen edge
                    id: port
                    readonly property bool cut: root.mode === "rails" && root.rowPart === "start"
                    x: cut ? th.edge - 10 : 0
                    y: root.titleH - (cut ? 80 : 0)
                    width: root.width - x
                    height: root.portPad * 2 + root.ch * root.grow + (cut ? 160 : 0)
                    clip: cut
                    Item {
                        id: rail
                        readonly property real w: root.railW(rowItem.row, rowItem.pick)
                        y: root.portPad + (port.cut ? 80 : 0)
                        height: root.ch * root.grow
                        width: w
                        x: {
                            var row = rowItem.row
                            if (root.mode === "grid") {
                                var full = (th.parts.card === "metro" || th.parts.card === "bezel") && !(row.tiles.length === 1 && row.tiles[0].big)
                                    ? root.grid.cols * root.cw + (root.grid.cols - 1) * root.gap : w
                                return (root.width - Math.min(full, root.width)) / 2
                            }
                            if (root.mode === "flow") return root.flowX
                            var c = rowItem.col
                            if (port.cut) return 10 - root.leftOf(row, c, rowItem.pick)
                            return root.width / 2 - (root.leftOf(row, c, rowItem.pick) + root.tileW(row.tiles[c]) / 2)
                        }
                        Behavior on x { NumberAnimation { duration: root.dur; easing.type: Easing.BezierSpline; easing.bezierCurve: root.ease } }
                        Repeater {
                            model: rowItem.row.tiles
                            delegate: Tile {
                                readonly property bool sel: index === rowItem.pick
                                th: root.th
                                t: modelData
                                picked: sel
                                grows: root.grow > 1
                                artRev: root.artRev
                                near: rowItem.near && (root.mode !== "rails" || Math.abs(index - rowItem.col) <= 10)
                                gridFont: root.mode === "rails" ? (root.grow > 1 && !sel ? 0.85 * th.rem : 0) : th.clamp(0.9 * th.rem, root.cw / 11, 1.5 * th.rem)
                                x: root.leftOf(rowItem.row, index, rowItem.pick)
                                width: root.tileW(modelData) * (sel ? root.grow : 1)
                                height: root.ch * (sel ? root.grow : 1)
                                y: (rail.height - height) / 2
                                Behavior on x { enabled: root.grow > 1; NumberAnimation { duration: th.motion ? 200 : 0 } }
                                Behavior on width { enabled: root.grow > 1; NumberAnimation { duration: th.motion ? 200 : 0 } }
                                Behavior on height { enabled: root.grow > 1; NumberAnimation { duration: th.motion ? 200 : 0 } }
                            }
                        }
                    }
                }
            }
        }
    }

    // flow: the edges fade (style.css .viewport.flowmask)
    layer.enabled: mode === "flow"
    layer.effect: MultiEffect {
        maskEnabled: true
        maskSource: fade
        maskThresholdMin: 0
        maskSpreadAtMin: 1
    }
    Canvas {
        id: fade
        anchors.fill: parent
        visible: false
        layer.enabled: true
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        onPaint: {
            var c = getContext("2d"), w = width, h = height
            c.globalCompositeOperation = "source-over"
            c.clearRect(0, 0, w, h)
            var g = c.createLinearGradient(0, 0, w, 0)
            g.addColorStop(0, "transparent"); g.addColorStop(0.11, "white"); g.addColorStop(0.89, "white"); g.addColorStop(1, "transparent")
            c.fillStyle = g; c.fillRect(0, 0, w, h)
            c.globalCompositeOperation = "destination-in"
            g = c.createLinearGradient(0, 0, 0, h)
            g.addColorStop(0, "transparent"); g.addColorStop(0.09, "white"); g.addColorStop(0.91, "white"); g.addColorStop(1, "transparent")
            c.fillStyle = g; c.fillRect(0, 0, w, h)
        }
    }
}
