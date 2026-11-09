// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): the web page itself, QtWebEngine (webView.js ensureBrowserView). Loaded only when the
// browser is opened, so a machine without WebEngine still runs everything else.
// Each profile browses with its own storage; every permission is refused; pop-up windows are
// refused; only http(s) addresses are followed; downloads go straight to the Downloads folder
// (no save dialog: a controller can't work one) under a cleaned-up name that never replaces a file.
import QtQuick
import QtWebEngine

Item {
    id: page
    property string profileId: ""          // "" is the one Tessera always had
    property string downloadDir: ""
    readonly property alias view: web
    signal reported(var st)                // { url, title, loading, canGoBack }

    function load(u) { if (/^https?:\/\//i.test(u)) web.url = u }
    function back() { if (web.canGoBack) web.goBack() }
    function focusPage() { web.forceActiveFocus() }
    function report() {
        page.reported({ url: web.url.toString(), title: web.title || "", loading: web.loading, canGoBack: web.canGoBack })
    }
    function cleanName(n) {
        var b = String(n || "").replace(/[^\w.()+ -]/g, "_").replace(/^[.\s]+/, "").slice(0, 120)
        return b || "download"
    }

    WebEngineProfile {
        id: prof
        storageName: "tessera-browser-" + (page.profileId || "main")
        offTheRecord: false
        persistentStoragePath: browserDir + "/" + (page.profileId || "main")
        cachePath: browserDir + "/" + (page.profileId || "main") + "/cache"
        persistentCookiesPolicy: WebEngineProfile.ForcePersistentCookies
        onDownloadRequested: function (d) {
            if (page.downloadDir) d.downloadDirectory = page.downloadDir
            d.downloadFileName = page.cleanName(d.downloadFileName)
            d.accept()
        }
    }
    WebEngineView {
        id: web
        anchors.fill: parent
        profile: prof
        settings.javascriptCanOpenWindows: false
        settings.allowRunningInsecureContent: false
        settings.javascriptCanAccessClipboard: false
        settings.pluginsEnabled: false
        settings.screenCaptureEnabled: false
        onNavigationRequested: function (req) {
            if (!/^https?:/i.test(req.url.toString())) req.action = WebEngineNavigationRequest.IgnoreRequest
        }
        onPermissionRequested: function (p) { p.deny() }
        onUrlChanged: page.report()
        onTitleChanged: page.report()
        onLoadingChanged: function (info) {
            page.report()
            if (info.status === WebEngineLoadingInfo.LoadSucceededStatus || info.status === WebEngineLoadingInfo.LoadFailedStatus) web.forceActiveFocus()
        }
        // no pop-up windows: a request for one is simply not answered
        onNewWindowRequested: function (req) { }
    }
}
