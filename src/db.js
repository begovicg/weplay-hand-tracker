'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

// Two tables, not one: `hands` holds hand-level facts (date, stakes, board,
// pot — true regardless of who's looking at the hand), `hand_players` holds
// one row per player who was seated in that hand. This split is what makes
// it possible to store a hand nobody you know played in (a friend's export,
// where "hero" is simply whichever hole cards happen to be revealed in that
// file), and to query by ANY player's name later — "which hands did X play"
// is the same shape of query as "which hands did I play", not a special case.
//
// Deep stats (VPIP, PFR, hand category, EV adjustment) are populated for
// EVERY seated player, not just is_hero=1 — see src/handStore.js's
// buildHandRecords. is_hero itself just marks "this player's own client
// exported this hand at least once" (can be true for more than one player
// on the same hand, once a shared/pooled database has hands imported from
// multiple people who sat at the same table — see UPSERT_PLAYER_SQL in
// handStore.js for how re-importing the same hand from a second person's
// file merges rather than clobbers the first person's data), used as the
// default perspective when a query doesn't name a specific player. What's
// populated for every player regardless of is_hero: seat, position,
// starting stack, hole cards (when known — that player's own via their own
// export, or anyone who showed at a real showdown), and whether they won /
// reached showdown (both cheaply readable off the hand's own
// showdown/winners data regardless of whose perspective is being viewed).

const SCHEMA = `
CREATE TABLE IF NOT EXISTS hands (
  hand_id         TEXT PRIMARY KEY,
  source_file     TEXT,
  imported_at     INTEGER,
  date            TEXT,
  time            TEXT,
  sb_stake        REAL,
  bb_stake        REAL,
  stakes_label    TEXT,
  max_seats       INTEGER,
  table_type      TEXT,
  table_category  TEXT,
  is_run_twice    INTEGER,
  board           TEXT,
  pot_size        REAL,
  rake            REAL,
  skipped         INTEGER,
  skip_reason     TEXT,
  raw_text        TEXT
);

CREATE INDEX IF NOT EXISTS idx_hands_date ON hands(date);
CREATE INDEX IF NOT EXISTS idx_hands_stakes ON hands(stakes_label);
CREATE INDEX IF NOT EXISTS idx_hands_table_category ON hands(table_category);
CREATE INDEX IF NOT EXISTS idx_hands_skipped ON hands(skipped);

CREATE TABLE IF NOT EXISTS hand_players (
  hand_id                TEXT NOT NULL REFERENCES hands(hand_id) ON DELETE CASCADE,
  player_name            TEXT NOT NULL,
  is_hero                INTEGER,
  seat                   INTEGER,
  position               TEXT,
  starting_stack         REAL,
  hole_cards             TEXT,
  net                    REAL,
  vpip                   INTEGER,
  pfr                    INTEGER,
  saw_flop               INTEGER,
  hand_category          TEXT,
  went_to_showdown       INTEGER,
  won                    INTEGER,
  ev_adjustment_bb       REAL,
  -- Advanced-filters action flags (see buildHandRecords in handStore.js) —
  -- all sourced straight from analyzeHand's existing return object
  -- (src/stats.js), never a new computation, just newly persisted.
  rfi                    INTEGER,
  cold_call              INTEGER,
  limped                 INTEGER,
  three_bet              INTEGER,
  folded_to_three_bet    INTEGER,
  four_bet               INTEGER,
  folded_to_four_bet     INTEGER,
  squeeze                INTEGER,
  attempt_steal          INTEGER,
  folded_to_steal        INTEGER,
  cbet_flop              INTEGER,
  cbet_turn              INTEGER,
  cbet_river             INTEGER,
  folded_to_cbet_flop    INTEGER,
  folded_to_cbet_turn    INTEGER,
  folded_to_cbet_river   INTEGER,
  check_raise_flop       INTEGER,
  check_raise_turn       INTEGER,
  check_raise_river      INTEGER,
  won_at_showdown        INTEGER,
  won_when_saw_flop      INTEGER,
  -- HUD quick-stats (see getQuickPlayerStats in handStore.js): the raw
  -- counts a batched SQL query needs to build 3-Bet% and Agg% without
  -- re-parsing raw hand text per player. faced_three_bet_opportunity is
  -- the exact denominator aggregateStats already uses for 3-Bet%;
  -- postflop_agg_count/postflop_agg_denom are analyzeHand's streetAgg
  -- (bets+raises, and bets+raises+calls+folds+checks) summed across
  -- flop/turn/river.
  faced_three_bet_opportunity INTEGER,
  postflop_agg_count     INTEGER,
  postflop_agg_denom     INTEGER,
  PRIMARY KEY (hand_id, player_name)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_hp_player ON hand_players(player_name);
CREATE INDEX IF NOT EXISTS idx_hp_hero ON hand_players(is_hero);
CREATE INDEX IF NOT EXISTS idx_hp_hand_category ON hand_players(hand_category);
CREATE INDEX IF NOT EXISTS idx_hp_position ON hand_players(position);
CREATE INDEX IF NOT EXISTS idx_hp_net ON hand_players(net);

-- Small key/value store for app-level config (currently just Live Sync's
-- watched folder + enabled flag — see src/liveSync.js) — a real table
-- rather than a separate JSON settings file, so it lives in the same
-- database file/connection/backup as everything else instead of being a
-- second thing that can go out of sync with it.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
) WITHOUT ROWID;
`;

function openDatabase(filePath) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(filePath);
  // WAL mode: readers (the hand list, stats) don't block on a writer
  // (an in-progress import) — matters once imports can take tens of
  // seconds for a batch with several all-in hands needing EV computation.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // Two connections to this same file are expected now: the main process's
  // own, and the background backfill worker's (see src/backfillWorker.js) —
  // WAL mode already lets them coexist (one writer, readers unblocked), but
  // if both happen to write in the same instant one gets SQLITE_BUSY. A
  // busy timeout makes that a brief retry instead of a thrown error.
  db.exec('PRAGMA busy_timeout = 5000');
  db.exec(SCHEMA);
  // CREATE TABLE IF NOT EXISTS only helps brand-new databases — an already-
  // existing database file on someone's disk keeps whatever columns it had
  // when it was first created, so a column added to SCHEMA later (like
  // saw_flop) needs an explicit, idempotent ALTER TABLE for databases that
  // already existed before that column was added.
  ensureColumn(db, 'hand_players', 'saw_flop', 'INTEGER');
  // Same idempotent migration for every advanced-filters column added
  // alongside saw_flop's own precedent — a pre-existing database keeps
  // whatever columns it had when created, regardless of what SCHEMA says now.
  for (const col of [
    'rfi', 'cold_call', 'limped', 'three_bet', 'folded_to_three_bet',
    'four_bet', 'folded_to_four_bet', 'squeeze', 'attempt_steal', 'folded_to_steal',
    'cbet_flop', 'cbet_turn', 'cbet_river',
    'folded_to_cbet_flop', 'folded_to_cbet_turn', 'folded_to_cbet_river',
    'check_raise_flop', 'check_raise_turn', 'check_raise_river',
    'won_at_showdown', 'won_when_saw_flop',
    'faced_three_bet_opportunity', 'postflop_agg_count', 'postflop_agg_denom',
  ]) {
    ensureColumn(db, 'hand_players', col, 'INTEGER');
  }
  return db;
}

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

// getSetting returns null for a key that was never set (not undefined —
// callers can == null check the same way they already do for nullable DB
// columns elsewhere in this app).
function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : null;
}

function setSetting(db, key, value) {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value);
}

module.exports = { openDatabase, SCHEMA, getSetting, setSetting };
