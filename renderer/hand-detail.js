'use strict';

const handFormatted = document.getElementById('handFormatted');
const downloadHandBtn = document.getElementById('downloadHandBtn');
const hdToolbarTitle = document.getElementById('hdToolbarTitle');

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

function renderQuickStat(stats) {
  if (!stats || !stats.hands) return `<span class="hd-stat-empty">—</span>`;
  return `${stats.vpip}/${stats.pfr} <small>(${stats.hands})</small>`;
}

function renderPlayers(replay, statsByName) {
  const rows = replay.players.map((p) => `
    <div class="hd-player-row${p.isHero ? ' hero' : ''}">
      <span class="hd-col-pos">${escapeHtml(p.position)}</span>
      <span class="hd-col-name">${escapeHtml(p.name)}${p.isHero ? ' <span class="hd-hero-tag">Hero</span>' : ''}</span>
      <span class="hd-col-stack-usd">$${p.stackUSD.toFixed(2)}</span>
      <span class="hd-col-stack-bb">${p.stackBB} BB</span>
      <span class="hd-col-stat" title="VPIP/PFR (hands)">${renderQuickStat(statsByName[p.name])}</span>
    </div>`).join('');
  return `<div class="hd-players">
    <div class="hd-player-row-head">
      <span class="hd-col-pos">Pos</span><span class="hd-col-name">Player</span><span class="hd-col-stack-usd">Stack $</span><span class="hd-col-stack-bb">Stack BB</span><span class="hd-col-stat">VPIP/PFR</span>
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

  const statsByName = record.replay
    ? await window.handDetail.getQuickPlayerStats(record.replay.players.map((p) => p.name))
    : {};

  hdToolbarTitle.innerHTML = renderToolbarTitle(record.replay);
  handFormatted.innerHTML = renderFormatted(record.replay, statsByName);

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
