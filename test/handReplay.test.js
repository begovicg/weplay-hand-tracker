'use strict';

const assert = require('assert');
const { buildHandReplay } = require('../src/handReplay');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

// ── Fixtures ────────────────────────────────────────────────────────────

const HAND_NORMAL = `Weplay Hand #1:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerC: raises $1.5 to $1.5
PlayerA: folds
Hero: calls $1
*** FLOP *** [2c 7d 9s]
Hero: checks
PlayerC: bets $2
Hero: calls $2
*** TURN *** [2c 7d 9s] [3h]
Hero: checks
PlayerC: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
Hero: bets $4
PlayerC: folds
Uncalled bet ($4) returned to Hero
*** SHOW DOWN ***
Hero collected $7 from pot
*** SUMMARY ***
Total pot $7 | Rake $0.35
Board [2c 7d 9s 3h 4d]
Seat 1: PlayerA (small blind) folded before Flop
Seat 2: Hero (big blind) collected ($7)
Seat 3: PlayerC (button) folded on the River`;

const HAND_BOMB_POT = `Weplay Hand #2:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:05:00 UTC
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
*** TURN *** [Ah Kh Qh] [3h]
Hero: checks
PlayerA: checks
*** RIVER *** [Ah Kh Qh 3h] [4h]
Hero: bets $1
PlayerA: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $3 from pot
*** SUMMARY ***
Total pot $3 | Rake $0
Seat 1: PlayerA folded on the River
Seat 2: Hero collected ($3)`;

const HAND_SHOWDOWN = `Weplay Hand #3:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:10:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $1.5 to $1.5
PlayerB: calls $1
*** FLOP *** [2c 7d 9s]
Hero: bets $2
PlayerB: calls $2
*** TURN *** [2c 7d 9s] [3h]
Hero: bets $4
PlayerB: calls $4
*** RIVER *** [2c 7d 9s 3h] [4d]
Hero: checks
PlayerB: checks
*** SHOW DOWN ***
Hero: shows [Ah Ad] (a pair of Aces)
PlayerB: shows [Kc Kd] (a pair of Kings)
Hero collected $15 from pot
*** SUMMARY ***
Total pot $15 | Rake $0.75
Board [2c 7d 9s 3h 4d]
Seat 1: Hero (small blind) showed [Ah Ad] and won ($15) with a pair of Aces
Seat 2: PlayerB (big blind) showed [Kc Kd] and lost with a pair of Kings`;

const HAND_ALLIN_RUNTWICE = `Weplay Hand #4:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:15:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $49.75 to $50 and is all-in
PlayerB: calls $49.5 and is all-in
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [4d]
*** SECOND TURN *** [2c 7d 9s] [8c]
*** SECOND RIVER *** [2c 7d 9s 8c] [Kh]
*** SHOW DOWN ***
Hero: shows [Ah Ad] (a pair of Aces)
PlayerB: shows [Kc Kd] (a pair of Kings)
Hero collected $100 from pot
*** SUMMARY ***
Total pot $100 | Rake $2
Hand was run two times
FIRST Board [2c 7d 9s 3h 4d]
SECOND Board [2c 7d 9s 8c Kh]
Seat 1: Hero (small blind) showed [Ah Ad] and won ($100) with a pair of Aces
Seat 2: PlayerB (big blind) showed [Kc Kd] and lost with a pair of Kings`;

// A run-it-twice hand where the boards diverge at the FLOP itself (an
// all-in preflop, not the more common all-in-on-the-flop case) — the rarer
// scenario that needed the more general divergence-reconciliation logic.
const HAND_RUNTWICE_DIVERGE_AT_FLOP = `Weplay Hand #5:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:20:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $49.75 to $50 and is all-in
PlayerB: calls $49.5 and is all-in
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [4d]
*** SECOND FLOP *** [5c 6d Ks]
*** SECOND TURN *** [5c 6d Ks] [8h]
*** SECOND RIVER *** [5c 6d Ks 8h] [2d]
*** SHOW DOWN ***
Hero: shows [Ah Ad] (a pair of Aces)
PlayerB: shows [Kc Kd] (a pair of Kings)
Hero collected $50 from pot
PlayerB collected $50 from pot
*** SUMMARY ***
Total pot $100 | Rake $2
Hand was run two times
FIRST Board [2c 7d 9s 3h 4d]
SECOND Board [5c 6d Ks 8h 2d]
Seat 1: Hero (small blind) showed [Ah Ad] and won ($50) with a pair of Aces, and lost with a pair of Aces
Seat 2: PlayerB (big blind) showed [Kc Kd] and lost with a pair of Kings, and won ($50) with a pair of Kings`;

const HAND_SIDE_POT = `Weplay Hand #6:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:25:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($10 in chips)
Seat 2: PlayerB ($100 in chips)
Hero: posts small blind $0.25
PlayerB: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $9.75 to $10 and is all-in
PlayerB: calls $9.5
*** FLOP *** [2c 7d 9s]
*** TURN *** [2c 7d 9s] [3h]
*** RIVER *** [2c 7d 9s 3h] [4d]
*** SHOW DOWN ***
Hero: shows [Ah Ad] (a pair of Aces)
Hero collected $20 from pot
*** SUMMARY ***
Total pot $20 | Rake $1
Board [2c 7d 9s 3h 4d]
Seat 1: Hero (small blind) showed [Ah Ad] and won ($20) with a pair of Aces
Seat 2: PlayerB (big blind) folded before Flop`;

const HAND_NO_RESOLUTION = `Weplay Hand #7:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:30:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
PlayerA: calls $0.25
Hero: checks
*** FLOP *** [2c 7d 9s]
Hero: bets $1
PlayerA: calls $1
*** SHOW DOWN ***
Hero is disconnected
*** SUMMARY ***
Total pot $3 | Rake $0.15
Seat 1: PlayerA
Seat 2: Hero`;

// Same real-world shape that surfaced a genuine pre-existing position bug in
// stats.js (shared by this module, since buildHandReplay uses the same
// positionLabelsFor function) — heads-up positions were backwards.
const HAND_HEADS_UP = `Weplay Hand #8:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:35:00 UTC
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

// ── Tests ───────────────────────────────────────────────────────────────

test('unparseable header returns null, not a throw', () => {
  assert.strictEqual(buildHandReplay('not a real hand history', null), null);
});

test('a hand with no resolution anywhere returns null (mirrors converter/stats behavior)', () => {
  assert.strictEqual(buildHandReplay(HAND_NO_RESOLUTION, 'Hero'), null);
});

test('normal hand: players, positions, stacks in BB, blinds line, and pot math all check out', () => {
  const r = buildHandReplay(HAND_NORMAL, 'Hero');
  assert.ok(r, 'hand should parse');
  assert.strictEqual(r.players.length, 3);
  const hero = r.players.find((p) => p.isHero);
  assert.strictEqual(hero.name, 'Hero');
  assert.strictEqual(hero.stackBB, 100, '$50 stack / $0.50 bb = 100 BB');
  assert.strictEqual(r.sbLine.name, 'PlayerA');
  assert.strictEqual(r.sbLine.bb, 0.5);
  assert.strictEqual(r.bbLine.name, 'Hero');
  assert.strictEqual(r.bbLine.bb, 1);
  assert.strictEqual(r.tableType, 'ante');
  assert.strictEqual(r.heroCards, 'Ah Kh');
  assert.strictEqual(r.preflopActions.length, 3, 'raise, fold, call');
  assert.ok(r.preflopActions[0].text.includes('PlayerC raises to 3 BB'), `expected raise text, got: ${r.preflopActions[0].text}`);
  // Fold actions keep the player's name in structured data (a future replayer
  // needs it, and it's what the raw action text shows), but the formatted
  // view renders a bare "fold" — matching the reference PokerTracker-style
  // format exactly, where the reader tracks whose turn it was rather than
  // every fold being individually attributed.
  const foldAction = r.preflopActions.find((a) => a.isFold);
  assert.strictEqual(foldAction.player, 'PlayerA');
  assert.ok(r.streets.flop, 'flop should be reached');
  // Preflop pot: SB 0.25 + BB 0.5 + PlayerC raise-to 1.5 + Hero call-to-match 1.0 (their extra $1 on top of the $0.5 BB already posted) = 0.25+0.5+1.5+1 = 3.25 -> 6.5 BB
  assert.strictEqual(r.streets.flop.potBB, 6.5, `expected pot of 6.5 BB entering the flop, got: ${r.streets.flop.potBB}`);
  assert.strictEqual(r.streets.flop.players, 2, 'PlayerA folded, 2 remain');
  assert.strictEqual(r.winners.length, 1);
  assert.strictEqual(r.winners[0].name, 'Hero');
  // Total pot $7, rake $0.35 -> net $6.65 -> 13.3 BB
  assert.strictEqual(r.winners[0].amountBB, 13.3);
});

test('bomb pot: no blinds, no preflop action line, ante captured, straight to flop', () => {
  const r = buildHandReplay(HAND_BOMB_POT, 'Hero');
  assert.ok(r, 'hand should parse');
  assert.strictEqual(r.tableType, 'bombpot');
  assert.strictEqual(r.sbLine, null);
  assert.strictEqual(r.bbLine, null);
  assert.strictEqual(r.preflopActions.length, 0, 'a bomb pot has no preflop betting round at all');
  assert.strictEqual(r.antesBB, 3, '$1.5 ante / $0.5 bb = 3 BB');
  assert.ok(r.streets.flop, 'should go straight to the flop');
  assert.strictEqual(r.streets.flop.potBB, 6, 'two antes of 3 BB each = 6 BB entering the flop');
});

test('showdown: hand descriptions translated to CoinPoker-style labels', () => {
  const r = buildHandReplay(HAND_SHOWDOWN, 'Hero');
  assert.ok(r, 'hand should parse');
  assert.strictEqual(r.showdown.length, 2);
  const hero = r.showdown.find((s) => s.isHero);
  assert.strictEqual(hero.handType, 'One Pair', 'raw "a pair of Aces" should translate to "One Pair"');
  const villain = r.showdown.find((s) => !s.isHero);
  assert.strictEqual(villain.handType, 'One Pair');
});

test('run-it-twice (diverges at turn): dual boards reconstructed, combined winner amount for same winner on both boards', () => {
  const r = buildHandReplay(HAND_ALLIN_RUNTWICE, 'Hero');
  assert.ok(r, 'hand should parse');
  assert.strictEqual(r.isRunTwice, true);
  assert.ok(r.secondRun, 'secondRun should be populated');
  assert.deepStrictEqual(r.streets.flop.board, ['2c', '7d', '9s']);
  assert.deepStrictEqual(r.streets.turn.board, ['3h']);
  assert.deepStrictEqual(r.streets.river.board, ['4d']);
  // Flop/turn/river are shared (divergence never actually happens here since
  // both boards end up identical in this fixture) — second run should mirror.
  assert.strictEqual(r.secondRun.flop, null, 'flop is common, no SECOND FLOP marker exists');
  assert.deepStrictEqual(r.secondRun.turn.board, ['8c']);
  assert.deepStrictEqual(r.secondRun.river.board, ['Kh']);
  // Same winner on both boards -> combined into one winner entry.
  assert.strictEqual(r.winners.length, 1);
  assert.strictEqual(r.winners[0].name, 'Hero');
  // Total pot $100, rake $2 -> net $98 -> 196 BB
  assert.strictEqual(r.winners[0].amountBB, 196);
});

test('run-it-twice (diverges at flop, the rarer case): two genuinely different boards, two different winners', () => {
  const r = buildHandReplay(HAND_RUNTWICE_DIVERGE_AT_FLOP, 'Hero');
  assert.ok(r, 'hand should parse');
  assert.deepStrictEqual(r.streets.flop.board, ['2c', '7d', '9s']);
  assert.ok(r.secondRun.flop, 'second run should have its own flop, since divergence starts there');
  assert.deepStrictEqual(r.secondRun.flop.board, ['5c', '6d', 'Ks']);
  assert.deepStrictEqual(r.secondRun.turn.board, ['8h']);
  assert.deepStrictEqual(r.secondRun.river.board, ['2d']);
  // Two different winners, one per board.
  assert.strictEqual(r.winners.length, 2);
  const heroWin = r.winners.find((w) => w.isHero);
  const villainWin = r.winners.find((w) => !w.isHero);
  assert.strictEqual(heroWin.amountBB, 98, 'half of (100-2)=98 net, one board each');
  assert.strictEqual(villainWin.amountBB, 98);
});

test('side pot: rake-adjusted winnings reconcile with total pot minus rake', () => {
  const r = buildHandReplay(HAND_SIDE_POT, 'Hero');
  assert.ok(r, 'hand should parse');
  assert.strictEqual(r.winners.length, 1);
  // Total pot $20, rake $1 -> net $19 -> 38 BB
  assert.strictEqual(r.winners[0].amountBB, 38);
});

test('player list order matches ascending seat number, consistent with the rest of the app', () => {
  const r = buildHandReplay(HAND_NORMAL, 'Hero');
  assert.deepStrictEqual(r.players.map((p) => p.name), ['PlayerA', 'Hero', 'PlayerC']);
});

test('heads-up positions are correct: the button/SB poster is BTN, the other player is BB — regression test for a real bug', () => {
  const r = buildHandReplay(HAND_HEADS_UP, 'Hero');
  const hero = r.players.find((p) => p.isHero);
  const villain = r.players.find((p) => !p.isHero);
  assert.strictEqual(hero.position, 'BB', 'Hero posted the big blind — must be labeled BB, not BTN');
  assert.strictEqual(villain.position, 'BTN', 'PlayerA is the button and posted the small blind — must be labeled BTN, not BB');
});

console.log(`\n${passed} test(s) passed.`);
