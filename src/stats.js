'use strict';

const { splitHands } = require('./converter');

// ── Regexes ──────────────────────────────────────────────────────────────
// Deliberately independent from converter.js's regexes: this module reads
// raw Weplay text for analysis, not for producing CoinPoker output, so it
// doesn't need the FIRST/SECOND run-it-twice bookkeeping or any of the
// output-formatting concerns. Where a real Weplay quirk affects parsing
// (multi-word usernames, "and is all-in" suffixes, single-digit hours) the
// same fixes already proven in converter.js are mirrored here.

const RE_HEADER = /^Weplay Hand #(\d+):\s+Hold'em No Limit \(\$([0-9.]+)\/\$([0-9.]+)\)\s+-\s+(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2})/;
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
const RE_SHOWS = /^(.+?): shows \[(.*?)\] \((.+?)\)$/;
// Same guard used in src/handReplay.js's showdown detection — excludes the
// known Weplay quirk where a folded/losing player's cards get shown as
// redacted placeholders (e.g. "[]" or "[## 5c]") rather than real cards.
// Kept in sync deliberately: these two modules independently detect "were
// this player's cards genuinely shown", and a real discrepancy between them
// (this exact check being present in one but not the other) was found and
// fixed while wiring up the Advanced Graph's showdown/non-showdown split.
function hasValidCards(str) {
  return /^[2-9TJQKA][cdhs](\s+[2-9TJQKA][cdhs])*$/i.test((str || '').trim());
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

  let position = null;
  if (occupiedSeatNums.includes(effectiveButton)) {
    const btnIdx = occupiedSeatNums.indexOf(effectiveButton);
    const n = occupiedSeatNums.length;
    const order = []; // seat numbers starting right after the button (SB) around to the button itself
    for (let i = 1; i <= n; i++) order.push(occupiedSeatNums[(btnIdx + i) % n]);
    const labels = positionLabelsFor(n);
    const heroSeat = seats.find((s) => s.name === hero);
    const idx = order.indexOf(heroSeat.num);
    if (idx !== -1) position = labels[idx];
  }

  let street = 'PREFLOP';
  let contributed = 0;
  let collected = 0;
  let anyCollected = false;
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
  // Distinct from reachedShowdown: a hand can structurally reach a genuine
  // showdown and still have hero muck without revealing (very common when
  // hero has the losing hand — no reason to show a loser). Confirmed as a
  // real, meaningful difference against real data: 1512 hands reach a
  // genuine showdown, but hero's cards are only literally shown in 1232 of
  // them — 312 real cases, essentially all losses where hero mucked.
  let heroCardsShown = false;
  let inHandThisFar = true;
  let postflopAggressive = 0; // hero's bets + raises, flop/turn/river
  let postflopCalls = 0;
  // Per-street aggression uses Aggression Frequency (AFq): (bets+raises) /
  // (bets+raises+calls+folds), checks excluded from the denominator. This
  // app briefly switched to DriveHUD's "Agg%" (checks included) after an
  // investigation into why numbers looked high, but AFq is what
  // PokerTracker itself documents and is the dominant, most consistently
  // documented convention across independent sources (PokerTracker's own
  // forum, Upswing Poker, poker terminology glossaries, community
  // discussion) — reverted back to it per explicit instruction. Checks are
  // still tracked below (streetAgg[street].checks) since other call sites
  // may want the raw count, but they no longer count toward the
  // opportunities denominator — see streetAggPct() in aggregateStats.
  const streetAgg = {
    FLOP: { agg: 0, calls: 0, folds: 0, checks: 0 },
    TURN: { agg: 0, calls: 0, folds: 0, checks: 0 },
    RIVER: { agg: 0, calls: 0, folds: 0, checks: 0 },
  };
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
      if (name === 'FLOP') { street = 'FLOP'; if (inHandThisFar) sawFlop = true; }
      else if (name === 'TURN') street = 'TURN';
      else if (name === 'RIVER') street = 'RIVER';
      else if (name === 'SHOW DOWN') {
        street = 'SHOWDOWN';
        if (inHandThisFar && activePlayers.has(hero) && activePlayers.size >= 2) reachedShowdown = true;
      }
      continue;
    }

    let m;
    if ((m = RE_ANTE.exec(l)) && m[1] === hero) { contributed += parseFloat(m[2]); continue; }
    if ((m = RE_SB.exec(l)) && m[1] === hero) { contributed += parseFloat(m[2]); continue; }
    if ((m = RE_BB.exec(l)) && m[1] === hero) { contributed += parseFloat(m[2]); continue; }
    if ((m = RE_SHOWS.exec(l)) && m[1] === hero && hasValidCards(m[2])) { heroCardsShown = true; continue; }

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
        if (street === 'PREFLOP' && preflopRaiseCount === 1) facedThreeBetOpportunity = true;
        if (street === 'PREFLOP' && preflopRaiseCount === 2) facedFourBetOpportunity = true;
        inHandThisFar = false;
        if (street === 'PREFLOP') { heroLastPreflopAction = { type: 'fold', level: preflopRaiseCount }; }
        if (street === 'PREFLOP' && facedThreeBetAfterOpening) foldedToThreeBet = true;
        if (street === 'PREFLOP' && facedFourBetAfterThreeBetting) foldedToFourBet = true;
        if (streetAgg[street]) streetAgg[street].folds++;
      }
      activePlayers.delete(who);
      continue;
    }
    if ((m = RE_CHECK.exec(l))) {
      if (m[1] === hero && streetAgg[street]) streetAgg[street].checks++;
      continue;
    }

    if ((m = RE_CALL.exec(l))) {
      const who = m[1];
      if (who === hero) {
        noteHeroFirstPreflopDecision();
        if (street === 'PREFLOP' && preflopRaiseCount === 1) {
          facedThreeBetOpportunity = true;
          // Cold call: calling the opening raise with zero money already
          // invested (see coldCallOpportunity's declaration for why).
          if (contributed === 0) { coldCallOpportunity = true; coldCall = true; }
        }
        if (street === 'PREFLOP' && preflopRaiseCount === 0) limped = true;
        if (street === 'PREFLOP' && preflopRaiseCount === 2) facedFourBetOpportunity = true;
        contributed += parseFloat(m[2]);
        if (street === 'PREFLOP') { voluntaryPreflopAction = true; heroLastPreflopAction = { type: 'call', level: preflopRaiseCount }; }
        else { postflopCalls++; if (streetAgg[street]) streetAgg[street].calls++; }
        if (street === 'PREFLOP' && facedThreeBetAfterOpening) facedThreeBetAfterOpening = false; // called it, didn't fold
        if (street === 'PREFLOP' && facedFourBetAfterThreeBetting) facedFourBetAfterThreeBetting = false; // called it, didn't fold
      }
      // Tracks whether ANY player (not just hero) has voluntarily entered
      // the pot yet — feeds RFI opportunity detection above, so this has to
      // fire regardless of who made the call.
      if (street === 'PREFLOP') anyVoluntaryPreflopAction = true;
      continue;
    }
    if ((m = RE_BET.exec(l))) {
      const who = m[1];
      if (who === hero) {
        contributed += parseFloat(m[2]);
        if (street === 'PREFLOP') { voluntaryPreflopAction = true; preflopRaise = true; }
        else { postflopAggressive++; if (streetAgg[street]) streetAgg[street].agg++; }
      }
      continue;
    }
    if ((m = RE_RAISE.exec(l))) {
      const who = m[1];
      const amt = parseFloat(m[2]);
      if (who === hero) {
        // Hero's first preflop decision, and it's a raise into a still-fully-
        // unopened pot — exactly RFI (as opposed to PFR generally, which
        // also counts isolates/3-bets/4-bets over an already-opened pot).
        if (noteHeroFirstPreflopDecision()) rfi = true;
        if (street === 'PREFLOP' && preflopRaiseCount === 1) { facedThreeBetOpportunity = true; madeThreeBet = true; }
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
      if (street === 'PREFLOP') { anyVoluntaryPreflopAction = true; preflopRaiseCount++; }
      continue;
    }
    if ((m = RE_UNCALLED.exec(l)) && m[2] === hero) { contributed -= parseFloat(m[1]); continue; }
    if ((m = RE_COLLECTED.exec(l)) && m[1] === hero) { collected += parseFloat(m[2]); anyCollected = true; continue; }
  }

  // A hand with no resolution anywhere (a real Weplay data gap — e.g. a
  // disconnect at showdown that's never resolved) can't be attributed a
  // result, so exclude it entirely rather than silently treat it as a $0
  // hand — this mirrors the converter's own skip condition for the same case.
  let hasResolution = false;
  for (const l of lines) { if (RE_COLLECTED.test(l)) { hasResolution = true; break; } }
  if (!hasResolution) return null;

  return {
    handId, bb, date: `${y}-${mo}-${d}`, time: `${hh.padStart(2, '0')}:${mm}:${ss}`, maxSeats,
    position, isBombPot,
    net: collected - contributed,
    vpip: voluntaryPreflopAction,
    pfr: preflopRaise,
    rfiOpportunity,
    rfi,
    coldCallOpportunity,
    coldCall,
    limped,
    threeBet: madeThreeBet,
    facedThreeBetOpportunity,
    foldedToThreeBet,
    hadThreeBetOpportunityAfterOpening,
    fourBet: madeFourBet,
    facedFourBetOpportunity,
    foldedToFourBet,
    hadFourBetOpportunityAfterThreeBetting,
    handCategory: handCategoryFor(preflopRaiseCount, heroLastPreflopAction),
    sawFlop,
    reachedShowdown,
    heroCardsShown,
    wonAtShowdown: reachedShowdown && anyCollected,
    wonWhenSawFlop: sawFlop && collected - contributed > 0,
    postflopAggressive,
    postflopCalls,
    streetAgg,
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
  const bbWon = sum(allHands, (h) => h.net / h.bb);
  const bb100 = n > 0 ? (bbWon / n) * 100 : null;

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

  const sawFlopHands = allHands.filter((h) => h.sawFlop);
  // WTSD%: (times reached a genuine showdown) / (times saw the flop) —
  // PokerTracker's own convention. This was also a bug here — it divided by
  // every hand dealt instead of just the ones that saw a flop, which made
  // the rate look far lower than it really was (most hands never see a flop
  // at all, so they were never real showdown candidates to begin with).
  const wtsdHands = allHands.filter((h) => h.reachedShowdown);
  const wonShowdownCount = allHands.filter((h) => h.wonAtShowdown).length;
  const wonWhenSawFlopCount = sawFlopHands.filter((h) => h.wonWhenSawFlop).length;

  const totalAggressive = sum(allHands, (h) => h.postflopAggressive);
  const totalPostflopCalls = sum(allHands, (h) => h.postflopCalls);

  // Per-street Aggression Frequency (AFq, PokerTracker's convention) —
  // bets+raises over bets+raises+calls+folds, checks excluded from the
  // denominator. See analyzeHand's streetAgg comment for why this is the
  // formula in use, and how it's a different question from the aggregate
  // Aggression Factor above (a ratio, not a frequency). Summed the same
  // way everything else here is: across every hand, not just hands that
  // reached that street (a hand that folded preflop contributes zero to
  // every street's numbers, exactly as it should — it never had a flop
  // decision to be aggressive or passive about).
  function streetAggPct(streetKey) {
    let agg = 0, calls = 0, folds = 0;
    for (const h of allHands) {
      if (!h.streetAgg) continue;
      agg += h.streetAgg[streetKey].agg;
      calls += h.streetAgg[streetKey].calls;
      folds += h.streetAgg[streetKey].folds;
    }
    const opportunities = agg + calls + folds;
    return { pct: opportunities > 0 ? (agg / opportunities) * 100 : null, opportunities };
  }
  const flopAgg = streetAggPct('FLOP');
  const turnAgg = streetAggPct('TURN');
  const riverAgg = streetAggPct('RIVER');

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

  // By stake (big blind size).
  const byStake = {};
  for (const h of allHands) {
    const key = h.bb;
    byStake[key] = byStake[key] || { hands: 0, net: 0 };
    byStake[key].hands++;
    byStake[key].net += h.net;
  }

  // Results over time (by date) — tracked as three parallel cumulative
  // series: the total (unchanged from before), and a split by whether
  // hero's cards were literally shown at showdown. Deliberately uses
  // heroCardsShown here, NOT reachedShowdown — those are genuinely
  // different things (reachedShowdown, used for WTSD% above, is the
  // standard poker-tracking definition: did the hand structurally reach a
  // real 2+-way contest, regardless of whether hero's own cards ended up
  // revealed; a hand can reach a real showdown and still have hero muck a
  // loser without showing it, which is common and not a bug — confirmed
  // against real data: 1512 hands reach a genuine showdown, but only 1232
  // of them have hero's cards actually shown). For this specific split —
  // "does hero's result come from hands where their cards were shown, or
  // not" — the literal signal is the one that actually answers that
  // question. showdownNet + nonShowdownNet always equals net for every
  // date, by construction (every hand falls into exactly one bucket) —
  // verified as an explicit invariant in test/stats.test.js, not just
  // assumed to hold.
  const byDate = {};
  for (const h of allHands) {
    byDate[h.date] = byDate[h.date] || { hands: 0, net: 0, showdownNet: 0, nonShowdownNet: 0 };
    byDate[h.date].hands++;
    byDate[h.date].net += h.net;
    if (h.heroCardsShown) byDate[h.date].showdownNet += h.net;
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
  let handCumulative = 0, handCumulativeShowdown = 0, handCumulativeNonShowdown = 0;
  const handTimeline = chronological.map((h, i) => {
    handCumulative += h.net;
    if (h.heroCardsShown) handCumulativeShowdown += h.net;
    else handCumulativeNonShowdown += h.net;
    return {
      handNumber: i + 1, date: h.date, time: h.time, net: h.net,
      cumulative: handCumulative, cumulativeShowdown: handCumulativeShowdown,
      cumulativeNonShowdown: handCumulativeNonShowdown,
    };
  });

  return {
    hands: n,
    bombPotHands: bombCount,
    nonBombPotHands: nonBomb.length,
    netResult: totalNet,
    bb100,
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
    wtsd: pct(wtsdHands.length, sawFlopHands.length),
    wonAtShowdown: pct(wonShowdownCount, wtsdHands.length),
    wonWhenSawFlop: pct(wonWhenSawFlopCount, sawFlopHands.length),
    sawFlopPct: pct(sawFlopHands.length, n),
    aggressionFactor: totalPostflopCalls > 0 ? totalAggressive / totalPostflopCalls : null,
    flopAggression: flopAgg.pct,
    flopAggressionOpportunities: flopAgg.opportunities,
    turnAggression: turnAgg.pct,
    turnAggressionOpportunities: turnAgg.opportunities,
    riverAggression: riverAgg.pct,
    riverAggressionOpportunities: riverAgg.opportunities,
    byPosition,
    byStake,
    timeline,
    handTimeline,
  };
}

module.exports = { analyzeHand, analyzeFile, aggregateStats, positionLabelsFor, computeEffectiveButton, handCategoryFor };
