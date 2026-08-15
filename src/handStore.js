'use strict';

const fs = require('fs');
const { convertHand } = require('./converter');
const { analyzeHand } = require('./stats');
const { computeHandEVAdjustment } = require('./evAnalysis');
const { buildHandReplay } = require('./handReplay');

// ── Building storable records for one hand ──────────────────────────────
// One row for the hand itself (src/db.js's `hands` table), plus one row per
// seated player (`hand_players`) — see src/db.js for why it's split this
// way. Reuses handReplay.js for the full seat list (every player, not just
// hero) rather than re-deriving it, and stats.js for every player's deep
// stats (net, VPIP, PFR, hand category, saw flop) — not hero-only anymore,
// see the comment inside buildHandRecords for how that changed. EV
// adjustment (src/evAnalysis.js) is hero-agnostic too — computed for
// whichever two seated players a qualifying all-in was actually between,
// each getting their own exact number — see the evAdjustmentBB comment
// inside buildHandRecords.

function buildHandRecords(rawBlock, sourceFile, options) {
  const heroOverride = (options && options.heroName) || null;
  const replay = buildHandReplay(rawBlock, heroOverride);
  if (!replay) return null; // unparseable header, or no resolution anywhere in the source

  const convertResult = convertHand(rawBlock, options);
  const statsResult = analyzeHand(rawBlock, heroOverride);
  // EV adjustment (src/evAnalysis.js) is computed once, here, at import time
  // — not on every Stats tab visit. See that module and the Stats tab
  // caveat text for why: it can take up to roughly a second per qualifying
  // hand (Monte Carlo sampling for a preflop all-in), fine as a one-time
  // import cost, not something to repeat on every stats view.
  const evResult = computeHandEVAdjustment(rawBlock, heroOverride);

  const wonNames = new Set(replay.winners.map((w) => w.name));
  const showdownByName = new Map(replay.showdown.map((s) => [s.name, s]));

  const stakesMatch = /^\$([0-9.]+)\/\$([0-9.]+)$/.exec(replay.stakesLabel || '');
  const sbStake = stakesMatch ? parseFloat(stakesMatch[1]) : null;
  const bbStake = stakesMatch ? parseFloat(stakesMatch[2]) : null;
  // Total pot / rake are read directly off the raw text (the same figures
  // Weplay itself states — pre-rake pot size), rather than reconstructed
  // from the rake-adjusted winners list, which is a different number.
  const potMatch = /^Total pot \$([0-9.]+)/m.exec(rawBlock);
  const rakeMatch = /\|\s*Rake \$([0-9.]+)/.exec(rawBlock);

  const hand = {
    handId: replay.handId,
    sourceFile,
    importedAt: Date.now(),
    date: replay.dateTime ? replay.dateTime.slice(0, 10).replace(/\//g, '-') : null,
    time: replay.dateTime ? replay.dateTime.slice(11) : null,
    sbStake,
    bbStake,
    stakesLabel: replay.stakesLabel,
    maxSeats: replay.maxSeats,
    tableType: replay.tableType,
    tableCategory: `${replay.maxSeats}max-${replay.tableType}`,
    isRunTwice: replay.isRunTwice ? 1 : 0,
    board: [replay.streets.flop, replay.streets.turn, replay.streets.river]
      .filter(Boolean).flatMap((s) => s.board).join(' ') || null,
    potSize: potMatch ? parseFloat(potMatch[1]) : null,
    rake: rakeMatch ? parseFloat(rakeMatch[1]) : null,
    skipped: convertResult.skipped ? 1 : 0,
    skipReason: convertResult.skipped ? convertResult.skipReason : null,
    rawText: rawBlock,
  };

  const players = replay.players.map((p) => {
    const isHero = p.isHero;
    const shown = showdownByName.get(p.name);
    // Deep stats are now computed for every seated player, not just hero —
    // analyzeHand takes a player name as a parameter, it was never actually
    // hardcoded to "hero" specifically, so this is the exact same function
    // already used for hero, just called once per player instead of once
    // per hand (reusing the already-computed statsResult for hero, to
    // avoid redundant work). Verified this doesn't meaningfully slow down
    // import: ~0.66ms/hand even analyzing all seated players on a real
    // 8-max table, extrapolating to about 15 extra seconds across this
    // project's entire 22,888-hand batch — not the "generalize the whole
    // engine" undertaking this module's own header comment once assumed
    // it would be.
    const playerStats = isHero ? statsResult : analyzeHand(rawBlock, p.name);
    // EV adjustment: computeHandEVAdjustment is hero-agnostic (see its
    // comment in evAnalysis.js) — evResult.players lists whichever two
    // seated players the all-in was actually between, hero or not, each
    // with their own exact adjustment. Every other seated player (someone
    // who folded before the all-in ever happened, or wasn't part of it)
    // correctly stays null, since the runout variance never applied to
    // them.
    const evMatch = evResult && evResult.players.find((pl) => pl.name === p.name);
    const evAdjustmentBB = evMatch ? evMatch.adjustmentBB : null;
    // Advanced-filters action flags — every one of these already exists on
    // playerStats (analyzeHand's return object, src/stats.js:550-589),
    // already computed for every seated player above, not just hero. This
    // is pure persistence of values already sitting in memory, not new
    // analysis — same `playerStats ? (x ? 1 : 0) : null` shape already used
    // for vpip/pfr/sawFlop, just applied to more fields. cbetMade/
    // foldedToCBet are flat {FLOP,TURN,RIVER: boolean} objects;
    // checkRaiseByStreet[street] is {opp, cr} — cr is the achieved count.
    const b = (v) => (playerStats ? (v ? 1 : 0) : null);
    // HUD quick-stats (3-Bet%, Agg%): streetAgg is analyzeHand's raw
    // per-street {agg, calls, folds, checks} counts — summed across
    // flop/turn/river here so getQuickPlayerStats can build Agg% with a
    // plain SQL SUM instead of re-parsing raw text per player. See
    // src/db.js's hand_players columns for the exact formula this feeds.
    const streetAgg = playerStats && playerStats.streetAgg;
    const postflopAggCount = streetAgg ? (streetAgg.FLOP.agg + streetAgg.TURN.agg + streetAgg.RIVER.agg) : null;
    const postflopAggDenom = streetAgg
      ? ['FLOP', 'TURN', 'RIVER'].reduce((s, k) => s + streetAgg[k].agg + streetAgg[k].calls + streetAgg[k].folds + streetAgg[k].checks, 0)
      : null;
    return {
      handId: replay.handId,
      playerName: p.name,
      isHero: isHero ? 1 : 0,
      seat: p.seat,
      position: p.position === '—' ? null : p.position,
      startingStack: p.stackBB,
      holeCards: isHero ? replay.heroCards : (shown ? shown.cards : null),
      net: playerStats ? playerStats.net : null,
      vpip: b(playerStats && playerStats.vpip),
      pfr: b(playerStats && playerStats.pfr),
      sawFlop: b(playerStats && playerStats.sawFlop),
      handCategory: playerStats ? playerStats.handCategory : null,
      // Genuine "reached a real 2+-way showdown" (src/stats.js's
      // reachedShowdown), computed per-player exactly like wonAtShowdown/
      // wonWhenSawFlop below — NOT showdownByName.has(p.name), which was a
      // real bug: that only asked "does a raw `shows` line with valid cards
      // exist for this player," true only when someone actually reveals
      // their cards. A hand can genuinely reach a 2+-way showdown and still
      // have the loser muck without showing (very common — no reason to
      // show a loser), so that old definition silently undercounted real
      // showdowns, which is exactly why filtering "Showdown: No" could
      // still show a nonzero WTSD% in the stats above it — mucked losses
      // slipped through as "not shown" even though they genuinely reached
      // showdown. `won` below stays correct as-is (reads winners, a
      // separate and already-accurate signal).
      wentToShowdown: b(playerStats && playerStats.reachedShowdown),
      won: wonNames.has(p.name) ? 1 : 0,
      evAdjustmentBB,
      rfi: b(playerStats && playerStats.rfi),
      coldCall: b(playerStats && playerStats.coldCall),
      limped: b(playerStats && playerStats.limped),
      threeBet: b(playerStats && playerStats.threeBet),
      foldedToThreeBet: b(playerStats && playerStats.foldedToThreeBet),
      fourBet: b(playerStats && playerStats.fourBet),
      foldedToFourBet: b(playerStats && playerStats.foldedToFourBet),
      squeeze: b(playerStats && playerStats.squeeze),
      attemptSteal: b(playerStats && playerStats.attemptSteal),
      foldedToSteal: b(playerStats && playerStats.foldedToSteal),
      cbetFlop: b(playerStats && playerStats.cbetMade && playerStats.cbetMade.FLOP),
      cbetTurn: b(playerStats && playerStats.cbetMade && playerStats.cbetMade.TURN),
      cbetRiver: b(playerStats && playerStats.cbetMade && playerStats.cbetMade.RIVER),
      foldedToCbetFlop: b(playerStats && playerStats.foldedToCBet && playerStats.foldedToCBet.FLOP),
      foldedToCbetTurn: b(playerStats && playerStats.foldedToCBet && playerStats.foldedToCBet.TURN),
      foldedToCbetRiver: b(playerStats && playerStats.foldedToCBet && playerStats.foldedToCBet.RIVER),
      checkRaiseFlop: b(playerStats && playerStats.checkRaiseByStreet && playerStats.checkRaiseByStreet.FLOP.cr > 0),
      checkRaiseTurn: b(playerStats && playerStats.checkRaiseByStreet && playerStats.checkRaiseByStreet.TURN.cr > 0),
      checkRaiseRiver: b(playerStats && playerStats.checkRaiseByStreet && playerStats.checkRaiseByStreet.RIVER.cr > 0),
      wonAtShowdown: b(playerStats && playerStats.wonAtShowdown),
      wonWhenSawFlop: b(playerStats && playerStats.wonWhenSawFlop),
      facedThreeBetOpportunity: b(playerStats && playerStats.facedThreeBetOpportunity),
      postflopAggCount,
      postflopAggDenom,
    };
  });

  return { hand, players };
}

/**
 * Regenerates a hand's CoinPoker-format text on demand from its raw text,
 * for the detail viewer. Not persisted — computed on demand instead.
 */
function getConvertedText(rawText, options) {
  if (!rawText) return null;
  const result = convertHand(rawText, options);
  return result.skipped ? null : result.text;
}

// ── Import ───────────────────────────────────────────────────────────────

// A genuine UPDATE on conflict, deliberately NOT "INSERT OR REPLACE" — that
// statement's name is misleading: SQLite's REPLACE conflict resolution
// deletes the existing row and inserts a fresh one, which is indistinguishable
// from an UPDATE for this table's own columns, but hand_players.hand_id
// REFERENCES hands(hand_id) ON DELETE CASCADE (see src/db.js) — so that
// delete silently cascaded and wiped every hand_players row for the hand
// BEFORE UPSERT_PLAYER_SQL's own merge logic ever ran, discarding the exact
// data (an earlier importer's hole cards, is_hero) that merge exists to
// protect. An ON CONFLICT...DO UPDATE never deletes the row at all, so no
// cascade fires.
const UPSERT_HAND_SQL = `
  INSERT INTO hands
    (hand_id, source_file, imported_at, date, time, sb_stake, bb_stake, stakes_label,
     max_seats, table_type, table_category, is_run_twice, board, pot_size, rake,
     skipped, skip_reason, raw_text)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(hand_id) DO UPDATE SET
    source_file = excluded.source_file,
    imported_at = excluded.imported_at,
    date = excluded.date,
    time = excluded.time,
    sb_stake = excluded.sb_stake,
    bb_stake = excluded.bb_stake,
    stakes_label = excluded.stakes_label,
    max_seats = excluded.max_seats,
    table_type = excluded.table_type,
    table_category = excluded.table_category,
    is_run_twice = excluded.is_run_twice,
    board = excluded.board,
    pot_size = excluded.pot_size,
    rake = excluded.rake,
    skipped = excluded.skipped,
    skip_reason = excluded.skip_reason,
    raw_text = excluded.raw_text
`;

// One player at a time, upserted rather than delete-then-reinsert — this is
// what makes it safe to import the SAME hand_id from two different people's
// own exports of a hand they shared a table for (the actual scenario a
// shared/pooled multi-person database needs). Each real Weplay hand only
// ever reveals hole cards from two angles: whoever's own client the file
// came from (their hidden cards, even if mucked) and anyone who showed at a
// genuine showdown (public — identical in every witness's export). A naive
// delete-then-reinsert on re-import loses the FIRST angle: importing
// Friend B's file after Friend A's already-stored file would null out A's
// hole cards (B's export never saw them) and flip is_hero from A to B, even
// though nothing about the real hand changed. ON CONFLICT here merges
// instead of replacing:
//   - is_hero: MAX (OR) — once ANY import reveals this hand from a given
//     player's own client, they stay flagged as a real hero of this hand
//     forever, even if a later import is from someone else's file.
//   - hole_cards: COALESCE(new, old) — never let a "this file doesn't know"
//     import null out an already-known answer; still updates the instant
//     any import DOES know it (their own file, or a showdown reveal).
//   - net/vpip/pfr/saw_flop/hand_category/went_to_showdown/won/seat/
//     position/starting_stack: COALESCE(new, old) too, but these are all
//     derived from PUBLIC action/board state that's identical regardless of
//     which witness's file it came from, so which side "wins" is a
//     tiebreak, not a correctness question — refreshing to the newest
//     computation is just a nice side effect (e.g. an analyzeHand bug fix
//     naturally reaches already-imported hands on their next re-import).
//   - ev_adjustment_bb: COALESCE(old, new) — the ONE column deliberately
//     preferring the EXISTING value, so a harmless re-import of an
//     already-resolved all-in doesn't churn its stored number on every
//     re-import via a fresh (differently-seeded) Monte Carlo draw.
const UPSERT_PLAYER_SQL = `
  INSERT INTO hand_players
    (hand_id, player_name, is_hero, seat, position, starting_stack, hole_cards,
     net, vpip, pfr, saw_flop, hand_category, went_to_showdown, won, ev_adjustment_bb,
     rfi, cold_call, limped, three_bet, folded_to_three_bet, four_bet, folded_to_four_bet,
     squeeze, attempt_steal, folded_to_steal,
     cbet_flop, cbet_turn, cbet_river,
     folded_to_cbet_flop, folded_to_cbet_turn, folded_to_cbet_river,
     check_raise_flop, check_raise_turn, check_raise_river,
     won_at_showdown, won_when_saw_flop,
     faced_three_bet_opportunity, postflop_agg_count, postflop_agg_denom)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(hand_id, player_name) DO UPDATE SET
    is_hero              = MAX(hand_players.is_hero, excluded.is_hero),
    seat                 = COALESCE(excluded.seat, hand_players.seat),
    position             = COALESCE(excluded.position, hand_players.position),
    starting_stack       = COALESCE(excluded.starting_stack, hand_players.starting_stack),
    hole_cards           = COALESCE(excluded.hole_cards, hand_players.hole_cards),
    net                  = COALESCE(excluded.net, hand_players.net),
    vpip                 = COALESCE(excluded.vpip, hand_players.vpip),
    pfr                  = COALESCE(excluded.pfr, hand_players.pfr),
    saw_flop             = COALESCE(excluded.saw_flop, hand_players.saw_flop),
    hand_category        = COALESCE(excluded.hand_category, hand_players.hand_category),
    went_to_showdown     = COALESCE(excluded.went_to_showdown, hand_players.went_to_showdown),
    won                  = COALESCE(excluded.won, hand_players.won),
    ev_adjustment_bb     = COALESCE(hand_players.ev_adjustment_bb, excluded.ev_adjustment_bb),
    -- Advanced-filters action flags: same COALESCE(new, old) tiebreak as
    -- net/vpip/etc above, not the ev_adjustment_bb special case — these are
    -- all deterministic from public action data, so which side "wins" is
    -- never a correctness question, just a refresh-to-newest convenience.
    rfi                  = COALESCE(excluded.rfi, hand_players.rfi),
    cold_call            = COALESCE(excluded.cold_call, hand_players.cold_call),
    limped               = COALESCE(excluded.limped, hand_players.limped),
    three_bet            = COALESCE(excluded.three_bet, hand_players.three_bet),
    folded_to_three_bet  = COALESCE(excluded.folded_to_three_bet, hand_players.folded_to_three_bet),
    four_bet             = COALESCE(excluded.four_bet, hand_players.four_bet),
    folded_to_four_bet   = COALESCE(excluded.folded_to_four_bet, hand_players.folded_to_four_bet),
    squeeze              = COALESCE(excluded.squeeze, hand_players.squeeze),
    attempt_steal        = COALESCE(excluded.attempt_steal, hand_players.attempt_steal),
    folded_to_steal      = COALESCE(excluded.folded_to_steal, hand_players.folded_to_steal),
    cbet_flop            = COALESCE(excluded.cbet_flop, hand_players.cbet_flop),
    cbet_turn            = COALESCE(excluded.cbet_turn, hand_players.cbet_turn),
    cbet_river           = COALESCE(excluded.cbet_river, hand_players.cbet_river),
    folded_to_cbet_flop  = COALESCE(excluded.folded_to_cbet_flop, hand_players.folded_to_cbet_flop),
    folded_to_cbet_turn  = COALESCE(excluded.folded_to_cbet_turn, hand_players.folded_to_cbet_turn),
    folded_to_cbet_river = COALESCE(excluded.folded_to_cbet_river, hand_players.folded_to_cbet_river),
    check_raise_flop     = COALESCE(excluded.check_raise_flop, hand_players.check_raise_flop),
    check_raise_turn     = COALESCE(excluded.check_raise_turn, hand_players.check_raise_turn),
    check_raise_river    = COALESCE(excluded.check_raise_river, hand_players.check_raise_river),
    won_at_showdown      = COALESCE(excluded.won_at_showdown, hand_players.won_at_showdown),
    won_when_saw_flop    = COALESCE(excluded.won_when_saw_flop, hand_players.won_when_saw_flop),
    faced_three_bet_opportunity = COALESCE(excluded.faced_three_bet_opportunity, hand_players.faced_three_bet_opportunity),
    postflop_agg_count   = COALESCE(excluded.postflop_agg_count, hand_players.postflop_agg_count),
    postflop_agg_denom   = COALESCE(excluded.postflop_agg_denom, hand_players.postflop_agg_denom)
`;

/**
 * Imports every hand from a raw Weplay file into the database, keyed by
 * hand ID so re-importing the same file (or an overlapping export from a
 * different person who shared that table) safely updates rather than
 * duplicates. Player rows are MERGED, not replaced, on re-import — see the
 * comment on UPSERT_PLAYER_SQL above for exactly what that means and why a
 * blind replace was a real data-loss bug for the multi-importer case.
 * Hand-level fields (board, pot, rake, etc.) are still last-import-wins via
 * plain INSERT OR REPLACE: unlike hole cards, those are public facts about
 * the hand that are identical regardless of whose file revealed them, so
 * there's nothing to merge — whichever import ran most recently is just as
 * correct as any other. Wrapped in one transaction per file: importing
 * thousands of hands as individually-committed statements measurably
 * slower and adds no correctness benefit here.
 */
function importFileIntoStore(db, rawText, sourceFile, options, splitHandsFn) {
  const blocks = splitHandsFn(rawText);
  let added = 0, updated = 0, skippedCount = 0;

  const upsertHand = db.prepare(UPSERT_HAND_SQL);
  const upsertPlayer = db.prepare(UPSERT_PLAYER_SQL);
  const checkExists = db.prepare('SELECT 1 FROM hands WHERE hand_id = ?');

  db.exec('BEGIN');
  try {
    for (const block of blocks) {
      const built = buildHandRecords(block, sourceFile, options);
      if (!built) { skippedCount++; continue; }
      const { hand: h, players } = built;

      const exists = checkExists.get(h.handId);
      if (exists) updated++; else added++;

      upsertHand.run(
        h.handId, h.sourceFile, h.importedAt, h.date, h.time, h.sbStake, h.bbStake,
        h.stakesLabel, h.maxSeats, h.tableType, h.tableCategory, h.isRunTwice, h.board,
        h.potSize, h.rake, h.skipped, h.skipReason, h.rawText,
      );
      for (const p of players) {
        upsertPlayer.run(
          p.handId, p.playerName, p.isHero, p.seat, p.position, p.startingStack,
          p.holeCards, p.net, p.vpip, p.pfr, p.sawFlop, p.handCategory, p.wentToShowdown, p.won,
          p.evAdjustmentBB,
          p.rfi, p.coldCall, p.limped, p.threeBet, p.foldedToThreeBet, p.fourBet, p.foldedToFourBet,
          p.squeeze, p.attemptSteal, p.foldedToSteal,
          p.cbetFlop, p.cbetTurn, p.cbetRiver,
          p.foldedToCbetFlop, p.foldedToCbetTurn, p.foldedToCbetRiver,
          p.checkRaiseFlop, p.checkRaiseTurn, p.checkRaiseRiver,
          p.wonAtShowdown, p.wonWhenSawFlop,
          p.facedThreeBetOpportunity, p.postflopAggCount, p.postflopAggDenom,
        );
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { added, updated, skipped: skippedCount, total: blocks.length };
}

// ── Querying ─────────────────────────────────────────────────────────────
// Every query joins hands to hand_players filtered to one player's
// perspective — defaults to is_hero = 1 (whoever's hole cards were visible
// in each hand's own source file), or a specific named player when given.
// Any recognized player can be selected this way now, not just imported
// heroes — see getAllPlayerNames for the dropdown this feeds.

function buildWhereClause(f) {
  const params = [];
  const clauses = [];
  // "Perspective" means "this player's complete hand history" — every hand
  // they were seated in, regardless of which file that data came from (their
  // own export, where they're is_hero=1, or someone else's export where
  // they're just a named opponent). Used to require is_hero=1 specifically,
  // back when deep stats (net, VPIP, PFR, hand category, saw flop) were only
  // ever computed for whoever was hero in that specific file — now that
  // every seated player gets those computed at import time (see
  // buildHandRecords), that restriction isn't needed for correctness, and
  // dropping it is what actually makes "view any recognized player, not
  // just imported heroes" work: petit_blaireau's own hand history and
  // Javolimpero's hands where he happened to sit across from petit are
  // both just "player_name = ?" now, no different in kind.
  if (f.perspectivePlayer) {
    clauses.push('hp.player_name = ?');
    params.push(f.perspectivePlayer);
  } else {
    clauses.push('hp.is_hero = 1');
  }
  if (f.dateFrom) { clauses.push('h.date >= ?'); params.push(f.dateFrom); }
  if (f.dateTo) { clauses.push('h.date <= ?'); params.push(f.dateTo); }
  if (f.tableCategory) { clauses.push('h.table_category = ?'); params.push(f.tableCategory); }
  if (f.stakesLabel) { clauses.push('h.stakes_label = ?'); params.push(f.stakesLabel); }
  if (f.position) { clauses.push('hp.position = ?'); params.push(f.position); }
  if (f.handCategory) { clauses.push('hp.hand_category = ?'); params.push(f.handCategory); }
  // Three-way, not a checkbox: "shown" / "not-shown" / anything else (both,
  // no filter). hp.went_to_showdown is "reached a genuine 2+-way showdown"
  // (src/stats.js's reachedShowdown) — the standard WTSD definition, and
  // the same one the WTSD% stat itself uses. Deliberately NOT "were this
  // player's cards literally shown" (src/stats.js's heroCardsShown, used
  // for the separate Advanced Graph blue/red split) — a hand can reach a
  // real showdown and still have the loser muck without revealing, so that
  // definition used to undercount real showdowns here, which is exactly
  // why filtering to "not-shown" could still show a nonzero WTSD% above it.
  if (f.wentToShowdown === 'shown') { clauses.push('hp.went_to_showdown = 1'); }
  else if (f.wentToShowdown === 'not-shown') { clauses.push('hp.went_to_showdown = 0'); }
  // Saw Flop — three-way, same "both / yes / no" shape as the showdown
  // filter. Distinguishes whether hero saw a flop at all (called or raised
  // preflop and stayed in) from folding preflop before ever reaching one.
  if (f.sawFlop === 'yes') { clauses.push('hp.saw_flop = 1'); }
  else if (f.sawFlop === 'no') { clauses.push('hp.saw_flop = 0'); }
  // Pot size filter, in big blinds — converted against each hand's own
  // bb_stake rather than a fixed dollar figure, since "10 to 25bb" means a
  // different dollar range at every stake.
  if (f.potBbMin != null && f.potBbMin !== '') { clauses.push('h.pot_size >= h.bb_stake * ?'); params.push(parseFloat(f.potBbMin)); }
  if (f.potBbMax != null && f.potBbMax !== '') { clauses.push('h.pot_size <= h.bb_stake * ?'); params.push(parseFloat(f.potBbMax)); }
  // Bomb Pots toggle — checked (the default) applies no filter at all;
  // unchecked sends includeBombPots: false and excludes them at the query
  // level. Every caller (stats, the hands table, the Advanced Graph, and
  // export) shares this same WHERE clause via queryRawHandsForStats/
  // queryHands, so excluding bomb pots here excludes them everywhere in one
  // place — none of those call sites need their own bomb-pot handling.
  if (f.includeBombPots === false) { clauses.push("h.table_type != 'bombpot'"); }

  // ── Advanced filters ──────────────────────────────────────────────────
  // Every field below matches what PokerTracker/Hold'em Manager/Hand2Note
  // treat as their standard "Common Filters" / "Actions and Opportunities"
  // set — see the ones already computed at import time by buildHandRecords
  // (src/db.js's hand_players columns). Same 'yes'/'no'/omitted three-way
  // shape as the existing sawFlop filter just above; a local helper here
  // instead of repeating that if/else 23 times.
  const threeWay = (value, column) => {
    if (value === 'yes') clauses.push(`${column} = 1`);
    else if (value === 'no') clauses.push(`${column} = 0`);
  };
  threeWay(f.vpip, 'hp.vpip');
  threeWay(f.pfr, 'hp.pfr');
  threeWay(f.rfi, 'hp.rfi');
  threeWay(f.coldCall, 'hp.cold_call');
  threeWay(f.limped, 'hp.limped');
  threeWay(f.threeBet, 'hp.three_bet');
  threeWay(f.foldedToThreeBet, 'hp.folded_to_three_bet');
  threeWay(f.fourBet, 'hp.four_bet');
  threeWay(f.foldedToFourBet, 'hp.folded_to_four_bet');
  threeWay(f.squeeze, 'hp.squeeze');
  threeWay(f.attemptSteal, 'hp.attempt_steal');
  threeWay(f.foldedToSteal, 'hp.folded_to_steal');
  threeWay(f.cbetFlop, 'hp.cbet_flop');
  threeWay(f.cbetTurn, 'hp.cbet_turn');
  threeWay(f.cbetRiver, 'hp.cbet_river');
  threeWay(f.foldedToCbetFlop, 'hp.folded_to_cbet_flop');
  threeWay(f.foldedToCbetTurn, 'hp.folded_to_cbet_turn');
  threeWay(f.foldedToCbetRiver, 'hp.folded_to_cbet_river');
  threeWay(f.checkRaiseFlop, 'hp.check_raise_flop');
  threeWay(f.checkRaiseTurn, 'hp.check_raise_turn');
  threeWay(f.checkRaiseRiver, 'hp.check_raise_river');
  threeWay(f.wonAtShowdown, 'hp.won_at_showdown');
  threeWay(f.wonWhenSawFlop, 'hp.won_when_saw_flop');
  threeWay(f.runItTwice, 'h.is_run_twice');
  // Stack depth (BB) at the start of the hand — same bb-normalized shape as
  // the existing pot-size filter above.
  if (f.stackBbMin != null && f.stackBbMin !== '') { clauses.push('hp.starting_stack >= ?'); params.push(parseFloat(f.stackBbMin)); }
  if (f.stackBbMax != null && f.stackBbMax !== '') { clauses.push('hp.starting_stack <= ?'); params.push(parseFloat(f.stackBbMax)); }
  // Stakes as a numeric bb range — alongside the exact stakesLabel picker
  // above, not replacing it; useful for "NL50 and up" style ranges the
  // exact-match dropdown can't express.
  if (f.stakesBbMin != null && f.stakesBbMin !== '') { clauses.push('h.bb_stake >= ?'); params.push(parseFloat(f.stakesBbMin)); }
  if (f.stakesBbMax != null && f.stakesBbMax !== '') { clauses.push('h.bb_stake <= ?'); params.push(parseFloat(f.stakesBbMax)); }

  if (f.search) {
    clauses.push('(h.hand_id LIKE ? OR h.source_file LIKE ? OR hp.hole_cards LIKE ?)');
    const needle = `%${f.search}%`;
    params.push(needle, needle, needle);
  }
  return { where: clauses.join(' AND '), params };
}

// Sorting by stakes uses the actual numeric bb_stake column, not the text
// label — the same lexicographic-sort trap fixed elsewhere in this app
// ("$10/$20" sorting before "$2/$4" as plain text) applies here too if
// sorted by the label string instead of the number it represents.
const SORT_COLUMNS = {
  date: "(h.date || ' ' || h.time)",
  net: 'hp.net',
  stakes: 'h.bb_stake',
  table: 'h.table_category',
  position: 'hp.position',
  pot: 'h.pot_size',
  wtsd: 'hp.went_to_showdown',
};

/**
 * Filters and sorts hands for the hand-list view. Returns lightweight
 * summary rows (no raw text — fetched separately per-hand for the detail
 * window) via a paginated SQL query, so a multi-hundred-thousand-hand
 * database only ever touches the one page actually being displayed.
 */
function queryHands(db, filters) {
  const f = filters || {};
  const { where, params } = buildWhereClause(f);

  const sortCol = SORT_COLUMNS[f.sortBy] || SORT_COLUMNS.date;
  const sortDir = f.sortAsc ? 'ASC' : 'DESC';
  const limit = f.limit || 200;
  const offset = f.offset || 0;

  const totalRow = db.prepare(`SELECT COUNT(*) AS c FROM hands h JOIN hand_players hp ON hp.hand_id = h.hand_id WHERE ${where}`).get(...params);
  const total = totalRow.c;

  const rows = db.prepare(`
    SELECT h.hand_id AS handId, h.date, h.time, h.stakes_label AS stakesLabel,
           h.table_type AS tableType, h.table_category AS tableCategory,
           hp.position, hp.hand_category AS handCategory, hp.hole_cards AS heroCards,
           hp.net, h.pot_size AS potSize, hp.went_to_showdown AS wentToShowdown,
           hp.saw_flop AS sawFlop, hp.won, h.source_file AS sourceFile, h.skipped
    FROM hands h JOIN hand_players hp ON hp.hand_id = h.hand_id
    WHERE ${where}
    ORDER BY ${sortCol} ${sortDir}, h.hand_id ${sortDir}
    LIMIT ? OFFSET ?
  `).all(...params, limit, offset);

  // node:sqlite returns 0/1 for booleans and null-prototype row objects —
  // normalize both so the renderer can use them exactly like before.
  const hands = rows.map((r) => ({
    ...r,
    wentToShowdown: !!r.wentToShowdown,
    sawFlop: r.sawFlop == null ? null : !!r.sawFlop,
    won: !!r.won,
    skipped: !!r.skipped,
  }));

  return { hands, total, offset, limit };
}

/**
 * Every distinct player who has ever been "hero" in this database — i.e.
 * whose own hand history file was imported at least once (their hole cards
 * were the ones revealed) — with a hand count for each. This is the list
 * for the perspective selector: "whose hands/stats am I looking at",
 * distinct from the much larger set of every opponent name ever seen
 * sitting at a table, which wouldn't be a meaningful list to pick from.
 */
function getHeroPlayerNames(db) {
  return db.prepare(`
    SELECT player_name AS name, COUNT(*) AS handCount
    FROM hand_players
    WHERE is_hero = 1
    GROUP BY player_name
    ORDER BY handCount DESC
  `).all();
}

/**
 * Every distinct player ever seated in any imported hand — not just the
 * heroes getHeroPlayerNames returns, every recognized opponent too. Feeds
 * the perspective dropdown now that deep stats (net, VPIP, PFR, hand
 * category, saw flop) are computed for every seated player at import time,
 * not just whoever happened to be hero in that specific file — so any name
 * on this list is a real, viewable perspective, not just a name that
 * happens to appear at a table.
 */
function getAllPlayerNames(db) {
  return db.prepare(`
    SELECT player_name AS name, COUNT(*) AS handCount
    FROM hand_players
    GROUP BY player_name
    ORDER BY handCount DESC
  `).all();
}

/**
 * Grand total hand count across the entire database — every hero, every
 * filter ignored. Unambiguous by construction, unlike the "added/updated/
 * skipped" counts a single import batch returns (which only ever reflect
 * that one batch, not the database as a whole) — meant specifically to
 * give the person a number they can directly compare against whatever a
 * filtered view shows afterward, since those two numbers legitimately
 * differing (e.g. a filtered perspective vs. the whole database) is a very
 * different situation from a stale UI, and this is what makes the
 * difference checkable at a glance instead of a guess.
 */
function getTotalHandCount(db) {
  return db.prepare('SELECT COUNT(*) AS n FROM hands WHERE skipped = 0').get().n;
}

/**
 * Backfills deep stats (net, VPIP, PFR, hand category, saw flop) for any
 * row that predates them being computed for that player. Two real,
 * distinct gaps this covers in one pass: (1) every non-hero row from
 * before deep stats were generalized to all seated players, not just
 * hero — those have net itself still NULL, never computed at all; and
 * (2) hero rows imported between when saw_flop was added and now, which
 * have net/VPIP/PFR populated but saw_flop specifically still NULL (the
 * original, narrower version of this backfill only covered that second
 * case — this supersedes it, catching both in one query and one pass
 * instead of running two overlapping backfills on every startup). A NULL
 * net/saw_flop doesn't mean "zero" or "no" — the filter clauses (e.g.
 * `saw_flop = 1` / `= 0`) correctly match neither for a NULL row, which is
 * exactly why an un-backfilled database returns zero results for every
 * value of a filter built on a column that was never actually computed.
 * Recomputed here from each hand's own stored raw_text (already in the
 * database — no re-import needed); analyzeHandFn is passed in rather than
 * required directly so this module doesn't need a hard dependency on
 * stats.js, matching the same pattern importFileIntoStore already uses for
 * splitHandsFn. Idempotent and cheap to call on every startup — verified
 * against this project's real 22,888-hand batch at ~1.3s; once every row
 * has been backfilled, the SELECT finds nothing left to do and this
 * becomes a fast no-op.
 */
function backfillDeepStats(db, analyzeHandFn) {
  const rows = db.prepare(`
    SELECT hp.hand_id AS handId, hp.player_name AS playerName, h.raw_text AS rawText
    FROM hand_players hp JOIN hands h ON h.hand_id = hp.hand_id
    WHERE (hp.net IS NULL OR hp.saw_flop IS NULL OR hp.rfi IS NULL OR hp.postflop_agg_count IS NULL) AND h.skipped = 0
  `).all();
  if (rows.length === 0) return 0;

  const update = db.prepare(`
    UPDATE hand_players SET
      net = ?, vpip = ?, pfr = ?, saw_flop = ?, hand_category = ?,
      rfi = ?, cold_call = ?, limped = ?, three_bet = ?, folded_to_three_bet = ?,
      four_bet = ?, folded_to_four_bet = ?, squeeze = ?, attempt_steal = ?, folded_to_steal = ?,
      cbet_flop = ?, cbet_turn = ?, cbet_river = ?,
      folded_to_cbet_flop = ?, folded_to_cbet_turn = ?, folded_to_cbet_river = ?,
      check_raise_flop = ?, check_raise_turn = ?, check_raise_river = ?,
      won_at_showdown = ?, won_when_saw_flop = ?,
      faced_three_bet_opportunity = ?, postflop_agg_count = ?, postflop_agg_denom = ?
    WHERE hand_id = ? AND player_name = ?
  `);
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const analyzed = analyzeHandFn(r.rawText, r.playerName);
      // Same "compute once, extract every field" shape as buildHandRecords'
      // own b() helper — see that function's comment for why these are all
      // pure persistence of an already-computed analyzeHand result, not new
      // analysis, and why cbetMade/foldedToCBet/checkRaiseByStreet need
      // their per-street sub-fields pulled out individually.
      const b = (v) => (analyzed ? (v ? 1 : 0) : null);
      update.run(
        analyzed ? analyzed.net : null,
        b(analyzed && analyzed.vpip),
        b(analyzed && analyzed.pfr),
        b(analyzed && analyzed.sawFlop),
        analyzed ? analyzed.handCategory : null,
        b(analyzed && analyzed.rfi),
        b(analyzed && analyzed.coldCall),
        b(analyzed && analyzed.limped),
        b(analyzed && analyzed.threeBet),
        b(analyzed && analyzed.foldedToThreeBet),
        b(analyzed && analyzed.fourBet),
        b(analyzed && analyzed.foldedToFourBet),
        b(analyzed && analyzed.squeeze),
        b(analyzed && analyzed.attemptSteal),
        b(analyzed && analyzed.foldedToSteal),
        b(analyzed && analyzed.cbetMade && analyzed.cbetMade.FLOP),
        b(analyzed && analyzed.cbetMade && analyzed.cbetMade.TURN),
        b(analyzed && analyzed.cbetMade && analyzed.cbetMade.RIVER),
        b(analyzed && analyzed.foldedToCBet && analyzed.foldedToCBet.FLOP),
        b(analyzed && analyzed.foldedToCBet && analyzed.foldedToCBet.TURN),
        b(analyzed && analyzed.foldedToCBet && analyzed.foldedToCBet.RIVER),
        b(analyzed && analyzed.checkRaiseByStreet && analyzed.checkRaiseByStreet.FLOP.cr > 0),
        b(analyzed && analyzed.checkRaiseByStreet && analyzed.checkRaiseByStreet.TURN.cr > 0),
        b(analyzed && analyzed.checkRaiseByStreet && analyzed.checkRaiseByStreet.RIVER.cr > 0),
        b(analyzed && analyzed.wonAtShowdown),
        b(analyzed && analyzed.wonWhenSawFlop),
        b(analyzed && analyzed.facedThreeBetOpportunity),
        analyzed && analyzed.streetAgg
          ? analyzed.streetAgg.FLOP.agg + analyzed.streetAgg.TURN.agg + analyzed.streetAgg.RIVER.agg
          : null,
        analyzed && analyzed.streetAgg
          ? ['FLOP', 'TURN', 'RIVER'].reduce((s, k) => s + analyzed.streetAgg[k].agg + analyzed.streetAgg[k].calls + analyzed.streetAgg[k].folds + analyzed.streetAgg[k].checks, 0)
          : null,
        r.handId, r.playerName,
      );
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return rows.length;
}

/**
 * One-time backfill for two real gaps in EV adjustment (src/evAnalysis.js),
 * not a missing-column gap like backfillDeepStats above — both were bugs in
 * what got computed at import time, for hands imported before each was
 * fixed:
 *   1. Villain-side mirroring never existed at all (an earlier version only
 *      ever stored hero's side of a qualifying all-in, leaving the actual
 *      opponent's row NULL even though their number is the exact negation).
 *   2. Even after mirroring was added, findAllInSpot was hero-anchored — an
 *      all-in between two players where NEITHER was hero (hero folded
 *      earlier, or wasn't dealt into that pot at all) was silently skipped
 *      entirely, leaving BOTH seated players in that hand NULL. This was
 *      the larger of the two: it meant a non-hero player's EV winrate barely
 *      differed from their actual winrate, since only their all-ins against
 *      hero specifically were ever being adjusted.
 *
 * A single pass covers both: for every hand that mentions an all-in in its
 * raw text and does NOT have exactly two player rows with a real
 * evAdjustmentBB yet — the reliable signal that this hand hasn't been fully
 * resolved under the current logic, since a genuinely qualifying all-in
 * always produces exactly two non-null rows: zero means gap #2 (or a hand
 * that never actually qualifies), one means gap #1 (the old hero-only
 * mirroring) — re-runs computeHandEVAdjustment fresh from the stored
 * raw_text (no re-import needed) and writes both participants' numbers
 * directly (computeHandEVAdjustment already returns the exact negation for
 * both sides — nothing to re-derive here).
 *
 * Not fully idempotent the way backfillDeepStats is: a hand that mentions
 * "and is all-in" but never actually qualifies (3+-way, run-it-twice, an
 * all-in closing exactly on the river) will keep matching the SELECT below
 * on every call, since it can never reach exactly two non-null rows to make
 * the scan go quiet. That's bounded to the same cheap subset
 * computeHandEVAdjustment already limits itself to (~12% of a real batch)
 * and never repeats any Monte Carlo work for hands that don't qualify
 * (findAllInSpot returns null before equity() is ever called) — a fast scan
 * on every subsequent startup, not a slow one.
 */
function backfillEVAdjustments(db) {
  const rows = db.prepare(`
    SELECT h.hand_id AS handId, h.raw_text AS rawText
    FROM hands h
    WHERE h.raw_text LIKE '%and is all-in%'
      AND (SELECT COUNT(*) FROM hand_players hp WHERE hp.hand_id = h.hand_id AND hp.ev_adjustment_bb IS NOT NULL) != 2
  `).all();
  if (rows.length === 0) return 0;

  const update = db.prepare(`
    UPDATE hand_players SET ev_adjustment_bb = ?
    WHERE hand_id = ? AND player_name = ?
  `);
  let fixed = 0;
  db.exec('BEGIN');
  try {
    for (const r of rows) {
      const evResult = computeHandEVAdjustment(r.rawText);
      if (!evResult) continue; // mentions "all-in" but doesn't actually qualify — see the comment above
      for (const pl of evResult.players) update.run(pl.adjustmentBB, r.handId, pl.name);
      fixed++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return fixed;
}

function getDistinctValues(db, filters) {
  const f = filters || {};
  const { where, params } = buildWhereClause({ perspectivePlayer: f.perspectivePlayer });
  const positions = db.prepare(`SELECT DISTINCT hp.position AS v FROM hands h JOIN hand_players hp ON hp.hand_id = h.hand_id WHERE ${where} AND hp.position IS NOT NULL`).all(...params).map((r) => r.v);
  const stakes = db.prepare(`SELECT DISTINCT h.stakes_label AS v FROM hands h JOIN hand_players hp ON hp.hand_id = h.hand_id WHERE ${where} AND h.stakes_label IS NOT NULL`).all(...params).map((r) => r.v);
  const tableCategories = db.prepare(`SELECT DISTINCT h.table_category AS v FROM hands h JOIN hand_players hp ON hp.hand_id = h.hand_id WHERE ${where} AND h.table_category IS NOT NULL`).all(...params).map((r) => r.v);

  const sortedStakes = stakes.sort((a, b) => {
    const bbOf = (label) => parseFloat((/\/\$([0-9.]+)/.exec(label) || [, '0'])[1]);
    return bbOf(a) - bbOf(b);
  });
  return { positions: positions.sort(), stakes: sortedStakes, tableCategories: tableCategories.sort() };
}

/**
 * Every raw hand row for a given perspective (hero by default, or a named
 * player), matching the same filters as queryHands — used to feed the
 * stats engine so Stats reflects exactly the same filtered set the Hands
 * tab is showing, not the whole unfiltered database.
 */
function queryRawHandsForStats(db, filters) {
  const f = filters || {};
  const { where, params } = buildWhereClause(f);
  const rows = db.prepare(`
    SELECT h.raw_text AS rawText, hp.player_name AS playerName, hp.net, h.bb_stake AS bbStake,
           hp.ev_adjustment_bb AS evAdjustmentBB, h.stakes_label AS stakesLabel
    FROM hands h JOIN hand_players hp ON hp.hand_id = h.hand_id
    WHERE ${where} AND h.skipped = 0
  `).all(...params);
  return rows;
}

/**
 * Lightweight VPIP/PFR/hand-count lookup for a batch of player names at
 * once — powers the hand-detail replay's per-seat stat column (the
 * DriveHUD-style "29/21 (316)" readout). Deliberately a raw SQL aggregate
 * over hand_players rather than analyzeHand/aggregateStats: those exist to
 * build the full HUD from raw text, which would mean re-parsing every hand
 * a player has ever been seated in just to show three numbers next to
 * their name. Bomb pots are excluded from both the numerator and
 * denominator, matching the same convention aggregateStats uses for
 * VPIP/PFR everywhere else in the app (see src/stats.js's `nonBomb`).
 */
function getQuickPlayerStats(db, playerNames) {
  const names = [...new Set((playerNames || []).filter(Boolean))];
  if (names.length === 0) return {};
  const placeholders = names.map(() => '?').join(', ');
  const rows = db.prepare(`
    SELECT hp.player_name AS name, COUNT(*) AS hands,
           SUM(hp.vpip) AS vpipCount, SUM(hp.pfr) AS pfrCount,
           SUM(hp.three_bet) AS threeBetCount, SUM(hp.faced_three_bet_opportunity) AS threeBetOppCount,
           SUM(hp.postflop_agg_count) AS aggCount, SUM(hp.postflop_agg_denom) AS aggDenom
    FROM hand_players hp
    JOIN hands h ON h.hand_id = hp.hand_id
    WHERE hp.player_name IN (${placeholders}) AND h.skipped = 0 AND h.table_type != 'bombpot'
    GROUP BY hp.player_name
  `).all(...names);
  const result = {};
  for (const r of rows) {
    result[r.name] = {
      hands: r.hands,
      vpip: r.hands ? Math.round((r.vpipCount / r.hands) * 100) : null,
      pfr: r.hands ? Math.round((r.pfrCount / r.hands) * 100) : null,
      threeBet: r.threeBetOppCount ? Math.round((r.threeBetCount / r.threeBetOppCount) * 100) : null,
      aggPct: r.aggDenom ? Math.round((r.aggCount / r.aggDenom) * 100) : null,
    };
  }
  return result;
}

/**
 * Fetches one full hand by ID — hand-level fields plus a specific player's
 * row (their position, cards if known, net, etc) — for the detail
 * sub-window. perspectivePlayer selects which seated player's row to use;
 * defaults to whoever was hero in that hand's own source file if omitted,
 * matching the original behavior for any caller that doesn't care which
 * player. Includes the raw text (needed there to regenerate converted
 * text / build the replay).
 */
function getHandById(db, handId, perspectivePlayer) {
  const hand = db.prepare('SELECT * FROM hands WHERE hand_id = ?').get(handId);
  if (!hand) return null;
  const player = perspectivePlayer
    ? db.prepare('SELECT * FROM hand_players WHERE hand_id = ? AND player_name = ?').get(handId, perspectivePlayer)
    : db.prepare('SELECT * FROM hand_players WHERE hand_id = ? AND is_hero = 1').get(handId);
  return {
    handId: hand.hand_id,
    sourceFile: hand.source_file,
    date: hand.date,
    time: hand.time,
    stakesLabel: hand.stakes_label,
    maxSeats: hand.max_seats,
    tableType: hand.table_type,
    tableCategory: hand.table_category,
    board: hand.board,
    potSize: hand.pot_size,
    raw: hand.raw_text,
    skipped: !!hand.skipped,
    skipReason: hand.skip_reason,
    playerName: player ? player.player_name : null,
    position: player ? player.position : null,
    handCategory: player ? player.hand_category : null,
    heroCards: player ? player.hole_cards : null,
    net: player ? player.net : null,
    vpip: player ? !!player.vpip : null,
    pfr: player ? !!player.pfr : null,
    wentToShowdown: player ? !!player.went_to_showdown : null,
    won: player ? !!player.won : null,
    evAdjustmentBB: player ? player.ev_adjustment_bb : null,
  };
}

module.exports = {
  buildHandRecords, getConvertedText, importFileIntoStore, queryHands, getDistinctValues,
  queryRawHandsForStats, getHandById, getHeroPlayerNames, getAllPlayerNames,
  getTotalHandCount, backfillDeepStats, backfillEVAdjustments, getQuickPlayerStats,
};
