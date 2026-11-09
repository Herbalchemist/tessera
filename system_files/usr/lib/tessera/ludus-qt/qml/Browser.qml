// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the built-in browser. Tessera stays around the page (the frame: the neighbouring tabs,
// the address with its lock, title and loading line, the page in its bezel with corner brackets;
// Theme Settings › Browser frame), or the page takes the whole screen. The page is QtWebEngine's
// (BrowserPage.qml). The controller pointer is drawn here; what moves it, and what the sticks and
// buttons do, is the full Ludus's own browser code (see backend/bridge.js, ludus.py BrowserInput).
// Coming in and going out is animated on the live page (Theme Settings › Browser animation).
import QtQuick

Item {
    id: br
    property Theme th
    property string prevName: ""
    property string nextName: ""
    property string profileId: ""
    property string downloadDir: ""
    property string fallbackUrl: ""         // the address shown before the page reports its own
    property var st: ({ url: "", title: "", loading: false, canGoBack: false })
    property bool alive: false              // a page exists (it keeps its place between visits, like a tab)
    property bool shown: false              // on screen now
    property bool moving: false             // an entrance or exit is playing
    property string pendingUrl: ""
    property real prog: 1
    property int dir: 1
    property bool entering: true
    signal report(var st)
    signal placed(var r)                    // where the page sits, in window pixels
    signal closed()                         // an exit has finished
    visible: shown

    component Keycap: Rectangle {
        property Theme th
        property string label: ""
        implicitWidth: Math.max(th.rem * 2.1, keyText.implicitWidth + th.rem * 0.9)
        implicitHeight: th.rem * 1.55
        width: implicitWidth; height: implicitHeight
        radius: th.rem * 0.45
        color: th.alpha(th.text, 0.10)
        Text { id: keyText; anchors.centerIn: parent; text: parent.label; color: th.text; font.pixelSize: 0.78 * th.rem; font.weight: Font.Bold }
    }

    // ---- the frame's measurements (style.css #browser-frame)
    readonly property bool framed: th.val("browserFrame", "framed") !== "full"
    readonly property real topH: th.clamp(46, 7.2 * th.vh, 72)
    readonly property real pad: th.clamp(10, 1.4 * th.vw, 22)
    readonly property real lip: th.clamp(5, 0.55 * th.vw, 8)
    readonly property real vx: framed ? pad + lip : 0
    readonly property real vy: framed ? topH + lip : 0
    readonly property real vw: framed ? width - 2 * (pad + lip) : width
    readonly property real vh: framed ? height - topH - pad - 2 * lip : height
    readonly property var rect: ({ x: Math.round(vx), y: Math.round(vy), width: Math.round(vw), height: Math.round(vh) })
    onRectChanged: if (shown) placed(rect)

    readonly property string animStyle: !th.motion ? "none" : (["slide", "zoom", "fade", "rise", "flip", "doors", "none"].indexOf(th.val("browserAnim", "slide")) >= 0 ? th.val("browserAnim", "slide") : "slide")
    readonly property string address: st.url || fallbackUrl
    readonly property string host: {
        var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]*)/i.exec(address || "")
        return m ? m[1].replace(/^www\./, "") : ""
    }
    readonly property bool secure: /^https:/i.test(address || "")
    readonly property string pageTitle: { var t = (st.title || "").trim(); return t && t !== host ? t : "" }

    // ---- going in and out
    function prepare() { alive = true; shown = true; placed(rect) }
    function enter(d) {
        dir = d; entering = true
        if (animStyle === "none") { prog = 1; return }
        moving = true
        prog = 0
        slide.from = 0; slide.to = 1; slide.restart()
    }
    function leave(d) {
        dir = d; entering = false
        if (animStyle === "none") { prog = 1; finish(); return }
        moving = true
        slide.from = 1; slide.to = 0; slide.restart()
    }
    function finish() { shown = false; moving = false; prog = 1; closed() }
    NumberAnimation {
        id: slide
        target: br; property: "prog"; duration: 340
        easing.type: br.entering ? Easing.OutCubic : Easing.InCubic
        onFinished: { br.moving = false; if (!br.entering) br.finish() }
    }
    // a hidden page is dropped (another person is playing)
    function drop() { alive = false; shown = false; moving = false; pendingUrl = ""; st = { url: "", title: "", loading: false, canGoBack: false } }
    function load(u) { pendingUrl = u; if (pageLoader.item) { pageLoader.item.load(u); pendingUrl = "" } }
    function focusPage() { if (pageLoader.item) pageLoader.item.focusPage() }

    // the way the entrance moves: how far along (p), from the side you were heading toward
    readonly property real away: 1 - prog
    readonly property real off: entering ? dir : -dir
    Item {
        id: mover
        width: br.width; height: br.height
        opacity: br.animStyle === "fade" ? br.prog : br.animStyle === "zoom" ? br.prog : br.animStyle === "rise" ? 0.4 + 0.6 * br.prog
               : br.animStyle === "flip" ? br.prog : br.animStyle === "doors" ? br.prog : 1
        x: br.animStyle === "slide" ? br.off * br.width * br.away : 0
        y: br.animStyle === "rise" ? br.height * br.away : 0
        scale: br.animStyle === "zoom" ? 0.06 + 0.94 * br.prog : br.animStyle === "rise" ? 0.94 + 0.06 * br.prog
             : br.animStyle === "doors" ? 0.5 + 0.5 * br.prog : 1
        transformOrigin: br.animStyle === "zoom" ? Item.Top : Item.Center
        transform: Rotation {
            origin.x: br.width / 2; origin.y: br.height / 2
            axis { x: 0; y: 1; z: 0 }
            angle: br.animStyle === "flip" ? (br.entering ? -84 : 84) * br.away : 0
        }

        // ---- the frame
        Item {
            visible: br.framed
            anchors.fill: parent
            Rectangle {
                anchors.fill: parent
                gradient: Gradient {
                    GradientStop { position: 0; color: th.mix(th.panel, th.bg, 0.15) }
                    GradientStop { position: 1; color: th.bg }
                }
            }
            // the glow in two corners (an ellipse of the accent, fading out)
            Canvas {
                id: glowArt
                anchors.fill: parent
                onWidthChanged: requestPaint()
                onHeightChanged: requestPaint()
                Connections { target: th; function onAccentChanged() { glowArt.requestPaint() } }
                onPaint: {
                    var c = getContext("2d")
                    c.reset()
                    var glow = function (cx, cy, rx, ry, a) {
                        c.save()
                        c.translate(cx, cy)
                        c.scale(1, ry / rx)
                        var g = c.createRadialGradient(0, 0, 0, 0, 0, rx)
                        g.addColorStop(0, Qt.rgba(th.accent.r, th.accent.g, th.accent.b, a))
                        g.addColorStop(0.7, Qt.rgba(th.accent.r, th.accent.g, th.accent.b, 0))
                        c.fillStyle = g
                        c.fillRect(-rx, -rx, 2 * rx, 2 * rx)
                        c.restore()
                    }
                    glow(0, 0, width * 0.6, height * 0.5, 0.22)
                    glow(width, height, width * 0.5, height * 0.45, 0.14)
                }
            }
            Canvas {
                anchors.fill: parent
                opacity: 0.07
                onWidthChanged: requestPaint()
                onHeightChanged: requestPaint()
                onPaint: {
                    var c = getContext("2d")
                    c.reset()
                    c.strokeStyle = th.accent
                    c.lineWidth = 1
                    c.beginPath()
                    var bands = [[0, height * 0.3], [height * 0.7, height]]
                    for (var b = 0; b < 2; b++) {
                        for (var y = Math.ceil(bands[b][0] / 28) * 28; y <= bands[b][1]; y += 28) { c.moveTo(0, y + 0.5); c.lineTo(width, y + 0.5) }
                        for (var x = 0; x <= width; x += 28) { c.moveTo(x + 0.5, bands[b][0]); c.lineTo(x + 0.5, bands[b][1]) }
                    }
                    c.stroke()
                }
            }

            // the top bar: the tab to the left, the address in the middle, the hints to the right
            Item {
                id: bar
                width: parent.width; height: br.topH
                readonly property real inset: br.pad + br.lip
                Row {
                    x: bar.inset; anchors.verticalCenter: parent.verticalCenter
                    spacing: 10
                    Keycap { th: br.th; label: "LB" }
                    Text { text: "‹ " + br.prevName; color: th.muted; font.pixelSize: 0.95 * th.rem; anchors.verticalCenter: parent.verticalCenter }
                }
                Rectangle {
                    id: pill
                    anchors.centerIn: parent
                    height: br.topH * 0.62
                    width: Math.min(br.width * 0.46, Math.max(Math.min(br.width * 0.3, 420), addrRow.implicitWidth + 40))
                    radius: height / 2
                    clip: true
                    color: th.mix(th.panel, th.bg, 0.3)
                    border.width: 1; border.color: th.alpha(th.accent, 0.35)
                    Row {
                        id: addrRow
                        x: 20; anchors.verticalCenter: parent.verticalCenter
                        spacing: 10
                        width: pill.width - 40
                        Canvas {
                            id: lock
                            width: 16; height: 16; anchors.verticalCenter: parent.verticalCenter
                            property color ink: br.secure ? th.ok : th.muted
                            onInkChanged: requestPaint()
                            onPaint: {
                                var c = getContext("2d")
                                c.reset()
                                c.strokeStyle = ink; c.lineWidth = 1.4; c.lineJoin = "round"
                                var s = 16 / 24
                                c.strokeRect(5 * s, 10.5 * s, 14 * s, 10 * s)
                                c.beginPath(); c.moveTo(8.2 * s, 10.5 * s); c.lineTo(8.2 * s, 8 * s)
                                c.arc(12 * s, 8 * s, 3.8 * s, Math.PI, 0); c.lineTo(15.8 * s, 10.5 * s); c.stroke()
                            }
                        }
                        Text { id: hostText; text: br.host || "New page"; color: th.text; font.pixelSize: th.rem; font.weight: Font.DemiBold; anchors.verticalCenter: parent.verticalCenter }
                        Text {
                            visible: br.pageTitle !== ""
                            text: "—  " + br.pageTitle
                            color: th.muted; font.pixelSize: 0.88 * th.rem
                            elide: Text.ElideRight
                            width: Math.max(0, addrRow.width - lock.width - hostText.width - 2 * addrRow.spacing)
                            anchors.verticalCenter: parent.verticalCenter
                        }
                    }
                    // loading: a light running along the bottom of the pill
                    Rectangle {
                        id: run
                        visible: br.st.loading
                        y: pill.height - 2; height: 2; width: pill.width * 0.4
                        gradient: Gradient {
                            orientation: Gradient.Horizontal
                            GradientStop { position: 0; color: "transparent" }
                            GradientStop { position: 0.5; color: th.accent }
                            GradientStop { position: 1; color: "transparent" }
                        }
                        SequentialAnimation on x {
                            running: br.st.loading && br.shown
                            loops: Animation.Infinite
                            NumberAnimation { from: -pill.width * 0.4; to: pill.width * 1.0; duration: 1100 }
                        }
                    }
                }
                Row {
                    anchors.right: parent.right; anchors.rightMargin: bar.inset; anchors.verticalCenter: parent.verticalCenter
                    spacing: 10
                    Keycap { th: br.th; label: "Y" }
                    Text { text: "Address"; color: th.muted; font.pixelSize: 0.95 * th.rem; anchors.verticalCenter: parent.verticalCenter; rightPadding: 8 }
                    Text { text: br.nextName + " ›"; color: th.muted; font.pixelSize: 0.95 * th.rem; anchors.verticalCenter: parent.verticalCenter }
                    Keycap { th: br.th; label: "RB" }
                }
            }

            // the bezel: the page sits in its opening
            Rectangle {
                x: br.pad; y: br.topH; width: parent.width - 2 * br.pad; height: parent.height - br.topH - br.pad
                radius: th.radius + br.lip
                gradient: Gradient {
                    GradientStop { position: 0; color: th.mix(th.panel, th.text, 0.06) }
                    GradientStop { position: 1; color: th.mix(th.panel, th.bg, 0.08) }
                }
                border.width: 1; border.color: th.alpha(th.accent, 0.45)
            }
            // corner brackets in the accent, just outside the page
            Repeater {
                model: [[-1, -1], [1, -1], [-1, 1], [1, 1]]
                delegate: Item {
                    readonly property real cx: modelData[0] < 0 ? br.vx - 6 : br.vx + br.vw + 6
                    readonly property real cy: modelData[1] < 0 ? br.vy - 6 : br.vy + br.vh + 6
                    Rectangle { x: parent.cx - (modelData[0] < 0 ? 0 : 22); y: parent.cy - (modelData[1] < 0 ? 0 : 3); width: 22; height: 3; radius: 1.5; color: th.accent; visible: br.framed }
                    Rectangle { x: parent.cx - (modelData[0] < 0 ? 0 : 3); y: parent.cy - (modelData[1] < 0 ? 0 : 22); width: 3; height: 22; radius: 1.5; color: th.accent; visible: br.framed }
                }
            }
        }

        // ---- the page
        Rectangle {
            x: br.vx; y: br.vy; width: br.vw; height: br.vh
            color: "#ffffff"
            clip: true
            Loader {
                id: pageLoader
                anchors.fill: parent
                active: br.alive && webEngine && !shotMode
                source: "BrowserPage.qml"
                onLoaded: {
                    item.profileId = br.profileId
                    item.downloadDir = br.downloadDir
                    item.reported.connect(function (s) { br.st = s; br.report(s) })
                    if (br.pendingUrl) { item.load(br.pendingUrl); br.pendingUrl = "" }
                    item.focusPage()
                }
            }
            Text {
                visible: !webEngine || shotMode
                anchors.centerIn: parent
                width: parent.width * 0.8
                horizontalAlignment: Text.AlignHCenter
                wrapMode: Text.Wrap
                color: "#445"
                font.pixelSize: 1.3 * th.rem
                text: webEngine ? br.host : "This screen has no web engine installed."
            }
        }

        // ---- the pointer (the controller's cursor): the arrow, pressed a little smaller
        Item {
            id: cursor
            property real px: 0
            property real py: 0
            property bool on: false
            property bool down: false
            visible: on
            x: px; y: py                     // the main process places the pointer's own corner (the tip sits 4, 3 inside it)
            transform: Scale { origin.x: 4; origin.y: 3; xScale: cursor.down ? 0.82 : 1; yScale: cursor.down ? 0.82 : 1 }
            Canvas {
                width: 40; height: 51
                onPaint: {
                    var c = getContext("2d")
                    c.reset()
                    c.scale(40 / 30, 40 / 30)
                    c.beginPath()
                    c.moveTo(3, 2); c.lineTo(3, 30); c.lineTo(10, 23.5); c.lineTo(15, 35); c.lineTo(20.5, 32.8); c.lineTo(15.5, 21.5); c.lineTo(25, 21.5); c.closePath()
                    c.fillStyle = "#ffffff"; c.fill()
                    c.lineWidth = 2; c.lineJoin = "round"; c.strokeStyle = "#111111"; c.stroke()
                }
            }
        }
    }
    // where the controller's pointer is, from the main process (window pixels)
    function pointer(d) {
        if (!d) return
        if (d.x !== undefined) { cursor.px = d.x; cursor.py = d.y }
        if (d.visible !== undefined) cursor.on = d.visible
        if (d.down !== undefined) cursor.down = d.down
    }
}
