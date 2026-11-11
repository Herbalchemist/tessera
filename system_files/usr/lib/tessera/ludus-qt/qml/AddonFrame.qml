// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus: a downloaded add-on widget, in QtWebEngine (the full Ludus ran it in a sandboxed frame).
// It sees only its own folder (the tessera-widget:// scheme, answered by the main process, which
// refuses anything outside the folder), every response carries the same policy (scripts from its own
// files, no network of any kind: ludus.py WidgetGuard blocks anything else), it can't open windows,
// ask for permissions or go anywhere else, and it takes no clicks or keys. Loaded only for a widget
// that is on screen, so a machine without WebEngine still runs everything else.
import QtQuick
import QtWebEngine

Item {
    id: frame
    property string wid: ""
    readonly property bool ready: view.loadProgress === 100
    readonly property alias view: view

    WebEngineView {
        id: view
        anchors.fill: parent
        enabled: false                          // a picture to look at, as before (pointer-events: none)
        profile: widgetProfile
        url: frame.wid ? "tessera-widget://" + frame.wid + "/" : ""
        backgroundColor: "transparent"
        settings.javascriptCanOpenWindows: false
        settings.javascriptCanAccessClipboard: false
        settings.localContentCanAccessRemoteUrls: false
        settings.localContentCanAccessFileUrls: false
        settings.allowRunningInsecureContent: false
        settings.pluginsEnabled: false
        settings.screenCaptureEnabled: false
        settings.showScrollBars: false
        settings.errorPageEnabled: false
        onNavigationRequested: function (req) {
            if (req.url.toString().indexOf("tessera-widget://" + frame.wid + "/") !== 0) req.action = WebEngineNavigationRequest.IgnoreRequest
        }
        onPermissionRequested: function (p) { p.deny() }
    }
}
