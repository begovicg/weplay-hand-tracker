'use strict';

const assert = require('assert');
const { findAllInSpot, computeHandEVAdjustment } = require('../src/evAnalysis');
const { buildHandReplay } = require('../src/handReplay');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

// A clean preflop AA vs KK all-in, no rake, no shared suit between the hands
// (Ac/Ad vs Kh/Ks — the ~81.2% case verified in equity.test.js), on a board
// that doesn't help either hand beyond their pair. Hero (AA) wins the whole
// $200 pot in this specific instance, purely because that's how this board
// happened to run out — exactly the kind of result EV adjustment corrects for.
const HAND_PREFLOP_ALLIN_AA_VS_KK = `Weplay Hand #1:  Hold'em No Limit ($0.5/$1) - 2026/07/05 18:00:00 UTC
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

// Same spot, but all-in happens ON THE FLOP instead of preflop — only 2 cards
// to come, so this should use exact enumeration, not Monte Carlo.
const HAND_FLOP_ALLIN = `Weplay Hand #2:  Hold'em No Limit ($0.5/$1) - 2026/07/05 18:01:00 UTC
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
Hero: bets $97.5 to $97.5 and is all-in
Villain: calls $97.5 and is all-in
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

// A normal hand that goes to showdown with real decisions on every street —
// not an all-in-with-runout situation at all.
const HAND_NORMAL_SHOWDOWN = `Weplay Hand #3:  Hold'em No Limit ($0.5/$1) - 2026/07/05 18:02:00 UTC
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
Hero: bets $3
Villain: calls $3
*** TURN *** [2h 7d Jc] [4s]
Hero: checks
Villain: checks
*** RIVER *** [2h 7d Jc 4s] [9h]
Hero: bets $5
Villain: calls $5
*** SHOW DOWN ***
Hero: shows [Ac Ad] (One Pair)
Villain: shows [Kh Ks] (One Pair)
Hero collected $21 from pot
*** SUMMARY ***
Total pot $21 | Rake $0
Board [2h 7d Jc 4s 9h]
Seat 1: Hero showed [Ac Ad] and won ($21) with One Pair
Seat 2: Villain showed [Kh Ks] and lost with One Pair`;

// All-in on the turn — betting closes with exactly one card (the river) left
// to come.
const HAND_TURN_ALLIN = `Weplay Hand #4:  Hold'em No Limit ($0.5/$1) - 2026/07/05 18:03:00 UTC
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
Hero: bets $3
Villain: calls $3
*** TURN *** [2h 7d Jc] [4s]
Hero: bets $94 to $94 and is all-in
Villain: calls $94 and is all-in
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

// Action closes exactly on the river — technically an all-in call, but with
// zero cards left to come, so there's no run-out variance to adjust for.
const HAND_RIVER_ALLIN_NO_RUNOUT = `Weplay Hand #5:  Hold'em No Limit ($0.5/$1) - 2026/07/05 18:04:00 UTC
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
Hero: bets $3
Villain: calls $3
*** TURN *** [2h 7d Jc] [4s]
Hero: checks
Villain: checks
*** RIVER *** [2h 7d Jc 4s] [9h]
Hero: bets $94 to $94 and is all-in
Villain: calls $94 and is all-in
*** SHOW DOWN ***
Hero: shows [Ac Ad] (One Pair)
Villain: shows [Kh Ks] (One Pair)
Hero collected $200 from pot
*** SUMMARY ***
Total pot $200 | Rake $0
Board [2h 7d Jc 4s 9h]
Seat 1: Hero showed [Ac Ad] and won ($200) with One Pair
Seat 2: Villain showed [Kh Ks] and lost with One Pair`;

// The scenario this whole file exists to guard against regressing: a 3-max
// hand where HERO FOLDS before the all-in ever happens, and the all-in is
// between the two OTHER seated players (PlayerB with AA, PlayerC with KK —
// the exact same known ~81.2% spot as the fixture above, just relabeled).
// An earlier version of findAllInSpot required one of the two showdown
// entries to be hero, which meant this entire hand was silently skipped —
// neither PlayerB nor PlayerC ever got an EV adjustment, even though both
// hands were fully known and nothing about the equity math actually depends
// on hero being involved.
const HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS = `Weplay Hand #6:  Hold'em No Limit ($0.5/$1) - 2026/07/05 18:05:00 UTC
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

test('findAllInSpot: correctly identifies a preflop all-in runout, and extracts the right hands/board', () => {
  const replay = buildHandReplay(HAND_PREFLOP_ALLIN_AA_VS_KK, 'Hero');
  const spot = findAllInSpot(replay);
  assert.ok(spot, 'should detect this as an all-in spot');
  assert.deepStrictEqual(spot.knownBoard, [], 'preflop all-in means zero cards known at the all-in moment');
  assert.deepStrictEqual(spot.aCards, ['Ac', 'Ad']);
  assert.deepStrictEqual(spot.bCards, ['Kh', 'Ks']);
});

test('findAllInSpot: a normal hand with real decisions on every street is not an all-in spot', () => {
  const replay = buildHandReplay(HAND_NORMAL_SHOWDOWN, 'Hero');
  assert.strictEqual(findAllInSpot(replay), null);
});

test('findAllInSpot: an all-in that closes exactly on the river has no runout variance, so it does not apply', () => {
  const replay = buildHandReplay(HAND_RIVER_ALLIN_NO_RUNOUT, 'Hero');
  assert.strictEqual(findAllInSpot(replay), null);
});

test('findAllInSpot: correctly locates the known board for a flop all-in (2 cards to come)', () => {
  const replay = buildHandReplay(HAND_FLOP_ALLIN, 'Hero');
  const spot = findAllInSpot(replay);
  assert.ok(spot);
  assert.deepStrictEqual(spot.knownBoard, ['2h', '7d', 'Jc']);
});

test('findAllInSpot: correctly locates the known board for a turn all-in (1 card to come)', () => {
  const replay = buildHandReplay(HAND_TURN_ALLIN, 'Hero');
  const spot = findAllInSpot(replay);
  assert.ok(spot);
  assert.deepStrictEqual(spot.knownBoard, ['2h', '7d', 'Jc', '4s']);
});

test('findAllInSpot: not anchored to hero — an all-in between two other seated players (hero folded before it happened) is still detected', () => {
  const replay = buildHandReplay(HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS, 'Hero');
  const spot = findAllInSpot(replay);
  assert.ok(spot, 'must NOT return null just because neither showdown participant is hero');
  assert.deepStrictEqual([spot.aName, spot.bName].sort(), ['PlayerB', 'PlayerC']);
});

test('computeHandEVAdjustment: preflop AA vs KK, hand-verified math (equity ~81.2%, hero actually won the whole pot)', () => {
  const result = computeHandEVAdjustment(HAND_PREFLOP_ALLIN_AA_VS_KK, 'Hero', { trials: 30000 });
  assert.ok(result);
  assert.strictEqual(result.exact, false, 'preflop uses Monte Carlo');
  assert.strictEqual(result.potBB, 200, '$200 pot at $1 bb = 200 BB');
  assert.strictEqual(result.players.length, 2);
  const hero = result.players.find((p) => p.name === 'Hero');
  const villain = result.players.find((p) => p.name === 'Villain');
  // Hero actually collected all 200 BB, but their true equity was ~81.2% of
  // the pot (~162.4 BB) — so the EV adjustment should be strongly negative
  // (hero ran well above their equity in this specific instance).
  assert.ok(Math.abs(hero.equity - 0.812) < 0.02, `expected equity near 81.2%, got ${(hero.equity * 100).toFixed(1)}%`);
  const expectedAdjustment = hero.equity * 200 - 200;
  assert.ok(Math.abs(hero.adjustmentBB - expectedAdjustment) < 0.01, 'adjustment should exactly match equity*pot - actual');
  assert.ok(hero.adjustmentBB < -30 && hero.adjustmentBB > -45, `expected an adjustment around -37.6 BB, got ${hero.adjustmentBB.toFixed(1)}`);
  // Villain's own EV adjustment isn't computed separately — it's provably
  // the exact negation of hero's (see the comment on this function in
  // evAnalysis.js): the pot is fully claimed between exactly these two
  // players, so whatever hero is owed/overpaid relative to equity, Villain
  // is owed/overpaid the mirror image of.
  assert.strictEqual(villain.adjustmentBB, -hero.adjustmentBB);
  assert.ok(Math.abs(villain.equity - (1 - hero.equity)) < 1e-9);
});

test('computeHandEVAdjustment: a flop all-in uses exact enumeration, not Monte Carlo', () => {
  const result = computeHandEVAdjustment(HAND_FLOP_ALLIN, 'Hero');
  assert.ok(result);
  assert.strictEqual(result.exact, true);
});

test('computeHandEVAdjustment: a normal (non-all-in) hand returns null — its actual result is used as-is', () => {
  const result = computeHandEVAdjustment(HAND_NORMAL_SHOWDOWN, 'Hero');
  assert.strictEqual(result, null);
});

test('computeHandEVAdjustment: hero-agnostic — computes a real adjustment for an all-in between two other players, with no heroNameOverride needed at all', () => {
  // Called exactly the way handStore.js calls it at import time: with
  // whichever player happened to be "hero" for this particular import (who,
  // in this fixture, folded before the all-in and isn't part of it).
  const result = computeHandEVAdjustment(HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS, 'Hero', { trials: 30000 });
  assert.ok(result, 'must compute a real adjustment even though hero was never part of this all-in');
  assert.strictEqual(result.potBB, 200);
  const playerB = result.players.find((p) => p.name === 'PlayerB'); // AA, won
  const playerC = result.players.find((p) => p.name === 'PlayerC'); // KK, lost
  assert.ok(playerB && playerC);
  assert.ok(Math.abs(playerB.equity - 0.812) < 0.02, `expected PlayerB's equity near 81.2%, got ${(playerB.equity * 100).toFixed(1)}%`);
  assert.ok(playerB.adjustmentBB < -30, 'PlayerB (AA) won it all with only ~81% equity — strongly negative adjustment');
  assert.strictEqual(playerC.adjustmentBB, -playerB.adjustmentBB);
  // Calling it without any heroNameOverride at all must give the identical
  // result — nothing about this computation actually depends on who hero is.
  const resultNoHero = computeHandEVAdjustment(HAND_ALLIN_BETWEEN_NON_HERO_PLAYERS, null, { trials: 30000 });
  assert.ok(resultNoHero);
  const playerBAgain = resultNoHero.players.find((p) => p.name === 'PlayerB');
  assert.ok(Math.abs(playerBAgain.equity - playerB.equity) < 0.05, 'same spot, same equity regardless of heroNameOverride');
});

console.log(`\n${passed} test(s) passed.`);
