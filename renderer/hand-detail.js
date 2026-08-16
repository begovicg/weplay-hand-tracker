'use strict';

const handFormatted = document.getElementById('handFormatted');
const downloadHandBtn = document.getElementById('downloadHandBtn');
const replayHandBtn = document.getElementById('replayHandBtn');
const hdToolbarTitle = document.getElementById('hdToolbarTitle');

// Module-level view state: which record is loaded, and whether we're
// showing the static breakdown or stepping through the visual replayer.
let currentReplay = null;
let currentStatsByName = {};
let currentLabelByName = {};
let replayMode = false;
let stepIndex = 0;

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// "$0.25/$0.50" -> "NL50" — same formula (and the same duplicated-not-shared
// pattern, this window's script has no access to renderer.js's own copy) as
// renderer.js's formatStakesLimit: the poker-community limit name, always
// derived from the big blind (NL = 100 * bb in $), never hardcoded per stake.
function formatStakesLimit(stakesLabel) {
  if (!stakesLabel) return stakesLabel;
  const m = /\$([0-9.]+)$/.exec(stakesLabel);
  if (!m) return stakesLabel;
  return `NL${Math.round(parseFloat(m[1]) * 100)}`;
}

// ── Compact, DriveHUD-style formatted view ──────────────────────────────

const SUIT_CLASS = { s: 'suit-s', h: 'suit-h', d: 'suit-d', c: 'suit-c' };

function renderCards(cardsStr) {
  if (!cardsStr) return '';
  const badges = cardsStr.trim().split(/\s+/).filter(Boolean).map((c) => {
    const rank = c.slice(0, -1);
    const suit = c.slice(-1).toLowerCase();
    const cls = SUIT_CLASS[suit] || 'suit-s';
    return `<span class="hd-card ${cls}">${escapeHtml(rank)}</span>`;
  }).join('');
  return `<span class="hd-cards">${badges}</span>`;
}

// DriveHUD-style breakdown: nobody's real name appears in the action/street
// text, only "Hero" or a position (BTN, CO, MP, ...) — the same convention
// the reference screenshot uses ("Hero checks, CO checks, BTN checks").
// Real names stay in the player list above, where DriveHUD does show them.
function buildLabelByName(replay) {
  const map = {};
  for (const p of replay.players) map[p.name] = p.isHero ? 'Hero' : p.position;
  return map;
}

function renderActionLine(actions, heroName, labelByName) {
  if (!actions.length) return '';
  return actions.map((a) => {
    if (a.isFold) return `<span class="hd-fold">fold</span>`;
    const isHero = a.player === heroName;
    const label = labelByName[a.player] || a.player;
    const labeledText = label + a.text.slice(a.player.length);
    return isHero ? `<span class="hd-hero-action">${escapeHtml(labeledText)}</span>` : escapeHtml(labeledText);
  }).join(', ');
}

function renderToolbarTitle(replay) {
  if (!replay) return '';
  const tableLabel = replay.tableType === 'bombpot' ? ' Bomb Pot' : '';
  return `${escapeHtml(formatStakesLimit(replay.stakesLabel))} (${replay.maxSeats}-max)${tableLabel} Hold'em`
    + `<span class="hd-toolbar-sep">·</span>${escapeHtml(replay.dateTime)}`
    + `<span class="hd-toolbar-sep">·</span>Hand #${escapeHtml(replay.handId)}`;
}

// The HUD stat line: VPIP/PFR/3-Bet (hands). Shared between the static
// player list and the table replayer's seats, both fed the same
// window.handDetail.getQuickPlayerStats result, so the two views can never
// disagree. Agg% was dropped from this line (not informative enough to
// earn the space, and threw off the seat/row alignment) — still computed
// and stored (src/handStore.js's getQuickPlayerStats), just not displayed.
function renderQuickStat(stats) {
  if (!stats || !stats.hands) return `<span class="hd-stat-empty">—</span>`;
  const three = stats.threeBet != null ? stats.threeBet : '–';
  return `${stats.vpip}/${stats.pfr}/${three} <small>(${stats.hands})</small>`;
}

function renderPlayers(replay, statsByName) {
  const rows = replay.players.map((p) => `
    <div class="hd-player-row${p.isHero ? ' hero' : ''}">
      <span class="hd-col-pos">${escapeHtml(p.position)}</span>
      <span class="hd-col-name">${escapeHtml(p.name)}${p.isHero ? ' <span class="hd-hero-tag">Hero</span>' : ''}</span>
      <span class="hd-col-stack-usd">$${p.stackUSD.toFixed(2)}</span>
      <span class="hd-col-stack-bb">${p.stackBB} BB</span>
      <span class="hd-col-stat" title="VPIP/PFR/3-Bet (hands)">${renderQuickStat(statsByName[p.name])}</span>
    </div>`).join('');
  return `<div class="hd-players">
    <div class="hd-player-row-head">
      <span class="hd-col-pos">Pos</span><span class="hd-col-name">Player</span><span class="hd-col-stack-usd">Stack $</span><span class="hd-col-stack-bb">Stack BB</span><span class="hd-col-stat">VPIP/PFR/3B</span>
    </div>
    ${rows}
  </div>`;
}

function renderPreflopCaption(replay) {
  const bits = [];
  if (replay.antesBB != null) {
    bits.push(replay.antesUniform ? `Ante ${replay.antesBB} BB` : 'Antes posted');
  }
  // The "SB"/"BB" tag already names the position, so a villain's own
  // position label would just repeat it ("SB SB 0.5 BB") — only call out
  // Hero explicitly here, the same way DriveHUD does.
  if (replay.sbLine) bits.push(`${replay.sbLine.name === replay.heroName ? 'Hero ' : ''}SB ${replay.sbLine.bb} BB`);
  if (replay.bbLine) bits.push(`${replay.bbLine.name === replay.heroName ? 'Hero ' : ''}BB ${replay.bbLine.bb} BB`);
  return bits.join('<span class="hd-toolbar-sep">·</span>');
}

function renderStreet(label, street, heroName, labelByName, extraClass) {
  if (!street) return '';
  const actionHtml = renderActionLine(street.actions, heroName, labelByName);
  return `<div class="hd-street${extraClass ? ' ' + extraClass : ''}">
    <div class="hd-street-header">
      <span class="hd-street-name">${escapeHtml(label)}</span>
      ${renderCards(street.board.join(' '))}
      <span class="hd-street-pot">${street.potBB} BB <small>${street.players}p</small></span>
    </div>
    ${actionHtml ? `<div class="hd-action-line">${actionHtml}</div>` : ''}
  </div>`;
}

function renderFormatted(replay, statsByName) {
  if (!replay) {
    return `<div class="hd-empty">This hand couldn't be formatted — it may have no resolution in the source data,
      or use a pattern this view doesn't recognize yet.</div>`;
  }

  const parts = [];
  const labelByName = buildLabelByName(replay);

  parts.push(renderPlayers(replay, statsByName || {}));

  if (replay.heroCards) {
    parts.push(`<div class="hd-dealt-bar"><span class="hd-dealt-label">Dealt to Hero</span>${renderCards(replay.heroCards)}</div>`);
  }

  const preflopCaption = renderPreflopCaption(replay);
  const preflopActionHtml = renderActionLine(replay.preflopActions, replay.heroName, labelByName);
  parts.push(`<div class="hd-street">
    <div class="hd-street-header">
      <span class="hd-street-name">Preflop</span>
      ${preflopCaption ? `<span class="hd-street-pot hd-preflop-caption">${preflopCaption}</span>` : ''}
    </div>
    ${preflopActionHtml ? `<div class="hd-action-line">${preflopActionHtml}</div>` : ''}
  </div>`);

  parts.push(renderStreet('Flop', replay.streets.flop, replay.heroName, labelByName));
  parts.push(renderStreet('Turn', replay.streets.turn, replay.heroName, labelByName));
  parts.push(renderStreet('River', replay.streets.river, replay.heroName, labelByName));

  if (replay.isRunTwice && replay.secondRun) {
    parts.push('<div class="hd-notice-line">Players agreed to run it twice.</div>');
    parts.push(renderStreet('Flop (Run 2)', replay.secondRun.flop, replay.heroName, labelByName, 'hd-second-run'));
    parts.push(renderStreet('Turn (Run 2)', replay.secondRun.turn, replay.heroName, labelByName, 'hd-second-run'));
    parts.push(renderStreet('River (Run 2)', replay.secondRun.river, replay.heroName, labelByName, 'hd-second-run'));
  }

  if (replay.showdown.length) {
    const showRows = replay.showdown.map((sd) => `
      <div class="hd-shows-row${sd.isHero ? ' hero' : ''}">
        <span class="hd-shows-name">${sd.isHero ? 'Hero' : escapeHtml(labelByName[sd.name] || sd.name)}</span>${renderCards(sd.cards)}<span class="hd-handtype">${escapeHtml(sd.handType)}</span>
      </div>`).join('');
    parts.push(`<div class="hd-showdown">${showRows}</div>`);
  }

  if (replay.winners.length === 0) {
    parts.push('<div class="hd-action-line">No winner could be determined for this hand.</div>');
  } else {
    const winnerText = replay.winners.map((w) => {
      const who = w.isHero ? 'Hero' : escapeHtml(labelByName[w.name] || w.name);
      const text = `${who} wins ${w.amountBB} BB`;
      return w.isHero ? `<span class="hd-hero-action">${text}</span>` : text;
    }).join(', ');
    parts.push(`<div class="hd-action-line">${winnerText}</div>`);
  }

  return parts.join('\n');
}

// ── Visual table replayer ────────────────────────────────────────────
// A step-through oval table: prev/next only, no autoplay. Every timeline
// entry from src/handReplay.js is a full snapshot (pot, board, per-seat
// stack, folded-so-far), so rendering any step is just reading that one
// entry — no state carried between renders except which index we're on.

// Seats placed around an ellipse, Hero always at the bottom, then the rest
// of the table in real seat order going clockwise — matching the reference
// screenshot's layout. `replay.players` is already sorted by ascending
// seat number, so this is just a rotation, not a re-sort.
function orderedSeatsFromHero(players) {
  const heroIdx = players.findIndex((p) => p.isHero);
  const startIdx = heroIdx === -1 ? 0 : heroIdx;
  const n = players.length;
  const ordered = [];
  for (let i = 0; i < n; i++) ordered.push(players[(startIdx + i) % n]);
  return ordered;
}

// Angle INCREASES with seat index here, not decreases — on screen (y grows
// downward), sweeping from the bottom (90°) toward 180° moves left first,
// which is the true clockwise direction as drawn (picture a clock hand at
// 6 o'clock sweeping toward 7, 8, 9 — i.e. left — not backward toward 5,
// 4, 3). Subtracting instead of adding here was a real bug: it drew seat
// order 1, 2, 3... to the right of Hero, so a hero-is-SB hand showed BB on
// Hero's right instead of left. Verified against real hands after fixing.
function seatLayoutPositions(n) {
  const rx = 44, ry = 40;
  const positions = [];
  for (let i = 0; i < n; i++) {
    const angle = (Math.PI / 2) + (i * 2 * Math.PI / n);
    positions.push({
      xPct: 50 + rx * Math.cos(angle),
      yPct: 50 + ry * Math.sin(angle),
    });
  }
  return positions;
}

// Hand-tuned racetrack layouts for the three sizes Weplay actually deals
// (6/7/8-max), matching the reference screenshot's real clustering (8-max:
// 3 seats top / 1 right / 3 bottom / 1 left) rather than an evenly-spaced
// ellipse — the generic formula above stays as the fallback for any other
// seat count. Each list is in the same clockwise-from-Hero order
// orderedSeatsFromHero already produces, Hero always the bottom-center (or
// bottom-center-most) seat — index 1 (the next seat clockwise, i.e. the
// next to act) is on Hero's LEFT (mirrors seatLayoutPositions' own fix
// above, for the same real bug).
const HAND_TUNED_LAYOUTS = {
  6: [
    { xPct: 62, yPct: 90 }, { xPct: 38, yPct: 90 },
    { xPct: 6, yPct: 50 },
    { xPct: 35, yPct: 10 }, { xPct: 65, yPct: 10 },
    { xPct: 94, yPct: 50 },
  ],
  7: [
    { xPct: 50, yPct: 91 }, { xPct: 27, yPct: 85 },
    { xPct: 6, yPct: 50 },
    { xPct: 35, yPct: 10 }, { xPct: 65, yPct: 10 },
    { xPct: 94, yPct: 50 },
    { xPct: 73, yPct: 85 },
  ],
  8: [
    { xPct: 50, yPct: 92 }, { xPct: 27, yPct: 85 },
    { xPct: 6, yPct: 50 },
    { xPct: 27, yPct: 13 }, { xPct: 50, yPct: 7 }, { xPct: 73, yPct: 13 },
    { xPct: 94, yPct: 50 },
    { xPct: 73, yPct: 85 },
  ],
};

function seatLayoutForSize(n) {
  return HAND_TUNED_LAYOUTS[n] || seatLayoutPositions(n);
}

function renderSeat(player, pos, step, replay, statsByName) {
  const posLabel = player.isHero ? 'Hero' : player.position;
  const stackBB = step.stacksBB[player.name];
  const isFolded = step.foldedSoFar.includes(player.name);
  const isDealer = player.position === 'BTN';
  // Highlight whoever is actually acting at this step, not a fixed seat —
  // clears the moment the step moves past them (a fold or otherwise).
  const isActive = step.kind === 'action' && step.player === player.name;
  const showdownReached = step.kind === 'showdown' || step.kind === 'result';
  const shown = replay.showdown.find((sd) => sd.name === player.name);

  let cardsHtml = '';
  if (player.isHero && replay.heroCards) cardsHtml = renderCards(replay.heroCards);
  else if (showdownReached && shown) cardsHtml = renderCards(shown.cards);

  return `<div class="hd-seat${isActive ? ' active' : ''}${isFolded ? ' folded' : ''}" style="left:${pos.xPct}%; top:${pos.yPct}%;">
    ${isDealer ? '<span class="hd-dealer-badge">D</span>' : ''}
    <div class="hd-seat-label">
      <span class="hd-seat-pos">${escapeHtml(posLabel)}</span>
      ${player.isHero ? '' : `<span class="hd-seat-name">${escapeHtml(player.name)}</span>`}
    </div>
    ${cardsHtml ? `<div class="hd-seat-cards">${cardsHtml}</div>` : ''}
    <div class="hd-seat-stack">${stackBB} BB</div>
    <div class="hd-seat-hud">${renderQuickStat(statsByName[player.name])}</div>
  </div>`;
}

function chipIcon(extraClass) {
  return `<span class="hd-chip-icon${extraClass ? ' ' + extraClass : ''}"></span>`;
}

// The pot text only ever shows chips already swept in — betsBB (rendered
// separately, in front of each contributing seat) covers the current
// street's live action, matching the standard replayer convention (Hand2Note,
// PokerStars, etc.) of not folding live bets into the pot number until the
// street actually resolves.
function renderTableCenter(step) {
  const betsSum = Object.values(step.betsBB).reduce((s, v) => s + v, 0);
  const potInMiddle = Math.round((step.potBB - betsSum) * 100) / 100;
  const boardHtml = step.board.length ? renderCards(step.board.join(' ')) : '<span class="hd-table-board-empty">Waiting for board…</span>';
  return `<div class="hd-table-center">
    <div class="hd-table-board">${boardHtml}</div>
    <div class="hd-table-pot">${chipIcon()}Pot: ${potInMiddle} BB</div>
  </div>`;
}

// Chips still sitting in front of a player, not yet swept into the pot —
// one marker per player with a nonzero betsBB entry at this step,
// positioned along the line from table-center out to that seat's own
// {xPct,yPct}, closer to the seat than the center.
function renderBetMarkers(ordered, positions, step) {
  const BET_MARKER_FRACTION = 0.58;
  return ordered.map((p, i) => {
    const bb = step.betsBB[p.name];
    if (!bb) return '';
    const pos = positions[i];
    const x = 50 + (pos.xPct - 50) * BET_MARKER_FRACTION;
    const y = 50 + (pos.yPct - 50) * BET_MARKER_FRACTION;
    const folded = step.foldedSoFar.includes(p.name);
    return `<div class="hd-bet-marker${folded ? ' folded' : ''}" style="left:${x}%; top:${y}%;">${chipIcon()}${bb} BB</div>`;
  }).join('');
}

function stepCaption(step, labelByName, heroName, replay) {
  if (step.kind === 'start') return 'Hand dealt, antes/blinds posted.';
  if (step.kind === 'street') {
    const streetLabel = step.street.charAt(0).toUpperCase() + step.street.slice(1);
    return `${streetLabel}${step.run === 2 ? ' (Run 2)' : ''} dealt.`;
  }
  if (step.kind === 'action') {
    const label = labelByName[step.player] || step.player;
    return label + step.actionText.slice(step.player.length);
  }
  if (step.kind === 'showdown') return 'Showdown.';
  if (step.kind === 'result') {
    if (!replay.winners.length) return 'No winner could be determined for this hand.';
    return replay.winners.map((w) => `${w.isHero ? 'Hero' : (labelByName[w.name] || w.name)} wins ${w.amountBB} BB`).join(', ');
  }
  return '';
}

function transportIcon(d) {
  return `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="${d}"/></svg>`;
}

function renderReplayTable(replay, labelByName, statsByName) {
  const timeline = replay.timeline;
  const step = timeline[stepIndex];
  const ordered = orderedSeatsFromHero(replay.players);
  const positions = seatLayoutForSize(ordered.length);
  const seatsHtml = ordered.map((p, i) => renderSeat(p, positions[i], step, replay, statsByName)).join('');
  const atStart = stepIndex === 0;
  const atEnd = stepIndex === timeline.length - 1;

  return `
    <div class="hd-table">
      ${seatsHtml}
      ${renderBetMarkers(ordered, positions, step)}
      ${renderTableCenter(step)}
    </div>
    <div class="hd-transport">
      <button class="hd-icon-btn" data-step-action="first" ${atStart ? 'disabled' : ''} title="First step">${transportIcon('M6 5h2v14H6zM19 5 8 12l11 7z')}</button>
      <button class="hd-icon-btn" data-step-action="prev" ${atStart ? 'disabled' : ''} title="Previous step">${transportIcon('m15 5-7 7 7 7z')}</button>
      <button class="hd-icon-btn" data-step-action="next" ${atEnd ? 'disabled' : ''} title="Next step">${transportIcon('m9 5 7 7-7 7z')}</button>
      <button class="hd-icon-btn" data-step-action="last" ${atEnd ? 'disabled' : ''} title="Last step">${transportIcon('M16 5h2v14h-2zM5 5l11 7-11 7z')}</button>
      <div class="hd-transport-caption">${escapeHtml(stepCaption(step, labelByName, replay.heroName, replay))}</div>
      <div class="hd-transport-progress">${stepIndex + 1} / ${timeline.length}</div>
    </div>`;
}

function renderCurrentView() {
  if (replayMode && currentReplay && currentReplay.timeline && currentReplay.timeline.length) {
    handFormatted.innerHTML = renderReplayTable(currentReplay, currentLabelByName, currentStatsByName);
  } else {
    handFormatted.innerHTML = renderFormatted(currentReplay, currentStatsByName);
  }
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const handId = params.get('handId');
  const perspectivePlayer = params.get('perspectivePlayer') || undefined;
  document.title = `Hand #${handId || '?'}`;

  if (!handId) {
    hdToolbarTitle.textContent = 'No hand ID provided.';
    handFormatted.textContent = 'No hand ID provided.';
    downloadHandBtn.disabled = true;
    return;
  }

  const record = await window.handDetail.getHandDetail(handId, perspectivePlayer, { replaceHeroName: true });
  if (!record) {
    hdToolbarTitle.textContent = `Hand #${handId} not found`;
    handFormatted.textContent = `Hand #${handId} not found in the database.`;
    downloadHandBtn.disabled = true;
    return;
  }

  currentReplay = record.replay;
  currentStatsByName = record.replay
    ? await window.handDetail.getQuickPlayerStats(record.replay.players.map((p) => p.name))
    : {};
  currentLabelByName = record.replay ? buildLabelByName(record.replay) : {};

  hdToolbarTitle.innerHTML = renderToolbarTitle(record.replay);
  renderCurrentView();

  const canReplay = !!(currentReplay && currentReplay.timeline && currentReplay.timeline.length);
  replayHandBtn.disabled = !canReplay;
  replayHandBtn.title = canReplay ? 'Replay hand' : 'Replay unavailable for this hand';
  replayHandBtn.addEventListener('click', () => {
    if (!canReplay) return;
    replayMode = !replayMode;
    if (replayMode) stepIndex = 0;
    replayHandBtn.classList.toggle('hd-icon-btn-active', replayMode);
    replayHandBtn.title = replayMode ? 'Back to summary' : 'Replay hand';
    renderCurrentView();
  });

  handFormatted.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-step-action]');
    if (!btn || btn.disabled || !replayMode) return;
    const timeline = currentReplay.timeline;
    const action = btn.dataset.stepAction;
    if (action === 'first') stepIndex = 0;
    else if (action === 'prev') stepIndex = Math.max(0, stepIndex - 1);
    else if (action === 'next') stepIndex = Math.min(timeline.length - 1, stepIndex + 1);
    else if (action === 'last') stepIndex = timeline.length - 1;
    renderCurrentView();
  });

  downloadHandBtn.addEventListener('click', async () => {
    downloadHandBtn.disabled = true;
    downloadHandBtn.classList.add('hd-icon-btn-busy');
    try {
      // A little extra room beyond the content's own height for the
      // toolbar above it and some breathing room, so the saved image
      // isn't cropped right at the last line of text.
      const contentHeight = handFormatted.scrollHeight + 70;
      await window.handDetail.downloadHandImage(handId, contentHeight);
    } catch (err) {
      console.error('Failed to save hand image:', err);
    } finally {
      downloadHandBtn.disabled = false;
      downloadHandBtn.classList.remove('hd-icon-btn-busy');
    }
  });
}

init();
