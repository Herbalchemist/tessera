// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the guided tour (renderer/tour.js). A ring lights one part of the screen at a time with
// a card that explains it. A: next, B: back, Y: leave. The Tabs step really switches tabs.
import QtQuick

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
    readonly property color shade: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.78)
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
        Rectangle { anchors.fill: parent; radius: th.radius; color: "transparent"; border.width: 3; border.color: th.accent }
    }
    Rectangle {
        id: card
        width: Math.min(tour.width * 0.5, 560)
        height: col.implicitHeight + 3 * th.rem
        radius: th.radius; color: th.panel
        border.width: 2; border.color: th.alpha(th.accent, 0.6)
        readonly property real below: tour.ring ? tour.ring.y + tour.ring.h + 28 : 0
        x: tour.ring ? Math.max(20, Math.min(tour.width - width - 20, tour.ring.x + tour.ring.w / 2 - width / 2)) : (tour.width - width) / 2
        y: !tour.ring ? (tour.height - height) / 2 : (below + height + 20 < tour.height ? below : Math.max(20, tour.ring.y - height - 28))
        Column {
            id: col
            anchors.centerIn: parent
            width: parent.width - 3 * th.rem
            spacing: 10
            Text { color: th.muted; font.pixelSize: 0.8 * th.rem; text: (tour.i + 1) + " of " + tour.steps.length }
            Text { width: parent.width; color: th.text; font.pixelSize: 1.4 * th.rem; font.weight: Font.DemiBold; text: tour.st.title }
            Text { width: parent.width; wrapMode: Text.Wrap; color: th.text; font.pixelSize: 1.0 * th.rem; lineHeight: 1.25; text: tour.st.text }
            Text { visible: Boolean(tour.st.tryTabs); width: parent.width; wrapMode: Text.Wrap; color: tour.tried ? th.ok : th.accent; font.pixelSize: 0.95 * th.rem; text: tour.tried ? "✓ " + tour.st.triedText : tour.st.tryText }
            Text { visible: Boolean(tour.st.op); color: th.accent; font.pixelSize: 0.95 * th.rem; text: tour.st.doLabel ? "X  " + tour.st.doLabel.charAt(0).toUpperCase() + tour.st.doLabel.slice(1) : "" }
            Text { color: th.muted; font.pixelSize: 0.85 * th.rem; text: "A " + (tour.i === tour.steps.length - 1 ? "done" : "next") + (tour.i ? "   B back" : "") + (tour.i === tour.steps.length - 1 ? "" : "   Y leave the tour") }
        }
    }
}
