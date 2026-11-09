// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the tabs, in the theme's tab look (pills, text, pivots, round, chunky, segments),
// across (top / bottom) or down (left sidebar). style.css "Tab look".
import QtQuick
import QtQuick.Shapes

Item {
    id: bar
    property Theme th
    property var tabs: []
    property int current: 0
    property bool focused: false
    property real span: 800                 // width available (across) or height (down)
    readonly property string look: th.parts.tabs
    readonly property bool down: th.vertical
    readonly property bool barPill: look === "pills" && th.parts.nav === "bottom-bar"     // small outlined pills with icons, in the curved bar
    readonly property real gap: look === "segments" ? 0
                              : barPill ? th.clamp(8, 1 * th.vw, 16)
                              : down ? th.clamp(4, 0.8 * th.vh, 10)
                              : look === "text" ? th.clamp(18, 2.4 * th.vw, 40)
                              : look === "pivots" ? th.clamp(20, 2.6 * th.vw, 44)
                              : look === "round" ? th.clamp(14, 2.4 * th.vw, 36)
                              : look === "chunky" ? th.clamp(8, 1.4 * th.vh, 16) : 12
    implicitWidth: down ? span : flow.implicitWidth
    implicitHeight: down ? flow.implicitHeight : flow.implicitHeight

    function itemRect(i, target) { var it = rep.itemAt(i); if (!it) return null; var r = it.mapToItem(target, 0, 0, it.width, it.height); return { x: r.x, y: r.y, w: r.width, h: r.height } }
    function kindOf(id) { return id.indexOf("m:") === 0 ? "mosaic" : id }
    readonly property var tint: ({ browser: "#ff6a13", home: "#e60012", library: "#1aa7e8", apps: "#8e4dff", mosaic: "#f2a900", new: "#22b14c", settings: "#6f6f6f" })

    // The selected tab stays in view: the strip slides (style.css nav transform).
    readonly property Item currentItem: rep.count > current ? rep.itemAt(current) : null
    readonly property real shift: {
        if (down || look === "segments") return 0
        if (flow.implicitWidth <= width) return (width - flow.implicitWidth) / 2          // the whole bar fits: centred in its port (home.js)
        if (!currentItem) return 0
        var mid = currentItem.x + currentItem.width / 2
        return Math.max(span - flow.implicitWidth, Math.min(0, span / 2 - mid))
    }
    clip: !down && flow.implicitWidth > width

    Grid {
        id: flow
        x: bar.shift
        Behavior on x { enabled: th.motion; NumberAnimation { duration: 280; easing.type: Easing.OutCubic } }
        columns: bar.down ? 1 : Math.max(1, rep.count)
        spacing: bar.gap
        Repeater {
            id: rep
            model: bar.tabs
            delegate: Item {
                id: tab
                readonly property bool active: index === bar.current
                readonly property bool lit: active && bar.focused
                readonly property string kind: bar.kindOf(modelData.id)
                readonly property real segW: bar.look === "segments" ? bar.span / Math.max(1, bar.tabs.length) : 0
                width: bar.look === "round" ? th.clamp(46, 9.5 * th.vh, 96)
                     : bar.down ? bar.span
                     : bar.look === "segments" ? Math.max(segW, label.implicitWidth + 2 * th.clamp(12, 1.8 * th.vw, 30))
                     : bar.barPill ? label.implicitWidth + 32 + (tab.kind !== "new" ? 1.1 * label.font.pixelSize + 8 : 0) + 4
                     : label.implicitWidth + 2 * (bar.look === "text" || bar.look === "pivots" ? 0 : bar.look === "chunky" ? th.clamp(14, 1.6 * th.vw, 26) : 24)
                height: bar.look === "round" ? width
                      : bar.look === "chunky" ? label.implicitHeight + 2 * th.clamp(10, 1.9 * th.vh, 20)
                      : bar.look === "pivots" ? label.implicitHeight + 8
                      : bar.look === "text" ? label.implicitHeight + 8
                      : bar.look === "segments" ? label.implicitHeight + 2 * th.clamp(7, 1.1 * th.vh, 12)
                      : bar.down ? label.implicitHeight + 2 * th.clamp(8, 1.2 * th.vh, 14)
                      : label.implicitHeight + 16
                transform: Translate { x: bar.look === "chunky" && tab.lit ? 10 : 0 }
                scale: bar.look === "chunky" && tab.lit ? 1.04 : 1
                Behavior on scale { enabled: th.motion; NumberAnimation { duration: 200 } }

                // the glow ring around a focused pill / round tab
                Rectangle {
                    visible: tab.lit && (bar.look === "pills" || bar.look === "round" || bar.look === "chunky")
                    z: -1
                    anchors.fill: shape
                    anchors.margins: bar.look === "round" ? -8 : -3
                    radius: height / 2
                    color: bar.look === "round" || bar.look === "chunky" ? th.glowRing : th.alpha(th.glowRing, 0.28 * th.tabShadow)
                }
                Rectangle {   // round: the gap between the button and its ring
                    visible: tab.lit && bar.look === "round"
                    anchors.fill: shape
                    anchors.margins: -4
                    radius: height / 2
                    color: th.bg
                }
                Rectangle {
                    id: shape
                    anchors.fill: parent
                    radius: bar.look === "round" || bar.look === "chunky" || (bar.look === "pills" && !bar.down) ? height / 2
                          : bar.look === "pills" && bar.down ? th.radius * 0.72 : 0
                    color: bar.barPill ? (tab.active ? th.card : th.alpha(th.card, 0.65))
                         : bar.look === "pills" ? (tab.lit ? th.accent : tab.active ? th.alpha(th.accent, 0.14) : "transparent")
                         : bar.look === "segments" ? (tab.active ? th.alpha(th.accent, 0.22) : "transparent")
                         : bar.look === "round" ? th.card : "transparent"
                    gradient: bar.look !== "chunky" ? null : tab.lit ? chunkyLit : tab.active ? chunkyOn : chunkyOff
                    border.width: bar.barPill ? 2 : bar.look === "round" && tab.active && !tab.lit ? 2 : 0
                    border.color: bar.barPill ? (tab.lit ? th.accent : tab.active ? th.mix(th.border, th.accent, 0.5) : th.border) : th.alpha(th.accent, 0.45)
                    Gradient { id: chunkyOff; GradientStop { position: 0; color: th.mix(th.border, th.panel, 0.3) } GradientStop { position: 0.7; color: th.panel } }
                    Gradient { id: chunkyOn; GradientStop { position: 0; color: th.mix(th.border, th.accent, 0.35) } GradientStop { position: 0.75; color: th.panel } }
                    Gradient { id: chunkyLit; GradientStop { position: 0; color: th.mix(th.border, th.accent, 0.6) } GradientStop { position: 0.8; color: th.mix(th.panel, th.accent, 0.15) } }
                    Behavior on color { enabled: th.motion; ColorAnimation { duration: 200 } }
                }
                Rectangle {   // segments: the line between two; text / pivots: the underline
                    visible: bar.look === "segments" && index > 0
                    width: 1; height: parent.height
                    color: th.alpha(th.text, 0.22)
                }
                Rectangle {
                    visible: (bar.look === "pivots" || bar.look === "segments") && tab.lit || bar.look === "text" && tab.lit
                    anchors.bottom: parent.bottom
                    anchors.bottomMargin: bar.look === "text" ? -6 : 0
                    anchors.horizontalCenter: parent.horizontalCenter
                    width: bar.look === "text" ? label.implicitWidth : parent.width
                    height: bar.look === "text" ? 3 : 4
                    color: bar.look === "text" ? th.glowRing : th.accent
                }
                // round: a line icon, and the name under the focused one
                Shape {
                    id: icon
                    visible: bar.look === "round"
                    anchors.centerIn: parent
                    width: parent.width * 0.46
                    height: width
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        strokeColor: tab.active || tab.lit ? bar.tint[tab.kind] || th.muted : th.muted
                        strokeWidth: 1.8
                        fillColor: "transparent"
                        capStyle: ShapePath.RoundCap
                        joinStyle: ShapePath.RoundJoin
                        scale: Qt.size(icon.width / 24, icon.height / 24)
                        PathSvg { path: tabIcons[tab.kind] || "" }
                    }
                }
                Text {
                    visible: bar.look === "round"
                    anchors.top: parent.bottom
                    anchors.topMargin: 8
                    anchors.horizontalCenter: parent.horizontalCenter
                    text: modelData.title
                    color: th.accent
                    opacity: tab.lit ? 1 : 0
                    font.pixelSize: 0.85 * th.rem
                    font.weight: Font.Bold
                    Behavior on opacity { enabled: th.motion; NumberAnimation { duration: 200 } }
                }
                Shape {     // bar pills: the tab's line icon before its name
                    visible: bar.barPill && tab.kind !== "new"
                    x: label.x - width - 8
                    y: (parent.height - height) / 2
                    width: 1.1 * label.font.pixelSize
                    height: width
                    preferredRendererType: Shape.CurveRenderer
                    ShapePath {
                        strokeColor: label.color
                        strokeWidth: 1.8
                        fillColor: "transparent"
                        capStyle: ShapePath.RoundCap
                        joinStyle: ShapePath.RoundJoin
                        scale: Qt.size(parent.width / 24, parent.width / 24)
                        PathSvg { path: tabIcons[tab.kind] || "" }
                    }
                }
                Text {
                    id: label
                    visible: bar.look !== "round"
                    anchors.verticalCenter: parent.verticalCenter
                    x: bar.barPill ? (parent.width - implicitWidth - (tab.kind !== "new" ? 1.1 * font.pixelSize + 8 : 0)) / 2 + (tab.kind !== "new" ? 1.1 * font.pixelSize + 8 : 0)
                     : bar.look === "segments" ? (parent.width - implicitWidth) / 2
                     : bar.down || bar.look === "chunky" ? (bar.look === "chunky" ? th.clamp(14, 1.6 * th.vw, 26) : th.clamp(10, 1 * th.vw, 16))
                     : (parent.width - implicitWidth) / 2
                    text: modelData.title
                    font.pixelSize: (bar.barPill ? 1.0 : bar.look === "pivots" ? 1.7 : bar.look === "text" ? 1.15 : bar.look === "chunky" ? 1.25 : 1.35) * th.rem
                    font.weight: bar.look === "pivots" ? (tab.active ? Font.Normal : Font.Light)
                               : bar.look === "chunky" ? Font.ExtraBold
                               : bar.look === "text" ? (tab.active ? Font.Bold : Font.Medium) : Font.DemiBold
                    color: bar.barPill ? (tab.active ? th.text : th.muted)
                         : bar.look === "pills" ? (tab.lit ? th.accentInk : tab.active ? th.accent : th.muted)
                         : bar.look === "chunky" ? (tab.lit ? "#ffffff" : tab.active ? th.text : th.alpha(th.text, 0.75))
                         : bar.look === "pivots" ? (tab.active ? th.text : th.alpha(th.text, 0.45))
                         : bar.look === "text" ? (tab.active ? th.text : th.muted)
                         : tab.active ? th.text : th.muted
                    style: bar.look === "chunky" ? Text.Raised : Text.Normal
                    styleColor: Qt.rgba(0, 0, 0, 0.35)
                    Behavior on color { enabled: th.motion; ColorAnimation { duration: 200 } }
                }
            }
        }
    }
}
