#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Boots GRUB with Tessera's boot menu in QEMU (UEFI) and drives it with key presses, the way a
# person at the machine would. Screenshots go to OUT; what each start chose is read back from
# GRUB's settings file (the stand-in boot entries save tessera_booted there).
import os, socket, subprocess, sys, time, shutil
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
WORK, OUT = sys.argv[1], sys.argv[2]
os.makedirs(OUT, exist_ok=True)
CODE = '/usr/share/OVMF/OVMF_CODE_4M.fd'
VARS = '/usr/share/OVMF/OVMF_VARS_4M.fd'
results = []

def sh(*a, **k):
    return subprocess.run(a, check=True, capture_output=True, text=True, **k).stdout

def grubenv():
    sh('mcopy', '-o', '-i', f'{WORK}/env.img', '::/grubenv', f'{WORK}/grubenv.out')
    return dict(l.split('=', 1) for l in sh('grub-editenv', f'{WORK}/grubenv.out', 'list').splitlines() if '=' in l)

def set_env(**kv):
    sh('mcopy', '-o', '-i', f'{WORK}/env.img', '::/grubenv', f'{WORK}/grubenv.tmp')
    for k, v in kv.items():
        if v is None: sh('grub-editenv', f'{WORK}/grubenv.tmp', 'unset', k)
        else: sh('grub-editenv', f'{WORK}/grubenv.tmp', 'set', f'{k}={v}')
    sh('mcopy', '-o', '-i', f'{WORK}/env.img', f'{WORK}/grubenv.tmp', '::/grubenv')

class VM:
    def __init__(self, name):
        self.name = name
        self.sock = f'{WORK}/mon-{name}.sock'
        shutil.copy(VARS, f'{WORK}/vars-{name}.fd')
        self.p = subprocess.Popen(['qemu-system-x86_64', '-machine', 'q35', '-m', '512', '-display', 'none', '-vga', 'std',
            '-drive', f'if=pflash,format=raw,readonly=on,file={CODE}', '-drive', f'if=pflash,format=raw,file={WORK}/vars-{name}.fd',
            '-cdrom', f'{WORK}/system.iso', '-drive', f'file={WORK}/env.img,format=raw,if=virtio', '-monitor', f'unix:{self.sock},server,nowait', '-serial', f'file:{OUT}/{name}-serial.log', '-no-reboot'] +
            (['-enable-kvm'] if os.path.exists('/dev/kvm') and os.access('/dev/kvm', os.W_OK) else []),
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(100):
            if os.path.exists(self.sock): break
            time.sleep(0.1)
        self.n = 0
    def mon(self, cmd):
        s = socket.socket(socket.AF_UNIX); s.connect(self.sock); s.settimeout(2)
        try: s.recv(4096)
        except Exception: pass
        s.sendall((cmd + '\n').encode()); time.sleep(0.15)
        try: s.recv(65536)
        except Exception: pass
        s.close()
    def shot(self, label=None):
        f = f'{WORK}/{self.name}-shot.ppm'
        if os.path.exists(f): os.remove(f)
        self.mon(f'screendump {f}')
        for _ in range(50):
            if os.path.exists(f) and os.path.getsize(f) > 100: break
            time.sleep(0.05)
        time.sleep(0.1)
        im = Image.open(f).convert('RGB')
        if label:
            im.save(f'{OUT}/{self.name}-{label}.png')
        return im
    def key(self, k, times=1):
        for _ in range(times):
            self.mon(f'sendkey {k}'); time.sleep(0.25)
    def wait(self, pred, what, timeout=60):
        end = time.time() + timeout
        while time.time() < end:
            im = self.shot()
            if pred(im): return im
            time.sleep(0.25)
        self.shot('timeout-' + what.replace(' ', '-'))
        raise AssertionError(f'{self.name}: no {what} within {timeout}s')
    def stop(self):
        self.p.kill(); self.p.wait()

def count(im, rgb, tol=28, box=None):
    w, h = im.size
    region = im.crop(box) if box else im
    r0, g0, b0 = rgb
    return sum(1 for (r, g, b) in region.getdata() if abs(r - r0) <= tol and abs(g - g0) <= tol and abs(b - b0) <= tol)

def centre(im, s=160):
    w, h = im.size
    return (w // 2 - s // 2, h // 2 - s // 2, w // 2 + s // 2, h // 2 + s // 2)

SLOT = (99, 92, 140)      # the lavender dashes at 55% on black
ACCENT = (180, 167, 255)  # the highlight in Boot options
def band(im, top, bottom):
    w, h = im.size
    return (0, int(h * top), w, int(h * bottom))
# the wait screen: the dashed spots in the middle and the white wordmark near the bottom, nothing else
is_splash = lambda im: count(im, SLOT, 30, centre(im)) > 40 and count(im, (255, 255, 255), 30, band(im, 0.88, 1)) > 150 and count(im, (170, 170, 170), 40, band(im, 0, 0.3)) < 50
is_options = lambda im: count(im, ACCENT, 12) > 4000
is_booted = lambda im: count(im, (170, 170, 170), 60, band(im, 0, 0.15)) > 40 and count(im, SLOT, 30, centre(im)) < 10 and count(im, ACCENT, 12) < 500 and count(im, (255, 255, 255), 30, band(im, 0.88, 1)) < 50
is_plain = lambda im: count(im, ACCENT, 12) < 500 and count(im, SLOT, 30, centre(im)) < 10 and count(im, (170, 170, 170), 60) > 300

def scenario(name, steps, expect):
    set_env(tessera_booted=None, tessera_once=None, test_default=expect.get('default'))
    vm = VM(name)
    note = ''
    try:
        steps(vm)
    except Exception as e:  # keep going: the settings file says what was actually started
        note = f' [{e}]'
        try: vm.shot('end')
        except Exception: pass
    finally:
        time.sleep(1.5)
        vm.stop()
    env = grubenv()
    got = {k: env.get(k) for k in ('tessera_booted', 'tessera_once')}
    want = {'tessera_booted': expect['booted'], 'tessera_once': expect.get('once')}
    ok = got == want
    results.append(f"{'PASS' if ok else 'FAIL'} {name}: {got}" + ('' if ok else f' (expected {want})') + note)
    print(results[-1], flush=True)

def wait_boot(vm, label='booted'):
    try: vm.wait(is_booted, 'started system', 30)
    finally: vm.shot(label)

def s_wait(vm):
    vm.wait(is_splash, 'wait screen'); time.sleep(0.6); vm.shot('wait-screen'); wait_boot(vm)
def s_desktop(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.shot('boot-options')
    vm.key('down', 2); vm.shot('boot-options-desktop'); vm.key('ret'); wait_boot(vm)
def s_previous(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.key('down'); vm.key('ret'); wait_boot(vm)
def s_f2(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('f2'); vm.wait(is_options, 'Boot options'); vm.shot('boot-options-f2')
    vm.key('down', 6); vm.shot('boot-options-lower'); vm.key('up', 6); vm.key('ret'); wait_boot(vm)
def s_safe(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.key('down', 3); vm.key('ret'); wait_boot(vm)
def s_console(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.key('down', 4); vm.key('ret'); wait_boot(vm)
def s_versions(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.key('down', 5); vm.key('ret')
    time.sleep(2); vm.shot('all-versions'); vm.key('down'); time.sleep(0.5); vm.shot('all-versions-second'); vm.key('ret'); wait_boot(vm)
def s_full(vm):
    # Boot options > Full boot menu: GRUB's own list (anything else on the machine is there too)
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.key('down', 6); vm.key('ret')
    vm.wait(is_plain, 'full menu', 15); vm.shot('full-menu'); vm.key('ret'); wait_boot(vm)
def s_options_back(vm):
    # Esc in Boot options goes back to the wait screen's menu; Enter there starts Tessera
    vm.wait(is_splash, 'wait screen'); vm.key('o'); vm.wait(is_options, 'Boot options'); vm.key('esc')
    vm.wait(is_splash, 'wait screen again', 15); vm.shot('back-from-options'); vm.key('ret'); wait_boot(vm)
def s_enter(vm):
    vm.wait(is_splash, 'wait screen'); vm.key('ret'); wait_boot(vm)
def s_fallback(vm):
    # after a failed update GRUB's own fallback picks entry 1: Tessera's menu stays out of the way
    vm.wait(lambda im: is_plain(im) or is_booted(im), 'GRUB menu', 60); vm.shot('fallback-menu'); wait_boot(vm)

scenario('wait', s_wait, {'booted': 'ostree:0'})
scenario('enter', s_enter, {'booted': 'ostree:0'})
scenario('desktop-this-time', s_desktop, {'booted': 'ostree:0', 'once': 'desktop'})
scenario('safe-this-time', s_safe, {'booted': 'ostree:0', 'once': 'safe'})
scenario('console-this-time', s_console, {'booted': 'ostree:0', 'once': 'console'})
scenario('previous-version', s_previous, {'booted': 'ostree:1'})
scenario('f2-and-scroll', s_f2, {'booted': 'ostree:0'})
scenario('all-versions', s_versions, {'booted': 'ostree:1'})
scenario('full-boot-menu', s_full, {'booted': 'ostree:0'})
scenario('options-esc-back', s_options_back, {'booted': 'ostree:0'})
scenario('failed-update-fallback', s_fallback, {'booted': 'ostree:1', 'default': '1'})

open(f'{OUT}/results.txt', 'w').write('\n'.join(results) + '\n')
sys.exit(0 if all(r.startswith('PASS') for r in results) else 1)
