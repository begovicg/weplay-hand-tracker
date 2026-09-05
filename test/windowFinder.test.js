'use strict';

const assert = require('assert');
const { tableNameFromWindowTitle, tableNameFromFileName } = require('../src/windowFinder');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

test('tableNameFromWindowTitle: matches real Weplay table window titles, extracting just the table name', () => {
  assert.strictEqual(
    tableNameFromWindowTitle("VIP Oslo Bomb Pot (VPIP 25%) -  Hold'em NL $0.50/$1($0.24)"),
    'VIP Oslo Bomb Pot (VPIP 25%)',
  );
  assert.strictEqual(
    tableNameFromWindowTitle("Liverpool Bomb Pot 2 (3BB) -  Hold'em NL $0.25/$0.50($0.12)"),
    'Liverpool Bomb Pot 2 (3BB)',
  );
  assert.strictEqual(
    tableNameFromWindowTitle("London #2 -  Hold'em NL $0.25/$0.50($0.09)"),
    'London #2',
  );
  assert.strictEqual(
    tableNameFromWindowTitle("Munich Bomb Pot (3BB) #2 -  Hold'em NL $0.02/$0.04($0.01)"),
    'Munich Bomb Pot (3BB) #2',
  );
});

test('tableNameFromWindowTitle: a single space before the dash still matches (real titles are inconsistent about one vs two spaces)', () => {
  assert.strictEqual(
    tableNameFromWindowTitle("Seville Bomb Pot 3 (3BB) - Hold'em NL $0.10/$0.20($0.05)"),
    'Seville Bomb Pot 3 (3BB)',
  );
});

test('tableNameFromWindowTitle: unrelated windows (Weplay\'s own lobby, this app itself, a browser tab) return null, not a false match', () => {
  assert.strictEqual(tableNameFromWindowTitle('Weplay - user petit_blaireau'), null);
  assert.strictEqual(tableNameFromWindowTitle('Weplay Hand Tracker'), null);
  assert.strictEqual(tableNameFromWindowTitle("Weplay Table HUD - Google Chrome"), null);
  assert.strictEqual(tableNameFromWindowTitle(''), null);
  assert.strictEqual(tableNameFromWindowTitle(undefined), null);
});

test('tableNameFromFileName: matches this app\'s own Live Sync filename convention, extracting the same table name a window title would', () => {
  assert.strictEqual(
    tableNameFromFileName("HH20260812 Liverpool Bomb Pot 1 (3BB) (#11786814) - $0.25-$0.50 - Money 3 No Limit Hold_em.txt"),
    'Liverpool Bomb Pot 1 (3BB)',
  );
});

test('tableNameFromFileName: an unrelated .txt file returns null', () => {
  assert.strictEqual(tableNameFromFileName('random-export.txt'), null);
  assert.strictEqual(tableNameFromFileName(''), null);
});

test('tableNameFromWindowTitle and tableNameFromFileName agree on the same real table — the actual join key the HUD overlay depends on', () => {
  const fromWindow = tableNameFromWindowTitle("Liverpool Bomb Pot 1 (3BB) -  Hold'em NL $0.25/$0.50($0.12)");
  const fromFile = tableNameFromFileName("HH20260812 Liverpool Bomb Pot 1 (3BB) (#11786814) - $0.25-$0.50 - Money 3 No Limit Hold_em.txt");
  assert.strictEqual(fromWindow, fromFile);
});

console.log(`\n${passed} test(s) passed.`);
