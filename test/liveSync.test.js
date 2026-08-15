'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db');
const { getTotalHandCount } = require('../src/handStore');
const { scanAndImport, startLiveSync } = require('../src/liveSync');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'livesync-test-'));
}

function tmpDb() {
  const dir = tmpDir();
  return { db: openDatabase(path.join(dir, 'hands.db')), dir };
}

const HAND_1 = `Weplay Hand #500:  Hold'em No Limit ($0.25/$0.50) - 2026/08/14 10:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: raises $1 to $1.25
PlayerB: folds
Uncalled bet ($0.75) returned to Hero
*** SHOW DOWN ***
Hero collected $1 from pot
*** SUMMARY ***
Total pot $1 | Rake $0
Seat 1: Hero (small blind) collected ($1)
Seat 2: PlayerB (big blind) folded before Flop`;

const HAND_2 = `Weplay Hand #501:  Hold'em No Limit ($0.25/$0.50) - 2026/08/14 10:01:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
Hero: folds
Uncalled bet ($0.50) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $0.75 from pot
*** SUMMARY ***
Total pot $0.75 | Rake $0
Seat 1: Hero (small blind) folded before Flop
Seat 2: PlayerB (big blind) collected ($0.75)`;

// Windows FAT/NTFS mtime resolution can be coarser than a millisecond —
// writing two versions of a file back to back can otherwise land the same
// mtimeMs, making the "did it actually change" check below flaky. A short
// real sleep between writes sidesteps that without needing to fake time.
function sleepMs(ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) { /* spin — fine for a test, ms-scale */ }
}

test('scanAndImport: empty folder does nothing and reports zero files processed', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  const seen = new Map();
  const totals = scanAndImport(db, folder, seen, { replaceHeroName: true });
  assert.strictEqual(totals.filesProcessed, 0);
  assert.strictEqual(totals.added, 0);
  assert.strictEqual(totals.errors.length, 0);
  assert.strictEqual(seen.size, 0);
});

test('scanAndImport: imports a new hand-history file and records it in the hand store', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  fs.writeFileSync(path.join(folder, 'HH20260814 Test.txt'), HAND_1);
  const seen = new Map();
  const totals = scanAndImport(db, folder, seen, { replaceHeroName: true });
  assert.strictEqual(totals.filesProcessed, 1);
  assert.strictEqual(totals.added, 1);
  assert.strictEqual(getTotalHandCount(db), 1);
  assert.strictEqual(seen.size, 1, 'the file\'s mtime should now be tracked in seen');
});

test('scanAndImport: an unchanged file is not reprocessed on a second scan', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  fs.writeFileSync(path.join(folder, 'HH20260814 Test.txt'), HAND_1);
  const seen = new Map();
  scanAndImport(db, folder, seen, { replaceHeroName: true });
  const second = scanAndImport(db, folder, seen, { replaceHeroName: true });
  assert.strictEqual(second.filesProcessed, 0, 'mtime hasn\'t changed since the first scan, so this file should be skipped entirely');
});

test('scanAndImport: appending a new hand to the SAME file (Weplay\'s actual live-write pattern) is picked up on the next scan', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  const filePath = path.join(folder, 'HH20260814 Test.txt');
  fs.writeFileSync(filePath, HAND_1);
  const seen = new Map();
  scanAndImport(db, folder, seen, { replaceHeroName: true });
  assert.strictEqual(getTotalHandCount(db), 1);

  sleepMs(20);
  fs.writeFileSync(filePath, `${HAND_1}\n\n${HAND_2}`); // Weplay appends within the same daily per-table file
  const second = scanAndImport(db, folder, seen, { replaceHeroName: true });
  assert.strictEqual(second.filesProcessed, 1, 'the file\'s mtime changed, so it should be rescanned');
  assert.strictEqual(second.added, 1, 'hand #500 already exists (idempotent upsert) — only #501 is new');
  assert.strictEqual(getTotalHandCount(db), 2);
});

test('scanAndImport: non-.txt files in the folder are ignored', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  fs.writeFileSync(path.join(folder, 'notes.md'), 'not a hand history');
  fs.writeFileSync(path.join(folder, 'archive.zip'), Buffer.from([0, 1, 2]));
  const seen = new Map();
  const totals = scanAndImport(db, folder, seen, { replaceHeroName: true });
  assert.strictEqual(totals.filesProcessed, 0);
});

test('scanAndImport: a missing folder reports an error instead of throwing', () => {
  const { db } = tmpDb();
  const seen = new Map();
  const totals = scanAndImport(db, path.join(os.tmpdir(), 'this-folder-does-not-exist-12345'), seen, {});
  assert.strictEqual(totals.filesProcessed, 0);
  assert.ok(totals.errors.length > 0);
});

test('startLiveSync: runs an immediate catch-up scan of whatever is already in the folder before watching for changes', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  fs.writeFileSync(path.join(folder, 'HH20260814 Test.txt'), HAND_1);

  const events = [];
  const stop = startLiveSync(db, folder, { replaceHeroName: true }, (totals) => events.push(totals));
  stop();

  assert.strictEqual(events.length, 1, 'the catch-up scan found one file and should have reported it exactly once');
  assert.strictEqual(events[0].added, 1);
  assert.strictEqual(getTotalHandCount(db), 1);
});

test('startLiveSync: an empty folder still starts cleanly (no catch-up event, since nothing was there to process)', () => {
  const { db } = tmpDb();
  const folder = tmpDir();
  const events = [];
  const stop = startLiveSync(db, folder, { replaceHeroName: true }, (totals) => events.push(totals));
  stop();
  assert.strictEqual(events.length, 0);
});

console.log(`\n${passed} test(s) passed.`);
