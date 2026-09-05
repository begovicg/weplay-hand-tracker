'use strict';

// Plain-Node regression tests, no framework — run with `npm test`.
// These exist because the pot-math bug (Total pot vs. rake vs. collected)
// slipped through once already; this file is here so it can't slip through
// silently again.

const assert = require('assert');
const { convertHand, convertFile, splitHands } = require('../src/converter');

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

// Checks the invariant PokerTracker itself validates:
// Total pot - Rake - Splash Fee == sum of all "collected ... from pot" amounts.
// Also checks Main pot + Side pot == Total pot when a side pot is present.
function assertPotMath(text) {
  const m = /Total pot ₮([0-9.]+)(?:\s+Main pot ₮([0-9.]+)\.\s+Side pot ₮([0-9.]+)\.)?\s*\|\s*Rake ₮([0-9.]+)\s*\|\s*Splash Fee ₮([0-9.]+)/.exec(text);
  assert.ok(m, 'Total pot line not found');
  const total = parseFloat(m[1]);
  const rake = parseFloat(m[4]);
  const splash = parseFloat(m[5]);
  let collectedSum = 0;
  const cre = /collected ₮([0-9.]+) from (?:pot|main pot|side pot)/g;
  let cm;
  while ((cm = cre.exec(text))) collectedSum += parseFloat(cm[1]);
  const expected = Math.round((total - rake - splash) * 100) / 100;
  assert.ok(
    Math.abs(expected - collectedSum) < 0.005,
    `Total pot - Rake - Splash (${expected}) should equal collected sum (${collectedSum})`
  );
  if (m[2] && m[3]) {
    const main = parseFloat(m[2]);
    const side = parseFloat(m[3]);
    assert.ok(
      Math.abs((main + side) - total) < 0.005,
      `Main pot + Side pot (${main + side}) should equal Total pot (${total})`
    );
  }
}

// ── Fixture: single winner, raked, uncontested-into-showdown scenario ──────
const HAND_SINGLE_WINNER = `Weplay Hand #85897948:  Hold'em No Limit ($0.50/$1) - 2026/07/05 18:59:16 UTC
Table 'Belgrade #2'(11751800) 6-max Seat #2 is the button
Seat 1: luigi86 ($63.89 in chips)
Seat 2: Mrle0203 ($98.87 in chips)
Seat 3: petit_blaireau ($100 in chips)
Seat 4: marko_kon ($167.67 in chips)
Seat 5: Toni01 ($85.03 in chips)
Seat 6: Perakralj ($292.13 in chips)
luigi86: posts the ante $0.16
Mrle0203: posts the ante $0.16
petit_blaireau: posts the ante $0.16
marko_kon: posts the ante $0.16
Toni01: posts the ante $0.16
Perakralj: posts the ante $0.16
petit_blaireau: posts small blind $0.50
marko_kon: posts big blind $1
*** HOLE CARDS ***
Dealt to petit_blaireau [Ac 4c]
Toni01: folds
Perakralj: folds
luigi86: calls $1
Mrle0203: raises $2 to $2
petit_blaireau: raises $11.47 to $11.97
marko_kon: folds
luigi86: folds
Mrle0203: calls $9.97
*** FLOP *** [8c 5h Kh]
petit_blaireau: checks
Mrle0203: bets $13
petit_blaireau: folds
Uncalled bet ($13) returned to Mrle0203
*** SHOW DOWN ***
Mrle0203 has timed out
Mrle0203: doesn't show hand
Mrle0203 collected $26.90 from pot
*** SUMMARY ***
Total pot $26.90 | Rake $1.34 
Board [8c 5h Kh]
Seat 1: luigi86 folded before Flop 
Seat 2: Mrle0203 (button) collected ($26.90)
Seat 3: petit_blaireau (small blind) folded on the Flop 
Seat 4: marko_kon (big blind) folded before Flop 
Seat 5: Toni01 folded before Flop 
Seat 6: Perakralj folded before Flop`;

// ── Fixture: VanillaPoker — same network, different site name in the header
// (confirmed byte-for-byte identical format otherwise against real
// VanillaPoker sample files) ────────────────────────────────────────────
const HAND_VANILLAPOKER = `VanillaPoker Hand #88209716:  Hold'em No Limit ($0.50/$1) - 2026/08/14 16:47:43 UTC
Table 'Belgrade #2'(11797804) 6-max Seat #1 is the button
Seat 1: Usisivac ($107.24 in chips)
Seat 2: Kure55 ($80.29 in chips)
Seat 3: ryzenn ($108.39 in chips)
Usisivac: posts the ante $0.18
Kure55: posts the ante $0.18
ryzenn: posts the ante $0.18
Kure55: posts small blind $0.50
ryzenn: posts big blind $1
*** HOLE CARDS ***
Dealt to Usisivac [4s 9d]
Usisivac: folds
Kure55: folds
Uncalled bet ($0.50) returned to ryzenn
*** SHOW DOWN ***
ryzenn collected $1.36 from pot
*** SUMMARY ***
Total pot $1.36 | Rake $0
Seat 1: Usisivac folded before Flop
Seat 2: Kure55 (small blind) folded before Flop
Seat 3: ryzenn (big blind) collected ($1.36)`;

// ── Fixture: side pot (short stack all-in covered by two others) ──────────
const HAND_SIDE_POT = `Weplay Hand #90000001:  Hold'em No Limit ($1/$2) - 2026/07/05 19:00:00 UTC
Table 'Test #1'(11751801) 6-max Seat #1 is the button
Seat 1: PlayerA ($200 in chips)
Seat 2: PlayerB ($40 in chips)
Seat 3: PlayerC ($200 in chips)
PlayerB: posts small blind $1
PlayerC: posts big blind $2
*** HOLE CARDS ***
Dealt to PlayerA [As Ad]
PlayerA: raises $40 to $40 and is all-in
PlayerB: calls $39 and is all-in
PlayerC: calls $38
*** FLOP *** [2c 7d 9h]
*** TURN *** [2c 7d 9h] [Kh]
*** RIVER *** [2c 7d 9h Kh] [3s]
*** SHOW DOWN ***
PlayerA: shows [As Ad] (a pair of Aces)
PlayerC: shows [Kd Kc] (a pair of Kings)
PlayerA collected $120 from main pot
PlayerA collected $6 from side pot
*** SUMMARY ***
Total pot $126 Main pot $120. Side pot $6. | Rake $4
Board [2c 7d 9h Kh 3s]
Seat 1: PlayerA showed [As Ad] and won ($126) with a pair of Aces
Seat 2: PlayerB showed [Qc Qd] and lost with a pair of Queens
Seat 3: PlayerC showed [Kd Kc] and lost with a pair of Kings`;

// ── Fixture: split pot, two winners, no side pot ───────────────────────────
const HAND_SPLIT_POT = `Weplay Hand #90000002:  Hold'em No Limit ($1/$2) - 2026/07/05 19:05:00 UTC
Table 'Test #1'(11751801) 6-max Seat #1 is the button
Seat 1: PlayerA ($200 in chips)
Seat 2: PlayerB ($200 in chips)
PlayerA: posts small blind $1
PlayerB: posts big blind $2
*** HOLE CARDS ***
Dealt to PlayerA [As Kd]
PlayerA: calls $1
PlayerB: checks
*** FLOP *** [2c 7d 9h]
PlayerA: checks
PlayerB: checks
*** TURN *** [2c 7d 9h] [Kh]
PlayerA: checks
PlayerB: checks
*** RIVER *** [2c 7d 9h Kh] [3s]
PlayerA: checks
PlayerB: checks
*** SHOW DOWN ***
PlayerA: shows [As Kd] (a pair of Kings)
PlayerB: shows [Ah Kc] (a pair of Kings)
PlayerA collected $1.90 from pot
PlayerB collected $1.90 from pot
*** SUMMARY ***
Total pot $3.80 | Rake $0.19
Board [2c 7d 9h Kh 3s]
Seat 1: PlayerA showed [As Kd] and won ($1.90) with a pair of Kings
Seat 2: PlayerB showed [Ah Kc] and won ($1.90) with a pair of Kings`;

// ── Fixture: no rake at all (preflop-only fold), makes sure we don't break this ──
const HAND_NO_RAKE = `Weplay Hand #90000003:  Hold'em No Limit ($1/$2) - 2026/07/05 19:10:00 UTC
Table 'Test #1'(11751801) 6-max Seat #1 is the button
Seat 1: PlayerA ($200 in chips)
Seat 2: PlayerB ($200 in chips)
PlayerA: posts small blind $1
PlayerB: posts big blind $2
*** HOLE CARDS ***
Dealt to PlayerA [As Kd]
PlayerA: folds
Uncalled bet ($1) returned to PlayerB
PlayerB collected $2 from pot
*** SUMMARY ***
Total pot $2 | Rake $0
Seat 1: PlayerA folded before Flop 
Seat 2: PlayerB (big blind) collected ($2)`;

test('single winner: rake is deducted from the winner\'s payout, Total pot stays as Weplay stated it', () => {
  const { text, skipped } = convertHand(HAND_SINGLE_WINNER, { replaceHeroName: true });
  assert.ok(!skipped, 'hand should not be skipped');
  assertPotMath(text);
  assert.ok(text.includes('Total pot ₮26.90 | Rake ₮1.34'), `Total pot should stay unchanged at 26.90, got: ${text}`);
  assert.ok(text.includes('Mrle0203 collected ₮25.56 from pot'), `collected amount should be 26.90 - 1.34 = 25.56, got: ${text}`);
  assert.ok(text.includes('Mrle0203 won (₮25.56)'), `summary "won" amount should match the rake-adjusted collected amount, got: ${text}`);
});

test('side pot: rake is distributed proportionally across main and side pots', () => {
  const { text, skipped } = convertHand(HAND_SIDE_POT, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  assertPotMath(text);
  // $4 rake split proportionally between the $120 main pot and $6 side pot
  // (single collector for both): main gets 120/126 of the rake, side gets 6/126.
  assert.ok(text.includes('PlayerA collected ₮116.19 from main pot'), `main pot payout should be reduced proportionally, got: ${text}`);
  assert.ok(text.includes('PlayerA collected ₮5.81 from side pot'), `side pot payout should also be reduced proportionally, got: ${text}`);
  // Summary reports one combined figure: 116.19 + 5.81 = 122.
  assert.ok(text.includes('PlayerA showed [As Ad] and won (₮122.00) with One Pair'), `summary should show the combined post-rake total, got: ${text}`);
});

test('split pot: two winners share the rake reduction proportionally', () => {
  const { text, skipped } = convertHand(HAND_SPLIT_POT, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  assertPotMath(text);
  // $0.19 rake split evenly between two equal $1.90 collectors: $0.095 each, rounds to 9/10 cents.
  assert.ok(text.includes('PlayerA collected ₮1.'), `sanity: PlayerA's collected amount should be present, got: ${text}`);
  const collectedAmounts = [...text.matchAll(/collected ₮([0-9.]+) from pot/g)].map((m) => parseFloat(m[1]));
  assert.strictEqual(collectedAmounts.length, 2, 'expected two collected lines');
  assert.ok(Math.abs(collectedAmounts[0] + collectedAmounts[1] - 3.61) < 0.005, `split amounts should sum to 3.80 - 0.19 = 3.61, got: ${collectedAmounts}`);
});

test('no rake: pot figure and collected amount are both unchanged when rake is zero', () => {
  const { text, skipped } = convertHand(HAND_NO_RAKE, { replaceHeroName: true });
  assert.ok(!skipped, 'hand should not be skipped');
  assertPotMath(text);
  assert.ok(text.includes('Total pot ₮2 | Rake ₮0'), `expected unchanged pot of 2, got: ${text}`);
  assert.ok(text.includes('PlayerB collected ₮2 from pot'), `expected unchanged collected amount of 2, got: ${text}`);
});

test('convertFile: multi-hand file, every hand individually satisfies pot math', () => {
  const combined = [HAND_SINGLE_WINNER, HAND_SIDE_POT, HAND_SPLIT_POT, HAND_NO_RAKE].join('\n\n');
  const result = convertFile(combined, { replaceHeroName: true });
  assert.strictEqual(result.handCount, 4);
  assert.strictEqual(result.skippedHands.length, 0);
  const hands = result.text.split(/(?=^CoinPoker Hand #)/m).filter((h) => h.trim());
  assert.strictEqual(hands.length, 4);
  hands.forEach(assertPotMath);
});

// ── Fixture: button seat vacated mid-session (player left), 4-handed ──────
const HAND_VACANT_BUTTON = `Weplay Hand #85898053:  Hold'em No Limit ($0.50/$1) - 2026/07/05 19:03:00 UTC
Table 'Belgrade #2'(11751800) 6-max Seat #1 is the button
Seat 3: PlayerC ($100 in chips)
Seat 4: PlayerD ($165.37 in chips)
Seat 5: PlayerE ($82.23 in chips)
Seat 6: PlayerF ($464.81 in chips)
PlayerC: posts the ante $0.16
PlayerD: posts the ante $0.16
PlayerE: posts the ante $0.16
PlayerF: posts the ante $0.16
PlayerC: posts small blind $0.50
PlayerD: posts big blind $1
*** HOLE CARDS ***
Dealt to PlayerC [Ac 8s]
PlayerE: calls $1
PlayerF: folds
PlayerC: folds
PlayerD: folds
PlayerE: collected $2.66 from pot
*** SUMMARY ***
Total pot $2.66 | Rake $0
Seat 3: PlayerC (small blind) folded before Flop 
Seat 4: PlayerD (big blind) folded before Flop 
Seat 5: PlayerE collected ($2.66)
Seat 6: PlayerF folded before Flop`;

// ── Fixture: heads-up with a vacated button seat (button must equal SB) ───
const HAND_VACANT_BUTTON_HEADSUP = `Weplay Hand #90000004:  Hold'em No Limit ($1/$2) - 2026/07/05 19:15:00 UTC
Table 'Test #1'(11751801) 6-max Seat #1 is the button
Seat 2: PlayerB ($200 in chips)
Seat 5: PlayerE ($200 in chips)
PlayerB: posts small blind $1
PlayerE: posts big blind $2
*** HOLE CARDS ***
Dealt to PlayerB [As Kd]
PlayerB: folds
Uncalled bet ($1) returned to PlayerE
PlayerE collected $2 from pot
*** SUMMARY ***
Total pot $2 | Rake $0
Seat 2: PlayerB (small blind) folded before Flop 
Seat 5: PlayerE (big blind) collected ($2)`;

test('vacant button seat: reassigned to the occupied seat before the small blind', () => {
  const { text, skipped, warnings } = convertHand(HAND_VACANT_BUTTON, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  // Seat 1 (stated) is empty; occupied seats are 3,4,5,6 with SB at seat 3.
  // The occupied seat immediately before seat 3, wrapping, is seat 6.
  assert.ok(text.includes("Seat #6 is the button"), `expected button reassigned to seat 6, got: ${text}`);
  assert.ok(warnings.some((w) => w.includes('moved the button to seat #6')), 'expected a warning about the button reassignment');
});

test('vacant button seat, heads-up: button reassigned to the small blind\'s own seat', () => {
  const { text, skipped } = convertHand(HAND_VACANT_BUTTON_HEADSUP, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  // Heads-up: button and small blind are the same seat by rule.
  assert.ok(text.includes("Seat #2 is the button"), `expected button reassigned to SB's own seat 2, got: ${text}`);
});

// ── Fixture: folded player whose cards get revealed anyway (Weplay quirk) ──
const HAND_FOLD_REVEALED = `Weplay Hand #90000005:  Hold'em No Limit ($0.25/$0.50) - 2026/07/07 20:45:58 UTC
Table 'Test #1'(11751801) 8-max Seat #6 is the button
Seat 1: rojab ($50.52 in chips)
Seat 2: moosegb ($33.22 in chips)
Seat 3: DD222 ($2.54 in chips)
Seat 6: InnerPower ($8.49 in chips)
rojab: posts the ante $0.12
moosegb: posts the ante $0.12
DD222: posts the ante $0.12
InnerPower: posts the ante $0.12
InnerPower: posts small blind $0.25
rojab: posts big blind $0.50
*** HOLE CARDS ***
Dealt to DD222 [Ts 5d]
moosegb: calls $0.50
DD222: calls $0.50
InnerPower: raises $8.37 to $8.37 and is all-in
rojab: folds
moosegb: calls $7.87
DD222: folds
*** FLOP *** [9c 7h 5h]
*** TURN *** [9c 7h 5h] [5s]
*** RIVER *** [9c 7h 5h 5s] [Td]
*** SHOW DOWN ***
moosegb: shows [Kc Js] (a pair of Fives)
InnerPower: shows [9d 7d] (two pair, Nines and Sevens)
DD222: shows [] (a pair of Fives)
InnerPower collected $19.45 from pot
*** SUMMARY ***
Total pot $19.45 | Rake $0.97 
Board [9c 7h 5h 5s Td]
Seat 1: rojab folded before Flop 
Seat 2: moosegb showed [Kc Js] and lost with a pair of Fives
Seat 3: DD222 folded before Flop showed [Ts 5d] and lost with a pair of Fives
Seat 6: InnerPower (button) showed [9d 7d] and won ($19.45) with two pair, Nines and Sevens`;

// ── Fixture: real run-it-twice hand (two different winners, one per board) ─
const HAND_RUN_TWICE = `Weplay Hand #86030283:  Hold'em No Limit ($0.25/$0.50) - 2026/07/07 19:12:13 UTC
Table 'Manchester #1'(11730801) 8-max Seat #7 is the button
Seat 1: Felix ($52.66 in chips)
Seat 3: PlayerC ($68.23 in chips)
Seat 4: Kissallin ($50 in chips)
Seat 6: PlayerF ($42.44 in chips)
Seat 7: petit_blaireau ($101.19 in chips)
Felix: posts the ante $0.12
PlayerC: posts the ante $0.12
Kissallin: posts the ante $0.12
PlayerF: posts the ante $0.12
petit_blaireau: posts the ante $0.12
Felix: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to petit_blaireau [9c 6s]
Kissallin: folds
PlayerF: calls $0.50
petit_blaireau: folds
Felix: folds
PlayerC: raises $4.50 to $5
PlayerF: calls $4.50
*** FLOP *** [Jd Js 7d]
PlayerC: bets $20.50
PlayerF: raises $37.32 to $37.32 and is all-in
PlayerC: calls $16.82
*** TURN *** [Jd Js 7d] [8d]
*** FIRST RIVER *** [Jd Js 7d 8d] [8s]
*** SECOND TURN *** [Jd Js 7d] [4h]
*** SECOND RIVER *** [Jd Js 7d 4h] [5c]
*** SHOW DOWN ***
PlayerC: shows [9d Ad] (a flush, Ace high)
PlayerF: shows [9h 9s] (two pair, Jacks and Nines)
PlayerC collected $42.75 from pot
PlayerF collected $42.74 from pot
*** SUMMARY ***
Total pot $85.49 | Rake $4 
Hand was run two times
FIRST Board [Jd Js 7d 8d 8s]
SECOND Board [Jd Js 7d 4h 5c]
Seat 1: Felix (small blind) folded before Flop 
Seat 3: PlayerC (big blind) showed [9d Ad] and won ($42.75) with a flush, Ace high
Seat 4: Kissallin folded before Flop 
Seat 6: PlayerF showed [9h 9s] and won ($42.74) with two pair, Jacks and Nines
Seat 7: petit_blaireau (button) folded before Flop `;

test('folded player with cards revealed anyway: showdown line dropped, summary truncated to plain fold', () => {
  const { text, skipped, warnings } = convertHand(HAND_FOLD_REVEALED, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  assert.ok(!text.includes('shows []'), `empty-cards shows line should be dropped entirely, got: ${text}`);
  assert.ok(text.includes('Seat 3: DD222 folded before Flop (didn\'t bet)'), `summary should truncate to a plain fold, got: ${text}`);
  assert.ok(!text.includes('DD222 showed'), `summary should not describe DD222 as a showdown participant, got: ${text}`);
});

test('run-it-twice: real hand converts with correct board reconstruction and per-board payouts', () => {
  const { text, skipped } = convertHand(HAND_RUN_TWICE, { replaceHeroName: false });
  assert.ok(!skipped, 'run-it-twice hands should convert, not be skipped');
  assertPotMath(text);
  // Every street gets a FIRST prefix, even ones that never diverge (confirmed CoinPoker convention).
  assert.ok(text.includes('*** FIRST FLOP *** [Jd Js 7d]'), `flop should be labeled FIRST even though it never diverges, got: ${text}`);
  assert.ok(text.includes('*** FIRST TURN *** [Jd Js 7d] [8d]'), `expected FIRST TURN even though Weplay left it unlabeled, got: ${text}`);
  assert.ok(text.includes('*** FIRST RIVER *** [Jd Js 7d 8d] [8s]'), `expected FIRST RIVER, got: ${text}`);
  assert.ok(text.includes('*** SECOND TURN *** [Jd Js 7d] [4h]'), `expected SECOND TURN, got: ${text}`);
  assert.ok(text.includes('*** SECOND RIVER *** [Jd Js 7d 4h] [5c]'), `expected SECOND RIVER, got: ${text}`);
  // Sequential ordering: all FIRST streets before any SECOND street.
  assert.ok(text.indexOf('SECOND TURN') > text.indexOf('FIRST RIVER'), 'SECOND streets should come after all FIRST streets, not interleaved');
  // Two separate showdown blocks with the correct rake-adjusted per-board amounts.
  assert.ok(text.includes('*** FIRST SHOWDOWN ***'), `expected FIRST SHOWDOWN header, got: ${text}`);
  assert.ok(text.includes('*** SECOND SHOWDOWN ***'), `expected SECOND SHOWDOWN header, got: ${text}`);
  assert.ok(text.includes('PlayerC collected ₮40.75 from pot'), `expected board1 payout net of rake, got: ${text}`);
  assert.ok(text.includes('PlayerF collected ₮40.74 from pot'), `expected board2 payout net of rake, got: ${text}`);
  // Summary board lines and concatenated per-board result for the two different winners.
  assert.ok(text.includes('FIRST Board [ Jd Js 7d 8d 8s ]'), `expected FIRST Board summary line, got: ${text}`);
  assert.ok(text.includes('SECOND Board [ Jd Js 7d 4h 5c ]'), `expected SECOND Board summary line, got: ${text}`);
  assert.ok(text.includes('PlayerC showed [9d Ad] and won (₮40.75) with Flush, and lost with Flush'), `expected concatenated won/lost summary for board1 winner, got: ${text}`);
  assert.ok(text.includes('PlayerF showed [9h 9s] and lost with Two Pair, and won (₮40.74) with Two Pair'), `expected concatenated lost/won summary for board2 winner, got: ${text}`);
});

// ── Fixture: bomb pot — ante only, no blinds, straight to flop (real structure) ──
const HAND_BOMB_POT = `Weplay Hand #85897620:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:45:37 UTC
Table 'Liverpool Bomb Pot 1 (3BB)'(11747810) 8-max Seat #1 is the button
Seat 1: PlayerA ($52 in chips)
Seat 3: PlayerB ($26.52 in chips)
PlayerA: posts the ante $1.50
PlayerB: posts the ante $1.50
*** HOLE CARDS ***
Dealt to PlayerA [5s 4d]
*** FLOP *** [Tc 7h 2h]
PlayerB: checks
PlayerA: checks
*** TURN *** [Tc 7h 2h] [4h]
PlayerB: checks
PlayerA: bets $4.50
PlayerB: calls $4.50
*** RIVER *** [Tc 7h 2h 4h] [5c]
PlayerB: checks
PlayerA: checks
*** SHOW DOWN ***
PlayerA: shows [5s 4d] (two pair, Fives and Fours)
PlayerB: mucks hand
PlayerA collected $9 from pot
*** SUMMARY ***
Total pot $9 | Rake $0.45 
Board [Tc 7h 2h 4h 5c]
Seat 1: PlayerA (button) showed [5s 4d] and won ($9) with two pair, Fives and Fours
Seat 3: PlayerB mucked`;

// ── Fixture: time-bank noise line + a duplicate mid-hand "HOLE CARDS" block ──
const HAND_DUPLICATE_DEALT = `Weplay Hand #85903510:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 20:19:59 UTC
Table 'Test #1'(11747810) 8-max Seat #4 is the button
Seat 1: PlayerA ($99.02 in chips)
Seat 4: PlayerB ($44.78 in chips)
PlayerB: posts small blind $0.25
PlayerA: posts big blind $0.50
*** HOLE CARDS ***
Dealt to PlayerA [5h Ah]
PlayerB: activates time bank
PlayerB: calls $0.25
*** FLOP *** [9c 5c Ad]
PlayerB: checks
PlayerA: checks
*** TURN *** [9c 5c Ad] [4c]
PlayerB: checks
PlayerA: checks
*** RIVER *** [9c 5c Ad 4c] [3c]
PlayerB: bets $8.07
PlayerA: folds
Uncalled bet ($8.07) returned to PlayerB
*** HOLE CARDS ***
Dealt to PlayerA [5h Ah]
*** SHOW DOWN ***
PlayerB has timed out
PlayerB: doesn't show hand
PlayerB collected $1.31 from pot
*** SUMMARY ***
Total pot $1.31 | Rake $0.06 
Board [9c 5c Ad 4c 3c]
Seat 1: PlayerA folded on the River 
Seat 4: PlayerB collected ($1.31)`;

test('bomb pot: ante-only hand with no blinds and no preflop action converts cleanly', () => {
  const { text, skipped, warnings } = convertHand(HAND_BOMB_POT, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  assert.strictEqual(warnings.length, 0, `expected no warnings, got: ${JSON.stringify(warnings)}`);
  assertPotMath(text);
  assert.ok(!text.includes('posts small blind') && !text.includes('posts big blind'), `bomb pot hands post no blinds, got: ${text}`);
  assert.ok(text.includes('*** HOLE CARDS ***\nDealt to PlayerA [5s 4d]\nDealt to PlayerB\n*** FLOP ***'), `expected hole cards to go straight into the flop with no preflop action line, got: ${text}`);
});

test('time bank activation is dropped as noise, duplicate mid-hand HOLE CARDS block is dropped cleanly', () => {
  const { text, skipped, warnings } = convertHand(HAND_DUPLICATE_DEALT, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  assert.strictEqual(warnings.length, 0, `expected no warnings, got: ${JSON.stringify(warnings)}`);
  assert.ok(!text.includes('time bank'), `time bank line should be dropped, got: ${text}`);
  assert.strictEqual((text.match(/\*\*\* HOLE CARDS \*\*\*/g) || []).length, 1, `expected exactly one HOLE CARDS block, got: ${text}`);
  assert.ok(!text.includes('Dealt to PlayerA [5h Ah]\n*** SHOW DOWN'), `duplicate Dealt-to line right before showdown should be dropped, got: ${text}`);
});

// ── Fixture: real run-it-twice hand ALSO with a side pot (short stack all-in) ──
const HAND_RUN_TWICE_SIDE_POT = `Weplay Hand #85903942:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 20:32:38 UTC
Table 'Liverpool Bomb Pot 2 (3BB)'(11748800) 8-max Seat #4 is the button
Seat 2: PlayerB ($8.43 in chips)
Seat 4: olindo ($27.45 in chips)
Seat 5: petit_blaireau ($81.93 in chips)
PlayerB: posts the ante $1.50
olindo: posts the ante $1.50
petit_blaireau: posts the ante $1.50
*** HOLE CARDS ***
Dealt to petit_blaireau [8c Ac]
*** FLOP *** [3c Jc 4s]
petit_blaireau: checks
olindo: bets $9
petit_blaireau: raises $80.43 to $80.43 and is all-in
PlayerB: calls $6.93 and is all-in
olindo: folds
Uncalled bet ($71.43) returned to petit_blaireau
*** FIRST TURN *** [3c Jc 4s] [3h]
*** FIRST RIVER *** [3c Jc 4s 3h] [6s]
*** SECOND TURN *** [3c Jc 4s] [Kc]
*** SECOND RIVER *** [3c Jc 4s Kc] [Tc]
*** SHOW DOWN ***
petit_blaireau: shows [8c Ac] (a pair of Threes)
PlayerB: shows [5c 2c] (a straight, Deuce to Six)
petit_blaireau collected $4.14 from side pot
PlayerB collected $14.90 from main pot
petit_blaireau collected $14.89 from main pot
*** SUMMARY ***
Total pot $33.93 Main pot $29.79. Side pot $4.14. | Rake $1.69
Hand was run two times
FIRST Board [3c Jc 4s 3h 6s]
SECOND Board [3c Jc 4s Kc Tc]
Seat 2: PlayerB showed [5c 2c] and won ($14.90) with a straight, Deuce to Six
Seat 4: olindo (button) folded on the Flop
Seat 5: petit_blaireau showed [8c Ac] and won ($19.03) with a pair of Threes`;

test('run-it-twice + side pot combined: side pot attached once, all three payouts preserved', () => {
  const { text, skipped } = convertHand(HAND_RUN_TWICE_SIDE_POT, { replaceHeroName: false });
  assert.ok(!skipped, 'hand should not be skipped');
  assertPotMath(text);
  // All three real collected lines must survive — this is the bug that was found:
  // the side-pot payout was previously silently dropped from the output entirely.
  assert.ok(text.includes('from side pot'), `side pot collected line should be present, got: ${text}`);
  const collectedCount = (text.match(/collected ₮[0-9.]+ from/g) || []).length;
  assert.strictEqual(collectedCount, 3, `expected all 3 collected lines to survive, got: ${text}`);
  // petit_blaireau's summary total should include the side pot plus their board2 main-pot share.
  assert.ok(text.includes('petit_blaireau showed [8c Ac] and won'), `expected petit_blaireau's summary win line, got: ${text}`);
});

// ── Fixture: real corrupted hand — disconnect at showdown, no winner ever recorded ──
const HAND_NO_RESOLUTION = `Weplay Hand #87869639:  Hold'em No Limit ($0.25/$0.50) - 2026/08/06 20:46:40 UTC
Table 'London #1'(11797814) 6-max (Money 3) Seat #1 is the button
Seat 1: Onkel ($56.89 in chips)
Seat 2: Nator ($48.86 in chips)
Seat 3: LudoMammy ($56.45 in chips)
Seat 5: petit_blaireau ($53.18 in chips)
Seat 6: VukoKai ($57.11 in chips)
Onkel: posts the ante $0.09
Nator: posts the ante $0.09
LudoMammy: posts the ante $0.09
petit_blaireau: posts the ante $0.09
VukoKai: posts the ante $0.09
Nator: posts small blind $0.25
LudoMammy: posts big blind $0.50
*** HOLE CARDS ***
Dealt to petit_blaireau [Kc 9c]
petit_blaireau: raises $1.25 to $1.25
VukoKai: folds
Onkel: raises $4.55 to $4.55
Nator: folds
LudoMammy: folds
petit_blaireau: calls $3.30
*** FLOP *** [Jd 6c Kd]
petit_blaireau: checks
Onkel: bets $3.40
petit_blaireau: calls $3.40
*** TURN *** [Jd 6c Kd] [8s]
petit_blaireau: checks
Onkel: checks
*** RIVER *** [Jd 6c Kd 8s] [8c]
petit_blaireau: bets $11.97
Onkel: calls $11.97
*** SHOW DOWN ***
petit_blaireau is disconnected
*** SUMMARY ***
Total pot $41.04 | Rake $2.46
Board [Jd 6c Kd 8s 8c]
Seat 1: Onkel (button)
Seat 2: Nator (small blind) folded before Flop
Seat 3: LudoMammy (big blind) folded before Flop
Seat 5: petit_blaireau
Seat 6: VukoKai folded before Flop`;

test('hand with no resolution anywhere (disconnect at showdown, no winner ever recorded) is skipped, not emitted broken', () => {
  const { skipped, skipReason } = convertHand(HAND_NO_RESOLUTION, { replaceHeroName: true });
  assert.ok(skipped, 'a hand with no collected-from-pot line anywhere should be skipped');
  assert.ok(/no.*collected from pot/i.test(skipReason), `expected a clear reason about the missing resolution, got: ${skipReason}`);
});

test('VanillaPoker: header is recognized and converts just like a Weplay hand (same network, different site name)', () => {
  const { text, skipped, handId } = convertHand(HAND_VANILLAPOKER, { replaceHeroName: false });
  assert.ok(!skipped, 'a VanillaPoker header should not be treated as unparseable');
  assert.ok(/^CoinPoker Hand #88209716:/.test(text), 'hand ID should be pulled from the VanillaPoker header');
  assertPotMath(text);
});

test('VanillaPoker: splitHands splits a file mixing Weplay and VanillaPoker blocks into separate hands', () => {
  const mixed = `${HAND_SINGLE_WINNER}\n\n\n${HAND_VANILLAPOKER}\n`;
  const blocks = splitHands(mixed);
  assert.strictEqual(blocks.length, 2, 'both a Weplay block and a VanillaPoker block should be split out');
  assert.ok(blocks[0].startsWith('Weplay Hand #85897948'));
  assert.ok(blocks[1].startsWith('VanillaPoker Hand #88209716'));
});

test('VanillaPoker: convertFile processes a VanillaPoker-only file end to end, hand ID detected correctly', () => {
  const { handCount, skippedHands, text } = convertFile(HAND_VANILLAPOKER, { replaceHeroName: false });
  assert.strictEqual(handCount, 1);
  assert.strictEqual(skippedHands.length, 0);
  assertPotMath(text);
});

console.log(`\n${passed} test(s) passed.`);
if (process.exitCode) {
  console.error('Some tests FAILED.');
  process.exit(1);
}
