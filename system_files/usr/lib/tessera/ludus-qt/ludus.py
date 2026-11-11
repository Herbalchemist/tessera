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

from PySide6.QtCore import (Q_ARG, QCoreApplication, QEvent, QMetaObject, QObject, QPoint, QPointF, Property,  # noqa: E402
                            QSocketNotifier, Qt, QTimer, QUrl, Signal, Slot)
from PySide6.QtGui import QGuiApplication, QImage, QKeyEvent, QMouseEvent, QShader, QShaderVersion, QWheelEvent  # noqa: E402
from PySide6.QtQml import QQmlApplicationEngine  # noqa: E402
try:                                  # the built-in browser (the page is QtWebEngine's)
    from PySide6.QtWebEngineQuick import QtWebEngineQuick  # noqa: E402
except ImportError:
    QtWebEngineQuick = None
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
        if '--shot' in sys.argv or '--theme-shots' in sys.argv:
            env['LUDUS_QT_FAKE_DEVICES'] = '1'      # no real Wi-Fi, Bluetooth or sound on a build machine
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


def bake_cal_shader():
    """The display calibration shader (qml/calibrate.frag), built here for this machine's graphics with
    Qt's own shader tools. Returns its file address, or '' if it can't be built: the screen is then drawn
    without the correction (the full Ludus's page draws it with an SVG filter instead)."""
    built = os.path.join(HERE, 'qml', 'calibrate.frag.qsb')      # built ahead (qsb), when the image has it
    if os.path.exists(built):
        return QUrl.fromLocalFile(built).toString()
    try:
        import tempfile
        from PySide6.QtShaderTools import QShaderBaker
        baker = QShaderBaker()
        baker.setSourceFileName(os.path.join(HERE, 'qml', 'calibrate.frag'))
        baker.setGeneratedShaderVariants([QShader.StandardShader])
        baker.setGeneratedShaders([
            (QShader.SpirvShader, QShaderVersion(100)),
            (QShader.GlslShader, QShaderVersion(150)),
            (QShader.GlslShader, QShaderVersion(120)),
            (QShader.GlslShader, QShaderVersion(100, QShaderVersion.GlslEs)),
            (QShader.HlslShader, QShaderVersion(50)),
            (QShader.MslShader, QShaderVersion(12)),
        ])
        shader = baker.bake()
        if not shader.isValid():
            print('ludus-qt: the calibration shader did not build:', baker.errorMessage(), flush=True)
            return ''
        out = os.path.join(tempfile.gettempdir(), 'ludus-calibrate-%d.frag.qsb' % os.getuid())
        with open(out, 'wb') as f:
            f.write(bytes(shader.serialized()))
        print('ludus-qt: the calibration shader is built', flush=True)
        return QUrl.fromLocalFile(out).toString()
    except Exception as e:  # noqa: BLE001 - without it the screen simply isn't corrected
        print('ludus-qt: the calibration shader is not available:', e, flush=True)
        return ''


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


BROWSER_DIR = os.path.join(os.environ.get('XDG_DATA_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'share'),
                           'tessera-ludus-qt', 'browser')
SYNTHETIC = 0x7e57                     # marks key events sent for the page, so the Esc watch ignores them
KEYS = {'UP': Qt.Key_Up, 'DOWN': Qt.Key_Down, 'LEFT': Qt.Key_Left, 'RIGHT': Qt.Key_Right, 'ENTER': Qt.Key_Return,
        'ESC': Qt.Key_Escape, 'TAB': Qt.Key_Tab, 'PAGEUP': Qt.Key_PageUp, 'PAGEDOWN': Qt.Key_PageDown}
KEY_TEXT = {'ENTER': '\r', 'TAB': '\t'}


def forget_browser(partition):
    """A removed profile's browser data goes with it (the full Ludus clears the partition)."""
    m = re.fullmatch(r'persist:tessera-browser(?:-([A-Za-z0-9_-]+))?', str(partition or ''))
    if m:
        shutil.rmtree(os.path.join(BROWSER_DIR, m.group(1) or 'main'), ignore_errors=True)


class BrowserInput(QObject):
    """The pointer and keys the full Ludus's own browser code works out (sticks, triggers, the pad's
    direction buttons) arrive as events in Electron's shape; they are played into the page as real
    mouse and key events on the window. It also watches for Esc held with Left/Right (tab switching
    from inside the page, which has the keyboard); Esc on its own still reaches the page."""
    tab = Signal(int)

    def __init__(self):
        super().__init__()
        self.win = None
        self.ox = 0.0
        self.oy = 0.0
        self.active = False
        self.esc = False
        self.held = Qt.NoButton

    def attach(self, window):
        self.win = window
        window.installEventFilter(self)

    @Slot(float, float)
    def setOrigin(self, x, y):
        self.ox, self.oy = x, y

    @Slot(bool)
    def setActive(self, on):
        self.active = bool(on)
        self.esc = False

    def eventFilter(self, obj, ev):
        if not self.active or not isinstance(ev, QKeyEvent) or ev.nativeScanCode() == SYNTHETIC:
            return False
        if ev.key() == Qt.Key_Escape:
            self.esc = ev.type() == QEvent.KeyPress
        elif self.esc and ev.key() in (Qt.Key_Left, Qt.Key_Right):
            if ev.type() == QEvent.KeyPress:
                self.tab.emit(-1 if ev.key() == Qt.Key_Left else 1)
            return True
        return False

    def play(self, e):
        if not self.active or self.win is None or not isinstance(e, dict):
            return
        t = e.get('type')
        try:
            if t in ('mouseMove', 'mouseDown', 'mouseUp'):
                pos = QPointF(self.ox + float(e.get('x', 0)), self.oy + float(e.get('y', 0)))
                gp = QPointF(self.win.mapToGlobal(QPoint(int(pos.x()), int(pos.y()))))
                b = Qt.RightButton if e.get('button') == 'right' else Qt.LeftButton
                if t == 'mouseDown':
                    self.held = b
                    ev = QMouseEvent(QEvent.MouseButtonPress, pos, gp, b, self.held, Qt.NoModifier)
                elif t == 'mouseUp':
                    self.held = Qt.NoButton
                    ev = QMouseEvent(QEvent.MouseButtonRelease, pos, gp, b, Qt.NoButton, Qt.NoModifier)
                else:
                    ev = QMouseEvent(QEvent.MouseMove, pos, gp, Qt.NoButton, self.held, Qt.NoModifier)
            elif t == 'mouseWheel':
                pos = QPointF(self.ox + float(e.get('x', 0)), self.oy + float(e.get('y', 0)))
                gp = QPointF(self.win.mapToGlobal(QPoint(int(pos.x()), int(pos.y()))))
                dx, dy = float(e.get('deltaX', 0)), float(e.get('deltaY', 0))
                ev = QWheelEvent(pos, gp, QPoint(int(dx), int(dy)), QPoint(int(dx * 1.2), int(dy * 1.2)),
                                 Qt.NoButton, Qt.NoModifier, Qt.NoScrollPhase, False)
            elif t in ('keyDown', 'keyUp'):
                name = str(e.get('keyCode', ''))
                if name not in KEYS:
                    return
                kind = QEvent.KeyPress if t == 'keyDown' else QEvent.KeyRelease
                ev = QKeyEvent(kind, KEYS[name], Qt.NoModifier, SYNTHETIC, 0, 0, KEY_TEXT.get(name, '') if kind == QEvent.KeyPress else '')
            else:
                return
        except (TypeError, ValueError):
            return
        QCoreApplication.postEvent(self.win, ev)


class PadState(QObject):
    """What the controller touched last reports right now (pads.py), for the controller test."""
    captured = Signal(int)

    def __init__(self, fake=False):
        super().__init__()
        self.pads = None
        self.fake = fake

    @Slot('QVariant')
    def setPad(self, pad):
        """The person's controller settings (confirm button, button mapping): how buttons are read."""
        if self.pads is not None and isinstance(pad, dict):
            self.pads.padSettings = pad

    @Slot('QVariant')
    def capture(self, only):
        """The next button (as the job it does) comes back as `captured`; only: the jobs it takes ([] any)."""
        if self.pads is not None:
            roles = set(int(r) for r in only) if only else None
            self.pads.capturing = (lambda role: self.captured.emit(int(role)), roles)

    @Slot()
    def cancelCapture(self):
        if self.pads is not None:
            self.pads.capturing = None

    @Slot(float, float, int, result=bool)
    def rumble(self, strong, weak, ms):
        return bool(self.pads and not self.fake and self.pads.rumble(strong, weak, ms))

    @Slot(result='QVariant')
    def snapshot(self):
        if self.fake:      # a build machine has no controller: a made-up one, so the picture shows something
            b = [0.0] * 17
            b[0] = 1.0
            b[5] = 1.0
            b[6] = 0.6
            b[14] = 1.0
            return {'id': 'Tessera test pad (STANDARD GAMEPAD Vendor: 0000 Product: 0000)', 'name': 'Tessera test pad',
                    'buttons': b, 'axes': [0.5, -0.3, -0.2, 0.7], 'count': 1}
        return self.pads.snapshot() if self.pads else {}


def main():
    if check():
        sys.exit(3)
    print('ludus-qt: starting', flush=True)
    shot_dir = sys.argv[sys.argv.index('--shot') + 1] if '--shot' in sys.argv else None
    theme_dir = sys.argv[sys.argv.index('--theme-shots') + 1] if '--theme-shots' in sys.argv else None
    qa_dir = sys.argv[sys.argv.index('--qa') + 1] if '--qa' in sys.argv else None
    if QtWebEngineQuick is not None:
        if hasattr(os, 'geteuid') and os.geteuid() == 0:     # a build container: Chromium's sandbox needs a user
            os.environ.setdefault('QTWEBENGINE_CHROMIUM_FLAGS', '--no-sandbox')
        QtWebEngineQuick.initialize()                      # before the application is made
    guide_only = '--guide' in sys.argv or os.environ.get('TESSERA_GUIDE_ONLY') == '1'
    if guide_only:
        os.environ['TESSERA_GUIDE_ONLY'] = '1'     # the main process (the bridge) is the full Ludus's own, which then makes its guide-only helper
    app = QGuiApplication(sys.argv)
    app.setApplicationName('Ludus')
    bridge = Bridge()
    session = Session()
    engine = QQmlApplicationEngine()
    engine.warnings.connect(lambda ws: [print('qml:', w.toString(), file=sys.stderr, flush=True) for w in ws])
    engine.addImageProvider('art', ArtProvider(bridge))
    engine.rootContext().setContextProperty('bridge', bridge)
    engine.rootContext().setContextProperty('session', session)
    engine.rootContext().setContextProperty('guideOnly', guide_only)
    engine.rootContext().setContextProperty('shotMode', bool(shot_dir or theme_dir or qa_dir))
    engine.rootContext().setContextProperty('webEngine', QtWebEngineQuick is not None)
    engine.rootContext().setContextProperty('browserDir', BROWSER_DIR)
    browser_input = BrowserInput()
    pad_state = PadState(fake=bool(shot_dir or theme_dir or qa_dir))
    engine.rootContext().setContextProperty('padState', pad_state)
    engine.rootContext().setContextProperty('browserInput', browser_input)
    engine.rootContext().setContextProperty('shellData', shell_data())
    engine.rootContext().setContextProperty('calShader', bake_cal_shader())
    engine.rootContext().setContextProperty('tabIcons', tab_icons())
    engine.rootContext().setContextProperty('settingIcons', setting_icons())
    engine.load(QUrl.fromLocalFile(os.path.join(HERE, 'qml', 'Main.qml')))
    if not engine.rootObjects():
        print('ludus-qt: the screen did not load', file=sys.stderr, flush=True)
        sys.exit(1)
    win = engine.rootObjects()[0]
    browser_input.attach(win)
    bridge.event.connect(lambda ch, data: browser_input.play(data) if ch == 'browser-input' else forget_browser((data or {}).get('partition')) if ch == 'browser-forget' else None)
    bridge.gone.connect(app.quit)   # the main process ended (a restart, Opus): so does the screen
    if shot_dir:
        code = shots(app, win, shot_dir)
    elif theme_dir:
        code = theme_shots(app, win, theme_dir)
    elif qa_dir:
        code = qa_checks(app, win)
    else:
        controllers = pads.Pads(lambda a: QTimer.singleShot(0, lambda: QMetaObject.invokeMethod(win, 'padAct', Q_ARG('QVariant', a))))
        # While a game runs the main process hides the screen; the game reads its controllers itself.
        controllers.paused = guide_only     # the helper reads no pad until its guide is up
        def window_op(op):
            controllers.paused = op == 'hide'
            QMetaObject.invokeMethod(win, 'windowOp', Q_ARG('QVariant', op))
        bridge.windowOp.connect(window_op)
        pad_state.pads = controllers
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
            elif a.startswith('run:'):
                QMetaObject.invokeMethod(win, 'shotRun', Q_ARG('QVariant', a[4:]))
            elif a.startswith('theme:'):
                QMetaObject.invokeMethod(win, 'useTheme', Q_ARG('QVariant', a[6:]))
                pause = 1800   # the theme, then its background picture
            else:
                QMetaObject.invokeMethod(win, 'padAct', Q_ARG('QVariant', a))
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


def qa_checks(app, win):
    """Qt counterparts of the full Ludus's QA checks that are about the screen (qa/keyboard.cjs, input.cjs,
    guide.cjs): what a key does, the key layouts, the guide. (What the main process decides is checked by
    the full Ludus's own qa/ checks: it is the same code.) Each check is (name, actions, probe, expected);
    an action is a press, '@page', 'run:id' or 'key:QtKeyName:linux key number' (a key at a place on the
    keyboard, as an AZERTY or a QWERTY keyboard would report it)."""
    KC = {'Q': 16, 'W': 17, 'E': 18, 'A': 30, 'S': 31, 'D': 32, 'Z': 44}     # Linux key numbers of keys by where they are on a QWERTY keyboard
    checks = [
        ('Library is shown', ['@library'], 'tab', None),
        ('Back goes up to the tabs', ['b'], 'base', None),
        ('Hints show the controller buttons once a pad is used', ['run:_pad'], 'hint', 'A|LB|A'),
        ('Right arrow moves to the next tab', ['key:Key_Right:106'], 'tab', '{b1}/tabs'),
        ('After a key, hints show keys', [], 'hint', 'Enter|PgUp|Enter'),
        ('After the mouse, A reads Click', ['run:_mouse'], 'hint', 'Click|PgUp|Click'),
        ('Pointing at a tile selects it', ['run:_point:0:1'], 'sel', 'content/0/1'),
        ('The guide (a menu) is opened', ['key:Key_F1:59'], 'menu', 'open'),
        ('With a menu open the pointer leaves the selection alone', ['run:_point:0:0'], 'sel', 'content/0/1'),
        ('B closes that menu', ['b'], 'menu', 'closed'),
        ('and B again goes back up to the tabs', ['b'], 'area', 'tabs'),
        ('Hints follow the pad again after a button', ['run:_pad'], 'hint', 'A|LB|A'),
        ('Confirm on the right button: the hints swap A and B', ['run:_conf:right'], 'hint', 'B|LB|B'),
        ('and back to the bottom button', ['run:_conf:bottom'], 'hint', 'A|LB|A'),
        ('Button mapping: the bumpers are swapped', ['run:_remap:swap'], 'area', 'tabs'),
        ('and the hints say RB where LB was', [], 'hint', 'A|RB|A'),
        ('Clearing the mapping', ['run:_remap:none'], 'area', 'tabs'),
        ('puts them back', [], 'hint', 'A|LB|A'),
        ('The standard layout has no WASD: D does nothing', ['key:Key_D:32'], 'tab', '{b1}/tabs'),
        ('Q / E are not bound in the standard layout; PgUp and [ switch tabs', ['key:Key_Q:16', 'key:Key_PageUp:104'], 'tab', '{b}/tabs'),
        ('The WASD layout is chosen', ['run:_kb-wasd'], 'keys', '["up","left","left","a"]'),
        ('WASD: D moves to the next tab', ['key:Key_D:32'], 'tab', '{b1}/tabs'),
        ('WASD: A moves back', ['key:Key_A:30'], 'tab', '{b}/tabs'),
        ('Keys count by where they are: on AZERTY the key in the A place reports Q, and still means left', ['key:Key_D:32', 'key:Key_Q:30'], 'tab', '{b}/tabs'),
        ('The place of a key is told apart from its letter (Z reported, W place)', [], 'key', None),
        ('Guide key (F1) opens the guide', ['key:Key_F1:59'], 'guide', 'open/side'),
        ('B closes it', ['b'], 'guide', 'closed/'),
        ('and the menu is gone', [], 'menu', 'closed'),
        ('The floating guide is a card in the middle', ['run:_guide-float'], 'guide', 'open/float'),
        ('The compact guide is a narrow panel', ['run:_guide-compact'], 'guide', 'open/compact'),
        ('Install and Recover: a question from the flow opens as a menu', ['run:_flowui-pick'], 'menu', 'open'),
        ('and an answer closes it', ['a'], 'menu', 'closed'),
        ('Their progress screen stays up when B is pressed', ['run:_flowui-progress', 'b'], 'menu', 'open'),
        ('and goes when the flow ends', ['run:_flowui-end'], 'menu', 'closed'),
        ('Pressing a key to bind it: the key comes back by its place', ['run:_keycap', 'key:Key_J:36'], 'cap', 'KeyJ'),
        ('Esc cancels the capture', ['run:_keycap', 'key:Key_Escape:1'], 'cap', 'none'),
        ('Back to the standard layout', ['b', 'run:_kb-standard'], 'keys', '["","","left","a"]'),
    ]
    failed = []
    state = {'i': 0}

    def key(name, evdev):
        k = getattr(Qt, name)
        QCoreApplication.postEvent(win, QKeyEvent(QEvent.KeyPress, k, Qt.NoModifier, evdev + 8, 0, 0, ''))
        QCoreApplication.postEvent(win, QKeyEvent(QEvent.KeyRelease, k, Qt.NoModifier, evdev + 8, 0, 0, ''))

    def step():
        if state['i'] >= len(checks):
            print('qa: %d checks, %d failed' % (len(checks), len(failed)), flush=True)
            app.exit(1 if failed else 0)
            return
        name, acts, probe, want = checks[state['i']]
        state['i'] += 1
        for a in acts:
            if a.startswith('@'):
                QMetaObject.invokeMethod(win, 'shotView', Q_ARG('QVariant', a[1:]))
            elif a.startswith('run:'):
                QMetaObject.invokeMethod(win, 'shotRun', Q_ARG('QVariant', a[4:]))
            elif a.startswith('key:'):
                _, k, n = a.split(':')
                key(k, int(n))
            else:
                QMetaObject.invokeMethod(win, 'padAct', Q_ARG('QVariant', a))

        def check():
            if probe == 'key':    # the Qt key says Z, the place says W: the place wins
                win.setProperty('qaKey', {'key': int(Qt.Key_Z), 'nativeScanCode': KC['W'] + 8, 'modifiers': 0})
            QMetaObject.invokeMethod(win, 'qaProbe', Q_ARG('QVariant', 'tab' if probe == 'base' else probe))
            got = win.property('qaOut')
            if want is None and probe == 'tab':
                print('ok   ' + name, flush=True)
                QTimer.singleShot(50, step)
                return
            if probe == 'base':       # where the Library tab is: the later checks count from there
                parts = got.split('/')
                state['b'] = int(parts[0]) if len(parts) == 2 and parts[0].isdigit() else -99
                want_ = '%d/tabs' % state['b']
            elif probe == 'key':
                want_ = 'KeyW'
            else:
                want_ = want.format(b=state['b'], b1=state['b'] + 1)
            ok = got == want_
            print(('ok   ' if ok else 'FAIL ') + name + ('' if ok else '  (got %r, wanted %r)' % (got, want_)), flush=True)
            if not ok:
                failed.append(name)
            QTimer.singleShot(50, step)
        QTimer.singleShot(1800 if probe == 'guide' else 700, check)
    QTimer.singleShot(2500, step)
    return app.exec()


def shots(app, win, out):
    """The screens a controller walks through, on the sample library (tools/ludus-qt-test/sample.py:
    games, apps, and the mosaic "Couch co-op" with the folder "Party night" in it)."""
    steps = [('01-library', ['@library']), ('02-options', ['y']), ('03-add-to-which-mosaic', ['down', 'a']),
             ('04-mosaic', ['b', '@m:couch']), ('05-folder', ['right', 'right', 'a']),
             ('06-mosaic-options-from-tabs', ['b', 'b', 'y']), ('07-delete-confirm', ['down', 'down', 'down', 'a']),
             ('08-keyboard', ['b', 'right', 'a']), ('09-settings', ['b', 'right', 'down']),
             ('10-home', ['@home']), ('11-tabs-browser', ['@tabs', 'left', 'left']),
             ('12-wifi', ['@settings', 'a']), ('13-wifi-password', ['down', 'down', 'down', 'a']),
             ('', ['b']), ('', ['b']), ('', ['right']), ('14-bluetooth', ['a']),
             ('', ['b']), ('', ['down']), ('15-sound', ['a']), ('16-sound-volume', ['right', 'right']),
             ('', ['b']), ('', ['down']), ('17-keyboard-menu', ['a']), ('', ['b']), ('', ['left']), ('18-controller-menu', ['a']),
             ('', ['b']), ('', ['b']), ('', ['run:_storage']), ('', []), ('', []), ('19-storage', []),
             ('', ['b']), ('', ['run:_addons']), ('', []), ('20-addons', []),
             ('', ['b']), ('', ['run:_appearance']), ('', ['a']), ('', []), ('21-theme-settings', []),
             ('', ['b']), ('', ['b']), ('', ['run:_wheel']), ('', []), ('22-color-wheel', ['right', 'right', 'rb']),
             ('', ['b']), ('', ['run:_calfilter']), ('23-calibrated-screen', []),
             ('', ['run:_calfilter-off']), ('', ['run:_calib']), ('24-calibration-brightness', ['right', 'right']),
             ('', ['a', 'a', 'a']), ('25-calibration-gamma', []), ('', ['a']), ('26-calibration-balance', []),
             ('', ['b']), ('', ['b']), ('', ['run:_browser']), ('', []), ('', []), ('27-browser', []),
             ('', ['run:_browser-url']), ('', []), ('28-browser-address', []),
             ('', ['run:_padtest']), ('', []), ('29-controller-test', []),
             ('', ['run:_controls']), ('', []), ('30-button-mapping', []),
             ('', ['b', 'b']), ('', ['run:_grip']), ('', []), ('31-grip-order', []),
             ('', ['b']), ('', ['run:_guide']), ('', []), ('', []), ('32-guide', []),
             ('', ['b']), ('', ['run:_guide-float']), ('', []), ('', []), ('32b-guide-float', []),
             ('', ['b']), ('', ['run:_guide-compact']), ('', []), ('', []), ('32c-guide-compact', []),
             ('', ['b']), ('', ['run:_tour']), ('', []), ('33-tour-start', []), ('', ['a', 'a']), ('', []), ('34-tour-tabs', []), ('', ['a']), ('', []), ('36-tour-library', []), ('', ['a', 'a', 'a', 'a', 'a']), ('', []), ('35-tour-end', [])]
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
            steps.insert(len(steps) - 3, ('', ['run:_geom:' + name]))
            for n, v in ((2, 'home'), (3, 'library')):     # the guided tour, to put beside the full Ludus's
                steps += [('tour-%s-%s-%d' % (name, v, w), ['run:_tour:%d' % n]), ('', ['y'])]
        run_steps(app, win, out, steps, first=0)
    QTimer.singleShot(2500, start)
    return app.exec()


if __name__ == '__main__':
    main()
