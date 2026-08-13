'use strict';

const assert = require('assert');
const { analyzeHand, aggregateStats, positionLabelsFor, handCategoryFor } = require('../src/stats');

let passed = 0;
function test(name, fn) {
  fn();
  passed++;
  console.log('  ok  -', name);
}

// ── Fixtures ────────────────────────────────────────────────────────────

const HAND_VPIP_CALL = `Weplay Hand #1:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:00:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerC: calls $0.50
PlayerA: folds
Hero: checks
*** FLOP *** [2c 7d 9s]
Hero: checks
PlayerC: checks
*** TURN *** [2c 7d 9s] [3h]
Hero: checks
PlayerC: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
Hero: bets $1
PlayerC: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $1.25 from pot
*** SUMMARY ***
Total pot $1.25 | Rake $0
Board [2c 7d 9s 3h 4d]
Seat 1: PlayerA (small blind) folded before Flop
Seat 2: Hero (big blind) collected ($1.25)
Seat 3: PlayerC folded on the River`;

const HAND_VPIP_FOLD = `Weplay Hand #2:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:01:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Hero: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: raises $1.5 to $1.5
Hero: folds
PlayerC: folds
Uncalled bet ($1) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $2.25 from pot
*** SUMMARY ***
Total pot $2.25 | Rake $0
Seat 1: PlayerA collected ($2.25)
Seat 2: Hero (small blind) folded before Flop
Seat 3: PlayerC (big blind) folded before Flop`;

const HAND_HERO_OPENS_AND_3BETS_FOLDS = `Weplay Hand #3:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:02:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerC: posts small blind $0.25
PlayerA: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: raises $1.5 to $1.5
PlayerC: folds
PlayerA: raises $4.5 to $4.5
Hero: folds
Uncalled bet ($1) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $6.75 from pot
*** SUMMARY ***
Total pot $6.75 | Rake $0
Seat 1: PlayerA (big blind) collected ($6.75)
Seat 2: Hero folded before Flop
Seat 3: PlayerC (small blind) folded before Flop`;

const HAND_HERO_MAKES_A_3BET = `Weplay Hand #4:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:03:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
PlayerC: raises $1.5 to $1.5
PlayerA: folds
Hero: raises $5 to $5.5
PlayerC: folds
Uncalled bet ($4) returned to Hero
*** SHOW DOWN ***
Hero collected $2.5 from pot
*** SUMMARY ***
Total pot $2.5 | Rake $0
Seat 1: PlayerA (small blind) folded before Flop
Seat 2: Hero (big blind) collected ($2.5)
Seat 3: PlayerC folded before Flop`;

// A hand where the header text "*** SHOW DOWN ***" appears but only one
// player is left — this is the exact bug found and fixed in the standalone
// script: it must NOT count as a genuine showdown.
const HAND_UNCONTESTED_WITH_SHOWDOWN_HEADER = `Weplay Hand #5:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:04:00 UTC
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
Seat 1: PlayerA folded on the Flop
Seat 2: Hero (big blind) collected ($1)`;

const HAND_BOMB_POT = `Weplay Hand #6:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:05:00 UTC
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

const HAND_NO_RESOLUTION = `Weplay Hand #7:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:06:00 UTC
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
PlayerA: calls $1
*** SHOW DOWN ***
Hero is disconnected
*** SUMMARY ***
Total pot $3 | Rake $0.15
Seat 1: PlayerA
Seat 2: Hero`;

const HAND_VPIP_VIA_CALL = `Weplay Hand #8:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:07:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Hero: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: raises $1.5 to $1.5
Hero: calls $1.25
PlayerC: folds
*** FLOP *** [2c 7d 9s]
Hero: checks
PlayerA: checks
*** TURN *** [2c 7d 9s] [3h]
Hero: checks
PlayerA: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
Hero: checks
PlayerA: checks
*** SHOW DOWN ***
Hero: shows [Ah Kh] (One Pair)
PlayerA: shows [Qc Qd] (One Pair)
PlayerA collected $3.25 from pot
*** SUMMARY ***
Total pot $3.25 | Rake $0
Seat 1: PlayerA showed [Qc Qd] and won ($3.25) with One Pair
Seat 2: Hero (small blind) showed [Ah Kh] and lost with One Pair
Seat 3: PlayerC (big blind) folded before Flop`;

const HAND_SRP_AS_RAISER = `Weplay Hand #9:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:08:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerB: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: raises $1.5 to $1.5
PlayerB: folds
PlayerC: calls $1
*** FLOP *** [2c 7d 9s]
PlayerC: checks
Hero: checks
*** TURN *** [2c 7d 9s] [3h]
PlayerC: checks
Hero: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
PlayerC: checks
Hero: bets $2
PlayerC: calls $2
*** SHOW DOWN ***
Hero: shows [Ah Kh] (One Pair)
PlayerC: shows [Qc Qd] (One Pair)
Hero collected $7 from pot
*** SUMMARY ***
Total pot $7 | Rake $0.35
Seat 1: Hero showed [Ah Kh] and won ($7) with One Pair
Seat 2: PlayerB (small blind) folded before Flop
Seat 3: PlayerC (big blind) showed [Qc Qd] and lost with One Pair`;

const HAND_3BET_AS_CALLER = `Weplay Hand #10:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:09:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerB: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: raises $1.5 to $1.5
PlayerB: folds
PlayerC: raises $4.5 to $6
Hero: calls $4.5
*** FLOP *** [2c 7d 9s]
PlayerC: bets $3
Hero: calls $3
*** TURN *** [2c 7d 9s] [3h]
PlayerC: checks
Hero: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
PlayerC: checks
Hero: checks
*** SHOW DOWN ***
Hero: shows [Ah Kh] (One Pair)
PlayerC: shows [Qc Qd] (One Pair)
Hero collected $18 from pot
*** SUMMARY ***
Total pot $18 | Rake $0.9
Seat 1: Hero showed [Ah Kh] and won ($18) with One Pair
Seat 2: PlayerB (small blind) folded before Flop
Seat 3: PlayerC (big blind) showed [Qc Qd] and lost with One Pair`;

const HAND_4BET_AS_RAISER = `Weplay Hand #11:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:10:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
PlayerB: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
Hero: raises $1.5 to $1.5
PlayerB: folds
PlayerC: raises $4.5 to $6
Hero: raises $12 to $18
PlayerC: calls $12
*** FLOP *** [2c 7d 9s]
PlayerC: checks
Hero: bets $10
PlayerC: calls $10
*** TURN *** [2c 7d 9s] [3h]
PlayerC: checks
Hero: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
PlayerC: checks
Hero: checks
*** SHOW DOWN ***
Hero: shows [Ah Ad] (One Pair)
PlayerC: shows [Qc Qd] (One Pair)
Hero collected $56 from pot
*** SUMMARY ***
Total pot $56 | Rake $2.8
Seat 1: Hero showed [Ah Ad] and won ($56) with One Pair
Seat 2: PlayerB (small blind) folded before Flop
Seat 3: PlayerC (big blind) showed [Qc Qd] and lost with One Pair`;

const HAND_4BET_AS_CALLER = `Weplay Hand #12:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:11:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
PlayerB: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
PlayerC: raises $1.5 to $1.5
PlayerB: folds
Hero: raises $4.5 to $6
PlayerC: raises $12 to $18
Hero: calls $12
*** FLOP *** [2c 7d 9s]
PlayerC: bets $10
Hero: calls $10
*** TURN *** [2c 7d 9s] [3h]
PlayerC: checks
Hero: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
PlayerC: checks
Hero: checks
*** SHOW DOWN ***
Hero: shows [Ah Ad] (One Pair)
PlayerC: shows [Qc Qd] (One Pair)
Hero collected $56 from pot
*** SUMMARY ***
Total pot $56 | Rake $2.8
Seat 1: Hero showed [Ah Ad] and won ($56) with One Pair
Seat 2: PlayerB (small blind) folded before Flop
Seat 3: PlayerC (big blind) showed [Qc Qd] and lost with One Pair`;

const HAND_LIMPED_POT = `Weplay Hand #13:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:12:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
PlayerB: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: calls $0.5
PlayerB: calls $0.25
PlayerC: checks
*** FLOP *** [2c 7d 9s]
PlayerC: checks
Hero: checks
PlayerB: checks
*** TURN *** [2c 7d 9s] [3h]
PlayerC: checks
Hero: checks
PlayerB: checks
*** RIVER *** [2c 7d 9s 3h] [4d]
PlayerC: checks
Hero: bets $1
PlayerB: folds
PlayerC: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $1.5 from pot
*** SUMMARY ***
Total pot $1.5 | Rake $0
Seat 1: Hero collected ($1.5)
Seat 2: PlayerB (small blind) folded on the River
Seat 3: PlayerC (big blind) folded on the River`;

// The exact real-world shape that surfaced a genuine pre-existing bug:
// heads-up (2 players) positions were backwards — the button/small-blind
// poster was labeled "BB" and the big-blind poster was labeled "BTN".
// Never caught by any real-data batch tested against so far, since
// heads-up hands are rare in the real batches used throughout this
// project (mostly 6-max/8-max tables with several real players seated).
const HAND_HEADS_UP = `Weplay Hand #14:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:13:00 UTC
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

// Hero's first preflop decision finds the pot completely unopened (blinds
// only) and hero folds it — an RFI opportunity, declined.
const HAND_RFI_DECLINED_FOLD = `Weplay Hand #901:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:01:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Hero: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: folds
Hero: folds
*** SHOW DOWN ***
PlayerC collected $0.25 from pot
*** SUMMARY ***
Total pot $0.25 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: Hero (small blind) folded before Flop
Seat 3: PlayerC (big blind) collected ($0.25)`;

// Two limpers act before hero, so the pot is no longer unopened by the time
// hero raises — an isolation raise, real PFR, but NOT RFI.
const HAND_ISO_RAISE_NOT_RFI = `Weplay Hand #902:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:02:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: PlayerC ($50 in chips)
Seat 3: Hero ($50 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
PlayerA: calls $0.50
PlayerC: calls $0.25
Hero: raises $2.5 to $3
PlayerA: folds
PlayerC: folds
Uncalled bet ($2.5) returned to Hero
*** SHOW DOWN ***
Hero collected $1.5 from pot
*** SUMMARY ***
Total pot $1.5 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: PlayerC (small blind) folded before Flop
Seat 3: Hero (big blind) collected ($1.5)`;

// Hero faces the opening raise with zero money already in the pot (not in
// the blinds, hadn't limped) and calls — a genuine cold call.
const HAND_COLD_CALL = `Weplay Hand #904:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:04:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: PlayerD ($50 in chips)
PlayerC: posts small blind $0.25
PlayerD: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: raises $1.5 to $1.5
Hero: calls $1.5
PlayerC: folds
PlayerD: folds
*** FLOP *** [2c 7d 9s]
PlayerA: bets $2
Hero: folds
Uncalled bet ($2) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $3.65 from pot
*** SUMMARY ***
Total pot $3.65 | Rake $0
Seat 1: PlayerA collected ($3.65)
Seat 2: Hero folded on the Flop
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: PlayerD (big blind) folded before Flop`;

// Hero (BB) defends by calling the raise — money was already in from the
// blind post, so this must NOT count as a cold call.
const HAND_BB_DEFENDS_NOT_COLD_CALL = `Weplay Hand #905:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:05:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: PlayerC ($50 in chips)
Seat 3: Hero ($50 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: raises $1.5 to $1.5
PlayerC: folds
Hero: calls $1
*** FLOP *** [2c 7d 9s]
Hero: checks
PlayerA: bets $1
Hero: folds
Uncalled bet ($1) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $3.25 from pot
*** SUMMARY ***
Total pot $3.25 | Rake $0
Seat 1: PlayerA collected ($3.25)
Seat 2: PlayerC (small blind) folded before Flop
Seat 3: Hero (big blind) folded on the Flop`;

// Hero limps (first decision, unopened pot, calls instead of raising), then
// faces a raise and folds — a limp, an RFI opportunity declined via limp,
// and specifically NOT a cold call on the later fold (money already in from
// the limp itself).
const HAND_LIMP_THEN_FACE_RAISE = `Weplay Hand #906:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:06:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: PlayerD ($50 in chips)
PlayerC: posts small blind $0.25
PlayerD: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
Hero: calls $0.50
PlayerB: raises $2 to $2
PlayerC: folds
PlayerD: folds
Hero: folds
Uncalled bet ($1.5) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $1.25 from pot
*** SUMMARY ***
Total pot $1.25 | Rake $0
Seat 1: Hero folded before Flop
Seat 2: PlayerB collected ($1.25)
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: PlayerD (big blind) folded before Flop`;

// ── Tests ───────────────────────────────────────────────────────────────

test('checking as BB with no raise is NOT voluntary — VPIP stays false', () => {
  const r = analyzeHand(HAND_VPIP_CALL, 'Hero');
  assert.ok(r, 'hand should be analyzable');
  assert.strictEqual(r.vpip, false, 'hero only checked as BB with no raise — that is NOT voluntary VPIP');
  assert.strictEqual(r.pfr, false);
  assert.strictEqual(r.net, 1.25 - 0.5, 'net should be collected minus posted BB');
});

test('an actual preflop call is genuine VPIP', () => {
  const r = analyzeHand(HAND_VPIP_VIA_CALL, 'Hero');
  assert.strictEqual(r.vpip, true);
  assert.strictEqual(r.pfr, false, 'a call is not a raise');
  assert.strictEqual(r.reachedShowdown, true);
  assert.strictEqual(r.net, -1.5, 'lost the $0.25 SB + $1.25 call = $1.50');
});

test('folding to a raise without ever voluntarily investing is VPIP false', () => {
  const r = analyzeHand(HAND_VPIP_FOLD, 'Hero');
  assert.strictEqual(r.vpip, false, 'hero folded to a raise without ever voluntarily investing — not VPIP');
  assert.strictEqual(r.pfr, false);
});

test('Hero opens, faces a 3-bet, folds to it', () => {
  const r = analyzeHand(HAND_HERO_OPENS_AND_3BETS_FOLDS, 'Hero');
  assert.strictEqual(r.pfr, true, 'hero raised preflop (the open)');
  assert.strictEqual(r.hadThreeBetOpportunityAfterOpening, true);
  assert.strictEqual(r.foldedToThreeBet, true);
  assert.strictEqual(r.threeBet, false, 'hero did not make a 3-bet themselves here');
  assert.strictEqual(r.rfiOpportunity, true, 'hero\'s first decision found the pot fully unopened (blinds only)');
  assert.strictEqual(r.rfi, true, 'and hero raised — a genuine RFI, not just PFR');
});

test('Hero makes a 3-bet of their own (re-raises an existing raise)', () => {
  const r = analyzeHand(HAND_HERO_MAKES_A_3BET, 'Hero');
  assert.strictEqual(r.pfr, true);
  assert.strictEqual(r.threeBet, true, 'hero re-raised PlayerC\'s open — that is a 3-bet');
  assert.strictEqual(r.vpip, true);
  assert.strictEqual(r.facedThreeBetOpportunity, true, 'facing a single raise and re-raising it is itself an opportunity taken');
  assert.strictEqual(r.rfiOpportunity, false, 'PlayerC had already raised before hero acted — the pot was not unopened');
  assert.strictEqual(r.rfi, false, 'a 3-bet is real PFR, but not RFI');
});

test('RFI opportunity declined by folding — hero was first to act with the pot unopened but folded', () => {
  const r = analyzeHand(HAND_RFI_DECLINED_FOLD, 'Hero');
  assert.strictEqual(r.rfiOpportunity, true);
  assert.strictEqual(r.rfi, false);
  assert.strictEqual(r.vpip, false);
  assert.strictEqual(r.coldCallOpportunity, false, 'hero never faced a raise this hand');
});

test('isolation raise over limpers is real PFR but NOT RFI — the pot was already opened by the time hero acted', () => {
  const r = analyzeHand(HAND_ISO_RAISE_NOT_RFI, 'Hero');
  assert.strictEqual(r.pfr, true);
  assert.strictEqual(r.vpip, true);
  assert.strictEqual(r.rfiOpportunity, false, 'two players had already limped before hero\'s turn');
  assert.strictEqual(r.rfi, false);
});

test('cold call: facing the opening raise with zero money already in the pot', () => {
  const r = analyzeHand(HAND_COLD_CALL, 'Hero');
  assert.strictEqual(r.coldCallOpportunity, true);
  assert.strictEqual(r.coldCall, true);
  assert.strictEqual(r.vpip, true);
  assert.strictEqual(r.limped, false, 'hero called a raise, not the unraised big blind');
  assert.strictEqual(r.rfiOpportunity, false, 'PlayerA had already raised before hero acted');
});

test('BB defending a raise is NOT a cold call — blind money was already invested', () => {
  const r = analyzeHand(HAND_BB_DEFENDS_NOT_COLD_CALL, 'Hero');
  assert.strictEqual(r.coldCallOpportunity, false, 'hero already had the BB posted — not "zero money in" per PokerTracker\'s own definition');
  assert.strictEqual(r.coldCall, false);
  assert.strictEqual(r.vpip, true, 'still a real voluntary call, just not a cold one');
});

test('limping then folding to a raise: a limp and a declined RFI opportunity, but NOT a cold call on the later fold', () => {
  const r = analyzeHand(HAND_LIMP_THEN_FACE_RAISE, 'Hero');
  assert.strictEqual(r.limped, true, 'hero called the unraised big blind — a limp');
  assert.strictEqual(r.rfiOpportunity, true, 'hero\'s first decision found the pot unopened');
  assert.strictEqual(r.rfi, false, 'hero called instead of raising — declined the RFI, not taken');
  assert.strictEqual(r.coldCallOpportunity, false, 'hero already had limp money invested by the time the raise came — not a cold call');
  assert.strictEqual(r.coldCall, false);
});

test('facing a single raise and just calling is a 3-bet opportunity too (not just when hero raises)', () => {
  const r = analyzeHand(HAND_VPIP_VIA_CALL, 'Hero');
  assert.strictEqual(r.facedThreeBetOpportunity, true, 'hero faced exactly one raise (PlayerA\'s) and chose to call — that is still a real opportunity, just not taken');
  assert.strictEqual(r.threeBet, false);
});

test('uncontested win with a SHOW DOWN header present is NOT counted as a real showdown', () => {
  const r = analyzeHand(HAND_UNCONTESTED_WITH_SHOWDOWN_HEADER, 'Hero');
  assert.strictEqual(r.reachedShowdown, false, 'only one player remained — Weplay shows the header anyway, but this is not a genuine contest');
  assert.strictEqual(r.wonAtShowdown, false);
});

test('bomb pot hand: flagged correctly, VPIP/PFR are false (no preflop decision exists)', () => {
  const r = analyzeHand(HAND_BOMB_POT, 'Hero');
  assert.strictEqual(r.isBombPot, true);
  assert.strictEqual(r.vpip, false);
  assert.strictEqual(r.pfr, false);
  assert.strictEqual(r.sawFlop, true, 'bomb pots always see the flop — no folding option exists preflop');
});

test('aggregateStats excludes bomb pot hands from VPIP/PFR/position denominators', () => {
  const normal = analyzeHand(HAND_VPIP_FOLD, 'Hero'); // vpip:false
  const bomb = analyzeHand(HAND_BOMB_POT, 'Hero'); // vpip:false, isBombPot:true
  const stats = aggregateStats([normal, bomb]);
  assert.strictEqual(stats.hands, 2);
  assert.strictEqual(stats.bombPotHands, 1);
  assert.strictEqual(stats.nonBombPotHands, 1);
  assert.strictEqual(stats.vpip, 0, 'VPIP% denominator should be the 1 non-bomb hand only, not 2');
});

test('a hand with no resolution anywhere is excluded (returns null), matching the converter\'s own skip condition', () => {
  const r = analyzeHand(HAND_NO_RESOLUTION, 'Hero');
  assert.strictEqual(r, null, 'a hand with no collected-from-pot line anywhere cannot be attributed a result');
});

test('position labeling: 6-max full table, heads-up, and an unusual size fall back sensibly', () => {
  assert.deepStrictEqual(positionLabelsFor(6), ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN']);
  assert.deepStrictEqual(positionLabelsFor(2), ['BB', 'BTN'], 'heads-up: the non-button seat is "one step after the button" (BB), the button\'s own seat comes last (BTN) — matching the same seating-order convention used for every other table size');
  const nine = positionLabelsFor(9);
  assert.strictEqual(nine.length, 9);
  assert.strictEqual(nine[0], 'SB');
  assert.strictEqual(nine[nine.length - 1], 'BTN');
});

test('aggregateStats basic math: net, BB/100, and win-at-showdown check out by hand', () => {
  const hands = [
    { bb: 0.5, net: 5, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: true, wonAtShowdown: true, wonWhenSawFlop: true, postflopAggressive: 1, postflopCalls: 0, isBombPot: false, position: 'BTN' },
    { bb: 0.5, net: -2.5, vpip: true, pfr: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 1, isBombPot: false, position: 'BB' },
    // A hand that never sees a flop at all — must NOT count toward the WTSD denominator.
    { bb: 0.5, net: -0.5, vpip: false, pfr: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: false, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'SB' },
  ];
  const stats = aggregateStats(hands);
  assert.strictEqual(stats.netResult, 2);
  // 5/0.5=10bb, -2.5/0.5=-5bb, -0.5/0.5=-1bb → net 4bb over 3 hands → 133.33 bb/100
  assert.ok(Math.abs(stats.bb100 - (400 / 3)) < 0.001);
  assert.strictEqual(stats.vpip, (2 / 3) * 100);
  assert.strictEqual(stats.pfr, (1 / 3) * 100);
  // WTSD must be (reached showdown) / (saw flop) = 1/2, NOT 1/3 (all hands) —
  // the earlier bug divided by every hand dealt, deflating the rate.
  assert.strictEqual(stats.wtsd, 50, 'WTSD should divide by hands that saw a flop, not all hands');
  assert.strictEqual(stats.wonAtShowdown, 100);
  assert.strictEqual(stats.aggressionFactor, 1 / 1);
});

test('aggregateStats: RFI%, Cold Call%, and Limp% use the right denominators', () => {
  const hands = [
    // Hero's first decision is an unopened pot and hero raises: RFI opportunity AND RFI.
    { bb: 0.5, net: 1, vpip: true, pfr: true, rfi: true, rfiOpportunity: true, coldCall: false, coldCallOpportunity: false, limped: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: false, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN' },
    // Hero's first decision is an unopened pot but hero folds: opportunity declined.
    { bb: 0.5, net: -0.5, vpip: false, pfr: false, rfi: false, rfiOpportunity: true, coldCall: false, coldCallOpportunity: false, limped: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: false, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'UTG' },
    // Hero faces an already-opened pot and cold calls: NOT an RFI opportunity.
    { bb: 0.5, net: -1.5, vpip: true, pfr: false, rfi: false, rfiOpportunity: false, coldCall: true, coldCallOpportunity: true, limped: false, threeBet: false, facedThreeBetOpportunity: true, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 1, isBombPot: false, position: 'CO' },
    // Hero limps: a real RFI opportunity, declined via limp rather than a raise.
    { bb: 0.5, net: -0.5, vpip: true, pfr: false, rfi: false, rfiOpportunity: true, coldCall: false, coldCallOpportunity: false, limped: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'MP' },
    // A bomb pot hand with no preflop decision point at all — must not count toward any denominator.
    { bb: 0.5, net: 0, vpip: false, pfr: false, rfi: false, rfiOpportunity: false, coldCall: false, coldCallOpportunity: false, limped: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: true, position: null },
  ];
  const stats = aggregateStats(hands);
  assert.strictEqual(stats.rfiOppCount, 3, 'the raise, the fold, and the limp all found a genuinely unopened pot — the cold call did not');
  assert.ok(Math.abs(stats.rfi - (100 / 3)) < 0.001, '1 RFI out of 3 opportunities');
  assert.strictEqual(stats.coldCallOppCount, 1);
  assert.strictEqual(stats.coldCall, 100);
  assert.strictEqual(stats.limp, 25, '1 limp out of 4 non-bomb hands, same denominator as VPIP/PFR');
});

test('aggregateStats: 3-Bet% and Fold to 3-Bet% use the real opportunity counts, not total hands played', () => {
  const hands = [
    // Hero faces a single raise and 3-bets it: an opportunity AND a 3-bet.
    { bb: 0.5, net: 3, vpip: true, pfr: true, threeBet: true, facedThreeBetOpportunity: true, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: false, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'CO' },
    // Hero faces a single raise and just calls: an opportunity, not a 3-bet.
    { bb: 0.5, net: -1, vpip: true, pfr: false, threeBet: false, facedThreeBetOpportunity: true, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 1, isBombPot: false, position: 'BB' },
    // Hero opens, gets 3-bet, folds: a fold-to-3-bet opportunity taken.
    { bb: 0.5, net: -0.5, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: true, hadThreeBetOpportunityAfterOpening: true, sawFlop: false, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'UTG' },
    // Hero opens and nobody 3-bets — must NOT count in the fold-to-3-bet denominator.
    { bb: 0.5, net: 1, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN' },
    // A hand with no preflop raise-facing decision at all — must not count
    // toward either denominator (the old bug's "divide by all hands played").
    { bb: 0.5, net: 0, vpip: false, pfr: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: false, reachedShowdown: false, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'SB' },
  ];
  const stats = aggregateStats(hands);
  assert.strictEqual(stats.threeBetOppCount, 2, 'only the 2 hands where hero actually faced a single raise count');
  assert.strictEqual(stats.threeBet, 50, '1 of 2 opportunities taken = 50%, not 1 of 5 hands = 20%');
  assert.strictEqual(stats.foldToThreeBetOppCount, 1, 'only the 1 hand where hero\'s own open actually got re-raised counts');
  assert.strictEqual(stats.foldToThreeBet, 100, '1 of 1 real opportunity = 100%, not 1 of 3 opens = 33%');
});

test('hand category: SRP as raiser (hero opens, gets called, never re-raised)', () => {
  const r = analyzeHand(HAND_SRP_AS_RAISER, 'Hero');
  assert.strictEqual(r.handCategory, 'srp-raiser');
});

test('hand category: SRP as caller (hero calls a single open, never re-raised)', () => {
  const r = analyzeHand(HAND_VPIP_VIA_CALL, 'Hero');
  assert.strictEqual(r.handCategory, 'srp-caller');
});

test('hand category: 3-bet pot as raiser (hero makes the 3-bet)', () => {
  const r = analyzeHand(HAND_HERO_MAKES_A_3BET, 'Hero');
  assert.strictEqual(r.handCategory, '3bet-raiser');
});

test('hand category: 3-bet pot as caller (hero opens, faces a 3-bet, calls it)', () => {
  const r = analyzeHand(HAND_3BET_AS_CALLER, 'Hero');
  assert.strictEqual(r.handCategory, '3bet-caller');
});

test('hand category: 4-bet pot as raiser (hero makes the 4-bet)', () => {
  const r = analyzeHand(HAND_4BET_AS_RAISER, 'Hero');
  assert.strictEqual(r.handCategory, '4bet-raiser');
});

test('hand category: 4-bet pot as caller (hero calls a 4-bet)', () => {
  const r = analyzeHand(HAND_4BET_AS_CALLER, 'Hero');
  assert.strictEqual(r.handCategory, '4bet-caller');
});

test('hand category: folding to a 3-bet is deliberately uncategorized, not forced into a bucket', () => {
  const r = analyzeHand(HAND_HERO_OPENS_AND_3BETS_FOLDS, 'Hero');
  assert.strictEqual(r.handCategory, null);
});

test('hand category: a limped pot (no raise at all) is uncategorized, not treated as SRP', () => {
  const r = analyzeHand(HAND_LIMPED_POT, 'Hero');
  assert.strictEqual(r.handCategory, null);
});

test('heads-up positions are correct end to end: the button/SB poster is BTN, the other player is BB — regression test for a real bug', () => {
  const r = analyzeHand(HAND_HEADS_UP, 'Hero');
  assert.strictEqual(r.position, 'BB', 'Hero posted the big blind — must be labeled BB, not BTN');
});

test('handCategoryFor is a pure function of (final raise count, hero\'s last action)', () => {
  assert.strictEqual(handCategoryFor(1, { type: 'raise', level: 1 }), 'srp-raiser');
  assert.strictEqual(handCategoryFor(1, { type: 'call', level: 1 }), 'srp-caller');
  assert.strictEqual(handCategoryFor(2, { type: 'raise', level: 2 }), '3bet-raiser');
  assert.strictEqual(handCategoryFor(2, { type: 'call', level: 2 }), '3bet-caller');
  assert.strictEqual(handCategoryFor(3, { type: 'raise', level: 3 }), '4bet-raiser');
  assert.strictEqual(handCategoryFor(3, { type: 'call', level: 3 }), '4bet-caller');
  assert.strictEqual(handCategoryFor(0, { type: 'call', level: 0 }), null, 'no raise at all: uncategorized');
  assert.strictEqual(handCategoryFor(4, { type: 'raise', level: 4 }), null, '5-bet+ is out of scope for now');
  assert.strictEqual(handCategoryFor(2, { type: 'fold', level: 1 }), null, 'folded before reaching the final raise level');
  assert.strictEqual(handCategoryFor(2, null), null, 'hero never acted preflop at all');
});

test('timeline: showdown + non-showdown cumulative always sums to the total cumulative, for every date', () => {
  const base = { bb: 1, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN' };
  const hands = [
    { ...base, date: '2026-01-01', net: 10, heroCardsShown: true },
    { ...base, date: '2026-01-01', net: -3, heroCardsShown: false },
    { ...base, date: '2026-01-02', net: -2, heroCardsShown: true },
    { ...base, date: '2026-01-02', net: 5, heroCardsShown: false },
  ];
  const stats = aggregateStats(hands);
  assert.strictEqual(stats.timeline.length, 2);
  for (const t of stats.timeline) {
    // Rounding-safe comparison — these are floating point dollar sums.
    assert.ok(Math.abs((t.cumulativeShowdown + t.cumulativeNonShowdown) - t.cumulative) < 1e-9,
      `day ${t.date}: showdown (${t.cumulativeShowdown}) + non-showdown (${t.cumulativeNonShowdown}) should equal total (${t.cumulative})`);
  }
  // Day 1: showdown +10, non-showdown -3 -> cumulative 7, split 10/-3.
  assert.strictEqual(stats.timeline[0].cumulative, 7);
  assert.strictEqual(stats.timeline[0].cumulativeShowdown, 10);
  assert.strictEqual(stats.timeline[0].cumulativeNonShowdown, -3);
  // Day 2 adds showdown -2 (cumulative 8) and non-showdown +5 (cumulative 2) -> total 10.
  assert.strictEqual(stats.timeline[1].cumulative, 10);
  assert.strictEqual(stats.timeline[1].cumulativeShowdown, 8);
  assert.strictEqual(stats.timeline[1].cumulativeNonShowdown, 2);
});

test('timeline: the exact scenario asked about — showdown line profitable while non-showdown line goes negative, even though the total tells a different story on each day', () => {
  const base = { bb: 1, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN' };
  const hands = [
    // Day 1: won big with cards shown (+20), but lost a lot with cards not shown (-25) — net down on the day.
    { ...base, date: '2026-01-01', net: 20, heroCardsShown: true },
    { ...base, date: '2026-01-01', net: -25, heroCardsShown: false },
    // Day 2: won more with cards shown (+10) and a little without showing too (+2) — net up.
    { ...base, date: '2026-01-02', net: 10, heroCardsShown: true },
    { ...base, date: '2026-01-02', net: 2, heroCardsShown: false },
  ];
  const stats = aggregateStats(hands);
  const last = stats.timeline[stats.timeline.length - 1];
  assert.strictEqual(last.cumulativeShowdown, 30, 'showdown (blue) line should be solidly profitable: 20 + 10');
  assert.strictEqual(last.cumulativeNonShowdown, -23, 'non-showdown (red) line should be solidly negative: -25 + 2');
  assert.strictEqual(last.cumulative, 7, 'total (green) line is neither: 30 + (-23) = 7');
  // The core invariant still holds even in this "lines disagree" scenario.
  assert.strictEqual(last.cumulativeShowdown + last.cumulativeNonShowdown, last.cumulative);
});

test('timeline: heroCardsShown (literal reveal), not reachedShowdown (structural WTSD-style definition), is what drives the showdown/non-showdown split — these are genuinely different signals', () => {
  const base = { bb: 1, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN' };
  // A hand that reached a genuine 2+-way showdown (reachedShowdown=true) but
  // where hero lost and mucked without revealing (heroCardsShown=false) —
  // exactly the real, common case found in this project's own data (312
  // such hands out of 1512 genuine showdowns). This must land in the
  // non-showdown (red) bucket, not the showdown (blue) one.
  const hands = [
    { ...base, date: '2026-01-01', net: -8, reachedShowdown: true, heroCardsShown: false },
  ];
  const stats = aggregateStats(hands);
  const last = stats.timeline[stats.timeline.length - 1];
  assert.strictEqual(last.cumulativeShowdown, 0, 'reachedShowdown=true alone must not put this in the showdown bucket');
  assert.strictEqual(last.cumulativeNonShowdown, -8, 'heroCardsShown=false is what actually determines the bucket');
});

test('handTimeline: one entry per hand (not per date), sorted chronologically, with the same showdown/non-showdown invariant', () => {
  const base = { bb: 1, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN' };
  const hands = [
    // Deliberately out of chronological order, to confirm sorting happens.
    { ...base, date: '2026-01-02', time: '10:00:00', net: 5, heroCardsShown: false },
    { ...base, date: '2026-01-01', time: '09:00:00', net: 10, heroCardsShown: true },
    { ...base, date: '2026-01-01', time: '18:00:00', net: -3, heroCardsShown: false },
  ];
  const stats = aggregateStats(hands);
  assert.strictEqual(stats.handTimeline.length, 3, 'one entry per hand, not per date');
  assert.deepStrictEqual(stats.handTimeline.map((h) => h.handNumber), [1, 2, 3]);
  // Chronological order: 01-01 09:00 (+10), 01-01 18:00 (-3), 01-02 10:00 (+5).
  assert.strictEqual(stats.handTimeline[0].net, 10);
  assert.strictEqual(stats.handTimeline[1].net, -3);
  assert.strictEqual(stats.handTimeline[2].net, 5);
  assert.strictEqual(stats.handTimeline[2].cumulative, 12);
  for (const h of stats.handTimeline) {
    assert.strictEqual(h.cumulativeShowdown + h.cumulativeNonShowdown, h.cumulative);
  }
});

test('aggregateStats: per-street aggression matches PokerTracker\'s documented AFq formula — (bets+raises) / (bets+raises+calls+folds), checks EXCLUDED — verified against a hand-computable example, not just plausibility', () => {
  const base = { bb: 1, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, wonAtShowdown: false, wonWhenSawFlop: false, postflopAggressive: 0, postflopCalls: 0, isBombPot: false, position: 'BTN', net: 0 };
  const emptyStreet = { agg: 0, calls: 0, folds: 0, checks: 0 };
  const hands = [
    { ...base, streetAgg: { FLOP: { agg: 1, calls: 0, folds: 0, checks: 0 }, TURN: emptyStreet, RIVER: emptyStreet } }, // flop bet
    { ...base, streetAgg: { FLOP: { agg: 1, calls: 0, folds: 0, checks: 0 }, TURN: emptyStreet, RIVER: emptyStreet } }, // flop raise (bets and raises both count toward "agg")
    { ...base, streetAgg: { FLOP: { agg: 0, calls: 1, folds: 0, checks: 0 }, TURN: emptyStreet, RIVER: emptyStreet } }, // flop call
    { ...base, streetAgg: { FLOP: { agg: 0, calls: 0, folds: 1, checks: 0 }, TURN: emptyStreet, RIVER: emptyStreet } }, // flop fold
    // AFq excludes checks from the denominator entirely — this hand's flop
    // check must NOT move flopAggression or flopAggressionOpportunities.
    { ...base, streetAgg: { FLOP: { agg: 0, calls: 0, folds: 0, checks: 1 }, TURN: emptyStreet, RIVER: emptyStreet } }, // flop check
  ];
  const stats = aggregateStats(hands);
  // agg=2, calls=1, folds=1 -> 2 / (2+1+1) = 50%, over 4 opportunities —
  // the check is tracked on the hand but excluded from this ratio.
  assert.strictEqual(stats.flopAggression, 50);
  assert.strictEqual(stats.flopAggressionOpportunities, 4);
  // Turn/river had zero opportunities anywhere in this fixture.
  assert.strictEqual(stats.turnAggression, null);
  assert.strictEqual(stats.turnAggressionOpportunities, 0);
});

test('analyzeHand: streetAgg is correctly populated from real hand text — a flop check is tracked in the raw counts even though AFq excludes it from the aggregation denominator', () => {
  const hand = `Weplay Hand #900:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:00:00 UTC
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
Hero: checks
PlayerA: checks
*** TURN *** [2c 7d 9s] [4h]
Hero: bets $1
PlayerA: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $1 from pot
*** SUMMARY ***
Total pot $1 | Rake $0
Board [2c 7d 9s 4h]
Seat 1: PlayerA (small blind) folded on the Turn
Seat 2: Hero (big blind) collected ($1)`;
  const result = analyzeHand(hand, 'Hero');
  assert.ok(result, 'hand should analyze successfully');
  assert.deepStrictEqual(result.streetAgg.FLOP, { agg: 0, calls: 0, folds: 0, checks: 1 }, 'the flop check is now tracked, not silently dropped');
  assert.deepStrictEqual(result.streetAgg.TURN, { agg: 1, calls: 0, folds: 0, checks: 0 }, 'the turn bet is one aggressive action');
});

console.log(`\n${passed} test(s) passed.`);
