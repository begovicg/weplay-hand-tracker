'use strict';

// Orchestrates the live table HUD: finds open Weplay table windows
// (src/windowFinder.js), matches each to its Live Sync hand-history file to
// see who's currently seated (src/handReplay.js's own seat list — no
// screen-scraping or OCR, the same raw text this app already parses
// everywhere else), looks up each opponent's historical stats
// (getLiveHudStats in src/handStore.js), and keeps one transparent,
// click-through overlay BrowserWindow per table positioned on top of it.
//
// Runs entirely on the Electron MAIN thread (unlike Live Sync's own worker
// thread) — creating/moving BrowserWindows is a main-thread-only Electron
// API. This is deliberately decoupled from Live Sync's own watcher: it
// doesn't need to know about file-change events, just the current on-disk
// content of whichever files match whatever tables happen to be open on
// screen right now, re-read on its own polling interval. Live Sync (running
// separately) is what keeps the database itself current; this only ever
// READS the database and the raw files, never imports.

const fs = require('fs');
const path = require('path');
const { BrowserWindow } = require('electron');
const { getSetting } = require('./db');
const { findWeplayTableWindows, stopWindowFinderServer, tableNameFromFileName } = require('./windowFinder');
const { buildHandReplay } = require('./handReplay');
const { splitHands } = require('./converter');
const { getLiveHudStats } = require('./handStore');

// Real Weplay tables complete a hand at most every several seconds, and
// this only ever re-reads small text files plus one indexed SQL query per
// table's opponents — 2.5s keeps seat/stat changes feeling live without
// re-running PowerShell's window enumeration (the more expensive half of
// each tick, see windowFinder.js) any more often than that.
const REFRESH_INTERVAL_MS = 2500;

let refreshTimer = null;
const overlaysByTable = new Map(); // tableName -> { win, rect }

/**
 * Every Live Sync .txt file in `folderPath`, keyed by the same table name
 * extracted from a window title — the join key between "this window is
 * open" and "here's the file to read its current seats from."
 */
function listLiveFilesByTableName(folderPath) {
  const byTable = new Map();
  let entries;
  try {
    entries = fs.readdirSync(folderPath, { withFileTypes: true });
  } catch (err) {
    return byTable;
  }
  for (const entry of entries) {
    if (!entry.isFile() || !/\.txt$/i.test(entry.name)) continue;
    const tableName = tableNameFromFileName(entry.name);
    if (!tableName) continue;
    byTable.set(tableName, path.join(folderPath, entry.name));
  }
  return byTable;
}

/**
 * Reads a table's live hand-history file and returns who's seated right
 * now — the seat list (name/seat/position/isHero) from its LAST hand
 * block, since that's the most recently written hand and so the current
 * lineup. Returns null if the file can't be read or has no parseable hand
 * yet (e.g. the table just opened and Weplay hasn't written a hand to it).
 */
function currentSeatsForFile(filePath) {
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch (err) {
    return null;
  }
  const blocks = splitHands(content);
  if (blocks.length === 0) return null;
  const replay = buildHandReplay(blocks[blocks.length - 1]);
  if (!replay) return null;
  return { maxSeats: replay.maxSeats, players: replay.players };
}

function createOverlayWindow(rect) {
  const win = new BrowserWindow({
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    // Never takes keyboard focus and never shows a taskbar/alt-tab entry —
    // this window exists purely to be looked at, layered over Weplay's own
    // table window, never interacted with directly.
    focusable: false,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'hudOverlayPreload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // { forward: true } still delivers mouse-move events to the renderer (for
  // a possible future hover popup) without ever intercepting a click —
  // every click has to reach the real Weplay table window underneath.
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'hud-overlay.html'));
  win.once('ready-to-show', () => win.showInactive());
  return win;
}

function rectsEqual(a, b) {
  return a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;
}

function destroyOverlay(entry) {
  if (!entry.win.isDestroyed()) entry.win.destroy();
}

async function refresh(getDb) {
  const db = getDb();
  const openTables = await findWeplayTableWindows();
  const openTableNames = new Set(openTables.map((t) => t.tableName));

  // A table window that's since been closed loses its overlay immediately
  // — an orphaned overlay sitting over whatever's now underneath (another
  // app, the desktop) would be actively misleading, not just stale.
  for (const [tableName, entry] of overlaysByTable) {
    if (!openTableNames.has(tableName)) {
      destroyOverlay(entry);
      overlaysByTable.delete(tableName);
    }
  }

  const folderPath = getSetting(db, 'liveSyncFolder');
  if (!folderPath) return; // Live Sync never configured — no file to read seats from, so nothing to show yet
  const filesByTable = listLiveFilesByTableName(folderPath);

  for (const table of openTables) {
    let entry = overlaysByTable.get(table.tableName);
    if (!entry) {
      entry = { win: createOverlayWindow(table), rect: table };
      overlaysByTable.set(table.tableName, entry);
    } else if (!rectsEqual(entry.rect, table)) {
      // The table window moved or resized since the last tick — follow it.
      entry.win.setBounds({ x: table.x, y: table.y, width: table.width, height: table.height });
      entry.rect = table;
    }

    const filePath = filesByTable.get(table.tableName);
    if (!filePath) continue;
    const seated = currentSeatsForFile(filePath);
    if (!seated) continue;

    const heroPlayer = seated.players.find((p) => p.isHero);
    const heroSeat = heroPlayer ? heroPlayer.seat : null;
    const opponentNames = seated.players.filter((p) => !p.isHero).map((p) => p.name);
    const statsByName = getLiveHudStats(db, opponentNames);

    const payload = {
      maxSeats: seated.maxSeats,
      seats: seated.players.map((p) => ({
        name: p.name,
        isHero: p.isHero,
        // How many seats clockwise from hero's own seat this player sits —
        // real poker clients always draw the local player at the bottom
        // and rotate everyone else around them by physical seat number, not
        // by poker position (SB/BB/etc, which says nothing about screen
        // location) — see renderer/hud-overlay.js's own comment for how
        // this maps to an actual screen slot.
        seatOffset: heroSeat != null ? ((p.seat - heroSeat + seated.maxSeats) % seated.maxSeats) : null,
        stats: p.isHero ? null : (statsByName[p.name] || null),
      })),
    };
    if (!entry.win.isDestroyed()) entry.win.webContents.send('hud-update', payload);
  }
}

// refresh() is async (findWeplayTableWindows() awaits a round trip to the
// persistent PowerShell server — see windowFinder.js) — this guard skips a
// tick outright rather than letting two overlapping refreshes race each
// other's BrowserWindow creation/teardown if one ever runs long (a slow
// disk read, a wedged server request hitting its 5s timeout).
let refreshInFlight = false;
async function tick(getDb) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  try {
    await refresh(getDb);
  } catch (err) {
    console.error('HUD overlay refresh failed:', err);
  } finally {
    refreshInFlight = false;
  }
}

/**
 * Starts the HUD overlay: an immediate refresh, then one on
 * REFRESH_INTERVAL_MS forever until stopHudOverlay() is called. `getDb` is
 * a function (not the database directly) so this always reads whatever the
 * current live connection is, matching the lazy-open pattern the rest of
 * main.js already uses for the database.
 */
function startHudOverlay(getDb) {
  stopHudOverlay();
  tick(getDb);
  refreshTimer = setInterval(() => tick(getDb), REFRESH_INTERVAL_MS);
}

function stopHudOverlay() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  for (const entry of overlaysByTable.values()) destroyOverlay(entry);
  overlaysByTable.clear();
  // No orphaned powershell.exe process left running once the HUD is off —
  // see windowFinder.js's own comment for why this is a persistent process
  // now rather than one spawned fresh per tick.
  stopWindowFinderServer();
}

function isHudOverlayRunning() {
  return refreshTimer !== null;
}

module.exports = {
  startHudOverlay, stopHudOverlay, isHudOverlayRunning,
  listLiveFilesByTableName, currentSeatsForFile,
};
