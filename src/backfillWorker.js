'use strict';

// Runs the one-time database backfills (src/handStore.js's backfillDeepStats
// and backfillEVAdjustments) on a separate worker thread, with its own SQLite
// connection to the same database file — see main.js for why: these can take
// anywhere from seconds to several minutes on a real multi-thousand-hand
// database (each qualifying EV-adjustment hand needs its own equity
// computation, up to ~1 second for a Monte Carlo preflop/flop all-in), and
// running that much synchronous work on the Electron MAIN thread blocks its
// native window message pump long enough for Windows to mark the app "Not
// Responding" — a real, reported regression once EV adjustment was
// generalized to cover every all-in in the database, not just hero's own.
// A worker thread has its own event loop entirely, so however long this
// takes, the main thread (and the window it owns) is never blocked by it.
//
// No Electron APIs are available here (workers spawned this way don't get
// Electron's renderer/main-specific globals) — dbPath is passed in via
// workerData instead of calling app.getPath() directly.

const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('./db');
const { backfillDeepStats, backfillEVAdjustments } = require('./handStore');
const { analyzeHand } = require('./stats');

parentPort.postMessage({ phase: 'start' });

try {
  const db = openDatabase(workerData.dbPath);
  const deepStatsFixed = backfillDeepStats(db, analyzeHand);
  const evFixed = backfillEVAdjustments(db);
  db.close();
  parentPort.postMessage({ phase: 'done', deepStatsFixed, evFixed });
} catch (err) {
  parentPort.postMessage({ phase: 'error', error: err.message });
}
