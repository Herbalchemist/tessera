// SPDX-License-Identifier: GPL-3.0-or-later
// Software updates through bootc: check, apply, roll back.
// Part of the launcher's main process (see main.js for the order the parts load in).

// What the other parts use, as live views (so a value reassigned here is seen there).
module.exports = {
  get ctlWhy() { return ctlWhy; },
  get fetchStatus() { return fetchStatus; },
  get lastLine() { return lastLine; },
  get LAUNCHER_VERSION() { return LAUNCHER_VERSION; },
  get parseApply() { return parseApply; },
  get parseCheck() { return parseCheck; },
  get readNote() { return readNote; },
  get rolledBackNow() { return rolledBackNow; }, set rolledBackNow(v) { rolledBackNow = v; },
  get runningJob() { return runningJob; },
  get shortText() { return shortText; },
  get sysctl() { return sysctl; },
  get unitProps() { return unitProps; },
  get UPDATE_PROBLEM() { return UPDATE_PROBLEM; },
  get UPDATE_START_GRACE_MS() { return UPDATE_START_GRACE_MS; },
  get UPDATE_UNIT() { return UPDATE_UNIT; },
  get updateErrorText() { return updateErrorText; },
  get updateInfo() { return updateInfo; },
  get upJob() { return upJob; }, set upJob(v) { upJob = v; },
};

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

// ------------------------------------------------------------ software updates
// Settings > Update software swaps in the newest system image with `bootc upgrade`, which needs
// root. The launcher never runs that itself. It starts three fixed systemd jobs
// (tessera-update-status, -check, -apply and -rollback, in usr/lib/systemd/system) that a polkit rule
// lets whoever is at the console start and stop, and it reads the notes those jobs leave in UPDATE_DIR.
// Nothing the page sends ever reaches a command line: it can only ask for "check", "apply" or "rollback".
const UPDATE_DIR = process.env.TESSERA_UPDATE_DIR || '/run/tessera-update';
const SYSTEMCTL = process.env.TESSERA_SYSTEMCTL || 'systemctl';
const UPDATE_UNIT = { status: 'tessera-update-status.service', check: 'tessera-update-check.service', apply: 'tessera-update-apply.service', rollback: 'tessera-update-rollback.service' };
const UPDATE_START_GRACE_MS = 15000; // how long a queued job may take to begin
const LAUNCHER_VERSION = (() => {
  try { return String(JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')).version || '').slice(0, 24); } catch { return ''; }
})();
let upJob = null; // the job being followed: { kind, unit, before, startedAt, seen, canceled }
let rolledBackNow = false; // a rollback was queued by this program: asking again would flip it back

const sysctl = (args, timeout = 15000) => new Promise((resolve) => {
  execFile(SYSTEMCTL, ['--no-ask-password', ...args], { timeout, encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } }, (err, stdout, stderr) => {
    resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || '') });
  });
});
// Why a systemctl call failed, in words for the person at the TV.
function ctlWhy(r) {
  const t = `${r.err}\n${r.out}`;
  if (/not found|not-found|could not be found/i.test(t)) return 'missing';
  if (/access denied|authentication|not authorized|permission denied/i.test(t)) return 'denied';
  return 'failed';
}
const UPDATE_PROBLEM = {
  missing: "Updates aren't set up on this system yet.",
  denied: "This account isn't allowed to run updates.",
  failed: "Couldn't start the update.",
  unreadable: "This system can't update itself here. It needs to be running a Tessera image.",
};
async function unitProps(unit) {
  const r = await sysctl(['show', unit, '-p', 'ActiveState,Result,InvocationID,LoadState'], 5000);
  if (!r.ok) return null;
  const o = {};
  for (const line of r.out.split('\n')) { const i = line.indexOf('='); if (i > 0) o[line.slice(0, i)] = line.slice(i + 1).trim(); }
  return o;
}

// What the jobs leave behind is written by root. Read a bounded tail, and drop terminal control codes.
function readNote(name, max = 65536) {
  try {
    const fd = fs.openSync(path.join(UPDATE_DIR, name), 'r');
    try {
      const size = fs.fstatSync(fd).size;
      const len = Math.min(size, max);
      const buf = Buffer.alloc(len);
      fs.readSync(fd, buf, 0, len, size - len);
      return buf.toString('utf8');
    } finally { fs.closeSync(fd); }
  } catch { return ''; }
}
const cleanLines = (text) => String(text)
  .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
  .split(/[\r\n]+/)
  .map((l) => l.replace(/[\x00-\x1f\x7f]/g, ' ').trim())
  .filter(Boolean);
const lastLine = (text) => (cleanLines(text).pop() || '').slice(0, 120);
const shortText = (v, n) => (typeof v === 'string' ? v.replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, n) : '');

// `bootc status --format=json`: the booted, staged and previous images. Anything missing stays empty.
function bootcImage(entry) {
  const im = entry && typeof entry === 'object' && entry.image && typeof entry.image === 'object' ? entry.image : null;
  if (!im) return null;
  const t = Date.parse(im.timestamp);
  return {
    ref: im.image && typeof im.image === 'object' ? shortText(im.image.image, 200) : '',
    version: shortText(im.version, 60),
    time: Number.isFinite(t) ? t : 0,
    digest: shortText(im.imageDigest, 100),
  };
}
function parseBootcStatus(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  const st = j && typeof j === 'object' ? j.status : null;
  if (!st || typeof st !== 'object') return null;
  const booted = bootcImage(st.booted);
  const staged = bootcImage(st.staged);
  return {
    booted,
    // an update only counts as waiting if it is a different image from the one that is running
    staged: staged && (!booted || !staged.digest || staged.digest !== booted.digest) ? staged : null,
    rollback: bootcImage(st.rollback),
    // "go back to the previous version" is already queued for the next restart (bootc says so in rollbackQueued)
    rollbackQueued: st.rollbackQueued === true,
  };
}
// `bootc upgrade --check` prints "No changes in: ..." or "Update available for: ..." with the new
// version and the layers it would fetch. Anything else is "unknown", and the caller carries on.
function parseCheck(text) {
  const t = cleanLines(text).join('\n');
  if (/^\s*Update available for\b/mi.test(t)) {
    const v = /^\s*Version:\s*(\S.*)$/mi.exec(t);
    const sz = /^\s*Added layers:.*?\bSize:\s*([0-9][0-9.,]*\s*[kKMGT]?i?B)\b/mi.exec(t);
    return { state: 'available', version: v ? shortText(v[1], 60) : '', size: sz ? sz[1].replace(/\s+/g, ' ') : '' };
  }
  if (/^\s*No changes in\b/mi.test(t)) return { state: 'uptodate', version: '', size: '' };
  return { state: 'unknown', version: '', size: '' };
}
// What `bootc upgrade` said, for when the status job cannot confirm the result.
function parseApply(text) {
  const t = cleanLines(text).join('\n');
  if (/Queued for next boot|Staged update present/i.test(t)) return 'staged';
  if (/No update available|No changes in/i.test(t)) return 'uptodate';
  return '';
}
function updateErrorText(log) {
  const t = cleanLines(log).join('\n');
  if (/could(?: not|n't) resolve|no such host|dial tcp|network is unreachable|name resolution|connection (?:refused|reset|timed out)|timed out|timeout|unable to connect|temporary failure|tls handshake|x509|certificate/i.test(t)) {
    return "Couldn't reach the update server. Check that this machine is online, then try again.";
  }
  if (/no space left|not enough (?:free )?space|disk quota/i.test(t)) return "There isn't enough free space for the update. Free some up in Settings > Storage, then try again.";
  if (/unauthorized|forbidden|denied|authentication required/i.test(t)) return "The update server wouldn't hand over the update.";
  return "The update didn't finish.";
}

// Runs the short status job to the end and reads what it found.
async function fetchStatus() {
  const r = await sysctl(['start', UPDATE_UNIT.status], 45000); // waits until the short job is done
  if (!r.ok) {
    // "failed" here means bootc itself refused: this is not a machine that runs from an image
    const why = ctlWhy(r);
    return { ok: false, why: why === 'failed' ? 'unreadable' : why, detail: lastLine(readNote('status.err')) };
  }
  const s = parseBootcStatus(readNote('status.json', 262144));
  if (!s || !s.booted) return { ok: false, why: 'unreadable', detail: lastLine(readNote('status.err')) };
  return { ok: true, ...s };
}
// A job that is already going (Tessera was restarted while it ran) is picked up again, not started twice.
async function runningJob() {
  if (upJob) return upJob;
  for (const kind of ['apply', 'check', 'rollback']) {
    const p = await unitProps(UPDATE_UNIT[kind]);
    if (p && ['activating', 'active', 'reloading'].includes(p.ActiveState)) {
      upJob = { kind, unit: UPDATE_UNIT[kind], before: '', startedAt: Date.now(), seen: true, canceled: false };
      return upJob;
    }
  }
  return null;
}
async function updateInfo() {
  const job = await runningJob();
  if (job) return { ok: true, launcher: LAUNCHER_VERSION, supported: true, job: job.kind };
  const st = await fetchStatus();
  if (!st.ok) return { ok: true, launcher: LAUNCHER_VERSION, supported: false, job: null, problem: UPDATE_PROBLEM[st.why] || UPDATE_PROBLEM.unreadable, detail: st.detail };
  return { ok: true, launcher: LAUNCHER_VERSION, supported: true, job: null, booted: st.booted, staged: st.staged, rollback: st.rollback, rollbackQueued: st.rollbackQueued || rolledBackNow, graphics: await installer.graphicsFor(st) };
}

// Parts that load after this one. Only code that runs once everything has loaded uses them,
// so requiring them here, at the end, keeps the load order of main.js.
const installer = require('./installer');
