'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase } = require('../src/db');
const {
  buildHandRecords, importFileIntoStore, queryHands, getDistinctValues, getHandById,
  queryRawHandsForStats, getTotalHandCount, backfillDeepStats, backfillEVAdjustments,
  setHandStarred,
} = require('../src/handStore');
const { splitHands } = require('../src/converter');
const { analyzeHand } = require('../src/stats');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

function tmpDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handstore-test-'));
  return { db: openDatabase(path.join(dir, 'hands.db')), dir };
}

const HAND_A = `Weplay Hand #100:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: calls $0.25
Hero: checks
*** FLOP *** [2c 7d 9s]
Hero: bets $1
PlayerA: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $1 from pot
*** SUMMARY ***
Total pot $1 | Rake $0
Board [2c 7d 9s]
Seat 1: PlayerA (small blind) folded on the Flop
Seat 2: Hero (big blind) collected ($1)`;

const HAND_B = `Weplay Hand #101:  Hold'em No Limit ($0.25/$0.50) - 2026/07/06 12:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
PlayerB: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerB: raises $1.5 to $1.5
Hero: folds
Uncalled bet ($1) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $2.25 from pot
*** SUMMARY ***
Total pot $2.25 | Rake $0
Seat 1: Hero (big blind) folded before Flop
Seat 2: PlayerB (small blind) collected ($2.25)`;

const HAND_C = `Weplay Hand #102:  Hold'em No Limit ($0.50/$1) - 2026/07/07 09:00:00 UTC
Table 'Test'(111) 8-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
PlayerB: posts small blind $0.5
Hero: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
PlayerB: folds
Uncalled bet ($0.5) returned to Hero
*** SHOW DOWN ***
Hero collected $2 from pot
*** SUMMARY ***
Total pot $2 | Rake $0
Seat 1: Hero (big blind) collected ($2)
Seat 2: PlayerB (small blind) folded before Flop`;

test('queryHands filters by table category, stakes, and date range', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}\n\n${HAND_C}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const byTable = queryHands(db, { tableCategory: '8max-ante' });
  assert.strictEqual(byTable.total, 1);
  assert.strictEqual(byTable.hands[0].handId, '102');

  const byStake = queryHands(db, { stakesLabel: '$0.50/$1' });
  assert.strictEqual(byStake.total, 1);
  assert.strictEqual(byStake.hands[0].handId, '102');

  const byDate = queryHands(db, { dateFrom: '2026-07-06' });
  assert.strictEqual(byDate.total, 2);
});

// "Vs Player" — narrows the perspective player's hands to ones they went
// postflop with a specific named opponent. HAND_A: PlayerA calls preflop,
// Hero (BB) checks to the flop, PlayerA folds there — both saw_flop = 1.
// HAND_B and HAND_C both end preflop (a fold with the bet returned
// uncalled) — no flop is ever dealt in either, so saw_flop is 0 for
// everyone in both, including Hero.
test('queryHands vsPlayer: only matches hands where the perspective player AND the named opponent both saw the flop', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}\n\n${HAND_C}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const vsPlayerA = queryHands(db, { vsPlayer: 'PlayerA' });
  assert.strictEqual(vsPlayerA.total, 1, 'only HAND_A has both Hero and PlayerA reaching the flop together');
  assert.strictEqual(vsPlayerA.hands[0].handId, '100');

  const vsPlayerB = queryHands(db, { vsPlayer: 'PlayerB' });
  assert.strictEqual(vsPlayerB.total, 0, 'Hero never saw a flop in either hand PlayerB was seated in');

  const vsNobody = queryHands(db, { vsPlayer: 'NotASeatedPlayer' });
  assert.strictEqual(vsNobody.total, 0);
});

test('queryHands paginates via offset/limit and sorts newest-first by default', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const page1 = queryHands(db, { limit: 1, offset: 0 });
  assert.strictEqual(page1.hands.length, 1);
  assert.strictEqual(page1.hands[0].handId, '101', 'newest (2026-07-06) should sort first by default');
  assert.strictEqual(page1.total, 2, 'total should reflect all matching hands, not just this page');

  const page2 = queryHands(db, { limit: 1, offset: 1 });
  assert.strictEqual(page2.hands[0].handId, '100');
});

test('queryHands can sort by net result (win/loss), ascending or descending', () => {
  const { db } = tmpDb();
  // HAND_A: hero wins (+$0.50). HAND_B: hero loses (-$0.50). HAND_C: hero wins (+$2, larger stake).
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}\n\n${HAND_C}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const worstFirst = queryHands(db, { sortBy: 'net', sortAsc: true });
  assert.strictEqual(worstFirst.hands[0].handId, '101', 'the loss should sort first ascending');
  assert.strictEqual(worstFirst.hands[2].handId, '102', 'the biggest win should sort last ascending');

  const bestFirst = queryHands(db, { sortBy: 'net', sortAsc: false });
  assert.strictEqual(bestFirst.hands[0].handId, '102', 'the biggest win should sort first descending');
  assert.strictEqual(bestFirst.hands[2].handId, '101', 'the loss should sort last descending');
});

test('queryHands can sort by stakes numerically (not the text label), and by pot size', () => {
  const { db } = tmpDb();
  // HAND_A/HAND_B are $0.25/$0.50 (bb=0.5); HAND_C is $0.50/$1 (bb=1).
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}\n\n${HAND_C}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const byStakeAsc = queryHands(db, { sortBy: 'stakes', sortAsc: true });
  assert.strictEqual(byStakeAsc.hands[2].handId, '102', 'the higher stake ($0.50/$1) should sort last ascending');

  const byPotDesc = queryHands(db, { sortBy: 'pot', sortAsc: false });
  assert.strictEqual(byPotDesc.hands[0].potSize, 2.25, 'HAND_B has the largest pot ($2.25)');
});

test('queryHands sort is stable across pages even when many rows tie on the sort column (e.g. a boolean-like field)', () => {
  const { db } = tmpDb();
  // Five hands all sharing wentToShowdown=false (only HAND_A reaches a real
  // showdown) — sorting by wtsd with only two distinct values is exactly
  // the case where an unstable sort could duplicate or skip rows across
  // pages without a deterministic tiebreaker.
  const hands = [HAND_A, HAND_B, HAND_C];
  importFileIntoStore(db, hands.join('\n\n'), 'file1.txt', { replaceHeroName: true }, splitHands);

  const page1 = queryHands(db, { sortBy: 'wtsd', sortAsc: false, limit: 2, offset: 0 });
  const page2 = queryHands(db, { sortBy: 'wtsd', sortAsc: false, limit: 2, offset: 2 });
  const ids1 = new Set(page1.hands.map((h) => h.handId));
  const overlap = page2.hands.filter((h) => ids1.has(h.handId));
  assert.strictEqual(overlap.length, 0, 'no hand should appear on more than one page');
  assert.strictEqual(page1.hands.length + page2.hands.length, 3, 'every hand should appear exactly once across both pages');
});

test('getDistinctValues collects unique positions, stakes, and table categories', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}\n\n${HAND_C}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  const dv = getDistinctValues(db);
  assert.ok(dv.stakes.includes('$0.25/$0.50'));
  assert.ok(dv.positions.length > 0);
  assert.deepStrictEqual(dv.tableCategories, ['6max-ante', '8max-ante']);
});

test('getDistinctValues sorts stakes numerically, not lexicographically', () => {
  const { db } = tmpDb();
  // "$2/$4" vs "$10/$20" is a genuine counter-example for a naive string
  // sort: lexicographically "1" < "2" puts "$10/$20" first, but numerically
  // bb=4 < bb=20 means "$2/$4" must actually come first.
  const highStakeHand = HAND_C
    .replace('$0.50/$1', '$5/$10')
    .replace('posts small blind $0.5', 'posts small blind $5')
    .replace('posts big blind $1', 'posts big blind $10')
    .replace('Weplay Hand #102', 'Weplay Hand #103');
  importFileIntoStore(db, `${HAND_A}\n\n${highStakeHand}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  const dv = getDistinctValues(db);
  assert.deepStrictEqual(dv.stakes, ['$0.25/$0.50', '$5/$10']);
});

test('every seated player is stored, not just hero — the core requirement for viewing a hand you were not in', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  const players = db.prepare('SELECT player_name, is_hero, seat, position, starting_stack FROM hand_players WHERE hand_id = ? ORDER BY seat').all('100');
  assert.strictEqual(players.length, 2, 'both PlayerA and Hero should be stored');
  assert.strictEqual(players[0].player_name, 'PlayerA');
  assert.strictEqual(players[0].is_hero, 0);
  assert.strictEqual(players[0].position, 'BTN', 'PlayerA is the button and posts SB in this heads-up hand — labeled BTN by the heads-up convention');
  assert.strictEqual(players[1].player_name, 'Hero');
  assert.strictEqual(players[1].is_hero, 1);
  assert.strictEqual(players[1].position, 'BB');
});

test('queryHands: a player\'s perspective now includes every hand they were seated in, not just hands where they specifically imported their own file', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  // A separate file where PlayerA is the one whose cards are revealed —
  // their own export, imported on its own (natural auto-detection finds
  // PlayerA as hero here, since this hand's own "Dealt to PlayerA" line
  // says so).
  const friendOwnHand = HAND_A
    .replace('Weplay Hand #100', 'Weplay Hand #200')
    .replace('Dealt to Hero', 'Dealt to PlayerA');
  importFileIntoStore(db, friendOwnHand, 'friend_file.txt', { replaceHeroName: true }, splitHands);

  // PlayerA's complete history is now both hands: #100 (where they were
  // just a named opponent in Hero's own export) and #200 (their own
  // export). Deep stats are computed for every seated player at import
  // time now, not just whoever happened to be hero in a given file, so
  // there's no reason to exclude #100 anymore — it's real data about
  // PlayerA's own play, just sourced from someone else's file.
  const forPlayerA = queryHands(db, { perspectivePlayer: 'PlayerA' });
  assert.strictEqual(forPlayerA.total, 2);
  const handIds = forPlayerA.hands.map((h) => h.handId).sort();
  assert.deepStrictEqual(handIds, ['100', '200']);
});

test("queryHands: a player who's never been hero anywhere (only ever an opponent) still returns their hands, with real computed stats — not zero", () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  // PlayerA appears in hand #100 only as a named opponent — Hero is the
  // one whose cards are known there — and PlayerA's own file was never
  // imported. Their net/VPIP/PFR/etc are still real, computed values
  // (analyzeHand takes a player name, it isn't hardcoded to "hero"), not
  // null placeholders and not an empty result.
  const forPlayerA = queryHands(db, { perspectivePlayer: 'PlayerA' });
  assert.strictEqual(forPlayerA.total, 1);
  assert.strictEqual(forPlayerA.hands[0].handId, '100');
  assert.strictEqual(typeof forPlayerA.hands[0].net, 'number', 'PlayerA has a real, computed net result, not null');
});

test('re-importing the same file is idempotent: updates in place, never duplicates, hand_players rows stay consistent', () => {
  const { db } = tmpDb();
  const r1 = importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(r1.added, 2);
  assert.strictEqual(r1.updated, 0);

  const r2 = importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(r2.added, 0);
  assert.strictEqual(r2.updated, 2);

  const handCount = db.prepare('SELECT COUNT(*) AS c FROM hands').get().c;
  const playerCount = db.prepare('SELECT COUNT(*) AS c FROM hand_players').get().c;
  assert.strictEqual(handCount, 2);
  assert.strictEqual(playerCount, 4, '2 players per hand x 2 hands — no stale or duplicated rows from re-import');
});

test("getHandById returns hand-level fields plus that hand's hero player fields, including raw text", () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  const detail = getHandById(db, '100');
  assert.ok(detail);
  assert.strictEqual(detail.handId, '100');
  assert.strictEqual(detail.stakesLabel, '$0.25/$0.50');
  assert.strictEqual(detail.position, 'BB');
  assert.strictEqual(detail.net, 0.5);
  assert.ok(detail.raw.includes('Weplay Hand #100'));
  assert.strictEqual(getHandById(db, 'no-such-hand'), null);
});

test('getHandById: a perspectivePlayer argument returns that specific player\'s row, not whichever player was hero in the source file — the gap found while wiring up "view any player"', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  // HAND_A: Hero is hero (position BB, net 0.5); PlayerA is the opponent
  // (folded on the flop). Without a perspectivePlayer, this hand's own
  // file hero is returned, same as before.
  const defaultDetail = getHandById(db, '100');
  assert.strictEqual(defaultDetail.playerName, 'Hero');
  assert.strictEqual(defaultDetail.position, 'BB');

  // With perspectivePlayer, PlayerA's own row comes back instead — their
  // own position/net, not Hero's, even though Hero is the one who was
  // is_hero=1 when this file was imported. HAND_A is heads-up, where the
  // small-blind poster is correctly labeled "BTN" per this project's own
  // established heads-up position convention (see the regression test in
  // stats.test.js), not "SB".
  const playerADetail = getHandById(db, '100', 'PlayerA');
  assert.strictEqual(playerADetail.playerName, 'PlayerA');
  assert.strictEqual(playerADetail.position, 'BTN');
  assert.notStrictEqual(playerADetail.net, defaultDetail.net, 'PlayerA and Hero have different, independently computed net results for the same hand');
});

test("queryRawHandsForStats returns raw text keyed to each hand's own hero, skipping skipped hands", () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  const rows = queryRawHandsForStats(db, {});
  assert.strictEqual(rows.length, 2);
  assert.ok(rows.every((r) => r.playerName === 'Hero'));
});

test('reopening the same database file preserves everything written to it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'handstore-test-'));
  const dbPath = path.join(dir, 'hands.db');
  const db1 = openDatabase(dbPath);
  importFileIntoStore(db1, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);
  db1.close();

  const db2 = openDatabase(dbPath);
  const q = queryHands(db2, {});
  assert.strictEqual(q.total, 2);
  // db2 must be closed before the directory is removed — on Windows an
  // open SQLite file handle blocks deleting the directory that contains
  // it (POSIX allows unlinking an open file; Windows doesn't), which is
  // exactly what was causing an EPERM here and aborting the rest of this
  // file's tests (and, since npm test chains files with &&, every test
  // file listed after this one too).
  db2.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a hand with an unparseable header returns null, not a broken record', () => {
  const r = buildHandRecords('not a real hand history at all', 'file1.txt', {});
  assert.strictEqual(r, null);
});

// A genuine showdown where hero's cards ARE shown — bb=$1, pot=$40 (40bb).
const HAND_SHOWN = `Weplay Hand #300:  Hold'em No Limit ($0.5/$1) - 2026/07/08 10:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Hero: posts small blind $0.5
PlayerB: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $19 to $19.5
PlayerB: calls $18.5
*** FLOP *** [2c 7d 9s]
PlayerB: checks
Hero: checks
*** SHOW DOWN ***
Hero: shows [Ah Ad] (One Pair)
PlayerB: shows [Kc Kd] (One Pair)
Hero collected $40 from pot
*** SUMMARY ***
Total pot $40 | Rake $0
Board [2c 7d 9s]
Seat 1: Hero (small blind) showed [Ah Ad] and won ($40) with One Pair
Seat 2: PlayerB (big blind) showed [Kc Kd] and lost with One Pair`;

// Hero wins uncontested, no shows line — bb=$1, pot=$3 (3bb, a small steal).
const HAND_NOT_SHOWN = `Weplay Hand #301:  Hold'em No Limit ($0.5/$1) - 2026/07/08 11:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Hero: posts small blind $0.5
PlayerB: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
Hero: raises $2.5 to $3
PlayerB: folds
Uncalled bet ($2) returned to Hero
*** SHOW DOWN ***
Hero collected $3 from pot
*** SUMMARY ***
Total pot $3 | Rake $0
Seat 1: Hero (small blind) collected ($3)
Seat 2: PlayerB (big blind) folded before Flop`;

test('queryHands: "Went to showdown" filter is three-way (shown / not-shown / both), not a boolean checkbox', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_SHOWN}\n\n${HAND_NOT_SHOWN}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const shown = queryHands(db, { wentToShowdown: 'shown' });
  assert.strictEqual(shown.total, 1);
  assert.strictEqual(shown.hands[0].handId, '300');

  const notShown = queryHands(db, { wentToShowdown: 'not-shown' });
  assert.strictEqual(notShown.total, 1);
  assert.strictEqual(notShown.hands[0].handId, '301');

  const both = queryHands(db, {});
  assert.strictEqual(both.total, 2, 'no wentToShowdown filter (or any other value) should return everything');
});

// A genuine 2-way showdown where the LOSER mucks instead of showing — very
// common (no reason to reveal a losing hand). PlayerB reaches a real
// showdown here (checks the flop, stays in through SHOW DOWN) but has no
// "shows" line of their own, only "mucks hand".
const HAND_SHOWDOWN_MUCKED_LOSER = `Weplay Hand #302:  Hold'em No Limit ($0.5/$1) - 2026/07/08 12:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Hero: posts small blind $0.5
PlayerB: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $19 to $19.5
PlayerB: calls $18.5
*** FLOP *** [2c 7d 9s]
PlayerB: checks
Hero: checks
*** SHOW DOWN ***
Hero: shows [Ah Ad] (One Pair)
PlayerB: mucks hand
Hero collected $40 from pot
*** SUMMARY ***
Total pot $40 | Rake $0
Board [2c 7d 9s]
Seat 1: Hero (small blind) showed [Ah Ad] and won ($40) with One Pair
Seat 2: PlayerB (big blind) mucked`;

test('queryHands: "Went to showdown" filter counts a genuine showdown reached even when the loser mucks instead of showing — not just literal `shows` lines', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_SHOWDOWN_MUCKED_LOSER, 'file1.txt', { replaceHeroName: true }, splitHands);

  // From PlayerB's own perspective: they never have a `shows` line, but they
  // genuinely stayed in through a real 2-way showdown — "Showdown: Yes"
  // should find them, and "Showdown: No" must NOT (the bug this regression
  // guards: the old definition only checked for a literal `shows` line,
  // which silently missed every mucked-loser showdown like this one).
  const shown = queryHands(db, { perspectivePlayer: 'PlayerB', wentToShowdown: 'shown' });
  assert.strictEqual(shown.total, 1, 'PlayerB genuinely reached showdown, even without a shows line');

  const notShown = queryHands(db, { perspectivePlayer: 'PlayerB', wentToShowdown: 'not-shown' });
  assert.strictEqual(notShown.total, 0, 'a mucked-at-showdown loss must not be miscounted as "never went to showdown"');
});

const HAND_BOMB_POT = `Weplay Hand #303:  Hold'em No Limit ($0.25/$0.50) - 2026/07/08 13:00:00 UTC
Table 'Bomb Pot'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts the ante $1.5
Hero: posts the ante $1.5
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
*** FLOP *** [Ah Kh Qh]
Hero: checks
PlayerA: checks
*** SHOW DOWN ***
PlayerA: shows [Jh Th] (a straight flush)
Hero: mucks hand
PlayerA collected $3 from pot
*** SUMMARY ***
Total pot $3 | Rake $0
Seat 1: PlayerA showed [Jh Th] and won ($3) with a straight flush
Seat 2: Hero mucked`;

test('queryHands: "Include Bomb Pots" toggle excludes bomb pot hands everywhere it applies (table/stats/graph/export all share this same query)', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_BOMB_POT}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const withBombPots = queryHands(db, {});
  assert.strictEqual(withBombPots.total, 2, 'default (no includeBombPots key, matching the checked checkbox) includes everything');

  const withoutBombPots = queryHands(db, { includeBombPots: false });
  assert.strictEqual(withoutBombPots.total, 1, 'unchecked excludes the bomb pot hand specifically');
  assert.strictEqual(withoutBombPots.hands[0].handId, '100', 'the remaining hand is the non-bomb-pot one');

  const rawRows = queryRawHandsForStats(db, { includeBombPots: false });
  assert.strictEqual(rawRows.length, 1, 'queryRawHandsForStats (stats/graph/export) shares the same WHERE clause, so it is excluded there too');
});

test('queryHands: pot size filter, in big blinds, converts against each hand\'s own bb_stake', () => {
  const { db } = tmpDb();
  // HAND_SHOWN: 40bb pot. HAND_NOT_SHOWN: 3bb pot.
  importFileIntoStore(db, `${HAND_SHOWN}\n\n${HAND_NOT_SHOWN}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const midRange = queryHands(db, { potBbMin: 10, potBbMax: 60 });
  assert.strictEqual(midRange.total, 1, 'only the 40bb pot should match a 10-60bb range');
  assert.strictEqual(midRange.hands[0].handId, '300');

  const smallRange = queryHands(db, { potBbMax: 5 });
  assert.strictEqual(smallRange.total, 1, 'only the 3bb pot should match a max-5bb filter');
  assert.strictEqual(smallRange.hands[0].handId, '301');

  const noneMatch = queryHands(db, { potBbMin: 100 });
  assert.strictEqual(noneMatch.total, 0, 'neither pot reaches 100bb');
});

test('getTotalHandCount reflects incremental imports — the exact scenario behind the "tabs show stale counts" bug report', () => {
  const { db } = tmpDb();
  assert.strictEqual(getTotalHandCount(db), 0, 'empty database starts at zero');

  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(getTotalHandCount(db), 1, 'reflects the first import immediately');

  // A second, separate import onto the same already-populated database —
  // the actual scenario reported: importing more hands after some are
  // already there, not a fresh database.
  importFileIntoStore(db, HAND_B, 'file2.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(getTotalHandCount(db), 2, 'reflects the incremental import too, not just the first batch');

  // Re-importing the same file again must not double-count (idempotent
  // import, already established elsewhere) — the total should stay exactly
  // where it was, not grow just because the same data was seen twice.
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(getTotalHandCount(db), 2);
});

test('queryHands: Saw Flop filter (both/yes/no) — reusing HAND_SHOWN (sees a flop) and HAND_NOT_SHOWN (folds out preflop, no flop at all)', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_SHOWN}\n\n${HAND_NOT_SHOWN}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  const sawFlopYes = queryHands(db, { sawFlop: 'yes' });
  assert.strictEqual(sawFlopYes.total, 1);
  assert.strictEqual(sawFlopYes.hands[0].handId, '300');

  const sawFlopNo = queryHands(db, { sawFlop: 'no' });
  assert.strictEqual(sawFlopNo.total, 1);
  assert.strictEqual(sawFlopNo.hands[0].handId, '301');

  const both = queryHands(db, {});
  assert.strictEqual(both.total, 2, 'no sawFlop filter (or any other value) should return everything');
});

test('backfillDeepStats: fixes the saw_flop-specific gap — hero rows imported before saw_flop existed have it NULL, not false, which made both "yes" and "no" filters return zero', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_SHOWN}\n\n${HAND_NOT_SHOWN}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  // Simulate "imported before this column existed" — exactly what
  // ALTER TABLE ADD COLUMN actually does to already-existing rows.
  db.exec('UPDATE hand_players SET saw_flop = NULL WHERE is_hero = 1');

  const beforeYes = queryHands(db, { sawFlop: 'yes' });
  const beforeNo = queryHands(db, { sawFlop: 'no' });
  assert.strictEqual(beforeYes.total, 0, 'reproduces the reported bug: NULL matches neither yes...');
  assert.strictEqual(beforeNo.total, 0, '...nor no');

  const backfilled = backfillDeepStats(db, analyzeHand);
  assert.strictEqual(backfilled, 2);

  const afterYes = queryHands(db, { sawFlop: 'yes' });
  const afterNo = queryHands(db, { sawFlop: 'no' });
  assert.strictEqual(afterYes.total, 1);
  assert.strictEqual(afterYes.hands[0].handId, '300');
  assert.strictEqual(afterNo.total, 1);
  assert.strictEqual(afterNo.hands[0].handId, '301');

  // Idempotent — a second call on an already-backfilled database does
  // nothing, so this can safely run on every app launch.
  assert.strictEqual(backfillDeepStats(db, analyzeHand), 0);
});

test('backfillDeepStats: also fixes the broader gap — non-hero rows imported before deep stats were generalized to every seated player, where net itself was never computed at all', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  // Simulate "imported before non-hero deep stats existed" — every
  // opponent row's net (and everything else) starts out NULL, exactly
  // like a database populated by the version of this app before
  // buildHandRecords computed stats for every seated player.
  db.exec('UPDATE hand_players SET net = NULL, vpip = NULL, pfr = NULL, saw_flop = NULL, hand_category = NULL WHERE is_hero = 0');

  const opponentRow = db.prepare("SELECT net FROM hand_players WHERE player_name = 'PlayerA'").get();
  assert.strictEqual(opponentRow.net, null, 'reproduces the gap: PlayerA (never hero) has no computed net at all');

  const backfilled = backfillDeepStats(db, analyzeHand);
  assert.ok(backfilled > 0);

  const afterRow = db.prepare("SELECT net FROM hand_players WHERE player_name = 'PlayerA'").get();
  assert.strictEqual(typeof afterRow.net, 'number', 'PlayerA now has a real, computed net result');

  assert.strictEqual(backfillDeepStats(db, analyzeHand), 0, 'idempotent, same as the narrower gap above');
});

test('export round-trip: hands exported via queryRawHandsForStats (the same building block main.js\'s export handler uses) are genuinely re-importable, not just well-formed-looking text', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, `${HAND_A}\n\n${HAND_B}\n\n${HAND_C}`, 'file1.txt', { replaceHeroName: true }, splitHands);

  // Export everything (no filter) — the "Weplay original" format path.
  const rows = queryRawHandsForStats(db, {});
  assert.strictEqual(rows.length, 3);
  const combinedText = rows.map((r) => r.rawText).join('\n\n');

  // The real correctness bar: re-importing the exported text into a fresh
  // database must produce exactly the same hands, not just parse without
  // throwing. This is the actual scenario a colleague receiving an
  // exported file would hit.
  const { db: freshDb } = tmpDb();
  const result = importFileIntoStore(freshDb, combinedText, 'reimported.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(result.added, 3);
  assert.strictEqual(result.skipped, 0);

  const reimportedTotal = queryHands(freshDb, {});
  assert.strictEqual(reimportedTotal.total, 3);
});

// A clean preflop AA vs KK all-in (same fixture shape as evAnalysis.test.js)
// — Hero wins the whole $200 pot with only ~81.2% equity, so this hand has a
// real, strongly-nonzero EV adjustment to mirror onto Villain.
const HAND_ALLIN_AA_VS_KK = `Weplay Hand #500:  Hold'em No Limit ($0.5/$1) - 2026/07/09 18:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: Villain ($100 in chips)
Hero: posts small blind $0.5
Villain: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
Hero: raises $99.5 to $100 and is all-in
Villain: calls $99 and is all-in
*** FLOP *** [2h 7d Jc]
*** TURN *** [2h 7d Jc] [4s]
*** RIVER *** [2h 7d Jc 4s] [9h]
*** SHOW DOWN ***
Hero: shows [Ac Ad] (One Pair)
Villain: shows [Kh Ks] (One Pair)
Hero collected $200 from pot
*** SUMMARY ***
Total pot $200 | Rake $0
Board [2h 7d Jc 4s 9h]
Seat 1: Hero showed [Ac Ad] and won ($200) with One Pair
Seat 2: Villain showed [Kh Ks] and lost with One Pair`;

test('buildHandRecords: a genuine 2-player all-in mirrors the EV adjustment onto the villain\'s row, not just hero\'s — the bug where every non-hero player\'s EV winrate trivially equaled their actual winrate', () => {
  const { players } = buildHandRecords(HAND_ALLIN_AA_VS_KK, 'file1.txt', {});
  const hero = players.find((p) => p.playerName === 'Hero');
  const villain = players.find((p) => p.playerName === 'Villain');

  assert.strictEqual(typeof hero.evAdjustmentBB, 'number', 'hero has a real EV adjustment for this all-in');
  assert.ok(hero.evAdjustmentBB < -30, `hero ran well above their ~81% equity, expected a strongly negative adjustment, got ${hero.evAdjustmentBB}`);

  assert.strictEqual(typeof villain.evAdjustmentBB, 'number', 'villain must NOT be left null — they were the other half of this exact all-in');
  // Exact negation, not approximate — see the comment on computeHandEVAdjustment
  // in evAnalysis.js for why this identity is provable, not estimated.
  assert.strictEqual(villain.evAdjustmentBB, -hero.evAdjustmentBB);
});

test('buildHandRecords: a normal (non-all-in) hand leaves every seated player\'s EV adjustment null, hero and non-hero alike', () => {
  const normalHand = `Weplay Hand #501:  Hold'em No Limit ($0.5/$1) - 2026/07/09 18:05:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: Villain ($100 in chips)
Hero: posts small blind $0.5
Villain: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [Ac Ad]
Hero: raises $2 to $2.5
Villain: calls $1.5
*** FLOP *** [2h 7d Jc]
Villain: checks
Hero: bets $3
Villain: folds
Uncalled bet ($3) returned to Hero
*** SHOW DOWN ***
Hero collected $6 from pot
*** SUMMARY ***
Total pot $6 | Rake $0
Board [2h 7d Jc]
Seat 1: Hero (small blind) collected ($6)
Seat 2: Villain (big blind) folded on the Flop`;
  const { players } = buildHandRecords(normalHand, 'file1.txt', {});
  for (const p of players) {
    assert.strictEqual(p.evAdjustmentBB, null, `${p.playerName} should have no EV adjustment — no all-in happened`);
  }
});

// The scenario this whole EV-adjustment feature was missing: hero folds
// before the all-in, and it happens between the two OTHER seated players
// (PlayerB with AA, PlayerC with KK — the same known ~81.2% spot). Both of
// them are non-hero, so this is the case an earlier hero-anchored version of
// findAllInSpot silently skipped entirely.
const HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS = `Weplay Hand #502:  Hold'em No Limit ($0.5/$1) - 2026/07/09 18:10:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
PlayerB: posts small blind $0.5
PlayerC: posts big blind $1
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
Hero: folds
PlayerB: raises $99.5 to $100 and is all-in
PlayerC: calls $99 and is all-in
*** FLOP *** [2h 7d Jc]
*** TURN *** [2h 7d Jc] [4s]
*** RIVER *** [2h 7d Jc 4s] [9h]
*** SHOW DOWN ***
PlayerB: shows [Ac Ad] (One Pair)
PlayerC: shows [Kh Ks] (One Pair)
PlayerB collected $200 from pot
*** SUMMARY ***
Total pot $200 | Rake $0
Board [2h 7d Jc 4s 9h]
Seat 1: Hero folded before Flop
Seat 2: PlayerB showed [Ac Ad] and won ($200) with One Pair
Seat 3: PlayerC showed [Kh Ks] and lost with One Pair`;

test('buildHandRecords: an all-in between two non-hero players (hero folded first) gets a real EV adjustment for both of them — this is the bug the user actually reported', () => {
  const { players } = buildHandRecords(HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS, 'file1.txt', {});
  const hero = players.find((p) => p.playerName === 'Hero');
  const playerB = players.find((p) => p.playerName === 'PlayerB');
  const playerC = players.find((p) => p.playerName === 'PlayerC');

  assert.strictEqual(hero.evAdjustmentBB, null, 'hero folded before the all-in — correctly no adjustment for them');
  assert.strictEqual(typeof playerB.evAdjustmentBB, 'number', 'PlayerB must NOT be left null just because hero wasn\'t involved');
  assert.strictEqual(typeof playerC.evAdjustmentBB, 'number', 'same for PlayerC');
  assert.ok(playerB.evAdjustmentBB < -30, `PlayerB (AA) won it all with only ~81% equity, expected a strongly negative adjustment, got ${playerB.evAdjustmentBB}`);
  assert.strictEqual(playerC.evAdjustmentBB, -playerB.evAdjustmentBB, 'exact negation, same identity as any other 2-player all-in');
});

test('backfillEVAdjustments: fixes both the old hero-only mirroring gap AND hands where hero was never part of the all-in at all', () => {
  const { db } = tmpDb();
  importFileIntoStore(
    db,
    `${HAND_ALLIN_AA_VS_KK}\n\n${HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS}`,
    'file1.txt',
    { replaceHeroName: true },
    splitHands,
  );

  const heroBefore = db.prepare("SELECT ev_adjustment_bb FROM hand_players WHERE hand_id = '500' AND player_name = 'Hero'").get();
  assert.strictEqual(typeof heroBefore.ev_adjustment_bb, 'number', 'sanity check: this fixture really does qualify for an EV adjustment');

  // Simulate a database from BEFORE either fix: hand 500's villain was never
  // mirrored (old hero-only code only ever wrote hero's row), and hand 502
  // was skipped entirely — hero-anchored findAllInSpot never even recognized
  // it as an all-in, so every seated player in it stayed NULL.
  db.exec("UPDATE hand_players SET ev_adjustment_bb = NULL WHERE hand_id = '500' AND player_name = 'Villain'");
  db.exec("UPDATE hand_players SET ev_adjustment_bb = NULL WHERE hand_id = '502'");

  const fixed = backfillEVAdjustments(db);
  assert.strictEqual(fixed, 2, 'both qualifying hands get fixed in one pass');

  // Hand 500 gets fully recomputed (fresh Monte Carlo), not just "mirror
  // villain off whatever hero's row already said" — so hero's OWN row can
  // shift slightly too (a different, equally valid equity sample), which is
  // why this checks the post-backfill pair against each other, not against
  // heroBefore's now-superseded number. The negation identity is what's
  // actually guaranteed here, not byte-for-byte preservation of the old
  // Monte Carlo draw.
  const heroAfter = db.prepare("SELECT ev_adjustment_bb FROM hand_players WHERE hand_id = '500' AND player_name = 'Hero'").get();
  const villainAfter = db.prepare("SELECT ev_adjustment_bb FROM hand_players WHERE hand_id = '500' AND player_name = 'Villain'").get();
  assert.strictEqual(typeof heroAfter.ev_adjustment_bb, 'number');
  assert.strictEqual(villainAfter.ev_adjustment_bb, -heroAfter.ev_adjustment_bb, 'hand 500: villain\'s value is the exact negation of the freshly recomputed hero value');

  const playerBAfter = db.prepare("SELECT ev_adjustment_bb FROM hand_players WHERE hand_id = '502' AND player_name = 'PlayerB'").get();
  const playerCAfter = db.prepare("SELECT ev_adjustment_bb FROM hand_players WHERE hand_id = '502' AND player_name = 'PlayerC'").get();
  assert.strictEqual(typeof playerBAfter.ev_adjustment_bb, 'number', 'hand 502: PlayerB is fixed even though hero was never part of this all-in');
  assert.strictEqual(playerCAfter.ev_adjustment_bb, -playerBAfter.ev_adjustment_bb);
  const heroRowFor502 = db.prepare("SELECT ev_adjustment_bb FROM hand_players WHERE hand_id = '502' AND player_name = 'Hero'").get();
  assert.strictEqual(heroRowFor502.ev_adjustment_bb, null, 'hero folded before the all-in in hand 502 — correctly stays null');

  // Idempotent — a second call finds every qualifying hand already resolved
  // (see the function's own comment for why this scan isn't a zero-row
  // no-op the way backfillDeepStats' is, but still does no real work here).
  assert.strictEqual(backfillEVAdjustments(db), 0);
});

// ── Shared/pooled database: two different people's own exports of the SAME
// hand ── ────────────────────────────────────────────────────────────────
// The scenario a multi-person pool actually needs: PlayerA and Hero shared
// a table for hand #100 (same fixture shape as HAND_A above, reused
// deliberately). Each one's own client only ever reveals THEIR OWN hole
// cards via "Dealt to X [cards]" — the other player folded without ever
// showing, so nobody's export can see the other's hand. The two files are
// otherwise byte-for-byte identical (same public board/actions/pot), which
// is exactly what two real people's exports of one real hand look like.
const HAND_A_FROM_HERO_PERSPECTIVE = HAND_A; // already has "Dealt to Hero [Ah Kh]"
const HAND_A_FROM_PLAYERA_PERSPECTIVE = HAND_A.replace('Dealt to Hero [Ah Kh]', 'Dealt to PlayerA [Qc Qd]');

test('importFileIntoStore: importing the SAME hand from a second person\'s own file merges hole cards/is_hero instead of clobbering the first person\'s data', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A_FROM_HERO_PERSPECTIVE, 'hero-file.txt', { replaceHeroName: true }, splitHands);

  const heroAfterFirst = db.prepare("SELECT is_hero, hole_cards FROM hand_players WHERE hand_id = '100' AND player_name = 'Hero'").get();
  assert.strictEqual(heroAfterFirst.is_hero, 1);
  assert.strictEqual(heroAfterFirst.hole_cards, 'Ah Kh');
  const playerAAfterFirst = db.prepare("SELECT is_hero, hole_cards FROM hand_players WHERE hand_id = '100' AND player_name = 'PlayerA'").get();
  assert.strictEqual(playerAAfterFirst.is_hero, 0);
  assert.strictEqual(playerAAfterFirst.hole_cards, null, 'PlayerA folded without showing — genuinely unknown from Hero\'s own file alone');

  // Now PlayerA's own file for the exact same hand arrives — a real second
  // person building a shared pool, not a re-import of the same file.
  importFileIntoStore(db, HAND_A_FROM_PLAYERA_PERSPECTIVE, 'playerA-file.txt', { replaceHeroName: false }, splitHands);

  const heroAfterSecond = db.prepare("SELECT is_hero, hole_cards FROM hand_players WHERE hand_id = '100' AND player_name = 'Hero'").get();
  // The actual bug this guards against: a naive delete-then-reinsert would
  // null Hero's hole cards out here, since PlayerA's file never saw them.
  assert.strictEqual(heroAfterSecond.hole_cards, 'Ah Kh', 'Hero\'s hole cards must survive being imported over by a file that can\'t see them');
  assert.strictEqual(heroAfterSecond.is_hero, 1, 'Hero stays a real hero of this hand — their own file DID import it at some point');

  const playerAAfterSecond = db.prepare("SELECT is_hero, hole_cards FROM hand_players WHERE hand_id = '100' AND player_name = 'PlayerA'").get();
  assert.strictEqual(playerAAfterSecond.hole_cards, 'Qc Qd', 'PlayerA\'s own hidden hand is now known, filled in by their own file');
  assert.strictEqual(playerAAfterSecond.is_hero, 1, 'PlayerA is ALSO a real hero of this hand now — both people\'s own files have been imported');

  // Only one hands row and exactly two hand_players rows — a merge, not a
  // second copy of the hand. (queryHands' own unfiltered/default view now
  // legitimately shows this hand twice — once per is_hero=1 player, since
  // "which hero's perspective" is genuinely ambiguous once two real people
  // have both imported it — so that's checked separately below via an
  // explicit perspectivePlayer, not asserted to be 1 here.)
  const handsRowCount = db.prepare("SELECT COUNT(*) AS c FROM hands WHERE hand_id = '100'").get().c;
  assert.strictEqual(handsRowCount, 1, 'exactly one hands row — never duplicated');
  const playerRowCount = db.prepare("SELECT COUNT(*) AS c FROM hand_players WHERE hand_id = '100'").get().c;
  assert.strictEqual(playerRowCount, 2, 'exactly one hand_players row per seated player — never duplicated');

  assert.strictEqual(queryHands(db, { perspectivePlayer: 'Hero' }).total, 1, 'Hero\'s own perspective sees this hand exactly once');
  assert.strictEqual(queryHands(db, { perspectivePlayer: 'PlayerA' }).total, 1, 'PlayerA\'s own perspective sees this hand exactly once too');
});

test('importFileIntoStore: the merge is order-independent — PlayerA\'s file first, then Hero\'s, ends up in the identical state', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A_FROM_PLAYERA_PERSPECTIVE, 'playerA-file.txt', { replaceHeroName: false }, splitHands);
  importFileIntoStore(db, HAND_A_FROM_HERO_PERSPECTIVE, 'hero-file.txt', { replaceHeroName: true }, splitHands);

  const hero = db.prepare("SELECT is_hero, hole_cards FROM hand_players WHERE hand_id = '100' AND player_name = 'Hero'").get();
  const playerA = db.prepare("SELECT is_hero, hole_cards FROM hand_players WHERE hand_id = '100' AND player_name = 'PlayerA'").get();
  assert.strictEqual(hero.hole_cards, 'Ah Kh');
  assert.strictEqual(hero.is_hero, 1);
  assert.strictEqual(playerA.hole_cards, 'Qc Qd');
  assert.strictEqual(playerA.is_hero, 1);
});

test('importFileIntoStore: net/VPIP/PFR for a shared hand agree regardless of which of the two people\'s files computed them — both derive from the same public action log', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A_FROM_HERO_PERSPECTIVE, 'hero-file.txt', { replaceHeroName: true }, splitHands);
  importFileIntoStore(db, HAND_A_FROM_PLAYERA_PERSPECTIVE, 'playerA-file.txt', { replaceHeroName: false }, splitHands);

  const hero = db.prepare("SELECT net, vpip, pfr FROM hand_players WHERE hand_id = '100' AND player_name = 'Hero'").get();
  const playerA = db.prepare("SELECT net, vpip, pfr FROM hand_players WHERE hand_id = '100' AND player_name = 'PlayerA'").get();
  // Hero (BB) won the $1 pot uncontested on the flop, net +$0.50 (their own
  // $0.50 BB back plus PlayerA's $0.50). PlayerA's SB completed to match the
  // $0.50 BB preflop (a $0.25 call on top of their $0.25 SB post), then
  // folded the flop bet without adding more — net -$0.50, the full amount
  // they put in, zero of it coming back.
  assert.strictEqual(hero.net, 0.5);
  assert.strictEqual(playerA.net, -0.5);
  assert.strictEqual(hero.vpip, 0, 'Hero never voluntarily put money in preflop — checked as BB');
  assert.strictEqual(playerA.vpip, 1, 'PlayerA voluntarily called preflop');
});

// ── VanillaPoker: same underlying network as Weplay, different site name in
// the header — see the matching comment in src/converter.js. Confirms the
// whole import pipeline (splitHands -> buildHandRecords -> the hands/
// hand_players tables) recognizes it exactly like a Weplay file, with no
// separate handling needed. ─────────────────────────────────────────────
const HAND_VANILLAPOKER = `VanillaPoker Hand #700:  Hold'em No Limit ($0.25/$0.50) - 2026/08/14 10:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: calls $0.25
Hero: checks
*** FLOP *** [2c 7d 9s]
Hero: bets $1
PlayerA: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $1 from pot
*** SUMMARY ***
Total pot $1 | Rake $0
Board [2c 7d 9s]
Seat 1: PlayerA (small blind) folded on the Flop
Seat 2: Hero (big blind) collected ($1)`;

test('importFileIntoStore: a VanillaPoker-prefixed hand is recognized and saved into the same hands/hand_players tables as a Weplay hand', () => {
  const { db } = tmpDb();
  const result = importFileIntoStore(db, HAND_VANILLAPOKER, 'vanillapoker-file.txt', { replaceHeroName: true }, splitHands);
  assert.strictEqual(result.added, 1);
  assert.strictEqual(result.skipped, 0);

  const hand = db.prepare('SELECT * FROM hands WHERE hand_id = ?').get('700');
  assert.ok(hand, 'the VanillaPoker hand should have landed in the hands table');
  assert.strictEqual(hand.pot_size, 1);

  const hero = db.prepare("SELECT * FROM hand_players WHERE hand_id = '700' AND player_name = 'Hero'").get();
  assert.ok(hero, 'Hero should have a row in hand_players for this hand');
  assert.strictEqual(hero.is_hero, 1);
  assert.strictEqual(hero.hole_cards, 'Ah Kh');
  assert.strictEqual(hero.won, 1);
});

// ── Starred (local bookmark) ─────────────────────────────────────────────
// New hands default unstarred, setHandStarred flips it, and — the actual
// point of it being excluded from UPSERT_HAND_SQL entirely — re-importing
// the exact same hand (the real Live Sync re-sync scenario, since a table's
// hand history file keeps getting appended to and re-scanned) must never
// reset an existing star back off.

test('queryHands: a freshly imported hand defaults to unstarred', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  const { hands } = queryHands(db, {});
  const hand = hands.find((h) => h.handId === '100');
  assert.strictEqual(hand.starred, false);
});

test('setHandStarred: flips the flag, reflected immediately in queryHands', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);

  setHandStarred(db, '100', true);
  let hand = queryHands(db, {}).hands.find((h) => h.handId === '100');
  assert.strictEqual(hand.starred, true);

  setHandStarred(db, '100', false);
  hand = queryHands(db, {}).hands.find((h) => h.handId === '100');
  assert.strictEqual(hand.starred, false, 'un-starring should work just as well as starring');
});

test('setHandStarred: a star survives re-importing the same hand (the real Live Sync re-sync scenario)', () => {
  const { db } = tmpDb();
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);
  setHandStarred(db, '100', true);

  // Simulates Live Sync re-scanning the same still-growing table file and
  // re-importing a hand it already has — importFileIntoStore's own UPSERT
  // is idempotent for everything else, and starred must be no exception.
  importFileIntoStore(db, HAND_A, 'file1.txt', { replaceHeroName: true }, splitHands);

  const hand = queryHands(db, {}).hands.find((h) => h.handId === '100');
  assert.strictEqual(hand.starred, true, 're-importing the same hand must not reset an existing star');
});

console.log(`\n${passed} test(s) passed.`);
