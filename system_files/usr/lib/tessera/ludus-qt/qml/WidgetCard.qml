// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): one Home widget, in the theme's widget style (style.css .card.kind-inlay, data-wg):
// frosted (a wash of the card color), clear glass (a see-through pane with a diagonal shine),
// outline, or solid. The built-in widgets are drawn here (core.js INLAYS); downloaded add-on widgets
// run in a sandboxed frame in the full Ludus and show their name here until the browser engine port.
import QtQuick
import QtQuick.Effects

Item {
    id: card
    property Theme th
    property var t: ({})
    property var sys: null            // systemInfo from the main process
    property var recent: []           // the recently played list (view.recent)
    property string now: ""           // clock text, set once a second
    property string day: ""
    property bool picked: false
    readonly property string kind: t.widget ? "addon" : t.missing ? "missing" : (t.type || "")
    readonly property string style: th.widgetStyle
    readonly property real inset: 20

    function bytes(n) {
        if (n === null || n === undefined || isNaN(n)) return "–"
        var u = ["B", "KB", "MB", "GB", "TB"], i = 0, v = n
        while (v >= 1024 && i < u.length - 1) { v /= 1024; i++ }
        return (i >= 3 ? v.toFixed(v >= 100 ? 0 : 1) : Math.round(v)) + " " + u[i]
    }
    function uptime(s) {
        if (s === null || s === undefined || isNaN(s)) return "–"
        var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60)
        return d > 0 ? d + "d " + h + "h" : h > 0 ? h + "h " + m + "m" : m + "m"
    }
    // [label, value, sub] of the six system widgets
    readonly property var info: {
        var s = sys, ty = t.type
        if (!s) return [({ cpu: "CPU", ram: "Memory", storage: "Storage", battery: "Battery", network: "Network", uptime: "Uptime" })[ty] || "", "–", ""]
        if (ty === "cpu") return ["CPU", s.cpu == null ? "–" : s.cpu + "%", ""]
        if (ty === "ram") return ["Memory", s.ram ? bytes(s.ram.used) : "–", s.ram ? "of " + bytes(s.ram.total) : ""]
        if (ty === "storage") return ["Storage", s.storage ? bytes(s.storage.free) : "–", s.storage ? "free of " + bytes(s.storage.total) : ""]
        if (ty === "battery") return ["Battery", s.battery && s.battery.present ? s.battery.pct + "%" : "No battery", s.battery && s.battery.present ? (s.battery.charging ? "Charging" : "On battery") : ""]
        if (ty === "network") return ["Network", s.network && s.network.connected ? "Connected" : "Disconnected",
                                      s.network && s.network.connected && s.network.rxRate != null ? "↓" + bytes(s.network.rxRate) + "/s ↑" + bytes(s.network.txRate) + "/s" : ""]
        if (ty === "uptime") return ["Uptime", uptime(s.uptime), ""]
        return ["", "", ""]
    }

    // ---- the pane
    Rectangle {
        id: pane
        anchors.fill: parent
        radius: th.cardRadius
        color: card.style === "frosted" ? th.alpha(th.card, th.widgetTint)
             : card.style === "solid" ? th.widgetColor
             : "transparent"
        gradient: card.style === "glass" ? glass : null
        border.width: card.style === "outline" ? Math.max(th.borderW, 2) : card.style === "glass" ? 1 : th.borderW
        border.color: card.style === "outline" ? th.accent : card.style === "glass" ? Qt.rgba(1, 1, 1, 0.38) : th.border
        Gradient {
            id: glass
            orientation: Gradient.Horizontal
            GradientStop { position: 0; color: Qt.rgba(1, 1, 1, (1 - th.widgetClear) * 0.5 + 0.05) }
            GradientStop { position: 1; color: Qt.rgba(1, 1, 1, (1 - th.widgetClear) * 0.18 + 0.01) }
        }
        Rectangle {     // glass: the bright edge and the diagonal shine
            visible: card.style === "glass"
            anchors.fill: parent
            radius: parent.radius
            color: "transparent"
            border.width: 1
            border.color: Qt.rgba(1, 1, 1, 0.22)
            Rectangle { x: 1; y: 1; width: parent.width - 2; height: 1; color: Qt.rgba(1, 1, 1, 0.6) }
        }
        Rectangle {
            visible: card.style === "glass" && th.widgetSheen
            anchors.fill: parent
            radius: parent.radius
            gradient: Gradient {
                orientation: Gradient.Horizontal
                GradientStop { position: 0; color: Qt.rgba(1, 1, 1, 0.3) }
                GradientStop { position: 0.26; color: Qt.rgba(1, 1, 1, 0.08) }
                GradientStop { position: 0.4; color: "transparent" }
                GradientStop { position: 0.68; color: "transparent" }
                GradientStop { position: 1; color: Qt.rgba(1, 1, 1, 0.1) }
            }
        }
        layer.enabled: card.picked && !th.pastel
        layer.effect: MultiEffect { shadowEnabled: true; shadowColor: Qt.rgba(0, 0, 0, 0.6); shadowBlur: 1; blurMax: 40; shadowVerticalOffset: 12 }
    }
    Rectangle {     // the selection (Tile.qml's ring, on a widget)
        anchors.fill: parent
        anchors.margins: -th.ring
        visible: card.picked
        radius: th.cardRadius + th.ring
        color: "transparent"
        border.width: th.ring
        border.color: th.glowRing
        z: 3
    }

    // small text borrows the main text color on see-through panes so it stays readable over any picture
    readonly property color small: style === "glass" || style === "outline" ? th.alpha(th.text, 0.8) : th.muted
    readonly property real big: th.clamp(1.6 * th.rem, 4.2 * th.vw, 6 * th.rem)
    readonly property real stat: th.clamp(1.3 * th.rem, 3.2 * th.vw, 4.4 * th.rem)

    Column {     // clock
        visible: card.kind === "clock"
        x: card.inset; width: parent.width - 2 * card.inset
        anchors.verticalCenter: parent.verticalCenter
        spacing: 10
        Text { text: card.now; color: th.text; font.pixelSize: Math.min(card.big, card.height * 0.42); font.weight: Font.DemiBold; font.letterSpacing: -0.02 * font.pixelSize; elide: Text.ElideRight; width: parent.width }
        Text { text: card.day; color: card.small; font.pixelSize: th.clamp(0.9 * th.rem, 1.4 * th.vw, 1.8 * th.rem); font.weight: Font.Medium; elide: Text.ElideRight; width: parent.width }
    }
    Column {     // CPU, memory, storage, battery, network, uptime
        visible: ["cpu", "ram", "storage", "battery", "network", "uptime"].indexOf(card.kind) >= 0
        x: card.inset; width: parent.width - 2 * card.inset
        anchors.verticalCenter: parent.verticalCenter
        spacing: 4
        Text { text: card.info[0].toUpperCase(); color: card.small; font.pixelSize: th.clamp(0.75 * th.rem, 1 * th.vw, 1.05 * th.rem); font.weight: Font.DemiBold; font.letterSpacing: 0.05 * font.pixelSize }
        Text { text: card.info[1]; color: th.text; font.pixelSize: Math.min(card.stat, card.height * 0.4); font.weight: Font.DemiBold; font.letterSpacing: -0.02 * font.pixelSize; elide: Text.ElideRight; width: parent.width }
        Text { visible: text !== ""; text: card.info[2]; color: card.small; font.pixelSize: th.clamp(0.7 * th.rem, 1.1 * th.vw, 1.3 * th.rem); font.weight: Font.Medium; elide: Text.ElideRight; width: parent.width; topPadding: 2 }
    }
    Column {     // recently played
        visible: card.kind === "recent"
        x: card.inset; y: card.inset
        width: parent.width - 2 * card.inset
        height: parent.height - 2 * card.inset
        spacing: 6
        clip: true
        Text { text: "RECENTLY PLAYED"; color: card.small; font.pixelSize: th.rem; font.weight: Font.DemiBold; font.letterSpacing: 0.05 * font.pixelSize; bottomPadding: 2 }
        Text { visible: card.recent.length === 0; text: "Nothing played yet"; color: card.small; font.pixelSize: 1.1 * th.rem }
        Repeater {
            model: card.recent
            Item {
                width: parent.width
                height: nm.implicitHeight
                Text { id: nm; width: parent.width - kd.implicitWidth - 16; text: modelData.title; color: th.text; elide: Text.ElideRight; font.pixelSize: th.clamp(th.rem, 1.3 * th.vw, 1.5 * th.rem); font.weight: Font.DemiBold }
                Text { id: kd; anchors.right: parent.right; anchors.baseline: nm.baseline; text: (modelData.kind === "app" ? "App" : "Game").toUpperCase(); color: card.small; font.pixelSize: nm.font.pixelSize * 0.7; font.letterSpacing: 0.06 * font.pixelSize }
            }
        }
    }
    Column {     // an add-on widget, or one whose add-on isn't installed
        visible: card.kind === "addon" || card.kind === "missing"
        x: card.inset; width: parent.width - 2 * card.inset
        anchors.verticalCenter: parent.verticalCenter
        spacing: 4
        Text { text: card.kind === "missing" ? "NOT INSTALLED" : "ADD-ON WIDGET"; color: card.small; font.pixelSize: 0.85 * th.rem; font.weight: Font.DemiBold; font.letterSpacing: 0.05 * font.pixelSize }
        Text { text: card.t.title || ""; color: th.text; font.pixelSize: 1.3 * th.rem; font.weight: Font.DemiBold; elide: Text.ElideRight; width: parent.width }
        Text { visible: card.kind === "addon"; text: "Shown in the full Ludus for now"; color: card.small; font.pixelSize: 0.85 * th.rem; elide: Text.ElideRight; width: parent.width }
    }
}
