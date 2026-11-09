// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the clock bar's person (home.js .cb-who): a head and shoulders, drawn as lines.
import QtQuick

Canvas {
    id: ic
    property color ink: "#ffffff"
    onInkChanged: requestPaint()
    onWidthChanged: requestPaint()
    onPaint: {
        var c = getContext("2d"), k = width / 24
        c.reset()
        c.strokeStyle = ink; c.lineWidth = 1.6 * k; c.lineCap = "round"
        c.beginPath(); c.arc(12 * k, 9 * k, 4 * k, 0, Math.PI * 2); c.stroke()
        c.beginPath(); c.moveTo(4.5 * k, 20 * k); c.bezierCurveTo(5.9 * k, 16.4 * k, 8.7 * k, 14.8 * k, 12 * k, 14.8 * k)
        c.bezierCurveTo(15.3 * k, 14.8 * k, 18.1 * k, 16.4 * k, 19.5 * k, 20 * k); c.stroke()
    }
}
