#!/usr/bin/env node
// SPDX-License-Identifier: GPL-3.0-or-later
// Tessera's security standards, checked (see SECURITY.md, "Our standards"). Run by GitHub on every
// push and pull request (.github/workflows/launcher-tests.yml); fails with the rule and the place.
//   node tools/security-check.cjs
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const L = 'system_files/usr/lib/tessera/launcher';
const problems = [];
const fail = (rule, where, what) => problems.push(`${rule}: ${where}${what ? ` (${what})` : ''}`);
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' }).split('\0').filter(Boolean);
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const valuesOnly = (s) => s.replace(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g, "''").replace(/`(?:[^`\\$]|\\.|\$(?!\{))*`/g, '``').replace(/`[^`]*`/g, (t) => (t.match(/\$\{[^}]*\}/g) || []).join(' '));
const isText = (f) => !/\.(png|jpe?g|gif|webp|ico|pf2|mp4|otf|ttf|woff2?|gz|zip|iso|img|fd)$/i.test(f) && !/system_files\/usr\/share\/icons\/Tessera\/cursors\//.test(f);

// 1. No secrets in the repository: no key or environment files, no keys or tokens in any file.
const SECRET_FILE = /(^|\/)(\.env(\..*)?|id_rsa|id_ecdsa|id_ed25519|.*\.(pem|key|p12|pfx|keystore|jks))$/i;
for (const f of tracked) if (SECRET_FILE.test(f)) fail('No secret files in Git', f);
const SECRET_TEXT = /-----BEGIN (RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gh[osu]_[A-Za-z0-9]{30,}|sk-ant-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}/;
for (const f of tracked.filter(isText)) {
  let t; try { t = read(f); } catch { continue; }
  if (f === 'tools/security-check.cjs') continue;
  const m = SECRET_TEXT.exec(t);
  if (m) fail('No keys or tokens in files', f, m[0].slice(0, 24) + '…');
}
// 2. ...and .gitignore keeps them out
const ignore = read('.gitignore');
for (const p of ['.env', '.env.*', '*.key', '*.pem', '*.p12', '*.pfx', 'id_rsa*', 'id_ed25519*', 'cosign.key']) {
  if (!ignore.split('\n').map((l) => l.trim()).includes(p)) fail('.gitignore covers secret files', '.gitignore', `missing ${p}`);
}

// The launcher's own code (not its tests)
const app = tracked.filter((f) => f.startsWith(L + '/') && /\.(js|cjs)$/.test(f) && !f.startsWith(L + '/test/') && !f.includes('/node_modules/'));
const lines = (f) => read(f).split('\n');
for (const f of app) {
  lines(f).forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    const code = line.replace(/\/\/.*$/, '');
    // 3. No shell: programs are started with their arguments as a list, never as one command string
    if (/shell\s*:\s*true/.test(code)) fail('No shell for commands', at);
    if (/(child_process|require\('child_process'\))\.exec(Sync)?\(|\bexecSync\(/.test(code) || /[^.\w]exec\(\s*['"`]/.test(code)) fail('No shell for commands', at, 'use execFile or spawn');
    // 4. No running text as code
    if (/\beval\s*\(|new Function\s*\(/.test(code)) fail('No eval', at);
    // 5. Electron's protections stay on
    if (/nodeIntegration\s*:\s*true|contextIsolation\s*:\s*false|sandbox\s*:\s*false|webSecurity\s*:\s*false|allowRunningInsecureContent\s*:\s*true|experimentalFeatures\s*:\s*true|webviewTag\s*:\s*true/.test(code)) fail('Electron protections on', at, code.trim().slice(0, 60));
    if (/openDevTools\(|remote-debugging|--inspect/.test(code)) fail('No debugging in production', at);
    // 6. Keep sensitive data out of logs
    if (/(console\.\w+|\w*[lL]og\w*)\([^)]*\b(password|passphrase|pin|pinHash|secret|token|psk)\b/i.test(valuesOnly(code)) && !/fs\.|readTail|logFile|LOG_DIR|catalog/.test(code)) fail('No secrets in logs', at, code.trim().slice(0, 70));
  });
  // 5b. every web contents: sandboxed, isolated, no Node, developer tools only when developing
  const t = read(f);
  for (const m of t.matchAll(/webPreferences\s*:\s*\{/g)) {
    let depth = 0, end = m.index + m[0].length - 1;
    for (; end < t.length; end++) { if (t[end] === '{') depth++; else if (t[end] === '}' && --depth === 0) break; }
    const block = t.slice(m.index, end + 1);
    const line = t.slice(0, m.index).split('\n').length;
    for (const need of [/sandbox\s*:\s*true/, /contextIsolation\s*:\s*true/, /nodeIntegration\s*:\s*false/, /devTools\s*:\s*config\.DEV/]) {
      if (!need.test(block)) fail('Electron protections on', `${f}:${line}`, `webPreferences without ${need.source.replace(/\\s\*/g, ' ').replace(/\\/g, '')}`);
    }
  }
}

// 7. Every request to the main process is checked for where it comes from: ipcGuard loads first.
const main = read(`${L}/main.js`);
const reqs = [...main.matchAll(/require\('\.\/main\/(\w+)'\)/g)].map((m) => m[1]);
if (reqs[0] !== 'config' || reqs[1] !== 'ipcGuard') fail('Requests checked for their sender', `${L}/main.js`, 'ipcGuard must be required right after config, before anything adds a handler');
if (!/event\.senderFrame === win\.webContents\.mainFrame/.test(read(`${L}/main/ipcGuard.js`))) fail('Requests checked for their sender', `${L}/main/ipcGuard.js`, 'main-frame check missing');

// 8. GitHub Actions are pinned to a commit, not a moving tag
for (const f of tracked.filter((x) => x.startsWith('.github/workflows/'))) {
  lines(f).forEach((line, i) => {
    const m = /^\s*-?\s*uses:\s*([^\s#]+)/.exec(line);
    if (m && !m[1].startsWith('./') && !/@[0-9a-f]{40}$/.test(m[1])) fail('Actions pinned to a commit', `${f}:${i + 1}`, m[1]);
  });
}

if (problems.length) {
  console.error(`Security standards: ${problems.length} problem(s)\n` + problems.map((p) => '  - ' + p).join('\n'));
  process.exit(1);
}
console.log('Security standards: all checks pass');
