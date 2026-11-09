#!/usr/bin/python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Ludus (Qt): Tessera's console screen in Qt 6 + QML. First version: tabs, mosaics and folders,
the Library and Apps, starting games and apps, every controller. Anything it doesn't have yet
(PIN, profiles, themes, the browser tab, Settings) stays in the full Ludus, which it can go
back to at any time (Settings tab, or by failing to start: the session falls back by itself).

  ludus.py               the screen
  ludus.py --check       exit 0 if this version may run here, 3 (and why) if not
  ludus.py --shot DIR    draw each screen into DIR/*.png and quit (for the build's screenshots)
  ludus.py --theme-shots DIR   every factory theme, named like qa/theme-shots.cjs (side by side)
"""
import json
import re
import os
import shutil
import socket
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER = os.environ.get('TESSERA_LAUNCHER_DIR', '/usr/lib/tessera/launcher')
DATA_DIR = os.environ.get('TESSERA_DATA_DIR') or os.path.join(
    os.environ.get('XDG_DATA_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'share'), 'tessera')
CHOICE = os.path.join(os.environ.get('XDG_CONFIG_HOME') or os.path.join(os.path.expanduser('~'), '.config'), 'tessera', 'ludus')


def locked_down(settings=None):
    """What this version has no screens for yet, and must never let anyone around: a PIN, profiles
    (and their guest limits). While any is set up it doesn't run; the full Ludus is used."""
    if settings is None:
        try:
            with open(os.path.join(DATA_DIR, 'settings.json'), encoding='utf-8') as f:
                settings = json.load(f)
        except (OSError, ValueError):
            settings = {}
    if not isinstance(settings, dict):
        return None
    if settings.get('pin'):
        return 'a PIN is set'
    if isinstance(settings.get('profiles'), list) and settings['profiles']:
        return 'profiles are set up'
    return None


def check():
    why = locked_down()
    if why:
        print('ludus-qt: not used, %s (the full Ludus keeps those safe)' % why, file=sys.stderr)
        return 3
    return 0


if '--check' in sys.argv:
    sys.exit(check())

from PySide6.QtCore import Q_ARG, QMetaObject, QObject, Property, QSocketNotifier, Qt, QTimer, QUrl, Signal, Slot  # noqa: E402
from PySide6.QtGui import QGuiApplication, QImage  # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine  # noqa: E402
from PySide6.QtQuick import QQuickAsyncImageProvider, QQuickImageResponse, QQuickTextureFactory, QQuickWindow  # noqa: E402,F401

import pads  # noqa: E402


def node_program():
    """What runs the full Ludus's main process: the Electron that ships with it, as plain Node
    (always there, the version that code is tested on), else the system's node."""
    electron = os.path.join(LAUNCHER, 'node_modules', 'electron', 'dist', 'electron')
    if os.access(electron, os.X_OK):
        return [electron], {'ELECTRON_RUN_AS_NODE': '1'}
    return [os.environ.get('TESSERA_NODE') or shutil.which('node') or 'node'], {}


class Bridge(QObject):
    """The full Ludus's main process (backend/bridge.js), over a private socket pair."""
    reply = Signal(int, 'QVariant')
    event = Signal(str, 'QVariant')
    windowOp = Signal(str)
    gone = Signal()

    def __init__(self):
        super().__init__()
        ours, theirs = socket.socketpair()
        prog, extra = node_program()
        env = dict(os.environ, TESSERA_BRIDGE_FD=str(theirs.fileno()), TESSERA_LAUNCHER_DIR=LAUNCHER, **extra)
        import subprocess
        self.child = subprocess.Popen(prog + [os.path.join(HERE, 'backend', 'bridge.js')], env=env,
                                      pass_fds=(theirs.fileno(),), stdin=subprocess.DEVNULL)
        theirs.close()
        self.sock = ours
        self.sock.setblocking(False)
        self.buf = b''
        self.notifier = QSocketNotifier(self.sock.fileno(), QSocketNotifier.Read)
        self.notifier.activated.connect(self.read)
        self.art_ids = 1 << 30   # picture requests use their own numbers, far from the page's

    def new_art_id(self):
        self.art_ids += 1
        return self.art_ids

    def read(self):
        try:
            data = self.sock.recv(1 << 20)
        except BlockingIOError:
            return
        except OSError:
            data = b''
        if not data:
            self.notifier.setEnabled(False)
            self.gone.emit()
            return
        self.buf += data
        while b'\n' in self.buf:
            line, self.buf = self.buf.split(b'\n', 1)
            try:
                m = json.loads(line)
            except ValueError:
                continue
            if 'id' in m:
                self.reply.emit(int(m['id']), m)
            elif 'event' in m:
                self.event.emit(m['event'], m.get('data'))
            elif 'window' in m:
                self.windowOp.emit(m['window'])

    @Slot(int, str, 'QVariantList')
    def request(self, id_, ch, args):
        msg = (json.dumps({'id': id_, 'ch': ch, 'args': args}) + '\n').encode()
        self.sock.setblocking(True)
        try:
            self.sock.sendall(msg)
        except OSError:
            pass
        finally:
            self.sock.setblocking(False)

    def stop(self):
        try:
            self.sock.close()
        except OSError:
            pass
        try:
            self.child.wait(3)
        except Exception:   # noqa: BLE001
            self.child.kill()


class ArtResponse(QQuickImageResponse):
    """One game picture, asked of the main process (the same answer its tessera-art:// gives)."""
    def __init__(self, bridge, name, size):
        super().__init__()
        self.image = QImage()
        self.size = size
        self.rid = bridge.new_art_id()
        bridge.reply.connect(self.got, Qt.QueuedConnection)
        QMetaObject.invokeMethod(bridge, 'request', Qt.QueuedConnection, Q_ARG(int, self.rid), Q_ARG(str, '__art'), Q_ARG('QVariantList', [name]))

    def got(self, rid, m):
        if rid != self.rid:
            return
        try:
            r = m.get('result') if m.get('ok') else None
            if r and r.get('data'):
                import base64
                self.image.loadFromData(base64.b64decode(r['data']))
                if self.size.isValid() and self.size.width() > 0 and not self.image.isNull():
                    self.image = self.image.scaled(self.size, Qt.KeepAspectRatioByExpanding, Qt.SmoothTransformation)
        finally:
            self.finished.emit()

    def textureFactory(self):
        return QQuickTextureFactory.textureFactoryForImage(self.image)


class ArtProvider(QQuickAsyncImageProvider):
    def __init__(self, bridge):
        super().__init__()
        self.bridge = bridge

    def requestImageResponse(self, id_, size):
        from urllib.parse import unquote
        return ArtResponse(self.bridge, unquote(id_.split('?')[0]), size)


def shell_data():
    """The arrangements and their parts, from the full Ludus's own shell-layout.js (run as is)."""
    import subprocess
    prog, extra = node_program()
    code = ("const m = require(process.argv[1]); console.log(JSON.stringify("
            "{ parts: m.PARTS, presets: m.PRESETS, presetParts: m.PRESET_PARTS }))")
    try:
        r = subprocess.run(prog + ['-e', code, os.path.join(LAUNCHER, 'shell-layout.js')], env=dict(os.environ, **extra),
                           capture_output=True, text=True, timeout=20, check=True)
        return json.loads(r.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print('ludus-qt: shell-layout.js:', e, file=sys.stderr)
        return {}


def svg_paths(markup):
    """'<path d=..>' '<circle ..>' '<rect ..>' markup as one SVG path, for QML's PathSvg."""
    import re
    out = []
    for tag, attrs in re.findall(r'<(path|circle|rect)\s([^>]*?)/?>', markup):
        a = dict(re.findall(r'([a-zA-Z-]+)="([^"]*)"', attrs))
        f = lambda k, d=0.0: float(a.get(k, d))  # noqa: E731
        if tag == 'path':
            out.append(a.get('d', ''))
        elif tag == 'circle':
            cx, cy, r = f('cx'), f('cy'), f('r')
            out.append('M%g %gA%g %g 0 1 0 %g %gA%g %g 0 1 0 %g %gZ' % (cx - r, cy, r, r, cx + r, cy, r, r, cx - r, cy))
        else:
            x, y, w, h, rx = f('x'), f('y'), f('width'), f('height'), f('rx')
            rx = min(rx, w / 2, h / 2)
            out.append('M%g %gH%gA%g %g 0 0 1 %g %gV%gA%g %g 0 0 1 %g %gH%gA%g %g 0 0 1 %g %gV%gA%g %g 0 0 1 %g %gZ' % (
                x + rx, y, x + w - rx, rx, rx, x + w, y + rx, y + h - rx, rx, rx, x + w - rx, y + h, x + rx, rx, rx, x, y + h - rx,
                y + rx, rx, rx, x + rx, y))
    return ' '.join(out)


def tab_icons():
    """The tab bar's line icons, from the full Ludus's home.js."""
    import re
    try:
        src = open(os.path.join(LAUNCHER, 'renderer', 'home.js'), encoding='utf-8').read()
    except OSError:
        return {}
    m = re.search(r'const TAB_ICONS = \{(.*?)\n\};', src, re.S)
    return {k: svg_paths(v) for k, v in re.findall(r"(\w+): '([^']*)'", m.group(1))} if m else {}


def setting_icons():
    """The Settings tiles' line icons, from the full Ludus's look.js (its ICONS table, run as it is)."""
    import re
    import subprocess
    try:
        src = open(os.path.join(LAUNCHER, 'renderer', 'look.js'), encoding='utf-8').read()
    except OSError:
        return {}
    m = re.search(r'\nconst ICONS = \{.*?\n\};', src, re.S)
    if not m:
        return {}
    prog, extra = node_program()
    try:
        r = subprocess.run(prog + ['-e', m.group(0) + '\nconsole.log(JSON.stringify(ICONS))'], env=dict(os.environ, **extra),
                           capture_output=True, text=True, timeout=20, check=True)
        icons = json.loads(r.stdout)
    except (OSError, ValueError, subprocess.SubprocessError) as e:
        print('ludus-qt: icons:', e, file=sys.stderr)
        return {}
    out = {}
    for name, ic in icons.items():
        markup = ''.join('<%s %s/>' % (tag, ' '.join('%s="%s"' % (k, v) for k, v in attrs.items() if k != 'class')) for tag, attrs in ic.get('parts', []))
        out[name] = svg_paths(markup)
    return out


class Session(QObject):
    """Leaving: back to the full Ludus, or to Opus."""
    @Slot()
    def useFullLudus(self):
        try:
            os.remove(CHOICE)
        except OSError:
            pass
        self._touch('TESSERA_RESTART_FILE')

    @Slot()
    def goToOpus(self):
        self._touch('TESSERA_LEAVE_FILE')

    def _touch(self, var):
        f = os.environ.get(var)
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
    theme_dir = sys.argv[sys.argv.index('--theme-shots') + 1] if '--theme-shots' in sys.argv else None
    app = QGuiApplication(sys.argv)
    app.setApplicationName('Ludus')
    bridge = Bridge()
    session = Session()
    engine = QQmlApplicationEngine()
    engine.warnings.connect(lambda ws: [print('qml:', w.toString(), file=sys.stderr, flush=True) for w in ws])
    engine.addImageProvider('art', ArtProvider(bridge))
    engine.rootContext().setContextProperty('bridge', bridge)
    engine.rootContext().setContextProperty('session', session)
    engine.rootContext().setContextProperty('shotMode', bool(shot_dir or theme_dir))
    engine.rootContext().setContextProperty('shellData', shell_data())
    engine.rootContext().setContextProperty('tabIcons', tab_icons())
    engine.rootContext().setContextProperty('settingIcons', setting_icons())
    engine.load(QUrl.fromLocalFile(os.path.join(HERE, 'qml', 'Main.qml')))
    if not engine.rootObjects():
        print('ludus-qt: the screen did not load', file=sys.stderr, flush=True)
        sys.exit(1)
    win = engine.rootObjects()[0]
    bridge.gone.connect(app.quit)   # the main process ended (a restart, Opus): so does the screen
    if shot_dir:
        code = shots(app, win, shot_dir)
    elif theme_dir:
        code = theme_shots(app, win, theme_dir)
    else:
        controllers = pads.Pads(lambda a: QTimer.singleShot(0, lambda: QMetaObject.invokeMethod(win, 'act', Q_ARG('QVariant', a))))
        # While a game runs the main process hides the screen; the game reads its controllers itself.
        bridge.windowOp.connect(lambda op: setattr(controllers, 'paused', op == 'hide'))
        controllers.start()
        code = app.exec()
    bridge.stop()
    sys.exit(code)


def run_steps(app, win, out, steps, wait=900, first=2500):
    """Runs (name, actions) steps, saving a picture after each. An action "@page" shows a page the
    way qa/theme-shots.cjs does (Main.qml shotView), "theme:id" switches theme, the rest are presses."""
    os.makedirs(out, exist_ok=True)
    state = {'i': 0}

    def step():
        if state['i'] >= len(steps):
            app.quit()
            return
        name, acts = steps[state['i']]
        state['i'] += 1
        pause = wait
        for a in acts:
            if a.startswith('@'):
                QMetaObject.invokeMethod(win, 'shotView', Q_ARG('QVariant', a[1:]))
            elif a.startswith('theme:'):
                QMetaObject.invokeMethod(win, 'useTheme', Q_ARG('QVariant', a[6:]))
                pause = 1800   # the theme, then its background picture
            else:
                QMetaObject.invokeMethod(win, 'act', Q_ARG('QVariant', a))
        if not name:
            QTimer.singleShot(pause, step)
            return

        def grab():
            try:
                win.grabWindow().save(os.path.join(out, name + '.png'))
                print('shot', name, flush=True)
            except Exception as e:   # noqa: BLE001 - say it and stop, don't hang the build
                print('shot failed:', e, flush=True)
                app.exit(1)
                return
            QTimer.singleShot(50, step)
        QTimer.singleShot(pause, grab)
    QTimer.singleShot(first, step)   # first: the main process sends the page its first view


def shots(app, win, out):
    """The screens a controller walks through, on the sample library (tools/ludus-qt-test/sample.py:
    games, apps, and the mosaic "Couch co-op" with the folder "Party night" in it)."""
    steps = [('01-library', ['@library']), ('02-options', ['y']), ('03-add-to-which-mosaic', ['down', 'a']),
             ('04-mosaic', ['b', '@m:couch']), ('05-folder', ['right', 'right', 'a']),
             ('06-mosaic-options-from-tabs', ['b', 'b', 'y']), ('07-delete-confirm', ['down', 'down', 'down', 'a']),
             ('08-keyboard', ['b', 'right', 'a']), ('09-settings', ['b', 'right', 'down']),
             ('10-home', ['@home']), ('11-tabs-browser', ['@tabs', 'left', 'left'])]
    run_steps(app, win, out, steps)
    return app.exec()


def theme_shots(app, win, out):
    """Every factory theme, drawn the way qa/theme-shots.cjs draws the full Ludus (same names), so
    the two can be put side by side: theme-<id>-<library|home|settings|tabs>-<width>.png"""
    def start():
        ids = win.property('themeIds')
        ids = ids.toVariant() if hasattr(ids, 'toVariant') else ids
        only = os.environ.get('THEMES')
        ids = only.split(',') if only else list(ids or [])
        if not ids:
            print('theme shots: no themes', flush=True)
            app.exit(1)
            return
        w = win.width()
        steps = []
        for t in ids:
            name = re.sub(r'[^a-zA-Z0-9=+-]', '_', t)
            steps.append(('', ['theme:' + t]))
            steps += [('theme-%s-%s-%d' % (name, v, w), ['@' + v]) for v in ('library', 'home', 'settings', 'tabs')]
        run_steps(app, win, out, steps, first=0)
    QTimer.singleShot(2500, start)
    return app.exec()


if __name__ == '__main__':
    main()
