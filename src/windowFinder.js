'use strict';

const { spawn } = require('child_process');
const path = require('path');

// Matches a Weplay table window's title, e.g.:
//   "VIP Oslo Bomb Pot (VPIP 25%) -  Hold'em NL $0.50/$1($0.24)"
//   "Liverpool Bomb Pot 2 (3BB) -  Hold'em NL $0.25/$0.50($0.12)"
//   "London #2 -  Hold'em NL $0.25/$0.50($0.09)"
// Group 1 is the table name, deliberately kept loose (non-greedy up to the
// LAST " - Hold'em" so a table name that itself contains a hyphen still
// matches) — the dash spacing in real Weplay titles is inconsistent (one
// space some places, two others), hence \s+ rather than a literal " - ".
const TABLE_TITLE_RE = /^(.+?)\s+-\s+Hold'em\s+(?:NL|PL)\s+\$[\d.]+\/\$[\d.]+(?:\(\$[\d.]+\))?$/i;

// Matches this app's own Live Sync folder naming convention (see
// src/liveSync.js's own comment for a real example: "HH20260812 Liverpool
// Bomb Pot 1 (3BB) (#11786814) - $0.25-$0.50 - Money 3 No Limit
// Hold_em.txt"). Group 1 is the same table name TABLE_TITLE_RE extracts
// from the window title — this is the join key between "which window is
// this" and "which live hand-history file is this."
const LIVE_FILE_TABLE_RE = /^HH\d{8}\s+(.+?)\s+\(#\d+\)/i;

/**
 * Extracts the table name from a Weplay table window's title, or null if
 * the title doesn't look like a table window at all (Weplay's lobby, some
 * other unrelated app, etc.).
 */
function tableNameFromWindowTitle(title) {
  const m = TABLE_TITLE_RE.exec((title || '').trim());
  return m ? m[1].trim() : null;
}

/**
 * Extracts the table name from a Live Sync hand-history filename, or null
 * if it doesn't match Weplay's own naming convention.
 */
function tableNameFromFileName(fileName) {
  const m = LIVE_FILE_TABLE_RE.exec(fileName || '');
  return m ? m[1].trim() : null;
}

// ── The persistent window-enumeration server ────────────────────────────
// One long-lived `powershell.exe` process (src/findWindowsServer.ps1),
// spawned lazily on first use and kept alive for the rest of the HUD
// session, rather than a fresh process + C# compile on every poll tick.
//
// That original one-shot design (spawn, Add-Type, exit, repeat) measured
// at 500-800ms of real CPU work every 2.5s for as long as the HUD ran —
// almost entirely PowerShell's own process-startup cost plus Roslyn
// compiling the P/Invoke declarations from scratch each time — and was
// the actual cause of a reported slowdown (mouse-scroll stutter, general
// system lag) while the HUD was on. This process pays that cost exactly
// once; every subsequent request is a plain line of text over an already-
// open pipe to an already-running, already-compiled process.
let serverProcess = null;
let stdoutBuffer = '';
let pendingRequests = []; // FIFO — one entry per "GO" sent, resolved by the next reply line in order

function handleServerLine(line) {
  const next = pendingRequests.shift();
  if (!next) return; // a stray line with nobody waiting on it — ignore rather than throw
  clearTimeout(next.timer);
  next.resolve(line);
}

function startServer() {
  const proc = spawn(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'findWindowsServer.ps1')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
  stdoutBuffer = '';
  proc.stdout.on('data', (chunk) => {
    stdoutBuffer += chunk.toString('utf-8');
    let idx;
    while ((idx = stdoutBuffer.indexOf('\n')) !== -1) {
      const line = stdoutBuffer.slice(0, idx).trim();
      stdoutBuffer = stdoutBuffer.slice(idx + 1);
      if (line) handleServerLine(line);
    }
  });
  // A crashed/killed server fails every request still waiting on a reply
  // rather than leaving them hanging until their own timeout — the next
  // findWeplayTableWindows() call after this just respawns fresh (see
  // ensureServer below), so a crash here means one skipped refresh tick,
  // not a stuck HUD.
  const onGone = () => {
    if (serverProcess === proc) serverProcess = null;
    for (const req of pendingRequests) { clearTimeout(req.timer); req.reject(new Error('window-finder server exited')); }
    pendingRequests = [];
  };
  proc.on('exit', onGone);
  proc.on('error', onGone);
  return proc;
}

function ensureServer() {
  if (!serverProcess || serverProcess.killed) serverProcess = startServer();
  return serverProcess;
}

function requestWindowList() {
  return new Promise((resolve, reject) => {
    const proc = ensureServer();
    const entry = {
      resolve,
      reject,
      timer: setTimeout(() => {
        pendingRequests = pendingRequests.filter((r) => r !== entry);
        reject(new Error('window-finder server timed out'));
      }, 5000),
    };
    pendingRequests.push(entry);
    try {
      proc.stdin.write('GO\n');
    } catch (err) {
      pendingRequests = pendingRequests.filter((r) => r !== entry);
      clearTimeout(entry.timer);
      reject(err);
    }
  });
}

/**
 * Shuts down the persistent window-enumeration server, if running — call
 * when the HUD overlay itself stops (src/hudOverlay.js's stopHudOverlay),
 * so no orphaned powershell.exe process outlives the feature being off.
 */
function stopWindowFinderServer() {
  if (serverProcess && !serverProcess.killed) {
    try { serverProcess.stdin.write('exit\n'); } catch (err) { /* pipe already gone — kill() below still cleans it up */ }
    serverProcess.kill();
  }
  serverProcess = null;
  for (const req of pendingRequests) clearTimeout(req.timer);
  pendingRequests = [];
}

/**
 * Every currently-open Weplay table window on screen, with its title,
 * extracted table name, and screen rect — the HUD overlay's own input for
 * "which tables are open, and where." Fails soft: the server missing/
 * blocked/timed-out, or nothing matching "Hold'em" currently on screen,
 * both just mean "no tables found" rather than a thrown error, since the
 * HUD overlay's refresh loop calls this on every tick and a transient
 * failure shouldn't crash it.
 */
async function findWeplayTableWindows() {
  let raw;
  try {
    raw = await requestWindowList();
  } catch (err) {
    return [];
  }

  let rawWindows;
  try {
    rawWindows = JSON.parse(raw);
  } catch (err) {
    return [];
  }
  if (!Array.isArray(rawWindows)) return [];

  const tables = [];
  for (const w of rawWindows) {
    const tableName = tableNameFromWindowTitle(w.title);
    if (!tableName) continue;
    tables.push({ title: w.title, tableName, x: w.x, y: w.y, width: w.width, height: w.height });
  }
  return tables;
}

module.exports = {
  findWeplayTableWindows, stopWindowFinderServer,
  tableNameFromWindowTitle, tableNameFromFileName, TABLE_TITLE_RE, LIVE_FILE_TABLE_RE,
};
