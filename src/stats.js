'use strict';

const { splitHands } = require('./converter');

// ── Regexes ──────────────────────────────────────────────────────────────
// Deliberately independent from converter.js's regexes: this module reads
// raw Weplay text for analysis, not for producing CoinPoker output, so it
// doesn't need the FIRST/SECOND run-it-twice bookkeeping or any of the
// output-formatting concerns. Where a real Weplay quirk affects parsing
// (multi-word usernames, "and is all-in" suffixes, single-digit hours) the
// same fixes already proven in converter.js are mirrored here.

// VanillaPoker uses the exact same hand history format as Weplay, just under
// a different site name — see the matching comment in converter.js.
const RE_HEADER = /^(?:Weplay|VanillaPoker) Hand #(\d+):\s+Hold'em No Limit \(\$([0-9.]+)\/\$([0-9.]+)\)\s+-\s+(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2})/;
const RE_SEAT = /^Seat (\d+): (.+?) \(\$([0-9.]+) in chips\)$/;
const RE_TABLE = /^Table '.+?'\(\d+\)\s+(\d+)-max/;
const RE_ANTE = /^(.+?): posts the ante \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_SB = /^(.+?): posts small blind \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_BB = /^(.+?): posts big blind \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_DEALT = /^Dealt to (.+?)(?: \[(.+?)\])?$/;
const RE_STREET = /^\*\*\* (?:(?:FIRST|SECOND) )?(HOLE CARDS|FLOP|TURN|RIVER|SHOW DOWN|SUMMARY) \*\*\*/;
const RE_FOLD = /^(.+?): folds$/;
const RE_CHECK = /^(.+?): checks$/;
const RE_CALL = /^(.+?): calls \$([0-9.]+)(\s+and is all-in)?$/;
const RE_BET = /^(.+?): bets \$([0-9.]+)(\s+and is all-in)?$/;
const RE_RAISE = /^(.+?): raises \$([0-9.]+) to \$([0-9.]+)(\s+and is all-in)?$/;
const RE_UNCALLED = /^Uncalled bet \(\$([0-9.]+)\) returned to (.+)$/;
const RE_COLLECTED = /^(.+?) collected \$([0-9.]+) from (?:pot|main pot|side pot(?:-\d+)?)$/;
const RE_TOTAL_POT = /^Total pot \$([0-9.]+)(?:\s+Main pot \$([0-9.]+)\.((?:\s+Side pot(?:-\d+)? \$[0-9.]+\.)*))?\s*\|\s*Rake \$([0-9.]+)\s*$/;

// A real Weplay quirk, confirmed against real data: every "X collected $Y
// from pot" line states the PRE-rake amount (equal to the hand's stated
// Total pot when there's one winner) — rake is never actually subtracted
// from what's shown there. src/converter.js and src/handReplay.js both
// already correct for this (proportionally, across every pot tier a hand
// paid out from) before ever showing a dollar figure to anyone; this module
// used to be the one place that didn't, silently overstating every hand a
// player won by their share of the rake — invisible per-hand (rake is a few
// percent) but large in aggregate (confirmed: ~60% of a real multi-thousand-
// hand net/bb100 discrepancy against an independent PokerTracker import of
// this same data). Duplicated here rather than imported so this module has
// no dependency on converter.js's internals, matching the project's
// existing self-contained-module pattern (see src/handReplay.js's own copy).
function centsOf(str) {
  return Math.round(parseFloat(str) * 100);
}
function distributeRakeReduction(items, rakeCents) {
  if (rakeCents <= 0) return items.map((it) => ({ ...it, adjustedCents: it.cents }));
  const groupTotal = items.reduce((s, it) => s + it.cents, 0);
  if (groupTotal <= 0) return items.map((it) => ({ ...it, adjustedCents: it.cents }));
  let allocated = 0;
  const withShare = items.map((it) => {
    const share = (it.cents / groupTotal) * rakeCents;
    const floorShare = Math.floor(share);
    allocated += floorShare;
    return { ...it, floorShare, frac: share - floorShare };
  });
  let remainder = rakeCents - allocated;
  withShare.sort((a, b) => b.frac - a.frac);
  for (let i = 0; i < withShare.length && remainder > 0; i++, remainder--) withShare[i].floorShare += 1;
  return withShare.map((it) => ({ ...it, adjustedCents: it.cents - it.floorShare }));
}

// ── Position labeling ───────────────────────────────────────────────────
// Labeled in seating order starting at the small blind, ending at the
// button. Based on actual occupied-seat count for that specific hand, not
// the table's nominal max-seats — a "6-max" table is very often shorter
// than 6 actually seated, and position names should reflect who's really
// there. Unusual sizes fall back to numbered middle positions.
const POSITION_TEMPLATES = {
  1: ['BTN'],
  // Heads-up: the "seating order starting at SB, ending at BTN" convention
  // above still holds — the button posts the small blind by rule, so the
  // *other* seat is "one step after the button" (comes first in that
  // order) and the button's own seat comes last. This was backwards before
  // (['BTN', 'BB']), which mislabeled both heads-up players' positions —
  // caught by a synthetic heads-up test, not by real data, since heads-up
  // hands are rare in every real batch tested against so far. See
  // test/stats.test.js and test/handReplay.test.js for the regression tests.
  2: ['BB', 'BTN'],
  3: ['SB', 'BB', 'BTN'],
  4: ['SB', 'BB', 'UTG', 'BTN'],
  5: ['SB', 'BB', 'UTG', 'CO', 'BTN'],
  6: ['SB', 'BB', 'UTG', 'MP', 'CO', 'BTN'],
  7: ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'CO', 'BTN'],
  8: ['SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO', 'BTN'],
};
function positionLabelsFor(n) {
  if (POSITION_TEMPLATES[n]) return POSITION_TEMPLATES[n];
  const middleCount = Math.max(0, n - 4);
  const labels = ['SB', 'BB'];
  for (let i = 0; i < middleCount; i++) labels.push(`MP${i + 1}`);
  labels.push('CO');
  labels.push('BTN');
  return labels;
}

function computeEffectiveButton(occupiedSeatNums, sbSeatNum, statedButton) {
  if (occupiedSeatNums.includes(statedButton)) return statedButton;
  if (sbSeatNum == null || !occupiedSeatNums.includes(sbSeatNum)) return statedButton;
  if (occupiedSeatNums.length === 2) return sbSeatNum;
  const sorted = [...occupiedSeatNums].sort((a, b) => a - b);
  const idx = sorted.indexOf(sbSeatNum);
  const prevIdx = (idx - 1 + sorted.length) % sorted.length;
  return sorted[prevIdx];
}

/**
 * Analyze one raw Weplay hand block for a given player (auto-detected via
 * the "Dealt to X [cards]" line when heroName is omitted, same as the
 * converter). Returns null if the hand can't be attributed to anyone (no
 * hole cards found) or has no resolution at all (mirrors the converter's
 * own "skip" condition for a corrupted hand — no collected line anywhere).
 */
// Classifies a hand by preflop aggression pattern from hero's perspective:
// how many total preflop raises occurred (by anyone) determines whether the
// pot is "srp" (1 raise), "3bet" (2 raises), or "4bet" (3 raises); hero's own
// role in that final raise level — did they make it, or call it — determines
// "raiser" vs "caller". A hand where hero folded before reaching the final
// raise level, was never involved, the raise count is 0 (a limped pot) or
// 4+ (5-bet or higher) returns null — deliberately uncategorized rather than
// forced into one of these six buckets, since none of them actually fit.
const RAISE_LEVEL_NAMES = { 1: 'srp', 2: '3bet', 3: '4bet' };
function handCategoryFor(finalPreflopRaiseCount, heroLastPreflopAction) {
  const base = RAISE_LEVEL_NAMES[finalPreflopRaiseCount];
  if (!base || !heroLastPreflopAction) return null;
  if (heroLastPreflopAction.type === 'raise' && heroLastPreflopAction.level === finalPreflopRaiseCount) return `${base}-raiser`;
  if (heroLastPreflopAction.type === 'call' && heroLastPreflopAction.level === finalPreflopRaiseCount) return `${base}-caller`;
  return null;
}

function analyzeHand(block, heroNameOverride) {
  const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
  const header = RE_HEADER.exec(lines[0] || '');
  if (!header) return null;
  const [, handId, sbStake, bbStake, y, mo, d, hh, mm, ss] = header;
  const bb = parseFloat(bbStake);

  let maxSeats = null;
  for (const l of lines) {
    const tm = RE_TABLE.exec(l);
    if (tm) { maxSeats = parseInt(tm[1], 10); break; }
  }

  const seats = [];
  for (const l of lines) {
    const m = RE_SEAT.exec(l);
    if (m) seats.push({ num: parseInt(m[1], 10), name: m[2] });
  }
  if (seats.length === 0) return null;

  let hero = heroNameOverride;
  if (!hero) {
    for (const l of lines) {
      const m = RE_DEALT.exec(l);
      if (m && m[2]) { hero = m[1]; break; }
    }
  }
  if (!hero || !seats.some((s) => s.name === hero)) return null;

  let sbName = null, bbName = null;
  for (const l of lines) {
    const m = RE_SB.exec(l);
    if (m) { sbName = m[1]; break; }
  }
  for (const l of lines) {
    const m = RE_BB.exec(l);
    if (m) { bbName = m[1]; break; }
  }
  const isBombPot = !sbName && !bbName;

  const occupiedSeatNums = seats.map((s) => s.num).sort((a, b) => a - b);
  const sbSeat = seats.find((s) => s.name === sbName);
  const buttonMatch = /Seat #(\d+) is the button/.exec(lines.find((l) => l.startsWith('Table ')) || '');
  const statedButton = buttonMatch ? parseInt(buttonMatch[1], 10) : occupiedSeatNums[0];
  const effectiveButton = computeEffectiveButton(occupiedSeatNums, sbSeat ? sbSeat.num : null, statedButton);

  // order/labels are hoisted out of the `if` below (rather than computed
  // only for hero) so positionForName can reuse them for ANY seated player,
  // not just hero — a cheap, targeted lookup (not a full per-player
  // position table) needed for steal-defense detection further down: to
  // know whether a raise hero is facing was itself a genuine steal (an open
  // from CO/BTN/SB), the RAISER's position has to be known too, not just
  // hero's own.
  let position = null;
  let order = []; // seat numbers starting right after the button (SB) around to the button itself
  let labels = [];
  if (occupiedSeatNums.includes(effectiveButton)) {
    const btnIdx = occupiedSeatNums.indexOf(effectiveButton);
    const n = occupiedSeatNums.length;
    for (let i = 1; i <= n; i++) order.push(occupiedSeatNums[(btnIdx + i) % n]);
    labels = positionLabelsFor(n);
    const heroSeat = seats.find((s) => s.name === hero);
    const idx = order.indexOf(heroSeat.num);
    if (idx !== -1) position = labels[idx];
  }
  function positionForName(name) {
    const seat = seats.find((s) => s.name === name);
    if (!seat) return null;
    const idx = order.indexOf(seat.num);
    return idx === -1 ? null : labels[idx];
  }
  const LATE_POSITIONS = new Set(['CO', 'BTN', 'SB']);

  let street = 'PREFLOP';
  let contributed = 0;
  let anyCollected = false;
  // Every "collected" line in the hand, not just hero's — rake has to be
  // distributed across the whole group of collectors (see
  // distributeRakeReduction above), not computed on hero's line in
  // isolation, since a hand can have more than one winner (a split pot) or
  // more than one pot tier (side pots) rake is paid out of.
  const collectedLines = [];
  let voluntaryPreflopAction = false;
  let preflopRaise = false;
  let madeThreeBet = false; // hero re-raised while facing exactly one prior raise
  let facedThreeBetOpportunity = false; // hero faced exactly one prior raise at least once (any response counts)
  let facedThreeBetAfterOpening = false; // true only between "hero's open got re-raised" and hero's next action
  let hadThreeBetOpportunityAfterOpening = false; // hero's OWN open specifically got re-raised at some point
  let foldedToThreeBet = false;
  let heroOpenedPreflop = false;
  // 4-Bet stats mirror the 3-bet ones exactly one raise level deeper: a
  // 4-bet is hero re-raising while facing exactly two prior raises (the
  // open + a 3-bet), and Fold to 4-Bet mirrors the same narrower "after MY
  // OWN raise got re-raised" definition already used for Fold to 3-Bet
  // above, for internal consistency — both "fold to Xbet" stats answer the
  // same question (did hero's own aggression get re-raised, and did they
  // fold to it) one level apart.
  let madeFourBet = false; // hero re-raised while facing exactly two prior raises
  let facedFourBetOpportunity = false; // hero faced exactly two prior raises at least once (any response counts)
  let facedFourBetAfterThreeBetting = false; // true only between "hero's 3-bet got re-raised" and hero's next action
  let hadFourBetOpportunityAfterThreeBetting = false; // hero's OWN 3-bet specifically got re-raised at some point
  let foldedToFourBet = false;
  // Squeeze: a 3-bet made with at least one live caller sitting between the
  // original raiser and hero — i.e. re-raising into a raise-plus-call(s),
  // not just a heads-up raise. callersSinceLastRaise counts preflop calls
  // by ANY player since the most recent preflop raise by anyone, reset to 0
  // every time a new raise occurs (see the raise handler below) — so at the
  // moment hero faces a single prior raise, this value is exactly "how many
  // players called that raise before the action reached hero."
  let callersSinceLastRaise = 0;
  let squeezeOpportunity = false; // facing a raise with >=1 caller in between, at least once (any response counts)
  let squeeze = false; // ...and hero re-raised
  // Steal defense: hero (in the SB or BB) facing a genuine steal raise — an
  // open, by CO/BTN/SB, into a still-fully-unopened pot, with no one else
  // having called it yet. openRaiserName/openRaiserIsLatePosition capture
  // whether the FIRST raise of the hand (by anyone) qualifies; Attempt to
  // Steal itself needs no separate tracking — it's exactly RFI (already
  // tracked below) restricted to hero being in CO/BTN/SB, computed after
  // the loop from rfi/rfiOpportunity + position.
  let openRaiserName = null;
  let openRaiserIsLatePosition = false;
  let stealDefenseOpportunity = false;
  let foldedToSteal = false;
  // RFI (Raised First In): distinct from PFR, which counts every preflop
  // raise (opens, isolates, 3-bets, 4-bets+). RFI isolates just "hero was
  // the first player to voluntarily put money in the pot" — the number that
  // actually describes an opening range by position. anyVoluntaryPreflopAction
  // tracks whether ANY player (not just hero) has called or raised yet this
  // preflop — checked at hero's first preflop decision point only (gated by
  // heroActedPreflopOnce), since a later decision point always has the flag
  // already set (either by someone else acting first, or by hero's own
  // first action), so this naturally never re-fires within one hand.
  let anyVoluntaryPreflopAction = false;
  let heroActedPreflopOnce = false;
  let rfiOpportunity = false; // hero's first preflop decision came with the pot still fully unopened
  let rfi = false; // ...and hero raised
  // Cold Call: calling the opening raise with zero money already invested —
  // excludes blind calls (blind money already "in") and limp-then-call
  // (limp money already "in"), matching PokerTracker's own stated
  // definition. contributed === 0 at the moment of the decision captures
  // exactly this, since posting a blind or limping both add to contributed
  // before a cold-call decision could ever be reached.
  let coldCallOpportunity = false;
  let coldCall = false;
  let limped = false; // entered the pot via a call while the pot was still unraised (preflopRaiseCount === 0)
  let sawFlop = false;
  let reachedShowdown = false; // genuine multi-way contest, not just the header text
  let inHandThisFar = true;
  let postflopAggressive = 0; // hero's bets + raises, flop/turn/river
  let postflopCalls = 0;
  // Raw per-street action counts (bets+raises, calls, folds, checks) — every
  // one is tracked here regardless of which ends up counting toward which
  // aggregate formula; aggregateStats' streetAggPct() is where that
  // decision actually gets made (and has changed twice now: textbook
  // Aggression Frequency, then DriveHUD's Agg%, then back to textbook AFq,
  // then finally to a folds-excluded/checks-included formula verified
  // against a real PokerTracker 4 report — see streetAggPct's own comment
  // for the full history and why). Nothing here needs to change to support
  // any of those — this object just records what actually happened on each
  // street.
  const streetAgg = {
    FLOP: { agg: 0, calls: 0, folds: 0, checks: 0 },
    TURN: { agg: 0, calls: 0, folds: 0, checks: 0 },
    RIVER: { agg: 0, calls: 0, folds: 0, checks: 0 },
  };
  // Check-Raise%: hero checks, a bet comes back to them on the SAME street,
  // and hero raises it (as opposed to calling or folding to it). Sequence-
  // aware, unlike streetAgg above — a hero check only creates a real
  // check-raise opportunity if hero gets to act again on that street, which
  // can only happen if someone bet in the meantime (otherwise the street
  // just ends after the checks around). awaitingCheckRaise[street] is set
  // true on hero's check and consumed (opportunity counted, flag cleared)
  // on hero's next action on that same street, whatever it is.
  const checkRaiseByStreet = {
    FLOP: { opp: 0, cr: 0 },
    TURN: { opp: 0, cr: 0 },
    RIVER: { opp: 0, cr: 0 },
  };
  const awaitingCheckRaise = { FLOP: false, TURN: false, RIVER: false };
  // C-Bet%: hero was the PREVIOUS street's last aggressor (the final
  // preflop raiser, for a flop c-bet; whoever bet/raised the flop, for a
  // turn c-bet; etc.) and is first to act on the CURRENT street with no bet
  // in front of them yet. currentStreetAggressor tracks the most recent
  // bet/raise on whichever street is currently in progress (by ANY player,
  // not just hero — needed to know who hero is facing, not just whether
  // hero themselves is aggressive); previousStreetAggressor is a snapshot
  // of that value taken at each street transition, before it resets to
  // null for the new street. Fold to C-Bet specifically requires the
  // bettor hero is FACING to be that same previous-street aggressor — a
  // bet from some other player (a probe/lead, not a continuation) is a
  // different question this stat isn't meant to answer.
  let currentStreetAggressor = null;
  let previousStreetAggressor = null;
  let hasBetThisStreet = false;
  const cbetOpportunity = { FLOP: false, TURN: false, RIVER: false };
  const cbetMade = { FLOP: false, TURN: false, RIVER: false };
  const facedCBetOpportunity = { FLOP: false, TURN: false, RIVER: false };
  const foldedToCBet = { FLOP: false, TURN: false, RIVER: false };
  // Float and Probe Bet: PokerTracker's own two distinct stats for betting
  // into a street where the "due" continuation bettor (the previous
  // street's aggressor) checked back instead — confirmed via PT4's own
  // forums (pt4.pokertracker.com "Cbet, Donk, Float & Probe Bets" and
  // pokertracker.com "Interpretation of stats Probe and Float"), not
  // merged into one number the way this app originally shipped it: Float
  // is the IN-POSITION player betting the SAME street right after the due
  // bettor checks (possible on any street, since acting later than the
  // checker within one betting round just means being in position that
  // hand); Probe is the OUT-OF-POSITION player betting the NEXT street,
  // since OOP acts first and can't react same-street — only possible on
  // turn/river, never flop (there's no "street before" the flop to have
  // checked through). "Stab" (this app's original name) turned out to be
  // informal player slang some forum posters use for "Float and Probe
  // added together," not an official tracker stat.
  //
  // missedCbetThisStreet/streetWasBet/streetDueBettor below are all
  // HAND-scoped, not tied to whichever player this call is analyzing —
  // detecting "the due bettor checked" or "nobody bet this street at all"
  // doesn't depend on who hero is. floatOpportunity/floatMade/
  // facedFloatOpportunity/foldedToFloat and probeOpportunity/probeMade/
  // facedProbeOpportunity/foldedToProbe ARE hero-scoped, mirroring
  // cbetOpportunity/cbetMade/facedCBetOpportunity/foldedToCBet exactly.
  const missedCbetThisStreet = { FLOP: false, TURN: false, RIVER: false };
  const streetWasBet = { FLOP: false, TURN: false, RIVER: false }; // did ANYONE bet/raise this street, by the time it ended
  const streetDueBettor = { FLOP: null, TURN: null, RIVER: null }; // snapshot of previousStreetAggressor at this street's own start
  const PRIOR_STREET = { TURN: 'FLOP', RIVER: 'TURN' }; // flop has no prior postflop street, so no flop probe exists
  const floatOpportunity = { FLOP: false, TURN: false, RIVER: false };
  const floatMade = { FLOP: false, TURN: false, RIVER: false };
  const facedFloatOpportunity = { FLOP: false, TURN: false, RIVER: false };
  const foldedToFloat = { FLOP: false, TURN: false, RIVER: false };
  const probeOpportunity = { TURN: false, RIVER: false };
  const probeMade = { TURN: false, RIVER: false };
  const facedProbeOpportunity = { TURN: false, RIVER: false };
  const foldedToProbe = { TURN: false, RIVER: false };
  let preflopRaiseCount = 0;
  // Tracks hero's most recent preflop decision and exactly how many raises
  // they were facing/making at that moment — used after the loop to classify
  // the hand as SRP/3-bet/4-bet pot, and hero's role in it (raiser vs
  // caller). See handCategoryFor() below for exactly how these combine.
  let heroLastPreflopAction = null; // { type: 'fold'|'call'|'raise', level }
  const activePlayers = new Set(seats.map((s) => s.name));

  // Marks hero's first preflop decision point (fold/call/raise, whichever
  // comes first) and records whether the pot was still completely unopened
  // at that moment — an RFI opportunity. No-op on every later decision
  // point in the same hand, since heroActedPreflopOnce is only ever false
  // once. Called BEFORE anyVoluntaryPreflopAction is updated for hero's own
  // current action, so hero's own raise doesn't count against itself.
  function noteHeroFirstPreflopDecision() {
    if (heroActedPreflopOnce || street !== 'PREFLOP') return false;
    heroActedPreflopOnce = true;
    rfiOpportunity = !anyVoluntaryPreflopAction;
    return rfiOpportunity;
  }

  for (const l of lines) {
    const sm = RE_STREET.exec(l);
    if (sm) {
      const name = sm[1];
      if (name === 'FLOP') {
        street = 'FLOP';
        if (inHandThisFar) sawFlop = true;
        previousStreetAggressor = currentStreetAggressor; // the final preflop raiser, if any
        streetDueBettor.FLOP = previousStreetAggressor;
        currentStreetAggressor = null;
        hasBetThisStreet = false;
      } else if (name === 'TURN') {
        street = 'TURN';
        previousStreetAggressor = currentStreetAggressor; // whoever bet/raised the flop, if anyone
        streetDueBettor.TURN = previousStreetAggressor;
        currentStreetAggressor = null;
        hasBetThisStreet = false;
      } else if (name === 'RIVER') {
        street = 'RIVER';
        previousStreetAggressor = currentStreetAggressor; // whoever bet/raised the turn, if anyone
        streetDueBettor.RIVER = previousStreetAggressor;
        currentStreetAggressor = null;
        hasBetThisStreet = false;
      } else if (name === 'SHOW DOWN') {
        street = 'SHOWDOWN';
        if (inHandThisFar && activePlayers.has(hero) && activePlayers.size >= 2) reachedShowdown = true;
      }
      continue;
    }

    let m;
    if ((m = RE_ANTE.exec(l)) && m[1] === hero) { contributed += parseFloat(m[2]); continue; }
    if ((m = RE_SB.exec(l)) && m[1] === hero) { contributed += parseFloat(m[2]); continue; }
    if ((m = RE_BB.exec(l)) && m[1] === hero) { contributed += parseFloat(m[2]); continue; }

    if ((m = RE_FOLD.exec(l))) {
      const who = m[1];
      if (who === hero) {
        noteHeroFirstPreflopDecision();
        // Cold call opportunity: facing the opening raise with zero money
        // already invested (see the coldCallOpportunity declaration above
        // for why contributed === 0 is the right check).
        if (street === 'PREFLOP' && preflopRaiseCount === 1 && contributed === 0) coldCallOpportunity = true;
        // A 3-bet opportunity is facing exactly one prior raise, regardless
        // of what hero does about it — folding counts the same as calling or
        // re-raising, so this has to be checked on every one of hero's
        // preflop actions, not just the raises.
        if (street === 'PREFLOP' && preflopRaiseCount === 1) {
          facedThreeBetOpportunity = true;
          if (callersSinceLastRaise >= 1) squeezeOpportunity = true;
          // Steal defense: hero is in the SB/BB, facing a genuine steal
          // raise (open, by CO/BTN/SB, into what was an unopened pot) with
          // no one else having called it yet.
          if (openRaiserIsLatePosition && callersSinceLastRaise === 0 && (position === 'SB' || position === 'BB')) {
            stealDefenseOpportunity = true;
          }
        }
        if (street === 'PREFLOP' && preflopRaiseCount === 2) facedFourBetOpportunity = true;
        inHandThisFar = false;
        if (street === 'PREFLOP') { heroLastPreflopAction = { type: 'fold', level: preflopRaiseCount }; }
        if (street === 'PREFLOP' && facedThreeBetAfterOpening) foldedToThreeBet = true;
        if (street === 'PREFLOP' && facedFourBetAfterThreeBetting) foldedToFourBet = true;
        if (street === 'PREFLOP' && stealDefenseOpportunity && preflopRaiseCount === 1) foldedToSteal = true;
        if (streetAgg[street]) streetAgg[street].folds++;
        if (awaitingCheckRaise[street]) { checkRaiseByStreet[street].opp++; awaitingCheckRaise[street] = false; } // check-folded, not check-raised
        // Fold to C-Bet: the bet hero just folded to came specifically from
        // the previous street's aggressor (a genuine continuation bet), not
        // just any bettor.
        if (hasBetThisStreet && previousStreetAggressor != null && currentStreetAggressor === previousStreetAggressor) {
          facedCBetOpportunity[street] = true;
          foldedToCBet[street] = true;
        }
        // Fold to Float: hero already missed their own c-bet chance this
        // street (cbetOpportunity[street] was set true by hero's own
        // earlier check on this same street, cbetMade[street] still false)
        // and is now folding to a bet from someone else. Mutually exclusive
        // with Fold to C-Bet above: that one requires the bettor to BE
        // previousStreetAggressor; this one requires HERO to have been.
        if (hasBetThisStreet && cbetOpportunity[street] && !cbetMade[street]) {
          facedFloatOpportunity[street] = true;
          foldedToFloat[street] = true;
        }
        // Fold to Probe: hero was already the due bettor on the PRIOR
        // street (streetDueBettor[priorStreet] === hero), checked it, and
        // that prior street had NO bet from anyone at all (a genuine
        // check-through) — so THIS street's bet is a probe, not a
        // continuation of anything. See the Float/Probe comment above.
        {
          const priorStreet = PRIOR_STREET[street];
          if (hasBetThisStreet && priorStreet && streetDueBettor[priorStreet] === hero && missedCbetThisStreet[priorStreet] && !streetWasBet[priorStreet]) {
            facedProbeOpportunity[street] = true;
            foldedToProbe[street] = true;
          }
        }
      }
      activePlayers.delete(who);
      continue;
    }
    if ((m = RE_CHECK.exec(l))) {
      const who = m[1];
      // Float/Probe setup: whoever was "due" to continuation-bet this
      // street (the previous street's aggressor) checking instead —
      // tracked for ANY player, not just hero, since a later player's
      // float/probe opportunity depends on this regardless of who's being
      // analyzed this call.
      if (streetAgg[street] && who === previousStreetAggressor && !hasBetThisStreet) missedCbetThisStreet[street] = true;
      if (who === hero && streetAgg[street]) {
        streetAgg[street].checks++;
        awaitingCheckRaise[street] = true;
        // Hero had the c-bet chance (was the previous street's aggressor,
        // no bet in front of them yet) and declined it by checking.
        if (previousStreetAggressor === hero && !hasBetThisStreet) cbetOpportunity[street] = true;
        // Float: hero is reacting to someone else's already-recorded
        // missed c-bet THIS street, and is themselves declining to float it
        // (who !== previousStreetAggressor excludes hero's own check above
        // from counting as a float opportunity against themselves).
        if (missedCbetThisStreet[street] && who !== previousStreetAggressor && !hasBetThisStreet) floatOpportunity[street] = true;
        // Probe: the PRIOR street was checked through entirely by its due
        // bettor (not hero), and hero — first to act THIS street — is
        // declining to probe it too.
        const priorStreet = PRIOR_STREET[street];
        if (priorStreet && streetDueBettor[priorStreet] != null && streetDueBettor[priorStreet] !== hero && missedCbetThisStreet[priorStreet] && !streetWasBet[priorStreet] && !hasBetThisStreet) {
          probeOpportunity[street] = true;
        }
      }
      continue;
    }

    if ((m = RE_CALL.exec(l))) {
      const who = m[1];
      if (who === hero) {
        noteHeroFirstPreflopDecision();
        if (street === 'PREFLOP' && preflopRaiseCount === 1) {
          facedThreeBetOpportunity = true;
          if (callersSinceLastRaise >= 1) squeezeOpportunity = true;
          if (openRaiserIsLatePosition && callersSinceLastRaise === 0 && (position === 'SB' || position === 'BB')) {
            stealDefenseOpportunity = true;
          }
          // Cold call: calling the opening raise with zero money already
          // invested (see coldCallOpportunity's declaration for why).
          if (contributed === 0) { coldCallOpportunity = true; coldCall = true; }
        }
        if (street === 'PREFLOP' && preflopRaiseCount === 0) limped = true;
        if (street === 'PREFLOP' && preflopRaiseCount === 2) facedFourBetOpportunity = true;
        contributed += parseFloat(m[2]);
        if (street === 'PREFLOP') { voluntaryPreflopAction = true; heroLastPreflopAction = { type: 'call', level: preflopRaiseCount }; }
        else {
          postflopCalls++;
          if (streetAgg[street]) streetAgg[street].calls++;
          if (awaitingCheckRaise[street]) { checkRaiseByStreet[street].opp++; awaitingCheckRaise[street] = false; } // check-called, not check-raised
          // Called a c-bet: the bet hero is facing came specifically from
          // the previous street's aggressor.
          if (hasBetThisStreet && previousStreetAggressor != null && currentStreetAggressor === previousStreetAggressor) {
            facedCBetOpportunity[street] = true;
          }
          // Called a float: hero already missed their own c-bet chance
          // this street and is calling someone else's bet into it.
          if (hasBetThisStreet && cbetOpportunity[street] && !cbetMade[street]) {
            facedFloatOpportunity[street] = true;
          }
          // Called a probe: see the Fold to Probe comment above for the
          // condition — same, minus the fold.
          {
            const priorStreet = PRIOR_STREET[street];
            if (hasBetThisStreet && priorStreet && streetDueBettor[priorStreet] === hero && missedCbetThisStreet[priorStreet] && !streetWasBet[priorStreet]) {
              facedProbeOpportunity[street] = true;
            }
          }
        }
        if (street === 'PREFLOP' && facedThreeBetAfterOpening) facedThreeBetAfterOpening = false; // called it, didn't fold
        if (street === 'PREFLOP' && facedFourBetAfterThreeBetting) facedFourBetAfterThreeBetting = false; // called it, didn't fold
      }
      // Tracks whether ANY player (not just hero) has voluntarily entered
      // the pot yet — feeds RFI opportunity detection above — and, since
      // the most recent raise, how many players have called it — feeds
      // squeeze detection above. Both have to fire regardless of who made
      // the call.
      if (street === 'PREFLOP') { anyVoluntaryPreflopAction = true; callersSinceLastRaise++; }
      continue;
    }
    if ((m = RE_BET.exec(l))) {
      const who = m[1];
      if (who === hero) {
        contributed += parseFloat(m[2]);
        if (street === 'PREFLOP') { voluntaryPreflopAction = true; preflopRaise = true; }
        else {
          postflopAggressive++;
          if (streetAgg[street]) streetAgg[street].agg++;
          // A bet only ever happens as the FIRST aggressive action of a
          // street (a second one would be logged as "raises"), so this is
          // exactly hero's cbet-or-not decision point.
          if (previousStreetAggressor === hero) { cbetOpportunity[street] = true; cbetMade[street] = true; }
          // Float: hero bets after someone else already missed their own
          // c-bet chance THIS street (checked back when they had it).
          if (missedCbetThisStreet[street] && previousStreetAggressor !== hero) { floatOpportunity[street] = true; floatMade[street] = true; }
          // Probe: the PRIOR street checked through entirely by its due
          // bettor (not hero), and hero — first to act this street — bets.
          const priorStreet = PRIOR_STREET[street];
          if (priorStreet && streetDueBettor[priorStreet] != null && streetDueBettor[priorStreet] !== hero && missedCbetThisStreet[priorStreet] && !streetWasBet[priorStreet]) {
            probeOpportunity[street] = true;
            probeMade[street] = true;
          }
        }
      }
      // Tracks who's aggressive on the CURRENT street, regardless of who —
      // feeds the c-bet/fold-to-c-bet detection above for every street.
      if (street !== 'PREFLOP') { hasBetThisStreet = true; currentStreetAggressor = who; streetWasBet[street] = true; }
      continue;
    }
    if ((m = RE_RAISE.exec(l))) {
      const who = m[1];
      const amt = parseFloat(m[2]);
      // The first raise of the hand, made into a still-fully-unopened pot —
      // a genuine steal-eligible open, regardless of who made it. Checked
      // BEFORE anyVoluntaryPreflopAction updates below, and only ever true
      // once per hand (preflopRaiseCount === 0 only holds for this first
      // raise).
      if (street === 'PREFLOP' && preflopRaiseCount === 0 && !anyVoluntaryPreflopAction) {
        openRaiserName = who;
        openRaiserIsLatePosition = LATE_POSITIONS.has(positionForName(who));
      }
      if (who === hero) {
        // Hero's first preflop decision, and it's a raise into a still-fully-
        // unopened pot — exactly RFI (as opposed to PFR generally, which
        // also counts isolates/3-bets/4-bets over an already-opened pot).
        if (noteHeroFirstPreflopDecision()) rfi = true;
        if (street === 'PREFLOP' && preflopRaiseCount === 1) {
          facedThreeBetOpportunity = true;
          madeThreeBet = true;
          if (callersSinceLastRaise >= 1) { squeezeOpportunity = true; squeeze = true; }
          if (openRaiserIsLatePosition && callersSinceLastRaise === 0 && (position === 'SB' || position === 'BB')) {
            stealDefenseOpportunity = true;
          }
        }
        if (street === 'PREFLOP' && preflopRaiseCount === 2) { facedFourBetOpportunity = true; madeFourBet = true; }
        contributed += amt;
        if (street === 'PREFLOP') {
          voluntaryPreflopAction = true;
          preflopRaise = true;
          if (preflopRaiseCount === 0) heroOpenedPreflop = true;
          heroLastPreflopAction = { type: 'raise', level: preflopRaiseCount + 1 };
          if (facedThreeBetAfterOpening) facedThreeBetAfterOpening = false; // re-raised it (4-bet+), didn't fold
          if (facedFourBetAfterThreeBetting) facedFourBetAfterThreeBetting = false; // re-raised it (5-bet+), didn't fold
        } else {
          postflopAggressive++;
          if (streetAgg[street]) streetAgg[street].agg++;
          if (awaitingCheckRaise[street]) { checkRaiseByStreet[street].opp++; checkRaiseByStreet[street].cr++; awaitingCheckRaise[street] = false; }
          // Raised a c-bet: the bet hero is facing (and re-raising) came
          // specifically from the previous street's aggressor.
          if (hasBetThisStreet && previousStreetAggressor != null && currentStreetAggressor === previousStreetAggressor) {
            facedCBetOpportunity[street] = true;
          }
          // Raised a float: hero already missed their own c-bet chance
          // this street and is raising someone else's bet into it.
          if (hasBetThisStreet && cbetOpportunity[street] && !cbetMade[street]) {
            facedFloatOpportunity[street] = true;
          }
          // Raised a probe: see the Fold to Probe comment above.
          {
            const priorStreet = PRIOR_STREET[street];
            if (hasBetThisStreet && priorStreet && streetDueBettor[priorStreet] === hero && missedCbetThisStreet[priorStreet] && !streetWasBet[priorStreet]) {
              facedProbeOpportunity[street] = true;
            }
          }
        }
      } else if (street === 'PREFLOP' && heroOpenedPreflop && preflopRaiseCount === 1) {
        // someone re-raised Hero's own open — a genuine 3-bet against Hero
        facedThreeBetAfterOpening = true;
        hadThreeBetOpportunityAfterOpening = true;
      } else if (street === 'PREFLOP' && madeThreeBet && preflopRaiseCount === 2) {
        // someone re-raised Hero's own 3-bet — a genuine 4-bet against Hero
        facedFourBetAfterThreeBetting = true;
        hadFourBetOpportunityAfterThreeBetting = true;
      }
      if (street === 'PREFLOP') { anyVoluntaryPreflopAction = true; preflopRaiseCount++; callersSinceLastRaise = 0; }
      else { hasBetThisStreet = true; if (streetWasBet[street] !== undefined) streetWasBet[street] = true; }
      currentStreetAggressor = who; // this raise is now the (possibly new) aggressor of the current street
      continue;
    }
    if ((m = RE_UNCALLED.exec(l)) && m[2] === hero) { contributed -= parseFloat(m[1]); continue; }
    if ((m = RE_COLLECTED.exec(l))) {
      collectedLines.push({ name: m[1], cents: centsOf(m[2]) });
      if (m[1] === hero) anyCollected = true;
      continue;
    }
  }

  // A hand with no resolution anywhere (a real Weplay data gap — e.g. a
  // disconnect at showdown that's never resolved) can't be attributed a
  // result, so exclude it entirely rather than silently treat it as a $0
  // hand — this mirrors the converter's own skip condition for the same case.
  if (collectedLines.length === 0) return null;

  // The SUMMARY line's rake figure covers the whole hand (every pot tier
  // combined), not just one collected-line — extracted once here rather
  // than tracked incrementally during the line-by-line scan above, then
  // applied proportionally across every collector via
  // distributeRakeReduction (see its own comment for why this matters).
  let rakeCents = 0;
  for (const l of lines) {
    const tm = RE_TOTAL_POT.exec(l);
    if (tm) { rakeCents = centsOf(tm[4]); break; }
  }
  const rakeAdjustedLines = distributeRakeReduction(
    collectedLines.map((c, idx) => ({ ...c, idx })),
    rakeCents,
  );
  const heroPreRakeCents = collectedLines.filter((c) => c.name === hero).reduce((sum, c) => sum + c.cents, 0);
  const collected = rakeAdjustedLines
    .filter((c) => c.name === hero)
    .reduce((sum, c) => sum + c.adjustedCents, 0) / 100;
  // What hero's own share of the rake actually cost them on this hand —
  // zero on a hand they didn't collect from (rake only ever reduces a
  // winner's payout, it isn't billed to anyone else), their proportional
  // share of it otherwise. The exact real number Weplay charged, not a
  // rate/cap formula reconstructed from a rate card — see
  // distributeRakeReduction's own comment for why that matters (this app
  // has already observed Weplay change their own rate mid-dataset).
  const rakePaid = (heroPreRakeCents - Math.round(collected * 100)) / 100;

  // Attempt to Steal: exactly RFI (raising into a still-unopened pot),
  // restricted to hero being in CO/BTN/SB — no separate tracking needed,
  // both rfi/rfiOpportunity and position are already known by this point.
  const isLatePosition = LATE_POSITIONS.has(position);
  const stealOpportunity = rfiOpportunity && isLatePosition;
  const attemptSteal = rfi && isLatePosition;

  // Double/Triple Barrel: pure post-hoc derivations from the c-bet fields
  // above, needing no extra loop-time state. Double Barrel opportunity is
  // "hero c-bet the flop AND is still the designated bettor going into
  // turn" (their flop bet got called/raised rather than folded to, so they
  // get to act again as the aggressor) — cbetOpportunity.TURN already means
  // exactly that. Triple Barrel is the same one street deeper.
  const doubleBarrelOpportunity = cbetMade.FLOP && cbetOpportunity.TURN;
  const doubleBarrel = doubleBarrelOpportunity && cbetMade.TURN;
  const tripleBarrelOpportunity = cbetMade.FLOP && cbetMade.TURN && cbetOpportunity.RIVER;
  const tripleBarrel = tripleBarrelOpportunity && cbetMade.RIVER;

  return {
    handId, bb, stakesLabel: `$${sbStake}/$${bbStake}`, date: `${y}-${mo}-${d}`, time: `${hh.padStart(2, '0')}:${mm}:${ss}`, maxSeats,
    position, isBombPot,
    net: collected - contributed,
    rakePaid,
    vpip: voluntaryPreflopAction,
    pfr: preflopRaise,
    rfiOpportunity,
    rfi,
    coldCallOpportunity,
    coldCall,
    limped,
    stealOpportunity,
    attemptSteal,
    stealDefenseOpportunity,
    foldedToSteal,
    threeBet: madeThreeBet,
    facedThreeBetOpportunity,
    foldedToThreeBet,
    hadThreeBetOpportunityAfterOpening,
    fourBet: madeFourBet,
    facedFourBetOpportunity,
    foldedToFourBet,
    hadFourBetOpportunityAfterThreeBetting,
    squeeze,
    squeezeOpportunity,
    cbetOpportunity,
    cbetMade,
    facedCBetOpportunity,
    foldedToCBet,
    floatOpportunity,
    floatMade,
    facedFloatOpportunity,
    foldedToFloat,
    probeOpportunity,
    probeMade,
    facedProbeOpportunity,
    foldedToProbe,
    doubleBarrelOpportunity,
    doubleBarrel,
    tripleBarrelOpportunity,
    tripleBarrel,
    handCategory: handCategoryFor(preflopRaiseCount, heroLastPreflopAction),
    sawFlop,
    reachedShowdown,
    wonAtShowdown: reachedShowdown && anyCollected,
    wonWhenSawFlop: sawFlop && collected - contributed > 0,
    postflopAggressive,
    postflopCalls,
    streetAgg,
    checkRaiseByStreet,
  };
}

/**
 * Analyze a full raw Weplay hand history file for a given player.
 * Returns { hands: [...], excludedCount } — excludedCount covers hands that
 * couldn't be attributed to anyone or had no resolution at all.
 */
function analyzeFile(rawText, heroNameOverride) {
  const blocks = splitHands(rawText);
  const hands = [];
  let excludedCount = 0;
  for (const block of blocks) {
    const r = analyzeHand(block, heroNameOverride);
    if (r) hands.push(r);
    else excludedCount++;
  }
  return { hands, excludedCount };
}

/**
 * Aggregate per-hand results (from one or more analyzeFile calls) into a
 * PokerTracker-style summary. VPIP/PFR/3-bet stats are computed only over
 * non-bomb-pot hands, since a bomb pot has no preflop betting round at all —
 * including those hands would silently deflate every preflop stat.
 */
function aggregateStats(allHands) {
  const n = allHands.length;
  const nonBomb = allHands.filter((h) => !h.isBombPot);
  const bombCount = n - nonBomb.length;

  const sum = (arr, fn) => arr.reduce((s, h) => s + fn(h), 0);
  const pct = (count, denom) => (denom > 0 ? (count / denom) * 100 : null);

  const totalNet = sum(allHands, (h) => h.net);
  // Hero's own share of rake, summed the same way totalNet is — every hand
  // (bomb pots included, same population Winnings itself covers), not just
  // non-bomb ones. Zero on any hand hero didn't win; see rakePaid's own
  // comment in analyzeHand for why that's the right scope.
  const totalRakePaid = sum(allHands, (h) => h.rakePaid || 0);
  const bbWon = sum(allHands, (h) => h.net / h.bb);
  const bb100 = n > 0 ? (bbWon / n) * 100 : null;

  // EV Winrate (all-in equity adjusted bb/100) — the PokerTracker/Hold'em
  // Manager convention: each hand's result is nudged by evAdjustmentBB (see
  // src/evAnalysis.js), the difference in bb between what a genuine 2-player
  // all-in-with-cards-to-come actually paid off and what it was "supposed to"
  // pay off at the equity the money went in with (equity% * pot, converted
  // to a bb delta). Hands with no such all-in moment carry evAdjustmentBB ==
  // null and contribute their actual result unchanged, exactly like bb100.
  // Deliberately shares allHands/n with bb100 above — an earlier version of
  // this (in main.js) summed over the raw DB rows instead, which could
  // silently include hands aggregateStats itself had excluded, making the
  // two winrates not actually comparable to each other.
  let evBbSum = 0, evAdjustedHandCount = 0;
  for (const h of allHands) {
    const adjustment = h.evAdjustmentBB || 0;
    if (h.evAdjustmentBB != null) evAdjustedHandCount++;
    evBbSum += h.net / h.bb + adjustment;
  }
  const evBb100 = n > 0 ? (evBbSum / n) * 100 : null;

  const vpipCount = nonBomb.filter((h) => h.vpip).length;
  const pfrCount = nonBomb.filter((h) => h.pfr).length;

  // RFI%: (times raised into a still-unopened pot) / (times hero's first
  // preflop decision found the pot still unopened). Distinct from PFR,
  // which also counts isolates/3-bets/4-bets over an already-opened pot —
  // RFI is specifically an opening-range number.
  const rfiCount = nonBomb.filter((h) => h.rfi).length;
  const rfiOppCount = nonBomb.filter((h) => h.rfiOpportunity).length;

  // Cold Call%: (times called the opening raise with zero money already
  // invested) / (times faced that exact situation). See analyzeHand's
  // coldCallOpportunity comment — excludes blind calls and limp-then-call,
  // matching PokerTracker's own stated definition.
  const coldCallCount = nonBomb.filter((h) => h.coldCall).length;
  const coldCallOppCount = nonBomb.filter((h) => h.coldCallOpportunity).length;

  // Limp%: entered the pot via a call while it was still unraised. Not an
  // official top-level PokerTracker stat name, but the same VPIP-via-call
  // vs. VPIP-via-raise breakdown PT exposes through PFR-vs-VPIP comparisons
  // — uses the same "hands played" denominator as VPIP/PFR, not an
  // opportunity count, since every hand is a limp opportunity by definition
  // (nothing has to be facing hero for hero to be able to limp).
  const limpCount = nonBomb.filter((h) => h.limped).length;

  // 3-Bet%: (times hero re-raised while facing exactly one prior raise) /
  // (times hero faced exactly one prior raise at all, regardless of what
  // hero did about it). The denominator is the actual opportunity count —
  // NOT "every hand played", which was an earlier bug here: almost every
  // hand never gives hero a single-raise decision point at all, so dividing
  // by all hands made the rate look far lower than it really was.
  const threeBetCount = nonBomb.filter((h) => h.threeBet).length;
  const threeBetOppCount = nonBomb.filter((h) => h.facedThreeBetOpportunity).length;

  // Fold to 3-Bet%: (times hero folded after their OWN open got re-raised) /
  // (times hero's own open specifically got re-raised at all). The
  // denominator here was also a bug — it used "every hand hero opened",
  // but most opens never get 3-bet in the first place, so that inflated the
  // denominator and made the fold rate look far lower than it really was.
  const foldToThreeBetCount = nonBomb.filter((h) => h.foldedToThreeBet).length;
  const foldToThreeBetOppCount = nonBomb.filter((h) => h.hadThreeBetOpportunityAfterOpening).length;

  // 4-Bet% and Fold to 4-Bet%: exactly the same two patterns as 3-Bet% and
  // Fold to 3-Bet% above, one raise level deeper. See analyzeHand's 4-bet
  // comment for why Fold to 4-Bet mirrors the narrower "after MY OWN raise
  // got re-raised" definition rather than a general "faced any 4-bet" one.
  const fourBetCount = nonBomb.filter((h) => h.fourBet).length;
  const fourBetOppCount = nonBomb.filter((h) => h.facedFourBetOpportunity).length;
  const foldToFourBetCount = nonBomb.filter((h) => h.foldedToFourBet).length;
  const foldToFourBetOppCount = nonBomb.filter((h) => h.hadFourBetOpportunityAfterThreeBetting).length;

  // Squeeze%: (times re-raised a raise that already had a live caller in
  // front of hero) / (times faced that exact situation). A subset of the
  // 3-bet opportunities above — same preflopRaiseCount === 1 spot, plus the
  // extra "someone called in between" condition.
  const squeezeCount = nonBomb.filter((h) => h.squeeze).length;
  const squeezeOppCount = nonBomb.filter((h) => h.squeezeOpportunity).length;

  // Attempt to Steal%: (times raised into an unopened pot from CO/BTN/SB) /
  // (times hero was in CO/BTN/SB with the pot still unopened when they
  // acted). Fold to Steal%: (times hero, in the SB/BB, folded to a genuine
  // steal raise) / (times hero faced that exact situation — no one else
  // having called it yet).
  const stealCount = nonBomb.filter((h) => h.attemptSteal).length;
  const stealOppCount = nonBomb.filter((h) => h.stealOpportunity).length;
  const foldToStealCount = nonBomb.filter((h) => h.foldedToSteal).length;
  const foldToStealOppCount = nonBomb.filter((h) => h.stealDefenseOpportunity).length;

  // sawFlopPct (below) deliberately stays on allHands — "how often do you
  // see a flop at all" is a fair question to ask across everything you're
  // dealt, bomb pots included. WTSD/W$SD/WWSF are different: each is a
  // postflop *rate* (of the flops you saw, how often did X happen), and a
  // bomb pot forces every seated player to post and see the flop together
  // regardless of hand strength — much more multiway than a hand you
  // actually chose to continue with, and structurally that alone lowers a
  // per-player win rate no matter how well postflop is played. Confirmed
  // against real data: WWSF over non-bomb hands alone is 48.6% (squarely in
  // the normal 45-50% range), but blending in bomb pots — where a forced
  // 6-8-way pot can only have one winner — drags the combined figure down
  // to 41.7%, a bomb-pot-only WWSF as low as 15.7%. Same dilution hits
  // WTSD. Matches the same reasoning VPIP/PFR/3-Bet above already apply.
  const sawFlopHands = allHands.filter((h) => h.sawFlop);
  const sawFlopNonBomb = nonBomb.filter((h) => h.sawFlop);
  // WTSD%: (times reached a genuine showdown) / (times saw the flop) —
  // PokerTracker's own convention. This was also a bug here — it divided by
  // every hand dealt instead of just the ones that saw a flop, which made
  // the rate look far lower than it really was (most hands never see a flop
  // at all, so they were never real showdown candidates to begin with).
  const wtsdHands = sawFlopNonBomb.filter((h) => h.reachedShowdown);
  const wonShowdownCount = nonBomb.filter((h) => h.wonAtShowdown).length;
  const wonWhenSawFlopCount = sawFlopNonBomb.filter((h) => h.wonWhenSawFlop).length;

  const totalAggressive = sum(allHands, (h) => h.postflopAggressive);
  const totalPostflopCalls = sum(allHands, (h) => h.postflopCalls);

  // Per-street "PT Agg%" — bets+raises over bets+raises+calls+checks, FOLDS
  // excluded from the denominator. Verified directly against a real
  // PokerTracker 4 report (its "HM F/T/R Agg%" columns — PT4 borrows
  // Hold'em Manager's own per-street convention for this specific
  // breakdown) generated from this app's own CoinPoker-converted export:
  // once compared over a month where this database's hand count matched
  // PokerTracker's own (July 2026), this formula landed within ~1.5 points
  // of PokerTracker's own 25.7/32.5/32.5 on every street. The formula this
  // app used here before — bets+raises over bets+raises+calls+FOLDS,
  // checks excluded — is the textbook definition of AFq (and still
  // correct: summed across all three streets it matches PokerTracker's own
  // aggregate "Total AFq" column almost exactly, 45.2% vs its reported
  // 45.27%), but PokerTracker's own PER-STREET report apparently does not
  // use that same formula, so applying it per street was off by roughly 15
  // points versus real PokerTracker output. Not renamed to "AFq" here
  // despite the fix, since folds-excluded/checks-included isn't the
  // textbook AFq definition either — it's specifically PokerTracker's own
  // per-street convention, kept distinct from Agg% (DriveHUD's convention,
  // both folds AND checks included) reported alongside it below.
  function streetAggPct(streetKey) {
    let agg = 0, calls = 0, folds = 0, checks = 0;
    for (const h of allHands) {
      if (!h.streetAgg) continue;
      agg += h.streetAgg[streetKey].agg;
      calls += h.streetAgg[streetKey].calls;
      folds += h.streetAgg[streetKey].folds;
      checks += h.streetAgg[streetKey].checks;
    }
    const opportunities = agg + calls + checks;
    const aggPctOpportunities = agg + calls + folds + checks;
    return {
      pct: opportunities > 0 ? (agg / opportunities) * 100 : null,
      opportunities,
      aggPct: aggPctOpportunities > 0 ? (agg / aggPctOpportunities) * 100 : null,
      aggPctOpportunities,
    };
  }
  const flopAgg = streetAggPct('FLOP');
  const turnAgg = streetAggPct('TURN');
  const riverAgg = streetAggPct('RIVER');

  // Check-Raise%: (times check-raised) / (times check-raised + check-called
  // + check-folded) — see analyzeHand's checkRaiseByStreet comment for how
  // "opportunity" is detected (hero checked, then got to act again on the
  // same street because someone bet in the meantime).
  function checkRaisePct(streetKey) {
    let opp = 0, cr = 0;
    for (const h of allHands) {
      if (!h.checkRaiseByStreet) continue;
      opp += h.checkRaiseByStreet[streetKey].opp;
      cr += h.checkRaiseByStreet[streetKey].cr;
    }
    return { pct: opp > 0 ? (cr / opp) * 100 : null, opportunities: opp };
  }
  const flopCR = checkRaisePct('FLOP');
  const turnCR = checkRaisePct('TURN');
  const riverCR = checkRaisePct('RIVER');

  // C-Bet%: (times continuation-bet) / (times hero was the previous
  // street's aggressor with no bet yet in front of them) — see
  // analyzeHand's cbetOpportunity comment. Uses allHands, not nonBomb, the
  // same as the per-street aggression stats above — a bomb pot has no
  // preflop round so never creates a flop c-bet opportunity, but flop/turn
  // aggression carrying
  // into a turn/river c-bet is a real, well-defined question regardless.
  function cbetPct(streetKey) {
    const madeCount = allHands.filter((h) => h.cbetMade && h.cbetMade[streetKey]).length;
    const oppCount = allHands.filter((h) => h.cbetOpportunity && h.cbetOpportunity[streetKey]).length;
    return { pct: pct(madeCount, oppCount), opportunities: oppCount };
  }
  const flopCbet = cbetPct('FLOP');
  const turnCbet = cbetPct('TURN');
  const riverCbet = cbetPct('RIVER');

  // Fold to C-Bet%: (times folded to a bet from the previous street's
  // aggressor) / (times faced that exact situation).
  function foldToCbetPct(streetKey) {
    const foldCount = allHands.filter((h) => h.foldedToCBet && h.foldedToCBet[streetKey]).length;
    const oppCount = allHands.filter((h) => h.facedCBetOpportunity && h.facedCBetOpportunity[streetKey]).length;
    return { pct: pct(foldCount, oppCount), opportunities: oppCount };
  }
  const flopFoldToCbet = foldToCbetPct('FLOP');
  const turnFoldToCbet = foldToCbetPct('TURN');
  const riverFoldToCbet = foldToCbetPct('RIVER');

  // Float% and Fold to Float%: same shape as c-bet above, see analyzeHand's
  // floatOpportunity/floatMade/facedFloatOpportunity/foldedToFloat comment
  // for the underlying definition (in-position, same-street reaction to a
  // missed continuation bet — applies to all 3 streets).
  function floatPct(streetKey) {
    const madeCount = allHands.filter((h) => h.floatMade && h.floatMade[streetKey]).length;
    const oppCount = allHands.filter((h) => h.floatOpportunity && h.floatOpportunity[streetKey]).length;
    return { pct: pct(madeCount, oppCount), opportunities: oppCount };
  }
  const flopFloat = floatPct('FLOP');
  const turnFloat = floatPct('TURN');
  const riverFloat = floatPct('RIVER');

  function foldToFloatPct(streetKey) {
    const foldCount = allHands.filter((h) => h.foldedToFloat && h.foldedToFloat[streetKey]).length;
    const oppCount = allHands.filter((h) => h.facedFloatOpportunity && h.facedFloatOpportunity[streetKey]).length;
    return { pct: pct(foldCount, oppCount), opportunities: oppCount };
  }
  const flopFoldToFloat = foldToFloatPct('FLOP');
  const turnFoldToFloat = foldToFloatPct('TURN');
  const riverFoldToFloat = foldToFloatPct('RIVER');

  // Probe% and Fold to Probe%: out-of-position, NEXT-street reaction to a
  // missed continuation bet — turn/river only, see analyzeHand's
  // probeOpportunity/probeMade/facedProbeOpportunity/foldedToProbe comment.
  function probePct(streetKey) {
    const madeCount = allHands.filter((h) => h.probeMade && h.probeMade[streetKey]).length;
    const oppCount = allHands.filter((h) => h.probeOpportunity && h.probeOpportunity[streetKey]).length;
    return { pct: pct(madeCount, oppCount), opportunities: oppCount };
  }
  const turnProbe = probePct('TURN');
  const riverProbe = probePct('RIVER');

  function foldToProbePct(streetKey) {
    const foldCount = allHands.filter((h) => h.foldedToProbe && h.foldedToProbe[streetKey]).length;
    const oppCount = allHands.filter((h) => h.facedProbeOpportunity && h.facedProbeOpportunity[streetKey]).length;
    return { pct: pct(foldCount, oppCount), opportunities: oppCount };
  }
  const turnFoldToProbe = foldToProbePct('TURN');
  const riverFoldToProbe = foldToProbePct('RIVER');

  // Double/Triple Barrel%: (times hero followed through) / (times hero was
  // still the designated bettor with a live chance to). See analyzeHand's
  // doubleBarrelOpportunity/tripleBarrelOpportunity comment.
  const doubleBarrelCount = allHands.filter((h) => h.doubleBarrel).length;
  const doubleBarrelOppCount = allHands.filter((h) => h.doubleBarrelOpportunity).length;
  const tripleBarrelCount = allHands.filter((h) => h.tripleBarrel).length;
  const tripleBarrelOppCount = allHands.filter((h) => h.tripleBarrelOpportunity).length;

  // By position (non-bomb-pot only — position has no meaning without a
  // preflop betting round to act in).
  const byPosition = {};
  for (const h of nonBomb) {
    if (!h.position) continue;
    byPosition[h.position] = byPosition[h.position] || { hands: 0, net: 0, vpip: 0, pfr: 0 };
    byPosition[h.position].hands++;
    byPosition[h.position].net += h.net;
    if (h.vpip) byPosition[h.position].vpip++;
    if (h.pfr) byPosition[h.position].pfr++;
  }

  // By stake (big blind size). stakesLabel is carried along per bucket
  // (first hand seen at that bb sets it) so callers can show a real label
  // like "$0.50/$1" instead of just the bare bb number — used for the
  // Player Overview "Home" stat (whichever stake has the most hands).
  const byStake = {};
  for (const h of allHands) {
    const key = h.bb;
    byStake[key] = byStake[key] || { hands: 0, net: 0, stakesLabel: h.stakesLabel };
    byStake[key].hands++;
    byStake[key].net += h.net;
  }

  // Results over time (by date) — tracked as three parallel cumulative
  // series: the total (unchanged from before), and a showdown/non-showdown
  // split matching the standard "redline" definition PokerTracker/Hold'em
  // Manager/Hand2Note all use: Non-Showdown Winnings = Total Winnings -
  // Showdown Winnings, where "showdown" means the HAND structurally reached
  // a real 2+-way contest (reachedShowdown — the same flag WTSD% above
  // already uses), not whether hero's own cards happened to be revealed.
  // This used to key off heroCardsShown instead (a hand can reach a real
  // showdown and still have hero muck a loser, or win after the opponent
  // already showed and lost, without hero ever revealing their own cards —
  // confirmed against real data: 1512 hands reach a genuine showdown, but
  // only 1232 of them have hero's cards actually shown) — every major
  // tracker counts those ~280 hands as showdown results regardless, so this
  // now matches that rather than a narrower, non-standard definition.
  // showdownNet + nonShowdownNet always equals net for every date, by
  // construction (every hand falls into exactly one bucket) — verified as
  // an explicit invariant in test/stats.test.js, not just assumed to hold.
  const byDate = {};
  for (const h of allHands) {
    byDate[h.date] = byDate[h.date] || { hands: 0, net: 0, showdownNet: 0, nonShowdownNet: 0 };
    byDate[h.date].hands++;
    byDate[h.date].net += h.net;
    if (h.reachedShowdown) byDate[h.date].showdownNet += h.net;
    else byDate[h.date].nonShowdownNet += h.net;
  }
  const dates = Object.keys(byDate).sort();
  let cumulative = 0, cumulativeShowdown = 0, cumulativeNonShowdown = 0;
  const timeline = dates.map((date) => {
    cumulative += byDate[date].net;
    cumulativeShowdown += byDate[date].showdownNet;
    cumulativeNonShowdown += byDate[date].nonShowdownNet;
    return {
      date, hands: byDate[date].hands, net: byDate[date].net, cumulative,
      cumulativeShowdown, cumulativeNonShowdown,
    };
  });

  // A second, separate series — one point per HAND rather than per date,
  // for the Advanced Graph's x-axis specifically. A date with 5 hands and a
  // date with 2,000 hands take up the same horizontal space in the
  // date-based timeline above, which understates how much actually
  // happened on the busier day; hand-number resolution doesn't have that
  // distortion. The small chart on the Hands tab keeps using the per-date
  // `timeline` above, unchanged — this is additive, not a replacement.
  // Hands are sorted chronologically (date, then time) before building
  // this, since the order hands arrive in from the database query has no
  // guaranteed relationship to actual play order.
  const chronological = [...allHands].sort((a, b) => {
    const da = `${a.date || ''} ${a.time || ''}`;
    const dbb = `${b.date || ''} ${b.time || ''}`;
    return da < dbb ? -1 : da > dbb ? 1 : 0;
  });
  // A fourth parallel cumulative series — the EV-adjusted ("all-in equity
  // adjusted") line: each hand's actual net, replaced with what it was
  // worth at the equity the money went in with for the genuine all-in
  // hands evAdjustmentBB covers (see the evBb100 comment above), and left
  // as actual net for every other hand. h.net/h.bb + adjustment is the bb
  // delta bb100/evBb100 already use — multiplying back by h.bb converts it
  // to the same dollar units as `cumulative`, so this line overlays
  // directly on the other three on the Advanced Graph.
  let handCumulative = 0, handCumulativeShowdown = 0, handCumulativeNonShowdown = 0, handCumulativeEV = 0;
  const handTimeline = chronological.map((h, i) => {
    handCumulative += h.net;
    if (h.reachedShowdown) handCumulativeShowdown += h.net;
    else handCumulativeNonShowdown += h.net;
    const evNet = (h.net / h.bb + (h.evAdjustmentBB || 0)) * h.bb;
    handCumulativeEV += evNet;
    return {
      handNumber: i + 1, date: h.date, time: h.time, net: h.net,
      cumulative: handCumulative, cumulativeShowdown: handCumulativeShowdown,
      cumulativeNonShowdown: handCumulativeNonShowdown, cumulativeEV: handCumulativeEV,
    };
  });

  return {
    hands: n,
    bombPotHands: bombCount,
    nonBombPotHands: nonBomb.length,
    netResult: totalNet,
    totalRakePaid,
    bb100,
    evBb100,
    evAdjustedHandCount,
    vpip: pct(vpipCount, nonBomb.length),
    pfr: pct(pfrCount, nonBomb.length),
    rfi: pct(rfiCount, rfiOppCount),
    rfiOppCount,
    coldCall: pct(coldCallCount, coldCallOppCount),
    coldCallOppCount,
    limp: pct(limpCount, nonBomb.length),
    threeBet: pct(threeBetCount, threeBetOppCount),
    threeBetOppCount,
    foldToThreeBet: pct(foldToThreeBetCount, foldToThreeBetOppCount),
    foldToThreeBetOppCount,
    fourBet: pct(fourBetCount, fourBetOppCount),
    fourBetOppCount,
    foldToFourBet: pct(foldToFourBetCount, foldToFourBetOppCount),
    foldToFourBetOppCount,
    squeeze: pct(squeezeCount, squeezeOppCount),
    squeezeOppCount,
    attemptSteal: pct(stealCount, stealOppCount),
    stealOppCount,
    foldToSteal: pct(foldToStealCount, foldToStealOppCount),
    foldToStealOppCount,
    wtsd: pct(wtsdHands.length, sawFlopNonBomb.length),
    wonAtShowdown: pct(wonShowdownCount, wtsdHands.length),
    wonWhenSawFlop: pct(wonWhenSawFlopCount, sawFlopNonBomb.length),
    sawFlopPct: pct(sawFlopHands.length, n),
    aggressionFactor: totalPostflopCalls > 0 ? totalAggressive / totalPostflopCalls : null,
    flopAggression: flopAgg.pct,
    flopAggressionOpportunities: flopAgg.opportunities,
    flopAggPct: flopAgg.aggPct,
    flopAggPctOpportunities: flopAgg.aggPctOpportunities,
    turnAggression: turnAgg.pct,
    turnAggressionOpportunities: turnAgg.opportunities,
    turnAggPct: turnAgg.aggPct,
    turnAggPctOpportunities: turnAgg.aggPctOpportunities,
    riverAggression: riverAgg.pct,
    riverAggressionOpportunities: riverAgg.opportunities,
    riverAggPct: riverAgg.aggPct,
    riverAggPctOpportunities: riverAgg.aggPctOpportunities,
    flopCheckRaise: flopCR.pct,
    flopCheckRaiseOpportunities: flopCR.opportunities,
    turnCheckRaise: turnCR.pct,
    turnCheckRaiseOpportunities: turnCR.opportunities,
    riverCheckRaise: riverCR.pct,
    riverCheckRaiseOpportunities: riverCR.opportunities,
    flopCbet: flopCbet.pct,
    flopCbetOpportunities: flopCbet.opportunities,
    turnCbet: turnCbet.pct,
    turnCbetOpportunities: turnCbet.opportunities,
    riverCbet: riverCbet.pct,
    riverCbetOpportunities: riverCbet.opportunities,
    flopFoldToCbet: flopFoldToCbet.pct,
    flopFoldToCbetOpportunities: flopFoldToCbet.opportunities,
    turnFoldToCbet: turnFoldToCbet.pct,
    turnFoldToCbetOpportunities: turnFoldToCbet.opportunities,
    riverFoldToCbet: riverFoldToCbet.pct,
    riverFoldToCbetOpportunities: riverFoldToCbet.opportunities,
    flopFloat: flopFloat.pct,
    flopFloatOpportunities: flopFloat.opportunities,
    turnFloat: turnFloat.pct,
    turnFloatOpportunities: turnFloat.opportunities,
    riverFloat: riverFloat.pct,
    riverFloatOpportunities: riverFloat.opportunities,
    flopFoldToFloat: flopFoldToFloat.pct,
    flopFoldToFloatOpportunities: flopFoldToFloat.opportunities,
    turnFoldToFloat: turnFoldToFloat.pct,
    turnFoldToFloatOpportunities: turnFoldToFloat.opportunities,
    riverFoldToFloat: riverFoldToFloat.pct,
    riverFoldToFloatOpportunities: riverFoldToFloat.opportunities,
    turnProbe: turnProbe.pct,
    turnProbeOpportunities: turnProbe.opportunities,
    riverProbe: riverProbe.pct,
    riverProbeOpportunities: riverProbe.opportunities,
    turnFoldToProbe: turnFoldToProbe.pct,
    turnFoldToProbeOpportunities: turnFoldToProbe.opportunities,
    riverFoldToProbe: riverFoldToProbe.pct,
    riverFoldToProbeOpportunities: riverFoldToProbe.opportunities,
    doubleBarrel: pct(doubleBarrelCount, doubleBarrelOppCount),
    doubleBarrelOppCount,
    tripleBarrel: pct(tripleBarrelCount, tripleBarrelOppCount),
    tripleBarrelOppCount,
    byPosition,
    byStake,
    timeline,
    handTimeline,
  };
}

module.exports = { analyzeHand, analyzeFile, aggregateStats, positionLabelsFor, computeEffectiveButton, handCategoryFor };
