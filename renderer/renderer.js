'use strict';

const state = {
  files: [], // { name, content }
  results: [],
};

const dropzone = document.getElementById('dropzone');
const browseBtn = document.getElementById('browseBtn');
const fileListSection = document.getElementById('fileListSection');
const fileList = document.getElementById('fileList');
const fileSummaryText = document.getElementById('fileSummaryText');
const fileSummaryToggle = document.getElementById('fileSummaryToggle');
const clearBtn = document.getElementById('clearBtn');
const convertBtn = document.getElementById('convertBtn');
const importDbBtn = document.getElementById('importDbBtn');
const replaceHeroToggle = document.getElementById('replaceHeroToggle');
const exportCountLabel = document.getElementById('exportCountLabel');
const exportFormat = document.getElementById('exportFormat');
const exportBtn = document.getElementById('exportBtn');
const backupBtn = document.getElementById('backupBtn');
const restoreBtn = document.getElementById('restoreBtn');
const resultsSection = document.getElementById('resultsSection');
const resultsSummary = document.getElementById('resultsSummary');
const resultsList = document.getElementById('resultsList');
const toast = document.getElementById('toast');
const statsHeroLabel = document.getElementById('statsHeroLabel');
const statsCards = document.getElementById('statsCards');
const statsChartWrap = document.getElementById('statsChartWrap');
const statsChart = document.getElementById('statsChart');
const statsCaveat = document.getElementById('statsCaveat');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingText = document.getElementById('loadingText');
const bootOverlay = document.getElementById('bootOverlay');

// Hands & Stats (merged) tab
const tabButtons = [...document.querySelectorAll('.tab-btn')];
const tabContents = {
  import: document.getElementById('tabImport'),
  hands: document.getElementById('tabHands'),
  graph: document.getElementById('tabGraph'),
};
const hudHeroLabel = document.getElementById('hudHeroLabel');
const hudTable = document.getElementById('hudTable');
const advancedGraphLabel = document.getElementById('advancedGraphLabel');
const advancedGraphChart = document.getElementById('advancedGraphChart');
const legendTotal = document.getElementById('legendTotal');
const legendShowdown = document.getElementById('legendShowdown');
const legendNonShowdown = document.getElementById('legendNonShowdown');
const legendEV = document.getElementById('legendEV');
const handsDbLabel = document.getElementById('handsDbLabel');
const handsTableHeadRow = document.getElementById('handsTableHeadRow');
const handsTableBody = document.getElementById('handsTableBody');
const filterPlayer = document.getElementById('filterPlayer');
const filterDateFrom = document.getElementById('filterDateFrom');
const filterDateTo = document.getElementById('filterDateTo');
const filterPosition = document.getElementById('filterPosition');
const filterStakes = document.getElementById('filterStakes');
const filterTableCategory = document.getElementById('filterTableCategory');
const filterHandCategory = document.getElementById('filterHandCategory');
const filterWtsd = document.getElementById('filterWtsd');
const filterSawFlop = document.getElementById('filterSawFlop');
const filterPotBbMin = document.getElementById('filterPotBbMin');
const filterPotBbMax = document.getElementById('filterPotBbMax');
const filterSearch = document.getElementById('filterSearch');
const filterResetBtn = document.getElementById('filterResetBtn');
const handsPrevBtn = document.getElementById('handsPrevBtn');
const handsNextBtn = document.getElementById('handsNextBtn');
const handsPageLabel = document.getElementById('handsPageLabel');
const handsJumpPage = document.getElementById('handsJumpPage');
const handsJumpBtn = document.getElementById('handsJumpBtn');
const handsPageSizeSelect = document.getElementById('handsPageSizeSelect');
const handsSortField = document.getElementById('handsSortField');
const handsSortDirBtn = document.getElementById('handsSortDirBtn');

const ACTION_BUTTONS = [browseBtn, clearBtn, convertBtn, importDbBtn];
let isBusy = false;

// Shows a full-screen spinner and disables every action button for the
// duration of a slow operation (importing a large zip, converting or
// analyzing a big batch, saving). Buttons keep their own disabled logic
// once busy clears — see updateFileControlsEnabled().
function setBusy(busy, message) {
  isBusy = busy;
  loadingOverlay.classList.toggle('hidden', !busy);
  if (busy) loadingText.textContent = message || 'Working…';
  for (const btn of ACTION_BUTTONS) btn.disabled = busy;
  dropzone.classList.toggle('busy', busy);
  if (!busy) updateFileControlsEnabled();
}

function updateFileControlsEnabled() {
  const hasFiles = state.files.length > 0;
  convertBtn.disabled = !hasFiles;
  importDbBtn.disabled = !hasFiles;
}

// ── Tab navigation ──────────────────────────────────────────────────────

// Pure UI toggle — which tab is visually active — with no data-refresh side
// effect. Used where a caller (like the import handler below) already runs
// its own more thorough refresh sequence right afterward; calling the
// auto-refreshing switchTab() there instead would kick off a second,
// unawaited refreshEverything() racing against the explicit one, since
// switchTab doesn't await its own internal refresh.
function setActiveTab(tabName) {
  for (const btn of tabButtons) btn.classList.toggle('active', btn.dataset.tab === tabName);
  for (const [name, el] of Object.entries(tabContents)) el.classList.toggle('active', name === tabName);
}

function switchTab(tabName) {
  setActiveTab(tabName);
  if (tabName === 'hands' || tabName === 'graph') {
    if (!mainState.loaded) {
      loadHandsAndStats();
    } else {
      // Re-fetch on every visit, not just the first — guarantees these two
      // tabs can never show stale data (e.g. after an import that happened
      // while a different tab was active), even if some earlier refresh
      // attempt failed silently. Quiet: no loading-overlay flash for
      // routine navigation, since these queries are fast (tens of
      // milliseconds even at 20k+ hands) — see refreshEverything.
      refreshEverything({ quiet: true });
    }
  }
}

for (const btn of tabButtons) btn.addEventListener('click', () => switchTab(btn.dataset.tab));

// Shown right in the header so a stale build (old zip re-extracted over a
// new one, or an old installed .exe launched instead of a freshly built
// one) is obvious at a glance rather than a guessing game.
window.weplayConverter.getAppVersion().then((v) => {
  document.getElementById('appVersion').textContent = `v${v}`;
});

// Kept in sync with src/converter.js's classifyWarning — a tiny pure string
// check, not worth an IPC round trip to classify dozens of warnings while
// rendering.
function classifyWarning(text) {
  return /unrecognized|could not determine/i.test(text) ? 'unknown' : 'known';
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let toastTimer = null;
function showToast(message) {
  toast.textContent = message;
  toast.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add('hidden'), 2200);
}

// The one-time database backfill (see main.js/src/backfillWorker.js) now
// runs on a background worker thread specifically so it never blocks this
// window — the app stays fully usable while it runs, which is why there's
// no "please wait" overlay here for it. This only surfaces the outcome:
// silent on a normal launch (the common case — nothing left to backfill,
// which is most launches after the first one following an update), a brief
// toast plus a quiet re-fetch of whatever's currently on screen if it
// actually found and fixed something.
window.weplayConverter.onBackfillStatus((status) => {
  if (status.phase === 'done' && (status.deepStatsFixed > 0 || status.evFixed > 0)) {
    showToast('Finished a one-time database update in the background — stats refreshed.');
    if (mainState.loaded) refreshEverything({ quiet: true });
  }
});

function buildSupportReport(fileName, hand) {
  const lines = [];
  lines.push('Weplay Hand Converter — support report');
  lines.push(`File: ${fileName}`);
  lines.push(`Hand: #${hand.handId || '(unknown)'}`);
  lines.push(hand.skipped ? 'Status: SKIPPED' : `Status: converted, ${hand.warnings.length} warning(s)`);
  lines.push('');
  if (hand.skipped) {
    lines.push('Skip reason:');
    lines.push(hand.skipReason);
  } else if (hand.warnings.length) {
    lines.push('Warnings:');
    for (const w of hand.warnings) lines.push(`- ${w}`);
  }
  lines.push('');
  lines.push('--- Raw Weplay hand ---');
  lines.push(hand.raw);
  lines.push('');
  lines.push('--- Converted output ---');
  lines.push(hand.skipped ? '(skipped — no output produced)' : hand.text);
  return lines.join('\n');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function extractHandIds(content) {
  const ids = [];
  const re = /Weplay Hand #(\d+)/g;
  let m;
  while ((m = re.exec(content))) ids.push(m[1]);
  return ids;
}

// Adds a file to state without re-rendering — callers add a whole batch
// (e.g. every file extracted from a zip) and call renderFileList() once at
// the end. Rendering after every single file turned a large zip import into
// an O(n²) re-scan of everything imported so far; this makes it O(n).
// Hand IDs are extracted once here and cached on the file entry, both for
// the hand-count summary and for cross-file duplicate detection below,
// rather than re-scanning the raw text on every render.
function addFile(name, content) {
  if (state.files.some((f) => f.name === name)) return;
  const handIds = extractHandIds(content);
  state.files.push({ name, content, handIds, handCount: handIds.length });
}

function countDuplicateHandIds(files) {
  const seen = new Set();
  let duplicates = 0;
  for (const f of files) {
    for (const id of f.handIds) {
      if (seen.has(id)) duplicates++;
      else seen.add(id);
    }
  }
  return duplicates;
}

let fileListExpanded = false;

function renderFileList() {
  const totalHands = state.files.reduce((s, f) => s + f.handCount, 0);
  const dupCount = countDuplicateHandIds(state.files);
  let summary = state.files.length === 0
    ? ''
    : `${state.files.length} file${state.files.length === 1 ? '' : 's'} imported — ${totalHands.toLocaleString()} hand${totalHands === 1 ? '' : 's'} total`;
  fileSummaryText.innerHTML = '';
  fileSummaryText.append(summary);
  if (dupCount > 0) {
    const warn = document.createElement('span');
    warn.className = 'file-summary-warn';
    warn.textContent = ` — ⚠ ${dupCount} duplicate hand ID${dupCount === 1 ? '' : 's'} across these files (you may be re-importing hands you've already converted)`;
    fileSummaryText.appendChild(warn);
  }
  fileSummaryToggle.textContent = fileListExpanded ? 'Hide files' : 'Show files';
  fileList.classList.toggle('hidden', !fileListExpanded);

  fileList.innerHTML = '';
  for (const f of state.files) {
    const li = document.createElement('li');
    const nameSpan = document.createElement('span');
    nameSpan.className = 'file-name';
    nameSpan.textContent = f.name;
    const sizeSpan = document.createElement('span');
    sizeSpan.className = 'file-size';
    sizeSpan.textContent = `${formatBytes(new Blob([f.content]).size)} · ${f.handCount.toLocaleString()} hands`;
    nameSpan.appendChild(sizeSpan);

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-file';
    removeBtn.textContent = '✕';
    removeBtn.addEventListener('click', () => {
      state.files = state.files.filter((x) => x.name !== f.name);
      renderFileList();
    });

    li.appendChild(nameSpan);
    li.appendChild(removeBtn);
    fileList.appendChild(li);
  }

  fileListSection.classList.toggle('hidden', state.files.length === 0);
  updateFileControlsEnabled();
  // Any file change invalidates prior Convert results (Stats is unaffected —
  // it reflects the persistent database, not currently loaded files).
  resultsSection.classList.add('hidden');
  state.results = [];
}

fileSummaryToggle.addEventListener('click', () => {
  fileListExpanded = !fileListExpanded;
  renderFileList();
});

// ── Drag & drop ──────────────────────────────────────────────────────────

['dragenter', 'dragover'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.add('drag-over');
  });
});
['dragleave', 'drop'].forEach((evt) => {
  dropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    dropzone.classList.remove('drag-over');
  });
});

dropzone.addEventListener('drop', async (e) => {
  if (isBusy) return;
  const dropped = [...(e.dataTransfer?.files || [])];
  const txtFiles = dropped.filter((f) => f.name.toLowerCase().endsWith('.txt'));
  const zipFiles = dropped.filter((f) => f.name.toLowerCase().endsWith('.zip'));
  const skipped = dropped.length - txtFiles.length - zipFiles.length;
  if (txtFiles.length === 0 && zipFiles.length === 0) {
    if (skipped > 0) showToast(`Skipped ${skipped} file(s) — only .txt and .zip are supported`);
    return;
  }

  setBusy(true, zipFiles.length ? 'Extracting zip archive…' : 'Importing files…');
  try {
    for (const f of txtFiles) {
      const content = await f.text();
      addFile(f.name, content);
    }

    for (const f of zipFiles) {
      const buffer = await f.arrayBuffer();
      const result = await window.weplayConverter.parseZipBuffer(buffer, f.name);
      if (result.error) {
        showToast(result.error);
        continue;
      }
      for (const extracted of result.files) addFile(extracted.name, extracted.content);
      if (result.files.length) showToast(`Added ${result.files.length} file(s) from ${f.name}`);
    }

    if (skipped > 0) {
      showToast(`Skipped ${skipped} file(s) — only .txt and .zip are supported`);
    }
  } finally {
    renderFileList();
    setBusy(false);
  }
});

// ── Browse button ────────────────────────────────────────────────────────

browseBtn.addEventListener('click', async () => {
  setBusy(true, 'Importing files…');
  try {
    const { files, errors } = await window.weplayConverter.pickFiles();
    for (const f of files) addFile(f.name, f.content);
    for (const err of errors) showToast(err);
  } finally {
    renderFileList();
    setBusy(false);
  }
});

clearBtn.addEventListener('click', () => {
  state.files = [];
  fileListExpanded = false;
  renderFileList();
});

// ── Convert ──────────────────────────────────────────────────────────────

convertBtn.addEventListener('click', async () => {
  setBusy(true, 'Converting…');
  let results = null;
  try {
    const options = { replaceHeroName: replaceHeroToggle.checked };
    results = await window.weplayConverter.convertFiles(state.files, options);
    state.results = results;
    renderResults(results);
  } finally {
    setBusy(false);
  }
  // Saving is now part of Convert itself — one click, one save dialog,
  // rather than a separate button after the fact.
  if (results && results.some((r) => r.handCount > 0)) {
    await saveConvertedResults(results);
  }
});

function renderResults(results) {
  const totalHands = results.reduce((s, r) => s + r.handCount, 0);
  const totalSkipped = results.reduce((s, r) => s + r.skippedHands.length, 0);
  const allFlagged = results.flatMap((r) => r.flaggedHands || []);
  const unknownCount = allFlagged.filter((h) => h.severity === 'unknown').length;
  const knownCount = allFlagged.length - unknownCount;

  resultsSummary.innerHTML = `
    <span class="summary-pill pill-ok"><strong>${totalHands}</strong> converted</span>
    ${totalSkipped ? `<span class="summary-pill pill-skip"><strong>${totalSkipped}</strong> skipped</span>` : ''}
    ${unknownCount ? `<span class="summary-pill pill-unknown">⚠ <strong>${unknownCount}</strong> unrecognized — new pattern</span>` : ''}
    ${knownCount ? `<span class="summary-pill pill-known"><strong>${knownCount}</strong> known caveat${knownCount === 1 ? '' : 's'}</span>` : ''}
  `;

  resultsList.innerHTML = '';
  for (const r of results) {
    const card = document.createElement('div');
    card.className = 'result-card';

    const flagged = r.flaggedHands || [];
    const fileUnknown = flagged.filter((h) => h.severity === 'unknown').length;
    const fileKnown = flagged.length - fileUnknown;

    const head = document.createElement('div');
    head.className = 'result-card-head';
    head.innerHTML = `
      <span class="result-title">${escapeHtml(r.inputName)} → ${escapeHtml(r.outputName)}</span>
      <span class="result-stats">
        <span class="stat-ok">${r.handCount} converted</span>
        ${r.skippedHands.length ? `<span class="stat-skip">${r.skippedHands.length} skipped</span>` : ''}
        ${fileUnknown ? `<span class="stat-skip">${fileUnknown} unrecognized</span>` : ''}
        ${fileKnown ? `<span class="stat-warn">${fileKnown} caveats</span>` : ''}
      </span>
    `;

    const details = document.createElement('div');
    details.className = 'result-details hidden';

    if (r.heroName) {
      const heroNote = document.createElement('p');
      heroNote.className = 'hero-note';
      heroNote.innerHTML = `Detected Hero: <strong>${escapeHtml(r.heroName)}</strong>`;
      details.appendChild(heroNote);
    }

    if (flagged.length === 0) {
      const clean = document.createElement('p');
      clean.className = 'clean-note';
      clean.textContent = '✓ No issues — every hand converted cleanly.';
      details.appendChild(clean);
    } else {
      const handList = document.createElement('div');
      handList.className = 'hand-list';
      // Unrecognized-pattern hands surface first — they're the ones worth a look.
      const sorted = [...flagged].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'unknown' ? -1 : 1));
      for (const hand of sorted) {
        handList.appendChild(buildHandEntry(r, hand));
      }
      details.appendChild(handList);
    }

    head.addEventListener('click', () => details.classList.toggle('hidden'));

    card.appendChild(head);
    card.appendChild(details);
    resultsList.appendChild(card);
  }

  resultsSection.classList.remove('hidden');
}

function buildHandEntry(fileResult, hand) {
  const entry = document.createElement('div');
  entry.className = `hand-entry sev-${hand.severity}`;

  const head = document.createElement('div');
  head.className = 'hand-entry-head';

  const badgeLabel = hand.skipped ? 'Skipped' : hand.severity === 'unknown' ? 'New pattern' : 'Known caveat';
  const badgeClass = hand.skipped ? 'sev-skipped' : `sev-${hand.severity}`;

  head.innerHTML = `
    <span class="hand-entry-left">
      <span class="hand-id">Hand #${escapeHtml(hand.handId || '?')}</span>
      <span class="severity-badge ${badgeClass}">${badgeLabel}</span>
    </span>
    <span class="hand-warning-count">${hand.skipped ? '' : `${hand.warnings.length} warning${hand.warnings.length === 1 ? '' : 's'}`}</span>
  `;

  const body = document.createElement('div');
  body.className = 'hand-entry-body hidden';

  if (hand.skipped) {
    const p = document.createElement('p');
    p.textContent = hand.skipReason;
    body.appendChild(p);
  } else {
    const ul = document.createElement('ul');
    for (const w of hand.warnings) {
      const li = document.createElement('li');
      li.className = `warn-${classifyWarning(w)}`;
      li.textContent = w;
      ul.appendChild(li);
    }
    body.appendChild(ul);
  }

  const copyBtn = document.createElement('button');
  copyBtn.className = 'btn btn-tiny copy-btn';
  copyBtn.textContent = 'Copy for support';
  copyBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const report = buildSupportReport(fileResult.inputName, hand);
    try {
      await navigator.clipboard.writeText(report);
      showToast(`Copied hand #${hand.handId || '?'} to clipboard`);
    } catch (err) {
      showToast('Copy failed — see console');
      console.error(err);
    }
  });
  body.appendChild(copyBtn);

  head.addEventListener('click', () => body.classList.toggle('hidden'));

  entry.appendChild(head);
  entry.appendChild(body);
  return entry;
}

// ── Hands & Stats (merged) ──────────────────────────────────────────────
// One shared filter bar drives both: the stats overview (aggregated over
// every hand matching the filters, not just what's currently on screen in
// the table) and the hands table below it. Both reload together whenever
// any filter changes. Loads automatically the first time this tab is
// visited (it's the default landing tab), and refreshes after every
// import — the same lazy-load pattern used everywhere else in this app.

let externalFilters = {};
const mainState = { loaded: false };

function currentFilters() {
  return {
    perspectivePlayer: filterPlayer.value || undefined,
    dateFrom: filterDateFrom.value || undefined,
    dateTo: filterDateTo.value || undefined,
    tableCategory: filterTableCategory.value || undefined,
    stakesLabel: filterStakes.value || undefined,
    position: filterPosition.value || undefined,
    handCategory: filterHandCategory.value || undefined,
    wentToShowdown: filterWtsd.value || undefined,
    sawFlop: filterSawFlop.value || undefined,
    potBbMin: filterPotBbMin.value || undefined,
    potBbMax: filterPotBbMax.value || undefined,
    search: filterSearch.value.trim() || undefined,
  };
}

// "6max-ante" -> "6-max (Ante)", "8max-bombpot" -> "8-max (Bomb Pot)" — built
// from the value itself rather than a hardcoded lookup, so a table category
// this app hasn't seen yet still gets a sensible label instead of showing
// nothing.
function formatTableCategory(cat) {
  const m = /^(\d+)max-(ante|bombpot)$/.exec(cat || '');
  if (!m) return cat || '—';
  return `${m[1]}-max (${m[2] === 'bombpot' ? 'Bomb Pot' : 'Ante'})`;
}

function fmtMoney(n) {
  if (n == null) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(n).toFixed(2)}`;
}

function fmtPct(n) {
  return n == null ? '—' : `${n.toFixed(1)}%`;
}

// "$0.25/$0.50" -> "NL50" — the poker-community limit name, always derived
// from the big blind itself (NL = 100 * bb in $), never a hardcoded
// per-stake lookup table. stakesLabel is always "$sb/$bb" (see stats.js's
// analyzeHand), the same format handReplay.js and hand-detail.js already
// parse bb out of elsewhere in this app — reusing that exact pattern here
// rather than plumbing a separate numeric bb value through every call site
// that only ever had the formatted label string to begin with.
function formatStakesLimit(stakesLabel) {
  if (!stakesLabel) return stakesLabel;
  const m = /\$([0-9.]+)$/.exec(stakesLabel);
  if (!m) return stakesLabel;
  return `NL${Math.round(parseFloat(m[1]) * 100)}`;
}

function moneyClass(n) {
  if (n == null || n === 0) return '';
  return n > 0 ? 'positive' : 'negative';
}

function statCard(label, value, valueClass, sub) {
  const card = document.createElement('div');
  card.className = 'stat-card';
  card.innerHTML = `
    <div class="stat-card-main">
      <span class="stat-card-label">${escapeHtml(label)}</span>
      <span class="stat-card-value ${valueClass || ''}">${value}</span>
    </div>
    ${sub ? `<div class="stat-card-sub">${sub}</div>` : ''}
  `;
  return card;
}

// ── Player perspective selector ─────────────────────────────────────────
// Whose hands/stats are being shown — defaults to whichever hero has the
// most hands in the database (almost always "you", the app's main user),
// but is never left blank once 2+ heroes exist: leaving it unset would
// silently blend every hero's results together (e.g. your own stats mixed
// with a friend's imported hands), which is exactly the trap flagged when
// multi-player storage was first built.
async function refreshPlayerOptions() {
  // Every recognized player, not just imported heroes — deep stats are
  // computed for every seated player at import time now (see
  // buildHandRecords in src/handStore.js), so any name here is a real,
  // viewable perspective. Still defaults to whichever player has the most
  // hands, which in practice is almost always the main user of this
  // install (their own imports vastly outnumber any single opponent's).
  const players = await window.weplayConverter.getAllPlayers();
  const prevValue = filterPlayer.value;
  filterPlayer.innerHTML = players.map((p) => `<option value="${escapeHtml(p.name)}">${escapeHtml(p.name)} (${p.handCount.toLocaleString()})</option>`).join('');
  if (players.some((p) => p.name === prevValue)) {
    filterPlayer.value = prevValue;
  } else if (players.length) {
    filterPlayer.value = players[0].name; // most hands = default perspective
  }
}

async function refreshFilterOptions() {
  const opts = await window.weplayConverter.getFilterOptions(externalFilters);
  const prevPos = filterPosition.value;
  const prevStakes = filterStakes.value;
  const prevTableCategory = filterTableCategory.value;
  filterPosition.innerHTML = '<option value="">All</option>' + opts.positions.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  // Value stays the raw "$sb/$bb" label — that's what the backend filter
  // actually matches against (see buildWhereClause's f.stakesLabel) — only
  // the displayed text is the NL-formatted limit name.
  filterStakes.innerHTML = '<option value="">All</option>' + opts.stakes.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(formatStakesLimit(s))}</option>`).join('');
  filterTableCategory.innerHTML = '<option value="">All</option>' + opts.tableCategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(formatTableCategory(c))}</option>`).join('');
  if (opts.positions.includes(prevPos)) filterPosition.value = prevPos;
  if (opts.stakes.includes(prevStakes)) filterStakes.value = prevStakes;
  if (opts.tableCategories.includes(prevTableCategory)) filterTableCategory.value = prevTableCategory;
}

// ── Stats overview ───────────────────────────────────────────────────────

async function refreshStats() {
  const payload = await window.weplayConverter.getPersistentStats(externalFilters);
  renderStats(payload);
  renderHudTable(payload.stats);
  renderAdvancedGraph(payload.stats.handTimeline, externalFilters.wentToShowdown);
}

// Whichever stake bucket (from aggregateStats' byStake) has the most hands —
// "Home" in the Player Overview sense: the stake this player actually
// grinds, not just whatever the current filter happens to be scoped to.
function homeStakesLabel(byStake) {
  let best = null;
  for (const bucket of Object.values(byStake || {})) {
    if (!best || bucket.hands > best.hands) best = bucket;
  }
  return best ? formatStakesLimit(best.stakesLabel) : null;
}

// Player Overview: a compact, at-a-glance summary — the same 9 headline
// numbers Dojson's HUD shows at the bottom of its player-lookup view, plus
// the results-over-time chart. The full stat breakdown lives in the
// Advanced Stats tab's HUD table (see renderHudTable) instead of being
// dumped here too.
function renderStats(payload) {
  const { stats, excludedCount, evBb100, evAdjustedHandCount } = payload;

  statsHeroLabel.textContent = stats.hands > 0
    ? `${stats.hands.toLocaleString()} hand${stats.hands === 1 ? '' : 's'} matching current filters`
    : 'No hands match the current filters';

  statsCards.innerHTML = '';
  if (stats.hands === 0) {
    statsCards.appendChild(statCard('Hands', '0', '', 'Import hands, or try Reset filters.'));
    statsChartWrap.classList.add('hidden');
    statsCaveat.textContent = '';
    return;
  }

  statsCards.appendChild(statCard('Hands', stats.hands.toLocaleString(), '', 'matching current filters'));
  statsCards.appendChild(statCard('Winnings', fmtMoney(stats.netResult), moneyClass(stats.netResult)));
  statsCards.appendChild(statCard('VPIP', fmtPct(stats.vpip), '', `${stats.nonBombPotHands} hands`));
  statsCards.appendChild(statCard('Home', homeStakesLabel(stats.byStake) || '—', ''));
  statsCards.appendChild(statCard('Winrate', stats.bb100 != null ? `${stats.bb100.toFixed(1)} bb/100` : '—', moneyClass(stats.bb100)));
  statsCards.appendChild(statCard('PFR', fmtPct(stats.pfr), ''));
  statsCards.appendChild(statCard('WWSF', fmtPct(stats.wonWhenSawFlop), '', 'saw flop'));
  statsCards.appendChild(statCard('Expected V', evBb100 != null ? `${evBb100.toFixed(1)} bb/100` : '—', moneyClass(evBb100), evAdjustedHandCount ? `${evAdjustedHandCount} all-in adj.` : 'no all-ins yet'));
  statsCards.appendChild(statCard('3Bet', fmtPct(stats.threeBet), '', `${stats.threeBetOppCount} opps`));

  if (stats.timeline.length >= 2) {
    statsChartWrap.classList.remove('hidden');
    statsChart.innerHTML = buildTimelineChartSvg(stats.timeline);
  } else {
    statsChartWrap.classList.add('hidden');
  }

  const caveatParts = [];
  caveatParts.push('VPIP, PFR, 3-Bet, and Fold to 3-Bet are all computed over non-bomb-pot hands only — a bomb pot has no preflop betting round, so including it would silently deflate every one of those rates.');
  if (excludedCount > 0) {
    caveatParts.push(`${excludedCount} hand(s) were excluded entirely — no cards could be attributed to a player, or the hand had no resolution anywhere in the source (a real Weplay data gap, e.g. a disconnect at showdown that was never resolved).`);
  }
  caveatParts.push('WTSD only counts a genuine multi-way contest (2+ players still active when the showdown is reached) — Weplay shows the same header text even for an uncontested fold-out, which is excluded here.');
  caveatParts.push('EV Winrate only adjusts genuine 2-player all-in-with-cards-to-come hands (both hands shown at showdown) — multi-way all-ins keep their actual result for now, since that needs separate per-opponent side-pot equity math. Equity is computed exactly for turn/river all-ins, and via Monte Carlo sampling (10,000 trials, ~0.4 percentage points of statistical noise) for preflop/flop all-ins, where exact enumeration would mean up to ~1.7 million board combinations per hand.');
  statsCaveat.textContent = caveatParts.join(' ');
}

// ── Advanced Stats: HUD table ────────────────────────────────────────────
// A Dojson-HUD-style grouped breakdown of every stat stats.js computes,
// built from the exact same payload.stats refreshStats() already fetched —
// no separate IPC call. Grouped into labeled sections (rather than Dojson's
// multiple clickable sub-tabs) since this app doesn't have Dojson's extra
// dimensions yet (IP/OOP, SRP-vs-3-bet-pot splits, site/format breakdowns —
// all need the position-aware engine work intentionally deferred to a later
// round). Row labels are tinted the way Dojson tints its own rows: green
// for a proactive/aggressive action, orange for a "folded to X" one — a
// quick visual read of "is this a stat about doing something, or giving up."

function hudRow(label, value, count, kind) {
  return { label, value, count, kind };
}

function renderHudTable(stats) {
  hudHeroLabel.textContent = stats.hands > 0
    ? `${stats.hands.toLocaleString()} hand${stats.hands === 1 ? '' : 's'} matching current filters`
    : 'No hands match the current filters';

  if (stats.hands === 0) {
    hudTable.innerHTML = '<p class="hero-note">Import hands, or try Reset filters.</p>';
    return;
  }

  const groups = [
    {
      title: 'Preflop',
      rows: [
        hudRow('VPIP', fmtPct(stats.vpip), stats.nonBombPotHands, 'pos'),
        hudRow('PFR', fmtPct(stats.pfr), null, 'pos'),
        hudRow('RFI', fmtPct(stats.rfi), stats.rfiOppCount, 'pos'),
        hudRow('Limp', fmtPct(stats.limp), null, 'neutral'),
        hudRow('Cold Call', fmtPct(stats.coldCall), stats.coldCallOppCount, 'neutral'),
        hudRow('3-Bet', fmtPct(stats.threeBet), stats.threeBetOppCount, 'pos'),
        hudRow('Fold to 3-Bet', fmtPct(stats.foldToThreeBet), null, 'neg'),
        hudRow('4-Bet', fmtPct(stats.fourBet), stats.fourBetOppCount, 'pos'),
        hudRow('Fold to 4-Bet', fmtPct(stats.foldToFourBet), stats.foldToFourBetOppCount, 'neg'),
        hudRow('Squeeze', fmtPct(stats.squeeze), stats.squeezeOppCount, 'pos'),
      ],
    },
    {
      title: 'Steal & Check-Raise',
      rows: [
        hudRow('Attempt to Steal', fmtPct(stats.attemptSteal), stats.stealOppCount, 'pos'),
        hudRow('Fold to Steal', fmtPct(stats.foldToSteal), stats.foldToStealOppCount, 'neg'),
        hudRow('Flop Check-Raise', fmtPct(stats.flopCheckRaise), stats.flopCheckRaiseOpportunities, 'pos'),
        hudRow('Turn Check-Raise', fmtPct(stats.turnCheckRaise), stats.turnCheckRaiseOpportunities, 'pos'),
        hudRow('River Check-Raise', fmtPct(stats.riverCheckRaise), stats.riverCheckRaiseOpportunities, 'pos'),
      ],
    },
    {
      title: 'C-Bet',
      rows: [
        hudRow('Flop C-Bet', fmtPct(stats.flopCbet), stats.flopCbetOpportunities, 'pos'),
        hudRow('Turn C-Bet', fmtPct(stats.turnCbet), stats.turnCbetOpportunities, 'pos'),
        hudRow('River C-Bet', fmtPct(stats.riverCbet), stats.riverCbetOpportunities, 'pos'),
        hudRow('Fold to Flop C-Bet', fmtPct(stats.flopFoldToCbet), stats.flopFoldToCbetOpportunities, 'neg'),
        hudRow('Fold to Turn C-Bet', fmtPct(stats.turnFoldToCbet), stats.turnFoldToCbetOpportunities, 'neg'),
        hudRow('Fold to River C-Bet', fmtPct(stats.riverFoldToCbet), stats.riverFoldToCbetOpportunities, 'neg'),
      ],
    },
    {
      title: 'Aggression & Showdown',
      rows: [
        hudRow('Aggression Factor', stats.aggressionFactor != null ? stats.aggressionFactor.toFixed(2) : '—', null, 'neutral'),
        hudRow('Flop Aggression', fmtPct(stats.flopAggression), stats.flopAggressionOpportunities, 'pos'),
        hudRow('Turn Aggression', fmtPct(stats.turnAggression), stats.turnAggressionOpportunities, 'pos'),
        hudRow('River Aggression', fmtPct(stats.riverAggression), stats.riverAggressionOpportunities, 'pos'),
        hudRow('WTSD', fmtPct(stats.wtsd), null, 'neutral'),
        hudRow('W$SD', fmtPct(stats.wonAtShowdown), null, 'neutral'),
        hudRow('W$WSF', fmtPct(stats.wonWhenSawFlop), null, 'neutral'),
      ],
    },
  ];

  hudTable.innerHTML = groups.map((g) => `
    <div class="hud-group">
      <h3 class="hud-group-title">${escapeHtml(g.title)}</h3>
      <div class="hud-rows">
        ${g.rows.map((r) => `
          <div class="hud-row">
            <span class="hud-row-label hud-${r.kind}">${escapeHtml(r.label)}</span>
            <span class="hud-row-value">${r.value}${r.count != null ? `<span class="hud-row-count">${r.count}</span>` : ''}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');
}

function buildTimelineChartSvg(timeline) {
  const width = 640;
  const height = 190;
  const padL = 46, padR = 16, padT = 16, padB = 28;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const values = timeline.map((t) => t.cumulative);
  const minV = Math.min(0, ...values);
  const maxV = Math.max(0, ...values);
  const range = maxV - minV || 1;

  const xFor = (i) => padL + (i / (timeline.length - 1)) * plotW;
  const yFor = (v) => padT + plotH - ((v - minV) / range) * plotH;
  const zeroY = yFor(0);

  const points = timeline.map((t, i) => `${xFor(i).toFixed(1)},${yFor(t.cumulative).toFixed(1)}`).join(' ');
  const areaPoints = `${padL},${zeroY} ${points} ${xFor(timeline.length - 1).toFixed(1)},${zeroY}`;

  const last = timeline[timeline.length - 1];
  const lineColor = last.cumulative >= 0 ? 'var(--ok)' : 'var(--danger)';

  const firstLabel = timeline[0].date;
  const lastLabel = timeline[timeline.length - 1].date;

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <line x1="${padL}" y1="${zeroY.toFixed(1)}" x2="${width - padR}" y2="${zeroY.toFixed(1)}" stroke="var(--border)" stroke-width="1" stroke-dasharray="4 4" />
      <polygon points="${areaPoints}" fill="var(--orange-glow)" opacity="0.5" />
      <polyline points="${points}" fill="none" stroke="${lineColor}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />
      <text x="${padL}" y="${height - 6}" font-size="10" fill="var(--text-faint)">${escapeHtml(firstLabel)}</text>
      <text x="${width - padR}" y="${height - 6}" font-size="10" fill="var(--text-faint)" text-anchor="end">${escapeHtml(lastLabel)}</text>
      <text x="${padL - 6}" y="${padT + 4}" font-size="10" fill="var(--text-faint)" text-anchor="end">${fmtMoney(maxV)}</text>
      <text x="${padL - 6}" y="${(padT + plotH).toFixed(1)}" font-size="10" fill="var(--text-faint)" text-anchor="end">${fmtMoney(minV)}</text>
    </svg>
  `;
}

// ── Advanced Graph tab ───────────────────────────────────────────────────
// The same underlying data as the small chart above (stats.timeline —
// see refreshStats, which updates both together whenever filters change,
// so this graph is never showing a different filtered slice than the rest
// of the page), just rendered larger, without the area-fill under the
// line, and with real axis gridlines/labels at "nice" intervals — see
// src/chartMath.js for the tick-calculation math, which is fully unit
// tested independent of whether the chart itself can be visually verified.

function buildAdvancedTimelineChartSvg(timeline, showdownFilter) {
  const width = 1400;
  const height = 620;
  const padL = 100, padR = 30, padT = 20, padB = 46;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  // The axis range must cover all three lines, not just the total — the
  // showdown/non-showdown split can each individually swing further from
  // zero than the total does (confirmed against real data: this app's own
  // batch has a total that never dips below $0, but the non-showdown line
  // alone goes as low as -$292), so sizing the axis off the total line
  // alone would clip the other two.
  const totalValues = timeline.map((t) => t.cumulative);
  const showdownValues = timeline.map((t) => t.cumulativeShowdown);
  const nonShowdownValues = timeline.map((t) => t.cumulativeNonShowdown);
  const evValues = timeline.map((t) => t.cumulativeEV);
  const allValues = [...totalValues, ...showdownValues, ...nonShowdownValues, ...evValues];
  const dataMin = Math.min(0, ...allValues);
  const dataMax = Math.max(0, ...allValues);
  const yTicks = ChartMath.computeNiceTicks(dataMin, dataMax, 7, 5);
  const axisMin = yTicks[0];
  const axisMax = yTicks[yTicks.length - 1];
  const axisRange = axisMax - axisMin || 1;

  const xFor = (i) => padL + (timeline.length <= 1 ? plotW / 2 : (i / (timeline.length - 1)) * plotW);
  const yFor = (v) => padT + plotH - ((v - axisMin) / axisRange) * plotH;
  const lineFor = (values) => timeline.map((t, i) => `${xFor(i).toFixed(1)},${yFor(values[i]).toFixed(1)}`).join(' ');

  let yGrid = '';
  for (const tick of yTicks) {
    const y = yFor(tick).toFixed(1);
    const isZero = Math.abs(tick) < 1e-9;
    yGrid += `<line x1="${padL}" y1="${y}" x2="${width - padR}" y2="${y}" stroke="var(--border-soft)" stroke-width="${isZero ? 1.5 : 1}" ${isZero ? '' : 'stroke-dasharray="3 4"'} />`;
    // var(--text-dim), not the fainter var(--text-faint) used for gridlines
    // — axis labels are reference information that needs to actually be
    // legible, not decoration to de-emphasize.
    yGrid += `<text x="${padL - 12}" y="${y}" font-size="12" fill="var(--text-dim)" text-anchor="end" dominant-baseline="middle">${fmtMoney(tick)}</text>`;
  }

  const xIndices = ChartMath.pickEvenIndices(timeline.length, 8);
  let xAxis = '';
  for (const idx of xIndices) {
    const x = xFor(idx).toFixed(1);
    xAxis += `<line x1="${x}" y1="${padT}" x2="${x}" y2="${height - padB}" stroke="var(--border-soft)" stroke-width="1" stroke-dasharray="2 4" opacity="0.5" />`;
    xAxis += `<text x="${x}" y="${height - padB + 20}" font-size="12" fill="var(--text-dim)" text-anchor="middle">${timeline[idx].handNumber.toLocaleString()}</text>`;
  }

  // A real vertical axis line plus a rotated title — the axis previously
  // had tick numbers but no line marking the axis itself and no label
  // saying what the numbers actually are, which is worse than usual now
  // that three differently-colored lines all share the same axis.
  const yAxisLine = `<line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" stroke="var(--border)" stroke-width="1.5" />`;
  const titleY = (padT + height - padB) / 2;
  const yAxisTitle = `<text x="20" y="${titleY}" font-size="13" fill="var(--text-dim)" text-anchor="middle" transform="rotate(-90 20 ${titleY})">Money Won ($)</text>`;
  const xAxisTitle = `<text x="${padL + plotW / 2}" y="${height - 6}" font-size="13" fill="var(--text-dim)" text-anchor="middle">Hand Number</text>`;

  // When the "Went to Showdown" filter is narrowed to one side, every hand
  // fed into this chart already belongs to that one bucket — so the total
  // (green) line is already mathematically identical to whichever of
  // showdown/non-showdown isn't all zeros, and showing three lines (two of
  // them redundant or flat at zero) would just be clutter. Show exactly one
  // line, colored to match the selected bucket, not green.
  //
  // The EV-adjusted (yellow, dashed) line is only ever drawn alongside a
  // showdown-inclusive selection — evAdjustmentBB is only ever non-null for
  // hands where hero's cards were shown at showdown (see evAnalysis.js), so
  // in the "not shown" filter it's identical to the actual-results line and
  // would just be a redundant dashed overlay on top of it.
  let lines;
  if (showdownFilter === 'shown') {
    lines = `
      <polyline points="${lineFor(totalValues)}" fill="none" stroke="var(--info)" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round" />
      <polyline points="${lineFor(evValues)}" fill="none" stroke="var(--ev-line)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 4" />
    `;
  } else if (showdownFilter === 'not-shown') {
    lines = `<polyline points="${lineFor(totalValues)}" fill="none" stroke="var(--danger)" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round" />`;
  } else {
    lines = `
      <polyline points="${lineFor(nonShowdownValues)}" fill="none" stroke="var(--danger)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" />
      <polyline points="${lineFor(showdownValues)}" fill="none" stroke="var(--info)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" opacity="0.9" />
      <polyline points="${lineFor(totalValues)}" fill="none" stroke="var(--ok)" stroke-width="2.75" stroke-linejoin="round" stroke-linecap="round" />
      <polyline points="${lineFor(evValues)}" fill="none" stroke="var(--ev-line)" stroke-width="2.25" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="6 4" />
    `;
  }

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      ${yGrid}
      ${xAxis}
      ${yAxisLine}
      ${yAxisTitle}
      ${xAxisTitle}
      ${lines}
    </svg>
  `;
}

function renderAdvancedGraph(handTimeline, showdownFilter) {
  if (handTimeline.length < 2) {
    advancedGraphLabel.textContent = '';
    advancedGraphChart.innerHTML = '<p class="hero-note">Not enough hands yet — import more, or try Reset filters.</p>';
    legendTotal.classList.remove('hidden');
    legendShowdown.classList.remove('hidden');
    legendNonShowdown.classList.remove('hidden');
    legendEV.classList.remove('hidden');
    return;
  }
  const first = handTimeline[0], last = handTimeline[handTimeline.length - 1];
  advancedGraphLabel.textContent = `${handTimeline.length.toLocaleString()} hands matching current filters (${first.date} to ${last.date})`;
  advancedGraphChart.innerHTML = buildAdvancedTimelineChartSvg(handTimeline, showdownFilter);
  // The legend only shows swatches for lines actually being drawn — with
  // the "Went to Showdown" filter narrowed to one side, only one or two
  // lines render (see buildAdvancedTimelineChartSvg), so showing every
  // swatch would advertise colors that aren't on the chart at all.
  legendTotal.classList.toggle('hidden', showdownFilter === 'shown' || showdownFilter === 'not-shown');
  legendShowdown.classList.toggle('hidden', showdownFilter === 'not-shown');
  legendNonShowdown.classList.toggle('hidden', showdownFilter === 'shown');
  legendEV.classList.toggle('hidden', showdownFilter === 'not-shown');
}

// ── Hands table ──────────────────────────────────────────────────────────
// A plain HTML table, not a third-party grid library — after repeated
// rounds of unverifiable integration bugs with one, the actual features
// needed (sortable, resizable columns, pagination, click-to-open) don't
// require a grid engine, and this version is fully testable the same way
// everything else in this app is: structural checks, ID cross-references,
// and real data through the same query path. See the README's Hand
// Database section for the fuller story of why this replaced Tabulator.

const tableState = { offset: 0, limit: 25, sortBy: 'date', sortAsc: false, total: 0 };

// Same suit-color mapping used in the hand-detail window's formatted hand
// view (renderer/hand-detail.js) — spades black, hearts red, diamonds
// blue, clubs green — so hole cards look the same wherever they appear in
// the app. A smaller "mini" badge here, since a table row has far less
// room than a full hand-history window.
const SUIT_CLASS = { s: 'suit-s', h: 'suit-h', d: 'suit-d', c: 'suit-c' };

function renderCardBadges(cardsStr) {
  if (!cardsStr) return '—';
  return cardsStr.trim().split(/\s+/).filter(Boolean).map((c) => {
    const rank = c.slice(0, -1);
    const suit = c.slice(-1).toLowerCase();
    const cls = SUIT_CLASS[suit] || 'suit-s';
    return `<span class="mini-card-badge ${cls}">${escapeHtml(rank)}</span>`;
  }).join('');
}

const SORT_LABELS = { date: 'Date', net: 'Net', stakes: 'Stakes', table: 'Table', position: 'Position', pot: 'Pot', wtsd: 'WTSD' };

function sortIndicator(field) {
  if (tableState.sortBy !== field) return '';
  return tableState.sortAsc ? ' ▲' : ' ▼';
}

// Toggles sort field/direction and reloads the current page. The header
// cells show a live ▲/▼ indicator via CSS (.sorted-asc/.sorted-desc,
// toggled in updateHandsPaginationUI), and the same state is mirrored in
// the "Sort by" dropdown/direction button above the table.
function setSort(field) {
  if (tableState.sortBy === field) {
    tableState.sortAsc = !tableState.sortAsc;
  } else {
    tableState.sortBy = field;
    tableState.sortAsc = false; // newest-first / biggest-first on first click
  }
  tableState.offset = 0;
  loadHandsPage();
}

// Column definitions for the hands table — each maps a data field to a
// header label, whether it's sortable (and which sortBy value that maps
// to), alignment, and how to render the cell content. Plain HTML table
// instead of a grid library: every part of this — column widths, resize,
// sorting, click-to-open — is DOM/CSS/mouse-events this app can actually
// verify, unlike the third-party library approach that kept breaking in
// ways this sandbox has no way to test ahead of time.
const HANDS_COLUMNS = [
  { key: 'date', colId: 'colDate', label: 'Date', sortBy: 'date' },
  { key: 'time', colId: 'colTime', label: 'Time' },
  { key: 'stakesLabel', colId: 'colStakes', label: 'Stakes', sortBy: 'stakes', render: (v) => escapeHtml(formatStakesLimit(v)) },
  { key: 'tableCategory', colId: 'colTableCat', label: 'Table', sortBy: 'table', render: (v) => escapeHtml(formatTableCategory(v)) },
  { key: 'tableCategory', colId: 'colBomb', label: 'Bomb', align: 'center', render: (v) => (v && v.includes('bombpot') ? '<span class="bomb-icon" title="Bomb pot">💣</span>' : '') },
  { key: 'position', colId: 'colPos', label: 'Pos', sortBy: 'position', render: (v) => escapeHtml(v || '—') },
  { key: 'heroCards', colId: 'colCards', label: 'Cards', render: (v) => renderCardBadges(v) },
  { key: 'potSize', colId: 'colPot', label: 'Pot', sortBy: 'pot', align: 'right', render: (v) => (v != null ? `$${v.toFixed(2)}` : '—') },
  { key: 'net', colId: 'colNet', label: 'Net', sortBy: 'net', align: 'right', render: (v) => `<span class="${v == null || v === 0 ? '' : v > 0 ? 'num-positive' : 'num-negative'}">${fmtMoney(v)}</span>` },
  { key: 'wentToShowdown', colId: 'colWtsd', label: 'WTSD', sortBy: 'wtsd', align: 'center', render: (v) => (v ? '<span class="wtsd-yes">●</span>' : '<span class="wtsd-no">—</span>') },
];

// Drag-to-resize: a thin handle at the trailing edge of each header cell.
// Adjusts the matching <col> element's width directly — the standard,
// reliable way to control individual column widths in a table that uses
// table-layout: fixed. Plain mousedown/mousemove/mouseup, the same stable
// browser APIs used everywhere, not a library-specific interaction system.
function makeColumnResizable(th, colId) {
  const handle = document.createElement('div');
  handle.className = 'col-resize-handle';
  th.appendChild(handle);
  handle.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const col = document.getElementById(colId);
    const startX = e.clientX;
    const startWidth = col.getBoundingClientRect().width;
    document.body.classList.add('col-resizing');
    function onMove(ev) {
      const newWidth = Math.max(40, startWidth + (ev.clientX - startX));
      col.style.width = `${newWidth}px`;
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.classList.remove('col-resizing');
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

function initHandsTable() {
  handsTableHeadRow.innerHTML = '';
  for (const col of HANDS_COLUMNS) {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.align === 'right') th.classList.add('num');
    if (col.align === 'center') th.classList.add('center');
    if (col.sortBy) {
      th.classList.add('sortable');
      th.addEventListener('click', () => setSort(col.sortBy));
    }
    makeColumnResizable(th, col.colId);
    handsTableHeadRow.appendChild(th);
  }
}

function renderHandsRows(hands) {
  handsTableBody.innerHTML = '';
  if (hands.length === 0) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = HANDS_COLUMNS.length;
    td.className = 'hands-table-empty';
    td.textContent = 'No hands match these filters — try Reset filters, or import some under Import Hands.';
    tr.appendChild(td);
    handsTableBody.appendChild(tr);
    return;
  }
  for (const hand of hands) {
    const tr = document.createElement('tr');
    tr.addEventListener('click', () => {
      if (hand.handId) window.weplayConverter.openHandWindow(hand.handId, externalFilters.perspectivePlayer);
    });
    for (const col of HANDS_COLUMNS) {
      const td = document.createElement('td');
      if (col.align === 'right') td.classList.add('num');
      if (col.align === 'center') td.classList.add('center');
      const value = hand[col.key];
      td.innerHTML = col.render ? col.render(value) : escapeHtml(value != null ? String(value) : '—');
      tr.appendChild(td);
    }
    handsTableBody.appendChild(tr);
  }
}

async function loadHandsPage() {
  const filters = {
    ...externalFilters,
    sortBy: tableState.sortBy,
    sortAsc: tableState.sortAsc,
    offset: tableState.offset,
    limit: tableState.limit,
  };
  const result = await window.weplayConverter.queryHands(filters);
  tableState.total = result.total;
  renderHandsRows(result.hands);
  handsDbLabel.textContent = `${result.total.toLocaleString()} hand${result.total === 1 ? '' : 's'} matching filters`;
  updateHandsPaginationUI();
}

function updateHandsPaginationUI() {
  const page = tableState.total === 0 ? 0 : Math.floor(tableState.offset / tableState.limit) + 1;
  const totalPages = Math.max(1, Math.ceil(tableState.total / tableState.limit));
  const sortText = `Sorted by ${SORT_LABELS[tableState.sortBy] || tableState.sortBy}${sortIndicator(tableState.sortBy)}`;
  handsPageLabel.textContent = `Page ${page} of ${totalPages} — ${sortText}`;
  handsSortField.value = tableState.sortBy;
  handsSortDirBtn.textContent = tableState.sortAsc ? '▲ Ascending' : '▼ Descending';
  handsPrevBtn.disabled = tableState.offset === 0;
  handsNextBtn.disabled = tableState.offset + tableState.limit >= tableState.total;
  // The Export tab's count stays in sync with the exact same tableState
  // used for pagination — both reflect the same filtered query, so this
  // is just displaying a value already being tracked, not a separate one.
  exportCountLabel.textContent = tableState.total > 0
    ? `${tableState.total.toLocaleString()} hand${tableState.total === 1 ? '' : 's'} match the current filters`
    : 'No hands match the current filters';
  exportBtn.disabled = tableState.total === 0;
  // Sortable header cells get a live visual indicator too, not just the
  // text label above the table — plain DOM className toggling, not
  // dependent on re-rendering the whole header.
  [...handsTableHeadRow.children].forEach((th, i) => {
    const col = HANDS_COLUMNS[i];
    th.classList.toggle('sorted-asc', col.sortBy === tableState.sortBy && tableState.sortAsc);
    th.classList.toggle('sorted-desc', col.sortBy === tableState.sortBy && !tableState.sortAsc);
  });
}

handsPrevBtn.addEventListener('click', () => {
  tableState.offset = Math.max(0, tableState.offset - tableState.limit);
  loadHandsPage();
});
handsNextBtn.addEventListener('click', () => {
  tableState.offset += tableState.limit;
  loadHandsPage();
});
handsPageSizeSelect.addEventListener('change', () => {
  tableState.limit = parseInt(handsPageSizeSelect.value, 10);
  tableState.offset = 0;
  loadHandsPage();
});

function jumpToPage() {
  const page = parseInt(handsJumpPage.value, 10);
  if (!page || page < 1) return;
  const totalPages = Math.max(1, Math.ceil(tableState.total / tableState.limit));
  tableState.offset = (Math.min(page, totalPages) - 1) * tableState.limit;
  handsJumpPage.value = '';
  loadHandsPage();
}
handsJumpBtn.addEventListener('click', jumpToPage);
handsJumpPage.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') jumpToPage();
});

handsSortField.addEventListener('change', () => setSort(handsSortField.value));
handsSortDirBtn.addEventListener('click', () => {
  tableState.sortAsc = !tableState.sortAsc;
  tableState.offset = 0;
  loadHandsPage();
});

// ── Wiring: any filter change refreshes both stats and the table ────────

async function refreshEverything({ resetPage, quiet } = {}) {
  externalFilters = currentFilters();
  if (resetPage) tableState.offset = 0;
  if (!quiet) setBusy(true, 'Loading…');
  try {
    await refreshStats();
    await loadHandsPage();
  } catch (err) {
    // Never fail silently — a refresh that throws partway through is
    // exactly how these tabs end up stuck showing stale data with no
    // visible sign anything went wrong. Surface it instead of swallowing it.
    console.error('Failed to refresh hands/stats:', err);
    showToast('Something went wrong refreshing this view — try switching tabs, or reload the app.');
  } finally {
    if (!quiet) setBusy(false);
  }
}

async function loadHandsAndStats() {
  mainState.loaded = true;
  try {
    // Player perspective and filters must be resolved BEFORE the first data
    // fetch — otherwise the very first table/stats render blends every hero
    // in the database together (only self-correcting once the user touches a
    // filter) — exactly the multi-hero mixing the perspective selector
    // exists to prevent in the first place.
    await refreshPlayerOptions();
    externalFilters = currentFilters();
    await refreshFilterOptions();
    initHandsTable();
    await refreshStats();
    await loadHandsPage();
  } finally {
    // Always clear the boot screen, even if something above threw — a
    // permanent "Loading your hands…" screen because one of these calls
    // failed would be a much worse outcome than showing the (now real, if
    // partially empty) app underneath and letting the user see what broke.
    bootOverlay.classList.add('hidden');
  }
}

importDbBtn.addEventListener('click', async () => {
  setBusy(true, 'Importing to hand database…');
  try {
    const options = { replaceHeroName: replaceHeroToggle.checked };
    const result = await window.weplayConverter.importToHandStore(state.files, options);
    setActiveTab('hands');
    await refreshPlayerOptions();
    await refreshFilterOptions();
    await refreshEverything({ resetPage: true });
    // Shown only after the refresh above completes, not before — a
    // success toast that appears while the UI is still stale (or about to
    // fail to refresh) is worse than no toast at all. Includes the
    // unfiltered database grand total specifically so it's directly
    // comparable against whatever the Hands tab shows right after —
    // added/updated/skipped alone only describe this one import batch,
    // not the database as a whole, and can't answer "did this actually
    // land" on their own.
    const parts = [`${result.added} added`];
    if (result.updated) parts.push(`${result.updated} updated`);
    if (result.skipped) parts.push(`${result.skipped} skipped`);
    showToast(`Hand database: ${parts.join(', ')} — ${result.grandTotal.toLocaleString()} hands total`);
  } catch (err) {
    console.error('Import failed:', err);
    showToast('Import failed — see the console for details, and try again.');
  } finally {
    setBusy(false);
  }
});

exportBtn.addEventListener('click', async () => {
  setBusy(true, 'Exporting…');
  try {
    const result = await window.weplayConverter.exportFilteredHands(externalFilters, exportFormat.value);
    if (result && result.saved) {
      const formatLabel = exportFormat.value === 'converted' ? 'CoinPoker format' : 'Weplay original format';
      showToast(`Exported ${result.count.toLocaleString()} hand${result.count === 1 ? '' : 's'} in ${formatLabel}.`);
    }
    // No toast on cancel (result.saved === false with no error) — the
    // person just closed the save dialog, not a failure worth interrupting
    // them about.
  } catch (err) {
    console.error('Export failed:', err);
    showToast('Export failed — see the console for details, and try again.');
  } finally {
    setBusy(false);
  }
});

backupBtn.addEventListener('click', async () => {
  setBusy(true, 'Backing up database…');
  try {
    const result = await window.weplayConverter.backupDatabase();
    if (result && result.saved) {
      showToast(`Backed up ${result.hands.toLocaleString()} hands.`);
    }
  } catch (err) {
    console.error('Backup failed:', err);
    showToast('Backup failed — see the console for details, and try again.');
  } finally {
    setBusy(false);
  }
});

restoreBtn.addEventListener('click', async () => {
  setBusy(true, 'Restoring database…');
  try {
    const result = await window.weplayConverter.restoreDatabase();
    if (result && result.restored) {
      // The whole database just changed underneath the app, not just grew
      // — the same full refresh sequence as after an import, since the
      // same staleness risk applies (and mainState.loaded is already true
      // by now, so this can't rely on the first-load path to catch it).
      await refreshPlayerOptions();
      await refreshFilterOptions();
      await refreshEverything({ resetPage: true });
      showToast(`Restored — database now has ${result.hands.toLocaleString()} hands.`);
    } else if (result && result.error) {
      showToast(result.error);
    }
    // No toast when the person just closed the file picker.
  } catch (err) {
    console.error('Restore failed:', err);
    showToast('Restore failed — see the console for details, and try again.');
  } finally {
    setBusy(false);
  }
});

for (const el of [filterPlayer, filterDateFrom, filterDateTo, filterTableCategory, filterStakes, filterPosition, filterHandCategory, filterWtsd, filterSawFlop, filterPotBbMin, filterPotBbMax]) {
  el.addEventListener('change', () => refreshEverything({ resetPage: true }));
}

let searchDebounceTimer = null;
filterSearch.addEventListener('input', () => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => refreshEverything({ resetPage: true }), 300);
});

filterResetBtn.addEventListener('click', () => {
  filterDateFrom.value = '';
  filterDateTo.value = '';
  filterTableCategory.value = '';
  filterStakes.value = '';
  filterPosition.value = '';
  filterHandCategory.value = '';
  filterWtsd.value = '';
  filterSawFlop.value = '';
  filterPotBbMin.value = '';
  filterPotBbMax.value = '';
  filterSearch.value = '';
  // Player perspective is deliberately NOT reset — clearing it would blend
  // multiple heroes' results together if more than one exists in the
  // database, which is never what "reset filters" should silently do.
  refreshEverything({ resetPage: true });
});

// ── Save (auto-triggered right after a successful convert — see below) ────

async function saveConvertedResults(results) {
  setBusy(true, 'Saving…');
  try {
    const outcome = await window.weplayConverter.saveResults(results);
    if (outcome.saved) showToast(`Saved to ${outcome.path}`);
  } finally {
    setBusy(false);
  }
}

// ── Startup ──────────────────────────────────────────────────────────────
// Hands is the default landing tab, so its data loads immediately rather
// than waiting for the user to click into it.
switchTab('hands');
