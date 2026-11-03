#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Tessera's logo files, all drawn from here so they stay alike. Writes the SVGs; render.cjs turns
# them into PNGs. Needs fontTools and Inter Bold (the launcher's font) for the wordmark's letters,
# which are written out as shapes so the files never depend on a font being installed.
#
#   python3 tools/branding/make-logos.py && node tools/branding/render.cjs && node tools/branding/motion.cjs
#
# The symbol: a living mosaic (mosaic.py): stones of every size and shape, each a shade of its own.
# A real mosaic is never uniform, and neither are the people who build this: their differences are
# the point. The wordmark: "Tessera" in Inter Bold, its T built from six unequal stones.
import os, sys
sys.path.insert(0, os.path.dirname(__file__))
import mosaic
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
BR = os.path.join(ROOT, 'system_files/usr/share/tessera/branding')
OUT = os.path.join(ROOT, 'tools/branding/out')
FONT = os.environ.get('INTER_BOLD', '/usr/share/fonts/opentype/inter/Inter-Bold.otf')
L, P, M, G = '#b4a7ff', '#ffb3c7', '#8fe3cf', '#ffd98f'
INK_DARK = '#2a2638'   # letters on light backgrounds

def tile(x, y, w, rot, fill, h=None, rx=None):
    h = w if h is None else h
    rx = min(w, h) * 0.23 if rx is None else rx
    return (f'<rect x="{x - w / 2:.2f}" y="{y - h / 2:.2f}" width="{w:.2f}" height="{h:.2f}" rx="{rx:.2f}" '
            f'fill="{fill}" transform="rotate({rot} {x:.2f} {y:.2f})"/>')

# ---- the symbol (64 x 64): the mosaic
STONES = mosaic.pieces()
def symbol(colors=None, ox=0, oy=0, scale=1):
    return mosaic.svg_pieces(STONES, ox, oy, scale, mono=colors[0] if colors else None)

def svg(view, body, title='Tessera'):
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{view}"><title>{title}</title>{body}</svg>\n'

# ---- the wordmark, in font units (cap height = the T's height)
font = TTFont(FONT)
cmap, glyphs = font.getBestCmap(), font.getGlyphSet()
CAP = font['OS/2'].sCapHeight
TRACK = -0.02 * font['head'].unitsPerEm
def letters(text, x0, ink):
    pen = SVGPathPen(glyphs)
    x = x0
    for ch in text:
        g = cmap[ord(ch)]
        glyphs[g].draw(TransformPen(pen, (1, 0, 0, -1, x, CAP)))
        x += font['hmtx'][g][0] + TRACK
    return f'<path fill="{ink}" d="{pen.getCommands()}"/>', x

def tile_t(x0):
    # the T, six stones none alike: a bar of three (wide, wider, narrow) and a stem of two (short, tall)
    w = CAP / 3.2; g = w * 0.1
    bar = [(0.96, 1.00, -4, L), (1.20, 0.93, 3, P), (0.84, 1.04, 6, G)]
    out, x = [], 0.0
    for bw, bh, rot, c in bar:
        out.append(tile(x0 + (x + bw / 2) * w, (0.5 + (1 - bh) / 2 * 0.2) * w, bw * w, rot, c, bh * w))
        x += bw + 0.1
    stem = [(0.95, 0.95, -3, M, 1.1 + 0.475), (0.82, 1.05, 4, L, 2.15 + 0.525)]
    for sw, sh, rot, c, cy in stem:
        out.append(tile(x0 + 1.6 * w + (rot * 0.01) * w, cy * w, sw * w, rot, c, sh * w))
    return ''.join(out), x0 + 3 * w + 2 * g

def wordmark(ink):
    pad = CAP * 0.06
    t, x = tile_t(0)
    word, end = letters('essera', x + CAP * 0.05, ink)
    return f'{-pad:.0f} {-pad:.0f} {end - TRACK + 2 * pad:.0f} {CAP + 2 * pad:.0f}', t + word

def main():
    os.makedirs(OUT, exist_ok=True)
    w = lambda p, s: open(p, 'w').write(s)
    w(os.path.join(BR, 'tessera-logo.svg'), svg('0 0 64 64', symbol()))
    w(os.path.join(BR, 'tessera-logo-white.svg'), svg('0 0 64 64', symbol(['#ffffff'])))
    for name, ink in (('tessera-wordmark.svg', '#ffffff'), ('tessera-wordmark-dark.svg', INK_DARK)):
        view, body = wordmark(ink)
        w(os.path.join(BR, name), svg(view, body))
    # the launcher's app icon: the symbol on a dark rounded square
    w(os.path.join(ROOT, 'system_files/usr/share/icons/hicolor/scalable/apps/tessera.svg'),
      svg('0 0 128 128', '<rect width="128" height="128" rx="28" fill="#17151f"/>' + symbol(ox=20, oy=20, scale=88 / 64)))
    # Mortar's icon and the GitHub pictures are drawn from these too (render.cjs)
    w(os.path.join(OUT, 'app-icon.svg'),
      svg('0 0 512 512', '<rect width="512" height="512" rx="112" fill="#17151f"/>' + symbol(ox=80, oy=80, scale=352 / 64)))
    # the symbol's tiles for motion.cjs (the boot animation and the busy cursor)
    import json
    json.dump({'round': mosaic.ROUND, 'gap': mosaic.GAP, 'pieces': STONES},
              open(os.path.join(ROOT, 'tools/branding/symbol.json'), 'w'), indent=1)
    print('logo SVGs written')

if __name__ == '__main__':
    sys.exit(main())
