'use strict';

/**
 * Weplay writes hand strength descriptions like:
 *   "a pair of Eights", "two pair, Kings and Nines", "three of a kind, Deuces",
 *   "a straight, Ten to Ace", "a flush, Ace high", "a full house, Fives full of Sevens",
 *   "high card King"
 *
 * CoinPoker (confirmed from a real sample export) just uses the bare category name,
 * Title Case, e.g. "One Pair", "Two Pair", "Three Of A Kind", "Straight", "Flush",
 * "Full House", "High Card".
 *
 * "Four Of A Kind", "Straight Flush" and "Royal Flush" were never seen in either
 * sample file, so those three mappings are inferred from the same naming pattern
 * rather than confirmed against real output.
 */

const RULES = [
  [/^a?\s*four of a kind/i, 'Four Of A Kind'],
  [/^a?\s*royal flush/i, 'Royal Flush'],
  [/^a?\s*straight flush/i, 'Straight Flush'],
  [/^a full house/i, 'Full House'],
  [/^a flush/i, 'Flush'],
  [/^a straight/i, 'Straight'],
  [/^three of a kind/i, 'Three Of A Kind'],
  [/^two pair/i, 'Two Pair'],
  [/^a pair/i, 'One Pair'],
  [/^high card/i, 'High Card'],
];

// Tracks any description we could not confidently classify, so the UI can warn
// the user instead of silently emitting something wrong.
function translateHandDescription(weplayDesc) {
  const desc = weplayDesc.trim();
  for (const [re, label] of RULES) {
    if (re.test(desc)) {
      const inferred = /^a?\s*four of a kind|^a?\s*royal flush|^a?\s*straight flush/i.test(desc);
      return { label, inferred };
    }
  }
  return { label: null, inferred: false };
}

module.exports = { translateHandDescription };
