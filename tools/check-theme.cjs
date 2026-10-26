#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Checks a Tessera theme.json against the launcher's own rules, so you can see what Tessera
// will accept, ignore or change before you copy the theme over.
//
//   node tools/check-theme.cjs ~/Tessera/Themes/my-theme/theme.json [more theme.json files]
//
// The rules are read straight out of the launcher's main.js (the same functions that load
// themes), so this never drifts from what Tessera actually does. Needs Node.js 18 or newer.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const MAIN = process.env.TESSERA_MAIN || path.resolve(__dirname, '../system_files/usr/lib/tessera/launcher/main.js');
const src = fs.readFileSync(MAIN, 'utf8');

// Pull a balanced {...} or [...] literal, or a whole function, out of main.js.
function literal(start) {
  const i = src.indexOf(start);
  if (i < 0) throw new Error(`main.js has no "${start}"`);
  const open = src.indexOf(start.trimEnd().endsWith('[') ? '[' : '{', i);
  let depth = 0;
  for (let k = open; k < src.length; k++) {
    if (src[k] === '[' || src[k] === '{') depth++;
    if (src[k] === ']' || src[k] === '}') { depth--; if (!depth) return src.slice(open, k + 1); }
  }
  throw new Error(`unbalanced ${start}`);
}
function func(name) {
  const i = src.indexOf(`function ${name}(`);
  if (i < 0) throw new Error(`main.js has no function ${name}`);
  let depth = 0;
  for (let k = src.indexOf('{', i); k < src.length; k++) {
    if (src[k] === '{') depth++;
    if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error(`unbalanced ${name}`);
}
const line = (name) => {
  const l = src.split('\n').find((x) => x.startsWith(`const ${name} `));
  if (!l) throw new Error(`main.js has no const ${name}`);
  return l;
};
const rules = new Function('path', [
  ...['THEME_ID_RE', 'SETTING_ID_RE', 'VAR_RE', 'SAFE_VALUE_RE', 'HEX_RE', 'STOCK_VARS', 'clip'].map(line),
  `const STOCK_THEME = ${literal('const STOCK_THEME = {')};`,
  `const BUILTIN_THEMES = ${literal('const BUILTIN_THEMES = [')};`,
  func('cleanSetting'), func('cleanValue'),
  'return { clip, THEME_ID_RE, SETTING_ID_RE, STOCK_THEME, BUILTIN_THEMES, cleanSetting, cleanValue };',
].join('\n'))(path);

let problems = 0;
const warn = (f, msg) => { problems++; console.log(`  ✗ ${msg}`); };
const note = (msg) => console.log(`  · ${msg}`);

const files = process.argv.slice(2);
if (!files.length) {
  console.log('usage: node tools/check-theme.cjs path/to/<theme-id>/theme.json …');
  process.exit(2);
}
for (const f of files) {
  console.log(f);
  const id = path.basename(path.dirname(path.resolve(f)));
  if (path.basename(f) !== 'theme.json') warn(f, 'the file must be called theme.json');
  if (!rules.THEME_ID_RE.test(id)) warn(f, `the folder name "${id}" is the theme id: use lowercase a-z, 0-9, ".", "_" or "-", starting with a letter or digit, at most 40 characters`);
  if (rules.BUILTIN_THEMES.some((t) => t.id === id)) warn(f, `"${id}" is a factory theme's id, so this folder is skipped: rename the folder`);
  let size = 0;
  try { size = fs.statSync(f).size; } catch { warn(f, 'cannot read the file'); continue; }
  if (size > 64 * 1024) warn(f, `the file is ${size} bytes; themes over 64 KB are skipped`);
  let m;
  try { m = JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { warn(f, `not valid JSON: ${e.message}`); continue; }
  if (!m || typeof m !== 'object' || Array.isArray(m)) { warn(f, 'the top level must be an object { … }'); continue; }
  for (const k of Object.keys(m)) if (!['name', 'author', 'defaults', 'settings'].includes(k)) note(`"${k}" is not used by Tessera (only name, author, defaults, settings are)`);
  const name = rules.clip(m.name, 40);
  note(`shows up as "${name || id}"${m.author ? ` by ${rules.clip(m.author, 60)}` : ''}`);
  if (typeof m.name === 'string' && m.name.trim().length > 40) note('the name is cut to 40 characters');

  const extra = [];
  const list = Array.isArray(m.settings) ? m.settings : [];
  if (m.settings !== undefined && !Array.isArray(m.settings)) warn(f, '"settings" must be a list [ … ]');
  if (list.length > 40) warn(f, `${list.length} settings; only the first 40 are read`);
  for (const s of list.slice(0, 40)) {
    const d = rules.cleanSetting(s);
    if (!d) { warn(f, `setting ${JSON.stringify(s && s.id)} is skipped (check its id, type, var and options)`); continue; }
    if (s.type === 'choice' && Array.isArray(s.options) && d.options.length < s.options.length) warn(f, `setting "${d.id}": ${s.options.length - d.options.length} option(s) dropped (labels needed; values may only use letters, digits, space and # . % ( ) , + -)`);
    if (s.default !== undefined && s.type !== 'image' && JSON.stringify(d.default) !== JSON.stringify(s.default)) warn(f, `setting "${d.id}": default ${JSON.stringify(s.default)} became ${JSON.stringify(d.default)}`);
    if (d.var && d.var.startsWith('--theme-')) note(`setting "${d.id}" sets ${d.var}; nothing in the launcher reads --theme-* variables yet, so it shows in Theme Settings but doesn't change the look`);
    const stock = rules.STOCK_THEME.settings.find((x) => x.id === d.id);
    if (stock) note(`setting "${d.id}" replaces the stock "${stock.label}" setting${stock.var && d.var !== stock.var ? ` — without "var": "${stock.var}" it no longer changes the look` : ''}`);
    extra.push(d);
  }
  const schema = rules.STOCK_THEME.settings.map((s) => ({ ...s }));
  for (const x of extra) { const at = schema.findIndex((s) => s.id === x.id); if (at >= 0) schema[at] = x; else schema.push(x); }

  const defs = m.defaults && typeof m.defaults === 'object' ? m.defaults : {};
  if (m.defaults !== undefined && (typeof m.defaults !== 'object' || Array.isArray(m.defaults))) warn(f, '"defaults" must be an object { … }');
  const entries = Object.entries(defs);
  if (entries.length > 80) warn(f, `${entries.length} defaults; only the first 80 are read`);
  let used = 0;
  for (const [k, v] of entries.slice(0, 80)) {
    const d = schema.find((s) => s.id === k);
    if (!d) { warn(f, `default "${k}" is not a setting, so it is ignored`); continue; }
    if (d.type === 'image') { warn(f, `default "${k}": pictures can't come from theme.json; pick one in Theme Settings`); continue; }
    const c = rules.cleanValue(d, v);
    if (c === undefined) {
      const want = d.type === 'choice' ? `one of ${d.options.map((o) => JSON.stringify(o.value)).join(', ')}`
        : d.type === 'color' ? 'a "#rrggbb" color' : d.type === 'toggle' ? 'true or false (no quotes)' : `a number from ${d.min} to ${d.max}`;
      warn(f, `default "${k}": ${JSON.stringify(v)} is not allowed, so the stock value is used. Expected ${want}`);
    } else if (c !== v) warn(f, `default "${k}": ${JSON.stringify(v)} becomes ${JSON.stringify(c)} (ranges snap to their step)`);
    else used++;
  }
  note(`${used} default(s) accepted, ${extra.length} setting(s) of its own`);
}
console.log(problems ? `\n${problems} problem(s).` : '\nLooks good.');
process.exit(problems ? 1 : 0);
