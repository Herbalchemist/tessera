#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
# Tessera's logo files, all drawn from here so they stay alike. Writes the SVGs; render.cjs turns
# them into PNGs. Needs fontTools and Inter Bold (the launcher's font) for the wordmark's letters,
# which are written out as shapes so the files never depend on a font being installed.
#
#   python3 tools/branding/make-logos.py && node tools/branding/render.cjs
#
# The symbol: one large tile with three smaller ones stepping down its side, each turned a little,
# like loose tesserae. The wordmark: "Tessera" in Inter Bold, its T built from five tiles.
import os, sys
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', '..'))
BR = os.path.join(ROOT, 'system_files/usr/share/tessera/branding')
OUT = os.path.join(ROOT, 'tools/branding/out')
FONT = os.environ.get('INTER_BOLD', '/usr/share/fonts/opentype/inter/Inter-Bold.otf')
L, P, M, G = '#b4a7ff', '#ffb3c7', '#8fe3cf', '#ffd98f'
INK_DARK = '#2a2638'   # letters on light backgrounds

def tile(x, y, w, rot, fill, rx=None):
    rx = w * 0.23 if rx is None else rx
    return (f'<rect x="{x - w / 2:.2f}" y="{y - w / 2:.2f}" width="{w:.2f}" height="{w:.2f}" rx="{rx:.2f}" '
            f'fill="{fill}" transform="rotate({rot} {x:.2f} {y:.2f})"/>')

# ---- the symbol (64 x 64)
SYMBOL = [(25, 25, 38, -5, L), (54, 16, 14, 12, P), (52, 36, 11.5, -6, M), (46, 53, 17, 9, G)]
def symbol(colors=None, ox=0, oy=0, scale=1):
    out = []
    for i, (x, y, w, r, c) in enumerate(SYMBOL):
        out.append(tile(ox + x * scale, oy + y * scale, w * scale, r, colors[i] if colors else c))
    return ''.join(out)

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
    w = CAP / 3.2; g = w * 0.1; step = w + g
    cx = [x0 + w / 2, x0 + w / 2 + step, x0 + w / 2 + 2 * step]
    cy = [w / 2, w / 2 + step, w / 2 + 2 * step]
    return ''.join([tile(cx[0], cy[0], w, -4, L), tile(cx[1], cy[0], w, 3, P), tile(cx[2], cy[0], w, 6, G),
                    tile(cx[1], cy[1], w, -3, M), tile(cx[1], cy[2], w, 4, L)]), x0 + 3 * w + 2 * g

def wordmark(ink):
    pad = CAP * 0.06
    t, x = tile_t(0)
    word, end = letters('essera', x + CAP * 0.05, ink)
    return f'{-pad:.0f} {-pad:.0f} {end - TRACK + 2 * pad:.0f} {CAP + 2 * pad:.0f}', t + word

def main():
    os.makedirs(OUT, exist_ok=True)
    w = lambda p, s: open(p, 'w').write(s)
    w(os.path.join(BR, 'tessera-logo.svg'), svg('0 0 64 64', symbol()))
    w(os.path.join(BR, 'tessera-logo-white.svg'), svg('0 0 64 64', symbol(['#ffffff'] * 4)))
    for name, ink in (('tessera-wordmark.svg', '#ffffff'), ('tessera-wordmark-dark.svg', INK_DARK)):
        view, body = wordmark(ink)
        w(os.path.join(BR, name), svg(view, body))
    # the launcher's app icon: the symbol on a dark rounded square
    w(os.path.join(ROOT, 'system_files/usr/share/icons/hicolor/scalable/apps/tessera.svg'),
      svg('0 0 128 128', '<rect width="128" height="128" rx="28" fill="#17151f"/>' + symbol(ox=20, oy=20, scale=88 / 64)))
    # Mortar's icon and the GitHub pictures are drawn from these too (render.cjs)
    w(os.path.join(OUT, 'app-icon.svg'),
      svg('0 0 512 512', '<rect width="512" height="512" rx="112" fill="#17151f"/>' + symbol(ox=80, oy=80, scale=352 / 64)))
    print('logo SVGs written')

if __name__ == '__main__':
    sys.exit(main())
