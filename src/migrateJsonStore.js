'use strict';

const fs = require('fs');
const { buildHandRecords, importFileIntoStore } = require('./handStore');
const { splitHands } = require('./converter');

/**
 * Migrates an old JSON-format hand store (one flat object keyed by hand ID,
 * each record holding the raw Weplay text plus hero-only fields) into the
 * new SQLite database. Re-derives everything from each record's raw text
 * via the same buildHandRecords() used for normal imports — rather than
 * trying to map the old flat shape field-by-field into the new two-table
 * one — so a migrated hand is byte-for-byte the same as if it had just been
 * freshly imported, multi-player rows included.
 *
 * Safe to call even if the JSON file doesn't exist (nothing to migrate) or
 * is corrupted (skipped, not fatal — matches the old store's own
 * fail-safe behavior for a corrupted file).
 */
function migrateJsonStoreIfPresent(db, jsonStorePath, options) {
  if (!fs.existsSync(jsonStorePath)) return { migrated: false };

  let oldStore;
  try {
    oldStore = JSON.parse(fs.readFileSync(jsonStorePath, 'utf-8'));
  } catch (err) {
    return { migrated: false, error: `Old hand database file was unreadable, skipped: ${err.message}` };
  }

  const records = Object.values(oldStore);
  if (records.length === 0) return { migrated: false };

  // Group by source file so importFileIntoStore's one-transaction-per-file
  // batching still applies — re-splitting each stored raw block back through
  // splitHands (a no-op for a single already-split hand, since it just
  // returns the one block unchanged when there's nothing to split) keeps
  // this on the exact same import path as everything else, rather than a
  // separate one-off insertion routine that could quietly drift from it.
  const bySourceFile = new Map();
  for (const r of records) {
    const key = r.sourceFile || '(unknown source)';
    if (!bySourceFile.has(key)) bySourceFile.set(key, []);
    bySourceFile.get(key).push(r.raw);
  }

  let totalAdded = 0, totalUpdated = 0, totalSkipped = 0;
  for (const [sourceFile, rawBlocks] of bySourceFile) {
    const combinedText = rawBlocks.join('\n\n');
    const result = importFileIntoStore(db, combinedText, sourceFile, options, splitHands);
    totalAdded += result.added;
    totalUpdated += result.updated;
    totalSkipped += result.skipped;
  }

  // Rename rather than delete — keeps the old data recoverable if anything
  // about the migration looks wrong, without leaving it in the way of a
  // fresh JSON-store creation attempt on a future older app version.
  const backupPath = `${jsonStorePath}.migrated-backup`;
  try {
    fs.renameSync(jsonStorePath, backupPath);
  } catch (err) {
    // Non-fatal — the migration itself already succeeded; failing to
    // rename the old file just means it's still sitting there unused.
  }

  return { migrated: true, added: totalAdded, updated: totalUpdated, skipped: totalSkipped, totalRecords: records.length };
}

module.exports = { migrateJsonStoreIfPresent };
