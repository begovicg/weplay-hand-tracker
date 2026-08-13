'use strict';

// Standard poker hand evaluator: ranks any 5-card hand into a comparable
// value, and finds the best 5-card hand out of up to 7 cards (2 hole + 5
// board). No shortcuts or lookup tables — a direct, straightforward
// category + kicker encoding, verified against known hand comparisons and
// well-established preflop equity benchmarks in the test suite. Correctness
// matters far more than raw speed here (this runs at most a few times per
// hand, only for hands that reach a genuine all-in), so a lookup-table-based
// evaluator (the kind real-time solvers use) would be solving a performance
// problem this app doesn't actually have.

const RANK_CHARS = '23456789TJQKA';

function rankOf(card) {
  return RANK_CHARS.indexOf(card[0].toUpperCase());
}
function suitOf(card) {
  return card[card.length - 1].toLowerCase();
}

// Category numbers, higher is better — matches standard poker hand ranking.
const HIGH_CARD = 0, ONE_PAIR = 1, TWO_PAIR = 2, TRIPS = 3, STRAIGHT = 4,
  FLUSH = 5, FULL_HOUSE = 6, QUADS = 7, STRAIGHT_FLUSH = 8;

/**
 * Ranks exactly 5 cards. Returns an array [category, tiebreak1, tiebreak2, ...]
 * — compare two such arrays element-by-element (first difference wins) to
 * compare hands. Higher category, then higher tiebreakers, wins.
 */
function evaluate5(cards) {
  const ranks = new Array(5);
  for (let i = 0; i < 5; i++) ranks[i] = rankOf(cards[i]);
  ranks.sort((a, b) => b - a); // descending

  const firstSuit = suitOf(cards[0]);
  let isFlush = true;
  for (let i = 1; i < 5; i++) {
    if (suitOf(cards[i]) !== firstSuit) { isFlush = false; break; }
  }

  // Plain fixed-size array instead of a Map — ranks only ever run 0-12, and
  // this function runs in the hot path of Monte Carlo equity sampling
  // (hundreds of thousands of calls per hand), so avoiding Map allocation
  // overhead here measurably matters. Verified to produce identical results
  // to the original Map-based version via the full test suite.
  const countByRank = new Array(13).fill(0);
  for (let i = 0; i < 5; i++) countByRank[ranks[i]]++;
  const groups = [];
  for (let r = 12; r >= 0; r--) {
    if (countByRank[r] > 0) groups.push({ r, c: countByRank[r] });
  }
  groups.sort((a, b) => (b.c - a.c) || (b.r - a.r));

  const uniqueDesc = [...new Set(ranks)];
  let isStraight = false;
  let straightHigh = -1;
  if (uniqueDesc.length === 5) {
    if (uniqueDesc[0] - uniqueDesc[4] === 4) {
      isStraight = true;
      straightHigh = uniqueDesc[0];
    } else if (uniqueDesc.join(',') === '12,3,2,1,0') {
      // The wheel: A-2-3-4-5. Ace plays low; the straight's "high card" for
      // ranking purposes is the 5 (rank index 3).
      isStraight = true;
      straightHigh = 3;
    }
  }

  if (isStraight && isFlush) return [STRAIGHT_FLUSH, straightHigh];
  if (groups[0].c === 4) return [QUADS, groups[0].r, groups[1].r];
  if (groups[0].c === 3 && groups[1].c === 2) return [FULL_HOUSE, groups[0].r, groups[1].r];
  if (isFlush) return [FLUSH, ...ranks];
  if (isStraight) return [STRAIGHT, straightHigh];
  if (groups[0].c === 3) return [TRIPS, groups[0].r, groups[1].r, groups[2].r];
  if (groups[0].c === 2 && groups[1].c === 2) {
    const hi = Math.max(groups[0].r, groups[1].r);
    const lo = Math.min(groups[0].r, groups[1].r);
    return [TWO_PAIR, hi, lo, groups[2].r];
  }
  if (groups[0].c === 2) return [ONE_PAIR, groups[0].r, groups[1].r, groups[2].r, groups[3].r];
  return [HIGH_CARD, ...ranks];
}

function compareRanks(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] == null ? -1 : a[i];
    const bv = b[i] == null ? -1 : b[i];
    if (av !== bv) return av - bv;
  }
  return 0;
}

function combinations5(cards) {
  // All 5-card subsets of the given card array (used for 6 or 7 cards).
  const n = cards.length;
  if (n === 5) return [cards.slice()];
  if (n === 7) {
    // The hot path for equity sampling is always exactly 7 cards (2 hole +
    // 5 board) — a precomputed index table avoids the recursive generator's
    // overhead (closures, repeated array spreads) for the case that
    // actually matters for speed, without changing the result at all.
    const result = new Array(SEVEN_CHOOSE_FIVE_INDICES.length);
    for (let i = 0; i < SEVEN_CHOOSE_FIVE_INDICES.length; i++) {
      const idxs = SEVEN_CHOOSE_FIVE_INDICES[i];
      result[i] = [cards[idxs[0]], cards[idxs[1]], cards[idxs[2]], cards[idxs[3]], cards[idxs[4]]];
    }
    return result;
  }
  const result = [];
  const combo = (start, chosen) => {
    if (chosen.length === 5) { result.push(chosen.map((i) => cards[i])); return; }
    for (let i = start; i < n; i++) combo(i + 1, [...chosen, i]);
  };
  combo(0, []);
  return result;
}

const SEVEN_CHOOSE_FIVE_INDICES = (() => {
  const idxs = [];
  for (let a = 0; a < 7; a++)
    for (let b = a + 1; b < 7; b++)
      for (let c = b + 1; c < 7; c++)
        for (let d = c + 1; d < 7; d++)
          for (let e = d + 1; e < 7; e++)
            idxs.push([a, b, c, d, e]);
  return idxs;
})();

/**
 * Finds the best possible 5-card hand rank out of 5, 6, or 7 given cards.
 * Returns the same [category, ...tiebreakers] shape as evaluate5.
 */
function evaluateBest(cards) {
  if (cards.length < 5) throw new Error('evaluateBest needs at least 5 cards');
  if (cards.length === 5) return evaluate5(cards);
  let best = null;
  for (const combo of combinations5(cards)) {
    const rank = evaluate5(combo);
    if (best === null || compareRanks(rank, best) > 0) best = rank;
  }
  return best;
}

const CATEGORY_NAMES = ['High Card', 'One Pair', 'Two Pair', 'Three of a Kind', 'Straight', 'Flush', 'Full House', 'Four of a Kind', 'Straight Flush'];
function categoryName(rank) {
  return CATEGORY_NAMES[rank[0]];
}

module.exports = { evaluate5, evaluateBest, compareRanks, categoryName, rankOf, suitOf };
