'use strict';

const { evaluateBest, compareRanks } = require('./handEvaluator');

const RANK_CHARS = '23456789TJQKA';
const SUITS = ['s', 'h', 'd', 'c'];

function fullDeck() {
  const deck = [];
  for (const r of RANK_CHARS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

function removeCards(deck, used) {
  const usedSet = new Set(used.map((c) => c.toLowerCase()));
  return deck.filter((c) => !usedSet.has(c.toLowerCase()));
}

function nChooseK(arr, k, cb) {
  const n = arr.length;
  const combo = new Array(k);
  (function rec(start, depth) {
    if (depth === k) { cb(combo); return; }
    for (let i = start; i <= n - (k - depth); i++) {
      combo[depth] = arr[i];
      rec(i + 1, depth + 1);
    }
  })(0, 0);
}

/**
 * Exact win/tie/loss enumeration for two known hands with a given (possibly
 * partial) board, enumerating every possible way the remaining cards could
 * complete. Only practical when few cards remain to come — see equity()
 * below for when this is used vs. Monte Carlo sampling.
 */
function exactEquity(handA, handB, board) {
  const cardsToCome = 5 - board.length;
  const deck = removeCards(fullDeck(), [...handA, ...handB, ...board]);
  let winA = 0, winB = 0, ties = 0, total = 0;

  if (cardsToCome === 0) {
    const rankA = evaluateBest([...handA, ...board]);
    const rankB = evaluateBest([...handB, ...board]);
    const cmp = compareRanks(rankA, rankB);
    return { equityA: cmp > 0 ? 1 : cmp < 0 ? 0 : 0.5, trials: 1, exact: true };
  }

  nChooseK(deck, cardsToCome, (fill) => {
    const fullBoard = board.concat(fill);
    const rankA = evaluateBest([...handA, ...fullBoard]);
    const rankB = evaluateBest([...handB, ...fullBoard]);
    const cmp = compareRanks(rankA, rankB);
    if (cmp > 0) winA++;
    else if (cmp < 0) winB++;
    else ties++;
    total++;
  });

  return { equityA: (winA + ties * 0.5) / total, trials: total, exact: true };
}

/**
 * Monte Carlo win/tie/loss estimate — random sampling instead of exhaustive
 * enumeration. Standard, well-established technique (this is how real
 * equity calculators handle the preflop case, where exact enumeration means
 * up to ~1.7 million board combinations per hand); with enough trials the
 * error is small and quantifiable. trials=20000 keeps the standard error
 * comfortably under 0.5 percentage points for any realistic equity split.
 */
function monteCarloEquity(handA, handB, board, trials) {
  const cardsToCome = 5 - board.length;
  const deck = removeCards(fullDeck(), [...handA, ...handB, ...board]);
  let winA = 0, winB = 0, ties = 0;

  for (let t = 0; t < trials; t++) {
    // Fisher-Yates partial shuffle: draw `cardsToCome` random cards without
    // replacement from the remaining deck for this trial.
    const pool = deck.slice();
    const fill = [];
    for (let i = 0; i < cardsToCome; i++) {
      const j = i + Math.floor(Math.random() * (pool.length - i));
      [pool[i], pool[j]] = [pool[j], pool[i]];
      fill.push(pool[i]);
    }
    const fullBoard = board.concat(fill);
    const rankA = evaluateBest([...handA, ...fullBoard]);
    const rankB = evaluateBest([...handB, ...fullBoard]);
    const cmp = compareRanks(rankA, rankB);
    if (cmp > 0) winA++;
    else if (cmp < 0) winB++;
    else ties++;
  }

  return { equityA: (winA + ties * 0.5) / trials, trials, exact: false };
}

// Exact enumeration is only used when it's cheap: 0 cards to come (board
// already complete — just a single comparison) or 1-2 cards to come (a
// river or turn all-in — at most ~1000 combinations). A preflop or flop
// all-in (5 or... actually only 5 ever occurs in practice, since a hand's
// board only ever has 0, 3, 4, or 5 known cards — see handReplay.js) uses
// Monte Carlo instead, since exact enumeration there means up to ~1.7
// million combinations, too slow to run for every such hand in a batch.
const EXACT_ENUMERATION_MAX_CARDS_TO_COME = 2;
// 10,000 trials keeps the standard error comfortably under ~0.4 percentage
// points for any realistic equity split, while keeping a full-batch import
// with dozens of qualifying hands (each needs its own Monte Carlo run,
// computed once at import time and cached — see handStore.js) to a
// reasonable one-time cost rather than growing unboundedly with sample size.
const DEFAULT_MONTE_CARLO_TRIALS = 10000;

/**
 * Computes hand A's equity (win probability, ties counted as half) against
 * hand B, given the board cards already known. Picks exact enumeration or
 * Monte Carlo automatically based on how many cards remain to come.
 */
function equity(handA, handB, board, options) {
  const opts = options || {};
  const cardsToCome = 5 - board.length;
  if (cardsToCome <= EXACT_ENUMERATION_MAX_CARDS_TO_COME) {
    return exactEquity(handA, handB, board);
  }
  return monteCarloEquity(handA, handB, board, opts.trials || DEFAULT_MONTE_CARLO_TRIALS);
}

module.exports = { equity, exactEquity, monteCarloEquity, fullDeck };
