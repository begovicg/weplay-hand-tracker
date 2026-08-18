'use strict';

const { app, BrowserWindow, ipcMain, dialog, screen } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const { Worker } = require('node:worker_threads');
const path = require('path');
const fs = require('fs');
const { convertFile } = require('./src/converter');
const { createZip } = require('./src/zipWriter');
const { extractTextFiles } = require('./src/zipReader');
const { openDatabase, getSetting, setSetting } = require('./src/db');
const {
  importFileIntoStore, queryHands, getDistinctValues, getHandById, getConvertedText,
  queryRawHandsForStats, getAllPlayerNames,
  getTotalHandCount, getQuickPlayerStats,
} = require('./src/handStore');
const { migrateJsonStoreIfPresent } = require('./src/migrateJsonStore');
const { buildHandReplay } = require('./src/handReplay');
const { analyzeHand, aggregateStats } = require('./src/stats');
const { splitHands } = require('./src/converter');

// Auto-reload during development
if (process.env.NODE_ENV !== 'production') {
  try {
    require('electron-reloader')(module);
  } catch (_) { /* electron-reloader not available */ }
}

let mainWindow;
const handWindows = new Map(); // "handId::perspectivePlayer" -> BrowserWindow, so re-clicking the same hand (from the same perspective) focuses instead of duplicating
let liveSyncWorker = null; // Worker running src/liveSyncWorker.js, or null when not running

// ── Hand database ────────────────────────────────────────────────────────
// SQLite (via Node's built-in node:sqlite — no external dependency needed;
// see src/db.js for the schema and why it's split into two tables). Opened
// once on first use; a pre-existing JSON-format store from an older version
// of this app is migrated in automatically the first time, then renamed
// aside as a backup — see src/migrateJsonStore.js.

const dbPath = path.join(app.getPath('userData'), 'hands.db');
const oldJsonStorePath = path.join(app.getPath('userData'), 'hands.json');
let db = null;
let backfillWorker = null;

// The one-time backfills (backfillDeepStats, backfillEVAdjustments — see
// src/handStore.js) used to run synchronously right here, inline. That was
// fine while they were cheap, but once EV adjustment was generalized to
// cover every all-in in the database (not just hero's own), a real
// multi-thousand-hand database can have hundreds of qualifying hands, each
// needing its own equity computation (up to ~1 second for a Monte Carlo
// preflop/flop all-in) — tens of minutes of synchronous main-thread work in
// the worst case. Electron's main thread also owns the native window
// message pump on Windows, so that much unbroken synchronous work made the
// app appear as "Not Responding" at the OS level, not just slow — a real
// regression reported after that change. Running it on a worker thread
// instead (src/backfillWorker.js, its own separate SQLite connection to the
// same file) means the main thread — and the window it owns — is never
// blocked by it, however long it takes; see src/db.js's busy_timeout
// comment for why two connections writing to the same file is safe.
function startBackfillWorker() {
  backfillWorker = new Worker(path.join(__dirname, 'src', 'backfillWorker.js'), { workerData: { dbPath } });
  // Don't let a still-running background backfill keep the app process
  // alive after every window is closed and app.quit() is called — this is
  // maintenance work, not something worth delaying shutdown for.
  backfillWorker.unref();
  backfillWorker.on('message', (msg) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('backfill-status', msg);
    if (msg.phase === 'done') {
      if (msg.deepStatsFixed > 0) console.log(`Backfilled deep stats for ${msg.deepStatsFixed} player-hand row(s) from before this was computed for every seated player.`);
      if (msg.evFixed > 0) console.log(`Backfilled EV adjustment for ${msg.evFixed} hand(s) imported before it covered both hero-involving and non-hero all-ins.`);
    } else if (msg.phase === 'error') {
      console.error('Background database backfill failed:', msg.error);
    }
  });
  backfillWorker.on('error', (err) => console.error('Backfill worker crashed:', err));
}

function stopBackfillWorker() {
  if (backfillWorker) {
    backfillWorker.terminate();
    backfillWorker = null;
  }
}

function getDb() {
  if (db === null) {
    db = openDatabase(dbPath);
    const migration = migrateJsonStoreIfPresent(db, oldJsonStorePath, { replaceHeroName: true });
    if (migration.migrated) {
      console.log(`Migrated ${migration.totalRecords} hands from the old JSON store (${migration.added} added, ${migration.updated} updated, ${migration.skipped} skipped).`);
    }
    startBackfillWorker();
  }
  return db;
}

function stopLiveSync() {
  if (liveSyncWorker) {
    liveSyncWorker.terminate();
    liveSyncWorker = null;
  }
}

function closeDb() {
  stopBackfillWorker();
  stopLiveSync(); // its own separate DB connection (see liveSyncWorker.js) would otherwise outlive this one closing/swapping underneath it
  if (db) {
    try { db.close(); } catch (err) { /* already closed or unusable, nothing to do */ }
    db = null;
  }
}

// Starts (or restarts) Live Sync against `folderPath` on its own worker
// thread — see src/liveSyncWorker.js for why: the initial catch-up scan
// alone measured ~56s against a real 62-file/29,000-hand folder, which
// would freeze this window for that entire time if run on the main
// thread. Persists both the folder and the enabled flag so it resumes
// automatically next launch — see resumeLiveSyncIfEnabled() below, called
// once at startup.
function beginLiveSync(folderPath) {
  stopLiveSync();
  const database = getDb();
  setSetting(database, 'liveSyncFolder', folderPath);
  setSetting(database, 'liveSyncEnabled', '1');
  liveSyncWorker = new Worker(path.join(__dirname, 'src', 'liveSyncWorker.js'), {
    workerData: { dbPath, folderPath, options: { replaceHeroName: true } },
  });
  liveSyncWorker.on('message', (msg) => {
    if (msg.phase === 'update' && mainWindow && !mainWindow.isDestroyed()) {
      const { phase, ...totals } = msg;
      mainWindow.webContents.send('live-sync-status', { running: true, folderPath, ...totals });
    }
  });
  // Before this fix, a worker crash only ever got logged — liveSyncWorker
  // stayed set, so get-live-sync-state kept reporting "running: true" and
  // the UI's badge stayed stuck on "On" forever with nothing actually
  // watching the folder anymore. Clearing it and pushing a status update
  // makes a crash visible (badge flips to Off, an error line appears)
  // instead of silently doing nothing for the rest of the session.
  liveSyncWorker.on('error', (err) => {
    console.error('Live Sync worker crashed:', err);
    liveSyncWorker = null;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('live-sync-status', {
        running: false, folderPath, added: 0, updated: 0, skipped: 0, filesProcessed: 0,
        errors: [`Live Sync stopped unexpectedly: ${err.message}`],
      });
    }
  });
}

function resumeLiveSyncIfEnabled() {
  const database = getDb();
  const folderPath = getSetting(database, 'liveSyncFolder');
  const enabled = getSetting(database, 'liveSyncEnabled') === '1';
  if (enabled && folderPath && fs.existsSync(folderPath)) beginLiveSync(folderPath);
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
// safe. Different from Export from Database (Import/Export Hands tab), which is a
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
    // Matches renderer/style.css's --bg exactly — any mismatch here shows up
    // as a brief flash the instant the stylesheet finishes applying over
    // this native pre-paint color.
    backgroundColor: '#0b0b0c',
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

app.whenReady().then(() => {
  createWindow();
  resumeLiveSyncIfEnabled();
});

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
    if (result) {
      // Carry the DB-stored all-in EV adjustment (see src/evAnalysis.js /
      // src/handStore.js) onto the freshly re-parsed hand object, so
      // aggregateStats can fold it into both the EV winrate and the
      // per-hand EV cumulative line without a second query or a re-run of
      // the Monte Carlo equity sampling.
      result.evAdjustmentBB = row.evAdjustmentBB;
      allHands.push(result);
    } else excludedCount++;
  }
  // EV winrate (evBb100) and handTimeline's EV cumulative line both live in
  // aggregateStats now, computed from the same allHands set bb100 uses —
  // each hand's EV adjustment was read straight from the database above
  // (computed once at import time — see src/handStore.js and
  // src/evAnalysis.js), rather than recomputed here. Recomputing would mean
  // re-running Monte Carlo equity sampling for every qualifying hand on
  // every single Stats tab visit, which measured at over 30 seconds for a
  // real 22,889-hand database — fine as a one-time import cost, not
  // acceptable to repeat every time someone just wants to check their stats.
  const stats = aggregateStats(allHands);

  return { stats, excludedCount, totalStoredHands: rows.length, evBb100: stats.evBb100, evAdjustedHandCount: stats.evAdjustedHandCount };
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

// ── IPC: Live Sync ───────────────────────────────────────────────────────
// Watches the folder Weplay itself writes hand histories to and imports new
// hands as they land — see src/liveSync.js for the actual watching/scanning
// logic; this is just the UI-facing control surface (pick a folder,
// start/stop, and report current state on load so the Import/Export tab can
// restore its own UI without a separate "are we running" round trip).

ipcMain.handle('pick-live-sync-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the folder Weplay writes hand histories to',
    properties: ['openDirectory'],
  });
  if (result.canceled || !result.filePaths[0]) return { folderPath: null };
  return { folderPath: result.filePaths[0] };
});

ipcMain.handle('start-live-sync', async (event, folderPath) => {
  if (!folderPath || !fs.existsSync(folderPath)) {
    return { running: false, error: 'That folder doesn\'t exist (or isn\'t accessible).' };
  }
  beginLiveSync(folderPath);
  return { running: true, folderPath };
});

ipcMain.handle('stop-live-sync', async () => {
  stopLiveSync();
  const database = getDb();
  setSetting(database, 'liveSyncEnabled', '0');
  return { running: false };
});

ipcMain.handle('get-live-sync-state', async () => {
  const database = getDb();
  return {
    running: liveSyncWorker !== null,
    folderPath: getSetting(database, 'liveSyncFolder'),
  };
});

// The Refresh Now button's actual "go check the folder right now" request
// — distinct from a plain UI re-fetch (query-hands etc. against whatever's
// already in the database), this asks the running Live Sync worker to
// scan immediately rather than wait for the next fs.watch event or its 1s
// debounce, and awaits its reply before resolving, so the renderer's own
// refresh-the-UI step afterward is guaranteed to see anything this scan
// just imported. A generous timeout guards against a worker that's wedged
// or already dead without an 'error' event having fired yet — the
// renderer still falls back to a plain UI refresh either way.
ipcMain.handle('rescan-live-sync-now', async () => {
  if (!liveSyncWorker) return { triggered: false };
  const worker = liveSyncWorker;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      worker.off('message', onMessage);
      clearTimeout(timer);
      resolve(result);
    };
    const onMessage = (msg) => {
      if (msg && msg.phase === 'rescanComplete') {
        const { phase, ...totals } = msg;
        finish({ triggered: true, ...totals });
      }
    };
    const timer = setTimeout(() => finish({ triggered: false, timedOut: true }), 30000);
    worker.on('message', onMessage);
    worker.postMessage({ type: 'rescan' });
  });
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

ipcMain.handle('get-quick-player-stats', async (event, playerNames) => {
  return getQuickPlayerStats(getDb(), playerNames);
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
    width: 560,
    height: 620,
    minWidth: 460,
    minHeight: 420,
    // Matches renderer/style.css's --bg (this window loads style.css too,
    // layered under hand-detail.css) — see createWindow()'s comment above.
    backgroundColor: '#0b0b0c',
    title: `Hand #${handId}`,
    icon: path.join(__dirname, 'build', 'icon.png'),
    // Not shown until hand-detail.js reports how tall its own content
    // actually is — see the 'hand-window-fit-content' handler below, which
    // resizes to that height (capped to the screen) before revealing.
    // Avoids opening at this fixed 620 default and showing a scrollbar for
    // hands that would otherwise fit on screen with room to spare.
    show: false,
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

// Called once hand-detail.js has laid out its content and knows its own
// natural (unclipped) height — resizes the window to fit that height
// without a scrollbar, capped to how much vertical room the screen it's on
// actually has (leaving space for the OS title bar/taskbar, neither of
// which counts toward content size). A long hand — many streets, a
// multi-way showdown, run-it-twice — still ends up scrolling past that cap,
// same as before; a short hand no longer scrolls just because the window
// opened at an arbitrary fixed height. Also does the window's first
// show() — see open-hand-window's own comment for why it starts hidden.
ipcMain.handle('hand-window-fit-content', (event, desiredContentHeight) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || win.isDestroyed()) return;

  const [width, currentHeight] = win.getContentSize();
  const display = screen.getDisplayMatching(win.getBounds());
  const maxHeight = Math.max(420, display.workAreaSize.height - 90);
  const targetHeight = Math.min(Math.max(Math.ceil(desiredContentHeight) || currentHeight, 420), maxHeight);

  if (targetHeight !== currentHeight) win.setContentSize(width, targetHeight);
  // Re-centers on whatever display it ends up on — setContentSize alone
  // keeps the window's original top-left corner fixed and only grows
  // downward, which could push a taller window's bottom edge off-screen
  // depending on where Electron initially placed it.
  win.center();
  if (!win.isVisible()) win.show();
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
