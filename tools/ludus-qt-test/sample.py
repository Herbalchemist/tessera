# SPDX-License-Identifier: GPL-3.0-or-later
# Writes the sample library the screenshots use: python3 sample.py DATA_DIR
import json
import os
import stat
import sys

d = sys.argv[1]
os.makedirs(os.path.join(d, 'games'), exist_ok=True)
items = []
for i, t in enumerate(['Hollow Run', 'Star Courier', 'Tiny Kart', 'Moss Garden', 'Night Signal', 'Pixel Brawl',
                       'Ocean Deep', 'Sky Forge', 'Ember Trail']):
    p = os.path.join(d, 'games', 'g%d' % i)
    open(p, 'w').write('#!/bin/sh\nexit 0\n')
    os.chmod(p, stat.S_IRWXU)
    items.append({'id': 'g%d' % i, 'kind': 'game', 'title': t, 'path': p})
items.append({'id': 'steam', 'kind': 'app', 'title': 'Steam', 'path': '/usr/bin/steam'})
lib = {'items': items, 'inlays': [],
       'categories': [{'id': '_home', 'title': 'Home', 'builtin': True, 'entries': []},
                      {'id': 'couch', 'title': 'Couch co-op', 'top': True, 'entries': ['g2', 'g5', 'party', 'g0']},
                      {'id': 'party', 'title': 'Party night', 'entries': ['g2', 'g5']}],
       'tabOrder': ['home', 'library', 'apps', 'm:couch'], 'recent': []}
json.dump(lib, open(os.path.join(d, 'library.json'), 'w'), indent=2)

# one add-on widget (the Qt checks load it): its script runs from its own file, and tries the network
w = os.path.join(d, 'Tessera', 'Widgets', 'qa-hello')
os.makedirs(w, exist_ok=True)
json.dump({'name': 'QA hello'}, open(os.path.join(w, 'manifest.json'), 'w'))
open(os.path.join(w, 'index.html'), 'w').write('<!doctype html><title>start</title><body style="margin:0;background:#2a6"><script src="w.js"></script>')
open(os.path.join(w, 'w.js'), 'w').write("fetch('http://127.0.0.1:9/').then(function () { document.title = 'leak' }, function () { document.title = 'ran' })")
