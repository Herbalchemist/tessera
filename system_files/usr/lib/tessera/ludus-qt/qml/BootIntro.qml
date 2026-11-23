// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the last step of the boot. Plymouth leaves the symbol, the wordmark and the tagline
// on black; this picks that picture up unchanged, sets tesserae out from behind the symbol until
// the whole screen is a mosaic (the letters are gone before the tiles reach them), and dissolves
// the mosaic into Ludus. Any press skips it (Main.qml's act).
//
// Sizes are fixed, like Plymouth's watermark.png: the same 320 px symbol box at every resolution,
// so the handoff never jumps. The timings are the ones the animation was judged with.
import QtQuick

Item {
    id: intro
    anchors.fill: parent

    property bool started: false       // the Plymouth picture is up (and holds until the burst)
    property bool running: false       // the burst is playing
    property real layerOpacity: 1      // the dissolve at the end
    property var stones: []
    signal finished()

    readonly property real cx: width / 2
    readonly property real cy: height / 2

    // ---- Plymouth's picture, in its own pixels (render.cjs: a 320 px symbol box, the wordmark
    // 44 px tall 4 px under it, the tagline 14 px under that)
    readonly property real symbolBox: 320
    readonly property real symbol: 244      // the stones inside the box, as the throbber draws them
    readonly property int wordW: 219
    readonly property int wordH: 44
    readonly property real wordTop: cy + 164
    readonly property real tagTop: cy + 222

    // ---- the timeline, in milliseconds (the numbers the preview was judged with)
    readonly property real burstAt: 0.12
    readonly property real spreadAt: 0.52
    readonly property real flightMs: 700
    readonly property real fadeAt: 1650
    readonly property real fadeMs: 600

    // the mosaic's palette (mosaic.py): one pastel per stone, neighbours never the same
    readonly property var shades: ['#b4a7ff', '#ffb3c7', '#8fe3cf', '#ffd98f', '#8ec5ff', '#ffb8a1',
                                   '#d3b3ff', '#a7e8f0', '#ffc9e6', '#c5e8a0', '#ffcf9e', '#a5b8ff',
                                   '#f5b0d8', '#9fe6b8']

    visible: started
    z: 40

    function open() {
        if (started) return
        build()
        layerOpacity = 1
        started = true
    }
    function burst() {
        if (!started || running) return
        running = true
    }
    function skip() {
        if (!started) return
        running = false
        started = false
        finished()
    }
    function end() {
        running = false
        started = false
        finished()
    }

    // A grid a little wider than the screen; every stone cut by hand: a shade of its own, a hair
    // off true, and further out the later it is set (so the mosaic grows outward from the symbol).
    function build() {
        if (width <= 0 || height <= 0) return
        var T = Math.round(height / 11.6)
        var gap = Math.max(6, Math.round(T * 0.09))
        var cols = Math.ceil(width / T) + 2
        var rows = Math.ceil(height / T) + 2
        var x0 = (width - cols * T) / 2
        var y0 = (height - rows * T) / 2
        var maxD = Math.sqrt(cx * cx + cy * cy)
        var out = []
        for (var r = 0; r < rows; r++) {
            for (var k = 0; k < cols; k++) {
                var i = r * cols + k
                var tx = x0 + (k + 0.5) * T + (rnd(i * 3 + 1) - 0.5) * 4
                var ty = y0 + (r + 0.5) * T + (rnd(i * 3 + 2) - 0.5) * 4
                var size = (T - gap) * (0.93 + 0.14 * rnd(i * 5 + 3))
                var d = Math.sqrt((tx - cx) * (tx - cx) + (ty - cy) * (ty - cy))
                var ci = Math.floor(rnd(i * 7 + 4) * shades.length)
                var left = k > 0 ? out[r * cols + k - 1] : null
                var up = r > 0 ? out[(r - 1) * cols + k] : null
                if ((left && left.ci === ci) || (up && up.ci === ci))
                    ci = (ci + 1 + Math.floor(rnd(i * 11 + 5) * 3)) % shades.length
                var a = rnd(i * 13 + 6) * Math.PI * 2
                var rad = 26 + rnd(i * 17 + 7) * 90
                out.push({
                    ci: ci,
                    color: shades[ci],
                    size: size,
                    sx: cx + Math.cos(a) * rad - size / 2,
                    sy: cy + Math.sin(a) * rad - size / 2,
                    x: tx - size / 2,
                    y: ty - size / 2,
                    startRot: (rnd(i * 19 + 8) - 0.5) * 70,
                    rot: (rnd(i * 23 + 9) - 0.5) * 5,
                    delay: (burstAt + spreadAt * (d / maxD) + 0.05 * rnd(i * 29 + 10)) * 1000
                })
            }
        }
        stones = out
    }
    // the same no-randomness the rest of the branding uses: the same stones, every boot
    function rnd(i) {
        var x = Math.sin(i * 127.1 + 311.7) * 43758.5453
        return x - Math.floor(x)
    }

    onWidthChanged: if (!running) build()
    onHeightChanged: if (!running) build()

    // the dissolve: the last tiles are down at about 1.4 s, then the mosaic lets Ludus through
    SequentialAnimation {
        running: intro.running
        PauseAnimation { duration: intro.fadeAt }
        NumberAnimation {
            target: intro
            property: "layerOpacity"
            to: 0
            duration: intro.fadeMs
            easing.type: Easing.OutCubic
        }
        ScriptAction { script: intro.end() }
    }

    Item {
        id: layer
        anchors.fill: parent
        opacity: intro.layerOpacity

        Rectangle { anchors.fill: parent; color: "#000000" }

        // the tesserae go on first, under the picture, so they come out from behind the symbol
        Item {
            anchors.fill: parent
            Repeater {
                model: intro.stones
                delegate: Item {
                    id: stone
                    width: modelData.size
                    height: modelData.size
                    x: modelData.sx
                    y: modelData.sy
                    rotation: modelData.startRot
                    scale: 0.3
                    opacity: 0
                    Rectangle {
                        anchors.fill: parent
                        radius: Math.max(4, stone.width * 0.12)
                        color: modelData.color
                    }
                    SequentialAnimation {
                        running: intro.running
                        PauseAnimation { duration: modelData.delay }
                        ParallelAnimation {
                            NumberAnimation { target: stone; property: "x"; to: modelData.x; duration: intro.flightMs; easing.type: Easing.OutCubic }
                            NumberAnimation { target: stone; property: "y"; to: modelData.y; duration: intro.flightMs; easing.type: Easing.OutCubic }
                            NumberAnimation { target: stone; property: "rotation"; to: modelData.rot; duration: intro.flightMs; easing.type: Easing.OutCubic }
                            NumberAnimation { target: stone; property: "scale"; to: 1; duration: intro.flightMs; easing.type: Easing.OutBack; easing.overshoot: 1.25 }
                            NumberAnimation { target: stone; property: "opacity"; to: 1; duration: 70 }
                        }
                    }
                }
            }
        }

        // the picture Plymouth left: the symbol, the wordmark, the tagline
        Text {
            id: tagline
            anchors.horizontalCenter: parent.horizontalCenter
            y: intro.tagTop
            text: "Designed for controllers, built by you"
            color: "#8f8aa3"
            font.family: "Cantarell"
            font.pixelSize: 15
            font.weight: Font.Normal
        }
        Image {
            id: wordmark
            anchors.horizontalCenter: parent.horizontalCenter
            y: intro.wordTop
            width: intro.wordW
            height: intro.wordH
            source: "../../../../share/tessera/branding/tessera-plymouth-watermark.png"
            smooth: true
        }
        Image {
            id: logo
            anchors.centerIn: parent
            width: intro.symbol
            height: intro.symbol
            source: "../../../../share/tessera/branding/tessera-logo-512.png"
            smooth: true
        }

        // the letters go before the tiles get to them; the symbol holds until the mosaic is around
        // it, then shrinks into it
        ParallelAnimation {
            running: intro.running
            NumberAnimation { target: tagline; property: "opacity"; to: 0; duration: 300; easing.type: Easing.OutCubic }
            SequentialAnimation {
                PauseAnimation { duration: 60 }
                NumberAnimation { target: wordmark; property: "opacity"; to: 0; duration: 340; easing.type: Easing.OutCubic }
            }
            SequentialAnimation {
                PauseAnimation { duration: 900 }
                NumberAnimation { target: logo; property: "scale"; to: 0.55; duration: 300; easing.type: Easing.OutCubic }
                NumberAnimation { target: logo; property: "opacity"; to: 0; duration: 160; easing.type: Easing.InCubic }
            }
        }
    }
}
