// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the screen. One dispatcher, act(), takes every press (controller, keyboard) so all
// input behaves the same. Everything else is the full Ludus's own main process, unchanged, reached
// through `api` (the same requests its page makes) over `bridge` (ludus.py).
import QtQuick
import QtQuick.Window

Window {
    id: win
    width: 1280
    height: 720
    visible: true
    visibility: shotMode ? Window.Windowed : Window.FullScreen
    color: theme.bg
    title: "Ludus"

    QtObject {
        id: theme
        readonly property color bg: "#10151c"
        readonly property color card: "#1a222c"
        readonly property color cardHi: "#232d39"
        readonly property color text: "#e8edf3"
        readonly property color dim: "#8b97a6"
        readonly property color accent: "#7fb2ff"
        readonly property color accentInk: "#0b1220"
        readonly property color danger: "#ff8a8a"
        readonly property real u: Math.max(0.6, Math.min(win.width / 1280, win.height / 720))
    }

    // ---------------------------------------------------------------- state
    property string area: "grid"            // "tabs" or "grid"
    property int tabIndex: 0
    property var tabList: []
    property var stack: []                  // open folders, innermost last
    property var tiles: []
    property int sel: 0
    property int cols: 6
    property string toastText: ""
    property var view: ({ tabs: {}, folders: {}, mosaics: [], tabOrder: [] })
    property bool ready: false

    // ---------------------------------------------------------------- the full Ludus's main process
    QtObject {
        id: api
        property int next: 1
        property var waiting: ({})
        function call(ch, args) {
            return new Promise(function (resolve) {
                var id = api.next++
                api.waiting[id] = resolve
                bridge.request(id, ch, args)
            })
        }
        // Library changes answer with the new view: show it.
        function library(op, p) {
            return call("library", [op, p || {}]).then(function (r) {
                if (r && r.view) win.applyView(r.view)
                if (r && r.ok === false && r.error) win.toast(r.error)
                else if (r && r.message) win.toast(r.message)
                return r || {}
            })
        }
        function launch(id) { return call("launch", [id]) }
    }
    Connections {
        target: bridge
        function onReply(id, m) {
            var done = api.waiting[id]
            delete api.waiting[id]
            if (done) done(m.ok ? m.result : { ok: false, error: m.error })
        }
        function onEvent(ch, data) {
            if (ch === "init") { win.applyView(data); win.ready = true }
            else if (ch === "launch-failed" && data) win.toast(data)
            else if (ch === "game-exited") { if (data) win.toast(data) }
        }
        function onWindowOp(op) {
            if (shotMode) return
            if (op === "hide") win.hide()
            else { win.showFullScreen(); win.requestActivate() }
        }
    }
    function applyView(v) { view = v; refresh() }
    function folderTitle(id) { return (view.folders[id] || {}).title || "" }
    function tilesOf(where) {
        var shown = function (t) { return t.kind !== "inlay" }   // Home widgets: not in this version yet
        if (where === "library" || where === "apps") {
            var rows = view.tabs[where] || [], out = []
            for (var i = 0; i < rows.length; i++) out = out.concat(rows[i].tiles)
            return out
        }
        if (where.indexOf("m:") === 0 || where.indexOf("f:") === 0) return ((view.folders[where.slice(2)] || {}).tiles || []).filter(shown)
        if (where === "home") return ((view.folders._home || {}).tiles || []).filter(shown)
        return []
    }

    readonly property var curTab: tabList.length ? tabList[Math.min(tabIndex, tabList.length - 1)] : ({ id: "library", title: "Library" })
    readonly property string page: curTab.id
    readonly property string where: stack.length ? "f:" + stack[stack.length - 1] : page
    readonly property bool isMosaic: page.indexOf("m:") === 0
    readonly property string pageCat: stack.length ? stack[stack.length - 1] : (isMosaic ? page.slice(2) : "")

    function refresh() {
        var keep = curTab.id
        var names = { home: "Home", library: "Library", apps: "Apps" }
        tabList = (view.tabOrder || []).map(function (t) { return { id: t, title: names[t] || folderTitle(t.slice(2)) } })
                                        .concat([{ id: "new", title: "+ Mosaic" }, { id: "settings", title: "Settings" }])
        var i = tabList.findIndex(function (t) { return t.id === keep })
        tabIndex = i >= 0 ? i : Math.min(tabIndex, tabList.length - 1)
        if (stack.length && !folderTitle(stack[stack.length - 1])) stack = []
        tiles = (page === "new" || page === "settings") ? [] : tilesOf(where)
        sel = Math.max(0, Math.min(sel, tiles.length - 1))
    }
    function goTab(i) {
        tabIndex = (i + tabList.length) % tabList.length
        stack = []
        sel = 0
        refresh()
    }
    function toast(t) { toastText = t; toastTimer.restart() }
    Timer { id: toastTimer; interval: 3500; onTriggered: toastText = "" }

    Component.onCompleted: { refresh(); keys.forceActiveFocus() }

    // ---------------------------------------------------------------- input
    // Every press comes through here.
    function act(a) {
        if (!ready) return
        if (keyboard.visible) return keyboard.press(a)
        if (menu.visible) return menu.press(a)
        if (a === "lb" || a === "rb") { goTab(tabIndex + (a === "lb" ? -1 : 1)); area = "tabs"; return }
        if (page === "settings" && area === "grid") return settings.press(a)
        if (area === "tabs") {
            if (a === "left") return goTab(tabIndex - 1)
            if (a === "right") return goTab(tabIndex + 1)
            if (a === "down" || a === "a") {
                if (page === "new") return newMosaic()
                area = "grid"
                return
            }
            if (a === "y" && isMosaic) return openOptions(true)
            return
        }
        // the tiles
        if (a === "up") { if (sel - cols >= 0) sel -= cols; else area = "tabs"; return }
        if (a === "down") { if (sel + cols < tiles.length) sel += cols; else if (Math.floor(sel / cols) < Math.floor((tiles.length - 1) / cols)) sel = tiles.length - 1; return }
        if (a === "left") { if (sel % cols > 0) sel -= 1; return }
        if (a === "right") { if (sel % cols < cols - 1 && sel + 1 < tiles.length) sel += 1; return }
        if (a === "a") return activate()
        if (a === "b") { if (stack.length) { stack = stack.slice(0, -1); sel = 0; refresh() } else area = "tabs"; return }
        if (a === "y") return openOptions(false)
    }

    Item {
        id: keys
        focus: true
        Keys.onPressed: function (e) {
            var m = {}
            m[Qt.Key_Left] = "left"; m[Qt.Key_Right] = "right"; m[Qt.Key_Up] = "up"; m[Qt.Key_Down] = "down"
            m[Qt.Key_Return] = "a"; m[Qt.Key_Enter] = "a"; m[Qt.Key_Space] = "a"
            m[Qt.Key_Escape] = "b"; m[Qt.Key_Backspace] = "b"
            m[Qt.Key_Y] = "y"; m[Qt.Key_Menu] = "y"; m[Qt.Key_Q] = "lb"; m[Qt.Key_E] = "rb"
            m[Qt.Key_PageUp] = "lb"; m[Qt.Key_PageDown] = "rb"
            if (keyboard.visible) {
                if (e.key === Qt.Key_Backspace) { keyboard.typed = keyboard.typed.slice(0, -1); e.accepted = true; return }
                if (e.text && e.text.length === 1 && e.text >= " " && e.key !== Qt.Key_Return && e.key !== Qt.Key_Enter) { keyboard.typed += e.text; e.accepted = true; return }
            }
            if (m[e.key] !== undefined) { act(m[e.key]); e.accepted = true }
        }
    }

    // ---------------------------------------------------------------- doing things
    function activate() {
        var t = tiles[sel]
        if (!t) return
        if (t.kind === "folder") { stack = stack.concat([t.id]); sel = 0; refresh(); return }
        api.launch(t.id)
    }
    function newMosaic() {
        keyboard.open("Name the new mosaic", "", function (name) {
            api.library("newCategory", { title: name }).then(function (r) {
                if (!r.ok) return
                var i = tabList.findIndex(function (x) { return x.id === "m:" + r.id })
                if (i >= 0) goTab(i)
                area = "grid"
            })
        })
    }
    // Y: options for the tile, and for the mosaic or folder you're in. From the tab bar: the mosaic's own.
    function openOptions(fromTabs) {
        var t = fromTabs ? null : tiles[sel]
        var items = []
        if (t) {
            if (t.kind === "folder") items.push({ label: "Open", op: "open" })
            else items.push({ label: t.kind === "app" ? "Start" : "Play", op: "play" })
            if (t.kind !== "folder") items.push({ label: "Add to a mosaic…", op: "addTo" })
            if (pageCat) items.push({ label: "Remove from this " + (stack.length ? "folder" : "mosaic"), op: "remove" })
        }
        if (pageCat) {
            var what = stack.length ? "folder" : "mosaic"
            items.push({ label: "Rename this " + what + "…", op: "rename" })
            if (!stack.length) {
                items.push({ label: "Move this mosaic left", op: "moveL" })
                items.push({ label: "Move this mosaic right", op: "moveR" })
            }
            items.push({ label: "Delete this " + what + "…", op: "delete", danger: true })
        }
        items.push({ label: "New mosaic…", op: "new" })
        menu.open(t ? t.title : (pageCat ? folderTitle(pageCat) : "Options"), items, function (it) { runOption(it.op, t) })
    }
    function runOption(op, t) {
        if (op === "open" || op === "play") return activate()
        if (op === "new") return newMosaic()
        if (op === "addTo") {
            var ms = view.mosaics || []
            if (!ms.length) return toast("Make a mosaic first: + Mosaic in the tab bar.")
            return menu.open("Add “" + t.title + "” to…", ms.map(function (m) { return { label: m.title, id: m.id } }), function (m) {
                api.library("addEntry", { catId: m.id, ref: t.id })
            })
        }
        if (op === "remove") { api.library("removeEntry", { catId: pageCat, ref: t.id }); return }
        if (op === "rename") {
            var cat = pageCat
            return keyboard.open("Rename", folderTitle(cat), function (name) { api.library("renameCategory", { id: cat, title: name }) })
        }
        if (op === "moveL" || op === "moveR") { api.library("moveTab", { id: page, dir: op === "moveL" ? -1 : 1 }); return }
        if (op === "delete") {
            var c = pageCat, inFolder = stack.length > 0
            return menu.open("Delete “" + folderTitle(c) + "”? Your games and apps are kept.",
                             [{ label: "Go back", op: "no" }, { label: "Delete", op: "yes", danger: true }],
                             function (it) {
                                 if (it.op !== "yes") return
                                 if (inFolder) stack = stack.slice(0, -1)
                                 else area = "tabs"
                                 api.library("deleteCategory", { id: c })
                             })
        }
    }

    // ---------------------------------------------------------------- the tab bar
    Row {
        id: tabBar
        anchors.top: parent.top
        anchors.topMargin: 22 * theme.u
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: 10 * theme.u
        Repeater {
            model: win.tabList
            delegate: Rectangle {
                readonly property bool current: index === win.tabIndex
                readonly property bool focused: current && win.area === "tabs"
                height: 44 * theme.u
                width: label.implicitWidth + 36 * theme.u
                radius: height / 2
                color: focused ? theme.accent : current ? Qt.rgba(0.5, 0.7, 1, 0.14) : "transparent"
                Text {
                    id: label
                    anchors.centerIn: parent
                    text: modelData.title
                    color: parent.focused ? theme.accentInk : parent.current ? theme.accent : theme.dim
                    font.pixelSize: 19 * theme.u
                    font.weight: parent.current ? Font.DemiBold : Font.Normal
                }
                Behavior on color { ColorAnimation { duration: 120 } }
            }
        }
    }

    // ---------------------------------------------------------------- the page
    Text {
        id: crumb
        anchors.top: tabBar.bottom
        anchors.topMargin: 18 * theme.u
        anchors.left: parent.left
        anchors.leftMargin: 56 * theme.u
        visible: win.stack.length > 0
        text: win.stack.map(function (id) { return win.folderTitle(id) }).join("  ›  ")
        color: theme.dim
        font.pixelSize: 17 * theme.u
    }

    GridView {
        id: grid
        visible: win.page !== "settings" && win.page !== "new"
        anchors.top: crumb.bottom
        anchors.topMargin: 14 * theme.u
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: footer.top
        anchors.leftMargin: 48 * theme.u
        anchors.rightMargin: 48 * theme.u
        clip: false
        interactive: false
        cellWidth: width / win.cols
        cellHeight: cellWidth * 1.42
        model: win.tiles
        currentIndex: win.sel
        highlightFollowsCurrentItem: false
        onCurrentIndexChanged: positionViewAtIndex(currentIndex, GridView.Contain)
        delegate: Item {
            width: grid.cellWidth
            height: grid.cellHeight
            readonly property bool picked: index === win.sel && win.area === "grid" && !menu.visible && !keyboard.visible
            Rectangle {
                id: card
                anchors.fill: parent
                anchors.margins: 10 * theme.u
                radius: 14 * theme.u
                color: modelData.kind === "folder" ? theme.cardHi : theme.card
                border.width: parent.picked ? 3 * theme.u : modelData.kind === "folder" ? 2 * theme.u : 0
                border.color: parent.picked ? theme.accent : "#33404f"
                scale: parent.picked ? 1.06 : 1
                z: parent.picked ? 2 : 1
                Behavior on scale { NumberAnimation { duration: 110; easing.type: Easing.OutCubic } }
                clip: true
                Image {
                    anchors.fill: parent
                    visible: modelData.art === true
                    source: modelData.art === true ? "image://art/" + encodeURIComponent(modelData.id) : ""
                    fillMode: Image.PreserveAspectCrop
                    asynchronous: true
                    sourceSize.width: 400
                }
                Text {
                    visible: modelData.art !== true
                    anchors.centerIn: parent
                    text: modelData.kind === "folder" ? "▦" : modelData.title.charAt(0).toUpperCase()
                    color: Qt.rgba(1, 1, 1, 0.13)
                    font.pixelSize: parent.height * 0.4
                    font.weight: Font.Bold
                }
                Rectangle {
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.bottom: parent.bottom
                    height: name.implicitHeight + 22 * theme.u
                    color: Qt.rgba(0, 0, 0, 0.55)
                    Text {
                        id: name
                        anchors.fill: parent
                        anchors.margins: 11 * theme.u
                        text: modelData.title
                        color: theme.text
                        font.pixelSize: 15 * theme.u
                        wrapMode: Text.Wrap
                        maximumLineCount: 2
                        elide: Text.ElideRight
                        verticalAlignment: Text.AlignBottom
                    }
                }
            }
        }
    }

    Column {
        anchors.centerIn: parent
        spacing: 12 * theme.u
        visible: grid.visible && win.tiles.length === 0
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: win.stack.length ? "This folder is empty" : win.isMosaic ? "This mosaic is empty" : win.page === "apps" ? "No apps yet" : "No games yet"
            color: theme.text
            font.pixelSize: 26 * theme.u
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            text: win.isMosaic ? "Press Y for its options. Add games from the Library with Y › Add to a mosaic."
                               : "Games and apps you add in the full Ludus show up here."
            color: theme.dim
            font.pixelSize: 17 * theme.u
        }
    }

    Column {
        anchors.centerIn: parent
        spacing: 10 * theme.u
        visible: win.page === "new"
        Text { anchors.horizontalCenter: parent.horizontalCenter; text: "A new mosaic"; color: theme.text; font.pixelSize: 26 * theme.u }
        Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Press A to make one and name it."; color: theme.dim; font.pixelSize: 17 * theme.u }
    }

    // ---------------------------------------------------------------- Settings (this version's)
    Item {
        id: settings
        visible: win.page === "settings"
        anchors.top: tabBar.bottom
        anchors.topMargin: 40 * theme.u
        anchors.horizontalCenter: parent.horizontalCenter
        width: 760 * theme.u
        height: 400 * theme.u
        property int sel: 0
        readonly property var rows: [
            { label: "Go back to the full Ludus", sub: "Everything else (themes, PIN, profiles, the browser) is there for now", op: "full" },
            { label: "Opus (desktop)", sub: "End this session and go to the login screen", op: "opus" }
        ]
        function press(a) {
            if (a === "up") { if (sel > 0) sel--; else win.area = "tabs" }
            else if (a === "down") sel = Math.min(rows.length - 1, sel + 1)
            else if (a === "b") win.area = "tabs"
            else if (a === "a") {
                if (!session.inSession) return win.toast("Only inside the Tessera session.")
                if (rows[sel].op === "full") session.useFullLudus()
                else session.goToOpus()
            }
        }
        Column {
            width: parent.width
            spacing: 12 * theme.u
            Text { text: "This is the new Ludus (Qt), first version"; color: theme.dim; font.pixelSize: 17 * theme.u }
            Repeater {
                model: settings.rows
                delegate: Rectangle {
                    readonly property bool picked: index === settings.sel && win.area === "grid"
                    width: settings.width
                    height: 78 * theme.u
                    radius: 14 * theme.u
                    color: picked ? theme.accent : theme.card
                    Column {
                        anchors.verticalCenter: parent.verticalCenter
                        anchors.left: parent.left
                        anchors.leftMargin: 22 * theme.u
                        spacing: 4 * theme.u
                        Text { text: modelData.label; color: picked ? theme.accentInk : theme.text; font.pixelSize: 20 * theme.u; font.weight: Font.DemiBold }
                        Text { text: modelData.sub; color: picked ? theme.accentInk : theme.dim; font.pixelSize: 15 * theme.u }
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------- footer hints
    Row {
        id: footer
        anchors.bottom: parent.bottom
        anchors.bottomMargin: 18 * theme.u
        anchors.horizontalCenter: parent.horizontalCenter
        spacing: 26 * theme.u
        height: 30 * theme.u
        Repeater {
            model: [["A", "Select"], ["B", "Back"], ["Y", "Options"], ["LB  RB", "Tabs"]]
            delegate: Row {
                spacing: 8 * theme.u
                Rectangle {
                    width: Math.max(26 * theme.u, key.implicitWidth + 14 * theme.u); height: 26 * theme.u; radius: 13 * theme.u
                    color: "transparent"; border.color: theme.dim; border.width: 1.5
                    Text { id: key; anchors.centerIn: parent; text: modelData[0]; color: theme.text; font.pixelSize: 13 * theme.u; font.weight: Font.DemiBold }
                }
                Text { anchors.verticalCenter: parent.verticalCenter; text: modelData[1]; color: theme.dim; font.pixelSize: 15 * theme.u }
            }
        }
    }

    // ---------------------------------------------------------------- the menu (Options, choices, confirmations)
    Rectangle {
        id: menu
        visible: false
        anchors.fill: parent
        color: Qt.rgba(0, 0, 0, 0.55)
        z: 20
        property string heading: ""
        property var items: []
        property int sel: 0
        property var done: null
        function open(h, its, cb) { heading = h; items = its; sel = 0; done = cb; visible = true }
        function press(a) {
            if (a === "up") sel = (sel - 1 + items.length) % items.length
            else if (a === "down") sel = (sel + 1) % items.length
            else if (a === "b") visible = false
            else if (a === "a") { var it = items[sel], cb = done; visible = false; if (cb) cb(it) }
        }
        Rectangle {
            anchors.centerIn: parent
            width: 560 * theme.u
            height: list.height + head.height + 56 * theme.u
            radius: 20 * theme.u
            color: "#161d26"
            border.color: "#2a3542"
            Text {
                id: head
                anchors.top: parent.top
                anchors.topMargin: 24 * theme.u
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.leftMargin: 26 * theme.u
                anchors.rightMargin: 26 * theme.u
                text: menu.heading
                color: theme.text
                font.pixelSize: 21 * theme.u
                font.weight: Font.DemiBold
                wrapMode: Text.Wrap
            }
            Column {
                id: list
                anchors.top: head.bottom
                anchors.topMargin: 14 * theme.u
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.margins: 14 * theme.u
                spacing: 4 * theme.u
                Repeater {
                    model: menu.items
                    delegate: Rectangle {
                        readonly property bool picked: index === menu.sel
                        width: list.width
                        height: 52 * theme.u
                        radius: 12 * theme.u
                        color: picked ? (modelData.danger ? theme.danger : theme.accent) : "transparent"
                        Text {
                            anchors.verticalCenter: parent.verticalCenter
                            anchors.left: parent.left
                            anchors.leftMargin: 16 * theme.u
                            text: modelData.label
                            color: picked ? theme.accentInk : modelData.danger ? theme.danger : theme.text
                            font.pixelSize: 18 * theme.u
                        }
                    }
                }
            }
        }
    }

    // ---------------------------------------------------------------- on-screen keyboard (names)
    Rectangle {
        id: keyboard
        visible: false
        anchors.fill: parent
        color: Qt.rgba(0.04, 0.06, 0.08, 0.96)
        z: 30
        property string heading: ""
        property string typed: ""
        property var done: null
        property int row: 0
        property int col: 0
        readonly property var rows: [
            "1234567890".split(""), "qwertyuiop".split(""), "asdfghjkl'".split(""), "zxcvbnm-.!".split(""),
            ["Shift", "Space", "⌫", "Done"]
        ]
        property bool shift: true
        function open(h, start, cb) { heading = h; typed = start; done = cb; row = 1; col = 0; shift = start === ""; visible = true }
        function key(r, c) { var k = rows[r][c]; return (k.length === 1 && shift) ? k.toUpperCase() : k }
        function press(a) {
            if (a === "up") { row = Math.max(0, row - 1); col = Math.min(col, rows[row].length - 1) }
            else if (a === "down") { row = Math.min(rows.length - 1, row + 1); col = Math.min(col, rows[row].length - 1) }
            else if (a === "left") col = (col - 1 + rows[row].length) % rows[row].length
            else if (a === "right") col = (col + 1) % rows[row].length
            else if (a === "x") typed = typed.slice(0, -1)
            else if (a === "y") typed += " "
            else if (a === "start") finish()
            else if (a === "b") visible = false
            else if (a === "a") {
                var k = key(row, col)
                if (k === "Shift") shift = !shift
                else if (k === "Space") typed += " "
                else if (k === "⌫") typed = typed.slice(0, -1)
                else if (k === "Done") finish()
                else { typed += k; if (shift && typed.length === 1) shift = false }
            }
        }
        function finish() { var cb = done, t = typed.trim(); visible = false; if (cb) cb(t) }
        Column {
            anchors.centerIn: parent
            spacing: 10 * theme.u
            Text { text: keyboard.heading; color: theme.text; font.pixelSize: 22 * theme.u; font.weight: Font.DemiBold }
            Rectangle {
                width: 760 * theme.u; height: 58 * theme.u; radius: 12 * theme.u; color: theme.card
                border.color: theme.accent; border.width: 2
                Text { anchors.verticalCenter: parent.verticalCenter; anchors.left: parent.left; anchors.leftMargin: 18 * theme.u
                       text: keyboard.typed + "▏"; color: theme.text; font.pixelSize: 22 * theme.u }
            }
            Repeater {
                model: keyboard.rows.length
                delegate: Row {
                    readonly property int r: index
                    spacing: 6 * theme.u
                    Repeater {
                        model: keyboard.rows[r].length
                        delegate: Rectangle {
                            readonly property bool picked: r === keyboard.row && index === keyboard.col
                            readonly property string k: keyboard.key(r, index)
                            width: (k.length > 1 ? 182 : 70) * theme.u
                            height: 56 * theme.u
                            radius: 10 * theme.u
                            color: picked ? theme.accent : (k === "Shift" && keyboard.shift) ? theme.cardHi : theme.card
                            Text { anchors.centerIn: parent; text: k; color: picked ? theme.accentInk : theme.text; font.pixelSize: 20 * theme.u }
                        }
                    }
                }
            }
            Text { text: "A type  ·  X delete  ·  Y space  ·  Start done  ·  B cancel"; color: theme.dim; font.pixelSize: 15 * theme.u }
        }
    }

    // ---------------------------------------------------------------- a game is running / messages
    Rectangle {
        visible: win.toastText !== ""
        z: 50
        anchors.bottom: footer.top
        anchors.bottomMargin: 16 * theme.u
        anchors.horizontalCenter: parent.horizontalCenter
        width: toastLabel.implicitWidth + 40 * theme.u
        height: 48 * theme.u
        radius: 24 * theme.u
        color: "#263140"
        Text { id: toastLabel; anchors.centerIn: parent; text: win.toastText; color: theme.text; font.pixelSize: 17 * theme.u }
    }
}
