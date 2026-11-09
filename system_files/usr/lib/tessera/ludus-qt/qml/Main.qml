// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the screen. It looks the way the full Ludus's page does for the same theme (every
// theme setting and layout part, see Theme.qml), and everything behind it is the full Ludus's own
// main process, unchanged, reached through `api` (the same requests its page makes) over
// `bridge` (ludus.py). One dispatcher, act(), takes every press (controller, keyboard).
import QtQuick
import QtQuick.Layouts
import QtQuick.Window

Window {
    id: win
    width: 1280
    height: 720
    visible: true
    visibility: shotMode ? Window.Windowed : Window.FullScreen
    color: th.bg
    title: "Ludus"

    Theme {
        id: th
        theme: win.view.prefs ? win.view.prefs.theme : null
        screenW: win.width
        screenH: win.height
        shell: shellData
    }

    // ---------------------------------------------------------------- state
    property var view: ({ tabs: {}, folders: {}, mosaics: [], tabOrder: [], prefs: null })
    property bool ready: false
    property string area: "tabs"            // "tabs" or "content"
    property int tabIndex: 0
    property var tabList: []
    property var stack: []                  // open folders, innermost last
    property var cursors: ({})              // per page: { row, cols: { rowId: col } }
    property string status: ""
    property bool statusError: false
    property string picture: ""             // the theme's background picture (a data: URL)
    property int artRev: 0

    readonly property var curTab: tabList.length ? tabList[Math.min(tabIndex, tabList.length - 1)] : ({ id: "home", title: "Home" })
    readonly property string page: curTab.id
    readonly property string pageKey: stack.length ? "f:" + stack[stack.length - 1] : page
    readonly property bool isMosaic: page.indexOf("m:") === 0
    readonly property string pageCat: stack.length ? stack[stack.length - 1] : (isMosaic ? page.slice(2) : (page === "home" ? "_home" : ""))
    readonly property bool buttonTab: page === "new" || page === "browser" || page === "settings"
    // This page's own grid size, if it has one (Theme Settings > Layout, per page), else the theme's
    readonly property var gridNow: {
        var own = view.prefs && view.prefs.pageGrid ? view.prefs.pageGrid[pageKey] : null
        var g = own || th.gridSize
        return { cols: Math.max(2, Math.min(12, g.cols)), rows: Math.max(1, Math.min(8, g.rows)) }
    }
    property var rowCols: []

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
        function library(op, p) {
            return call("library", [op, p || {}]).then(function (r) {
                if (r && r.view) win.applyView(r.view)
                if (r && r.ok === false && r.error) win.setStatus(r.error, true)
                else if (r && r.message) win.setStatus(r.message)
                return r || {}
            })
        }
        function settings(op, p) { return call("settings", [op, p || {}]) }
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
            else if (ch === "launch-failed" && data) win.setStatus(data, true)
            else if (ch === "game-exited") win.setStatus(data || "", Boolean(data))
        }
        function onWindowOp(op) {
            if (shotMode) return
            if (op === "hide") win.hide()
            else { win.showFullScreen(); win.requestActivate() }
        }
    }
    // ---- for the screenshot runs (ludus.py --shot / --theme-shots): the factory themes, one at a time
    property var themeIds: []
    onReadyChanged: if (ready && shotMode) api.settings("themeGet").then(function (r) { themeIds = r && r.themes ? r.themes.map(function (t) { return t.id }) : [] })
    function useTheme(id) {
        api.settings("themeUse", { id: id }).then(function (r) {
            if (!r || !r.ok || !r.theme) return setStatus("no theme " + id, true)
            var p = Object.assign({}, view.prefs, { theme: r.theme })
            applyView(Object.assign({}, view, { prefs: p }))
        })
    }
    // A page the way qa/theme-shots.cjs shows it: library (two to the right), home, settings, or the tab bar.
    function shotView(v) {
        var id = v === "tabs" ? "library" : v
        var i = tabList.findIndex(function (t) { return t.id === id })
        stack = []
        cursors[id] = { row: 0, cols: {} }
        tabIndex = Math.max(0, i)
        area = v === "tabs" ? "tabs" : "content"
        if (id === "settings") settingsPage.sel = 0
        refresh()
        if (v === "library") { act("right"); act("right") }
    }

    function setStatus(t, err) { status = t || ""; statusError = Boolean(err); statusTimer.restart() }
    Timer { id: statusTimer; interval: 6000; onTriggered: win.status = "" }

    function applyView(v) {
        var before = view.prefs && view.prefs.theme ? view.prefs.theme.rev + ":" + view.prefs.theme.active : ""
        view = v
        if (v.artRev !== undefined) artRev = v.artRev
        loadPicture(before)
        refresh()
    }
    // The theme's background picture, asked for again only when the theme changes (look.js applyTheme).
    function loadPicture(before) {
        var t = view.prefs && view.prefs.theme
        var img = t && t.settings ? t.settings.find(function (s) { return s.type === "image" && s.value }) : null
        if (!img) { picture = ""; return }
        if (before === t.rev + ":" + t.active && picture) return
        api.settings("themeImage", { id: img.id }).then(function (r) {
            if (r && r.dataUrl) picture = r.dataUrl
            else { picture = ""; if (r && r.error) setStatus(r.error, true) }
        })
    }
    function folderTitle(id) { return (view.folders[id] || {}).title || "" }
    function tabName(id) {
        if (id === "new") return "+ Mosaic"
        if (id.indexOf("m:") === 0) return folderTitle(id.slice(2)) || "?"
        return ({ browser: "Browser", home: "Home", library: "Library", apps: "Apps", settings: "Settings" })[id] || id
    }

    // ---------------------------------------------------------------- what the page holds (home.js baseRows / currentRows)
    function withAdd(row, emptyTitle, emptySub) {
        if (!row.tiles.length) return { id: row.id, title: row.title, tiles: [{ id: "_add", kind: "add", big: true, title: emptyTitle, sub: emptySub }] }
        return { id: row.id, title: row.title, tiles: row.tiles.concat([{ id: "_add", kind: "add", title: "Add" }]) }
    }
    function baseRows() {
        if (stack.length) {
            var top = stack[stack.length - 1], f = view.folders[top] || { title: "", tiles: [] }
            return [withAdd({ id: top, title: f.title, tiles: f.tiles }, "This folder is empty", "Add a game, an app, or something from your library")]
        }
        if (page === "home") {
            // Home holds widgets only (inlays); they come to this version in the next part of the port
            var h = ((view.folders._home || {}).tiles || []).filter(function (t) { return t.kind === "inlay" })
            if (!h.length) return [{ id: "_home", title: "Home", tiles: [{ id: "_add", kind: "add", big: true, title: "Make this yours", sub: "Pick a widget, then choose where it goes" }] }]
            return [{ id: "_home", title: "Home", tiles: [{ id: "_widgets", kind: "add", big: true, title: "Your widgets", sub: h.length + (h.length === 1 ? " widget" : " widgets") + " · shown in the full Ludus for now" }] }]
        }
        if (isMosaic) {
            var id = page.slice(2), m = view.folders[id] || { title: "?", tiles: [] }
            return [withAdd({ id: id, title: m.title, tiles: m.tiles }, "This mosaic is empty", "Add a game, an app, an inlay, or something from your library")]
        }
        if (page === "library" || page === "apps") {
            var rows = (view.tabs[page] || []).map(function (r) { return withAdd({ id: r.id, title: r.title, tiles: r.tiles }) })
            if (rows.length) return rows
            var text = page === "library" ? ["Add your first game", "Pick a file or scan your folders"] : ["Add your first app", "Steam, a browser, anything you launch"]
            return [{ id: "_empty_" + page, title: tabName(page), tiles: [{ id: "_add", kind: "add", big: true, title: text[0], sub: text[1] }] }]
        }
        return []
    }
    property var rows: []
    function currentRows() {
        var base = baseRows()
        if (th.mode === "rails" || (page === "home" && !stack.length)) return base
        if (base.length === 1 && base[0].tiles.length === 1 && base[0].tiles[0].big) return base
        var per = th.mode === "flow" ? gridNow.cols + 2 : gridNow.cols
        var tiles = []
        base.forEach(function (r) { tiles = tiles.concat(r.tiles) })
        var out = []
        for (var i = 0; i < tiles.length; i += per) out.push({ id: "grid:" + (i / per), title: "", tiles: tiles.slice(i, i + per) })
        return out.length ? out : base
    }
    function cur() {
        if (!cursors[pageKey]) cursors[pageKey] = { row: 0, cols: {} }
        return cursors[pageKey]
    }
    property int selRow: 0
    property int selCol: 0
    function refresh() {
        var keep = tabList.length ? tabList[Math.min(tabIndex, tabList.length - 1)].id : "home"
        tabList = [{ id: "browser", title: "Browser" }].concat((view.tabOrder || []).map(function (t) { return { id: t, title: tabName(t) } })
                    .concat([{ id: "new", title: "+ Mosaic" }, { id: "settings", title: "Settings" }]))
        var i = tabList.findIndex(function (t) { return t.id === keep })
        tabIndex = i >= 0 ? i : Math.min(tabIndex, tabList.length - 1)
        if (stack.length && !folderTitle(stack[stack.length - 1])) stack = []
        rows = currentRows()
        var c = cur()
        c.row = Math.max(0, Math.min(rows.length - 1, c.row))
        rows.forEach(function (r) { c.cols[r.id] = Math.max(0, Math.min(r.tiles.length - 1, c.cols[r.id] || 0)) })
        selRow = c.row
        selCol = rows.length ? c.cols[rows[c.row].id] || 0 : 0
        rowCols = rows.map(function (r) { return c.cols[r.id] || 0 })
        th.moved(area === "tabs" ? "t|" + page : "c|" + pageKey + "|" + selRow + "|" + selCol)
    }
    onAreaChanged: th.moved(area === "tabs" ? "t|" + page : "c|" + pageKey + "|" + selRow + "|" + selCol)
    Connections { target: th; function onModeChanged() { win.refresh() } }
    onGridNowChanged: refresh()
    readonly property var selTile: rows.length && rows[selRow] ? rows[selRow].tiles[selCol] || null : null

    function goTab(i) {
        tabIndex = (i + tabList.length) % tabList.length
        stack = []
        refresh()
    }
    function setSel(r, c) {
        var cc = cur()
        cc.row = r
        if (rows[r]) cc.cols[rows[r].id] = c
        refresh()
    }

    // ---------------------------------------------------------------- input
    function act(a) {
        if (!ready) return
        if (keyboard.visible) return keyboard.press(a)
        if (menu.visible) return menu.press(a)
        if (a === "lb" || a === "rb") { goTab(tabIndex + (a === "lb" ? -1 : 1)); area = "tabs"; return }
        var entry = th.contentEntry
        var exit = { down: "up", up: "down", right: "left" }[entry]
        if (area === "tabs") {
            var prev = th.vertical ? "up" : "left", next = th.vertical ? "down" : "right"
            if (a === prev) return goTab(tabIndex - 1)
            if (a === next) return goTab(tabIndex + 1)
            if (a === entry || a === "a") {
                if (page === "new") return newMosaic()
                if (page === "browser") return setStatus("The browser comes to this version next. It's in the full Ludus (Settings › Go back).")
                if (page === "settings") { settingsPage.sel = 0; area = "content"; return }
                area = "content"
                return
            }
            if (a === "y" && !buttonTab) return openOptions(true)
            return
        }
        if (page === "settings") return settingsPage.press(a)
        var r = selRow, c = selCol
        if (a === "left") { if (c > 0) setSel(r, c - 1); else if (exit === "left") area = "tabs"; return }
        if (a === "right") { if (rows[r] && c < rows[r].tiles.length - 1) setSel(r, c + 1); return }
        if (a === "up") {
            if (r > 0) return setSel(r - 1, th.mode === "rails" ? (cur().cols[rows[r - 1].id] || 0) : Math.min(c, rows[r - 1].tiles.length - 1))
            if (exit === "up") area = "tabs"
            return
        }
        if (a === "down") {
            if (r < rows.length - 1) return setSel(r + 1, th.mode === "rails" ? (cur().cols[rows[r + 1].id] || 0) : Math.min(c, rows[r + 1].tiles.length - 1))
            if (exit === "down") area = "tabs"
            return
        }
        if (a === "a") return activate()
        if (a === "b") { if (stack.length) { stack = stack.slice(0, -1); refresh() } else area = "tabs"; return }
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
                if (e.key === Qt.Key_Return || e.key === Qt.Key_Enter) { keyboard.finish(true); e.accepted = true; return }
                if (e.key === Qt.Key_Escape) { keyboard.finish(false); e.accepted = true; return }
                if (e.key === Qt.Key_Backspace) { keyboard.typed = keyboard.typed.slice(0, -1); e.accepted = true; return }
                if (e.text && e.text.length === 1 && e.text >= " " && e.key !== Qt.Key_Return && e.key !== Qt.Key_Enter) { keyboard.typed += e.text; e.accepted = true; return }
            }
            if (m[e.key] !== undefined) { act(m[e.key]); e.accepted = true }
        }
    }
    Component.onCompleted: { refresh(); keys.forceActiveFocus() }

    // ---------------------------------------------------------------- doing things
    function activate() {
        var t = selTile
        if (!t) return
        if (t.kind === "folder") { stack = stack.concat([t.id]); refresh(); return }
        if (t.id === "_widgets" || (t.kind === "add" && pageCat === "_home")) return setStatus("Home's widgets come to this version next. Add them in the full Ludus (Settings › Go back).")
        if (t.kind === "add") return addSomething()
        api.launch(t.id)
    }
    // "+ Add" on a mosaic or folder: something from the library goes in.
    function addSomething() {
        if (!pageCat) return setStatus("Adding games and apps comes to this version next. Add them in the full Ludus (Settings › Go back).")
        var inThere = ((view.folders[pageCat] || {}).tiles || []).map(function (t) { return t.id })
        var all = []
        ;["library", "apps"].forEach(function (k) { (view.tabs[k] || []).forEach(function (r) { all = all.concat(r.tiles) }) })
        var items = all.filter(function (t) { return inThere.indexOf(t.id) < 0 }).map(function (t) { return { label: t.title, sub: t.kind === "app" ? "App" : "Game", id: t.id } })
        if (!items.length) return setStatus("Everything in your library is in here already.")
        var cat = pageCat
        menu.open("Add to " + folderTitle(cat), items, function (it) { api.library("addEntry", { catId: cat, ref: it.id }) })
    }
    function newMosaic() {
        keyboard.open("Name the new mosaic", "", function (name) {
            api.library("newCategory", { title: name }).then(function (r) {
                if (!r.ok) return
                var i = tabList.findIndex(function (x) { return x.id === "m:" + r.id })
                if (i >= 0) goTab(i)
                area = "content"
            })
        })
    }
    function openOptions(fromTabs) {
        var t = fromTabs || !selTile || selTile.kind === "add" ? null : selTile
        var cat = pageCat && pageCat !== "_home" ? pageCat : ""
        var items = []
        if (t) {
            if (t.kind === "folder") items.push({ label: "Open", op: "open" })
            else items.push({ label: t.kind === "app" ? "Start" : "Play", op: "play" })
            if (t.kind !== "folder") items.push({ label: "Add to a mosaic or folder…", op: "addTo" })
            if (cat) items.push({ label: "Remove from this page", op: "remove" })
        }
        if (cat) {
            items.push({ label: stack.length ? "Rename the open folder…" : "Rename this mosaic…", op: "rename" })
            if (!stack.length) {
                items.push({ label: "Move this mosaic left", op: "moveL" })
                items.push({ label: "Move this mosaic right", op: "moveR" })
            }
            items.push({ label: stack.length ? "Delete the open folder…" : "Delete this mosaic…", op: "delete", danger: true })
        }
        items.push({ label: "New mosaic…", op: "new" })
        menu.open("Options", items, function (it) { runOption(it.op, t, cat) })
    }
    function runOption(op, t, cat) {
        if (op === "open" || op === "play") return activate()
        if (op === "new") return newMosaic()
        if (op === "addTo") {
            var ms = (view.mosaics || []).filter(function (m) { return m.id !== cat })
            if (!ms.length) return setStatus("Make a mosaic first: + Mosaic in the tab bar.")
            return menu.open("Add “" + t.title + "” to…", ms.map(function (m) { return { label: m.title, id: m.id } }), function (m) {
                api.library("addEntry", { catId: m.id, ref: t.id })
            })
        }
        if (op === "remove") return api.library("removeEntry", { catId: cat, ref: t.id })
        if (op === "rename") return keyboard.open("Rename", folderTitle(cat), function (name) { api.library("renameCategory", { id: cat, title: name }) })
        if (op === "moveL" || op === "moveR") return api.library("moveTab", { id: page, dir: op === "moveL" ? -1 : 1 })
        if (op === "delete") {
            var inFolder = stack.length > 0
            return menu.open("Delete “" + folderTitle(cat) + "”?",
                             [{ label: "Delete (your games and apps are kept)", op: "yes", danger: true }, { label: "Cancel", op: "no" }],
                             function (it) {
                                 if (it.op !== "yes") return
                                 if (inFolder) stack = stack.slice(0, -1)
                                 else area = "tabs"
                                 api.library("deleteCategory", { id: cat })
                             }, 1)
        }
    }
    readonly property string titleText: area !== "content"
        ? (page === "new" ? "Press A to create a mosaic" : page === "browser" ? "Press A to open your browser" : tabName(page))
        : (page === "settings" ? "" : selTile && !selTile.big ? selTile.title : "")

    // ================================================================ the screen
    Backdrop {
        anchors.fill: parent
        th: th
        picture: win.picture
        spotArt: win.selTile && win.selTile.art === true ? "image://art/" + encodeURIComponent(win.selTile.id) + "?" + win.artRev : ""
    }

    // "Screen area used": everything inside a safe area (TVs that crop the edges)
    Item {
        id: body
        anchors.fill: parent
        anchors.topMargin: (1 - th.use) * win.height / 2
        anchors.bottomMargin: anchors.topMargin
        anchors.leftMargin: (1 - th.use) * win.width / 2
        anchors.rightMargin: anchors.leftMargin
        readonly property real sideW: th.parts.tabs === "chunky" ? th.clamp(190, 21 * th.vw, 360) : th.clamp(178, 18 * th.vw, 320)

        // ---- the menu: a column on the left, or a strip across the top / bottom
        Item {
            id: header
            readonly property string nav: th.parts.nav
            readonly property bool hints: ["pills", "segments"].indexOf(th.parts.tabs) >= 0 || nav === "bottom-bar"
            readonly property real headerPad: nav === "bottom-dock" ? th.clamp(8, 1.3 * th.vh, 16) : nav === "top" || nav === "top-left" ? (th.parts.tabs === "segments" ? th.clamp(8, 1.6 * th.vh, 20) : 18) : th.clamp(6, 1.6 * th.vh, 18)
            x: nav === "left" ? (th.parts.tabs === "chunky" ? th.clamp(14, 2.4 * th.vw, 40) : 0) : 0
            width: nav === "left" ? body.sideW : body.width
            height: nav === "left" ? body.height : nav === "bottom-bar" ? th.clamp(118, 23 * th.vh, 230) * (["round", "chunky"].indexOf(th.parts.tabs) >= 0 ? 1.43 : 1) : headerRow.height + headerPad * 2
            y: nav === "left" ? 0
             : th.navBottom ? body.height - height - (nav === "bottom" ? footerSpace : nav === "bottom-dock" ? th.clamp(4, 1 * th.vh, 12) : 0)
             : clockTop.height
            readonly property real footerSpace: 3 * th.rem

            Rectangle {     // bottom-dock: a framed panel
                visible: header.nav === "bottom-dock"
                anchors.fill: parent
                anchors.leftMargin: Math.max(0, (parent.width - 1480) / 2)
                anchors.rightMargin: anchors.leftMargin
                radius: th.radius + 6
                color: th.alpha(th.panel, 0.9)
                border.width: Math.max(th.borderW, 1)
                border.color: th.mix(th.border, th.accent, 0.3)
            }
            Rectangle {     // bottom-bar: a curved bar along the bottom
                visible: header.nav === "bottom-bar"
                x: -body.anchors.leftMargin
                width: win.width
                height: parent.height + body.anchors.bottomMargin
                topLeftRadius: th.clamp(34, 8 * th.vh, 80)
                topRightRadius: topLeftRadius
                gradient: Gradient {
                    GradientStop { position: 0; color: th.mix(th.panel, Qt.color("#ffffff"), 0.75) }
                    GradientStop { position: 0.7; color: th.panel }
                    GradientStop { position: 1; color: th.mix(th.panel, Qt.color("#000000"), 0.08) }
                }
                border.width: 3
                border.color: th.alpha(th.border, 0.85)
            }
            Rectangle {     // segments: a band across, lined above and below
                visible: th.parts.tabs === "segments" && (header.nav === "top" || header.nav === "top-left")
                anchors.fill: parent
                gradient: Gradient {
                    orientation: Gradient.Horizontal
                    GradientStop { position: 0; color: th.alpha(th.panel, 0.92) }
                    GradientStop { position: 0.5; color: th.mix(th.panel, th.accent, 0.13) }
                    GradientStop { position: 1; color: th.alpha(th.panel, 0.92) }
                }
                Rectangle { width: parent.width; height: Math.max(th.borderW, 2); color: th.mix(th.border, th.accent, 0.86) }
                Rectangle { y: parent.height - height; width: parent.width; height: Math.max(th.borderW, 2); color: th.mix(th.border, th.accent, 0.86) }
            }

            RowLayout {
                id: headerRow
                visible: header.nav !== "left"
                readonly property real side: header.nav === "top-left" ? th.edge : header.nav === "bottom-bar" ? th.clamp(18, 4 * th.vw, 70) : 0
                x: side
                width: header.width - 2 * side
                y: header.nav === "bottom-bar" ? header.height - height - th.clamp(12, 3.2 * th.vh, 32) : header.headerPad
                spacing: header.nav === "bottom-bar" ? 0 : 28
                Item { Layout.fillWidth: header.nav !== "top-left"; visible: header.nav !== "bottom-bar" }
                HintKey { visible: header.hints; th: th; label: "LB"; round: header.nav === "bottom-bar" }
                Item { Layout.fillWidth: true; visible: header.nav === "bottom-bar" }
                TabBar {
                    th: th
                    tabs: win.tabList
                    current: win.tabIndex
                    focused: win.area === "tabs"
                    span: th.parts.tabs === "segments" ? Math.min(1680, 88 * th.vw)
                        : header.nav === "top-left" ? 72 * th.vw
                        : header.nav === "bottom-dock" ? Math.min(1170, 78 * th.vw)
                        : header.nav === "bottom-bar" ? 64 * th.vw
                        : th.parts.tabs === "round" ? 94 * th.vw : Math.min(1100, 76 * th.vw)
                    Layout.preferredWidth: Math.min(span, implicitWidth)
                    Layout.preferredHeight: implicitHeight
                }
                Item { Layout.fillWidth: true; visible: header.nav === "bottom-bar" }
                HintKey { visible: header.hints; th: th; label: "RB"; round: header.nav === "bottom-bar" }
                Item { Layout.fillWidth: true; visible: header.nav !== "bottom-bar" }
            }
            Column {
                visible: header.nav === "left"
                x: th.clamp(10, 1.5 * th.vw, 22)
                y: th.clamp(14, 2.6 * th.vh, 30) + (th.parts.emblem === "cube" ? 12 * th.vh : 0)
                width: header.width - 2 * x
                spacing: th.clamp(8, 1.5 * th.vh, 18)
                HintKey { visible: header.hints; th: th; label: "LB"; anchors.horizontalCenter: parent.horizontalCenter }
                TabBar {
                    th: th
                    tabs: win.tabList
                    current: win.tabIndex
                    focused: win.area === "tabs"
                    span: parent.width
                }
                HintKey { visible: header.hints; th: th; label: "RB"; anchors.horizontalCenter: parent.horizontalCenter }
            }
        }

        // ---- the clock: across the top, in a corner, or in the curved bar
        Item {
            id: clockTop
            visible: th.parts.clock === "topbar" && th.parts.nav !== "left"
            width: body.width
            height: visible ? topRow.height + th.clamp(10, 2.6 * th.vh, 28) : 0
            Item {
                id: topRow
                x: th.clamp(18, 4.5 * th.vw, 72)
                y: th.clamp(10, 2.6 * th.vh, 28)
                width: parent.width - 2 * x
                height: th.clamp(34, 6 * th.vh, 56)
                Rectangle {
                    width: parent.height; height: width; radius: width / 2
                    color: th.mix(th.accent, Qt.color("#000000"), 0.1)
                    Text { anchors.centerIn: parent; text: "☺"; color: "#ffffff"; font.pixelSize: parent.height * 0.55 }
                }
                Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: clock.time; color: th.text; font.pixelSize: 1.05 * th.rem; font.weight: Font.DemiBold }
            }
        }
        Row {
            visible: th.parts.clock === "corner" || (th.parts.clock === "bar" && th.parts.nav !== "bottom-bar") || (th.parts.clock === "topbar" && th.parts.nav === "left")
            anchors.right: parent.right
            anchors.rightMargin: th.edge
            y: th.clamp(12, 3 * th.vh, 32)
            spacing: th.parts.tabs === "pivots" ? 14 : 18
            layoutDirection: th.parts.tabs === "pivots" ? Qt.RightToLeft : Qt.LeftToRight
            z: 5
            Text { anchors.verticalCenter: parent.verticalCenter; text: clock.time; color: th.text; font.pixelSize: (th.parts.tabs === "pivots" ? 1.05 : 1.15) * th.rem; font.weight: th.parts.tabs === "pivots" ? Font.Normal : Font.Medium }
            Rectangle {
                width: (th.parts.tabs === "pivots" ? 2.3 : 2.2) * th.rem; height: width
                radius: th.parts.tabs === "pivots" ? 0 : width / 2
                color: th.parts.tabs === "pivots" ? th.accent : th.alpha(th.text, 0.18)
                Text { anchors.centerIn: parent; text: "☺"; color: th.parts.tabs === "pivots" ? "#ffffff" : th.text; font.pixelSize: parent.height * 0.6 }
            }
        }
        Column {
            visible: th.parts.clock === "bar" && th.parts.nav === "bottom-bar"
            anchors.horizontalCenter: parent.horizontalCenter
            y: header.y + header.height - header.height * (["round", "chunky"].indexOf(th.parts.tabs) >= 0 ? 0.58 : 0.4) - height / 2
            z: 3
            Text { anchors.horizontalCenter: parent.horizontalCenter; text: clock.time; color: th.text; font.pixelSize: th.clamp(1.8 * th.rem, 6.5 * th.vh, 3.6 * th.rem); font.weight: Font.DemiBold; font.letterSpacing: 2 }
            Text { anchors.horizontalCenter: parent.horizontalCenter; text: clock.date; color: th.muted; font.pixelSize: th.clamp(0.85 * th.rem, 2.4 * th.vh, 1.3 * th.rem); font.weight: Font.DemiBold }
        }
        QtObject {
            id: clock
            property string time: Qt.formatTime(new Date(), "h:mm")
            property string date: Qt.formatDate(new Date(), "ddd d MMM")
        }
        Timer { interval: 15000; running: true; repeat: true; onTriggered: { clock.time = Qt.formatTime(new Date(), "h:mm"); clock.date = Qt.formatDate(new Date(), "ddd d MMM") } }

        // ---- everything else: crumb, title, the tiles, status, button hints
        ColumnLayout {
            id: column
            readonly property bool sideNav: th.parts.nav === "left"
            readonly property string nav: th.parts.nav
            readonly property bool leftAligned: sideNav || nav === "top-left" || nav === "bottom-dock" || th.parts.title === "big"
            x: sideNav ? header.x + header.width + th.clamp(14, 2 * th.vw, 34) : 0
            width: body.width - x - (sideNav && th.parts.tabs === "chunky" ? th.clamp(14, 2.4 * th.vw, 40) : 0)
            y: sideNav ? 0 : th.navBottom ? clockTop.height : header.y + header.height
            height: sideNav ? body.height : th.navBottom ? header.y - y + (header.nav === "bottom" ? header.footerSpace + header.height : 0) - (header.nav === "bottom" ? header.height : 0) : body.height - y
            spacing: 0

            Text {     // where you are, inside folders
                visible: column.nav !== "bottom-bar" && th.parts.row !== "start"
                Layout.fillWidth: true
                Layout.leftMargin: column.leftAligned && !column.sideNav ? th.edge : 0
                Layout.topMargin: column.sideNav ? th.clamp(4, 1 * th.vh, 12) : 0
                Layout.minimumHeight: 1.5 * th.rem
                horizontalAlignment: column.leftAligned || th.parts.tabs === "segments" ? Text.AlignLeft : Text.AlignHCenter
                text: win.stack.length ? [win.tabName(win.page)].concat(win.stack.map(win.folderTitle)).join("  ›  ") : ""
                color: th.muted
                font.pixelSize: th.rem
            }
            SelectionTitle { visible: th.parts.title === "above"; th: th; text: win.titleText; leftAligned: column.leftAligned; inset: !column.sideNav; Layout.fillWidth: true; Layout.topMargin: th.clamp(4, 2 * th.vh, 24) }

            Item {     // the tiles
                id: viewport
                Layout.fillWidth: true
                // "start": only the one row shows, so the page is as tall as it (style.css data-part-row="start")
                readonly property bool oneRow: th.parts.row === "start" && th.mode === "rails" && win.page !== "settings" && win.page !== "new"
                Layout.fillHeight: !oneRow
                Layout.preferredHeight: oneRow ? th.cardSize.h * 1.32 + 64 : -1
                Layout.topMargin: th.parts.row === "start" ? th.clamp(12, 3 * th.vh, 34) : column.nav === "bottom-bar" ? th.clamp(14, 4 * th.vh, 44) : 0
                clip: true
                Tiles {
                    anchors.fill: parent
                    th: th
                    rows: win.rows
                    selRow: win.selRow
                    selCol: win.selCol
                    active: win.area === "content" && !menu.visible && !keyboard.visible
                    artRev: String(win.artRev)
                    cols: win.rowCols
                    pageKey: win.pageKey
                    grid: win.gridNow
                    visible: win.page !== "settings" && win.page !== "new"
                }
                Column {
                    anchors.centerIn: parent
                    visible: win.page === "new"
                    spacing: 10
                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: "A new mosaic"; color: th.text; font.pixelSize: 1.6 * th.rem; font.weight: Font.DemiBold }
                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Press A to make one and name it."; color: th.muted; font.pixelSize: 1.1 * th.rem }
                }
                SettingsPage { id: settingsPage; anchors.fill: parent; visible: win.page === "settings"; th: th; active: win.area === "content" && !menu.visible; onLeave: win.area = "tabs" }
            }

            SelectionTitle { visible: th.parts.title !== "above"; th: th; text: win.titleText; leftAligned: column.leftAligned; inset: !column.sideNav; Layout.fillWidth: true }
            Text {
                Layout.fillWidth: true
                Layout.leftMargin: column.leftAligned && !column.sideNav ? th.edge : 0
                Layout.minimumHeight: 1.5 * th.rem
                horizontalAlignment: column.leftAligned ? Text.AlignLeft : Text.AlignHCenter
                text: win.status
                color: win.statusError ? "#ffb4a8" : th.muted
                font.pixelSize: 1.1 * th.rem
                wrapMode: Text.Wrap
            }
            Footer {
                visible: header.nav !== "bottom"
                th: th
                Layout.fillWidth: true
            }
        }
        Footer {      // "bottom": the hints under the menu, with a line above them
            visible: header.nav === "bottom"
            th: th
            ruled: true
            x: th.clamp(18, 4.5 * th.vw, 72)
            width: body.width - 2 * x
            y: body.height - height
        }
    }

    // ---- emblem: a turning cube over the menu
    Item {
        visible: th.parts.emblem === "cube"
        width: 8.4 * th.vh
        height: width
        x: th.parts.nav === "left" ? body.anchors.leftMargin + header.x + header.width / 2 - width / 2 : th.edge
        y: th.navBottom ? win.height - th.clamp(52, 10 * th.vh, 110) - height : th.clamp(16, 4 * th.vh, 44)
        z: 6
        Repeater {
            model: 2
            Rectangle {
                anchors.fill: parent
                radius: 0.6 * th.vh
                color: th.alpha(th.border, 0.55)
                border.width: 0.45 * th.vh
                border.color: th.mix(th.accent, Qt.color("#ffffff"), 0.2)
                transform: Rotation {
                    origin.x: width / 2; origin.y: height / 2
                    axis { x: 0.3; y: 1; z: 0 }
                    angle: spinner.angle + index * 90
                }
            }
        }
        QtObject { id: spinner; property real angle: 38 }
        NumberAnimation { target: spinner; property: "angle"; running: th.motion && th.parts.emblem === "cube"; from: 38; to: 398; duration: 14000; loops: Animation.Infinite }
    }

    // ================================================================ overlays
    Menu { id: menu; anchors.fill: parent; th: th; z: 20 }
    Keyboard { id: keyboard; anchors.fill: parent; th: th; z: 30; keys: win.view.keys || ({ back: 2, space: 3, shift: 10, done: 9, cancel: 1 }) }
}
