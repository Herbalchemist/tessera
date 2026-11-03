# SPDX-License-Identifier: GPL-3.0-or-later
# Tessera's symbol: a living mosaic. A real mosaic is never made of one size or one shape, so
# neither is this: a few big stones, many small ones, every one cut differently and a shade of its
# own, fitted together with grout between. It is a power diagram (a Voronoi diagram whose cells can
# be bigger or smaller) of hand-placed sites inside a rounded square, with the grout cut in and the
# corners softened. No randomness: the same sites always give the same symbol.
import math

# (x, y, size): where a stone sits and how big it wants to be, in the symbol's 64 x 64 space
SITES = [
    (19, 20, 15.0), (46, 13, 9.0), (57, 31, 7.2), (40, 34, 8.2), (23, 47, 9.6), (50, 52, 8.2),
    (7, 41, 5.4), (34, 7, 5.0), (60, 11, 4.6), (37, 55, 4.8), (11, 57, 4.8), (58, 59, 4.4), (48, 24, 4.9), (31, 32, 4.7),
]
PALETTE = ['#b4a7ff', '#ffb3c7', '#8fe3cf', '#ffd98f', '#8ec5ff']
GAP = 1.4      # grout between stones
ROUND = 1.1    # how soft a stone's corners are
SHADES = [0.0, 0.07, -0.06, 0.04, -0.03, 0.09, -0.08, 0.02, 0.06, -0.05, 0.03, -0.02, 0.08]


def clip(poly, a, b, c):
    """Keep the part of a convex polygon where a*x + b*y <= c."""
    out = []
    for i, p in enumerate(poly):
        q = poly[(i + 1) % len(poly)]
        dp, dq = a * p[0] + b * p[1] - c, a * q[0] + b * q[1] - c
        if dp <= 0:
            out.append(p)
        if (dp < 0 < dq) or (dq < 0 < dp):
            t = dp / (dp - dq)
            out.append((p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])))
    return out


def squircle(lo=1.0, hi=63.0, corner=17.0, steps=10):
    pts = []
    for cx, cy, a0 in ((hi - corner, lo + corner, -90), (hi - corner, hi - corner, 0), (lo + corner, hi - corner, 90), (lo + corner, lo + corner, 180)):
        for s in range(steps + 1):
            a = math.radians(a0 + 90 * s / steps)
            pts.append((cx + corner * math.cos(a), cy + corner * math.sin(a)))
    return pts


def cells():
    shape = squircle()
    out = []
    for i, (x, y, r) in enumerate(SITES):
        poly = list(shape)
        for j, (x2, y2, r2) in enumerate(SITES):
            if i != j:
                # power bisector: |p - s_i|^2 - r_i^2 <= |p - s_j|^2 - r_j^2
                poly = clip(poly, 2 * (x2 - x), 2 * (y2 - y), x2 * x2 + y2 * y2 - x * x - y * y - (r2 * r2 - r * r))
        out.append(poly)
    return out


def inset(poly, d):
    """Shrink a convex polygon by d (move every edge inward)."""
    n = len(poly)
    area = sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))
    sign = 1 if area > 0 else -1
    out = list(poly)
    for i in range(n):
        p, q = poly[i], poly[(i + 1) % n]
        ex, ey = q[0] - p[0], q[1] - p[1]
        ln = math.hypot(ex, ey)
        if ln < 1e-9:
            continue
        nx, ny = sign * ey / ln, -sign * ex / ln   # outward normal
        out = clip(out, nx, ny, nx * p[0] + ny * p[1] - d)
        if len(out) < 3:
            return []
    return out


def centroid(poly):
    return (sum(p[0] for p in poly) / len(poly), sum(p[1] for p in poly) / len(poly))


def area(poly):
    n = len(poly)
    return abs(sum(poly[i][0] * poly[(i + 1) % n][1] - poly[(i + 1) % n][0] * poly[i][1] for i in range(n))) / 2


def shade(hexcolor, k):
    r, g, b = (int(hexcolor[i:i + 2], 16) for i in (1, 3, 5))
    mix = (255, 255, 255) if k > 0 else (0, 0, 0)
    f = lambda v, m: max(0, min(255, round(v + (m - v) * abs(k))))
    return '#%02x%02x%02x' % (f(r, mix[0]), f(g, mix[1]), f(b, mix[2]))


def touching(a, b):
    """Two cells share a side when they have two corners in common (to a hair)."""
    return sum(1 for p in a for q in b if abs(p[0] - q[0]) < 1e-6 and abs(p[1] - q[1]) < 1e-6) >= 2 or \
        sum(1 for p in a for q in b if abs(p[0] - q[0]) < 0.05 and abs(p[1] - q[1]) < 0.05) >= 2


def pieces():
    """The stones: [{'pts': outline after grout and soft corners (inner polygon, draw with a round stroke of 2*ROUND),
    'slot': the same stone's spot, a little smaller, 'c': centre, 'color': ...}], biggest first."""
    raw = cells()
    n = len(raw)
    near = [[j for j in range(n) if j != i and raw[i] and raw[j] and touching(raw[i], raw[j])] for i in range(n)]
    order = sorted(range(n), key=lambda i: -area(raw[i]))
    color = {}
    for k, i in enumerate(order):   # neighbours never share a colour; otherwise the palette goes round
        taken = {color[j] for j in near[i] if j in color}
        color[i] = next((c for c in range(len(PALETTE)) if c not in taken), k % len(PALETTE))
    out = []
    for rank, i in enumerate(order):
        body = inset(raw[i], GAP / 2 + ROUND)
        if not body:
            continue
        out.append({
            'pts': [[round(x, 3), round(y, 3)] for x, y in body],
            'slot': [[round(x, 3), round(y, 3)] for x, y in inset(raw[i], GAP / 2 + ROUND + 0.9)],
            'c': [round(v, 3) for v in centroid(body)],
            'color': shade(PALETTE[color[i]], SHADES[rank % len(SHADES)]),
            'area': round(area(raw[i]), 1),
        })
    return out


def svg_pieces(pieces_, ox=0, oy=0, scale=1, mono=None):
    body = []
    for p in pieces_:
        pts = ' '.join(f'{ox + x * scale:.2f},{oy + y * scale:.2f}' for x, y in p['pts'])
        c = mono or p['color']
        body.append(f'<polygon points="{pts}" fill="{c}" stroke="{c}" stroke-width="{2 * ROUND * scale:.2f}" stroke-linejoin="round"/>')
    return ''.join(body)


if __name__ == '__main__':
    ps = pieces()
    print(len(ps), 'stones; areas', [p['area'] for p in ps])
