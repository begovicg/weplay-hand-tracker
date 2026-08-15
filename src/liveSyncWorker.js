'use strict';

// Runs Live Sync (src/liveSync.js) on its own worker thread, with its own
// SQLite connection — same reasoning as src/backfillWorker.js: the initial
// catch-up scan re-parses every hand-history file already sitting in the
// watched folder (idempotent, but not free — measured at ~56 seconds
// against a real 62-file, 29,000-hand folder), and running that
// synchronously on the Electron MAIN thread would block its native window
// message pump for the whole scan, exactly the "Not Responding" regression
// backfillWorker.js was already built to avoid for the database backfill.
// A worker thread has its own event loop entirely, so however long the
// scan takes — catch-up or any later debounced rescan — the main thread
// (and the window it owns) is never blocked by it.
//
// No Electron APIs are available here (workers spawned this way don't get
// Electron's renderer/main-specific globals) — dbPath/folderPath/options
// are passed in via workerData instead of reading them from main.js
// directly.
//
// Unlike backfillWorker.js this doesn't exit when done — Live Sync keeps
// watching for as long as this worker is alive. main.js's stopLiveSync()
// tears it down with worker.terminate() when the user turns it off (or the
// app closes); there's no graceful shutdown message needed since there's
// no in-flight write this could interrupt mid-transaction —
// importFileIntoStore's own BEGIN/COMMIT already makes each file's import
// atomic.

const { parentPort, workerData } = require('node:worker_threads');
const { openDatabase } = require('./db');
const { startLiveSync } = require('./liveSync');

const db = openDatabase(workerData.dbPath);
startLiveSync(db, workerData.folderPath, workerData.options, (totals) => {
  parentPort.postMessage({ phase: 'update', ...totals });
});
