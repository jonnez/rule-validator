/**
 * js/positions.js — Bähr Position Browser
 *
 * Enumerates all 1,202 KPPvKP positions where Bähr's rule applies,
 * compares each against Syzygy and the other rules, and renders them
 * as mini canvas boards grouped by category.
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

// Category border colors
const COLOR_BAHR_WRONG  = '#e06060';  // Bähr incorrect vs Syzygy
const COLOR_RULES_SPLIT = '#d4a030';  // Bähr correct but other rules diverge
const COLOR_ALL_AGREE   = '#4caf50';  // everything agrees

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

// ── State ──────────────────────────────────────────────────────────────────────

let selectedPos   = null;   // currently clicked position object
let selectedCanvas = null;  // the highlighted mini canvas

// ── Entry point ────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);

async function init() {
  setStatus('Loading Syzygy tablebase…');
  await initSyzygy();

  setStatus('Collecting positions…');
  const positions = collectPositions();

  setStatus('Rendering…');
  // yield to let status message paint
  await new Promise(r => setTimeout(r, 0));

  renderAll(positions);

  document.getElementById('loading-overlay').style.display  = 'none';
  document.getElementById('pos-layout').style.display = '';
  setStatus(`${positions.length} positions where Bähr applies.`);
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

    const bahrPred = BahrRule.predict(pos);
    const syzPred  = isSyzygyReady() ? lookupPosition(pos) : null;

    // Per-rule predictions for all four rules
    const preds = {};
    for (const rule of ALL_RULES) {
      preds[rule.id] = rule.isApplicable(pos) ? rule.predict(pos) : null;
    }

    const fen = positionToFen(pos);

    // Determine category
    let category;
    if (syzPred && syzPred !== 'unknown') {
      if (bahrPred !== syzPred) {
        category = bahrPred === 'win' ? 'bahr-false-win' : 'bahr-false-draw';
      } else {
        // Bähr correct — do other rules agree with Syzygy?
        const anyDiverge = ALL_RULES.some(r => {
          const p = preds[r.id];
          return p !== null && p !== syzPred;
        });
        category = anyDiverge ? 'rules-split' : 'all-agree';
      }
    } else {
      // No Syzygy — compare rules to Bähr
      const anyDiverge = ALL_RULES.some(r => {
        const p = preds[r.id];
        return r.id !== 'bahr' && p !== null && p !== bahrPred;
      });
      category = anyDiverge ? 'rules-split' : 'all-agree';
    }

    result.push({ ...pos, fen, bahrPred, syzPred, preds, category });
  });
  return result;
}

// ── Rendering ──────────────────────────────────────────────────────────────────

const SECTIONS = [
  {
    key:   'bahr-false-win',
    title: 'Bähr says WIN — Syzygy says DRAW',
    desc:  'Positions where Bähr\'s rule incorrectly predicts a White win.',
    color: COLOR_BAHR_WRONG,
    open:  true,
  },
  {
    key:   'bahr-false-draw',
    title: 'Bähr says DRAW — Syzygy says WIN',
    desc:  'Positions where Bähr\'s rule incorrectly predicts a draw.',
    color: COLOR_BAHR_WRONG,
    open:  true,
  },
  {
    key:   'rules-split',
    title: 'Rules disagree',
    desc:  'Bähr is correct, but at least one other rule gives a different verdict.',
    color: COLOR_RULES_SPLIT,
    open:  true,
  },
  {
    key:   'all-agree',
    title: 'All rules agree',
    desc:  'All four rules and Syzygy give the same verdict.',
    color: COLOR_ALL_AGREE,
    open:  false,
  },
];

function renderAll(positions) {
  const area = document.getElementById('grid-area');
  area.innerHTML = '';

  const byCategory = {};
  for (const s of SECTIONS) byCategory[s.key] = [];
  for (const pos of positions) {
    (byCategory[pos.category] ??= []).push(pos);
  }

  for (const section of SECTIONS) {
    const items = byCategory[section.key] ?? [];
    if (items.length === 0) continue;

    const details = document.createElement('details');
    details.className = 'pos-section';
    if (section.open) details.open = true;
    details.style.setProperty('--section-color', section.color);

    const summary = document.createElement('summary');
    summary.className = 'pos-section-summary';
    summary.innerHTML = `
      <span class="pos-section-dot" style="background:${section.color}"></span>
      <span class="pos-section-title">${section.title}</span>
      <span class="pos-section-count">${items.length}</span>
    `;
    details.appendChild(summary);

    if (section.desc) {
      const desc = document.createElement('p');
      desc.className = 'pos-section-desc';
      desc.textContent = section.desc;
      details.appendChild(desc);
    }

    const grid = document.createElement('div');
    grid.className = 'pos-mini-grid';
    details.appendChild(grid);

    for (const pos of items) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pos-mini-wrapper';
      wrapper.style.setProperty('--border-color', section.color);

      const canvas = document.createElement('canvas');
      canvas.width  = MINI_SZ;
      canvas.height = MINI_SZ;
      canvas.className = 'pos-mini-canvas';
      drawBoard(canvas, pos, MINI_SZ);
      wrapper.appendChild(canvas);

      // Verdict badge below
      const badge = document.createElement('div');
      badge.className = 'pos-mini-badge';
      if (pos.syzPred && pos.syzPred !== 'unknown') {
        const syzLabel = pos.syzPred === 'win' ? 'W wins' : pos.syzPred === 'draw' ? 'Draw' : 'B wins';
        badge.textContent = syzLabel;
        badge.classList.add(pos.syzPred === 'win' ? 'badge-win' : pos.syzPred === 'draw' ? 'badge-draw' : 'badge-loss');
      } else {
        badge.textContent = pos.bahrPred === 'win' ? 'W wins' : 'Draw';
        badge.classList.add(pos.bahrPred === 'win' ? 'badge-win' : 'badge-draw');
      }
      wrapper.appendChild(badge);

      wrapper.addEventListener('click', () => selectPosition(pos, canvas, wrapper));
      grid.appendChild(wrapper);
    }

    area.appendChild(details);
  }
}

// ── Board drawing ──────────────────────────────────────────────────────────────

/**
 * Draw a KPPvKP position onto a canvas.
 * @param {HTMLCanvasElement} canvas
 * @param {object} pos  — full position object
 * @param {number} size — canvas size in px
 */
function drawBoard(canvas, pos, size) {
  const sq  = size / 8;
  const ctx = canvas.getContext('2d');

  // Squares
  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      const x = file * sq;
      const y = (7 - rank) * sq;
      ctx.fillStyle = (file + rank) % 2 === 0 ? DARK_SQ : LIGHT_SQ;
      ctx.fillRect(x, y, sq, sq);
    }
  }

  // Pieces
  const pieces = positionToPieces(pos);
  const fontSize = Math.round(sq * 0.72);
  ctx.font = `${fontSize}px serif`;
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'middle';

  for (const { file, rank, glyph, isWhite } of pieces) {
    const cx = file * sq + sq / 2;
    const cy = (7 - rank) * sq + sq / 2;

    // Shadow / outline for contrast
    ctx.fillStyle = isWhite ? '#000' : '#fff';
    ctx.fillText(glyph, cx + 1, cy + 1);
    ctx.fillStyle = isWhite ? '#fff' : '#1a1a1a';
    ctx.fillText(glyph, cx, cy);
  }
}

/**
 * Return an array of {file, rank, glyph, isWhite} for a position.
 */
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
  // Deselect previous
  if (selectedCanvas) {
    selectedCanvas.closest('.pos-mini-wrapper')?.classList.remove('pos-mini-selected');
  }
  wrapper.classList.add('pos-mini-selected');
  selectedCanvas = canvas;
  selectedPos    = pos;

  // Draw detail board
  const detailCanvas = document.getElementById('detail-canvas');
  drawBoard(detailCanvas, pos, DETAIL_SZ);

  // Score rows
  const scoresEl = document.getElementById('detail-scores');
  scoresEl.innerHTML = renderScoreRows(pos);

  // FEN
  const fenEl = document.getElementById('detail-fen');
  fenEl.textContent = pos.fen;

  // Copy button
  document.getElementById('detail-copy-btn').onclick = () => {
    navigator.clipboard?.writeText(pos.fen);
  };

  // Links
  const encoded = pos.fen.replace(/ /g, '_');
  document.getElementById('detail-lichess').href   = `https://lichess.org/analysis/${encoded}`;
  document.getElementById('detail-validator').href = `index.html?fen=${encodeURIComponent(pos.fen)}`;

  // Show
  document.getElementById('detail-placeholder').style.display = 'none';
  document.getElementById('detail-content').style.display     = '';

  // Scroll detail panel into view on mobile
  document.getElementById('detail-panel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function renderCoordRow(pos) {
  const fileLetters = ['a','b','c','d','e','f','g','h'];
  const pieces = [
    { label: 'WK', file: pos.wKf,      rank: pos.wKr   },
    { label: 'WRP', file: pos.rookFile, rank: pos.wRR   },
    { label: 'WP', file: pos.xFile,     rank: pos.xRank },
    { label: 'BK', file: pos.bKf,       rank: pos.bKr   },
    { label: 'BRP', file: pos.rookFile, rank: pos.bRR   },
  ];
  const parts = pieces.map(p => `<span class="pos-coord-chip">${p.label} ${fileLetters[p.file]}${p.rank + 1}</span>`);
  return `<div class="pos-coord-row">${parts.join('')}</div>`;
}

function renderScoreRows(pos) {
  let html = '<div class="rule-score-list">';

  for (const rule of ALL_RULES) {
    const color = RULE_COLORS[rule.id] ?? '#888';
    const applicable = rule.isApplicable(pos);
    const pred = applicable ? rule.predict(pos) : null;

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
