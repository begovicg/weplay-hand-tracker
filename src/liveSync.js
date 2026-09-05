'use strict';

// Live Sync: watches the folder Weplay itself writes hand histories to
// (one .txt file per table, appended to throughout a live session — see
// the real files this was built against: "HH20260812 Liverpool Bomb Pot 1
// (3BB) (#11786814) - $0.25-$0.50 - Money 3 No Limit Hold_em.txt") and
// imports new hands as they land, using the exact same
// importFileIntoStore pipeline the manual "Import to Hand Database"
// button already uses — no separate parsing path to keep in sync.
//
// Deliberately mtime-based, not byte-offset-based: re-reading and
// re-importing a file's FULL current content on every change is simpler
// and more robust than tracking a read cursor per file (which breaks if a
// file is ever rewritten from scratch, truncated, or the app misses an
// event), and importFileIntoStore's UPSERT is already idempotent — hands
// already in the database just get re-merged, not duplicated. Re-parsing
// a few hundred KB of text is sub-second (see buildHandRecords' own
// ~0.66ms/hand figure), which is fast enough for how often a single table
// file actually changes (at most once per completed hand).

const fs = require('fs');
const path = require('path');
const { importFileIntoStore } = require('./handStore');
const { splitHands } = require('./converter');

/**
 * Scans `folderPath` for .txt files and imports every one whose mtime is
 * newer than what's recorded in `seen` (a Map<filename, mtimeMs>, mutated
 * in place so repeated calls only reprocess what's actually changed).
 * Used both for the initial catch-up scan when Live Sync turns on (seen
 * starts empty, so everything currently in the folder gets imported once)
 * and for every subsequent fs.watch-triggered rescan.
 */
function scanAndImport(db, folderPath, seen, options) {
  const totals = { added: 0, updated: 0, skipped: 0, filesProcessed: 0, errors: [] };
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    totals.errors.push(`Could not read folder: ${err.message}`);
    return totals;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !/\.txt$/i.test(entry.name)) continue;
    const filePath = path.join(folderPath, entry.name);
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue; // removed between readdir and stat — skip, not an error worth surfacing
    }
    const lastSeenMtime = seen.get(entry.name);
    if (lastSeenMtime != null && lastSeenMtime >= stat.mtimeMs) continue;

    let content;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch (err) {
      totals.errors.push(`${entry.name}: ${err.message}`);
      continue;
    }
    const result = importFileIntoStore(db, content, entry.name, options, splitHands);
    seen.set(entry.name, stat.mtimeMs);
    totals.added += result.added;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    totals.filesProcessed++;
  }
  return totals;
}

/**
 * Starts watching `folderPath`, calling `onChange(totals)` after every
 * scan that actually touches at least one file (both the immediate
 * catch-up scan and every debounced fs.watch-triggered rescan after).
 * Debounced rather than reacting to each raw fs.watch event 1:1 — Windows
 * fires several 'change' events per single logical write (and per file,
 * across however many of the 1-6 open tables just completed a hand at
 * once), so this coalesces a burst into one rescan ~1s after it quiets
 * down instead of thrashing the DB on every individual event.
 *
 * Returns a stop() function that closes the watcher and cancels any
 * pending debounced scan.
 */
function startLiveSync(db, folderPath, options, onChange) {
  const seen = new Map();
  let debounceTimer = null;

  const runScan = () => {
    const totals = scanAndImport(db, folderPath, seen, options);
    if (totals.filesProcessed > 0 || totals.errors.length > 0) onChange(totals);
    return totals;
  };

  runScan(); // catch-up: import anything already in the folder before we started watching

  const watcher = fs.watch(folderPath, { persistent: true }, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(runScan, 1000);
  });
  watcher.on('error', (err) => onChange({ added: 0, updated: 0, skipped: 0, filesProcessed: 0, errors: [`Watcher error: ${err.message}`] }));

  function stop() {
    clearTimeout(debounceTimer);
    watcher.close();
  }
  // Exposed for an explicit "rescan now" request (a Refresh Now button) —
  // runs the exact same scan immediately, bypassing the 1s debounce, and
  // always returns the totals synchronously (scanAndImport is plain
  // synchronous fs/SQLite I/O), regardless of whether onChange decided
  // there was anything worth pushing to the UI on its own. Attached to
  // `stop` rather than changing this function's return shape to an object
  // — every existing caller/test already treats the return value as
  // directly callable.
  stop.rescanNow = runScan;
  return stop;
}

module.exports = { scanAndImport, startLiveSync };
