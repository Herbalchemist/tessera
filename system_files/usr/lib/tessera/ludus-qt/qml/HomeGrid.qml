// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): Home. A 12 x 6 grid over the whole screen; widgets sit on it where you put them
// (style.css .canvas). While you place or resize one, faint cells show where things can go and a
// ghost shows where it lands (red where it would overlap).
import QtQuick

Item {
    id: home
    property Theme th
    property var tiles: []            // the widgets (kind "inlay") or the one big "make this yours" tile
    property int sel: 0
    property bool active: false
    property var place: null          // { x, y, w, h, name, mode, bad } while placing
    property var sys: null
    property var recent: []
    property string now: ""
    property string day: ""
    readonly property int cols: 12
    readonly property int rows: 6
    readonly property real pad: 18
    readonly property real padX: 56
    readonly property real gap: 14
    readonly property real cw: (width - 2 * padX - (cols - 1) * gap) / cols
    readonly property real ch: (height - 2 * pad - (rows - 1) * gap) / rows
    function px(c) { return padX + c * (cw + gap) }
    function py(r) { return pad + r * (ch + gap) }
    function spanW(n) { return n * cw + (n - 1) * gap }
    function spanH(n) { return n * ch + (n - 1) * gap }

    Item {     // faint cells while placing
        anchors.fill: parent
        visible: home.place !== null
        Repeater {
            model: home.place ? home.cols * home.rows : 0
            Rectangle {
                x: home.px(index % home.cols); y: home.py(Math.floor(index / home.cols))
                width: home.cw; height: home.ch
                radius: 8
                color: "transparent"
                border.width: 1
                border.color: th.alpha(th.accent, 0.2)
            }
        }
    }
    Repeater {
        model: home.tiles
        delegate: Item {
            objectName: "tile"
            readonly property var w: modelData
            readonly property bool plus: w.kind === "add"
            readonly property real gx: plus ? 3 : (w.x || 0)
            readonly property real gy: plus ? 1 : (w.y || 0)
            readonly property real gw: plus ? 6 : (w.w || 1)
            readonly property real gh: plus ? 4 : (w.h || 1)
            visible: !(plus && home.place)
            x: home.px(gx); y: home.py(gy)
            width: home.spanW(gw); height: home.spanH(gh)
            readonly property bool picked: home.active && index === home.sel && !home.place
            scale: picked ? 1.02 : 1
            z: picked ? 2 : 0
            opacity: home.place && home.place.id === w.id ? 0.25 : 1
            Behavior on scale { enabled: th.motion; NumberAnimation { duration: 160 } }
            WidgetCard {
                visible: !plus
                anchors.fill: parent
                th: home.th; t: w; sys: home.sys; recent: home.recent; now: home.now; day: home.day
                picked: parent.picked
            }
            Tile {     // "Make this yours": the same big dashed tile the other pages show
                visible: plus
                anchors.fill: parent
                th: home.th; t: w; picked: parent.picked
            }
        }
    }
    Rectangle {     // the ghost
        visible: home.place !== null
        z: 3
        readonly property var p: home.place || ({ x: 0, y: 0, w: 1, h: 1 })
        x: home.px(p.x); y: home.py(p.y)
        width: home.spanW(p.w); height: home.spanH(p.h)
        radius: 14
        readonly property color tone: home.place && home.place.bad ? "#ff8a7a" : th.accent
        color: th.alpha(tone, 0.16)
        border.width: 3
        border.color: tone
        Rectangle {
            anchors.left: parent.left; anchors.bottom: parent.bottom
            anchors.margins: 14
            width: lab.implicitWidth + 20; height: lab.implicitHeight + 8
            radius: 8
            color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.7)
            Text { id: lab; anchors.centerIn: parent; text: home.place ? home.place.name + " · " + home.place.w + " × " + home.place.h : ""; color: "#ffffff"; font.pixelSize: th.rem; font.weight: Font.DemiBold }
        }
    }
}
