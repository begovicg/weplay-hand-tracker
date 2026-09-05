'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { listLiveFilesByTableName, currentSeatsForFile } = require('../src/hudOverlay');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'hudoverlay-test-'));
}

const HAND_LATEST = `Weplay Hand #601:  Hold'em No Limit ($0.25/$0.50) - 2026/08/14 10:01:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 4: PlayerC ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerC: folds
Hero: raises $1 to $1.25
PlayerB: folds
Uncalled bet ($0.75) returned to Hero
*** SHOW DOWN ***
Hero collected $1 from pot
*** SUMMARY ***
Total pot $1 | Rake $0
Seat 1: Hero (small blind) collected ($1)
Seat 2: PlayerB (big blind) folded before Flop
Seat 4: PlayerC folded before Flop`;

const HAND_EARLIER = `Weplay Hand #600:  Hold'em No Limit ($0.25/$0.50) - 2026/08/14 10:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
Hero: folds
Uncalled bet ($0.25) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $0.5 from pot
*** SUMMARY ***
Total pot $0.5 | Rake $0
Seat 1: Hero (small blind) folded before Flop
Seat 2: PlayerB (big blind) collected ($0.5)`;

test('listLiveFilesByTableName: matches this app\'s Live Sync filenames, keyed by table name, ignoring unrelated files', () => {
  const dir = tmpDir();
  fs.writeFileSync(path.join(dir, "HH20260814 Liverpool Bomb Pot 1 (3BB) (#111) - $0.25-$0.50 - Money 3 No Limit Hold_em.txt"), '');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not a hand history file');
  fs.writeFileSync(path.join(dir, 'export.csv'), 'not even a .txt file');

  const byTable = listLiveFilesByTableName(dir);
  assert.strictEqual(byTable.size, 1, 'only the one real Weplay-named file matches');
  assert.ok(byTable.has('Liverpool Bomb Pot 1 (3BB)'));
});

test('listLiveFilesByTableName: a missing/unreadable folder returns an empty map, not a throw', () => {
  const byTable = listLiveFilesByTableName(path.join(os.tmpdir(), 'this-folder-does-not-exist-12345'));
  assert.strictEqual(byTable.size, 0);
});

test('currentSeatsForFile: reads the LAST hand in the file, not the first — the current lineup, not history', () => {
  const dir = tmpDir();
  const filePath = path.join(dir, 'table.txt');
  fs.writeFileSync(filePath, `${HAND_EARLIER}\n\n${HAND_LATEST}`);

  const seated = currentSeatsForFile(filePath);
  assert.ok(seated, 'file has a parseable hand');
  assert.strictEqual(seated.maxSeats, 6);
  const names = seated.players.map((p) => p.name).sort();
  assert.deepStrictEqual(names, ['Hero', 'PlayerB', 'PlayerC'], 'PlayerC only appears in the LATEST hand — proves the tail, not the head, was read');

  const hero = seated.players.find((p) => p.isHero);
  assert.ok(hero, 'Hero is correctly identified');
  assert.strictEqual(hero.seat, 1);
});

test('currentSeatsForFile: a file with no parseable hand yet (freshly opened table) returns null, not a throw', () => {
  const dir = tmpDir();
  const filePath = path.join(dir, 'table.txt');
  fs.writeFileSync(filePath, '');
  assert.strictEqual(currentSeatsForFile(filePath), null);
});

test('currentSeatsForFile: a missing file returns null, not a throw', () => {
  assert.strictEqual(currentSeatsForFile(path.join(os.tmpdir(), 'does-not-exist-hudoverlay-test.txt')), null);
});

console.log(`\n${passed} test(s) passed.`);
