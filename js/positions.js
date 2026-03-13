/**
 * js/positions.js — Bähr Position Browser
 *
 * Enumerates all 1,202 KPPvKP positions where Bähr's rule applies,
 * compares each against Syzygy and the other rules, and renders them
 * as a flat filterable grid of mini boards.
 */

import { ALL_RULES, BahrRule } from './rules.js';
import { iteratePositions, positionToFen } from './position.js';
import { initSyzygy, isSyzygyReady, lookupPosition } from './syzygy.js';

// ── Constants ──────────────────────────────────────────────────────────────────

const MINI_SZ   = 88;   // mini board canvas size (px)
const DETAIL_SZ = 320;  // detail board canvas size (px)

// Board square colors
const LIGHT_SQ = '#f0d9b5';
const DARK_SQ  = '#b58863';

// Piece Unicode glyphs  (white = filled, black = outline)
const PIECE_GLYPHS = {
  wk: '♔', wq: '♕', wr: '♖', wb: '♗', wn: '♘', wp: '♙',
  bk: '♚', bq: '♛', br: '♜', bb: '♝', bn: '♞', bp: '♟',
};

const RULE_COLORS = {
  bahr:      '#f0c040',
  muller:    '#e06880',
  dvoretsky: '#50d8a0',
  race:      '#a880e8',
};

const SYZYGY_COLOR = '#40c0f0';

// ── Filter configuration ───────────────────────────────────────────────────────

const FILTER_ROWS = [
  { key: 'bahr',      label: 'Bähr',      color: RULE_COLORS.bahr,      options: ['any','win','draw','loss','right','wrong'] },
  { key: 'muller',    label: 'Müller',    color: RULE_COLORS.muller,    options: ['any','win','draw','loss','right','wrong'] },
  { key: 'dvoretsky', label: 'Dvoretsky', color: RULE_COLORS.dvoretsky, options: ['any','win','draw','loss','right','wrong'] },
  { key: 'race',      label: 'Race',      color: RULE_COLORS.race,      options: ['any','win','draw','loss','right','wrong'] },
  { key: 'syzygy',    label: 'Syzygy',    color: SYZYGY_COLOR,          options: ['any','win','draw','loss'] },
  { key: 'agreement', label: 'Rules',     color: null,                  options: ['any','agree','disagree'] },
];

const BUTTON_LABELS = {
  any: 'Any', win: 'Win', draw: 'Draw', loss: 'Loss',
  right: '✓ Right', wrong: '✗ Wrong',
  agree: 'All agree', disagree: '≥2 disagree',
};

// ── State ──────────────────────────────────────────────────────────────────────

let selectedPos    = null;
let selectedCanvas = null;
let allPositions   = [];

const filterState = {
  bahr:      'any',
  muller:    'any',
  dvoretsky: 'any',
  race:      'any',
  syzygy:    'any',
  agreement: 'any',
};

// ── Entry point ────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);

async function init() {
  setStatus('Loading Syzygy tablebase…');
  await initSyzygy();

  setStatus('Collecting positions…');
  allPositions = collectPositions();

  setStatus('Rendering…');
  // yield to let status message paint
  await new Promise(r => setTimeout(r, 0));

  const area = document.getElementById('grid-area');
  renderFilters(area, allPositions);
  updateGrid(allPositions);

  document.getElementById('loading-overlay').style.display = 'none';
  document.getElementById('pos-layout').style.display = '';
  setStatus(`${allPositions.length} positions where Bähr applies.`);
}

// ── Position collection ────────────────────────────────────────────────────────

/**
 * Iterate all KPPvKP positions, filter to Bähr-applicable ones, and
 * evaluate each rule + Syzygy.  Returns array of enriched position objects.
 */
function collectPositions() {
  const result = [];
  iteratePositions(pos => {
    if (!BahrRule.isApplicable(pos)) return;

    const preds = {};
    for (const rule of ALL_RULES) {
      preds[rule.id] = rule.isApplicable(pos) ? rule.predict(pos) : null;
    }

    const fen     = positionToFen(pos);
    const syzPred = isSyzygyReady() ? lookupPosition(pos) : null;

    result.push({ ...pos, fen, syzPred, preds });
  });
  return result;
}

// ── Filter UI ──────────────────────────────────────────────────────────────────

function renderFilters(area, positions) {
  const panel = document.createElement('div');
  panel.className = 'pos-filters card';
  panel.id = 'filter-panel';

  for (const row of FILTER_ROWS) {
    const rowEl = document.createElement('div');
    rowEl.className = 'pos-filter-row';

    const label = document.createElement('span');
    label.className = 'pos-filter-label';
    if (row.color) {
      const dot = document.createElement('span');
      dot.className = 'pos-filter-dot';
      dot.style.background = row.color;
      label.appendChild(dot);
    }
    label.appendChild(document.createTextNode(row.label));
    rowEl.appendChild(label);

    const btnGroup = document.createElement('div');
    btnGroup.className = 'pos-filter-btngroup';

    for (const val of row.options) {
      const btn = document.createElement('button');
      btn.className = 'pos-filter-btn';
      btn.dataset.key   = row.key;
      btn.dataset.value = val;
      btn.textContent   = BUTTON_LABELS[val];

      if (filterState[row.key] === val) btn.classList.add('active');

      // Disable syzygy-dependent buttons if tablebase not loaded
      const syzygyDependent = (val === 'right' || val === 'wrong') ||
                              (row.key === 'syzygy' && val !== 'any');
      if (syzygyDependent && !isSyzygyReady()) {
        btn.disabled = true;
        btn.title = 'Syzygy tablebase not loaded';
      }

      btn.addEventListener('click', () => {
        filterState[row.key] = val;
        btnGroup.querySelectorAll('.pos-filter-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.value === val);
        });
        updateGrid(positions);
      });

      btnGroup.appendChild(btn);
    }

    rowEl.appendChild(btnGroup);
    panel.appendChild(rowEl);
  }

  const countEl = document.createElement('div');
  countEl.className = 'pos-filter-count';
  countEl.id = 'filter-count';
  panel.appendChild(countEl);

  area.appendChild(panel);

  // Grid container (populated by updateGrid)
  const grid = document.createElement('div');
  grid.className = 'pos-mini-grid';
  grid.id = 'mini-grid';
  area.appendChild(grid);
}

function matchesFilter(pos) {
  const syzKnown = pos.syzPred && pos.syzPred !== 'unknown';

  // Per-rule filters
  for (const ruleKey of ['bahr', 'muller', 'dvoretsky', 'race']) {
    const f = filterState[ruleKey];
    if (f === 'any') continue;

    const pred = pos.preds[ruleKey];

    if (f === 'win' || f === 'draw' || f === 'loss') {
      if (pred !== f) return false;
    } else if (f === 'right') {
      if (!syzKnown || pred === null || pred !== pos.syzPred) return false;
    } else if (f === 'wrong') {
      if (!syzKnown || pred === null || pred === pos.syzPred) return false;
    }
  }

  // Syzygy filter
  if (filterState.syzygy !== 'any') {
    if (pos.syzPred !== filterState.syzygy) return false;
  }

  // Agreement filter
  const af = filterState.agreement;
  if (af !== 'any') {
    const activePreds = ALL_RULES.map(r => pos.preds[r.id]).filter(p => p !== null);
    const unique = new Set(activePreds);
    if (af === 'agree'    && unique.size !== 1) return false;
    if (af === 'disagree' && unique.size < 2)   return false;
  }

  return true;
}

function updateGrid(positions) {
  const grid    = document.getElementById('mini-grid');
  const countEl = document.getElementById('filter-count');
  if (!grid) return;

  const filtered = positions.filter(matchesFilter);

  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} / ${positions.length}`;
  }

  grid.innerHTML = '';

  for (const pos of filtered) {
    const syzKnown  = pos.syzPred && pos.syzPred !== 'unknown';
    const bahrWrong = syzKnown && pos.preds.bahr !== pos.syzPred;

    const wrapper = document.createElement('div');
    wrapper.className = 'pos-mini-wrapper';
    if (bahrWrong) wrapper.classList.add('pos-mini-wrong');

    const canvas = document.createElement('canvas');
    canvas.width  = MINI_SZ;
    canvas.height = MINI_SZ;
    canvas.className = 'pos-mini-canvas';
    drawBoard(canvas, pos, MINI_SZ);
    wrapper.appendChild(canvas);

    // Verdict badge
    const badge = document.createElement('div');
    badge.className = 'pos-mini-badge';
    if (syzKnown) {
      const syzLabel = pos.syzPred === 'win' ? 'W wins' : pos.syzPred === 'draw' ? 'Draw' : 'B wins';
      badge.textContent = syzLabel;
      badge.classList.add(pos.syzPred === 'win' ? 'badge-win' : pos.syzPred === 'draw' ? 'badge-draw' : 'badge-loss');
    } else {
      const bahrPred = pos.preds.bahr;
      badge.textContent = bahrPred === 'win' ? 'W wins' : 'Draw';
      badge.classList.add(bahrPred === 'win' ? 'badge-win' : 'badge-draw');
    }
    wrapper.appendChild(badge);

    wrapper.addEventListener('click', () => selectPosition(pos, canvas, wrapper));
    grid.appendChild(wrapper);
  }
}

// ── Board drawing ──────────────────────────────────────────────────────────────

/**
 * Draw a KPPvKP position onto a canvas.
 */
function drawBoard(canvas, pos, size) {
  const sq  = size / 8;
  const ctx = canvas.getContext('2d');

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const x = file * sq;
      const y = (7 - rank) * sq;
      ctx.fillStyle = (file + rank) % 2 === 0 ? DARK_SQ : LIGHT_SQ;
      ctx.fillRect(x, y, sq, sq);
    }
  }

  const pieces   = positionToPieces(pos);
  const fontSize = Math.round(sq * 0.72);
  ctx.font         = `${fontSize}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (const { file, rank, glyph, isWhite } of pieces) {
    const cx = file * sq + sq / 2;
    const cy = (7 - rank) * sq + sq / 2;

    ctx.fillStyle = isWhite ? '#000' : '#fff';
    ctx.fillText(glyph, cx + 1, cy + 1);
    ctx.fillStyle = isWhite ? '#fff' : '#1a1a1a';
    ctx.fillText(glyph, cx, cy);
  }
}

function positionToPieces(pos) {
  return [
    { file: pos.wKf,      rank: pos.wKr,   glyph: PIECE_GLYPHS.wk, isWhite: true  },
    { file: pos.rookFile, rank: pos.wRR,   glyph: PIECE_GLYPHS.wp, isWhite: true  },
    { file: pos.xFile,    rank: pos.xRank, glyph: PIECE_GLYPHS.wp, isWhite: true  },
    { file: pos.bKf,      rank: pos.bKr,   glyph: PIECE_GLYPHS.bk, isWhite: false },
    { file: pos.rookFile, rank: pos.bRR,   glyph: PIECE_GLYPHS.bp, isWhite: false },
  ];
}

// ── Detail view ────────────────────────────────────────────────────────────────

function selectPosition(pos, canvas, wrapper) {
  if (selectedCanvas) {
    selectedCanvas.closest('.pos-mini-wrapper')?.classList.remove('pos-mini-selected');
  }
  wrapper.classList.add('pos-mini-selected');
  selectedCanvas = canvas;
  selectedPos    = pos;

  const detailCanvas = document.getElementById('detail-canvas');
  drawBoard(detailCanvas, pos, DETAIL_SZ);

  const scoresEl = document.getElementById('detail-scores');
  scoresEl.innerHTML = renderScoreRows(pos);

  const fenEl = document.getElementById('detail-fen');
  fenEl.textContent = pos.fen;

  document.getElementById('detail-copy-btn').onclick = () => {
    navigator.clipboard?.writeText(pos.fen);
  };

  const encoded = pos.fen.replace(/ /g, '_');
  document.getElementById('detail-lichess').href   = `https://lichess.org/analysis/${encoded}`;
  document.getElementById('detail-validator').href = `index.html?fen=${encodeURIComponent(pos.fen)}`;

  document.getElementById('detail-placeholder').style.display = 'none';
  document.getElementById('detail-content').style.display     = '';

  document.getElementById('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderScoreRows(pos) {
  let html = '<div class="rule-score-list">';

  for (const rule of ALL_RULES) {
    const color      = RULE_COLORS[rule.id] ?? '#888';
    const applicable = rule.isApplicable(pos);
    const pred       = applicable ? rule.predict(pos) : null;

    html += `<div class="rule-score-row">`;
    html += `<span class="rule-score-dot" style="background:${color}"></span>`;
    html += `<span class="rule-score-name">${rule.name}</span>`;

    if (pred !== null) {
      const cls   = pred === 'win' ? 'win' : 'draw';
      const label = pred === 'win' ? 'White wins' : 'Draw';
      html += `<strong class="${cls}">${label}</strong>`;

      if (pos.syzPred && pos.syzPred !== 'unknown') {
        const match = pred === pos.syzPred;
        html += `<span class="rule-score-verdict ${match ? 'agree' : 'disagree'}">${match ? '✓' : '✗'}</span>`;
      }
    } else {
      html += `<em class="rule-na">N/A</em>`;
    }
    html += `</div>`;
  }

  html += '</div>';

  if (pos.syzPred && pos.syzPred !== 'unknown') {
    const syzLabel = { win: 'White wins', draw: 'Draw', loss: 'Black wins' }[pos.syzPred];
    const syzClass = { win: 'win',        draw: 'draw', loss: 'loss'       }[pos.syzPred];
    html += `<div class="syzygy-score-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:6px">
      <span class="rule-score-dot" style="background:${SYZYGY_COLOR}"></span>
      Syzygy: <strong class="${syzClass}">${syzLabel}</strong>
    </div>`;
  }

  return html;
}

// ── Utilities ──────────────────────────────────────────────────────────────────

function setStatus(msg) {
  const el = document.getElementById('pos-status');
  if (el) el.textContent = msg;
  const lm = document.getElementById('loading-msg');
  if (lm) lm.textContent = msg;
}
