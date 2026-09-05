'use strict';

// Renders whatever src/hudOverlay.js's main-process refresh loop last sent
// over 'hud-update' (see hudOverlayPreload.js) — this file has no data
// logic of its own beyond seat placement and stat-value color banding; the
// actual stats come straight from getLiveHudStats() in src/handStore.js.
//
// Same 3x3 grid + footer design and per-stat color-banding approach worked
// out in the HUD design pass (VPIP/PFR/3B / F3B/CB/FCB / AGG/WTSD/WSD, plus
// a Hands/WWSF footer line) — ported here against the real field names
// getLiveHudStats() actually returns, in place of that pass's mock data.
// Thresholds are the same illustrative 6-max ranges from that design pass,
// not yet tuned against this database's own real population — worth
// revisiting once there's a real distribution to calibrate against instead
// of published averages.

const THRESH = {
  vpip: [16, 30, 45], pfr: [12, 24, 34], threeBet: [5, 10, 16], foldToThreeBet: [45, 65, 80],
  cbetFlop: [45, 70, 85], foldToCbetFlop: [35, 55, 70], aggPct: [25, 45, 60],
  wtsd: [20, 30, 38], wonAtShowdown: [45, 55, 65],
};
const BAND_COLOR = { cool: '#5b8def', mid: '#4caf6e', warm: '#e0973a', hot: '#e2536b', unknown: '#4a505a' };

function colorOf(statKey, value) {
  const t = THRESH[statKey];
  if (!t || value == null) return BAND_COLOR.unknown;
  if (value < t[0]) return BAND_COLOR.cool;
  if (value < t[1]) return BAND_COLOR.mid;
  if (value < t[2]) return BAND_COLOR.warm;
  return BAND_COLOR.hot;
}

// [statKey, short label] — the same 9-stat grid as the design pass:
// preflop character, the first reaction to aggression on both sides, then
// aggression/showdown results.
const GRID_STATS = [
  ['vpip', 'VPIP'], ['pfr', 'PFR'], ['threeBet', '3B'],
  ['foldToThreeBet', 'F3B'], ['cbetFlop', 'CB'], ['foldToCbetFlop', 'FCB'],
  ['aggPct', 'AGG'], ['wtsd', 'WTSD'], ['wonAtShowdown', 'WSD'],
];

// Below this many hands, a stat is noise, not a read — see the design
// pass's own sample-size-gating rationale (VPIP/PFR settle in around
// 100-200 hands, 3-Bet needs roughly 100 opportunities). Below 20, don't
// even show a number; 20-99 shows real numbers but flags them as
// provisional (dashed border) rather than presenting them with the same
// confidence as a 100+-hand read.
const UNKNOWN_BELOW = 20;
const PROVISIONAL_BELOW = 100;

function renderHudBox(stats) {
  const hands = stats ? stats.hands : 0;
  const box = document.createElement('div');
  box.className = 'hud';

  const grid = document.createElement('div');
  grid.className = 'stat-grid';

  if (!stats || hands < UNKNOWN_BELOW) {
    box.classList.add('unknown');
    for (const [, label] of GRID_STATS) {
      grid.innerHTML += `<div class="stat-cell"><span class="v" style="color:${BAND_COLOR.unknown};">&ndash;</span><span class="k">${label}</span></div>`;
    }
  } else {
    if (hands < PROVISIONAL_BELOW) box.classList.add('provisional');
    for (const [key, label] of GRID_STATS) {
      const v = stats[key];
      const text = v == null ? '&ndash;' : v;
      grid.innerHTML += `<div class="stat-cell"><span class="v" style="color:${colorOf(key, v)};">${text}</span><span class="k">${label}</span></div>`;
    }
  }
  box.appendChild(grid);

  const rule = document.createElement('div');
  rule.className = 'hud-rule';
  box.appendChild(rule);

  const foot = document.createElement('div');
  foot.className = 'hud-foot';
  const handsText = hands ? hands.toLocaleString() : '0';
  const wwsfText = stats && stats.wonWhenSawFlop != null ? `${stats.wonWhenSawFlop}%` : '&ndash;';
  foot.innerHTML = `<span><b>${handsText}</b> hands</span><span>WWSF <b>${wwsfText}</b></span>`;
  box.appendChild(foot);

  return box;
}

// Screen position for a seat `offset` steps clockwise from hero (who's
// always drawn at the bottom, offset 0) — matches how every real poker
// client rotates the table so the local player is always at the bottom.
// A parametric ellipse rather than a per-seat-count lookup table, so any
// table size places seats in the same clockwise-from-bottom order without
// needing a hardcoded case for each one; centered/sized to roughly match
// Weplay's own felt proportions, not exact — the constants here are a
// first pass to be recalibrated once checked against the real running app.
function seatPercent(offset, maxSeats) {
  const theta = (offset / maxSeats) * 2 * Math.PI;
  const cx = 50, cy = 46, rx = 42, ry = 46;
  return {
    left: cx - rx * Math.sin(theta),
    top: cy + ry * Math.cos(theta),
  };
}

function render(payload) {
  const root = document.getElementById('hudRoot');
  root.innerHTML = '';
  if (!payload || !Array.isArray(payload.seats)) return;

  for (const seat of payload.seats) {
    if (seat.isHero || seat.seatOffset == null) continue; // no HUD on hero's own seat — see the design pass for why
    const pos = seatPercent(seat.seatOffset, payload.maxSeats);
    const el = document.createElement('div');
    el.className = 'hud-seat';
    el.style.left = `${pos.left}%`;
    el.style.top = `${pos.top}%`;
    el.appendChild(renderHudBox(seat.stats));
    root.appendChild(el);
  }
}

window.weplayHud.onHudUpdate(render);
