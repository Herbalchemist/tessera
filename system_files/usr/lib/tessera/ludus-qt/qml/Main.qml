// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the screen. It looks the way the full Ludus's page does for the same theme (every
// theme setting and layout part, see Theme.qml), and everything behind it is the full Ludus's own
// main process, unchanged, reached through `api` (the same requests its page makes) over
// `bridge` (ludus.py). One dispatcher, act(), takes every press (controller, keyboard).
import QtQuick
import QtQuick.Layouts
import QtQuick.Window
import QtQuick.Shapes

Window {
    id: win
    width: 1280
    height: 720
    // the Opus helper (--guide): only the guide, in a hidden see-through window that comes up over the desktop
    property bool hidden: guideOnly
    visible: !hidden
    flags: guideOnly ? (Qt.Window | Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.Tool) : Qt.Window
    visibility: shotMode || guideOnly ? Window.Windowed : Window.FullScreen
    color: guideOnly ? "transparent" : th.bg
    // the main process hides the screen while a game runs, and shows it again after
    function windowOp(op) {
        if (op === "hide") hidden = true
        else if (op === "show") { hidden = false; Qt.callLater(function () { win.raise(); win.requestActivate() }) }
        else if (op === "focus") requestActivate()
    }
    onActiveChanged: if (guideOnly && !active && !hidden && flows.guideOn) flows.closeGuide(false)     // clicked away on the desktop
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
    // display calibration: the saved one, unless Gamescope already applies it to everything; while the steps run, theirs
    property bool calOverrideOn: false
    property var calOverride: null
    readonly property var calSaved: { var c = view.prefs && view.prefs.calibration; return c && c.cal && c.cal.enabled && !c.systemActive ? c.cal : null }
    readonly property var calNow: calOverrideOn ? calOverride : calSaved
    readonly property bool calOn: Boolean(calNow)
    function runCalibration(mode) { return new Promise(function (resolve) { calib.begin(mode, resolve) }) }
    property string area: "tabs"            // "tabs" or "content"
    property int tabIndex: 0
    property var tabList: []
    property var stack: []                  // open folders, innermost last
    property var cursors: ({})              // per page: { row, cols: { rowId: col } }
    property string status: ""
    property bool statusError: false
    property string picture: ""             // the theme's background picture (a data: URL)
    property int artRev: 0
    property var place: null                // a widget being placed or resized on Home
    property alias padtest: padTestView
    property alias guideMenu: menu
    property alias tour: tourView
    property alias grip: gripView
    property alias capture: captureView     // the controller test (Flows opens it)
    property string browserUrl: "https://duckduckgo.com/"
    property bool browserOpen: false        // the page is on screen and has the controller
    property bool browserOpening: false     // asking to open it (PIN, guest checks)
    property double browserQuiet: 0         // a press that closed it also reaches the screen's own pad reader: ignore that echo
    property var queuedTabs: []             // bumper presses made while it was coming or going
    property var sys: null                  // systemInfo, once a second while Home shows a system widget
    property string clockNow: Qt.formatTime(new Date(), "h:mm AP")
    property string clockDay: Qt.formatDate(new Date(), "dddd, MMMM d")

    readonly property var curTab: tabList.length ? tabList[Math.min(tabIndex, tabList.length - 1)] : ({ id: "home", title: "Home" })
    readonly property string page: curTab.id
    readonly property string pageKey: stack.length ? "f:" + stack[stack.length - 1] : page
    readonly property bool isMosaic: page.indexOf("m:") === 0
    readonly property string pageCat: stack.length ? stack[stack.length - 1] : (isMosaic ? page.slice(2) : (page === "home" ? "_home" : ""))
    readonly property bool homeMode: page === "home" && stack.length === 0
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
        function addons(op, p) { return call("addons", [op, p || {}]) }
        function systemInfo() { return call("systemInfo", []) }
    }
    Connections {
        target: bridge
        function onReply(id, m) {
            var done = api.waiting[id]
            delete api.waiting[id]
            if (done) done(m.ok ? m.result : { ok: false, error: m.error })
        }
        function onEvent(ch, data) {
            if (ch === "init") { var first = !win.ready; win.applyView(data); win.ready = true; if (first) { if (!guideOnly) keepTimer.start(); if (!shotMode && !guideOnly) { startTimer.payload = data; startTimer.start() } } }
            else if (ch === "flow-ui" && data) flows.flowUi(data)
            else if (ch === "drive-added" && data) flows.offerDrive(data)
            else if (ch === "display-new" && data) flows.displayNew(data)
            else if (ch === "launch-failed" && data) win.setStatus(data, true)
            else if (ch === "game-exited") win.setStatus(data || "", Boolean(data))
            else if (ch === "guide") flows.guideEvent(data)
            else if (ch === "graphics" && data && data.mismatch) flows.offerGraphics(data)
            else if (ch === "pads" && data && data.type === "list") gripView.apply(data)
            else if (ch === "browser-load" && data) browser.load(String(data))
            else if (ch === "browser-cursor") browser.pointer(data)
            else if (ch === "browser-action") win.browserAct(data)
            else if (ch === "browser-close") { win.browserOpen = false; browserInput.setActive(false); browser.drop() }
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
    function shotRun(id) {
        if (id === "_wheel") pickColor("Accent color", "#7fb2ff")
        else if (id === "_calfilter") { calOverride = { gamma: [1.25, 1, 0.85], gain: [1, 0.95, 0.88], black: 0.03, white: 0.95, sat: 1.3 }; calOverrideOn = true }
        else if (id === "_calfilter-off") calOverrideOn = false
        else if (id === "_calib") runCalibration("thorough")
        else if (String(id).indexOf("_geom:") === 0) { geom(String(id).slice(6)) }
        else if (String(id).indexOf("_tour:") === 0) { tourView.openAt(parseInt(String(id).slice(6))) }
        else if (id === "_tour") { gripView.visible = false; if (menu.visible) menu.close(); tourView.open() }
        else if (id === "_kb-wasd" || id === "_kb-standard") rawCall("settings", ["kbSet", { key: "preset", value: id.slice(4) }]).then(loadKb)
        else if (id === "_guide-float" || id === "_guide-compact") { shotGuide = id.slice(7); flows.closeGuide(false); live = null; gripView.visible = false; wheel.visible = false; if (menu.visible) menu.close(); flows.guideEvent({ action: "menu" }) }
        else if (id === "_guide") { flows.closeGuide(false); live = null; gripView.visible = false; wheel.visible = false; if (menu.visible) menu.close(); flows.guideEvent({ action: "menu" }) }
        else if (id === "_grip") { padTestView.visible = false; flows.grip() }
        else if (id === "_controls") { padTestView.visible = false; flows.controls() }
        else if (id === "_padtest") { calib.visible = false; keyboard.visible = false; browser.shown = false; flows.padTest() }
        else if (id === "_browser") { calib.visible = false; browserUrl = "https://example.com/"; openBrowser(1) }
        else if (id === "_browser-url") openUrlBar()
        else runAction(id)
    }     // screenshot runs: open a Settings flow by tile id
    function shotView(v) {
        var id = v === "tabs" ? "library" : v
        var i = tabList.findIndex(function (t) { return t.id === id })
        stack = []
        cursors[id] = { row: 0, cols: {} }
        tabIndex = Math.max(0, i)
        area = v === "tabs" ? "tabs" : "content"
        refresh()
        if (v === "library") { act("right"); act("right") }
    }

    Timer {
        interval: 1000; running: true; repeat: true; triggeredOnStart: true
        onTriggered: {
            var d = new Date()
            clockNow = Qt.formatTime(d, "h:mm AP"); clockDay = Qt.formatDate(d, "dddd, MMMM d")
            var wants = homeMode && rows.length && rows[0].tiles.some(function (t) { return ["cpu", "ram", "storage", "battery", "network", "uptime"].indexOf(t.type) >= 0 })
            if (wants && ready) api.systemInfo().then(function (r) { if (r && r.ok !== false) sys = r })
        }
    }
    property var statusLog: []              // the guide's notifications: what the status line said, newest first
    function setStatus(t, err) {
        status = t || ""; statusError = Boolean(err); statusTimer.restart()
        if (t) { statusLog = [{ msg: String(t), isError: Boolean(err), at: Date.now() }].concat(statusLog).slice(0, 30) }
    }
    Timer { id: statusTimer; interval: 6000; onTriggered: win.status = "" }

    function applyView(v) {
        var before = view.prefs && view.prefs.theme ? view.prefs.theme.rev + ":" + view.prefs.theme.active : ""
        view = v
        if (v.prefs && v.prefs.pad) padState.setPad(v.prefs.pad)
        kbPrefs = v.prefs && v.prefs.kb ? v.prefs.kb : {}
        var kbSig = JSON.stringify(v.prefs && v.prefs.kb || {})
        if (kbSig !== kbSeen) { kbSeen = kbSig; loadKb() }
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
            // Home holds widgets only (inlays)
            var h = ((view.folders._home || {}).tiles || []).filter(function (t) { return t.kind === "inlay" })
            if (!h.length) return [{ id: "_home", title: "Home", tiles: [{ id: "_add", kind: "add", big: true, title: "Make this yours", sub: "Pick a widget, then choose where it goes", ctx: { catId: "_home" } }] }]
            return [{ id: "_home", title: "Home", tiles: h }]
        }
        if (isMosaic) {
            var id = page.slice(2), m = view.folders[id] || { title: "?", tiles: [] }
            return [withAdd({ id: id, title: m.title, tiles: m.tiles }, "This mosaic is empty", "Add a game, an app, an inlay, or something from your library")]
        }
        if (page === "settings") return settingsRows()
        if (page === "library" || page === "apps") {
            var rows = (view.tabs[page] || []).map(function (r) { return withAdd({ id: r.id, title: r.title, tiles: r.tiles }) })
            if (rows.length) return rows
            var text = page === "library" ? ["Add your first game", "Pick a file or scan your folders"] : ["Add your first app", "Steam, a browser, anything you launch"]
            return [{ id: "_empty_" + page, title: tabName(page), tiles: [{ id: "_add", kind: "add", big: true, title: text[0], sub: text[1] }] }]
        }
        return []
    }
    // ---------------------------------------------------------------- Settings (look.js SETTINGS_ROWS)
    // Everything here is also in the full Ludus; what is marked soon opens there until it is ported.
    readonly property var settingsDef: [
        { id: "_cat_connect", title: "Connections", tiles: [["_wifi", "Wi-Fi", "wifi"], ["_bluetooth", "Bluetooth", "bluetooth"]] },
        { id: "_cat_look", title: "Picture & sound", tiles: [["_appearance", "Appearance", "theme"], ["_sound", "Sound", "sound"]] },
        { id: "_cat_pads", title: "Controllers", tiles: [["_pad", "Controller", "pad"], ["_keyboard", "Keyboard & mouse", "keyboard"]] },
        { id: "_cat_people", title: "People", tiles: [["_profiles", "Profiles", "profiles"], ["_pin", "PIN", "pin"]] },
        { id: "_cat_system", title: "System", tiles: [["_storage", "Storage", "storage"], ["_update", "Update software", "update"], ["_addons", "Add-ons", "addons"],
                                                      ["_report", "Report a problem", "report"], ["_fullludus", "Go back to the full Ludus", "update"]] },
        { id: "_cat_power", title: "Power", tiles: [["_power", "Power", "power"], ["_desktop", "Opus", "desktop"]] }
    ]
    function settingNote(id) {
        var p = view.prefs || {}
        if (th.val("setNotes", true) === false) return ""
        if (id === "_appearance") { var t = p.theme && p.theme.themes ? p.theme.themes.filter(function (x) { return x.id === p.theme.active })[0] : null; return t ? t.name : "" }
        if (id === "_profiles") return p.profiles && p.profiles.length ? p.profiles.length + (p.profiles.length === 1 ? " profile" : " profiles") : "None yet"
        if (id === "_pin") return p.pin && p.pin.set ? "On" : "Off"
        if (id === "_wifi") return tileNotes.wifi
        if (id === "_bluetooth") return tileNotes.bluetooth
        if (id === "_sound") return tileNotes.audio
        if (id === "_power") return "Sleep · Restart · Off"
        if (id === "_install") return "on this computer"
        if (id === "_recover") return "a Tessera that won't start"
        if (id === "_desktop") return "Login screen"
        if (id === "_fullludus") return "Every setting is there"
        return ""
    }
    function settingsRows() {
        var usb = view.prefs && view.prefs.live ? [{ id: "_cat_usb", title: "Tessera USB", tiles: [["_install", "Install Tessera", "update"], ["_recover", "Recover", "report"]] }] : []
        return usb.concat(settingsDef).map(function (r) {
            return { id: r.id, title: r.title, cat: true, tiles: r.tiles.map(function (t) { return { id: t[0], title: t[1], kind: "action", icon: t[2], sub: settingNote(t[0]) } }) }
        })
    }
    // ---- menus as promises (the flows ask, wait for the answer, and carry on)
    function pick(title, items, index, opts) {
        return new Promise(function (resolve) { menu.open(title, items, function (it) { resolve(it) }, index || 0, function () { resolve(null) }, opts) })
    }
    function ask(title, start, opts) {
        return new Promise(function (resolve) {
            var o = Object.assign({}, opts || {})
            o.cancel = function () { resolve(null) }
            keyboard.open(title, start || "", function (t) { resolve(t) }, o)
        })
    }
    function sleepMs(ms) { return new Promise(function (resolve) { sleeper.after(ms, resolve) }) }
    Timer {
        id: sleeper
        property var waits: []
        interval: 100; repeat: true; running: waits.length > 0
        function after(ms, fn) { waits.push({ at: Date.now() + ms, fn: fn }); waitsChanged() }
        onTriggered: {
            var now = Date.now(), due = waits.filter(function (w) { return w.at <= now })
            waits = waits.filter(function (w) { return w.at > now })
            due.forEach(function (w) { w.fn() })
        }
    }
    // a call to the main process that never throws: always an answer with ok, and an error to show
    function safe(p) {
        return Promise.resolve(p).then(function (r) { return r || { ok: false, error: "Something went wrong." } }, function () { return { ok: false, error: "Something went wrong." } })
    }
    // runs something that may need the PIN: if the main process says so, asks for it and tries once more
    function gated(f) {
        return safe(f()).then(function (r) {
            if (!r.needPin) return r
            return requirePin().then(function (ok) { return ok ? safe(f()) : { ok: false, canceled: true, error: "" } })
        })
    }
    function requirePin(reason) {
        return api.settings("pinStatus").then(function (st) {
            if (!st || !st.set || st.unlocked) return true
            var tries = 0
            function again() {
                if (tries++ >= 5) return false
                return ask(reason || "Enter the PIN", "", { digits: true, secret: true, max: 8 }).then(function (pin) {
                    if (pin === null) return false
                    return api.settings("pinCheck", { pin: pin }).then(function (r) {
                        if (r && r.ok) return true
                        setStatus((r && r.error) || "That isn't the PIN.", true)
                        if (r && r.wait) return false
                        return again()
                    })
                })
            }
            return again()
        })
    }
    // a menu that keeps itself fresh: cfg {title, items(st), body(st), reload(st), every}; resolves with the chosen row (null: back)
    property var live: null
    Timer { id: liveTimer; repeat: true; running: win.live !== null && menu.visible; onTriggered: win.liveTick() }
    function liveList(st, cfg) {
        var first = cfg.items(st)
        var at = st.at ? first.findIndex(function (x) { return x.key === st.at }) : -1
        cfg.st = st; cfg.loading = false
        liveTimer.interval = cfg.every || 4000
        live = cfg
        return pick(cfg.title, first, Math.max(0, at), { body: cfg.body(st) }).then(function (it) {
            live = null
            if (it && it.key) st.at = it.key
            return it
        })
    }
    function liveTick() {
        var c = live
        if (!c || c.loading || !menu.visible || Date.now() < menu.holdUntil) return
        c.loading = true
        Promise.resolve(c.reload(c.st)).catch(function () {}).then(function () {
            c.loading = false
            if (live === c && menu.visible) menu.update(c.items(c.st), c.body(c.st))
        })
    }
    // a job that takes a while (pairing, joining): shown until it is over; B or Cancel stops it
    property var job: null
    Timer { id: jobTimer; interval: 700; repeat: true; running: win.job !== null; onTriggered: win.jobTick() }
    function clockText(sec) { sec = Math.max(0, Math.floor(sec || 0)); return Math.floor(sec / 60) + ":" + (sec % 60 < 10 ? "0" : "") + (sec % 60) }
    // opts: ask (text: B or Stop first asks "Stop it?"), noAck, otherwise (what to hand back when the job just vanishes)
    function watchJob(which, title, body, opts) {
        opts = opts || {}
        return new Promise(function (resolve) {
            var j = { which: which, title: title, body: body, p: { elapsed: 0, stage: "", name: "" }, canceling: false, asking: false, lost: 0, polling: false, over: false, started: Date.now(), resolve: resolve, opts: opts }
            j.items = function () {
                if (j.canceling) return [{ label: "Stopping…", header: true }]
                if (j.asking) return [{ label: "No, keep going", op: "no" }, { label: "Yes, stop", op: "yes", danger: true }]     // the safe answer first
                return [{ label: "Cancel", op: "cancel", danger: true }]
            }
            j.text = function () { return j.asking ? opts.ask : j.body(j.p, j.canceling) }
            j.show = function () { menu.open(j.title, j.items(), j.pressed, 0, function () { j.pressed(null) }, { body: j.text() }) }
            j.doCancel = function () { j.canceling = true; j.asking = false; safe(api.call(which, ["cancel", {}])) }
            j.pressed = function (it) {
                if (j.over) return
                if (j.canceling) { }
                else if (j.asking) { if (it && it.op === "yes") j.doCancel(); else j.asking = false }
                else if (opts.ask) j.asking = true
                else j.doCancel()
                j.show()
            }
            job = j
            j.show()
        })
    }
    function jobTick() {
        var j = job
        if (!j || j.polling || j.over || Date.now() - j.started < 500) return
        j.polling = true
        safe(api.call(j.which, ["poll", {}])).then(function (q) {
            j.polling = false
            if (job !== j || j.over) return
            if (!q.ok) { if (++j.lost > 12) endJob(j, { phase: "done", result: "error", error: "Lost touch with it.", detail: "" }) }
            else if (q.phase === "running") { j.lost = 0; j.p = q; if (!j.asking) menu.update(j.items(), j.text()) }
            else { if (!j.opts.noAck) api.call(j.which, ["ack", {}]); endJob(j, q.phase === "done" ? q : (j.opts.otherwise || { phase: "done", result: "error", error: "It stopped unexpectedly.", detail: "" })) }
        })
    }
    function endJob(j, r) { j.over = true; job = null; if (menu.visible) menu.close(); j.resolve(r) }
    function confirmYes(question, yesLabel) {
        return pick(question, [{ label: yesLabel || "Yes", op: "yes" }, { label: "Cancel", op: "no" }], 1).then(function (r) { return Boolean(r && r.op === "yes") })
    }
    function notice(title, body) { return pick(title, [{ label: "OK", op: "ok" }], 0, { body: body || "" }) }
    function runAction(id) {
        if (id === "_power") return flowPower()
        if (id === "_pad") return flows.pad()
        if (id === "_keyboard") return flows.keyboardMenu()
        if (id === "_controls") return flows.controls()
        if (id === "_grip") return flows.grip()
        if (id === "_appearance" || id === "_theme") return flows.appearance()
        if (id === "_addons") return flows.addons()
        if (id === "_storage") return flows.storage()
        if (id === "_profiles") return flows.profiles()
        if (id === "_pin") return flows.pin()
        if (id === "_update") return flows.update()
        if (id === "_report") return flows.report()
        if (id === "_sound") return flows.sound()
        if (id === "_wifi") return flows.wifi()
        if (id === "_bluetooth") return flows.bluetooth()
        if (id === "_install") return flows.usbFlow("install")
        if (id === "_recover") return flows.usbFlow("recover")
        if (id === "_desktop") return flowDesktop()
        if (id === "_fullludus") return confirmYes("Go back to the full Ludus?", "Go back").then(function (y) { if (y) session.useFullLudus() })
        setStatus("This setting comes to this version next. It's in the full Ludus (Settings › Go back to the full Ludus).")
    }
    function flowPower() {
        var ask = { restart: ["Restart the console?", "Restart"], shutdown: ["Shut the console down?", "Shut down"] }
        pick("Power", [{ label: "Sleep", sub: "Wake it with the controller", op: "sleep" }, { label: "Restart", op: "restart" }, { label: "Shut down", op: "shutdown" }, { label: "Back", op: "" }]).then(function (it) {
            if (!it || !it.op) return
            var go = ask[it.op] ? confirmYes(ask[it.op][0], ask[it.op][1]) : Promise.resolve(true)
            go.then(function (y) {
                if (!y) return
                gated(function () { return api.call("power", [it.op]) }).then(function (r) {
                    if (r.canceled) return
                    if (r.ok === false) return setStatus(r.error || "That did not work.", true)
                    if (it.op !== "sleep") notice(it.op === "restart" ? "Restarting…" : "Shutting down…", it.op === "restart" ? "The console is restarting. This takes a moment." : "The console is shutting down.")
                })
            })
        })
    }
    function flowDesktop() {
        confirmYes(session.inSession ? "Switch to Opus?  Ludus will close and the login screen will appear (choose Opus there).  To come back later, choose Return to Ludus in the application menu."
                                     : "Switch to Opus?  Ludus will close and the desktop will be shown again.", "Switch").then(function (y) { if (y) { setStatus("Closing Tessera…"); session.goToOpus() } })
    }
    property var rows: []
    function currentRows() {
        var base = baseRows()
        if (th.mode === "rails" || (page === "home" && !stack.length) || (page === "settings" && !stack.length)) return base
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
    // the short live notes under Wi-Fi, Bluetooth and Sound (screens.js refreshTileNotes)
    property var tileNotes: ({ wifi: "", bluetooth: "", audio: "" })
    property double notesAt: 0
    property bool notesBusy: false
    function refreshTileNotes(force) {
        if (notesBusy || (!force && Date.now() - notesAt < 15000)) return
        notesBusy = true
        notesAt = Date.now()
        api.call("summaries", []).then(function (r) {
            notesBusy = false
            if (!r || r.ok === false) return
            var txt = function (v) { return typeof v === "string" ? v.slice(0, 40) : "" }
            var next = { wifi: txt(r.wifi), bluetooth: txt(r.bluetooth), audio: txt(r.audio) }
            if (JSON.stringify(next) === JSON.stringify(tileNotes)) return
            tileNotes = next
            if (page === "settings" && !stack.length) Qt.callLater(refresh)
        })
    }
    function rawCall(ch, args) { return api.call(ch, args) }
    function menuCancel() { if (menu.visible) menu.press("b") }
    function menuUp() { return menu.visible || keyboard.visible || wheel.visible || calib.visible || job !== null }
    function reloadPrefs() {      // what the tile notes read (the PIN being on or off) after a flow changed it
        dev("settings", "pinStatus").then(function (r) {
            if (r && r.set !== undefined) applyView(Object.assign({}, view, { prefs: Object.assign({}, view.prefs, { pin: r }) }))
        })
    }
    function goHome() {       // after switching who is playing: their Home, cursor on it
        stack = []
        var i = tabList.findIndex(function (t) { return t.id === "home" })
        tabIndex = Math.max(0, i)
        area = "content"
        refresh()
    }
    function applyTheme(t) { if (t) applyView(Object.assign({}, view, { prefs: Object.assign({}, view.prefs, { theme: t }) })) }
    function holdMenu(ms) { menu.holdUntil = Date.now() + ms }
    function pickColor(title, start) { return new Promise(function (resolve) { wheel.open(title, start, resolve) }) }
    // the guided tour: where its ring goes, and where to land when it ends
    function tourRect(what) {
        var r = null
        if (what === "tabs") {
            var bar = tabBarA.visible && tabBarA.width > 0 ? tabBarA : tabBarB
            var p = bar.mapToItem(win.contentItem, 0, 0)
            r = { x: p.x, y: p.y, w: bar.width, h: bar.height }
        } else if (what.indexOf("tab:") === 0) {
            var k = tabList.findIndex(function (t) { return t.id === what.slice(4) })
            var bar2 = tabBarA.visible && tabBarA.width > 0 ? tabBarA : tabBarB
            r = k >= 0 ? bar2.itemRect(k, win.contentItem) : null
        } else if (what === "page") {
            var q = viewport.mapToItem(win.contentItem, 0, 0)
            r = { x: q.x, y: q.y, w: viewport.width, h: viewport.height }
            // hug the tiles that are really on screen (like the full Ludus), else the page area
            var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, n = 0
            var walk = function (it) {
                for (var k = 0; k < it.children.length; k++) {
                    var c = it.children[k]
                    if (!c.visible || c.opacity < 0.05) continue
                    if (c.objectName === "tile") {
                        var p = c.mapToItem(win.contentItem, 0, 0)
                        if (c.width > 4 && c.height > 4 && p.x + c.width > r.x && p.x < r.x + r.w && p.y + c.height > r.y && p.y < r.y + r.h) {
                            x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + c.width); y1 = Math.max(y1, p.y + c.height); n++
                        }
                    } else walk(c)
                }
            }
            walk(viewport)
            if (n) r = { x: Math.max(r.x, x0), y: Math.max(r.y, y0), w: Math.min(r.x + r.w, x1) - Math.max(r.x, x0), h: Math.min(r.y + r.h, y1) - Math.max(r.y, y0) }
        } else if (what === "footer") {
            var f = footerA.visible ? footerA : footerB
            var fp = f.mapToItem(win.contentItem, 0, 0)
            r = { x: fp.x, y: fp.y, w: f.width, h: f.height }
        }
        return r
    }
    // layout numbers for the side-by-side checks (qa/theme-shots.cjs writes the same for the full Ludus)
    function geom(theme) {
        var bar = tabBarA.visible && tabBarA.width > 0 ? tabBarA : tabBarB
        var cur = bar.itemRect(tabIndex, win.contentItem), nav = bar.mapToItem(win.contentItem, 0, 0)
        var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, sel = null
        var walk = function (it) {
            for (var k = 0; k < it.children.length; k++) {
                var c = it.children[k]
                if (!c.visible || c.opacity < 0.05) continue
                if (c.objectName === "tile") {
                    var p = c.mapToItem(win.contentItem, 0, 0)
                    if (c.width > 4 && p.x + c.width > 0 && p.x < win.width && p.y + c.height > 0 && p.y < win.height) {
                        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + c.width); y1 = Math.max(y1, p.y + c.height)
                        if (c.picked) sel = { x: Math.round(p.x), y: Math.round(p.y), w: Math.round(c.width), h: Math.round(c.height) }
                    }
                } else walk(c)
            }
        }
        walk(viewport)
        var f = footerA.visible ? footerA : footerB, fp = f.mapToItem(win.contentItem, 0, 0)
        var vp = viewport.mapToItem(win.contentItem, 0, 0)
        console.log("VIEWPORT " + theme + " y=" + Math.round(vp.y) + " h=" + Math.round(viewport.height) + " oneRow=" + viewport.oneRow + " rows=" + win.rows.length + " selRow=" + win.selRow + " header=" + Math.round(header.y) + "+" + Math.round(header.height) + " clockTop=" + Math.round(clockTop.height))
        console.log("GEOM " + theme + " " + JSON.stringify({ tab: cur && { x: Math.round(cur.x), y: Math.round(cur.y), w: Math.round(cur.w), h: Math.round(cur.h) }, tabs: { x: Math.round(nav.x), y: Math.round(nav.y), w: Math.round(bar.width), h: Math.round(bar.height) },
            tiles: x0 < 1e8 ? { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } : null, sel: sel, footer: { x: Math.round(fp.x), y: Math.round(fp.y), w: Math.round(f.width), h: Math.round(f.height) } }))
    }
    function tourBack(b) {
        if (!b) return
        var k = Math.min(b.tab, tabList.length - 1)
        if (k >= 0 && k !== tabIndex) goTab(k)
        area = b.area || "tabs"
    }
    function tourLibrary() {
        pick("Your games", [
            { label: "Link a library drive or folder…", sub: "Tessera looks there for games", op: "roots" },
            { label: "Scan for games now", sub: "Steam, Heroic, Lutris and your library folders", op: "scan" }
        ]).then(function (it) { if (!it) return; if (it.op === "roots") flows.roots(); else flows.scan() })
    }
    function runTour() { if (!menu.visible && !browserOpen) tourView.open() }
    function systemInfo() { return api.systemInfo() }
    function goSettings() { var i = tabList.findIndex(function (t) { return t.id === "settings" }); if (i >= 0) { goTab(i); area = "content" } }
    function dismissAll() { if (menu.visible) menu.close(); live = null }
    function dev(ch, op, p) { return safe(api.call(ch, [op, p || {}])) }
    function refresh() {
        if (page === "settings" && ready) refreshTileNotes(false)
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
    Connections { target: th; function onModeChanged() { Qt.callLater(win.refresh) } }
    onGridNowChanged: Qt.callLater(refresh)
    readonly property var selTile: rows.length && rows[selRow] ? rows[selRow].tiles[selCol] || null : null

    function goTab(i) {
        arrive.stop()
        tabIndex = (i + tabList.length) % tabList.length
        stack = []
        refresh()
    }

    // ---------------------------------------------------------------- the browser (browserTab.js)
    function normalizeUrl(v) {
        var t = (v || "").trim()
        if (!t) return null
        if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t                        // already has a scheme
        if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) return "https://" + t     // looks like a bare address
        return "https://duckduckgo.com/?q=" + encodeURIComponent(t)              // treat it as a search
    }
    // a browser request that may need the PIN, or the profile's own PIN, or be refused for Guest: asks and tries again
    function browserCall(op, p) {
        var go = function () { return safe(api.call("browser", [op, p || {}])) }
        return go().then(function (r) {
            if (r.needPin) return requirePin().then(function (ok) { return ok ? go() : { ok: false, canceled: true, error: "" } })
            if (r.needProfilePin) return flows.profilePin(r.name, function (pin) { return safe(api.call("profiles", ["unlock", { id: r.id, pin: pin }])) })
                .then(function (u) { return u ? go() : { ok: false, canceled: true, error: "" } })
            return r
        })
    }
    // dir: +1 when you travelled right to get here (RB), -1 when left (LB)
    function openBrowser(dir, url) {
        if (url) browserUrl = url
        if (browserOpen || browserOpening || browser.moving) return Promise.resolve(false)
        browserOpening = true
        return api.call("__qt", ["browserProfile"]).then(function (pid) {
            browser.profileId = pid || ""
            return api.call("__qt", ["downloads"])
        }).then(function (dl) {
            browser.downloadDir = dl || ""
            return browserCall(url ? "go" : "open", { url: browserUrl })
        }).then(function (r) {
            browserOpening = false
            if (!r || !r.ok) {
                if (!r || !r.canceled) setStatus((r && r.error) || "Couldn't open the browser.", true)
                return false
            }
            browser.prepare()
            browser.enter(dir || 1)
            browserOpen = true
            browserInput.setActive(true)
            setStatus("")
            browser.focusPage()
            return true
        })
    }
    function closeBrowser(dir) {
        if (!browserOpen || browser.moving) return Promise.resolve()
        browserOpen = false
        browserInput.setActive(false)
        browserQuiet = Date.now() + 300
        return api.call("browser", ["close"]).then(function () { browser.leave(dir || -1) })
    }
    // the Browser tab, then the page at this address (a report on GitHub, a shard's link)
    function openInBrowser(url) {
        var i = tabList.findIndex(function (t) { return t.id === "browser" })
        if (i >= 0) { goTab(i); area = "tabs" }
        return openBrowser(1, url)
    }
    // someone else is playing: the page goes before they pick it up
    function leaveBrowser() { return browserOpen ? closeBrowser(-1) : Promise.resolve() }
    function openUrlBar() {
        if (!browserOpen || browser.moving || keyboard.visible) return
        keys.forceActiveFocus()
        // the page steps aside while the address is typed (its pointer stops, the screen's own pad reader has the buttons)
        api.call("browser", ["hide"]).then(function () {
            return ask("Go to", browser.st.url || browserUrl, { max: 300, url: true, selectAll: true, doneLabel: "Go" })
        }).then(function (v) {
            var u = v === null ? null : normalizeUrl(v)
            if (!u) { browser.focusPage(); return api.call("browser", ["show"]) }
            return browserCall("go", { url: u }).then(function (r) {
                if (!r || !r.ok) { closeBrowser(-1); if (!r || !r.canceled) setStatus((r && r.error) || "Couldn't open that address.", true) }
                else { browserUrl = u; browser.focusPage() }
            })
        })
    }
    // what the main process's browser code asks of the screen: B closes, LB / RB close and move on, Y is the address
    function browserAct(a) {
        if (!browserOpen || keyboard.visible) return
        if (browser.moving) { if ((a === "lb" || a === "rb") && queuedTabs.length < 6) queuedTabs = queuedTabs.concat([a]); return }
        if (a === "y") return openUrlBar()
        if (a === "b") return closeBrowser(-1)
        if (a === "lb" || a === "rb") {
            var d = a === "lb" ? -1 : 1
            closeBrowser(d)
            goTab(tabIndex + d)
            area = "tabs"
        }
    }
    Timer { id: arrive; property int dir: 1; interval: 250; onTriggered: if (page === "browser" && area === "tabs" && !browserOpen && !keyboard.visible && !menu.visible && !wheel.visible && !calib.visible && !place) openBrowser(dir) }
    // ---------------------------------------------------------------- the mouse (input.js)
    property var kbPrefs: ({})
    // ---- keyboard: the saved key layout (Keyboard & mouse), looked up by the key's name (KeyboardEvent.code, as the full Ludus does)
    property var kbMap: ({ ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right", Enter: "a", NumpadEnter: "a", Space: "a", Escape: "b", Backspace: "b", KeyX: "x", KeyY: "y", ContextMenu: "y", PageUp: "lb", PageDown: "rb", BracketLeft: "lb", BracketRight: "rb", F1: "guide", Home: "guide" })
    property var keyCap: null
    property string kbSeen: ""
    // ---- Qt counterparts of the full Ludus's QA checks (ludus.py --qa): small questions about what the screen is doing
    property string qaOut: ""
    function qaProbe(name) {
        if (name === "tab") qaOut = tabIndex + "/" + area
        else if (name === "guide") qaOut = (flows.guideOn ? "open" : "closed") + "/" + menu.gstyle
        else if (name === "menu") qaOut = menu.visible ? "open" : "closed"
        else if (name === "keys") qaOut = JSON.stringify([kbMap.KeyW || "", kbMap.KeyA || "", kbMap.ArrowLeft || "", kbMap.Space || ""])
        else if (name === "key") qaOut = codeOf(qaKey)
        else qaOut = "?"
    }
    property var qaKey: ({ key: 0, nativeScanCode: 0, modifiers: 0 })
    property string shotGuide: ""        // picture runs only: draw the guide in this style
    readonly property var keyNames: (function () {
        var t = {}
        t[Qt.Key_Left] = "ArrowLeft"; t[Qt.Key_Right] = "ArrowRight"; t[Qt.Key_Up] = "ArrowUp"; t[Qt.Key_Down] = "ArrowDown"
        t[Qt.Key_Return] = "Enter"; t[Qt.Key_Space] = "Space"; t[Qt.Key_Escape] = "Escape"; t[Qt.Key_Backspace] = "Backspace"
        t[Qt.Key_PageUp] = "PageUp"; t[Qt.Key_PageDown] = "PageDown"; t[Qt.Key_Home] = "Home"; t[Qt.Key_End] = "End"
        t[Qt.Key_Insert] = "Insert"; t[Qt.Key_Delete] = "Delete"; t[Qt.Key_Tab] = "Tab"; t[Qt.Key_Menu] = "ContextMenu"
        t[Qt.Key_BracketLeft] = "BracketLeft"; t[Qt.Key_BracketRight] = "BracketRight"; t[Qt.Key_Semicolon] = "Semicolon"
        t[Qt.Key_Apostrophe] = "Quote"; t[Qt.Key_Comma] = "Comma"; t[Qt.Key_Period] = "Period"; t[Qt.Key_Slash] = "Slash"
        t[Qt.Key_Backslash] = "Backslash"; t[Qt.Key_Minus] = "Minus"; t[Qt.Key_Equal] = "Equal"; t[Qt.Key_QuoteLeft] = "Backquote"
        t[Qt.Key_Back] = "BrowserBack"; t[Qt.Key_Forward] = "BrowserForward"; t[Qt.Key_HomePage] = "BrowserHome"; t[Qt.Key_Search] = "BrowserSearch"
        t[Qt.Key_MediaPlay] = "MediaPlayPause"; t[Qt.Key_MediaTogglePlayPause] = "MediaPlayPause"; t[Qt.Key_MediaNext] = "MediaTrackNext"; t[Qt.Key_MediaPrevious] = "MediaTrackPrevious"
        t[Qt.Key_MediaStop] = "MediaStop"
        for (var i = 0; i < 26; i++) t[Qt.Key_A + i] = "Key" + String.fromCharCode(65 + i)
        for (i = 0; i < 10; i++) t[Qt.Key_0 + i] = "Digit" + i
        for (i = 1; i <= 24; i++) t[Qt.Key_F1 + i - 1] = "F" + i
        return t
    })()
    // The key's place on the keyboard (what the full Ludus binds), so a binding keeps working on AZERTY,
    // Dvorak and the rest. Qt reports the place as the scan code: the Linux key number plus an offset
    // (8 with the usual key tables); the offset is learned from keys every layout has in the same place.
    property int scanOff: 8
    readonly property var placeNames: (function () {
        var t = { 1: "Escape", 12: "Minus", 13: "Equal", 14: "Backspace", 15: "Tab", 26: "BracketLeft", 27: "BracketRight", 28: "Enter", 39: "Semicolon", 40: "Quote", 41: "Backquote",
                  43: "Backslash", 51: "Comma", 52: "Period", 53: "Slash", 57: "Space", 69: "NumLock", 71: "Numpad7", 72: "Numpad8", 73: "Numpad9", 75: "Numpad4", 76: "Numpad5", 77: "Numpad6",
                  79: "Numpad1", 80: "Numpad2", 81: "Numpad3", 82: "Numpad0", 87: "F11", 88: "F12", 96: "NumpadEnter", 102: "Home", 103: "ArrowUp", 104: "PageUp", 105: "ArrowLeft",
                  106: "ArrowRight", 107: "End", 108: "ArrowDown", 109: "PageDown", 110: "Insert", 111: "Delete", 139: "ContextMenu", 158: "BrowserBack", 159: "BrowserForward",
                  163: "MediaTrackNext", 164: "MediaPlayPause", 165: "MediaTrackPrevious", 166: "MediaStop", 172: "BrowserHome", 217: "BrowserSearch" }
        var i, d = 1
        for (i = 2; i <= 10; i++) t[i] = "Digit" + d++
        t[11] = "Digit0"
        "QWERTYUIOP".split("").forEach(function (c, j) { t[16 + j] = "Key" + c })
        "ASDFGHJKL".split("").forEach(function (c, j) { t[30 + j] = "Key" + c })
        "ZXCVBNM".split("").forEach(function (c, j) { t[44 + j] = "Key" + c })
        for (i = 0; i < 10; i++) t[59 + i] = "F" + (i + 1)
        return t
    })()
    function codeOf(e) {
        var sc = e.nativeScanCode
        if (sc > 0) {
            if (e.key === Qt.Key_Escape) scanOff = sc - 1
            else if (e.key === Qt.Key_Space) scanOff = sc - 57
            else if (e.key === Qt.Key_Return && !(e.modifiers & Qt.KeypadModifier)) scanOff = sc - 28
            var place = placeNames[sc - scanOff]
            if (place) return place
        }
        return nameOf(e)
    }
    function nameOf(e) {
        var pad = (e.modifiers & Qt.KeypadModifier) !== 0
        if (pad && e.key >= Qt.Key_0 && e.key <= Qt.Key_9) return "Numpad" + (e.key - Qt.Key_0)
        if (pad && (e.key === Qt.Key_Return || e.key === Qt.Key_Enter)) return "NumpadEnter"
        if (pad && (e.key === Qt.Key_Left || e.key === Qt.Key_Right || e.key === Qt.Key_Up || e.key === Qt.Key_Down)) return keyNames[e.key]
        if (e.key === Qt.Key_Enter) return "NumpadEnter"
        return keyNames[e.key] || ""
    }
    function loadKb() {
        rawCall("__qt", ["kb"]).then(function (k) {
            if (!k || !k.bindings) return
            var m = {}
            Object.keys(k.bindings).forEach(function (a) { (k.bindings[a] || []).forEach(function (c) { if (!m[c]) m[c] = a }) })
            kbMap = m
        })
    }
    function endKeyCap(code) { var c = keyCap; if (!c) return; keyCap = null; if (menu.visible) menu.close(); c(code) }
    // waits for the next key and hands back its name (null: cancelled with Esc or Cancel)
    function captureKey(label) {
        return new Promise(function (resolve) {
            keyCap = resolve
            menu.open("Press a key", [{ label: "Cancel", plain: true }], function () { endKeyCap(null) }, 0, function () { endKeyCap(null) }, { body: "Press the key to use for " + label + ". Esc or Cancel to stop." })
            sleepMs(15000).then(function () { if (keyCap === resolve) endKeyCap(null) })
        })
    }
    property bool mouseOn: false           // the pointer shows while it is being used, and hides after a few seconds (Settings > Keyboard & mouse)
    property var hoverHold: null            // { until, id }: after a choice slides the row, leave the pointer alone for a moment
    Timer { id: mouseHide; onTriggered: win.mouseOn = false }
    function mouseSeen() {
        mouseOn = true
        var secs = kbPrefs && isFinite(kbPrefs.mouseHide) ? kbPrefs.mouseHide : 3
        if (secs > 0) { mouseHide.interval = secs * 1000; mouseHide.restart() } else mouseHide.stop()
    }
    function pointerBusy() { return menuUp() || tourView.visible || tourView.away || gripView.visible || padTestView.visible || captureView.visible || calib.visible || browserOpen || browserOpening || place || !ready }
    function pointTile(r, c, id) {
        mouseSeen()
        if (pointerBusy()) return
        if (hoverHold) { if (Date.now() > hoverHold.until || hoverHold.id === id) hoverHold = null; else return }
        if (area === "content" && selRow === r && selCol === c) return
        area = "content"
        setSel(r, c)
        if (th.mode === "rails" || th.mode === "flow") hoverHold = { until: Date.now() + 2400, id: id }
    }
    function clickTile(r, c) {
        mouseSeen()
        if (pointerBusy()) return
        hoverHold = null
        area = "content"
        setSel(r, c)
        act("a")
    }
    function clickTab(i) {
        mouseSeen()
        if (pointerBusy()) return
        var from = tabIndex
        area = "tabs"
        goTab(i)
        if (page === "browser" || page === "new") act("a")
    }
    function wheelPress(dx, dy) {
        mouseSeen()
        var how = kbPrefs && kbPrefs.wheel ? kbPrefs.wheel : "move"
        if (how === "off" || pointerBusy() && !menuUp()) return
        var ax = Math.abs(dx) > Math.abs(dy), d = ax ? dx : dy
        if (!d) return
        var now = Date.now()
        if (now - wheelAt < 140) return
        wheelAt = now
        if (how === "tabs" && !menuUp() && !ax) return act(d < 0 ? "rb" : "lb")
        act(ax ? (d < 0 ? "right" : "left") : (d < 0 ? "down" : "up"))
    }
    property double wheelAt: 0
    function setSel(r, c) {
        var cc = cur()
        cc.row = r
        if (rows[r]) cc.cols[rows[r].id] = c
        refresh()
    }

    // ---------------------------------------------------------------- input
    // Hold Y for 3 seconds on a mosaic tab to pick it up, then move it with left/right; any other press puts it down (input.js)
    property string reorderId: ""
    property bool yTap: false
    Timer {
        id: liftTimer
        interval: 3000
        onTriggered: {
            win.yTap = false
            var id = win.liftTarget()
            if (!id || menuUp()) return
            win.area = "tabs"
            win.reorderId = id
        }
    }
    function liftTarget() {
        var id = area === "tabs" ? (tabList[tabIndex] ? tabList[tabIndex].id : "") : page
        return (view.tabOrder || []).indexOf(id) >= 0 && !stack.length ? id : ""
    }
    function yUp() {
        var pending = liftTimer.running
        liftTimer.stop()
        if (yTap && pending) { yTap = false; act("y", true) }
        yTap = false
    }
    function reorderPress(a) {
        if (a === "left" || a === "right") {
            var id = reorderId
            dev("library", "moveTab", { id: id, dir: a === "left" ? -1 : 1 }).then(function (r) {
                if (r && r.view) applyView(r.view)
                var k = tabList.findIndex(function (t) { return t.id === id }); if (k >= 0) tabIndex = k
            })
            return
        }
        reorderId = ""
    }
    // the screen's own code calls act(a, tapped); a call from outside (ludus.py, which can only pass one thing) comes here
    function padAct(a) { act(a, false) }
    function act(a, tapped) {
        if (a === "yup") return yUp()
        if (!ready) return
        if (captureView.visible) return captureView.press(a)
        if (tourView.visible || tourView.away) return tourView.press(a)
        if (gripView.visible) return gripView.press(a)
        if (padTestView.visible) return padTestView.press(a)
        if (calib.visible) return calib.press(a)
        if (wheel.visible) return wheel.press(a)
        if (keyboard.visible) return keyboard.press(a)
        if (menu.visible) return menu.press(a)
        if (browserOpen || browserOpening || browser.moving || Date.now() < browserQuiet) return    // the page has the controller (the main process reads it for the page)
        if (place) return placePress(a)
        if (reorderId) return reorderPress(a)
        if (a === "y" && !tapped && liftTarget()) { yTap = true; liftTimer.restart(); return }
        if (a === "lb" || a === "rb") {
            var bd = a === "lb" ? -1 : 1
            goTab(tabIndex + bd); area = "tabs"
            if (page === "browser") { arrive.dir = bd; arrive.restart() }     // staying on it a moment opens it
            return
        }
        var entry = th.contentEntry
        var exit = { down: "up", up: "down", right: "left" }[entry]
        if (area === "tabs") {
            var prev = th.vertical ? "up" : "left", next = th.vertical ? "down" : "right"
            if (a === prev) return goTab(tabIndex - 1)
            if (a === next) return goTab(tabIndex + 1)
            if (a === entry || a === "a") {
                if (page === "new") return newMosaic()
                if (page === "browser") return openBrowser(1)
                area = "content"
                return
            }
            if (a === "y" && !buttonTab) return openOptions(true)
            return
        }
        if (homeMode && (a === "left" || a === "right" || a === "up" || a === "down") && selTile && selTile.kind === "inlay") return homeMove(a, exit)
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
            if (keyCap) { var cc = win.codeOf(e); e.accepted = true; if (cc && !e.isAutoRepeat) win.endKeyCap(cc === "Escape" ? null : cc); return }
            var act0 = win.kbMap[win.codeOf(e)]
            var m = {}
            if (act0) m[e.key] = act0
            if (keyboard.visible) {
                if (e.key === Qt.Key_Return || e.key === Qt.Key_Enter) { keyboard.finish(true); e.accepted = true; return }
                if (e.key === Qt.Key_Escape) { keyboard.finish(false); e.accepted = true; return }
                if (e.key === Qt.Key_Backspace) { keyboard.typed = keyboard.fresh ? "" : keyboard.typed.slice(0, -1); keyboard.fresh = false; e.accepted = true; return }
                if (e.text && e.text.length === 1 && e.text >= " " && e.key !== Qt.Key_Return && e.key !== Qt.Key_Enter) { if (keyboard.fresh) { keyboard.typed = ""; keyboard.fresh = false } keyboard.typed += e.text; e.accepted = true; return }
            }
            if (m[e.key] === "guide") { if (!e.isAutoRepeat) flows.guideEvent({}); e.accepted = true; return }
            if (m[e.key] !== undefined) { if (!(e.isAutoRepeat && m[e.key] === "y")) act(m[e.key]); e.accepted = true }
        }
        Keys.onReleased: function (e) { if (win.kbMap[win.codeOf(e)] === "y" && !e.isAutoRepeat) { act("yup"); e.accepted = true } }
    }
    Component.onCompleted: {
        if (guideOnly) { x = Screen.virtualX; y = Screen.virtualY; width = Screen.desktopAvailableWidth; height = Screen.desktopAvailableHeight }
        refresh(); keys.forceActiveFocus()
    }

    // ---------------------------------------------------------------- doing things
    function activate() {
        var t = selTile
        if (!t) return
        if (t.kind === "folder") { stack = stack.concat([t.id]); refresh(); return }
        if (t.kind === "add") return addSomething()
        if (t.kind === "action") return runAction(t.id)
        if (t.kind === "inlay") return openOptions(false)     // widgets are display-only; A offers move / resize / remove
        if (t.offline) return setStatus(t.offline === "drive" ? t.title + " is on a drive that isn't plugged in."
                                                              : t.title + "'s files can't be found. Settings > Storage > Clean up can remove broken entries.", true)
        api.launch(t.id)
    }
    // Spatial movement between widgets, by where they sit on the grid (home.js homeMove)
    function homeMove(dir, exit) {
        var tiles = rows[0].tiles, i = selCol, from = tiles[i], best = -1, bestScore = 1e9
        var fx = from.x + from.w / 2, fy = from.y + from.h / 2
        tiles.forEach(function (o, n) {
            if (n === i || o.kind !== "inlay") return
            var dx = o.x + o.w / 2 - fx, dy = o.y + o.h / 2 - fy
            var along = dir === "left" ? -dx : dir === "right" ? dx : dir === "up" ? -dy : dy
            var across = dir === "left" || dir === "right" ? Math.abs(dy) : Math.abs(dx)
            if (along <= 0) return
            var score = along + across * 2
            if (score < bestScore) { best = n; bestScore = score }
        })
        if (best >= 0) return setSel(0, best)
        if (dir === exit) area = "tabs"
    }
    // ---- placing a widget: move it with the D-pad, X switches to resizing, A drops it, B cancels
    function startPlace(p) { place = Object.assign({ mode: "move", bad: false }, p); area = "content"; checkPlace() }
    function overlaps(a, b) { return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h }
    function widgetsOnHome() { return ((view.folders._home || {}).tiles || []).filter(function (t) { return t.kind === "inlay" }) }
    function checkPlace() {
        var p = place
        p.bad = widgetsOnHome().some(function (o) { return o.id !== p.id && overlaps(p, o) })
        place = Object.assign({}, p)
        var def = p.def
        setStatus("D-pad " + (p.mode === "move" ? "moves" : "resizes") + (def.resizable ? "  ·  X: " + (p.mode === "move" ? "resize" : "move") : "  ·  fixed size") + "  ·  A place  ·  B cancel")
    }
    function placePress(a) {
        var p = Object.assign({}, place), d = ({ left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] })[a]
        if (d) {
            if (p.mode === "move") { p.x = Math.max(0, Math.min(12 - p.w, p.x + d[0])); p.y = Math.max(0, Math.min(6 - p.h, p.y + d[1])) }
            else {
                p.w = Math.max(p.def.min.w, Math.min(Math.min(p.def.max.w, 12 - p.x), p.w + d[0]))
                p.h = Math.max(p.def.min.h, Math.min(Math.min(p.def.max.h, 6 - p.y), p.h + d[1]))
            }
            place = p
            return checkPlace()
        }
        if (a === "x") { if (p.def.resizable) { p.mode = p.mode === "move" ? "size" : "move"; place = p; checkPlace() } return }
        if (a === "b") { place = null; setStatus(""); return }
        if (a === "a") {
            var rect = { x: p.x, y: p.y, w: p.w, h: p.h }
            var op = p.id ? api.library("placeInlay", Object.assign({ id: p.id }, rect)) : api.library("addInlay", Object.assign({ catId: "_home", type: p.type }, rect))
            op.then(function (r) { if (r.ok !== false) { place = null; setStatus("") } else checkPlace() })
        }
    }
    function firstFree(w, h) {
        var others = widgetsOnHome()
        for (var y = 0; y + h <= 6; y++)
            for (var x = 0; x + w <= 12; x++)
                if (!others.some(function (o) { return overlaps({ x: x, y: y, w: w, h: h }, o) })) return { x: x, y: y }
        return { x: 0, y: 0 }
    }
    // Nothing is added for you: pick a preset or an installed widget.
    function addWidget() {
        api.addons("list").then(function (info) {
            if (!info || !info.presets) return setStatus("Couldn't read the widgets.", true)
            var sub = function (d, kind) { return [d.description || kind, d.size.w + " × " + d.size.h, d.resizable ? "resizable" : ""].filter(Boolean).join(" · ") }
            var items = info.presets.map(function (p) { return { label: p.name, sub: sub(p, "preset"), def: p } })
                .concat(info.widgets.map(function (w) { return { label: w.name, sub: sub(w, "widget"), def: w } }))
                .concat([{ label: "↻  Reload add-ons", reload: true }])
            menu.open("Add a widget", items, function (it) {
                if (it.reload) return api.addons("rescan").then(addWidget)
                var d = it.def, at = firstFree(d.size.w, d.size.h)
                startPlace({ type: d.type, name: d.name, def: d, x: at.x, y: at.y, w: d.size.w, h: d.size.h })
            })
        })
    }
    function placeExisting(t) {
        startPlace({ id: t.id, name: t.title, def: { size: { w: t.w, h: t.h }, min: t.min, max: t.max, resizable: t.resizable }, x: t.x, y: t.y, w: t.w, h: t.h })
    }
    // What "+" offers depends on where it is (flows.js flowAdd); the flows themselves are in Flows.qml
    function addSomething() {
        flows.add(pageCat ? { catId: pageCat } : { tab: page, kind: page === "apps" ? "app" : "game" })
    }
    function newFolder(parentId) {
        return ask("Name your folder", "").then(function (name) { return name === null ? null : api.library("newCategory", { title: name, parentId: parentId }) })
    }
    function newMosaic() {
        return ask("Name your mosaic", "").then(function (name) {
            if (name === null) return null
            return api.library("newCategory", { title: name }).then(function (r) {
                if (r && r.ok && r.id) {
                    var i = tabList.findIndex(function (x) { return x.id === "m:" + r.id })
                    if (i >= 0) goTab(i)
                    stack = []
                    area = "content"
                }
                return r
            })
        })
    }
    function leaveFolder() { stack = stack.slice(0, -1) }
    function leavePage() { area = "tabs" }
    function openOptions(fromTabs) {
        var t = fromTabs || !selTile || selTile.kind === "add" ? null : selTile
        flows.options({
            t: t, catId: pageCat, catTitle: folderTitle(pageCat), inFolder: stack.length > 0, homeMode: homeMode, mode: th.mode,
            grid: gridNow, ownGrid: Boolean(view.prefs && view.prefs.pageGrid && view.prefs.pageGrid[pageKey]), pageKey: pageKey, page: page
        })
    }
    readonly property string titleText: area !== "content" && !tour.visible
        ? (page === "new" ? "Press A to create a mosaic" : page === "browser" ? "Press A to open your browser" : tabName(page))
        : (selTile && !selTile.big ? selTile.title : "")

    // ================================================================ the screen
    // everything you see, in one item, so the display calibration can be drawn over all of it
    MouseArea {     // the rest of the mouse: right click = back, middle = options, side buttons, the wheel
        anchors.fill: parent
        z: -1
        acceptedButtons: Qt.RightButton | Qt.MiddleButton | Qt.BackButton | Qt.ForwardButton
        hoverEnabled: true
        cursorShape: win.mouseOn ? Qt.ArrowCursor : Qt.BlankCursor
        onPositionChanged: win.mouseSeen()
        onPressed: function (e) {
            win.mouseSeen()
            if (!win.ready || win.browserOpen) return
            if (e.button === Qt.RightButton || e.button === Qt.BackButton) win.act("b")
            else if (e.button === Qt.ForwardButton && !win.menuUp()) win.act("rb")
            else if (e.button === Qt.MiddleButton) win.act("y")
        }
        onWheel: function (e) { win.wheelPress(e.angleDelta.x, e.angleDelta.y) }
    }
    Item {
        visible: !guideOnly
        id: stage
        anchors.fill: parent
        layer.enabled: win.calOn && calShader !== ""
        layer.effect: ShaderEffect {
            property variant source
            property vector4d gamma: win.calNow ? Qt.vector4d(win.calNow.gamma[0], win.calNow.gamma[1], win.calNow.gamma[2], 1) : Qt.vector4d(1, 1, 1, 1)
            property vector4d gain: win.calNow ? Qt.vector4d(win.calNow.gain[0], win.calNow.gain[1], win.calNow.gain[2], 1) : Qt.vector4d(1, 1, 1, 1)
            property real black: win.calNow ? win.calNow.black : 0
            property real white: win.calNow ? win.calNow.white : 1
            property real sat: win.calNow ? win.calNow.sat : 1
            fragmentShader: calShader
        }
    Backdrop {
        visible: !guideOnly
        anchors.fill: parent
        th: th
        picture: win.picture
        spotArt: win.selTile && win.selTile.art === true ? "image://art/" + encodeURIComponent(win.selTile.id) + "?" + win.artRev : ""
    }

    // "Screen area used": everything inside a safe area (TVs that crop the edges)
    Item {
        visible: !guideOnly
        id: body
        anchors.fill: parent
        anchors.topMargin: (1 - th.use) * win.height / 2
        anchors.bottomMargin: anchors.topMargin
        anchors.leftMargin: (1 - th.use) * win.width / 2
        anchors.rightMargin: anchors.leftMargin
        // "focus" with the menu along the bottom: title, row and menu stay together, centred between the clock and the hints
        readonly property bool packed: th.parts.row === "focus" && th.mode === "rails" && win.page !== "new" && !win.homeMode && th.parts.nav === "bottom" && th.parts.title === "above"
        readonly property real packedGap: 48      // style.css: the menu sits this far below the row
        readonly property real packedTop: clockTop.height + Math.max(0, (body.height - (5.1 * th.rem - 10) - clockTop.height - titleAbove.height - viewport.Layout.preferredHeight - body.packedGap - header.height) / 2)
        readonly property real sideW: th.parts.tabs === "chunky" ? th.clamp(190, 21 * th.vw, 360) : th.clamp(178, 18 * th.vw, 320)

        // ---- the menu: a column on the left, or a strip across the top / bottom
        Item {
            id: header
            readonly property string nav: th.parts.nav
            readonly property bool hints: ["pills", "segments"].indexOf(th.parts.tabs) >= 0 || nav === "bottom-bar"
            readonly property real headerPad: nav === "bottom-dock" ? th.clamp(8, 1.3 * th.vh, 16) : nav === "top" || nav === "top-left" ? (th.parts.tabs === "segments" ? th.clamp(8, 1.6 * th.vh, 20) : 18) : th.clamp(6, 1.6 * th.vh, 18)
            // style.css: header padding 28 + the tab port's margin -22 and padding 36 put a pill 42px down, and 22px of room under it
            readonly property bool plainTop: nav === "top" && ["pills", "text", "pivots"].indexOf(th.parts.tabs) >= 0
            readonly property real topPad: plainTop ? 42 : th.parts.tabs === "segments" && (nav === "top" || nav === "top-left") ? headerPad + 6 : nav === "top-left" && th.parts.tabs !== "segments" ? headerPad + 4 : headerPad
            readonly property real botPad: plainTop ? 22 : th.parts.tabs === "segments" && (nav === "top" || nav === "top-left") ? headerPad + 12 : nav === "top-left" && th.parts.tabs !== "segments" ? (th.parts.row === "start" ? 1 : headerPad - 10) : headerPad
            x: nav === "left" ? (th.parts.tabs === "chunky" ? th.clamp(14, 2.4 * th.vw, 40) : 0) : 0
            width: nav === "left" ? body.sideW : body.width
            height: nav === "left" ? body.height : nav === "bottom-bar" ? th.clamp(118, 23 * th.vh, 230) * (["round", "chunky"].indexOf(th.parts.tabs) >= 0 ? 1.43 : 1) : headerRow.height + topPad + botPad
            y: nav === "left" ? 0
             : body.packed ? body.packedTop + titleAbove.height + viewport.Layout.preferredHeight + body.packedGap
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
            Shape {     // bottom-bar: a bar along the bottom, curved up in the middle (an ellipse across the whole width)
                id: barShape
                visible: header.nav === "bottom-bar"
                x: -body.anchors.leftMargin
                width: win.width
                height: parent.height + body.anchors.bottomMargin
                readonly property real ry: th.clamp(34, 8 * th.vh, 80)
                preferredRendererType: Shape.CurveRenderer
                ShapePath {
                    strokeColor: th.alpha(th.border, 0.85)
                    strokeWidth: 3
                    fillGradient: LinearGradient {
                        x1: 0; y1: 0; x2: 0; y2: barShape.height
                        GradientStop { position: 0; color: th.mix(th.panel, Qt.color("#ffffff"), 0.75) }
                        GradientStop { position: 0.7; color: th.panel }
                        GradientStop { position: 1; color: th.mix(th.panel, Qt.color("#000000"), 0.08) }
                    }
                    startX: 0; startY: barShape.height + 3
                    PathLine { x: 0; y: barShape.ry }
                    PathArc { x: barShape.width / 2; y: 0; radiusX: barShape.width / 2; radiusY: barShape.ry; direction: PathArc.Clockwise }
                    PathArc { x: barShape.width; y: barShape.ry; radiusX: barShape.width / 2; radiusY: barShape.ry; direction: PathArc.Clockwise }
                    PathLine { x: barShape.width; y: barShape.height + 3 }
                }
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
                x: side + (header.nav === "top-left" && th.parts.tabs !== "segments" ? 6 : 0)
                width: header.width - 2 * side
                y: header.nav === "bottom-bar" ? header.height - height - th.clamp(12, 3.2 * th.vh, 32) : header.topPad
                spacing: header.nav === "bottom-bar" ? 0 : th.parts.tabs === "segments" ? th.clamp(6, 1 * th.vw, 16) : 28
                readonly property bool alignable: header.nav === "top" || header.nav === "bottom" || header.nav === "bottom-dock"
                Item { Layout.fillWidth: header.nav !== "top-left" && !(headerRow.alignable && th.tabAlign === "flex-start"); visible: header.nav !== "bottom-bar" && header.nav !== "top-left" }
                HintKey { visible: header.hints; th: th; label: "LB"; round: header.nav === "bottom-bar"; transform: Translate { y: header.nav === "bottom-bar" ? -th.clamp(4, 1 * th.vh, 10) : 0 } }
                Item { Layout.fillWidth: true; visible: header.nav === "bottom-bar" }
                TabBar {
                    id: tabBarA
                    liftedId: win.reorderId
                    onTapped: function (i) { win.clickTab(i) }
                    transform: Translate { y: tabBarA.barPill ? 11 : 0 }
                    th: th
                    tabs: win.tabList
                    current: win.tabIndex
                    focused: win.area === "tabs"
                    span: th.parts.tabs === "segments" ? Math.min(1680, 88 * th.vw)
                        : header.nav === "top-left" ? 72 * th.vw
                        : header.nav === "bottom-dock" ? Math.min(1170, 78 * th.vw)
                        : header.nav === "bottom-bar" ? 64 * th.vw
                        : th.parts.tabs === "round" ? 94 * th.vw : Math.min(1100, 76 * th.vw)
                    Layout.preferredWidth: (header.nav === "top-left" || header.nav === "bottom-bar" || th.parts.tabs === "round") ? Math.min(span, implicitWidth) : span     // a port of fixed width, the tabs centred in it
                    Layout.preferredHeight: implicitHeight
                }
                Item { Layout.fillWidth: true; visible: header.nav === "bottom-bar" }
                HintKey { visible: header.hints; th: th; label: "RB"; round: header.nav === "bottom-bar"; transform: Translate { y: header.nav === "bottom-bar" ? -th.clamp(4, 1 * th.vh, 10) : 0 } }
                Item { Layout.fillWidth: !(headerRow.alignable && th.tabAlign === "flex-end"); visible: header.nav !== "bottom-bar" }
            }
            Column {
                visible: header.nav === "left"
                x: th.parts.tabs === "chunky" ? 14 : th.clamp(10, 1.5 * th.vw, 22)
                y: th.clamp(14, 2.6 * th.vh, 30) + (th.parts.emblem === "cube" ? 15.3 * th.vh : 0)
                width: header.width - 2 * x
                spacing: th.clamp(8, 1.5 * th.vh, 18)
                HintKey { visible: header.hints; th: th; label: "LB"; anchors.horizontalCenter: parent.horizontalCenter }
                TabBar {
                    id: tabBarB
                    liftedId: win.reorderId
                    onTapped: function (i) { win.clickTab(i) }
                    th: th
                    tabs: win.tabList
                    current: win.tabIndex
                    focused: win.area === "tabs"
                    span: parent.width
                    // style.css: chunky tabs turn 14° about their left edge, seen from 900px away
                    readonly property real turn: th.parts.tabs === "chunky" ? 14 * Math.PI / 180 : 0
                    transform: [
                        Translate { y: -tabBarB.height / 2 },
                        Matrix4x4 { matrix: Qt.matrix4x4(Math.cos(tabBarB.turn), 0, 0, 0,  0, 1, 0, 0,  -Math.sin(tabBarB.turn), 0, 1, 0,  Math.sin(tabBarB.turn) / 900, 0, 0, 1) },
                        Translate { y: tabBarB.height / 2 }
                    ]
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
                    PersonIcon { anchors.centerIn: parent; width: parent.width * 0.68; height: width; ink: "#ffffff" }
                }
                Text { anchors.right: parent.right; anchors.verticalCenter: parent.verticalCenter; text: clock.time; color: th.text; font.pixelSize: 1.05 * th.rem * th.clockScale; font.weight: Font.DemiBold }
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
            Text { anchors.verticalCenter: parent.verticalCenter; text: clock.time; color: th.text; font.pixelSize: (th.parts.tabs === "pivots" ? 1.05 : 1.15) * th.rem * th.clockScale; font.weight: th.parts.tabs === "pivots" ? Font.Normal : Font.Medium }
            Rectangle {
                width: (th.parts.tabs === "pivots" ? 2.3 : 2.2) * th.rem; height: width
                radius: th.parts.tabs === "pivots" ? 0 : width / 2
                color: th.parts.tabs === "pivots" ? th.accent : th.alpha(th.text, 0.18)
                PersonIcon { anchors.centerIn: parent; width: parent.width * 0.68; height: width; ink: th.parts.tabs === "pivots" ? "#ffffff" : th.text }
            }
        }
        Column {
            visible: th.parts.clock === "bar" && th.parts.nav === "bottom-bar"
            anchors.horizontalCenter: parent.horizontalCenter
            y: header.y + header.height - header.height * (["round", "chunky"].indexOf(th.parts.tabs) >= 0 ? 0.58 : 0.4) - height
            z: 3
            Text { anchors.horizontalCenter: parent.horizontalCenter; text: clock.time; color: th.muted; font.pixelSize: th.clamp(1.8 * th.rem, 6.5 * th.vh, 3.6 * th.rem) * th.clockScale; font.weight: Font.DemiBold; font.letterSpacing: 2 }
            Text { anchors.horizontalCenter: parent.horizontalCenter; text: clock.date; color: th.muted; font.pixelSize: th.clamp(0.85 * th.rem, 2.4 * th.vh, 1.3 * th.rem) * th.clockScale; font.weight: Font.DemiBold }
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
            y: sideNav ? 0 : body.packed ? body.packedTop : th.navBottom ? clockTop.height : header.y + header.height
            height: sideNav ? body.height : body.packed ? titleAbove.height + viewport.Layout.preferredHeight + 1.5 * th.rem : th.navBottom ? header.y - y + (header.nav === "bottom" ? header.footerSpace + header.height : 0) - (header.nav === "bottom" ? header.height : 0) : body.height - y
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
            SelectionTitle { id: titleAbove; visible: th.parts.title === "above"; th: th; text: win.titleText; leftAligned: column.leftAligned; inset: !column.sideNav; Layout.fillWidth: true; Layout.topMargin: body.packed ? 0 : win.homeMode ? 1 : th.clamp(4, 2 * th.vh, 24) }

            Item { visible: viewport.oneRow && (th.parts.row === "focus" ? !body.packed && th.parts.title !== "above" : th.rowPlace !== "top"); Layout.fillHeight: true }     // one-row page: middle or bottom
            Item {     // the tiles
                id: viewport
                Layout.fillWidth: true
                // "start": only the one row shows, so the page is as tall as it (style.css data-part-row="start")
                readonly property bool oneRow: (th.parts.row === "start" || th.parts.row === "focus") && th.mode === "rails" && win.page !== "new" && !win.homeMode     // the widgets page is not a one-row page
                Layout.fillHeight: !oneRow
                Layout.preferredHeight: oneRow ? (th.parts.row === "start" ? th.cardSize.h * 1.32 + 64 : th.cardSize.h + 76) : -1
                Layout.topMargin: th.parts.row === "start" ? th.clamp(12, 3 * th.vh, 34) : viewport.oneRow ? 0 : column.nav === "bottom-bar" ? th.clamp(14, 4 * th.vh, 44) : 0
                clip: true
                HomeGrid {
                    anchors.fill: parent
                    visible: win.homeMode
                    th: th
                    tiles: win.homeMode && win.rows.length ? win.rows[0].tiles : []
                    sel: win.selCol
                    active: win.area === "content" && !menu.visible && !keyboard.visible && !wheel.visible
                    place: win.place
                    sys: win.sys
                    recent: win.view.recent || []
                    now: win.clockNow
                    day: win.clockDay
                }
                Tiles {
                    anchors.fill: parent
                    th: th
                    rows: win.rows
                    selRow: win.selRow
                    selCol: win.selCol
                    active: win.area === "content" && !menu.visible && !keyboard.visible && !wheel.visible
                    onPointed: function (r, c, id) { win.pointTile(r, c, id) }
                    onTapped: function (r, c) { win.clickTile(r, c) }
                    artRev: String(win.artRev)
                    cols: win.rowCols
                    pageKey: win.pageKey
                    grid: win.gridNow
                    visible: win.page !== "new" && !win.homeMode
                }
                Column {
                    anchors.centerIn: parent
                    visible: win.page === "new"
                    spacing: 10
                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: "A new mosaic"; color: th.text; font.pixelSize: 1.6 * th.rem; font.weight: Font.DemiBold }
                    Text { anchors.horizontalCenter: parent.horizontalCenter; text: "Press A to make one and name it."; color: th.muted; font.pixelSize: 1.1 * th.rem }
                }
            }

            SelectionTitle { visible: th.parts.title !== "above"; th: th; text: win.titleText; leftAligned: column.leftAligned; inset: !column.sideNav; Layout.fillWidth: true }
            Item { visible: viewport.oneRow && (th.parts.row === "focus" || th.rowPlace !== "bottom"); Layout.fillHeight: true }     // a one-row page leaves the spare room here, not between its parts
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
                id: footerA
                visible: header.nav !== "bottom"
                th: th
                Layout.fillWidth: true
            }
        }
        Footer {      // "bottom": the hints under the menu, with a line above them
            id: footerB
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
        visible: !guideOnly && th.parts.emblem === "cube"
        width: 8.4 * th.vh
        height: width
        x: th.parts.nav === "left" ? body.anchors.leftMargin + header.x + header.width / 2 - width / 2 : th.edge
        y: th.navBottom ? win.height - th.clamp(52, 10 * th.vh, 110) - height : th.clamp(16, 4 * th.vh, 44)
        z: 6
        Canvas {     // a glass cube turning in place (style.css #cube-emblem: six clear faces, glowing edges)
            id: cubeArt
            anchors.fill: parent
            property real angle: 38
            NumberAnimation on angle { running: th.motion && th.parts.emblem === "cube" && cubeArt.visible; from: 38; to: 398; duration: 14000; loops: Animation.Infinite }
            onAngleChanged: requestPaint()
            onPaint: {
                var c = getContext("2d"), w = width, h = height
                c.clearRect(0, 0, w, h)
                var half = w / 2
                var ay = angle * Math.PI / 180, ax = -24 * Math.PI / 180
                var cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax)
                var persp = 60 * th.vh
                var pt = function (x, y, z) {
                    var x1 = x * cy + z * sy, z1 = -x * sy + z * cy                 // turn about the vertical
                    var y2 = y * cx - z1 * sx, z2 = y * sx + z1 * cx                // then tilt
                    var k = persp / (persp - z2 * half)
                    return { x: w / 2 + x1 * half * k, y: h / 2 + y2 * half * k, z: z2 }
                }
                var faces = [[[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]], [[1,-1,-1],[-1,-1,-1],[-1,1,-1],[1,1,-1]],
                             [[-1,-1,-1],[-1,-1,1],[-1,1,1],[-1,1,-1]], [[1,-1,1],[1,-1,-1],[1,1,-1],[1,1,1]],
                             [[-1,-1,-1],[1,-1,-1],[1,-1,1],[-1,-1,1]], [[-1,1,1],[1,1,1],[1,1,-1],[-1,1,-1]]]
                var drawn = faces.map(function (f) {
                    var q = f.map(function (v) { return pt(v[0], v[1], v[2]) })
                    return { q: q, z: (q[0].z + q[1].z + q[2].z + q[3].z) / 4 }
                }).sort(function (a, b) { return a.z - b.z })
                var edge = th.mix(th.accent, Qt.color("#ffffff"), 0.2), fill = th.alpha(th.border, 0.55)
                for (var n = 0; n < drawn.length; n++) {
                    var q = drawn[n].q
                    c.beginPath(); c.moveTo(q[0].x, q[0].y)
                    for (var i = 1; i < 4; i++) c.lineTo(q[i].x, q[i].y)
                    c.closePath()
                    c.fillStyle = fill; c.fill()
                    c.fillStyle = th.alpha(th.accent, 0.1); c.fill()
                    c.lineWidth = Math.max(2, 0.45 * th.vh); c.strokeStyle = edge; c.lineJoin = "round"; c.stroke()
                }
            }
            Connections { target: th; function onAccentChanged() { cubeArt.requestPaint() } }
            onWidthChanged: requestPaint()
        }
    }

    // ================================================================ overlays
    Menu { id: menu; anchors.fill: parent; th: th; z: 20 }
    Flows { id: flows; w: win }
    Timer { id: startTimer; interval: 700; property var payload: null; onTriggered: flows.startup(payload) }     // first run, who is playing
    Timer { id: keepTimer; interval: 1200; onTriggered: flows.displayKeep() }     // after a restart on new screen settings: keep them?
    ColorWheel { id: wheel; anchors.fill: parent; th: th; z: 31 }
    Keyboard { id: keyboard; anchors.fill: parent; th: th; z: 30; keys: win.view.keys || ({ back: 2, space: 3, shift: 10, done: 9, cancel: 1 }) }
    Browser {
        id: browser
        anchors.fill: parent
        th: th
        z: 15
        prevName: win.tabList.length ? win.tabList[(win.tabIndex - 1 + win.tabList.length) % win.tabList.length].title : ""
        nextName: win.tabList.length ? win.tabList[(win.tabIndex + 1) % win.tabList.length].title : ""
        fallbackUrl: win.browserUrl
        onPlaced: function (r) {
            browserInput.setOrigin(r.x, r.y)
            api.call("browser", ["frame", { rect: r }])
        }
        onReport: function (s) { api.call("__qt", ["browserState", s]) }
        onClosed: {
            keys.forceActiveFocus()
            while (win.queuedTabs.length && !browser.moving) { var q = win.queuedTabs[0]; win.queuedTabs = win.queuedTabs.slice(1); win.act(q) }
        }
    }
    Connections { target: browserInput; function onTab(d) { win.browserAct(d < 0 ? "lb" : "rb") } }
    Tour { id: tourView; anchors.fill: parent; th: th; z: 28 }
    Grip { id: gripView; anchors.fill: parent; th: th; z: 28 }
    Capture { id: captureView; anchors.fill: parent; th: th; z: 32 }
    PadTest { id: padTestView; anchors.fill: parent; th: th; z: 27; pad: win.view.prefs && win.view.prefs.pad ? win.view.prefs.pad : ({ deadzone: 15, trigger: 10 }) }
    Calibration { id: calib; anchors.fill: parent; th: th; z: 25; onFilter: function (c) { win.calOverrideOn = c !== undefined; win.calOverride = c === undefined ? null : c } }
    }
}
