// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): one tile, drawn the way style.css draws .card for the theme's tile look (standard,
// flat, metro, glossy, bezel) and selection frame (glow, framed, white, halo).
import QtQuick
import QtQuick.Window
import QtQuick.Shapes
import QtQuick.Effects

Item {
    id: tile
    objectName: "tile"
    property var t: ({})
    property Theme th
    property bool picked: false
    property bool grows: false        // row movement "start": the selection grows instead of scaling
    property string artRev: ""
    property bool near: true          // pictures load only near the selection (home.js artWindowFor)
    signal pointed()                   // the mouse moved over it
    signal tapped()                    // and clicked it
    MouseArea {
        z: 50
        anchors.fill: parent
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton
        cursorShape: tile.Window.window && tile.Window.window.mouseOn ? Qt.ArrowCursor : Qt.BlankCursor
        onPositionChanged: tile.pointed()
        onClicked: tile.tapped()
    }
    property real gridFont: 0         // grid and flow: the name scales with the tile (style.css .rows.grid .card)
    readonly property string look: th.parts.card
    readonly property string frame: th.parts.frame
    readonly property bool hasArt: t.art === true
    readonly property bool isAdd: t.kind === "add"
    readonly property bool dashed: isAdd || t.big === true || t.kind === "folder"
    // add tiles follow the theme's "Add tile outline" setting; folders are always dashed
    readonly property string outline: t.kind === "folder" ? "dashed" : dashed ? th.addTile : "solid"
    readonly property real r: th.cardRadius

    scale: !picked || grows ? 1 : frame === "glow" ? 1.08 : frame === "framed" ? 1 : 1.04
    z: picked ? 2 : 1
    Behavior on scale { enabled: th.motion; NumberAnimation { duration: 200; easing.type: Easing.OutCubic } }

    // ---- the selection: rings drawn behind the tile, the tile on top
    Rectangle {      // the outer ring (glow, framed's frame, white)
        visible: tile.picked && tile.frame !== "halo"
        anchors.fill: face
        anchors.margins: -(tile.frame === "framed" ? th.ring * 2 : th.ring)
        radius: tile.r + Math.abs(anchors.margins)
        color: tile.frame === "white" ? "#ffffff" : th.glowRing
        SequentialAnimation on opacity {   // framed: the frame breathes
            running: tile.picked && tile.frame === "framed" && th.motion
            loops: Animation.Infinite
            NumberAnimation { from: 1; to: 0.55; duration: 800; easing.type: Easing.InOutSine }
            NumberAnimation { from: 0.55; to: 1; duration: 800; easing.type: Easing.InOutSine }
        }
    }
    Rectangle {      // framed: the gap between tile and frame
        visible: tile.picked && tile.frame === "framed"
        anchors.fill: face
        anchors.margins: -(th.ring - 1)
        radius: tile.r + th.ring
        color: th.bg
    }
    Rectangle {      // halo: a soft light all round
        visible: tile.picked && tile.frame === "halo"
        anchors.fill: face
        anchors.margins: -12
        radius: tile.r + 12
        color: th.alpha(th.glowRing, 0.32)
        layer.enabled: visible
        layer.effect: MultiEffect { blurEnabled: true; blur: 0.8; blurMax: 24 }
    }

    Rectangle {
        id: face
        anchors.fill: parent
        radius: tile.r
        clip: false
        color: tile.isAdd ? "transparent"
             : tile.t.big === true ? th.card
             : tile.look === "metro" && (tile.t.kind === "app" || tile.t.kind === "action") ? th.accent
             : tile.t.kind === "folder" ? th.mix(th.card, Qt.color("#ffffff"), 0.06)
             : tile.t.kind === "action" ? th.mix(th.card, th.ok, 0.08)
             : th.card
        gradient: tile.look === "glossy" && !tile.isAdd ? glossy : tile.look === "bezel" && !tile.isAdd ? bezel : null
        border.width: tile.look === "bezel" ? 3 : tile.dashed && !tile.picked ? (tile.outline === "solid" ? 2 : 0) : tile.frame === "halo" && tile.picked ? Math.max(2, th.borderW) : th.borderW
        border.color: tile.frame === "halo" && tile.picked ? th.glowRing
                    : tile.look === "bezel" ? th.mix(th.border, Qt.color("#ffffff"), 0.4)
                    : tile.dashed ? (tile.picked ? "transparent" : th.border) : th.border
        Gradient {
            id: glossy
            GradientStop { position: 0; color: th.mix(th.card, Qt.color("#ffffff"), 0.15) }
            GradientStop { position: 0.55; color: th.card }
        }
        Gradient {
            id: bezel
            GradientStop { position: 0; color: th.card }
            GradientStop { position: 1; color: th.mix(th.card, Qt.color("#000000"), 0.06) }
        }
        // the soft lift under every tile, stronger on the selected one
        layer.enabled: tile.look !== "metro" && th.shadow > 0
        layer.effect: MultiEffect {
            shadowEnabled: true
            shadowColor: Qt.rgba(0, 0, 0, th.shadow * (tile.picked ? 0.45 : tile.look === "flat" ? 0.12 : 0.14))
            shadowBlur: tile.picked ? 0.9 : 0.6
            shadowVerticalOffset: tile.picked ? 8 : 6
            blurMax: 26
        }

        // ---- the picture, rounded like the tile
        Image {
            id: art
            anchors.fill: parent
            anchors.margins: face.border.width
            visible: false
            source: tile.hasArt && tile.near ? "image://art/" + encodeURIComponent(tile.t.id) + "?" + tile.artRev : ""
            fillMode: Image.PreserveAspectCrop
            asynchronous: true
            sourceSize.width: 600
        }
        Item {
            id: artMask
            anchors.fill: art
            visible: false
            layer.enabled: true
            Rectangle { anchors.fill: parent; radius: Math.max(0, tile.r - face.border.width); color: "black" }
        }
        MultiEffect {
            anchors.fill: art
            visible: tile.hasArt && art.status === Image.Ready
            source: art
            maskEnabled: true
            maskSource: artMask
        }
        Item {    // Settings tiles: a line icon over a wash of the highlight color (style.css .card.has-ico)
            id: ico
            readonly property string path: tile.t.icon && th.setIcons !== "off" && typeof settingIcons !== "undefined" ? (settingIcons[tile.t.icon] || "") : ""
            anchors.fill: art
            visible: path !== ""
            Rectangle {
                anchors.fill: parent
                radius: artMask.children[0].radius
                color: th.mix(th.card, th.accent, tile.picked ? 0.28 : 0.16)
                gradient: Gradient {
                    GradientStop { position: 0; color: th.mix(th.card, th.accent, tile.picked ? 0.28 : 0.16) }
                    GradientStop { position: 0.52; color: th.mix(th.card, th.accent, tile.picked ? 0.28 : 0.16) }
                    GradientStop { position: 0.88; color: th.card }
                }
            }
            Shape {
                id: iconShape
                width: Math.min(parent.width, parent.height) * 0.46; height: width     // style.css: the svg is 46% wide and 46% tall, whichever is smaller
                x: (parent.width - width) / 2; y: parent.height * 0.15
                layer.enabled: true
                layer.samples: 4
                ShapePath {
                    strokeColor: th.accent
                    strokeWidth: 1.6
                    fillColor: "transparent"
                    capStyle: ShapePath.RoundCap
                    joinStyle: ShapePath.RoundJoin
                    scale: Qt.size(iconShape.width / 24, iconShape.width / 24)
                    PathSvg { path: ico.path }
                }
            }
        }
        Rectangle {    // the shade that keeps a name readable over a picture
            anchors.fill: art
            visible: tile.hasArt && tile.look !== "flat"
            radius: artMask.children[0].radius
            gradient: Gradient {
                GradientStop { position: tile.look === "metro" ? 0.6 : tile.look === "bezel" ? 0.55 : 0.45; color: "transparent" }
                GradientStop { position: 1; color: Qt.rgba(0, 0, 0, tile.look === "metro" ? 0.7 : tile.look === "bezel" ? 0.45 : 0.78) }
            }
        }

        // ---- what it says
        Column {
            id: words
            readonly property bool centered: tile.isAdd || tile.t.big === true || ((tile.look === "flat" || tile.look === "bezel") && !tile.hasArt && !(tile.look === "flat" && th.parts.spot === "on"))
            visible: !(tile.look === "flat" && tile.hasArt)
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.margins: tile.look === "metro" ? 13 : tile.grows && th.parts.size === "small" ? 10 : 20 * th.auto
            y: centered ? (parent.height - height) / 2 : parent.height - height - anchors.margins
            spacing: 4
            Text {   // the big +
                visible: tile.isAdd
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: "+"
                color: th.accent
                font.pixelSize: (tile.t.big === true ? 7 : 4) * th.rem
                font.weight: Font.Light
            }
            Text {   // GAME / APP / FOLDER
                visible: !tile.isAdd && !tile.hasArt && !ico.visible && text !== ""
                width: parent.width
                horizontalAlignment: words.centered ? Text.AlignHCenter : Text.AlignLeft
                text: (tile.t.offline ? (tile.t.offline === "drive" ? "Drive not connected" : "Files missing")
                       : (tile.t.kind === "action" ? (tile.t.sub || "") : ({ folder: "Folder", app: "App", game: "Game" })[tile.t.kind] || "")).toUpperCase()
                color: tile.look === "metro" && (tile.t.kind === "app" || tile.t.kind === "action") ? Qt.rgba(1, 1, 1, 0.75) : th.muted
                font.pixelSize: 0.8 * th.rem
                font.weight: Font.Medium
                font.letterSpacing: 0.06 * 0.8 * th.rem
            }
            Text {
                width: parent.width
                horizontalAlignment: words.centered ? Text.AlignHCenter : Text.AlignLeft
                text: tile.t.title || ""
                color: tile.hasArt ? "#ffffff" : tile.isAdd ? (tile.look === "bezel" ? th.mix(th.text, th.muted, 0.25) : th.muted) : tile.t.big === true ? th.text
                     : tile.look === "metro" && (tile.t.kind === "app" || tile.t.kind === "action") ? th.accentInk
                     : tile.look === "bezel" ? th.mix(th.text, th.muted, 0.25) : th.text
                font.pixelSize: tile.gridFont > 0 && tile.t.big !== true ? tile.gridFont : (tile.t.big === true ? 2 : tile.look === "metro" ? 0.95 : tile.look === "bezel" ? 1 : th.parts.nav === "bottom-dock" && th.mode === "rails" ? 1.1 : 1.2) * th.rem
                font.weight: tile.look === "metro" ? Font.Normal : Font.DemiBold
                wrapMode: Text.Wrap
                maximumLineCount: 3
                elide: Text.ElideRight
                lineHeight: 1.25
                style: tile.hasArt ? Text.Raised : Text.Normal
                styleColor: Qt.rgba(0, 0, 0, 0.6)
            }
            Text {   // an icon tile: the title first, then its status (style.css .card.has-ico small { order: 2 })
                visible: ico.visible && !tile.hasArt && (tile.t.sub || "") !== ""
                width: parent.width
                horizontalAlignment: words.centered ? Text.AlignHCenter : Text.AlignLeft
                text: (tile.t.sub || "").toUpperCase()
                color: th.muted
                font.pixelSize: 0.8 * th.rem
                font.weight: Font.Medium
                font.letterSpacing: 0.06 * 0.8 * th.rem
                elide: Text.ElideRight
            }
            Text {   // the line under a big empty tile
                visible: (tile.t.big === true || tile.isAdd) && (tile.t.sub || "") !== ""
                width: parent.width
                horizontalAlignment: Text.AlignHCenter
                text: tile.t.sub || ""
                color: th.muted
                font.pixelSize: (tile.t.big === true ? 1.2 : 1) * th.rem
                wrapMode: Text.Wrap
            }
        }
    }
    Canvas {     // the dashed outline of add tiles and folders
        id: dashCanvas
        anchors.fill: parent
        visible: tile.dashed && !tile.picked && tile.outline === "dashed" && tile.look !== "bezel"
        z: 2
        onVisibleChanged: requestPaint()
        onWidthChanged: requestPaint()
        onHeightChanged: requestPaint()
        Connections { target: th; function onBorderChanged() { dashCanvas.requestPaint() } }
        onPaint: {
            var c = getContext("2d"), r = Math.min(tile.r, width / 2, height / 2)
            c.clearRect(0, 0, width, height)
            c.lineWidth = 2
            c.strokeStyle = th.border
            c.setLineDash([6, 4])
            c.beginPath()
            c.moveTo(r + 1, 1); c.lineTo(width - r - 1, 1); c.arcTo(width - 1, 1, width - 1, r + 1, r - 1)
            c.lineTo(width - 1, height - r - 1); c.arcTo(width - 1, height - 1, width - r - 1, height - 1, r - 1)
            c.lineTo(r + 1, height - 1); c.arcTo(1, height - 1, 1, height - r - 1, r - 1)
            c.lineTo(1, r + 1); c.arcTo(1, 1, r + 1, 1, r - 1)
            c.closePath(); c.stroke()
        }
    }
}
