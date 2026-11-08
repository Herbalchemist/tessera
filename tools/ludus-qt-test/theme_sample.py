# SPDX-License-Identifier: GPL-3.0-or-later
# Writes the library qa/theme-shots.cjs gives the full Ludus, so Ludus (Qt) can be drawn on the same
# data and the pictures put side by side: python3 theme_sample.py DATA_DIR
import json
import os
import sys

d = sys.argv[1]
os.makedirs(d, exist_ok=True)
json.dump({'firstRunDone': True, 'kb': {'hints': 'controller'}}, open(os.path.join(d, 'settings.json'), 'w'))
titles = ['Starfall', 'Coastal Circuit', 'Lantern Quest', 'Deep Orbit', 'Pixel Garden', 'Moonlight Rally', 'Cloudbound',
          'Neon Frontier', 'Ember Keep', 'Tidal Drift']
games = [{'id': 'g%d' % i, 'title': t, 'kind': 'game', 'path': '/usr/bin/true'} for i, t in enumerate(titles)]
json.dump({
    'items': games + [{'id': 'app0', 'title': 'Files', 'kind': 'app', 'path': '/usr/bin/true'},
                      {'id': 'app1', 'title': 'Music', 'kind': 'app', 'path': '/usr/bin/true'}],
    'inlays': [{'id': 'clock0', 'type': 'clock'}, {'id': 'cpu0', 'type': 'cpu'}, {'id': 'ram0', 'type': 'ram'}],
    'categories': [
        {'id': '_home', 'title': 'Home', 'builtin': True, 'entries': ['clock0', 'cpu0', 'ram0']},
        {'id': 'favorites', 'title': 'Favorites', 'top': True, 'entries': ['g0', 'g1', 'g2', 'g3', 'g4', 'g5']},
        {'id': 'racing', 'title': 'Racing', 'entries': ['g1', 'g5', 'g9']},
    ],
}, open(os.path.join(d, 'library.json'), 'w'))
