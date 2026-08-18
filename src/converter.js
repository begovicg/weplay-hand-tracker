'use strict';

const { translateHandDescription } = require('./handDescriptions');

// ── Regexes for recognizing Weplay lines ────────────────────────────────────

// VanillaPoker is the same underlying network under a different site name —
// its hand history lines are byte-for-byte identical to Weplay's own aside
// from that one word (confirmed against real VanillaPoker sample files), so
// it's recognized and processed through this exact same pipeline rather than
// needing a separate parser.
const RE_HEADER = /^(?:Weplay|VanillaPoker) Hand #(\d+):\s+Hold'em No Limit \(\$([0-9.]+)\/\$([0-9.]+)\)\s+-\s+(\d{4})\/(\d{2})\/(\d{2}) (\d{1,2}):(\d{2}):(\d{2}) UTC$/;
const RE_TABLE = /^Table '(.+?)'\((\d+)\)\s+(\d+)-max(?:\s+\(([^)]*)\))?\s+Seat #(\d+) is the button$/;
const RE_SEAT = /^Seat (\d+): (.+?) \(\$([0-9.]+) in chips\)$/;
const RE_ANTE = /^(.+?): posts the ante \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_SB = /^(.+?): posts small blind \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_BB = /^(.+?): posts big blind \$([0-9.]+)(?:\s+and is all-in)?$/;
const RE_STREET_HEADER = /^\*\*\* (HOLE CARDS|FLOP|TURN|RIVER|SHOW DOWN|SUMMARY) \*\*\*(?: \[(.+?)\])?(?: \[(.+?)\])?$/;
const RE_DEALT = /^Dealt to (.+?)(?: \[(.+?)\])?$/;
const RE_FOLD = /^(.+?): folds$/;
const RE_CHECK = /^(.+?): checks$/;
const RE_CALL = /^(.+?): calls \$([0-9.]+)(\s+and is all-in)?$/;
const RE_BET = /^(.+?): bets \$([0-9.]+)(\s+and is all-in)?$/;
const RE_RAISE = /^(.+?): raises \$([0-9.]+) to \$([0-9.]+)(\s+and is all-in)?$/;
const RE_UNCALLED = /^Uncalled bet \(\$([0-9.]+)\) returned to (.+)$/;
const RE_COLLECTED = /^(.+?) collected \$([0-9.]+) from (pot|main pot|side pot(?:-\d+)?)$/;
const RE_SHOWS = /^(.+?): shows \[(.*?)\] \((.+?)\)$/;

// Weplay sometimes reveals a folded player's cards for transparency (already
// handled), but the reveal itself can come back partially redacted — e.g.
// "[## 5c]" instead of two real cards (confirmed from a real sample). Either
// way there's nothing usable here, so both the fully-empty and
// partially-redacted cases are treated the same: drop the line.
function hasValidCards(str) {
  return /^[2-9TJQKA][cdhs](\s+[2-9TJQKA][cdhs])*$/i.test((str || '').trim());
}
const RE_MUCKS = /^(.+?): mucks hand$/;
const RE_DOESNT_SHOW = /^(.+?): doesn't show hand$/;
const RE_TOTAL_POT = /^Total pot \$([0-9.]+)(?:\s+Main pot \$([0-9.]+)\.((?:\s+Side pot(?:-\d+)? \$[0-9.]+\.)*))?\s*\|\s*Rake \$([0-9.]+)\s*$/;
const RE_BOARD = /^Board \[(.*?)\]\s*$/;
const RE_SUMMARY_SEAT = /^Seat (\d+): (.+)$/;

// Noise lines that carry no hand-history-format meaning and should just be dropped.
const RE_NOISE = [
  /^.+? has timed out while being disconnected$/,
  /^.+? has timed out$/,
  /^.+? is connected\s*$/,
  /^.+? is disconnected\s*$/,
  /^.+? joins the table at seat #\d+$/,
  /^.+? leaves the table$/,
  /^.+?: sits out\s*$/,
  /^.+?: activates time bank\s*$/,
];

function isNoise(line) {
  return RE_NOISE.some((re) => re.test(line));
}

function money(v) {
  return `₮${v}`;
}

function centsOf(str) {
  return Math.round(parseFloat(str) * 100);
}

function moneyFromCents(cents) {
  return (cents / 100).toFixed(2);
}

// A hand can have more than one side pot when 3+ players are covered by
// different stack sizes — Weplay labels these "Side pot-1", "Side pot-2",
// etc. (confirmed from a real multi-way-all-in sample), rather than a single
// unlabeled "Side pot" used when there's only one. This pulls every "Side
// pot(-N) $X." segment out of the tail of a Total pot line, in order.
function parseSidePotSegments(str) {
  const segs = [];
  const re = /Side pot(-\d+)? \$([0-9.]+)\./g;
  let m;
  while ((m = re.exec(str || ''))) segs.push({ suffix: m[1] || '', amount: m[2] });
  return segs;
}

// Builds the CoinPoker "Total pot ..." summary line from a RE_TOTAL_POT match.
// Total pot / Main pot / (each) Side pot are pot SIZES, not payouts, so they're
// left exactly as Weplay stated them — only the collected amount(s) elsewhere
// in the hand get adjusted for rake, matching CoinPoker's own convention.
function formatTotalPotLine(tm) {
  const [, total, mainPot, sideStr, rake] = tm;
  if (mainPot) {
    const segs = parseSidePotSegments(sideStr);
    const sideOut = segs.map((s) => `Side pot${s.suffix} ${money(s.amount)}.`).join(' ');
    return `Total pot ${money(total)} Main pot ${money(mainPot)}.${sideOut ? ' ' + sideOut : ''} | Rake ${money(rake)} | Splash Fee ₮0.00`;
  }
  return `Total pot ${money(total)} | Rake ${money(rake)} | Splash Fee ₮0.00`;
}

// Precise decimal addition via integer cents, to avoid float rounding issues
// (0.1 + 0.2 !== 0.3 territory) when reconstructing pot totals.
function addMoney(...vals) {
  const cents = vals.reduce((sum, v) => sum + Math.round(parseFloat(v) * 100), 0);
  return (cents / 100).toFixed(2);
}

// Reduces a group of collectors' amounts by rakeCents in total, distributed
// proportionally to how much each of them collected, with the leftover cent(s)
// from rounding handed to whichever collector(s) had the largest fractional
// share — so the group's amounts still sum to exactly (groupTotal - rakeCents),
// down to the cent, regardless of how many people are splitting it.
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
  for (let i = 0; i < withShare.length && remainder > 0; i++, remainder--) {
    withShare[i].floorShare += 1;
  }
  return withShare.map((it) => ({ ...it, adjustedCents: it.cents - it.floorShare }));
}

// Real poker rooms never point the button at an empty seat, but Weplay does
// when a player has left mid-session and the table hasn't reseated — the
// stated button seat number can simply not be occupied that hand. CoinPoker's
// parser can't handle that (it desyncs and starts misreading following lines
// too), so we recompute the effective button: the occupied seat immediately
// before the small blind poster, wrapping around the table.
function computeEffectiveButton(occupiedSeatNums, sbSeatNum, statedButton) {
  if (occupiedSeatNums.includes(statedButton)) return statedButton;
  if (sbSeatNum == null || !occupiedSeatNums.includes(sbSeatNum)) return statedButton;
  // Heads-up: button and small blind are the same seat by rule, so "the seat
  // before SB" (the other player) would be wrong here — use SB's own seat.
  if (occupiedSeatNums.length === 2) return sbSeatNum;
  const sorted = [...occupiedSeatNums].sort((a, b) => a - b);
  const idx = sorted.indexOf(sbSeatNum);
  const prevIdx = (idx - 1 + sorted.length) % sorted.length;
  return sorted[prevIdx];
}

// Splits a "Seat N: <name> <description>" tail into the player name and the
// rest of the description. Can't just split on the first whitespace — Weplay
// usernames can contain spaces themselves (e.g. "MAMBA 444", "ema dayı",
// confirmed from real data), which would truncate the name and corrupt
// everything downstream. Instead, split at the first point where a known
// description keyword begins, which is safe because Weplay always separates
// the name from these with a space, and none of these phrases can be part of
// a legitimate username.
const RE_DESC_START = /\s+(?=\(button\)|\(small blind\)|\(big blind\)|folded before Flop|folded on the (?:Flop|Turn|River)|collected \(|mucked|won \(|showed \[)/;
function splitSummarySeatTail(rest) {
  const m = RE_DESC_START.exec(rest);
  if (m) {
    return { name: rest.slice(0, m.index).trim(), rest: rest.slice(m.index).trim() };
  }
  // Fallback for anything unexpected: old single-word-name behavior.
  const nm = /^(\S+)\s*(.*)$/.exec(rest);
  return { name: nm[1], rest: nm[2] };
}

// Regex for run-it-twice street/showdown/summary headers, which allow an
// optional FIRST/SECOND prefix Weplay doesn't always apply consistently
// (confirmed from real samples — see convertRunTwiceBody for details).
const RE_R2_STREET = /^\*\*\* (?:(FIRST|SECOND) )?(FLOP|TURN|RIVER|SHOW DOWN|SUMMARY) \*\*\*(?: \[(.+?)\])?(?: \[(.+?)\])?$/;

function transformSimpleAction(l, outName) {
  let m;
  if ((m = RE_FOLD.exec(l))) return `${outName(m[1])}: folds`;
  if ((m = RE_CHECK.exec(l))) return `${outName(m[1])}: checks`;
  if ((m = RE_CALL.exec(l))) return m[3] ? `${outName(m[1])}: ALLIN ${money(m[2])}` : `${outName(m[1])}: calls ${money(m[2])}`;
  if ((m = RE_BET.exec(l))) return m[3] ? `${outName(m[1])}: ALLIN ${money(m[2])}` : `${outName(m[1])}: bets ${money(m[2])}`;
  if ((m = RE_RAISE.exec(l))) return m[4] ? `${outName(m[1])}: ALLIN ${money(m[3])}` : `${outName(m[1])}: raises ${money(m[2])} to ${money(m[3])}`;
  if ((m = RE_UNCALLED.exec(l))) return `${outName(m[2])}: RETURN ${money(m[1])}`;
  return null;
}

/**
 * Handles everything from just after the "Dealt to" block through the end of
 * a run-it-twice hand: streets, both showdowns, and the summary. Pushes
 * directly onto `out`. This is structurally different enough from a normal
 * hand (CoinPoker reorders to "all of FIRST, then all of SECOND", rather than
 * Weplay's own interleaved order) that it isn't a simple line-by-line
 * transform like the rest of the converter — see the inline comments for what
 * was confirmed against real samples vs what's a documented best-effort call.
 */
function convertRunTwiceBody(lines, startIdx, out, ctx) {
  const {
    handId, warnings, outName, y, mo, d, hh, mm, ss,
    collectedAdjustedCents, rawCollected, sidePotWarnRef,
  } = ctx;
  let i = startIdx;

  // 1. Preflop actions — identical handling to a normal hand.
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (RE_R2_STREET.test(l)) break;
    if (isNoise(l)) continue;
    const act = transformSimpleAction(l, outName);
    if (act) { out.push(act); continue; }
    warnings.push(`Hand #${handId}: unrecognized preflop line, copied through as-is: "${l}"`);
    out.push(l);
  }

  // 2. Street entries. Weplay's own labeling is inconsistent about exactly
  // when it starts writing "FIRST X" (sometimes immediately, sometimes only
  // once "SECOND X" appears later — confirmed by directly comparing two real
  // sample hands with the same all-in-on-the-flop structure but different
  // labeling). So rather than trust Weplay's own FIRST/SECOND prefix, every
  // un-prefixed or FIRST-prefixed street is treated as belonging to the first
  // run, and only explicit "SECOND X" streets are treated as the second run.
  const streets = []; // {name, cards, actionLines}, first-run streets only
  const secondStreets = []; // {name, cards}, explicit SECOND streets only
  let currentBucket = null;
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    const sm = RE_R2_STREET.exec(l);
    if (sm) {
      if (sm[2] === 'SHOW DOWN' || sm[2] === 'SUMMARY') break;
      const isSecond = sm[1] === 'SECOND';
      const cards = (sm[4] || sm[3] || '').trim().split(' ').filter(Boolean);
      const entry = { name: sm[2], cards, actionLines: [] };
      if (isSecond) { secondStreets.push(entry); currentBucket = null; }
      else { streets.push(entry); currentBucket = entry; }
      continue;
    }
    if (isNoise(l)) continue;
    const act = transformSimpleAction(l, outName);
    if (act) {
      if (currentBucket) currentBucket.actionLines.push(act);
      else out.push(act);
      continue;
    }
    // A folded-but-revealed player's cards (see hasValidCards) can appear
    // mid-street in a run-it-twice hand rather than in the showdown section
    // proper — confirmed from a real sample. Drop it the same way.
    const showsCheck = RE_SHOWS.exec(l);
    if (showsCheck && !hasValidCards(showsCheck[2])) continue;
    warnings.push(`Hand #${handId}: unrecognized line in run-it-twice streets, copied through as-is: "${l}"`);
  }

  // 3. Emit every first-run street (always "FIRST X", regardless of how
  // Weplay itself labeled it — confirmed CoinPoker always prefixes every
  // street from FLOP onward in a run-it-twice hand, even ones that never
  // diverge, e.g. "*** FIRST FLOP ***" when only the river differs).
  let board1 = [];
  for (const s of streets) {
    const prior = board1.join(' ');
    board1 = board1.concat(s.cards);
    out.push(prior ? `*** FIRST ${s.name} *** [${prior}] [${s.cards.join(' ')}]` : `*** FIRST ${s.name} *** [${s.cards.join(' ')}]`);
    for (const a of s.actionLines) out.push(a);
  }

  // 4. Emit second-run streets, sharing whatever board history is common
  // before the point where Weplay's own "SECOND X" entries begin.
  let board2 = [];
  if (secondStreets.length) {
    const divergeIdx = streets.findIndex((s) => s.name === secondStreets[0].name);
    const sharedCount = divergeIdx === -1 ? streets.length : divergeIdx;
    for (let k = 0; k < sharedCount; k++) board2 = board2.concat(streets[k].cards);
    for (const s of secondStreets) {
      const prior = board2.join(' ');
      board2 = board2.concat(s.cards);
      out.push(prior ? `*** SECOND ${s.name} *** [${prior}] [${s.cards.join(' ')}]` : `*** SECOND ${s.name} *** [${s.cards.join(' ')}]`);
    }
  } else {
    board2 = board1.slice();
  }

  // 5. Showdown: collect shows/mucks/collected lines once, then emit them
  // under both "*** FIRST SHOWDOWN ***" and "*** SECOND SHOWDOWN ***"
  // (confirmed structure from real CoinPoker samples).
  if (i < lines.length && RE_R2_STREET.test(lines[i]) && RE_R2_STREET.exec(lines[i])[2] === 'SHOW DOWN') i++;
  const showdownLines = [];
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (RE_R2_STREET.test(l)) break;
    if (isNoise(l)) continue;
    let m;
    if ((m = RE_DOESNT_SHOW.exec(l))) continue;
    if ((m = RE_MUCKS.exec(l))) { showdownLines.push({ type: 'mucks', name: m[1] }); continue; }
    if ((m = RE_SHOWS.exec(l))) {
      if (!hasValidCards(m[2])) continue; // empty or redacted cards for a folded-but-revealed player — see the matching normal-hand fix
      showdownLines.push({ type: 'shows', name: m[1], cards: m[2], desc: m[3] });
      continue;
    }
    if ((m = RE_COLLECTED.exec(l))) {
      if (m[3].startsWith('side pot') && sidePotWarnRef && !sidePotWarnRef.warned) {
        warnings.push(`Hand #${handId}: contains a side pot — rake is assumed to be distributed proportionally across the main pot and every side pot (not confirmed against a real CoinPoker sample). Double-check this hand's import.`);
        sidePotWarnRef.warned = true;
      }
      continue; // amounts are reconstructed from the pre-scanned rawCollected below, not re-parsed here
    }
    warnings.push(`Hand #${handId}: unrecognized showdown line, copied through as-is: "${l}"`);
  }

  // Pre-translate each shown hand once so both showdown blocks (and the
  // summary) reuse the same result instead of duplicating warnings.
  if (showdownLines.some((sl) => sl.type === 'shows')) {
    warnings.push(`Hand #${handId}: run-it-twice hand — Weplay only reports one hand-type description per player (not one per board), so the same label is reused for both the FIRST and SECOND showdown sections. The true hand type against the second board hasn't been independently verified.`);
  }
  for (const sl of showdownLines) {
    if (sl.type !== 'shows') continue;
    const { label, inferred } = translateHandDescription(sl.desc);
    if (!label) warnings.push(`Hand #${handId}: unrecognized hand description "${sl.desc}" — left untranslated`);
    if (inferred) warnings.push(`Hand #${handId}: hand type "${label}" inferred, not confirmed against a real CoinPoker sample`);
    sl.translatedLabel = label || sl.desc;
  }

  // Reconstruct per-board collected amounts. Weplay writes ONE combined
  // "collected" line when the same player wins both boards, but TWO separate
  // lines when different players win each board — confirmed from real
  // samples of both cases. CoinPoker always shows two separate per-board
  // amounts either way. A hand can also have a side pot on top of this (the
  // side pot is uncontested and never re-run — only the shared main pot gets
  // split across the two boards), confirmed from a real sample combining
  // both: side-pot collected line(s) are excluded from the board-split logic
  // entirely and instead attached once to the FIRST showdown section.
  let firstCollected = null;
  let secondCollected = null;
  const collectedEntries = rawCollected.map((c, idx) => ({
    name: c.name,
    potType: c.type,
    adjustedCents: collectedAdjustedCents.has(idx) ? collectedAdjustedCents.get(idx) : c.cents,
  }));
  const sideEntries = collectedEntries.filter((c) => c.potType.startsWith('side pot'));
  const mainEntries = collectedEntries.filter((c) => !c.potType.startsWith('side pot'));
  if (sideEntries.length) {
    warnings.push(`Hand #${handId}: run-it-twice hand also has a side pot — the side pot isn't re-run (only the contested main pot is split across both boards), so its payout is attached once to the FIRST showdown section. This combination has been seen in exactly one real sample; the exact CoinPoker placement isn't independently confirmed.`);
  }
  if (mainEntries.length >= 2) {
    // Two different winners: assumed to be board1's result then board2's
    // result, in that order. This matches the one real example available but
    // isn't independently confirmed beyond it.
    firstCollected = mainEntries[0];
    secondCollected = mainEntries[1];
    warnings.push(`Hand #${handId}: run-it-twice hand has two separate collected-from-pot lines, assumed to be board1's result then board2's result in that order — confirmed against one real sample, not independently verified beyond it.`);
  } else if (mainEntries.length === 1) {
    const total = mainEntries[0].adjustedCents;
    const half1 = Math.ceil(total / 2);
    const half2 = total - half1;
    firstCollected = { name: mainEntries[0].name, potType: mainEntries[0].potType, adjustedCents: half1 };
    secondCollected = { name: mainEntries[0].name, potType: mainEntries[0].potType, adjustedCents: half2 };
    warnings.push(`Hand #${handId}: run-it-twice hand shows one combined payout for a single winner across both boards — split into two halves (${money(moneyFromCents(half1))} / ${money(moneyFromCents(half2))}) since Weplay doesn't report the per-board amounts separately. This matches the confirmed CoinPoker pattern of two near-equal per-board amounts, but the exact split isn't independently verified.`);
  }

  // A player's FIRST-board total includes any side pot they won (attached
  // there, see above); their SECOND-board total is only the main-pot split.
  function firstBoardCentsFor(name) {
    let total = 0;
    let any = false;
    if (firstCollected && firstCollected.name === name) { total += firstCollected.adjustedCents; any = true; }
    for (const se of sideEntries) if (se.name === name) { total += se.adjustedCents; any = true; }
    return any ? total : null;
  }
  function secondBoardCentsFor(name) {
    return (secondCollected && secondCollected.name === name) ? secondCollected.adjustedCents : null;
  }

  function emitShowdown(labelPrefix, mainInfo, extraSideEntries) {
    out.push(`*** ${labelPrefix} SHOWDOWN ***`);
    for (const sl of showdownLines) {
      if (sl.type === 'mucks') out.push(`${outName(sl.name)}: mucks hand`);
      else if (sl.type === 'shows') out.push(`${outName(sl.name)}: shows [${sl.cards}] (${sl.translatedLabel})`);
    }
    for (const se of (extraSideEntries || [])) {
      out.push(`${outName(se.name)} collected ${money(moneyFromCents(se.adjustedCents))} from ${se.potType}`);
    }
    if (mainInfo) out.push(`${outName(mainInfo.name)} collected ${money(moneyFromCents(mainInfo.adjustedCents))} from ${mainInfo.potType}`);
  }
  emitShowdown('FIRST', firstCollected, sideEntries);
  emitShowdown('SECOND', secondCollected, []);

  // 6. Summary.
  if (i < lines.length && RE_R2_STREET.test(lines[i]) && RE_R2_STREET.exec(lines[i])[2] === 'SUMMARY') { out.push('*** SUMMARY ***'); i++; }
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (isNoise(l)) continue;

    const tm = RE_TOTAL_POT.exec(l);
    if (tm) {
      out.push(formatTotalPotLine(tm));
      out.push('Hand was run two times');
      out.push(`FIRST Board [ ${board1.join(' ')} ]`);
      out.push(`SECOND Board [ ${board2.join(' ')} ]`);
      const endMinute = (parseInt(mm, 10) + 1) % 60;
      const endHour = (parseInt(hh, 10) + (parseInt(mm, 10) + 1 >= 60 ? 1 : 0)) % 24;
      out.push(`Game ended: ${y}/${mo}/${d} ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:${ss} CEST`);
      continue;
    }
    if (/^Hand was run/i.test(l)) continue;
    if (/^(FIRST|SECOND) Board \[/.test(l)) continue;
    if (RE_BOARD.test(l)) continue;

    const sm = RE_SUMMARY_SEAT.exec(l);
    if (sm) {
      const seatNum = sm[1];
      const split = splitSummarySeatTail(sm[2]);
      const rawName = split.name;
      let rest = split.rest;
      rest = rest.replace(/\((button|small blind|big blind)\)\s*/g, '').trim();

      const foldTruncateMatch = /^(folded before Flop|folded on the (?:Flop|Turn|River))\b/.exec(rest);
      if (foldTruncateMatch) {
        let phrase = foldTruncateMatch[1];
        if (phrase === 'folded before Flop') phrase += " (didn't bet)";
        out.push(`Seat ${seatNum}: ${outName(rawName)} ${phrase}`);
        continue;
      }

      const showEntry = showdownLines.find((sl) => sl.type === 'shows' && sl.name === rawName);
      if (showEntry) {
        const won1cents = firstBoardCentsFor(rawName);
        const won2cents = secondBoardCentsFor(rawName);
        const part1 = won1cents != null ? `won (${money(moneyFromCents(won1cents))}) with ${showEntry.translatedLabel}` : `lost with ${showEntry.translatedLabel}`;
        const part2 = won2cents != null ? `won (${money(moneyFromCents(won2cents))}) with ${showEntry.translatedLabel}` : `lost with ${showEntry.translatedLabel}`;
        out.push(`Seat ${seatNum}: ${outName(rawName)} showed [${showEntry.cards}] and ${part1}, and ${part2}`);
        continue;
      }
      const muckEntry = showdownLines.find((sl) => sl.type === 'mucks' && sl.name === rawName);
      if (muckEntry) { out.push(`Seat ${seatNum}: ${outName(rawName)} didn't show`); continue; }

      warnings.push(`Hand #${handId}: unrecognized summary line, copied through as-is: "${l}"`);
      out.push(`Seat ${seatNum}: ${outName(rawName)} ${rest}`.trim());
      continue;
    }

    warnings.push(`Hand #${handId}: unrecognized line, copied through as-is: "${l}"`);
    out.push(l);
  }
}

/**
 * Convert one Weplay hand block into CoinPoker-format text.
 * Returns { text, warnings, skipped, skipReason }.
 */
function convertHand(block, options) {
  const opts = options || {};
  const replaceHero = opts.replaceHeroName !== false; // default true
  const warnings = [];
  const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
  const isRunTwice = /\*\*\* SECOND (FLOP|TURN|RIVER) \*\*\*/i.test(block);

  const headerMatch = RE_HEADER.exec(lines[0] || '');
  if (!headerMatch) {
    return { text: null, warnings, skipped: true, skipReason: `Could not parse header line: "${lines[0]}"` };
  }
  const [, handId, sb, bb, y, mo, d, hhRaw, mm, ss] = headerMatch;
  // Weplay doesn't zero-pad the hour when it's a single digit (e.g. "0:40:13"
  // instead of "00:40:13" — confirmed across a large real batch, hours 0-9 all
  // do this). CoinPoker's own format always uses two digits.
  const hh = hhRaw.padStart(2, '0');

  let tableLine = null;
  for (const l of lines) {
    if (l.startsWith('Table ')) { tableLine = l; break; }
  }
  const tableMatch = tableLine ? RE_TABLE.exec(tableLine) : null;
  if (!tableMatch) {
    return { text: null, warnings, skipped: true, skipReason: 'Could not parse table line' };
  }
  const [, , tableId, maxSeats, , buttonSeat] = tableMatch;

  // Pre-scan: find Hero via the single "Dealt to X [cards]" line.
  let heroName = null;
  let heroCards = null;
  for (const l of lines) {
    const m = RE_DEALT.exec(l);
    if (m && m[2]) { heroName = m[1]; heroCards = m[2]; break; }
  }
  if (!heroName) {
    warnings.push(`Hand #${handId}: no hole cards found for any player — could not determine Hero`);
  }

  // Pre-scan: collect seats in ascending seat-number order.
  const seats = [];
  for (const l of lines) {
    const m = RE_SEAT.exec(l);
    if (m) seats.push({ num: parseInt(m[1], 10), name: m[2], stack: m[3] });
  }
  seats.sort((a, b) => a.num - b.num);

  // Weplay sometimes points the button at a seat that's empty this hand (a
  // player left mid-session and the table didn't reseat). Recompute the
  // effective button rather than trust the stated number, or CoinPoker's own
  // parser can't find a button player and errors out on the hand.
  let sbSeatNum = null;
  for (const l of lines) {
    const m = RE_SB.exec(l);
    if (m) {
      const seat = seats.find((s) => s.name === m[1]);
      if (seat) sbSeatNum = seat.num;
      break;
    }
  }
  const occupiedSeatNums = seats.map((s) => s.num);
  const statedButton = parseInt(buttonSeat, 10);
  const effectiveButton = computeEffectiveButton(occupiedSeatNums, sbSeatNum, statedButton);
  if (effectiveButton !== statedButton) {
    warnings.push(`Hand #${handId}: stated button seat #${statedButton} was empty (a player likely left mid-session) — moved the button to seat #${effectiveButton} instead`);
  }

  // Pre-scan: rake comes from the Total pot line (which appears near the end
  // of the hand, after the collected-from-pot lines it needs to correct), and
  // Weplay's own "collected" amounts are gross — they sum to exactly the
  // stated Total pot, with rake never subtracted (verified across a full real
  // sample file). CoinPoker's actual convention deducts rake from the winner's
  // payout instead, so we need to know the rake amount before we reach the
  // collected lines in the main pass. For side-pot hands, rake is distributed
  // proportionally across every collector (main and side pots alike) rather
  // than coming only from the main pot — a real sample proved the main-pot-
  // only model impossible (a hand with Main pot ₮0.28 and Rake ₮0.66, where
  // rake alone exceeds the entire main pot, so it can't have been paid from
  // there exclusively). This isn't confirmed against a real CoinPoker sample
  // either, so side-pot hands still get flagged in warnings.
  let rakeCents = 0;
  for (const l of lines) {
    const tm = RE_TOTAL_POT.exec(l);
    if (tm) {
      rakeCents = centsOf(tm[4]);
      break;
    }
  }

  const rawCollected = [];
  for (const l of lines) {
    const cm = RE_COLLECTED.exec(l);
    if (cm) rawCollected.push({ name: cm[1], cents: centsOf(cm[2]), type: cm[3] });
  }

  if (rawCollected.length === 0) {
    // Every legitimate hand has at least one "X collected $Y from pot" line —
    // confirmed across thousands of real hands, including walks, splits, side
    // pots, and run-it-twice. Zero is a reliable signal the source hand itself
    // is incomplete (seen for real: a player disconnecting right at showdown,
    // where Weplay's own log never records a winner or payout at all). There's
    // no data to reconstruct a result from, so skip rather than emit a hand
    // with no declared winner — which would silently corrupt the import.
    return { text: null, warnings, skipped: true, skipReason: 'Hand has no "collected from pot" line anywhere — the source hand itself appears incomplete (e.g. a disconnect during showdown that Weplay never resolved), so there\'s no way to know who won or how much.' };
  }

  const rakedGroup = rawCollected.map((c, idx) => ({ ...c, idx }));
  const rakeAdjusted = distributeRakeReduction(rakedGroup, rakeCents);
  const collectedAdjustedCents = new Map(); // idx -> adjustedCents
  for (const it of rakeAdjusted) collectedAdjustedCents.set(it.idx, it.adjustedCents);
  let collectedPointer = 0;

  // Summary lines report one combined "won" figure per player even when they
  // collected from both a main pot and a side pot, so build a per-name total
  // (post-rake-adjustment) for the summary section to reference.
  const totalAdjustedByName = new Map();
  for (let idx = 0; idx < rawCollected.length; idx++) {
    const c = rawCollected[idx];
    const adj = collectedAdjustedCents.has(idx) ? collectedAdjustedCents.get(idx) : c.cents;
    totalAdjustedByName.set(c.name, (totalAdjustedByName.get(c.name) || 0) + adj);
  }

  const outName = (name) => (replaceHero && name === heroName ? 'Hero' : name);

  const out = [];

  const anteAmounts = new Set();
  for (const l of lines) {
    const m = RE_ANTE.exec(l);
    if (m) anteAmounts.add(m[2]);
  }
  if (anteAmounts.size > 1) {
    warnings.push(`Hand #${handId}: players posted different ante amounts (${[...anteAmounts].join(', ')}) — using the largest for the header, per-player lines are still correct`);
  }
  const anteForHeader = anteAmounts.size
    ? [...anteAmounts].sort((a, b) => parseFloat(b) - parseFloat(a))[0]
    : '0';

  out.push(`CoinPoker Hand #${handId}: NLH (${money(sb)}/${money(bb)}/${money(anteForHeader)}) ${y}/${mo}/${d} ${hh}:${mm}:${ss} CEST`);
  out.push(`Table '${tableId}' ${maxSeats}-max Seat #${effectiveButton} is the button`);
  for (const s of seats) {
    out.push(`Seat ${s.num}: ${outName(s.name)} (${money(s.stack)} in chips)`);
  }

  let boardParts = [];
  let sawFlop = false;
  let totalPotLine = null;
  let sidePotWarned = false;
  let skipDealtLines = false;

  let i = 0;
  // Skip past header/table/seat lines we already consumed manually.
  while (i < lines.length && !/^\*\*\* HOLE CARDS \*\*\*$/.test(lines[i])) {
    const l = lines[i];
    if (RE_ANTE.test(l) || RE_SEAT.test(l) || RE_HEADER.test(l) || RE_TABLE.test(l)) {
      const am = RE_ANTE.exec(l);
      if (am) out.push(`${outName(am[1])}: posts ante ${money(am[2])}`);
    } else if (RE_SB.test(l)) {
      const m = RE_SB.exec(l);
      out.push(`${outName(m[1])}: posts small blind ${money(m[2])}`);
    } else if (RE_BB.test(l)) {
      const m = RE_BB.exec(l);
      out.push(`${outName(m[1])}: posts big blind ${money(m[2])}`);
    } else if (isNoise(l) || l === '') {
      // drop
    } else if (l.trim() !== '') {
      // Unrecognized pre-flop-header line; keep the hand but flag it.
      warnings.push(`Hand #${handId}: unrecognized line before HOLE CARDS: "${l}"`);
    }
    i++;
  }

  // *** HOLE CARDS *** and the Dealt-to block
  out.push('*** HOLE CARDS ***');
  for (const s of seats) {
    if (s.name === heroName) {
      out.push(`Dealt to ${outName(s.name)} [${heroCards}]`);
    } else {
      out.push(`Dealt to ${outName(s.name)}`);
    }
  }
  // advance past the header + the single "Dealt to X [cards]" line
  i++;
  while (i < lines.length && RE_DEALT.test(lines[i])) i++;

  if (isRunTwice) {
    const sidePotWarnRef = { warned: false };
    convertRunTwiceBody(lines, i, out, {
      handId, warnings, outName, y, mo, d, hh, mm, ss,
      collectedAdjustedCents, rawCollected, sidePotWarnRef,
    });
    out.push('');
    return { text: out.join('\n'), warnings, skipped: false, skipReason: null };
  }

  // Walk the rest of the hand: actions, streets, showdown, summary.
  for (; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === '') continue;
    if (isNoise(l)) continue;

    const streetMatch = RE_STREET_HEADER.exec(l);
    if (streetMatch) {
      const name = streetMatch[1];
      if (name === 'HOLE CARDS') {
        // Weplay occasionally logs a duplicate "*** HOLE CARDS ***" block
        // mid-hand (confirmed on a real sample — same player, same cards,
        // appearing again after the river with no new information). Drop it
        // and the "Dealt to ..." line(s) that follow, same as the real one
        // already consumed before this loop started.
        skipDealtLines = true;
        continue;
      }
      if (name === 'SHOW DOWN') {
        out.push('*** SHOWDOWN ***');
      } else if (name === 'SUMMARY') {
        out.push('*** SUMMARY ***');
      } else {
        out.push(l); // FLOP/TURN/RIVER headers are byte-for-byte identical between the two formats
        if (name === 'FLOP') {
          sawFlop = true;
          boardParts = (streetMatch[2] || '').split(' ').filter(Boolean);
        } else if (name === 'TURN' || name === 'RIVER') {
          const newCard = (streetMatch[3] || '').trim();
          if (newCard) boardParts.push(newCard);
        }
      }
      continue;
    }

    if (skipDealtLines) {
      if (RE_DEALT.test(l)) continue;
      skipDealtLines = false;
    }

    let m;
    if ((m = RE_FOLD.exec(l))) { out.push(`${outName(m[1])}: folds`); continue; }
    if ((m = RE_CHECK.exec(l))) { out.push(`${outName(m[1])}: checks`); continue; }
    if ((m = RE_CALL.exec(l))) {
      out.push(m[3] ? `${outName(m[1])}: ALLIN ${money(m[2])}` : `${outName(m[1])}: calls ${money(m[2])}`);
      continue;
    }
    if ((m = RE_BET.exec(l))) {
      out.push(m[3] ? `${outName(m[1])}: ALLIN ${money(m[2])}` : `${outName(m[1])}: bets ${money(m[2])}`);
      continue;
    }
    if ((m = RE_RAISE.exec(l))) {
      out.push(m[4] ? `${outName(m[1])}: ALLIN ${money(m[3])}` : `${outName(m[1])}: raises ${money(m[2])} to ${money(m[3])}`);
      continue;
    }
    if ((m = RE_UNCALLED.exec(l))) { out.push(`${outName(m[2])}: RETURN ${money(m[1])}`); continue; }
    if ((m = RE_DOESNT_SHOW.exec(l))) { continue; } // dropped: CoinPoker has no equivalent for the uncontested-win case
    if ((m = RE_MUCKS.exec(l))) { out.push(`${outName(m[1])}: mucks hand`); continue; }
    if ((m = RE_SHOWS.exec(l))) {
      if (!hasValidCards(m[2])) {
        // Weplay sometimes lists a folded player in the showdown section with
        // empty or partially redacted cards (e.g. "X: shows [] (...)" or
        // "X: shows [## 5c] (...)") — this happens for players who folded to
        // an all-in but still get their cards revealed for transparency.
        // CoinPoker's own format never lists non-showdown participants here
        // at all, so this line is dropped rather than emitted broken. Their
        // fold is still recorded normally in the summary.
        continue;
      }
      const { label, inferred } = translateHandDescription(m[3]);
      if (!label) warnings.push(`Hand #${handId}: unrecognized hand description "${m[3]}" — left untranslated`);
      if (inferred) warnings.push(`Hand #${handId}: hand type "${label}" inferred, not confirmed against a real CoinPoker sample`);
      out.push(`${outName(m[1])}: shows [${m[2]}] (${label || m[3]})`);
      continue;
    }
    if ((m = RE_COLLECTED.exec(l))) {
      if (m[3].startsWith('side pot') && !sidePotWarned) {
        warnings.push(`Hand #${handId}: contains a side pot — rake is assumed to be distributed proportionally across the main pot and every side pot (not confirmed against a real CoinPoker sample). Double-check this hand's import.`);
        sidePotWarned = true;
      }
      const rawCents = centsOf(m[2]);
      const idx = collectedPointer++;
      const adjustedCents = collectedAdjustedCents.has(idx) ? collectedAdjustedCents.get(idx) : rawCents;
      const amountOut = adjustedCents === rawCents ? m[2] : moneyFromCents(adjustedCents);
      out.push(`${outName(m[1])} collected ${money(amountOut)} from ${m[3]}`);
      continue;
    }
    if ((m = RE_TOTAL_POT.exec(l))) {
      totalPotLine = formatTotalPotLine(m);
      out.push(totalPotLine);
      out.push('Hand was run once');
      out.push(sawFlop ? `Board [ ${boardParts.join(' ')} ]` : 'Board [  ]');
      // We don't know the real hand-end time, so approximate it as start + 1 minute.
      const endMinute = (parseInt(mm, 10) + 1) % 60;
      const endHour = (parseInt(hh, 10) + (parseInt(mm, 10) + 1 >= 60 ? 1 : 0)) % 24;
      out.push(`Game ended: ${y}/${mo}/${d} ${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}:${ss} CEST`);
      continue;
    }
    if (RE_BOARD.test(l)) continue; // consumed via our own tracking above, and already emitted
    const sm = RE_SUMMARY_SEAT.exec(l);
    if (sm) {
      const seatNum = sm[1];
      const split = splitSummarySeatTail(sm[2]);
      const rawName = split.name;
      let rest = split.rest;
      // strip position tags — CoinPoker summary never includes them
      rest = rest.replace(/\((button|small blind|big blind)\)\s*/g, '').trim();
      // Weplay sometimes appends "showed [...] and lost/won with ..." after a
      // fold phrase for a player who folded to an all-in but still had their
      // cards revealed (see the matching showdown-section fix above).
      // CoinPoker's convention only ever describes a fold plainly, so truncate
      // to just the fold phrase and discard the trailing showdown-style text.
      const foldTruncateMatch = /^(folded before Flop|folded on the (?:Flop|Turn|River))\b/.exec(rest);
      if (foldTruncateMatch) rest = foldTruncateMatch[1];
      rest = rest.replace(/collected \(\$([0-9.]+)\)/, (full, amt) => {
        const rawC = centsOf(amt);
        const cents = totalAdjustedByName.has(rawName) ? totalAdjustedByName.get(rawName) : rawC;
        return `won (${money(cents === rawC ? amt : moneyFromCents(cents))})`;
      });
      rest = rest.replace(/^folded before Flop\s*$/, 'folded before Flop (didn\'t bet)');
      rest = rest.replace(/mucked/, "didn't show");
      rest = rest.replace(/won \(\$([0-9.]+)\)/, (full, amt) => {
        const rawC = centsOf(amt);
        const cents = totalAdjustedByName.has(rawName) ? totalAdjustedByName.get(rawName) : rawC;
        return `won (${money(cents === rawC ? amt : moneyFromCents(cents))})`;
      });
      rest = rest.replace(/with (a |)([a-zA-Z ,]+?)$/, (full, article, desc) => {
        const { label } = translateHandDescription(article + desc);
        return `with ${label || (article + desc)}`;
      });
      out.push(`Seat ${seatNum}: ${outName(rawName)} ${rest}`.trim());
      continue;
    }

    warnings.push(`Hand #${handId}: unrecognized line, copied through as-is: "${l}"`);
    out.push(l);
  }

  out.push('');
  return { text: out.join('\n'), warnings, skipped: false, skipReason: null };
}


function splitHands(text) {
  // Strip BOM, normalize line endings.
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n');
  const blocks = clean.split(/(?=^(?:Weplay|VanillaPoker) Hand #)/m);
  return blocks.map((b) => b.trim()).filter(Boolean);
}

// Every warning message follows one of two shapes: a genuinely new pattern
// this converter has never handled before ("unrecognized ...", "could not
// determine ..." — the exact phrasing used at every catch-all fallback in
// this file), or an already-understood, documented best-effort caveat (side
// pots, run-it-twice inference, button reassignment, and so on). Surfacing
// that distinction in the UI is what actually lets new format variants get
// noticed quickly instead of buried in a large warning count.
function classifyWarning(text) {
  return /unrecognized|could not determine/i.test(text) ? 'unknown' : 'known';
}

/**
 * Convert a full Weplay hand-history file (possibly many hands).
 * Returns { text, handCount, skippedHands: [{handId?, reason}], warnings,
 * heroName, flaggedHands }. flaggedHands holds one entry per hand that has
 * any warning or was skipped — each with the raw Weplay block alongside the
 * converted output, so the UI can offer a one-click "copy for support" report
 * without needing to re-locate the hand in the source file by hand.
 */
function convertFile(rawText, options) {
  const opts = options || {};
  const blocks = splitHands(rawText);
  const outputs = [];
  const skipped = [];
  const allWarnings = [];
  const flaggedHands = [];
  let detectedHero = null;

  for (const block of blocks) {
    const heroMatch = /Dealt to (.+?) \[/.exec(block);
    if (heroMatch && !detectedHero) detectedHero = heroMatch[1];

    const idMatch = /(?:Weplay|VanillaPoker) Hand #(\d+)/.exec(block);
    const handId = idMatch ? idMatch[1] : null;

    const result = convertHand(block, opts);
    if (result.skipped) {
      skipped.push({ handId, reason: result.skipReason });
      flaggedHands.push({
        handId,
        raw: block.trim(),
        text: null,
        warnings: [],
        skipped: true,
        skipReason: result.skipReason,
        severity: 'unknown',
      });
      continue;
    }
    outputs.push(result.text);
    allWarnings.push(...result.warnings);
    if (result.warnings.length) {
      const severity = result.warnings.some((w) => classifyWarning(w) === 'unknown') ? 'unknown' : 'known';
      flaggedHands.push({
        handId,
        raw: block.trim(),
        text: result.text,
        warnings: result.warnings,
        skipped: false,
        skipReason: null,
        severity,
      });
    }
  }

  return {
    text: outputs.join('\n'),
    handCount: outputs.length,
    skippedHands: skipped,
    warnings: allWarnings,
    heroName: detectedHero,
    flaggedHands,
  };
}

module.exports = { convertFile, convertHand, splitHands, classifyWarning };
