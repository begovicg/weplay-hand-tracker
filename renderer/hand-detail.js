'use strict';

const handFormatted = document.getElementById('handFormatted');
const downloadHandBtn = document.getElementById('downloadHandBtn');

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// ── PokerTracker-style formatted view ──────────────────────────────────

const SUIT_CLASS = { s: 'suit-s', h: 'suit-h', d: 'suit-d', c: 'suit-c' };

function renderCards(cardsStr) {
  if (!cardsStr) return '';
  const badges = cardsStr.trim().split(/\s+/).filter(Boolean).map((c) => {
    const rank = c.slice(0, -1);
    const suit = c.slice(-1).toLowerCase();
    const cls = SUIT_CLASS[suit] || 'suit-s';
    return `<span class="card-badge ${cls}">${escapeHtml(rank)}</span>`;
  }).join('');
  return `<span class="hf-cards">${badges}</span>`;
}

function renderActionLine(actions, heroName) {
  return actions.map((a) => {
    if (a.isFold) return `<span class="hf-fold">fold</span>`;
    if (heroName && a.text.startsWith(`${heroName} `)) return `<span class="hf-hero-action">${escapeHtml(a.text)}</span>`;
    return escapeHtml(a.text);
  }).join(', ');
}

function renderFormatted(replay) {
  if (!replay) {
    return `<div class="hf-empty">This hand couldn't be formatted — it may have no resolution in the source data,
      or use a pattern this view doesn't recognize yet.</div>`;
  }

  const parts = [];
  const tableLabel = replay.tableType === 'bombpot' ? ' (Bomb Pot)' : '';
  parts.push(`<div class="hf-title">Weplay - ${escapeHtml(replay.stakesLabel)} NL (${replay.maxSeats}-max) - Hold'em${tableLabel}</div>`);

  parts.push('<div class="hf-players">');
  for (const p of replay.players) {
    parts.push(`<div class="hf-player-line ${p.isHero ? 'hero' : ''}">${escapeHtml(p.name)} (${p.position}): ${p.stackBB} BB</div>`);
  }
  parts.push('</div>');

  if (replay.antesBB != null) {
    parts.push(replay.antesUniform
      ? `<div class="hf-ante-line">All players post antes of ${replay.antesBB} BB</div>`
      : `<div class="hf-ante-line">Antes posted</div>`);
  }

  if (replay.sbLine || replay.bbLine) {
    const bits = [];
    if (replay.sbLine) bits.push(`${escapeHtml(replay.sbLine.name)} posts SB ${replay.sbLine.bb} BB`);
    if (replay.bbLine) bits.push(`${escapeHtml(replay.bbLine.name)} posts BB ${replay.bbLine.bb} BB`);
    parts.push(`<div class="hf-posts-line">${bits.join(', ')}</div>`);
  }

  if (replay.heroCards) {
    parts.push(`<div class="hf-dealt-line"><span>Dealt to ${escapeHtml(replay.heroName)}:</span>${renderCards(replay.heroCards)}</div>`);
  }

  if (replay.preflopActions.length) {
    parts.push(`<div class="hf-action-line">${renderActionLine(replay.preflopActions, replay.heroName)}</div>`);
  }

  function renderStreet(label, street) {
    if (!street) return;
    parts.push(`<div class="hf-street-header"><span>${escapeHtml(label)} (${street.potBB} BB, ${street.players} player${street.players === 1 ? '' : 's'}):</span>${renderCards(street.board.join(' '))}</div>`);
    if (street.actions.length) {
      parts.push(`<div class="hf-action-line">${renderActionLine(street.actions, replay.heroName)}</div>`);
    }
  }
  renderStreet('Flop', replay.streets.flop);
  renderStreet('Turn', replay.streets.turn);
  renderStreet('River', replay.streets.river);

  if (replay.isRunTwice && replay.secondRun) {
    parts.push('<div class="hf-notice-line">Players agreed to run it twice.</div>');
    renderStreet('Flop #2', replay.secondRun.flop);
    renderStreet('Turn #2', replay.secondRun.turn);
    renderStreet('River #2', replay.secondRun.river);
  }

  for (const sd of replay.showdown) {
    parts.push(`<div class="hf-shows-line ${sd.isHero ? 'hero' : ''}"><span class="hf-shows-name">${escapeHtml(sd.name)} shows:</span>${renderCards(sd.cards)}<span class="hf-handtype-line">(${escapeHtml(sd.handType)})</span></div>`);
  }

  if (replay.winners.length === 0) {
    parts.push('<div class="hf-winner-line">No winner could be determined for this hand.</div>');
  }
  for (const w of replay.winners) {
    parts.push(`<div class="hf-winner-line">${escapeHtml(w.name)} wins ${w.amountBB} BB</div>`);
  }

  return parts.join('\n');
}

async function init() {
  const params = new URLSearchParams(window.location.search);
  const handId = params.get('handId');
  const perspectivePlayer = params.get('perspectivePlayer') || undefined;
  document.title = `Hand #${handId || '?'}`;

  if (!handId) {
    handFormatted.textContent = 'No hand ID provided.';
    downloadHandBtn.disabled = true;
    return;
  }

  const record = await window.handDetail.getHandDetail(handId, perspectivePlayer, { replaceHeroName: true });
  if (!record) {
    handFormatted.textContent = `Hand #${handId} not found in the database.`;
    downloadHandBtn.disabled = true;
    return;
  }

  handFormatted.innerHTML = renderFormatted(record.replay);

  downloadHandBtn.addEventListener('click', async () => {
    const originalLabel = downloadHandBtn.textContent;
    downloadHandBtn.disabled = true;
    downloadHandBtn.textContent = 'Saving…';
    try {
      // A little extra room beyond the content's own height for the
      // toolbar above it and some breathing room, so the saved image
      // isn't cropped right at the last line of text.
      const contentHeight = handFormatted.scrollHeight + 70;
      const result = await window.handDetail.downloadHandImage(handId, contentHeight);
      downloadHandBtn.textContent = result && result.saved ? '✓ Saved' : originalLabel;
    } catch (err) {
      console.error('Failed to save hand image:', err);
      downloadHandBtn.textContent = originalLabel;
    } finally {
      downloadHandBtn.disabled = false;
      if (downloadHandBtn.textContent === '✓ Saved') {
        setTimeout(() => { downloadHandBtn.textContent = originalLabel; }, 1800);
      }
    }
  });
}

init();

