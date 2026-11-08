# SPDX-License-Identifier: GPL-3.0-or-later
"""Ludus (Qt): the library. Reads and writes the same library.json as the Electron Ludus, so you
can switch between them and keep everything: games, apps, mosaics and their order.

No Qt in here, so it can be tested on its own (tools/ludus-qt-test).
"""
import json
import os
import re
import secrets

DATA_DIR = os.environ.get('TESSERA_DATA_DIR') or os.path.join(
    os.environ.get('XDG_DATA_HOME') or os.path.join(os.path.expanduser('~'), '.local', 'share'), 'tessera')
LIBRARY_FILE = os.environ.get('LAUNCHER_LIBRARY') or os.path.join(DATA_DIR, 'library.json')
SETTINGS_FILE = os.path.join(DATA_DIR, 'settings.json')
HOME_ID = '_home'
TITLE_MAX = 60
NEXUS_SCRIPT = re.compile(r'(^|/)shortcuts/launch-(game|nexus)$')


def read_json(path):
    try:
        with open(path, encoding='utf-8') as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def locked_down(settings=None):
    """The things this first version doesn't have yet, which must never be bypassed: a PIN,
    profiles (and their guest limits). When any is set up, this version doesn't run and the
    full Ludus is used. Returns the reason, or None."""
    s = read_json(SETTINGS_FILE) if settings is None else settings
    if s.get('pin'):
        return 'a PIN is set'
    if isinstance(s.get('profiles'), list) and s['profiles']:
        return 'profiles are set up'
    return None


def is_xbox(item):
    args = item.get('args') if isinstance(item.get('args'), list) else []
    return item.get('xbox') is True or any(isinstance(a, str) and NEXUS_SCRIPT.search(a) for a in args)


def clean_title(t):
    t = re.sub(r'\s+', ' ', str(t or '')).strip()
    return t[:TITLE_MAX]


class Library:
    def __init__(self, path=None):
        self.path = path or LIBRARY_FILE
        self.data = {}
        self.load()

    # ---- the file
    def load(self):
        d = read_json(self.path)
        d.setdefault('items', [])
        d.setdefault('inlays', [])
        d.setdefault('categories', [])
        d.setdefault('tabOrder', [])
        d.setdefault('recent', [])
        for key in ('items', 'inlays', 'categories', 'tabOrder', 'recent'):
            if not isinstance(d[key], list):
                d[key] = []
        d['items'] = [i for i in d['items'] if isinstance(i, dict) and isinstance(i.get('id'), str)
                      and i.get('kind') in ('game', 'app') and isinstance(i.get('path'), str)]
        d['categories'] = [c for c in d['categories'] if isinstance(c, dict) and isinstance(c.get('id'), str)
                           and isinstance(c.get('title'), str) and isinstance(c.get('entries'), list)]
        if not any(c['id'] == HOME_ID for c in d['categories']):
            d['categories'].insert(0, {'id': HOME_ID, 'title': 'Home', 'builtin': True, 'entries': []})
        self.data = d

    def save(self):
        """Everything else in the file (other people's pages, the layout key) is kept as it was."""
        os.makedirs(os.path.dirname(self.path), exist_ok=True)
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            json.dump(self.data, f, indent=2)
        os.replace(tmp, self.path)   # a crash never leaves half a file

    # ---- lookups
    def item(self, id_):
        return next((i for i in self.data['items'] if i['id'] == id_), None)

    def cat(self, id_):
        return next((c for c in self.data['categories'] if c['id'] == id_), None)

    def mosaics(self):
        """The mosaics in tab order: your own order first, new ones at the end."""
        tops = ['m:' + c['id'] for c in self.data['categories'] if c.get('top') is True]
        order = [t for t in self.data['tabOrder'] if t in tops]
        order += [t for t in tops if t not in order]
        return [self.cat(t[2:]) for t in order]

    def tabs(self):
        out = [{'id': 'library', 'title': 'Library'}, {'id': 'apps', 'title': 'Apps'}]
        out += [{'id': 'm:' + c['id'], 'title': c['title']} for c in self.mosaics()]
        return out

    def tile(self, entry, inside=None):
        it = self.item(entry)
        if it:
            art = it.get('art') if isinstance(it.get('art'), str) and os.path.isfile(it.get('art')) else ''
            return {'id': it['id'], 'kind': it['kind'], 'title': it.get('title') or os.path.basename(it['path']),
                    'art': art, 'xbox': is_xbox(it)}
        c = self.cat(entry)
        if c and c['id'] != inside and not c.get('top'):
            return {'id': c['id'], 'kind': 'folder', 'title': c['title'], 'art': '', 'xbox': False,
                    'count': len(c['entries'])}
        return None   # an inlay (widget) or something gone: not shown in this version yet

    def tiles(self, where):
        """Tiles of a tab ('library', 'apps', 'm:<id>') or a folder ('f:<id>')."""
        if where in ('library', 'apps'):
            kind = 'game' if where == 'library' else 'app'
            items = sorted((i for i in self.data['items'] if i['kind'] == kind), key=lambda i: (i.get('title') or '').lower())
            return [self.tile(i['id']) for i in items]
        if where.startswith('m:') or where.startswith('f:'):
            c = self.cat(where[2:])
            if not c:
                return []
            return [t for t in (self.tile(e, c['id']) for e in c['entries'] if isinstance(e, str)) if t]
        return []

    # ---- changes (each one saves)
    def new_id(self, title):
        base = re.sub(r'[^a-z0-9]+', '-', title.lower()).strip('-')[:24] or 'mosaic'
        while True:
            cand = base + '-' + secrets.token_hex(3)
            if not self.cat(cand) and not self.item(cand):
                return cand

    def create_mosaic(self, title=''):
        title = clean_title(title) or 'Mosaic %d' % (len(self.mosaics()) + 1)
        c = {'id': self.new_id(title), 'title': title, 'top': True, 'entries': []}
        self.data['categories'].append(c)
        self.data['tabOrder'] = [t for t in self.data['tabOrder']] + ['m:' + c['id']]
        self.save()
        return c['id']

    def rename(self, cat_id, title):
        c = self.cat(cat_id)
        title = clean_title(title)
        if not c or c.get('builtin') or not title:
            return False
        c['title'] = title
        self.save()
        return True

    def delete_mosaic(self, cat_id):
        """The mosaic (or folder) goes; the games and apps in it stay in the library."""
        c = self.cat(cat_id)
        if not c or c.get('builtin'):
            return False
        self.data['categories'] = [x for x in self.data['categories'] if x['id'] != cat_id]
        for x in self.data['categories']:
            x['entries'] = [e for e in x['entries'] if e != cat_id]
        self.data['tabOrder'] = [t for t in self.data['tabOrder'] if t != 'm:' + cat_id]
        self.save()
        return True

    def add_to(self, cat_id, entry):
        c = self.cat(cat_id)
        if not c or entry == cat_id or not (self.item(entry) or self.cat(entry)):
            return False
        if entry not in c['entries']:
            c['entries'].append(entry)
            self.save()
        return True

    def remove_from(self, cat_id, entry):
        c = self.cat(cat_id)
        if not c or entry not in c['entries']:
            return False
        c['entries'] = [e for e in c['entries'] if e != entry]
        self.save()
        return True

    def move_tab(self, tab_id, d):
        order = ['m:' + c['id'] for c in self.mosaics()]
        if tab_id not in order:
            return False
        i = order.index(tab_id)
        j = max(0, min(len(order) - 1, i + d))
        order[i], order[j] = order[j], order[i]
        rest = [t for t in self.data['tabOrder'] if t not in order]
        self.data['tabOrder'] = rest + order
        self.save()
        return True

    def record_play(self, item_id):
        import time
        recent = [r for r in self.data['recent'] if isinstance(r, dict) and r.get('id') != item_id]
        self.data['recent'] = [{'id': item_id, 'at': int(time.time() * 1000)}] + recent[:19]
        self.save()

    def launch_command(self, item_id):
        """(argv, cwd) to start an item, or (None, the reason in words)."""
        it = self.item(item_id)
        if not it:
            return None, 'Unknown game.'
        if is_xbox(it):
            return None, 'Xbox games start from the full Ludus for now.'
        p = it['path']
        if not os.access(p, os.X_OK):
            return None, ("%s isn't marked executable." % os.path.basename(p)) if os.path.exists(p) \
                else "Can't find %s. Is the drive plugged in?" % os.path.basename(p)
        args = [a for a in (it.get('args') or []) if isinstance(a, str)]
        return [p] + args, os.path.dirname(p)
