#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Ludus (Qt): Tessera's console screen in Qt 6 + QML. First version: tabs, mosaics and folders,
the Library and Apps, starting games and apps, every controller. Anything it doesn't have yet
(PIN, profiles, themes, the browser tab, Settings) stays in the full Ludus, which it can go
back to at any time (Settings tab, or by failing to start: the session falls back by itself).

  ludus.py               the screen
  ludus.py --check       exit 0 if this version may run here, 3 (and why) if not
  ludus.py --shot DIR    draw each screen into DIR/*.png and quit (for the build's screenshots)
"""
import os
import subprocess
import sys
import threading

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import library  # noqa: E402

CHOICE = os.path.join(os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config'), 'tessera', 'ludus')
STATE = os.path.join(os.environ.get('XDG_STATE_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'state'), 'tessera')


def check():
    why = library.locked_down()
    if why:
        print('ludus-qt: not used, %s (the full Ludus keeps those safe)' % why, file=sys.stderr)
        return 3
    return 0


if '--check' in sys.argv:
    sys.exit(check())

from PySide6.QtCore import Q_ARG, QMetaObject, QObject, Property, QTimer, QUrl, Signal, Slot  # noqa: E402
from PySide6.QtGui import QGuiApplication  # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine  # noqa: E402

import pads  # noqa: E402


class Backend(QObject):
    changed = Signal()
    action = Signal(str)          # a controller press (from the pads thread, delivered on the screen's thread)
    message = Signal(str)
    runningChanged = Signal()
    gameEnded = Signal(str)

    def __init__(self, lib):
        super().__init__()
        self.lib = lib
        self._running = ''
        self.pads = None

    # ---- what the screen shows
    @Property('QVariantList', notify=changed)
    def tabs(self):
        return self.lib.tabs()

    @Slot(str, result='QVariantList')
    def tiles(self, where):
        return self.lib.tiles(where)

    @Slot(result='QVariantList')
    def mosaicList(self):
        return [{'id': c['id'], 'title': c['title']} for c in self.lib.mosaics()]

    @Slot(str, result=str)
    def title(self, cat_id):
        c = self.lib.cat(cat_id)
        return c['title'] if c else ''

    @Property(str, notify=runningChanged)
    def running(self):
        return self._running

    # ---- changes
    @Slot(str, result=str)
    def createMosaic(self, title):
        id_ = self.lib.create_mosaic(title)
        self.changed.emit()
        return id_

    @Slot(str, str, result=bool)
    def rename(self, cat_id, title):
        ok = self.lib.rename(cat_id, title)
        self.changed.emit()
        return ok

    @Slot(str, result=bool)
    def deleteMosaic(self, cat_id):
        ok = self.lib.delete_mosaic(cat_id)
        self.changed.emit()
        return ok

    @Slot(str, str, result=bool)
    def addTo(self, cat_id, entry):
        ok = self.lib.add_to(cat_id, entry)
        self.changed.emit()
        return ok

    @Slot(str, str, result=bool)
    def removeFrom(self, cat_id, entry):
        ok = self.lib.remove_from(cat_id, entry)
        self.changed.emit()
        return ok

    @Slot(str, int, result=bool)
    def moveTab(self, tab_id, d):
        ok = self.lib.move_tab(tab_id, d)
        self.changed.emit()
        return ok

    # ---- starting things
    @Slot(str)
    def launch(self, item_id):
        if self._running:
            return self.message.emit('%s is still running.' % self._running)
        argv, cwd = self.lib.launch_command(item_id)
        if argv is None:
            return self.message.emit(cwd)
        it = self.lib.item(item_id)
        os.makedirs(os.path.join(STATE, 'logs'), exist_ok=True)
        log = open(os.path.join(STATE, 'logs', 'ludus-qt-last-game.log'), 'w')
        try:
            child = subprocess.Popen(argv, cwd=cwd, stdin=subprocess.DEVNULL, stdout=log, stderr=log, start_new_session=True)
        except OSError as e:
            log.close()
            return self.message.emit('Launch failed: %s' % e)
        log.close()
        self.lib.record_play(item_id)
        self._running = it.get('title') or 'The game'
        self.runningChanged.emit()
        if self.pads:
            self.pads.paused = True   # a game reads its controllers itself

        def wait():
            code = child.wait()
            self._ended = '' if code == 0 else '%s exited (code %d).' % (self._running, code)
            QTimer.singleShot(0, self.finish)
        threading.Thread(target=wait, daemon=True).start()

    def finish(self):
        msg = getattr(self, '_ended', '')
        self._running = ''
        self.runningChanged.emit()
        if self.pads:
            self.pads.paused = False
        self.gameEnded.emit(msg)

    # ---- leaving
    @Slot()
    def useFullLudus(self):
        """Back to the full (Electron) Ludus: forget the choice and start again."""
        try:
            os.remove(CHOICE)
        except OSError:
            pass
        self._restart()

    def _restart(self):
        f = os.environ.get('TESSERA_RESTART_FILE')
        if f:
            try:
                open(f, 'w').close()
            except OSError:
                pass
        QGuiApplication.quit()

    @Slot()
    def goToOpus(self):
        f = os.environ.get('TESSERA_LEAVE_FILE')
        if f:
            try:
                open(f, 'w').close()
            except OSError:
                pass
        QGuiApplication.quit()

    @Property(bool, constant=True)
    def inSession(self):
        return bool(os.environ.get('TESSERA_LEAVE_FILE'))


def main():
    if check():
        sys.exit(3)
    print('ludus-qt: starting', flush=True)
    shot_dir = sys.argv[sys.argv.index('--shot') + 1] if '--shot' in sys.argv else None
    app = QGuiApplication(sys.argv)
    app.setApplicationName('Ludus')
    lib = library.Library()
    back = Backend(lib)
    engine = QQmlApplicationEngine()
    engine.warnings.connect(lambda ws: [print('qml:', w.toString(), file=sys.stderr, flush=True) for w in ws])
    engine.rootContext().setContextProperty('backend', back)
    engine.rootContext().setContextProperty('shotMode', bool(shot_dir))
    engine.load(QUrl.fromLocalFile(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'qml', 'Main.qml')))
    if not engine.rootObjects():
        print('ludus-qt: the screen did not load', file=sys.stderr, flush=True)
        sys.exit(1)
    win = engine.rootObjects()[0]
    if shot_dir:
        return shots(app, win, shot_dir)
    back.pads = pads.Pads(lambda a: QTimer.singleShot(0, lambda: back.action.emit(a)))
    back.pads.start()
    sys.exit(app.exec())


def shots(app, win, out):
    """Steps through the screens the way a controller would, saving a picture of each."""
    os.makedirs(out, exist_ok=True)
    # The sample library (tools/ludus-qt-test) has games, apps and one mosaic with a folder in it.
    steps = [('01-library', []), ('02-tile-moved', ['right', 'right']), ('03-options', ['y']),
             ('04-add-to-which-mosaic', ['down', 'a']), ('05-mosaic', ['b', 'rb', 'rb', 'down']),
             ('06-mosaic-options-from-tabs', ['up', 'y']), ('07-delete-confirm', ['down', 'down', 'down', 'a']),
             ('08-keyboard', ['b', 'rb', 'a']), ('09-settings', ['b', 'rb', 'down'])]
    state = {'i': 0}

    def step():
        if state['i'] >= len(steps):
            app.quit()
            return
        name, acts = steps[state['i']]
        for a in acts:
            QMetaObject.invokeMethod(win, 'act', Q_ARG('QVariant', a))
        state['i'] += 1

        def grab():
            win.grabWindow().save(os.path.join(out, name + '.png'))
            print('shot', name, flush=True)
            QTimer.singleShot(50, step)
        QTimer.singleShot(450, grab)
    QTimer.singleShot(600, step)
    sys.exit(app.exec())


if __name__ == '__main__':
    main()
