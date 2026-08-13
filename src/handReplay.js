'use strict';

const { positionLabelsFor, computeEffectiveButton } = require('./stats');
const { translateHandDescription } = require('./handDescriptions');

// ── Regexes ──────────────────────────────────────────────────────────────
// Deliberately independent from converter.js/stats.js (matching this
// project's existing pattern of self-contained modules), but every real
// Weplay quirk found and fixed elsewhere in this app is mirrored here:
// single-digit hours, "and is all-in" suffixes, multi-word usernames (action
// lines are safe as-is since ": <verb>" is an unambiguous delimiter — the
// tricky case was only ever the summary section, which this module doesn't
// need to parse at all), redacted/empty shown cards, duplicate HOLE CARDS
// blocks, run-it-twice's inconsistent FIRST-labeling, and multi-tier side
// pots.

const RE_HEADER = /^Weplay Hand #(\d+):\s+Hold'em No Limit \(\$([0-9.]+)\/\$([0-9.]+)\)\s+-\s+(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2})/;
const RE_TABLE = /^Table '(.+?)'\((\d+)\)\s+(\d+)-max(?:\s+\(([^)]*)\))?\s+Seat #(\d+) is the button$/;
const RE_SEAT = /^Seat (\d+): (.+?) \(\$([0-9.]+) in chips\)$/;
const RE_ANTE = /^(.+?): posts the ante \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_SB = /^(.+?): posts small blind \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_BB = /^(.+?): posts big blind \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_DEALT = /^Dealt to (.+?)(?: \[(.+?)\])?$/;
const RE_STREET = /^\*\*\* (?:(FIRST|SECOND) )?(HOLE CARDS|FLOP|TURN|RIVER|SHOW DOWN|SUMMARY) \*\*\*(?: \[(.+?)\])?(?: \[(.+?)\])?$/;
const RE_FOLD = /^(.+?): folds$/;
const RE_CHECK = /^(.+?): checks$/;
const RE_CALL = /^(.+?): calls \$([0-9.]+)(\s+and is all-in)?$/;
const RE_BET = /^(.+?): bets \$([0-9.]+)(\s+and is all-in)?$/;
const RE_RAISE = /^(.+?): raises \$([0-9.]+) to \$([0-9.]+)(\s+and is all-in)?$/;
const RE_UNCALLED = /^Uncalled bet \(\$([0-9.]+)\) returned to (.+)$/;
const RE_COLLECTED = /^(.+?) collected \$([0-9.]+) from (pot|main pot|side pot(?:-\d+)?)$/;
const RE_SHOWS = /^(.+?): shows \[(.*?)\] \((.+?)\)$/;
const RE_MUCKS = /^(.+?): mucks hand$/;
const RE_TOTAL_POT = /^Total pot \$([0-9.]+)(?:\s+Main pot \$([0-9.]+)\.((?:\s+Side pot(?:-\d+)? \$[0-9.]+\.)*))?\s*\|\s*Rake \$([0-9.]+)\s*$/;

function hasValidCards(str) {
  return /^[2-9TJQKA][cdhs](\s+[2-9TJQKA][cdhs])*$/i.test((str || '').trim());
}

function centsOf(str) {
  return Math.round(parseFloat(str) * 100);
}

// Proportional rake distribution across every pot tier a player collected
// from — the model confirmed correct against real data (a "main pot only"
// model was proven impossible by a real hand where rake exceeded the entire
// main pot). Duplicated here rather than imported so this module has no
// dependency on converter.js's internals, matching the project's existing
// self-contained-module pattern.
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

function bbRound(cents, bbCents) {
  return Math.round((cents / bbCents) * 100) / 100;
}

/**
 * Builds a full, PokerTracker-style structured replay of one raw Weplay hand:
 * players with position and starting stack (in BB), antes/blinds, hole cards,
 * every street with the pot size and player count at the start of that
 * street, action-by-action, showdown, and net winnings per winner (already
 * rake-adjusted, matching the same proportional model used everywhere else
 * in this app). Returns null if the hand can't be parsed at all, or has no
 * resolution anywhere in the source (the same "genuinely corrupted hand"
 * case the converter and stats engine both already treat as unusable).
 */
function buildHandReplay(rawBlock, heroNameOverride) {
  const lines = rawBlock.split('\n').map((l) => l.replace(/\r$/, ''));
  const header = RE_HEADER.exec(lines[0] || '');
  if (!header) return null;
  const [, handId, sbStake, bbStake, y, mo, d, hh, mm, ss] = header;
  const bbCents = centsOf(bbStake);
  if (bbCents <= 0) return null;

  let tableName = null, maxSeats = null, statedButton = null;
  for (const l of lines) {
    const tm = RE_TABLE.exec(l);
    if (tm) { tableName = tm[1]; maxSeats = parseInt(tm[3], 10); statedButton = parseInt(tm[5], 10); break; }
  }

  const seatList = [];
  for (const l of lines) {
    const m = RE_SEAT.exec(l);
    if (m) seatList.push({ num: parseInt(m[1], 10), name: m[2], stackCents: centsOf(m[3]) });
  }
  if (seatList.length === 0) return null;

  let hero = heroNameOverride;
  let heroCards = null;
  for (const l of lines) {
    const m = RE_DEALT.exec(l);
    if (m && m[2]) { if (!hero) hero = m[1]; if (m[1] === hero) heroCards = m[2]; break; }
  }

  // Antes / blinds
  const antes = [];
  let sbEntry = null, bbEntry = null;
  for (const l of lines) {
    let m;
    if ((m = RE_ANTE.exec(l))) { antes.push({ name: m[1], cents: centsOf(m[2]) }); continue; }
    if ((m = RE_SB.exec(l)) && !sbEntry) { sbEntry = { name: m[1], cents: centsOf(m[2]) }; continue; }
    if ((m = RE_BB.exec(l)) && !bbEntry) { bbEntry = { name: m[1], cents: centsOf(m[2]) }; continue; }
  }
  const isBombPot = !sbEntry && !bbEntry;

  // Position labeling — reuses the same logic already confirmed correct
  // against real data in the stats engine, including the vacant-button
  // ("dead button") reassignment.
  const occupiedSeatNums = seatList.map((s) => s.num).sort((a, b) => a - b);
  const sbSeatObj = sbEntry ? seatList.find((s) => s.name === sbEntry.name) : null;
  const effectiveButton = computeEffectiveButton(occupiedSeatNums, sbSeatObj ? sbSeatObj.num : null, statedButton);
  let positionByName = {};
  if (occupiedSeatNums.includes(effectiveButton)) {
    const btnIdx = occupiedSeatNums.indexOf(effectiveButton);
    const n = occupiedSeatNums.length;
    const order = [];
    for (let i = 1; i <= n; i++) order.push(occupiedSeatNums[(btnIdx + i) % n]);
    const labels = positionLabelsFor(n);
    order.forEach((seatNum, idx) => {
      const seat = seatList.find((s) => s.num === seatNum);
      if (seat) positionByName[seat.name] = labels[idx];
    });
  }

  const players = seatList.map((s) => ({
    name: s.name,
    seat: s.num,
    position: positionByName[s.name] || '—',
    stackBB: bbRound(s.stackCents, bbCents),
    isHero: s.name === hero,
  }));

  // ── Simulate the hand, tracking pot size and active players as we go ────
  let pot = antes.reduce((s, a) => s + a.cents, 0) + (sbEntry ? sbEntry.cents : 0) + (bbEntry ? bbEntry.cents : 0);
  const active = new Set(seatList.map((s) => s.name));
  const isRunTwice = /\*\*\* SECOND (FLOP|TURN|RIVER) \*\*\*/i.test(rawBlock);

  function fmtAction(name, verb, cents, allin) {
    const bb = bbRound(cents, bbCents);
    const suffix = allin ? ' and is all-in' : '';
    if (verb === 'calls') return `${name} calls ${bb} BB${suffix}`;
    if (verb === 'bets') return `${name} bets ${bb} BB${suffix}`;
    if (verb === 'raises') return `${name} raises to ${bb} BB${suffix}`;
    return `${name} ${verb}`;
  }

  const preflopActions = [];
  const streets = { flop: null, turn: null, river: null };
  let currentStreetActions = preflopActions;
  // First-run and second-run streets are collected in order as we walk, then
  // reconciled afterward — the same general approach already proven correct
  // in converter.js's run-it-twice handling, including the rare real case
  // where the boards actually diverge at the flop (an all-in preflop),
  // not just the common case of diverging at the turn.
  const firstStreetEntries = []; // { name, cards, potBB, players, actions }
  const secondStreetEntries = [];

  let i = 0;
  // Skip past header/table/seat/ante/blind lines already consumed above.
  while (i < lines.length && !/^\*\*\* HOLE CARDS \*\*\*$/.test(lines[i])) i++;
  i++; // past the HOLE CARDS header
  while (i < lines.length && RE_DEALT.test(lines[i])) i++; // past the Dealt-to block

  const showdownLines = [];
  let inShowdown = false;
  let inSummary = false;
  let totalPotLine = null;

  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;

    const sm = RE_STREET.exec(l);
    if (sm) {
      const isSecond = sm[1] === 'SECOND';
      const name = sm[2];
      if (name === 'SHOW DOWN') { inShowdown = true; continue; }
      if (name === 'SUMMARY') { inShowdown = false; inSummary = true; continue; }
      if (name === 'HOLE CARDS') continue; // a duplicate mid-hand block — real Weplay quirk, already handled elsewhere; ignore here too

      const newCards = (sm[4] || sm[3] || '').trim().split(' ').filter(Boolean);
      const entry = { name, cards: newCards, potBB: bbRound(pot, bbCents), players: active.size, actions: [] };
      if (isSecond) secondStreetEntries.push(entry);
      else firstStreetEntries.push(entry);
      currentStreetActions = entry.actions;
      continue;
    }

    if (inSummary) {
      const tm = RE_TOTAL_POT.exec(l);
      if (tm) totalPotLine = tm;
      continue; // nothing else in the summary section is used by this module
    }

    if (inShowdown) {
      let m;
      if ((m = RE_MUCKS.exec(l))) { showdownLines.push({ type: 'mucks', name: m[1] }); continue; }
      if ((m = RE_SHOWS.exec(l))) {
        if (!hasValidCards(m[2])) continue;
        showdownLines.push({ type: 'shows', name: m[1], cards: m[2], desc: m[3] });
        continue;
      }
      if ((m = RE_COLLECTED.exec(l))) { showdownLines.push({ type: 'collected', name: m[1], cents: centsOf(m[2]), potType: m[3] }); continue; }
      if ((m = RE_TOTAL_POT.exec(l))) { totalPotLine = m; }
      continue;
    }

    let m;
    if ((m = RE_FOLD.exec(l))) { active.delete(m[1]); currentStreetActions.push({ text: fmtAction(m[1], 'folds'), isFold: true, player: m[1] }); continue; }
    if ((m = RE_CHECK.exec(l))) { currentStreetActions.push({ text: `${m[1]} checks`, isFold: false }); continue; }
    if ((m = RE_CALL.exec(l))) { pot += centsOf(m[2]); currentStreetActions.push({ text: fmtAction(m[1], 'calls', centsOf(m[2]), !!m[3]), isFold: false }); continue; }
    if ((m = RE_BET.exec(l))) { pot += centsOf(m[2]); currentStreetActions.push({ text: fmtAction(m[1], 'bets', centsOf(m[2]), !!m[3]), isFold: false }); continue; }
    if ((m = RE_RAISE.exec(l))) { pot += centsOf(m[2]); currentStreetActions.push({ text: fmtAction(m[1], 'raises', centsOf(m[3]), !!m[4]), isFold: false }); continue; }
    if ((m = RE_UNCALLED.exec(l))) { pot -= centsOf(m[1]); continue; }
    if ((m = RE_TOTAL_POT.exec(l))) { totalPotLine = m; continue; }
  }

  if (!totalPotLine) return null; // malformed hand with no summary line at all — shouldn't happen in real data, but fail safe
  const hasAnyCollectedLine = showdownLines.some((sl) => sl.type === 'collected');
  if (!hasAnyCollectedLine) return null; // no resolution anywhere in the source (e.g. a disconnect at showdown Weplay never resolved) — same condition the converter/stats engine already treat as unusable

  // Reconcile board1 (cumulative from every first-run street) and board2
  // (shared prefix up to the point of divergence, then its own cards).
  let board1 = [];
  for (const e of firstStreetEntries) {
    board1 = board1.concat(e.cards);
    if (e.name === 'FLOP') streets.flop = { board: e.cards, potBB: e.potBB, players: e.players, actions: e.actions };
    else if (e.name === 'TURN') streets.turn = { board: e.cards, potBB: e.potBB, players: e.players, actions: e.actions };
    else if (e.name === 'RIVER') streets.river = { board: e.cards, potBB: e.potBB, players: e.players, actions: e.actions };
  }
  let secondRun = null;
  if (secondStreetEntries.length) {
    const divergeIdx = firstStreetEntries.findIndex((e) => e.name === secondStreetEntries[0].name);
    const sharedCount = divergeIdx === -1 ? firstStreetEntries.length : divergeIdx;
    let board2Prefix = [];
    for (let k = 0; k < sharedCount; k++) board2Prefix = board2Prefix.concat(firstStreetEntries[k].cards);
    secondRun = { flop: null, turn: null, river: null };
    let board2 = board2Prefix;
    for (const e of secondStreetEntries) {
      board2 = board2.concat(e.cards);
      const entry = { board: e.cards, potBB: e.potBB, players: e.players, actions: e.actions };
      if (e.name === 'FLOP') secondRun.flop = entry;
      else if (e.name === 'TURN') secondRun.turn = entry;
      else if (e.name === 'RIVER') secondRun.river = entry;
    }
  }

  // ── Rake-adjusted winnings, same proportional model used elsewhere ──────
  const rakeCents = centsOf(totalPotLine[4]);
  const collectedLines = showdownLines.filter((sl) => sl.type === 'collected');
  const rakeAdjusted = distributeRakeReduction(collectedLines.map((c, idx) => ({ idx, cents: c.cents })), rakeCents);
  const adjustedByIdx = new Map(rakeAdjusted.map((r) => [r.idx, r.adjustedCents]));
  const winnersByName = new Map(); // name -> total adjusted cents
  collectedLines.forEach((c, idx) => {
    const adj = adjustedByIdx.get(idx);
    winnersByName.set(c.name, (winnersByName.get(c.name) || 0) + adj);
  });
  const winners = [...winnersByName.entries()].map(([name, cents]) => ({ name, amountBB: bbRound(cents, bbCents), isHero: name === hero }));

  // ── Showdown (shows/mucks only, deduplicated, hand type translated) ─────
  const showdown = [];
  const seen = new Set();
  for (const sl of showdownLines) {
    if (sl.type !== 'shows' || seen.has(sl.name)) continue;
    seen.add(sl.name);
    const { label } = translateHandDescription(sl.desc);
    showdown.push({ name: sl.name, cards: sl.cards, handType: label || sl.desc, isHero: sl.name === hero });
  }

  return {
    handId,
    dateTime: `${y}/${mo}/${d} ${hh.padStart(2, '0')}:${mm}:${ss}`,
    stakesLabel: `$${sbStake}/$${bbStake}`,
    maxSeats,
    tableType: isBombPot ? 'bombpot' : 'ante',
    isRunTwice,
    players,
    heroName: hero,
    heroCards,
    antesBB: antes.length ? bbRound(antes[0].cents, bbCents) : null,
    antesUniform: antes.length > 0 && antes.every((a) => a.cents === antes[0].cents),
    sbLine: sbEntry ? { name: sbEntry.name, bb: bbRound(sbEntry.cents, bbCents) } : null,
    bbLine: bbEntry ? { name: bbEntry.name, bb: bbRound(bbEntry.cents, bbCents) } : null,
    preflopActions,
    streets,
    secondRun,
    showdown,
    winners,
  };
}

module.exports = { buildHandReplay };
