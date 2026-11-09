// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the guided tour (renderer/tour.js). A ring lights one part of the screen at a time with
// a card that explains it. A: next, B: back, Y: leave. The Tabs step really switches tabs.
import QtQuick
import QtQuick.Effects

Item {
    id: tour
    property Theme th
    property int i: 0
    property bool tried: false
    property var back: ({})
    property bool away: false            // stepped aside for a "do it now" step
    visible: false
    signal closed()

    readonly property var steps: [
        { title: "A quick tour", text: "Here's where everything is. A: next   B: back   Y: leave the tour." },
        { tab: "home", target: "tabs", title: "Tabs", tryTabs: true, text: "Everything lives in tabs. LB and RB switch between them from anywhere, and so do Esc + ← / →.",
          tryText: "Try it now: press LB or RB.", triedText: "That's it. LB and RB work from anywhere, even inside a menu's page." },
        { tab: "home", target: "page", title: "Home", text: "Your page of widgets: the clock, what you played last, system status, and community widgets from Add-ons.", doLabel: "add a widget now", op: "widget" },
        { tab: "library", target: "page", title: "Library", text: "Your games. A plays one. Y shows options: scan for games from Steam, Lutris and Heroic, add one from a file, change box art, rename or move.", doLabel: "link a library drive or folder", op: "library" },
        { tab: "new", target: "tab:new", title: "Make your own tabs", text: "+ Mosaic builds a tab of your own, with games, apps, widgets and folders arranged the way you like.", doLabel: "make one now", op: "mosaic" },
        { tab: "browser", target: "tab:browser", title: "The browser", text: "A full web page, full screen. One stick moves a cursor and the other scrolls; RT clicks, Y types an address, B leaves. With a mouse and keyboard it works as usual; Esc + ← / → leaves it." },
        { tab: "settings", target: "tab:settings", title: "Settings", text: "Wi-Fi, Bluetooth, sound, controllers, keyboard & mouse, the look and screens (Appearance), profiles, storage and updates." },
        { target: "footer", title: "Button hints", text: "These follow what you hold: controller buttons, keyboard keys or mouse clicks. Change keys in Settings > Keyboard & mouse." },
        { title: "The guide", text: "Press the Guide button any time, even in the middle of a game, for quick settings, profiles, notifications and power. You can take this tour again from there." }
    ]
    readonly property var st: steps[i]
    property var ring: null              // the lit part (raw, from Main.tourRect), or null

    function open() {
        back = { page: win.page, tab: win.tabIndex, area: win.area }
        i = 0; tried = false; away = false; enter(); visible = true
    }
    function openAt(n) { back = { page: win.page, tab: win.tabIndex, area: win.area }; i = n; away = false; enter(); visible = true }
    function enter() {
        tried = false
        var s = steps[i]
        if (s.tab) { var k = win.tabList.findIndex(function (t) { return t.id === s.tab }); if (k >= 0 && k !== win.tabIndex) win.goTab(k) }
        if (s.tab === "home") win.area = "content"     // the widgets page shows its selected widget
        measure.restart()
    }
    function finish() {
        visible = false; away = false
        win.tourBack(back)
        closed()
    }
    function go(d) {
        var n = i + d
        if (n < 0) return
        if (n >= steps.length) return finish()
        i = n; enter()
    }
    function press(a) {
        if (away) return
        if (a === "a") go(1)
        else if (a === "b") go(-1)
        else if (a === "y") finish()
        else if (a === "lb" || a === "rb") {
            if (st.tryTabs) { win.goTab(win.tabIndex + (a === "lb" ? -1 : 1)); tried = true }
        }
        else if (a === "x" && st.op) stepAside()
    }
    function stepAside() {
        var s = st, at = i
        away = true; visible = false
        if (s.op === "widget") win.addWidget()
        else if (s.op === "mosaic") win.newMosaic()
        else if (s.op === "library") win.tourLibrary()
        idle.quiet = 0; idle.at = at; idle.start()
    }
    Timer {      // waits until what the person opened is finished (a flow can open several menus in turn)
        id: idle
        property int quiet: 0
        property int at: 0
        interval: 150; repeat: true
        onTriggered: {
            quiet = !win.menuUp() ? quiet + 1 : 0
            if (quiet >= 3) { stop(); tour.away = false; tour.i = at; tour.visible = true; tour.enter() }
        }
    }
    Timer { id: measure; interval: 450; onTriggered: { tour.ring = win.tourRect(tour.st.target || ""); tour.place() } }   // the page has slid in by now
    onWidthChanged: if (visible) place()
    onIChanged: Qt.callLater(place)
    onTriedChanged: Qt.callLater(place)
    // the card sits below the lit part when there's room, above it otherwise, beside it (narrower if that
    // is what fits), or at the edge with the most room (tour.js placeTour)
    function place() {
        var W = width, H = height, r = ring, pad = 10
        var shown = r && r.w > 4 && r.h > 4
        if (shown) {
            var x = Math.max(4, r.x - pad), y = Math.max(4, r.y - pad)
            ringBox.x = x; ringBox.y = y
            ringBox.width = Math.min(W - 8, r.x + r.w + pad) - x; ringBox.height = Math.min(H - 8, r.y + r.h + pad) - y
        } else { ringBox.x = W / 2; ringBox.y = H / 2; ringBox.width = 0; ringBox.height = 0 }
        card.width = Math.min(W * 0.86, 30 * th.rem)
        if (shown) {
            var below = H - (r.y + r.h + pad + 16) - 8, above = r.y - pad - 16 - 8
            var side = Math.max(W - (r.x + r.w + pad + 16) - 16, r.x - pad - 16 - 16)
            if (card.height > Math.max(below, above) && card.width > side && side >= 240) card.width = Math.floor(side)
        }
        var ch = card.height, cw = card.width
        var top = (H - ch) / 2, left = (W - cw) / 2
        if (shown) {
            if (r.y + r.h + pad + 16 + ch < H) top = r.y + r.h + pad + 16
            else if (r.y - pad - 16 - ch > 0) top = r.y - pad - 16 - ch
            else if (r.x + r.w + pad + 16 + cw < W) { left = r.x + r.w + pad + 16; top = Math.min(H - ch - 16, Math.max(16, r.y)) }
            else if (r.x - pad - 16 - cw > 0) { left = r.x - pad - 16 - cw; top = Math.min(H - ch - 16, Math.max(16, r.y)) }
            else top = r.y > H - (r.y + r.h) ? 16 : H - ch - 16
            if (left === (W - cw) / 2) left = Math.min(W - cw - 16, Math.max(16, r.x + r.w / 2 - cw / 2))
        }
        card.x = Math.round(left); card.y = Math.round(top)
    }

    Rectangle { anchors.fill: parent; color: tour.ring ? "transparent" : Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.78) }
    readonly property color shade: Qt.rgba(6 / 255, 9 / 255, 13 / 255, 0.72)
    Rectangle { visible: tour.ring !== null; x: 0; y: 0; width: tour.width; height: Math.max(0, ringBox.y); color: tour.shade }
    Rectangle { visible: tour.ring !== null; x: 0; y: ringBox.y + ringBox.height; width: tour.width; height: Math.max(0, tour.height - y); color: tour.shade }
    Rectangle { visible: tour.ring !== null; x: 0; y: ringBox.y; width: Math.max(0, ringBox.x); height: ringBox.height; color: tour.shade }
    Rectangle { visible: tour.ring !== null; x: ringBox.x + ringBox.width; y: ringBox.y; width: Math.max(0, tour.width - x); height: ringBox.height; color: tour.shade }
    Item {
        id: ringBox
        visible: tour.ring !== null
        Behavior on x { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Behavior on y { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Behavior on width { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Behavior on height { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Rectangle { anchors.fill: parent; anchors.margins: -5; radius: 22; color: "transparent"; border.width: 5; border.color: th.alpha(th.accent, 0.3) }
        Rectangle { id: glow; anchors.fill: parent; anchors.margins: -3; radius: 21; color: "transparent"; border.width: 3; border.color: th.accent
            layer.enabled: true
            layer.effect: MultiEffect { shadowEnabled: true; shadowColor: th.alpha(th.accent, 0.9); shadowBlur: 1; blurMax: 40; shadowOpacity: 1; shadowScale: 1.02 } }
    }
    Rectangle {
        id: card
        height: col.implicitHeight + 56
        radius: th.radius + 4; color: th.panel
        layer.enabled: true
        layer.effect: MultiEffect { shadowEnabled: true; shadowColor: Qt.rgba(0, 0, 0, 0.6); shadowBlur: 1; blurMax: 64; shadowVerticalOffset: 24 }
        Behavior on x { NumberAnimation { duration: 350; easing.type: Easing.OutCubic } }
        Behavior on y { NumberAnimation { duration: 350; easing.type: Easing.OutCubic } }
        Column {
            id: col
            x: 32; y: 28
            width: parent.width - 64
            spacing: 0
            Text { color: th.accent; font.pixelSize: 0.8 * th.rem; font.weight: Font.Bold; font.letterSpacing: 0.08 * 0.8 * th.rem; bottomPadding: 4; text: (tour.i + 1) + " OF " + tour.steps.length }
            Text { width: parent.width; color: th.text; font.pixelSize: 1.3 * th.rem; font.weight: Font.DemiBold; wrapMode: Text.Wrap; bottomPadding: 16; text: tour.st.title }
            Text { width: parent.width; wrapMode: Text.Wrap; color: th.text; font.pixelSize: 1.05 * th.rem; lineHeight: 1.43; bottomPadding: 12; text: tour.st.text }
            Rectangle {
                visible: Boolean(tour.st.tryTabs); width: parent.width; height: visible ? tryT.implicitHeight + 16 : 0; radius: th.radius
                color: tour.tried ? th.alpha(th.ok, 0.18) : th.alpha(th.accent, 0.14)
                Text { id: tryT; x: 12; y: 8; width: parent.width - 24; wrapMode: Text.Wrap; color: th.text; font.weight: Font.DemiBold; font.pixelSize: 0.95 * th.rem; text: tour.tried ? "✓ " + tour.st.triedText : tour.st.tryText }
            }
            Item { width: 1; height: tour.st.op ? 12 : 0 }
            Rectangle {
                visible: Boolean(tour.st.op); radius: th.radius; color: th.accent
                width: doRow.implicitWidth + 28; height: visible ? doRow.implicitHeight + 16 : 0
                Row {
                    id: doRow; anchors.centerIn: parent; spacing: 8
                    Rectangle { width: Math.max(1.6 * 0.95 * th.rem, xk.implicitWidth + 12); height: xk.implicitHeight + 2; radius: 0.4 * 0.95 * th.rem; color: th.alpha(th.accentInk, 0.18)
                        Text { id: xk; anchors.centerIn: parent; color: th.accentInk; font.pixelSize: 0.95 * th.rem; font.weight: Font.DemiBold; text: "X" } }
                    Text { anchors.verticalCenter: parent.verticalCenter; color: th.accentInk; font.pixelSize: 0.95 * th.rem; font.weight: Font.DemiBold; text: tour.st.doLabel ? tour.st.doLabel.charAt(0).toUpperCase() + tour.st.doLabel.slice(1) : "" }
                }
            }
            Text { width: parent.width; topPadding: 12; horizontalAlignment: Text.AlignHCenter; color: th.muted; font.pixelSize: 0.95 * th.rem; text: "A " + (tour.i === tour.steps.length - 1 ? "done" : "next") + (tour.i ? "   B back" : "") + (tour.i === tour.steps.length - 1 ? "" : "   Y leave the tour") }
        }
    }
}
