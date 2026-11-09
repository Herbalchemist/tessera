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
    property var ring: null

    function open() {
        back = { page: win.page, tab: win.tabIndex, area: win.area }
        i = 0; tried = false; away = false; enter(); visible = true
    }
    function openAt(n) { back = { page: win.page, tab: win.tabIndex, area: win.area }; i = n; away = false; enter(); visible = true }
    function enter() {
        tried = false
        var s = steps[i]
        if (s.tab) { var k = win.tabList.findIndex(function (t) { return t.id === s.tab }); if (k >= 0 && k !== win.tabIndex) win.goTab(k) }
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
    Timer { id: measure; interval: 450; onTriggered: tour.ring = win.tourRect(tour.st.target || "") }   // the page has slid in by now

    Rectangle { anchors.fill: parent; color: tour.ring ? "transparent" : Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.78) }
    readonly property color shade: Qt.rgba(6 / 255, 9 / 255, 13 / 255, 0.72)
    Rectangle { visible: tour.ring !== null; x: 0; y: 0; width: tour.width; height: Math.max(0, ringBox.y); color: tour.shade }
    Rectangle { visible: tour.ring !== null; x: 0; y: ringBox.y + ringBox.height; width: tour.width; height: Math.max(0, tour.height - y); color: tour.shade }
    Rectangle { visible: tour.ring !== null; x: 0; y: ringBox.y; width: Math.max(0, ringBox.x); height: ringBox.height; color: tour.shade }
    Rectangle { visible: tour.ring !== null; x: ringBox.x + ringBox.width; y: ringBox.y; width: Math.max(0, tour.width - x); height: ringBox.height; color: tour.shade }
    Item {
        id: ringBox
        visible: tour.ring !== null
        x: tour.ring ? tour.ring.x - 10 : 0; y: tour.ring ? tour.ring.y - 10 : 0
        width: tour.ring ? tour.ring.w + 20 : 0; height: tour.ring ? tour.ring.h + 20 : 0
        Behavior on x { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Behavior on y { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Behavior on width { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Behavior on height { NumberAnimation { duration: 260; easing.type: Easing.OutCubic } }
        Rectangle { id: glow; anchors.fill: parent; anchors.margins: -2; radius: 18; color: "transparent"; border.width: 3; border.color: th.accent
            layer.enabled: true
            layer.effect: MultiEffect { shadowEnabled: true; shadowColor: th.alpha(th.accent, 0.55); shadowBlur: 1; blurMax: 48; shadowOpacity: 1 } }
    }
    Rectangle {
        id: card
        width: Math.min(tour.width * 0.86, 30 * th.rem)
        height: col.implicitHeight + 56
        radius: th.radius + 4; color: th.panel
        layer.enabled: true
        layer.effect: MultiEffect { shadowEnabled: true; shadowColor: Qt.rgba(0, 0, 0, 0.6); shadowBlur: 1; blurMax: 64; shadowVerticalOffset: 24 }
        readonly property real below: tour.ring ? tour.ring.y + tour.ring.h + 28 : 0
        x: tour.ring ? Math.max(20, Math.min(tour.width - width - 20, tour.ring.x + tour.ring.w / 2 - width / 2)) : (tour.width - width) / 2
        y: !tour.ring ? (tour.height - height) / 2 : (below + height + 20 < tour.height ? below : Math.max(12, tour.ring.y - height - 20))
        Behavior on x { NumberAnimation { duration: 350; easing.type: Easing.OutCubic } }
        Behavior on y { NumberAnimation { duration: 350; easing.type: Easing.OutCubic } }
        Column {
            id: col
            x: 32; y: 28
            width: parent.width - 64
            spacing: 0
            Text { color: th.accent; font.pixelSize: 0.8 * th.rem; font.weight: Font.Bold; font.letterSpacing: 0.08 * 0.8 * th.rem; bottomPadding: 4; text: (tour.i + 1) + " OF " + tour.steps.length }
            Text { width: parent.width; color: th.text; font.pixelSize: 1.4 * th.rem; font.weight: Font.Bold; wrapMode: Text.Wrap; bottomPadding: 14; text: tour.st.title }
            Text { width: parent.width; wrapMode: Text.Wrap; color: th.text; font.pixelSize: 1.1 * th.rem; lineHeight: 1.43; bottomPadding: 12; text: tour.st.text }
            Rectangle {
                visible: Boolean(tour.st.tryTabs); width: parent.width; height: visible ? tryT.implicitHeight + 16 : 0; radius: th.radius
                color: tour.tried ? th.alpha(th.ok, 0.18) : th.alpha(th.accent, 0.14)
                Text { id: tryT; x: 12; y: 8; width: parent.width - 24; wrapMode: Text.Wrap; color: th.text; font.weight: Font.DemiBold; font.pixelSize: 0.95 * th.rem; text: tour.tried ? "✓ " + tour.st.triedText : tour.st.tryText }
            }
            Item { width: 1; height: tour.st.op ? 12 : 0 }
            Rectangle {
                visible: Boolean(tour.st.op); radius: th.radius; color: th.accent
                width: doRow.implicitWidth + 32; height: visible ? doRow.implicitHeight + 22 : 0
                Row {
                    id: doRow; anchors.centerIn: parent; spacing: 8
                    Rectangle { width: Math.max(1.6 * 0.95 * th.rem, xk.implicitWidth + 12); height: xk.implicitHeight + 2; radius: 0.4 * 0.95 * th.rem; color: th.alpha(th.accentInk, 0.18)
                        Text { id: xk; anchors.centerIn: parent; color: th.accentInk; font.pixelSize: 1.05 * th.rem; font.weight: Font.DemiBold; text: "X" } }
                    Text { anchors.verticalCenter: parent.verticalCenter; color: th.accentInk; font.pixelSize: 1.05 * th.rem; font.weight: Font.DemiBold; text: tour.st.doLabel ? tour.st.doLabel.charAt(0).toUpperCase() + tour.st.doLabel.slice(1) : "" }
                }
            }
            Text { width: parent.width; topPadding: 12; horizontalAlignment: Text.AlignHCenter; color: th.muted; font.pixelSize: 0.95 * th.rem; text: "A " + (tour.i === tour.steps.length - 1 ? "done" : "next") + (tour.i ? "   B back" : "") + (tour.i === tour.steps.length - 1 ? "" : "   Y leave the tour") }
        }
    }
}
