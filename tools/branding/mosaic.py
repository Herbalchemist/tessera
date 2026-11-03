# SPDX-License-Identifier: GPL-3.0-or-later
# Tessera's symbol: a living mosaic. A real mosaic is never made of one size or one shape, so
# neither is this: a few big stones, many small ones, every one cut differently and a shade of its
# own, fitted together with grout between. It is a power diagram (a Voronoi diagram whose cells can
# be bigger or smaller) of hand-placed sites inside a rounded square, with the grout cut in and the
# corners softened. No randomness: the same sites always give the same symbol.
import math

# Stones sit on a loose spiral (a sunflower's seed pattern): big in the middle, smaller and
# smaller outward, a few tiny ones drifting off the edge. No frame: the outline is the stones.
COUNT, SPREAD, SHRINK, FIRST, REACH, TURN = 18, 6.6, 0.89, 13.0, 1.3, 80.0
SITES = []
for _i in range(COUNT):
    _rho, _th = SPREAD * math.sqrt(_i + 0.6), math.radians(_i * 137.508 + TURN)
    SITES.append((_rho * math.cos(_th), _rho * math.sin(_th), FIRST * SHRINK ** _i))
# one pastel for every stone (14, then they go round again), picked so neighbours differ
PALETTE = ['#b4a7ff', '#ffb3c7', '#8fe3cf', '#ffd98f', '#8ec5ff', '#ffb8a1', '#d3b3ff', '#a7e8f0',
           '#ffc9e6', '#c5e8a0', '#ffcf9e', '#a5b8ff', '#f5b0d8', '#9fe6b8']
GAP = 1.4      # grout between stones
ROUND = 1.1    # how soft a stone's corners are


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


def cells():
    out = []
    for i, (x, y, r) in enumerate(SITES):
        R = r * REACH
        poly = [(x + R * math.cos(2 * math.pi * k / 16 + i), y + R * math.sin(2 * math.pi * k / 16 + i)) for k in range(16)]
        for j, (x2, y2, r2) in enumerate(SITES):
            if i != j:
                # power bisector: |p - s_i|^2 - r_i^2 <= |p - s_j|^2 - r_j^2
                poly = clip(poly, 2 * (x2 - x), 2 * (y2 - y), x2 * x2 + y2 * y2 - x * x - y * y - (r2 * r2 - r * r))
        out.append(poly)
    xs, ys = [p[0] for c in out for p in c], [p[1] for c in out for p in c]
    cx, cy, k = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, 60 / max(max(xs) - min(xs), max(ys) - min(ys))
    return [[((x - cx) * k + 32, (y - cy) * k + 32) for x, y in c] for c in out]


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
    order = sorted(range(n), key=lambda i: -area(raw[i]))
    out = []
    for rank, i in enumerate(order):
        body = inset(raw[i], GAP / 2 + ROUND)
        if not body:
            continue
        out.append({
            'pts': [[round(x, 3), round(y, 3)] for x, y in body],
            'slot': [[round(x, 3), round(y, 3)] for x, y in inset(raw[i], GAP / 2 + ROUND + 0.9)],
            'c': [round(v, 3) for v in centroid(body)],
            'color': PALETTE[(rank * 5) % len(PALETTE)],
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
