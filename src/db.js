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
  hand_id           TEXT NOT NULL REFERENCES hands(hand_id) ON DELETE CASCADE,
  player_name       TEXT NOT NULL,
  is_hero           INTEGER,
  seat              INTEGER,
  position          TEXT,
  starting_stack    REAL,
  hole_cards        TEXT,
  net               REAL,
  vpip              INTEGER,
  pfr               INTEGER,
  saw_flop          INTEGER,
  hand_category     TEXT,
  went_to_showdown  INTEGER,
  won               INTEGER,
  ev_adjustment_bb  REAL,
  PRIMARY KEY (hand_id, player_name)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS idx_hp_player ON hand_players(player_name);
CREATE INDEX IF NOT EXISTS idx_hp_hero ON hand_players(is_hero);
CREATE INDEX IF NOT EXISTS idx_hp_hand_category ON hand_players(hand_category);
CREATE INDEX IF NOT EXISTS idx_hp_position ON hand_players(position);
CREATE INDEX IF NOT EXISTS idx_hp_net ON hand_players(net);
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
  return db;
}

function ensureColumn(db, table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

module.exports = { openDatabase, SCHEMA };
