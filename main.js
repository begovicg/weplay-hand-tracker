'use strict';

const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { convertFile } = require('./src/converter');
const { createZip } = require('./src/zipWriter');
const { extractTextFiles } = require('./src/zipReader');
const { openDatabase } = require('./src/db');
const {
  importFileIntoStore, queryHands, getDistinctValues, getHandById, getConvertedText,
  queryRawHandsForStats, getAllPlayerNames,
  getTotalHandCount, backfillDeepStats,
} = require('./src/handStore');
const { migrateJsonStoreIfPresent } = require('./src/migrateJsonStore');
const { buildHandReplay } = require('./src/handReplay');
const { analyzeHand, aggregateStats } = require('./src/stats');
const { splitHands } = require('./src/converter');

let mainWindow;
const handWindows = new Map(); // "handId::perspectivePlayer" -> BrowserWindow, so re-clicking the same hand (from the same perspective) focuses instead of duplicating

// ── Hand database ────────────────────────────────────────────────────────
// SQLite (via Node's built-in node:sqlite — no external dependency needed;
// see src/db.js for the schema and why it's split into two tables). Opened
// once on first use; a pre-existing JSON-format store from an older version
// of this app is migrated in automatically the first time, then renamed
// aside as a backup — see src/migrateJsonStore.js.

const dbPath = path.join(app.getPath('userData'), 'hands.db');
const oldJsonStorePath = path.join(app.getPath('userData'), 'hands.json');
let db = null;

function getDb() {
  if (db === null) {
    db = openDatabase(dbPath);
    const migration = migrateJsonStoreIfPresent(db, oldJsonStorePath, { replaceHeroName: true });
    if (migration.migrated) {
      console.log(`Migrated ${migration.totalRecords} hands from the old JSON store (${migration.added} added, ${migration.updated} updated, ${migration.skipped} skipped).`);
    }
    // One-time backfill covering two real gaps: hands imported before
    // saw_flop existed (hero rows, net already populated but saw_flop
    // still NULL), and — since deep stats now compute for every seated
    // player, not just hero — every non-hero row from before that change,
    // which never had net/VPIP/PFR/etc computed at all. Idempotent: once
    // every row has a real value, this finds nothing left to do and is a
    // fast no-op on every subsequent launch. Verified against this
    // project's real 22,888-hand batch (140,253 total player-rows across
    // every seated player) at under 10 seconds worst-case.
    const backfilled = backfillDeepStats(db, analyzeHand);
    if (backfilled > 0) {
      console.log(`Backfilled deep stats for ${backfilled} player-hand row(s) from before this was computed for every seated player.`);
    }
  }
  return db;
}

function closeDb() {
  if (db) {
    try { db.close(); } catch (err) { /* already closed or unusable, nothing to do */ }
    db = null;
  }
}

// Confirms a file is actually a Weplay Hand Tracker database (has the two
// tables this app depends on) before committing to overwriting the current
// one with it — a plain open-and-query, not the full openDatabase() (which
// would run schema creation and migrations directly against the CANDIDATE
// file as a side effect, before the person has even confirmed they want to
// use it).
function looksLikeValidHandDatabase(filePath) {
  let testDb;
  try {
    testDb = new DatabaseSync(filePath);
    const tables = testDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('hands','hand_players')").all();
    testDb.close();
    return tables.length === 2;
  } catch (err) {
    if (testDb) { try { testDb.close(); } catch (e) { /* ignore */ } }
    return false;
  }
}

// Backs up the entire database — everything, no filters — as a real
// standalone .db file someone could hand to another machine or just keep
// safe. Different from Export from Database (Import Hands tab), which is a
// filtered subset in plain text for sharing specific hands, not a full
// disaster-recovery copy. WAL mode means recent writes can sit in a
// separate -wal sidecar file rather than the main .db file itself — a
// plain file copy of just hands.db could miss them, so this checkpoints
// first (flushes everything into the main file, verified directly: a WAL
// file with several MB of pending data drops to zero bytes after this),
// then copies the one now-self-contained file.
ipcMain.handle('backup-database', async (event) => {
  const database = getDb();
  database.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  const win = BrowserWindow.fromWebContents(event.sender);
  const today = new Date().toISOString().slice(0, 10);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Backup Hand Database',
    defaultPath: `weplay-hands-backup-${today}.db`,
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.copyFileSync(dbPath, filePath);
  return { saved: true, path: filePath, hands: getTotalHandCount(database) };
});

// Restores the database from a chosen backup file — a real, deliberately
// cautious swap, not a plain overwrite: validates the chosen file actually
// looks like a hand-tracker database first (rejecting a random file before
// anything is touched), and always preserves the CURRENT database to a
// fixed sidecar path first regardless of whether the choice was correct —
// a mistaken restore should never be a one-way door. Stale -wal/-shm
// sidecar files from the previous database are removed too, so they can't
// get incorrectly replayed against the newly-restored file. Re-opening
// afterward runs the same schema/migration/backfill path as any normal
// startup, so a backup from an older version of this app catches up
// automatically rather than needing anything manual.
ipcMain.handle('restore-database', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Restore Hand Database From Backup',
    filters: [{ name: 'SQLite Database', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths || !filePaths[0]) return { restored: false };
  const chosenPath = filePaths[0];

  if (!looksLikeValidHandDatabase(chosenPath)) {
    return { restored: false, error: 'That file doesn\'t look like a Weplay Hand Tracker database — the expected tables weren\'t found.' };
  }

  closeDb();
  if (fs.existsSync(dbPath)) fs.copyFileSync(dbPath, `${dbPath}.pre-restore-backup`);
  fs.copyFileSync(chosenPath, dbPath);
  for (const ext of ['-wal', '-shm']) {
    const sidecar = dbPath + ext;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }

  const database = getDb();
  return { restored: true, hands: getTotalHandCount(database) };
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 720,
    minHeight: 560,
    backgroundColor: '#0e0e0f',
    title: 'Weplay Hand Tracker',
    icon: path.join(__dirname, 'build', 'icon.png'),
    // Not shown until maximized and ready — avoids a visible flash of a
    // small window snapping to fullscreen size a moment after appearing.
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });
  mainWindow.setMenuBarVisibility(false);
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC: app version (so the UI can show it, and so mismatched-build issues
// like "I downloaded a new zip but it looks like the old version" are
// obvious at a glance instead of a guessing game) ──────────────────────────

ipcMain.handle('get-app-version', async () => app.getVersion());

// ── IPC: pick files ──────────────────────────────────────────────────────

ipcMain.handle('pick-files', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select Weplay hand history files or .zip archives',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Weplay hand histories & zip archives', extensions: ['txt', 'zip'] },
      { name: 'Weplay hand histories (.txt)', extensions: ['txt'] },
      { name: 'Zip archives (.zip)', extensions: ['zip'] },
    ],
  });
  if (result.canceled) return { files: [], errors: [] };

  const files = [];
  const errors = [];
  for (const filePath of result.filePaths) {
    const baseName = path.basename(filePath);
    if (/\.zip$/i.test(filePath)) {
      try {
        const buf = fs.readFileSync(filePath);
        const extracted = extractTextFiles(buf);
        if (extracted.length === 0) errors.push(`${baseName}: no .txt hand history files found inside`);
        files.push(...extracted);
      } catch (err) {
        errors.push(`${baseName}: ${err.message}`);
      }
    } else {
      files.push({ name: baseName, content: fs.readFileSync(filePath, 'utf-8') });
    }
  }
  return { files, errors };
});

ipcMain.handle('parse-zip-buffer', async (event, arrayBuffer, zipName) => {
  const buf = Buffer.from(arrayBuffer);
  try {
    const extracted = extractTextFiles(buf);
    if (extracted.length === 0) return { files: [], error: `${zipName}: no .txt hand history files found inside` };
    return { files: extracted, error: null };
  } catch (err) {
    return { files: [], error: `${zipName}: ${err.message}` };
  }
});

ipcMain.handle('read-file', async (event, filePath) => {
  return fs.readFileSync(filePath, 'utf-8');
});

// ── IPC: convert a batch of files ───────────────────────────────────────

ipcMain.handle('convert-files', async (event, files, options) => {
  // files: [{ name, content }]
  const results = files.map((f) => {
    const outcome = convertFile(f.content, options);
    const outName = f.name.replace(/\.txt$/i, '') + '_coinpoker.txt';
    return {
      inputName: f.name,
      outputName: outName,
      text: outcome.text,
      handCount: outcome.handCount,
      skippedHands: outcome.skippedHands,
      warnings: outcome.warnings,
      heroName: outcome.heroName,
      flaggedHands: outcome.flaggedHands,
    };
  });
  return results;
});

// ── IPC: stats from the persistent hand database ────────────────────────
// The Stats tab now always reflects whatever's actually saved in the
// database, not a separate "analyze whatever's currently loaded" flow —
// re-runs the same analyzeHand() used everywhere else in this app against
// every stored hand's raw text (not a lighter/duplicated computation),
// so this can never silently drift from what querying/filtering the
// database itself would show.

ipcMain.handle('get-persistent-stats', async (event, filters) => {
  const database = getDb();
  const rows = queryRawHandsForStats(database, filters || {});
  const allHands = [];
  let excludedCount = 0;
  for (const row of rows) {
    const result = analyzeHand(row.rawText, row.playerName);
    if (result) allHands.push(result); else excludedCount++;
  }
  const stats = aggregateStats(allHands);

  // EV winrate: reads each hand's EV adjustment straight from the database
  // (computed once at import time — see src/handStore.js and
  // src/evAnalysis.js), rather than recomputing it here. Recomputing would
  // mean re-running Monte Carlo equity sampling for every qualifying hand on
  // every single Stats tab visit, which measured at over 30 seconds for a
  // real 22,889-hand database — fine as a one-time import cost, not
  // acceptable to repeat every time someone just wants to check their stats.
  let evBbSum = 0, evHandCount = 0, evAdjustedHandCount = 0;
  for (const row of rows) {
    if (row.net == null || !row.stakesLabel) continue;
    const bbMatch = /\/\$([0-9.]+)$/.exec(row.stakesLabel);
    const bb = bbMatch ? parseFloat(bbMatch[1]) : null;
    if (!bb) continue;
    const adjustment = row.evAdjustmentBB || 0;
    if (row.evAdjustmentBB != null) evAdjustedHandCount++;
    evBbSum += row.net / bb + adjustment;
    evHandCount++;
  }
  const evBb100 = evHandCount > 0 ? (evBbSum / evHandCount) * 100 : null;

  return { stats, excludedCount, totalStoredHands: rows.length, evBb100, evAdjustedHandCount };
});

// ── IPC: save results (single file, or zip if multiple) ────────────────

ipcMain.handle('save-results', async (event, results) => {
  if (results.length === 1) {
    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save converted hand history',
      defaultPath: results[0].outputName,
      filters: [{ name: 'Text file', extensions: ['txt'] }],
    });
    if (canceled || !filePath) return { saved: false };
    fs.writeFileSync(filePath, results[0].text, 'utf-8');
    return { saved: true, path: filePath };
  }

  const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
    title: 'Save converted hand histories',
    defaultPath: 'weplay_converted.zip',
    filters: [{ name: 'Zip archive', extensions: ['zip'] }],
  });
  if (canceled || !filePath) return { saved: false };
  const zipBuf = createZip(results.map((r) => ({ name: r.outputName, content: r.text })));
  fs.writeFileSync(filePath, zipBuf);
  return { saved: true, path: filePath };
});

// ── IPC: hand database ───────────────────────────────────────────────────

ipcMain.handle('import-to-hand-store', async (event, files, options) => {
  const database = getDb();
  const totals = { added: 0, updated: 0, skipped: 0, total: 0 };
  for (const f of files) {
    const result = importFileIntoStore(database, f.content, f.name, options, splitHands);
    totals.added += result.added;
    totals.updated += result.updated;
    totals.skipped += result.skipped;
    totals.total += result.total;
  }
  totals.grandTotal = getTotalHandCount(database);
  return totals;
});

// Exports whatever the shared filter bar currently matches, straight from
// the database — not the currently-loaded files, which is a separate,
// unrelated set. queryRawHandsForStats already returns every matching
// hand's raw text unpaginated (built for the Stats tab, reused here as-is,
// same WHERE clause as everything else so "export" always means exactly
// what the filters show elsewhere in the app). Two output formats: the
// original Weplay text as stored, or converted to CoinPoker format on the
// way out (the same converter already used for "Convert & Save" and the
// formatted hand viewer) — one combined .txt file either way, multiple
// hands separated by a blank line, matching the same multi-hand file shape
// this app already knows how to read back in.
ipcMain.handle('export-filtered-hands', async (event, filters, format) => {
  const database = getDb();
  const rows = queryRawHandsForStats(database, filters || {});
  if (rows.length === 0) return { saved: false, count: 0 };

  const parts = format === 'converted'
    ? rows.map((r) => getConvertedText(r.rawText, { replaceHeroName: true })).filter(Boolean)
    : rows.map((r) => r.rawText);
  const combinedText = parts.join('\n\n');

  const win = BrowserWindow.fromWebContents(event.sender);
  const formatSlug = format === 'converted' ? 'coinpoker' : 'weplay';
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Export Filtered Hands',
    defaultPath: `weplay-export-${formatSlug}-${parts.length}-hands.txt`,
    filters: [{ name: 'Text File', extensions: ['txt'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, combinedText);
  return { saved: true, count: parts.length, path: filePath };
});

ipcMain.handle('query-hands', async (event, filters) => {
  return queryHands(getDb(), filters);
});

ipcMain.handle('get-filter-options', async (event, filters) => {
  return getDistinctValues(getDb(), filters);
});

ipcMain.handle('get-all-players', async () => {
  return getAllPlayerNames(getDb());
});

ipcMain.handle('get-hand-detail', async (event, handId, perspectivePlayer, options) => {
  const record = getHandById(getDb(), handId, perspectivePlayer);
  if (!record) return null;
  // The formatted replay view highlights whichever player is being viewed
  // as "hero" (bold action lines, the "Dealt to X" line) — passing
  // perspectivePlayer through here too, not just to getHandById, keeps the
  // formatted view and the returned position/net/etc fields showing the
  // same player consistently, rather than the view defaulting back to
  // whoever the file's own native hero was. Falls back to auto-detecting
  // the file's own hero when no perspectivePlayer is given, same as
  // before. convertedText is deliberately not computed here anymore — the
  // hand-detail window no longer has a "CoinPoker format" view to show it
  // in, so computing it on every open would just be wasted work.
  return {
    ...record,
    replay: buildHandReplay(record.raw, perspectivePlayer || null),
  };
});

// ── Hand detail sub-window ───────────────────────────────────────────────
// A separate, independently resizable window per hand — matching how
// PokerTracker/HM3/Hand2Note actually show a hand history, not a modal
// inside the main window, so several hands can stay open side by side while
// browsing the list. Clicking a hand that's already open (from the SAME
// perspective) focuses that window instead of opening a duplicate — keyed
// by hand+player together, not just hand, since the same hand viewed from
// two different players' perspectives is genuinely different content (a
// different "hero", different highlighted cards) and shouldn't collapse
// into a single window.

ipcMain.handle('open-hand-window', async (event, handId, perspectivePlayer) => {
  const key = `${handId}::${perspectivePlayer || ''}`;
  const existing = handWindows.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: 700,
    height: 620,
    minWidth: 480,
    minHeight: 420,
    backgroundColor: '#0e0e0f',
    title: `Hand #${handId}`,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'handDetailPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.setMenuBarVisibility(false);
  handWindows.set(key, win);
  win.on('closed', () => handWindows.delete(key));
  win.loadFile(path.join(__dirname, 'renderer', 'hand-detail.html'), { query: { handId, perspectivePlayer: perspectivePlayer || '' } });
});

// Saves the hand-detail window's content as a PNG image — built on
// Electron's own capturePage() rather than a third-party screenshot/canvas
// library, for the same reason this app avoids third-party libraries for
// its UI generally: it's something this sandbox has no way to install and
// verify actually works, whereas capturePage() is a documented, built-in
// Electron API. capturePage() only captures the current viewport, though,
// not the full scrollable page — a long hand (many streets, run-it-twice,
// a multi-way showdown) can easily be taller than the window. Worked
// around by resizing the window to fit the content's actual height right
// before capturing, then restoring it afterward, rather than clipping a
// scrolled-off portion of the hand out of the saved image.
ipcMain.handle('download-hand-image', async (event, handId, contentHeight) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return { saved: false };

  const [width, originalHeight] = win.getContentSize();
  const targetHeight = Math.max(300, Math.min(Math.ceil(contentHeight) || originalHeight, 8000));
  win.setContentSize(width, targetHeight);
  // Give the page a moment to reflow and repaint at the new size before
  // capturing — capturePage() otherwise risks grabbing a frame mid-resize.
  await new Promise((resolve) => setTimeout(resolve, 150));

  let image;
  try {
    image = await win.webContents.capturePage();
  } finally {
    win.setContentSize(width, originalHeight);
  }

  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Save Hand History Image',
    defaultPath: `hand-${handId}.png`,
    filters: [{ name: 'PNG Image', extensions: ['png'] }],
  });
  if (canceled || !filePath) return { saved: false };
  fs.writeFileSync(filePath, image.toPNG());
  return { saved: true, path: filePath };
});
