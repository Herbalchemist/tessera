// SPDX-License-Identifier: GPL-3.0-or-later
// Ludus (Qt): "Change grip/order" (padTest.js flowGrip). L + R on two Joy-Cons joins them into one
// controller, SL + SR on one makes it a player of its own. The Joy-Con service decides; this only
// shows who is which player, live, while it is open.
import QtQuick

Rectangle {
    id: gr
    property Theme th
    property var cards: []
    property bool waiting: false
    property bool auto: false
    signal closed()
    visible: false
    color: Qt.rgba(8 / 255, 11 / 255, 15 / 255, 0.9)
    readonly property var partNames: ({ joined: "Joy-Con L + R", jl: "Left Joy-Con, sideways", jr: "Right Joy-Con, sideways", pro: "Controller", unassigned: "Not set up yet", other: "Controller" })

    function battery(b) {
        if (!b) return ""
        var lvl = (b.percent !== null && b.percent !== undefined) ? b.percent + "%" : b.level
        return (lvl ? "Battery " + lvl : "") + (b.charging ? " (charging)" : "")
    }
    function apply(d) {
        if (!d) return
        var svc = d.svc || [], pads = d.pads || []
        cards = svc.concat(pads)
        waiting = Boolean(d.service) && svc.some(function (p) { return p.kind === "unassigned" })
        // opened by the prompt for a waiting Joy-Con, and everything is set up now: done
        if (auto && visible && !svc.some(function (p) { return p.kind === "unassigned" })) close()
    }
    function open(isAuto) {
        auto = Boolean(isAuto); visible = true
        win.dev("pads", "grip", { on: true }).then(function (r) { apply(r) })
    }
    function close() {
        if (!visible) return
        visible = false
        win.dev("pads", "grip", { on: false })
        closed()
    }
    function press(a) { if (a === "a" || a === "b") close() }

    Rectangle {
        anchors.centerIn: parent
        width: Math.min(parent.width * 0.86, 1100); height: col.implicitHeight + 3 * th.rem
        radius: th.radius; color: th.panel
        border.width: 2; border.color: th.alpha(th.accent, 0.5)
        Column {
            id: col
            anchors.centerIn: parent
            width: parent.width - 3 * th.rem
            spacing: 14
            Text { color: th.text; font.pixelSize: 1.4 * th.rem; font.weight: Font.DemiBold; text: "Change grip/order" }
            Text {
                width: parent.width; wrapMode: Text.Wrap; font.pixelSize: 0.95 * th.rem
                color: gr.waiting ? th.accent : th.muted
                text: "Use two Joy-Cons together: press L and R, one on each. Use one Joy-Con on its own, held sideways: press SL and SR on it."
            }
            Text {
                visible: gr.cards.length === 0; width: parent.width; wrapMode: Text.Wrap; color: th.muted; font.pixelSize: th.rem
                text: "No Joy-Con or Pro Controller is connected. Pair one in Settings > Bluetooth, or plug it in."
            }
            Flow {
                width: parent.width; spacing: 14
                Repeater {
                    model: gr.cards
                    Rectangle {
                        width: 220; height: cc.implicitHeight + 24; radius: th.radius * 0.7
                        color: th.alpha(th.text, 0.06)
                        border.width: modelData.kind === "unassigned" ? 2 : 1
                        border.color: modelData.kind === "unassigned" ? th.accent : th.alpha(th.text, 0.18)
                        Column {
                            id: cc
                            x: 12; y: 12; width: parent.width - 24; spacing: 8
                            Text { color: th.accent; font.pixelSize: 0.85 * th.rem; font.weight: Font.DemiBold; text: modelData.kind === "unassigned" ? "Waiting" : "Player " + modelData.player }
                            Row {
                                spacing: 6; height: 44
                                Repeater {
                                    model: modelData.parts || []
                                    Rectangle {
                                        width: 22; height: 44; radius: 8
                                        color: modelData === "jr" ? "#ff4554" : "#00c3e3"
                                    }
                                }
                            }
                            Text { width: parent.width; wrapMode: Text.Wrap; color: th.text; font.pixelSize: 0.95 * th.rem; text: modelData.kind === "other" ? modelData.name : (gr.partNames[modelData.kind] || String(modelData.name).replace(" (Nintendo)", "")) }
                            Text {
                                width: parent.width; wrapMode: Text.Wrap; color: th.muted; font.pixelSize: 0.8 * th.rem
                                text: modelData.kind === "unassigned" ? "Press SL + SR on it, or L + R with another Joy-Con"
                                    : modelData.error === "permission" ? "Tessera isn't allowed to read this one"
                                    : [gr.battery(modelData.battery), modelData.motion ? "motion sensors" : ""].filter(Boolean).join(" · ")
                            }
                        }
                    }
                }
            }
            Text { width: parent.width; horizontalAlignment: Text.AlignHCenter; color: th.muted; font.pixelSize: 0.85 * th.rem; text: "A or B: done" }
        }
    }
}
