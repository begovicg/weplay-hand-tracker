'use strict';

const { buildHandReplay } = require('./handReplay');
const { equity } = require('./equity');

/**
 * Finds the "all-in point" in a hand, if one exists: the earliest street
 * after which every remaining street has zero actions — i.e. both players'
 * money was fully committed and everything from there on was pure card
 * dealing, not decisions. Requires a genuine 2-player showdown (both hands
 * known — equity can't be computed for a hand nobody revealed), and
 * deliberately excludes run-it-twice hands (those already resolve their own
 * variance by dealing twice — computing a further "EV adjustment" on top
 * would double-count that) and situations where betting closed exactly on
 * the river (no cards left to come, so no run-out variance to adjust for
 * even though it was technically an all-in).
 *
 * Deliberately NOT anchored to hero: replay.showdown already lists whoever
 * actually showed their hand, for any seated player, regardless of who this
 * particular import's "hero" was — an all-in between two other players
 * (hero folded earlier, or wasn't even dealt into the pot) qualifies exactly
 * the same way an all-in involving hero does. An earlier version of this
 * function required one of the two showdown entries to be isHero, which
 * meant every all-in NOT involving hero was silently skipped — the entire
 * hand kept its actual result for BOTH players, even though both hands were
 * fully known and the same equity math applied. That's why, before this
 * fix, a non-hero player's EV winrate barely differed from their actual
 * winrate: only their all-ins against hero specifically were ever adjusted.
 *
 * Scope: two players only. A 3+-way all-in needs per-opponent side-pot
 * equity math (each player's equity depends on exactly who they're
 * contesting which pot with) that this doesn't attempt yet — such hands
 * return null and simply keep their actual result in the EV total.
 */
function findAllInSpot(replay) {
  if (!replay || replay.isRunTwice) return null;
  if (replay.showdown.length !== 2) return null;
  const [entryA, entryB] = replay.showdown;

  const streetOrder = ['flop', 'turn', 'river'];
  const streetsPresent = streetOrder.filter((s) => replay.streets[s]);

  let allInBeforeIndex = -1; // index into streetsPresent where the runout begins; -1 = no such point found
  for (let i = streetsPresent.length - 1; i >= 0; i--) {
    const s = replay.streets[streetsPresent[i]];
    if (s.actions.length === 0) allInBeforeIndex = i;
    else break;
  }
  if (allInBeforeIndex === -1) return null; // every street had a real decision — no all-in runout

  const knownBoard = [];
  for (let i = 0; i < allInBeforeIndex; i++) knownBoard.push(...replay.streets[streetsPresent[i]].board);
  if (5 - knownBoard.length === 0) return null; // betting closed exactly on the river — no runout variance

  return {
    aName: entryA.name,
    aCards: entryA.cards.split(/\s+/),
    bName: entryB.name,
    bCards: entryB.cards.split(/\s+/),
    knownBoard,
  };
}

/**
 * Computes the EV adjustment (in big blinds) for one hand, if it qualifies.
 * Returns null if this hand isn't an EV-adjustable spot at all (most hands
 * — anything short of a genuine 2-player all-in-with-cards-to-come).
 * Symmetric and hero-agnostic (see findAllInSpot above for why): the
 * `players` array always has exactly the two participants of that all-in,
 * whoever they are, each with their own adjustmentBB — how many BB to add
 * to THEIR actual result to get THEIR EV result. Positive means that player
 * ran worse than their equity, negative means better. The two are always
 * exact negations of each other — not an approximation, since the pot at
 * the all-in point is fully claimed between exactly these two players
 * (equityA + equityB == 1 by construction, see equity.js), so
 * aEVBB + bEVBB == potBB == aActualBB + bActualBB.
 */
function computeHandEVAdjustment(rawBlock, heroNameOverride, options) {
  // Cheap pre-filter before the expensive full parse: every all-in action is
  // marked with this exact suffix in the source (confirmed throughout this
  // whole project), so a hand that never mentions it can't possibly qualify.
  // This alone skips ~88% of hands in a real batch without ever running
  // buildHandReplay on them.
  if (!rawBlock.includes('and is all-in')) return null;

  const replay = buildHandReplay(rawBlock, heroNameOverride);
  const spot = findAllInSpot(replay);
  if (!spot) return null;

  const bbMatch = /\$([0-9.]+)$/.exec(replay.stakesLabel);
  const bb = bbMatch ? parseFloat(bbMatch[1]) : null;
  if (!bb) return null;

  const eq = equity(spot.aCards, spot.bCards, spot.knownBoard, options);
  const potBB = replay.winners.reduce((s, w) => s + w.amountBB, 0);
  const aActualBB = (replay.winners.find((w) => w.name === spot.aName) || { amountBB: 0 }).amountBB;
  const bActualBB = (replay.winners.find((w) => w.name === spot.bName) || { amountBB: 0 }).amountBB;
  const aEVBB = eq.equityA * potBB;
  const bEVBB = potBB - aEVBB;

  return {
    handId: replay.handId,
    potBB,
    exact: eq.exact,
    players: [
      { name: spot.aName, equity: eq.equityA, adjustmentBB: aEVBB - aActualBB },
      { name: spot.bName, equity: 1 - eq.equityA, adjustmentBB: bEVBB - bActualBB },
    ],
  };
}

module.exports = { findAllInSpot, computeHandEVAdjustment };
