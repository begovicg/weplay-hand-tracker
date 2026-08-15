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

// Hero's own 3-bet specifically gets re-raised (a genuine 4-bet against
// hero), and hero folds to it.
const HAND_HERO_3BETS_FACES_4BET_FOLDS = `Weplay Hand #907:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:07:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($100 in chips)
Seat 2: Hero ($100 in chips)
Seat 3: PlayerC ($100 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Kc Kd]
PlayerC: raises $1.5 to $1.5
PlayerA: folds
Hero: raises $4.5 to $6
PlayerC: raises $12 to $18
Hero: folds
Uncalled bet ($1) returned to PlayerC
*** SHOW DOWN ***
PlayerC collected $25.75 from pot
*** SUMMARY ***
Total pot $25.75 | Rake $0
Seat 1: PlayerA (small blind) folded before Flop
Seat 2: Hero (big blind) folded before Flop
Seat 3: PlayerC collected ($25.75)`;

// A squeeze: PlayerA raises, PlayerB calls (a live caller in between), and
// hero re-raises over both of them.
const HAND_SQUEEZE = `Weplay Hand #908:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:08:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
Seat 4: Hero ($100 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Ad]
PlayerA: raises $1.5 to $1.5
PlayerB: calls $1.5
PlayerC: folds
Hero: raises $8 to $8
PlayerA: folds
PlayerB: folds
Uncalled bet ($6.5) returned to Hero
*** SHOW DOWN ***
Hero collected $3.75 from pot
*** SUMMARY ***
Total pot $3.75 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: PlayerB folded before Flop
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: Hero (big blind) collected ($3.75)`;

// The same squeeze setup (a raise plus a live caller), but hero just calls
// instead of re-raising — a squeeze opportunity, declined.
const HAND_SQUEEZE_OPPORTUNITY_DECLINED = `Weplay Hand #909:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:09:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
Seat 4: Hero ($100 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
PlayerA: raises $1.5 to $1.5
PlayerB: calls $1.5
PlayerC: folds
Hero: calls $1
*** FLOP *** [2c 7h 9s]
Hero: checks
PlayerA: bets $3
PlayerB: folds
Hero: folds
Uncalled bet ($3) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $5.5 from pot
*** SUMMARY ***
Total pot $5.5 | Rake $0
Seat 1: PlayerA collected ($5.5)
Seat 2: PlayerB folded on the Flop
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: Hero (big blind) folded on the Flop`;

// Hero checks the flop, faces a bet, and check-raises it.
const HAND_CHECK_RAISE_FLOP = `Weplay Hand #910:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:10:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
PlayerA: calls $0.25
Hero: checks
*** FLOP *** [2c 7h 9s]
Hero: checks
PlayerA: bets $1
Hero: raises $3 to $4
PlayerA: folds
Uncalled bet ($3) returned to Hero
*** SHOW DOWN ***
Hero collected $3 from pot
*** SUMMARY ***
Total pot $3 | Rake $0
Seat 1: PlayerA (small blind) folded on the Flop
Seat 2: Hero (big blind) collected ($3)`;

// Same check-then-facing-a-bet shape on the flop, but hero just calls (a
// check-raise opportunity, declined) — and separately bets the turn as the
// FIRST action of that street (not preceded by a check), which must not be
// mistaken for a check-raise opportunity either.
const HAND_CHECK_CALL_FLOP = `Weplay Hand #911:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:11:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [7c 7d]
PlayerA: calls $0.25
Hero: checks
*** FLOP *** [2c 7h 9s]
Hero: checks
PlayerA: bets $1
Hero: calls $1
*** TURN *** [2c 7h 9s] [3h]
Hero: bets $2
PlayerA: folds
Uncalled bet ($2) returned to Hero
*** SHOW DOWN ***
Hero collected $3 from pot
*** SUMMARY ***
Total pot $3 | Rake $0
Seat 1: PlayerA (small blind) folded on the Turn
Seat 2: Hero (big blind) collected ($3)`;

// Same shape again, but hero folds instead — the third possible response to
// a check-raise opportunity.
const HAND_CHECK_FOLD_FLOP = `Weplay Hand #912:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:12:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: calls $0.25
Hero: checks
*** FLOP *** [Ah Kd 9s]
Hero: checks
PlayerA: bets $1
Hero: folds
Uncalled bet ($1) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $1.75 from pot
*** SUMMARY ***
Total pot $1.75 | Rake $0
Seat 1: PlayerA (small blind) collected ($1.75)
Seat 2: Hero (big blind) folded on the Flop`;

// Hero raises from the button into a fully unopened pot — a genuine steal
// attempt (RFI restricted to CO/BTN/SB).
const HAND_ATTEMPT_STEAL_BTN = `Weplay Hand #913:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:13:00 UTC
Table 'Test'(111) 6-max Seat #2 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: PlayerD ($50 in chips)
PlayerC: posts small blind $0.25
PlayerD: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: folds
Hero: raises $1.5 to $1.5
PlayerC: folds
PlayerD: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $0.75 from pot
*** SUMMARY ***
Total pot $0.75 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: Hero collected ($0.75)
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: PlayerD (big blind) folded before Flop`;

// Hero raises first-in from UTG (an early position) — real RFI, but NOT a
// steal attempt (steal is specifically CO/BTN/SB).
const HAND_RFI_EARLY_POSITION_NOT_STEAL = `Weplay Hand #914:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:14:00 UTC
Table 'Test'(111) 6-max Seat #2 is the button
Seat 1: Hero ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: PlayerD ($50 in chips)
PlayerC: posts small blind $0.25
PlayerD: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
Hero: raises $1.5 to $1.5
PlayerB: folds
PlayerC: folds
PlayerD: folds
Uncalled bet ($1) returned to Hero
*** SHOW DOWN ***
Hero collected $0.75 from pot
*** SUMMARY ***
Total pot $0.75 | Rake $0
Seat 1: Hero collected ($0.75)
Seat 2: PlayerB folded before Flop
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: PlayerD (big blind) folded before Flop`;

// Hero (BB) faces a genuine steal raise from the button, with no one else
// having called it, and folds.
const HAND_FOLD_TO_STEAL = `Weplay Hand #915:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:15:00 UTC
Table 'Test'(111) 6-max Seat #2 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: Hero ($50 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: folds
PlayerB: raises $1.5 to $1.5
PlayerC: folds
Hero: folds
Uncalled bet ($1) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $1 from pot
*** SUMMARY ***
Total pot $1 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: PlayerB collected ($1)
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: Hero (big blind) folded before Flop`;

// Same steal-raise setup, but hero calls (defends) instead of folding.
const HAND_STEAL_DEFENSE_CALLED = `Weplay Hand #917:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:17:00 UTC
Table 'Test'(111) 6-max Seat #2 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: Hero ($50 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: folds
PlayerB: raises $1.5 to $1.5
PlayerC: folds
Hero: calls $1
*** FLOP *** [2c 7d 9s]
Hero: checks
PlayerB: bets $1
Hero: folds
Uncalled bet ($1) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $3.75 from pot
*** SUMMARY ***
Total pot $3.75 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: PlayerB collected ($3.75)
Seat 3: PlayerC (small blind) folded before Flop
Seat 4: Hero (big blind) folded on the Flop`;

// The same steal-eligible raise, but PlayerC calls it before hero acts —
// a live caller in between disqualifies this as a clean steal-defense spot.
const HAND_STEAL_DEFENSE_DISQUALIFIED_BY_CALLER = `Weplay Hand #916:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:16:00 UTC
Table 'Test'(111) 6-max Seat #2 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: PlayerB ($50 in chips)
Seat 3: PlayerC ($50 in chips)
Seat 4: Hero ($50 in chips)
PlayerC: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: folds
PlayerB: raises $1.5 to $1.5
PlayerC: calls $1.25
Hero: folds
*** FLOP *** [2c 7d 9s]
PlayerC: checks
PlayerB: bets $1
PlayerC: folds
Uncalled bet ($1) returned to PlayerB
*** SHOW DOWN ***
PlayerB collected $3.75 from pot
*** SUMMARY ***
Total pot $3.75 | Rake $0
Seat 1: PlayerA folded before Flop
Seat 2: PlayerB collected ($3.75)
Seat 3: PlayerC (small blind) folded on the Flop
Seat 4: Hero (big blind) folded before Flop`;

// Hero is the preflop aggressor and c-bets the flop, then double-barrels
// the turn too.
const HAND_CBET_FLOP_MADE = `Weplay Hand #918:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:18:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Ah Kh]
PlayerA: calls $0.25
Hero: raises $1.5 to $2
PlayerA: calls $1.5
*** FLOP *** [2c 7d 9s]
Hero: bets $2
PlayerA: calls $2
*** TURN *** [2c 7d 9s] [3h]
Hero: bets $4
PlayerA: folds
Uncalled bet ($4) returned to Hero
*** SHOW DOWN ***
Hero collected $8 from pot
*** SUMMARY ***
Total pot $8 | Rake $0
Seat 1: PlayerA (small blind) folded on the Turn
Seat 2: Hero (big blind) collected ($8)`;

// Hero is the preflop aggressor but checks the flop back (declining the
// c-bet). The flop then goes check-check, so nobody is the flop's
// aggressor — PlayerA's turn bet is NOT a continuation of anyone's prior
// aggression and must not be mistaken for a c-bet against hero.
const HAND_CBET_DECLINED = `Weplay Hand #919:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:19:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: calls $0.25
Hero: raises $1.5 to $2
PlayerA: calls $1.5
*** FLOP *** [Ah Kd 9s]
Hero: checks
PlayerA: checks
*** TURN *** [Ah Kd 9s] [3h]
Hero: checks
PlayerA: bets $2
Hero: folds
Uncalled bet ($2) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $6 from pot
*** SUMMARY ***
Total pot $6 | Rake $0
Seat 1: PlayerA (small blind) collected ($6)
Seat 2: Hero (big blind) folded on the Turn`;

// Hero is NOT the preflop aggressor; PlayerA (the real aggressor) c-bets
// the flop, and hero folds to it.
const HAND_FOLD_TO_CBET_FLOP = `Weplay Hand #920:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:20:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
PlayerA: raises $1.5 to $1.5
Hero: calls $1
*** FLOP *** [Ah Kd 9s]
PlayerA: bets $2
Hero: folds
Uncalled bet ($2) returned to PlayerA
*** SHOW DOWN ***
PlayerA collected $3 from pot
*** SUMMARY ***
Total pot $3 | Rake $0
Seat 1: PlayerA (small blind) collected ($3)
Seat 2: Hero (big blind) folded on the Flop`;

// Same c-bet setup, but hero calls it instead of folding.
const HAND_CALLED_CBET_FLOP = `Weplay Hand #921:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 19:21:00 UTC
Table 'Test'(111) 6-max Seat #1 is the button
Seat 1: PlayerA ($50 in chips)
Seat 2: Hero ($50 in chips)
PlayerA: posts small blind $0.25
Hero: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [Jh Jd]
PlayerA: raises $1.5 to $1.5
Hero: calls $1
*** FLOP *** [Ah Kd 9s]
PlayerA: bets $2
Hero: calls $2
*** TURN *** [Ah Kd 9s] [3h]
PlayerA: checks
Hero: checks
*** RIVER *** [Ah Kd 9s 3h] [4h]
PlayerA: checks
Hero: checks
*** SHOW DOWN ***
PlayerA: shows [Ac Kc] (Two Pair)
Hero: mucks hand
PlayerA collected $7 from pot
*** SUMMARY ***
Total pot $7 | Rake $0
Seat 1: PlayerA (small blind) showed [Ac Kc] and won ($7) with Two Pair
Seat 2: Hero (big blind) mucked`;

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
  assert.strictEqual(r.squeezeOpportunity, false, 'heads-up 3-bet — nobody called PlayerC\'s raise before hero acted');
  assert.strictEqual(r.squeeze, false);
});

test('squeeze: re-raising a raise that already had a live caller in front of hero', () => {
  const r = analyzeHand(HAND_SQUEEZE, 'Hero');
  assert.strictEqual(r.threeBet, true, 'still a 3-bet by raise level');
  assert.strictEqual(r.squeezeOpportunity, true, 'PlayerB called PlayerA\'s raise before hero acted');
  assert.strictEqual(r.squeeze, true);
});

test('squeeze opportunity declined: same raise-plus-caller setup, but hero just calls', () => {
  const r = analyzeHand(HAND_SQUEEZE_OPPORTUNITY_DECLINED, 'Hero');
  assert.strictEqual(r.threeBet, false, 'hero called, did not re-raise');
  assert.strictEqual(r.facedThreeBetOpportunity, true, 'still faced exactly one prior raise');
  assert.strictEqual(r.squeezeOpportunity, true, 'PlayerB had called in front of hero');
  assert.strictEqual(r.squeeze, false, 'the opportunity existed but was not taken');
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

test('aggregateStats excludes bomb pot hands from WTSD/W$SD/WWSF denominators too', () => {
  const hands = [
    // Non-bomb: saw flop, reached a real showdown, won it.
    { bb: 0.5, net: 5, vpip: true, pfr: true, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: true, wonAtShowdown: true, wonWhenSawFlop: true, postflopAggressive: 1, postflopCalls: 0, isBombPot: false, position: 'BTN' },
    // Bomb pot: also saw flop, reached showdown, and won — but a forced
    // multiway pot everyone antes into isn't a fair comparison for a
    // postflop-skill rate, so none of this should count toward WTSD/WWSF.
    { bb: 0.5, net: 8, vpip: false, pfr: false, threeBet: false, facedThreeBetOpportunity: false, foldedToThreeBet: false, hadThreeBetOpportunityAfterOpening: false, sawFlop: true, reachedShowdown: true, wonAtShowdown: true, wonWhenSawFlop: true, postflopAggressive: 1, postflopCalls: 0, isBombPot: true, position: null },
  ];
  const stats = aggregateStats(hands);
  assert.strictEqual(stats.wtsd, 100, 'WTSD should be 1/1 non-bomb hands, not 2/2 with the bomb pot mixed in');
  assert.strictEqual(stats.wonAtShowdown, 100, 'W$SD denominator should also exclude the bomb pot');
  assert.strictEqual(stats.wonWhenSawFlop, 100, 'WWSF denominator should also exclude the bomb pot');
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

test('analyzeHand carries a stakesLabel, and aggregateStats\' byStake buckets carry it too — needed for the "Home" (most-played stake) stat', () => {
  const r = analyzeHand(HAND_VPIP_CALL, 'Hero');
  assert.strictEqual(r.stakesLabel, '$0.25/$0.50');

  const other = analyzeHand(HAND_VPIP_FOLD, 'Hero'); // same $0.25/$0.50 stake
  const stats = aggregateStats([r, other]);
  assert.strictEqual(Object.keys(stats.byStake).length, 1, 'both hands are the same bb — one bucket');
  assert.strictEqual(stats.byStake[r.bb].stakesLabel, '$0.25/$0.50');
  assert.strictEqual(stats.byStake[r.bb].hands, 2);
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

test('aggregateStats EV Winrate (evBb100): shares the bb100 denominator, and folds in evAdjustmentBB only where it\'s actually set', () => {
  const hands = [
    // No all-in EV moment (evAdjustmentBB left unset) — contributes its
    // actual result unchanged, exactly like bb100 does.
    { bb: 0.5, net: 5 },
    // Lost the actual hand (-5bb) but ran a genuine all-in adjustment of
    // +3bb (i.e. was "supposed to" only be down 2bb at the equity the
    // money went in with).
    { bb: 0.5, net: -2.5, evAdjustmentBB: 3 },
    { bb: 0.5, net: -0.5 },
  ];
  const stats = aggregateStats(hands);
  // bb: 10 + (-5+3) + (-1) = 7 over 3 hands -> 233.33 bb/100.
  assert.ok(Math.abs(stats.evBb100 - (700 / 3)) < 0.001);
  assert.strictEqual(stats.evAdjustedHandCount, 1, 'only the hand with a non-null evAdjustmentBB counts');
  // bb100 itself must be unaffected by evAdjustmentBB being present.
  assert.ok(Math.abs(stats.bb100 - (400 / 3)) < 0.001);
});

test('4-bet as raiser: hero opens, gets 3-bet, hero 4-bets — the same shape as the 3-bet stats, one level deeper', () => {
  const r = analyzeHand(HAND_4BET_AS_RAISER, 'Hero');
  assert.strictEqual(r.fourBet, true, 'hero re-raised while facing exactly two prior raises (the open + PlayerC\'s 3-bet)');
  assert.strictEqual(r.facedFourBetOpportunity, true);
  assert.strictEqual(r.hadFourBetOpportunityAfterThreeBetting, false, 'hero never even made a 3-bet here — they made the 4-bet themselves');
  assert.strictEqual(r.foldedToFourBet, false);
});

test('4-bet as caller: hero 3-bets, faces a re-raise (a genuine 4-bet against hero), and calls it', () => {
  const r = analyzeHand(HAND_4BET_AS_CALLER, 'Hero');
  assert.strictEqual(r.threeBet, true, 'hero\'s raise to $6 came while facing exactly one prior raise');
  assert.strictEqual(r.fourBet, false, 'hero called the 4-bet, did not re-raise it themselves');
  // facedFourBetOpportunity tracks a DIFFERENT decision point than this one
  // — "hero facing exactly two prior raises, deciding whether to make the
  // 4-bet themselves" (see HAND_4BET_AS_RAISER). Here hero already used that
  // decision point to make the 3-bet; PlayerC's re-raise of it is one level
  // further along, tracked by hadFourBetOpportunityAfterThreeBetting below.
  assert.strictEqual(r.facedFourBetOpportunity, false);
  assert.strictEqual(r.hadFourBetOpportunityAfterThreeBetting, true, 'PlayerC specifically re-raised hero\'s own 3-bet');
  assert.strictEqual(r.foldedToFourBet, false, 'hero called it, did not fold');
});

test('fold to 4-bet: hero\'s own 3-bet gets re-raised, and hero folds', () => {
  const r = analyzeHand(HAND_HERO_3BETS_FACES_4BET_FOLDS, 'Hero');
  assert.strictEqual(r.threeBet, true);
  assert.strictEqual(r.hadFourBetOpportunityAfterThreeBetting, true, 'PlayerC re-raised hero\'s own 3-bet');
  assert.strictEqual(r.foldedToFourBet, true);
  assert.strictEqual(r.fourBet, false, 'hero folded, did not make a 4-bet themselves');
});

test('aggregateStats: 4-Bet% and Fold to 4-Bet% use the real opportunity counts, mirroring the 3-bet math one level deeper', () => {
  const raiser = analyzeHand(HAND_4BET_AS_RAISER, 'Hero'); // facedFourBetOpportunity true, fourBet true
  const caller = analyzeHand(HAND_4BET_AS_CALLER, 'Hero'); // facedFourBetOpportunity false (a different decision point — see the unit test above), hadFourBetOpportunityAfterThreeBetting true, foldedToFourBet false
  const folder = analyzeHand(HAND_HERO_3BETS_FACES_4BET_FOLDS, 'Hero'); // hadFourBetOpportunityAfterThreeBetting true, foldedToFourBet true
  const noFourBet = analyzeHand(HAND_HERO_MAKES_A_3BET, 'Hero'); // hero 3-bets, nobody re-raises — must not count in either 4-bet denominator
  const stats = aggregateStats([raiser, caller, folder, noFourBet]);
  // Only the raiser hand ever put hero in the "facing exactly two prior
  // raises, could make the 4-bet themselves" spot — the caller and folder
  // hands instead had hero's OWN 3-bet re-raised, a different decision
  // point entirely (the Fold to 4-Bet denominator, checked separately below).
  assert.strictEqual(stats.fourBetOppCount, 1);
  assert.strictEqual(stats.fourBet, 100, '1 of 1 real opportunity taken');
  assert.strictEqual(stats.foldToFourBetOppCount, 2, 'only the caller and the folder had their OWN 3-bet specifically re-raised');
  assert.strictEqual(stats.foldToFourBet, 50, '1 of 2 real opportunities, not 1 of 4 hands');
});

test('check-raise: hero checks the flop, faces a bet, and raises it', () => {
  const r = analyzeHand(HAND_CHECK_RAISE_FLOP, 'Hero');
  assert.deepStrictEqual(r.checkRaiseByStreet.FLOP, { opp: 1, cr: 1 });
  assert.deepStrictEqual(r.checkRaiseByStreet.TURN, { opp: 0, cr: 0 });
});

test('check-raise opportunity declined via call — and a street-leading bet (no prior check) is never mistaken for one', () => {
  const r = analyzeHand(HAND_CHECK_CALL_FLOP, 'Hero');
  assert.deepStrictEqual(r.checkRaiseByStreet.FLOP, { opp: 1, cr: 0 });
  // Hero's turn bet was the FIRST action of the turn (no check preceded
  // it) — must not register as a check-raise opportunity of any kind.
  assert.deepStrictEqual(r.checkRaiseByStreet.TURN, { opp: 0, cr: 0 });
});

test('check-raise opportunity declined via fold', () => {
  const r = analyzeHand(HAND_CHECK_FOLD_FLOP, 'Hero');
  assert.deepStrictEqual(r.checkRaiseByStreet.FLOP, { opp: 1, cr: 0 });
});

test('checking through (both players check, street just ends) creates no check-raise opportunity at all', () => {
  const r = analyzeHand(HAND_VPIP_CALL, 'Hero');
  assert.deepStrictEqual(r.checkRaiseByStreet.FLOP, { opp: 0, cr: 0 }, 'hero checked the flop but was never given a second decision on it');
  assert.deepStrictEqual(r.checkRaiseByStreet.TURN, { opp: 0, cr: 0 });
  // Hero's river bet was the FIRST action of the river, not a response to
  // being checked back to after their own check.
  assert.deepStrictEqual(r.checkRaiseByStreet.RIVER, { opp: 0, cr: 0 });
});

test('attempt to steal: hero raises an unopened pot from the button', () => {
  const r = analyzeHand(HAND_ATTEMPT_STEAL_BTN, 'Hero');
  assert.strictEqual(r.position, 'BTN');
  assert.strictEqual(r.rfi, true);
  assert.strictEqual(r.attemptSteal, true);
  assert.strictEqual(r.stealOpportunity, true);
});

test('RFI from an early position is real RFI but NOT a steal attempt', () => {
  const r = analyzeHand(HAND_RFI_EARLY_POSITION_NOT_STEAL, 'Hero');
  assert.strictEqual(r.position, 'UTG');
  assert.strictEqual(r.rfi, true);
  assert.strictEqual(r.attemptSteal, false, 'steal is specifically CO/BTN/SB, not every RFI');
  assert.strictEqual(r.stealOpportunity, false);
});

test('fold to steal: hero (BB) folds to a genuine steal raise from the button with no callers in between', () => {
  const r = analyzeHand(HAND_FOLD_TO_STEAL, 'Hero');
  assert.strictEqual(r.stealDefenseOpportunity, true);
  assert.strictEqual(r.foldedToSteal, true);
});

test('steal defense declined via call — the opportunity existed but hero defended instead of folding', () => {
  const r = analyzeHand(HAND_STEAL_DEFENSE_CALLED, 'Hero');
  assert.strictEqual(r.stealDefenseOpportunity, true);
  assert.strictEqual(r.foldedToSteal, false, 'hero called at the steal-defense decision point — the later flop fold is a different decision');
});

test('a live caller between the raiser and hero disqualifies steal defense', () => {
  const r = analyzeHand(HAND_STEAL_DEFENSE_DISQUALIFIED_BY_CALLER, 'Hero');
  assert.strictEqual(r.stealDefenseOpportunity, false, 'PlayerC called the raise before hero acted — no longer a clean heads-up steal-defense spot');
  assert.strictEqual(r.foldedToSteal, false);
});

test('c-bet made: hero was the preflop aggressor and bets the flop, then double-barrels the turn', () => {
  const r = analyzeHand(HAND_CBET_FLOP_MADE, 'Hero');
  assert.deepStrictEqual(r.cbetOpportunity, { FLOP: true, TURN: true, RIVER: false });
  assert.deepStrictEqual(r.cbetMade, { FLOP: true, TURN: true, RIVER: false });
});

test('c-bet declined via check, and a non-aggressor\'s later bet is never mistaken for a c-bet', () => {
  const r = analyzeHand(HAND_CBET_DECLINED, 'Hero');
  assert.deepStrictEqual(r.cbetOpportunity, { FLOP: true, TURN: false, RIVER: false }, 'hero was the preflop aggressor and had the flop c-bet chance, but not the turn one — nobody bet the flop, so nobody carried aggression into the turn');
  assert.deepStrictEqual(r.cbetMade, { FLOP: false, TURN: false, RIVER: false });
  // PlayerA's turn bet, after a checked-through flop, is not a continuation
  // of anyone's prior aggression — must not register as a c-bet hero faced.
  assert.deepStrictEqual(r.facedCBetOpportunity, { FLOP: false, TURN: false, RIVER: false });
  assert.deepStrictEqual(r.foldedToCBet, { FLOP: false, TURN: false, RIVER: false });
});

test('fold to c-bet: hero was NOT the preflop aggressor, faces a genuine c-bet from the real aggressor, and folds', () => {
  const r = analyzeHand(HAND_FOLD_TO_CBET_FLOP, 'Hero');
  assert.deepStrictEqual(r.cbetOpportunity, { FLOP: false, TURN: false, RIVER: false }, 'hero was not the preflop aggressor — never had a c-bet chance themselves');
  assert.deepStrictEqual(r.facedCBetOpportunity, { FLOP: true, TURN: false, RIVER: false });
  assert.deepStrictEqual(r.foldedToCBet, { FLOP: true, TURN: false, RIVER: false });
});

test('facing a c-bet and calling it — the opportunity existed but hero did not fold', () => {
  const r = analyzeHand(HAND_CALLED_CBET_FLOP, 'Hero');
  assert.deepStrictEqual(r.facedCBetOpportunity, { FLOP: true, TURN: false, RIVER: false });
  assert.deepStrictEqual(r.foldedToCBet, { FLOP: false, TURN: false, RIVER: false }, 'hero called, did not fold');
});

test('aggregateStats: C-Bet% and Fold to C-Bet% per street divide by the real opportunity counts', () => {
  const made = analyzeHand(HAND_CBET_FLOP_MADE, 'Hero'); // flop+turn cbet opportunity and made
  const declined = analyzeHand(HAND_CBET_DECLINED, 'Hero'); // flop cbet opportunity, declined; no faced-cbet anywhere
  const folded = analyzeHand(HAND_FOLD_TO_CBET_FLOP, 'Hero'); // flop faced-cbet opportunity, folded
  const called = analyzeHand(HAND_CALLED_CBET_FLOP, 'Hero'); // flop faced-cbet opportunity, called
  const stats = aggregateStats([made, declined, folded, called]);
  assert.strictEqual(stats.flopCbetOpportunities, 2, 'made + declined both gave hero a real flop c-bet decision');
  assert.strictEqual(stats.flopCbet, 50, '1 of 2 opportunities taken');
  assert.strictEqual(stats.turnCbetOpportunities, 1, 'only the double-barrel hand ever carried aggression into the turn');
  assert.strictEqual(stats.turnCbet, 100);
  assert.strictEqual(stats.flopFoldToCbetOpportunities, 2, 'folded + called both genuinely faced the real aggressor\'s flop bet');
  assert.strictEqual(stats.flopFoldToCbet, 50, '1 of 2 opportunities folded');
});

test('aggregateStats: Attempt to Steal% and Fold to Steal% use the real opportunity counts', () => {
  const stole = analyzeHand(HAND_ATTEMPT_STEAL_BTN, 'Hero'); // attemptSteal true, stealOpportunity true
  const earlyRfi = analyzeHand(HAND_RFI_EARLY_POSITION_NOT_STEAL, 'Hero'); // rfi true, but not a steal opportunity at all
  const folded = analyzeHand(HAND_FOLD_TO_STEAL, 'Hero'); // stealDefenseOpportunity true, foldedToSteal true
  const called = analyzeHand(HAND_STEAL_DEFENSE_CALLED, 'Hero'); // stealDefenseOpportunity true, foldedToSteal false
  const disqualified = analyzeHand(HAND_STEAL_DEFENSE_DISQUALIFIED_BY_CALLER, 'Hero'); // neither flag set — a caller ruined the spot
  const stats = aggregateStats([stole, earlyRfi, folded, called, disqualified]);
  assert.strictEqual(stats.stealOppCount, 1, 'only the button hand ever put hero in CO/BTN/SB with the pot unopened');
  assert.strictEqual(stats.attemptSteal, 100);
  assert.strictEqual(stats.foldToStealOppCount, 2, 'the disqualified-by-caller hand must not count toward this denominator either');
  assert.strictEqual(stats.foldToSteal, 50, '1 of 2 real opportunities taken');
});

test('aggregateStats: Check-Raise% per street divides by real opportunities only', () => {
  const raised = analyzeHand(HAND_CHECK_RAISE_FLOP, 'Hero');
  const called = analyzeHand(HAND_CHECK_CALL_FLOP, 'Hero');
  const folded = analyzeHand(HAND_CHECK_FOLD_FLOP, 'Hero');
  const stats = aggregateStats([raised, called, folded]);
  assert.strictEqual(stats.flopCheckRaiseOpportunities, 3, 'all three hands gave hero a real check-raise decision point on the flop');
  assert.strictEqual(stats.flopCheckRaise, (1 / 3) * 100, '1 of 3 opportunities taken');
  assert.strictEqual(stats.turnCheckRaiseOpportunities, 0, 'no hand ever gave hero a check-raise decision point on the turn');
  assert.strictEqual(stats.turnCheckRaise, null);
});

test('aggregateStats: Squeeze% only counts real raise-plus-caller opportunities, not every 3-bet spot', () => {
  const squeezed = analyzeHand(HAND_SQUEEZE, 'Hero'); // squeeze true, squeezeOpportunity true
  const declined = analyzeHand(HAND_SQUEEZE_OPPORTUNITY_DECLINED, 'Hero'); // squeeze false, squeezeOpportunity true
  const headsUpThreeBet = analyzeHand(HAND_HERO_MAKES_A_3BET, 'Hero'); // a real 3-bet, but no caller in between — must NOT count as a squeeze opportunity
  const stats = aggregateStats([squeezed, declined, headsUpThreeBet]);
  assert.strictEqual(stats.squeezeOppCount, 2, 'only the two raise-plus-caller hands count — the heads-up 3-bet never had a caller in between');
  assert.strictEqual(stats.squeeze, 50, '1 of 2 real opportunities taken');
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
    // Ran hot on a genuine all-in: actual +10bb, but only "supposed to" be
    // +6bb at the equity the money went in with (evAdjustmentBB: -4).
    { ...base, date: '2026-01-01', time: '09:00:00', net: 10, heroCardsShown: true, evAdjustmentBB: -4 },
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
  // cumulativeEV: the first hand's EV result is 10 + (-4) = 6bb (i.e. $6 at
  // bb=1), not its actual $10 — the other two hands have no adjustment, so
  // they carry their actual net straight through.
  assert.strictEqual(stats.handTimeline[0].cumulativeEV, 6);
  assert.strictEqual(stats.handTimeline[1].cumulativeEV, 3);
  assert.strictEqual(stats.handTimeline[2].cumulativeEV, 8);
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
  // Agg% (DriveHUD's convention): same agg=2, but the check now counts
  // toward the denominator -> 2 / (2+1+1+1) = 40%, over 5 opportunities.
  assert.strictEqual(stats.flopAggPct, 40);
  assert.strictEqual(stats.flopAggPctOpportunities, 5);
  // Turn/river had zero opportunities anywhere in this fixture.
  assert.strictEqual(stats.turnAggression, null);
  assert.strictEqual(stats.turnAggressionOpportunities, 0);
  assert.strictEqual(stats.turnAggPct, null);
  assert.strictEqual(stats.turnAggPctOpportunities, 0);
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

// ── Rake ─────────────────────────────────────────────────────────────────
// Weplay's raw "X collected $Y from pot" line states the PRE-rake amount
// (confirmed against real data — see src/stats.js's distributeRakeReduction
// comment), so net/rakePaid both need the SUMMARY line's stated rake
// subtracted, not the raw collected figure used as-is.

test('analyzeHand: rakePaid is the exact rake Weplay charged when hero is the sole winner, and net is rake-adjusted', () => {
  // HAND_4BET_AS_RAISER: Hero collects $56 from a $56 pot, Rake $2.8, sole winner.
  const r = analyzeHand(HAND_4BET_AS_RAISER, 'Hero');
  assert.strictEqual(r.rakePaid, 2.8, 'sole winner pays the full stated rake, not a formula-derived guess');
  // contributed: "raises $A to $B" tracks A as the increment ABOVE HERO'S
  // OWN prior contribution this street, not relative to $B or to whichever
  // bet is being raised over — confirmed against a real captured hand with
  // a genuine same-player preflop re-raise (5.25 then 44.75, reaching
  // exactly 5.25+44.75=50.00, the stated new total). So here: preflop
  // 1.5 (first raise) + 12 (re-raise increment) + flop bet 10 = 23.5.
  const contributed = 1.5 + 12 + 10;
  assert.ok(Math.abs(r.net - (56 - 2.8 - contributed)) < 0.001, 'net reflects the rake-adjusted collected amount, not the raw pre-rake one');
});

test('analyzeHand: rakePaid is zero on a hand hero didn\'t collect from, even when real rake was taken', () => {
  const hand = `Weplay Hand #900:  Hold'em No Limit ($0.25/$0.50) - 2026/07/05 18:30:00 UTC
Table 'Test'(111) 3-max Seat #1 is the button
Seat 1: Hero ($100 in chips)
Seat 2: PlayerB ($100 in chips)
Seat 3: PlayerC ($100 in chips)
PlayerB: posts small blind $0.25
PlayerC: posts big blind $0.50
*** HOLE CARDS ***
Dealt to Hero [2c 7d]
Hero: raises $1.5 to $1.5
PlayerB: folds
PlayerC: calls $1
*** FLOP *** [Kh Qh 2d]
PlayerC: bets $2
Hero: folds
Uncalled bet ($0) returned to PlayerC
*** SHOW DOWN ***
PlayerC collected $5.70 from pot
*** SUMMARY ***
Total pot $6 | Rake $0.30
Seat 1: Hero folded on the Flop
Seat 2: PlayerB (small blind) folded before Flop
Seat 3: PlayerC (big blind) collected ($5.70)`;
  const r = analyzeHand(hand, 'Hero');
  assert.strictEqual(r.rakePaid, 0, 'rake only ever reduces a winner\'s payout — Hero folded, so none of it was billed to them');
});

test('aggregateStats: totalRakePaid sums rakePaid the same way netResult sums net', () => {
  const hands = [
    { ...analyzeHand(HAND_4BET_AS_RAISER, 'Hero'), isBombPot: false },
    { ...analyzeHand(HAND_4BET_AS_CALLER, 'Hero'), isBombPot: false },
  ];
  const stats = aggregateStats(hands);
  assert.ok(Math.abs(stats.totalRakePaid - 5.6) < 0.001, 'two hands at $2.80 rake each, Hero the sole winner both times');
});

console.log(`\n${passed} test(s) passed.`);
