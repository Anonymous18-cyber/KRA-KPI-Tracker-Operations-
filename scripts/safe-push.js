#!/usr/bin/env node
/* SAFE PUSH — refuse to overwrite somebody else's work.
 *
 * `clasp push` is last-write-wins. There is no merge, no conflict and no
 * warning: whatever is in the Apps Script project is replaced by whatever is on
 * your disk. On 29 Sep 2026 two people worked on this project at once, one of
 * them editing directly in the Apps Script editor, and every push from the
 * other silently destroyed an hour of it. Nothing reported anything.
 *
 * So: pull what is actually live, compare it with what we pushed last time, and
 * push only if they match. If they do not, somebody else has changed the
 * project since and this stops and says so.
 *
 *     node scripts/safe-push.js            check and push
 *     node scripts/safe-push.js --check    check only, never push
 *     node scripts/safe-push.js --force    push anyway (say why in the commit)
 *
 * The fingerprint of the last push is kept in .last-push.json, which is
 * gitignored — it is a fact about this machine, not about the code.
 */
var cp = require('child_process');
var fs = require('fs');
var path = require('path');
var os = require('os');

var ROOT = path.join(__dirname, '..');
var FILES = ['Code.gs', 'Index.html', 'appsscript.json'];
var STAMP = path.join(ROOT, '.last-push.json');
var args = process.argv.slice(2);
var CHECK_ONLY = args.indexOf('--check') >= 0;
var FORCE = args.indexOf('--force') >= 0;

function sha(txt) {
  return require('crypto').createHash('sha256')
    .update(String(txt).replace(/\r\n/g, '\n')).digest('hex').slice(0, 16);
}
function read(p) { try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; } }
function die(msg, code) { console.error(msg); process.exit(code === undefined ? 1 : code); }

/* ---- pull the live project into a scratch directory --------------------- */
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'clasp-live-'));
try {
  fs.writeFileSync(path.join(tmp, '.clasp.json'),
    read(path.join(ROOT, '.clasp.json')).replace(/"rootDir"\s*:\s*"[^"]*"/, '"rootDir": "."'));
} catch (e) {
  die('Cannot read .clasp.json — run this from the project, and make sure clasp is set up.');
}
var pull = cp.spawnSync('clasp', ['pull'], { cwd: tmp, encoding: 'utf8', shell: true });
if (pull.status !== 0) {
  die('clasp pull failed, so what is live cannot be checked:\n' +
      (pull.stderr || pull.stdout || '').trim());
}

/* ---- compare live against the fingerprint of our last push -------------- */
var live = {}, mine = {}, missing = [];
FILES.forEach(function (f) {
  var l = read(path.join(tmp, f));
  if (l === null) missing.push(f); else live[f] = sha(l);
  mine[f] = sha(read(path.join(ROOT, f)) || '');
});
var last = null;
try { last = JSON.parse(read(STAMP)); } catch (e) { last = null; }

console.log('live vs last push:');
var drifted = [];
FILES.forEach(function (f) {
  var known = last && last.files && last.files[f];
  var same = known && known === live[f];
  console.log('  ' + f.padEnd(16) +
    (known ? (same ? 'unchanged since our push' : 'CHANGED BY SOMEBODY ELSE') : 'no record of a previous push'));
  if (known && !same) drifted.push(f);
});

if (!last) {
  console.log('');
  console.log('No record of a previous push from this machine, so there is nothing');
  console.log('to compare against. If somebody else may have edited the project,');
  console.log('check with them before pushing.');
}

if (drifted.length && !FORCE) {
  console.error('');
  console.error('REFUSING TO PUSH. ' + drifted.join(' and ') +
    ' changed in the Apps Script project since this machine last pushed.');
  console.error('Pushing would delete those changes with no warning and no undo.');
  console.error('');
  console.error('What is live has been pulled to:');
  console.error('  ' + tmp);
  console.error('Diff it against this directory, merge what matters, then push.');
  console.error('If you are certain the live version should go, re-run with --force.');
  process.exit(2);
}

if (CHECK_ONLY) {
  console.log('');
  console.log(drifted.length ? 'Drift found (see above).' : 'Safe to push.');
  process.exit(0);
}

/* ---- push, and record what we pushed ------------------------------------ */
var push = cp.spawnSync('clasp', ['push', '-f'], { cwd: ROOT, encoding: 'utf8', shell: true });
process.stdout.write(push.stdout || '');
if (push.status !== 0) die((push.stderr || '').trim() || 'clasp push failed.');

fs.writeFileSync(STAMP, JSON.stringify({
  at: new Date().toISOString(),
  by: (process.env.USERNAME || process.env.USER || 'unknown'),
  files: mine
}, null, 2));
console.log('');
console.log('Pushed, and the fingerprint recorded. The next safe-push will notice');
console.log('if anybody edits the project before then.');
