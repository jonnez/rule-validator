/**
 * js/app.js — Main Application
 *
 * Orchestrates:
 *   - cm-chessboard v8 board setup and drag interaction
 *   - chess.js v1 position management (free-placement mode)
 *   - Rule selection and description display
 *   - Heatmap computation and rendering (heatmap.js)
 *   - Rule-specific SVG overlay lines/shapes (overlay.js)
 *   - Syzygy API queries (syzygy.js)
 */

import {
  Chessboard,
  INPUT_EVENT_TYPE,
  COLOR,
  BORDER_TYPE,
  PIECES_FILE_TYPE,
} from 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/src/Chessboard.js';

import { Chess }
  from 'https://cdn.jsdelivr.net/npm/chess.js@1/+esm';

import { ALL_RULES, findRule }             from './rules.js';
import {
  boardToPosition, positionToFen,
  computeAggregates,
  coordToSquare,
} from './position.js';
import { HeatmapOverlay, buildLegend }     from './heatmap.js';
import { RuleOverlay }                     from './overlay.js';
import {
  initSyzygy, isSyzygyReady,
  lookupPosition, computeSyzygyAggregates,
} from './syzygy.js';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default KPPvKP position: Ke4 Pa2 Pd4 | ke6 pa3 */
const DEFAULT_FEN = '8/8/4k3/8/3PK3/p7/P7/8 w - - 0 1';

const CDN_ASSETS = 'https://cdn.jsdelivr.net/npm/cm-chessboard@8/assets/';

// ── Application state ─────────────────────────────────────────────────────────

let board         = null;
let chess         = null;
let heatmapOv     = null;
let ruleOv        = null;
let currentRuleId = 'bahr';
let aggregateData = null;   // { [ruleId]: { [pieceKey]: [{win,draw,total}×64] } }
let syzygyAgg     = null;   // loaded from data/syzygy-aggregates.json, or null
let isDragging       = false;
let dragFromSq       = null;
let dragPieceType    = null;   // 'extraPawn' | 'whiteKing' | ...
let moveApplied      = false;  // true when applyFreeMove was called; false for same-square drops
let dragGeneration   = 0;      // incremented each time a new drag starts; lets stale timeouts self-cancel
let realPickupPending = false; // set by pointerdown; cleared when drag tracking begins

// ── DOM references ────────────────────────────────────────────────────────────

let elRuleSelect, elRuleDesc, elFenInput, elFenDisplay,
    elValidityBadge,
    elStatusBar, elHeatmapToggle, elScoreDisplay;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);

async function init() {
  grabDomRefs();
  populateRuleSelector();
  setupBoard();
  setupEventListeners();

  setStatus('Computing rule statistics…');
  // Runs synchronously; ~200–400 ms for ~1.2 M positions × 4 rules
  aggregateData = computeAggregates(ALL_RULES);
  setStatus('Loading Syzygy tablebase…');

  // Load the local binary tablebase (~1.6 MB fetch, then ~200 ms to aggregate)
  const syzygyLoaded = await initSyzygy();
  if (syzygyLoaded) {
    setStatus('Computing Syzygy aggregate statistics…');
    syzygyAgg = computeSyzygyAggregates();
    setStatus('Ready. Drag a piece to see the heatmap.');
  } else {
    setStatus('Ready (Syzygy data unavailable).');
  }

  // Refresh score display now that Syzygy data is available
  updatePositionDisplay();

  // Legend
  const legendContainer = document.getElementById('legend-container');
  if (legendContainer) legendContainer.appendChild(buildLegend());
}

function grabDomRefs() {
  elRuleSelect    = document.getElementById('rule-select');
  elRuleDesc      = document.getElementById('rule-description');
  elFenInput      = document.getElementById('fen-input');
  elFenDisplay    = document.getElementById('fen-display');
  elValidityBadge = document.getElementById('validity-badge');
  elStatusBar     = document.getElementById('status-bar');
  elHeatmapToggle = document.getElementById('heatmap-toggle');
  elScoreDisplay  = document.getElementById('score-display');
}

// ── Board setup ───────────────────────────────────────────────────────────────

function setupBoard() {
  chess = new Chess();
  loadChessFen(DEFAULT_FEN);

  board = new Chessboard(document.getElementById('board'), {
    position:    DEFAULT_FEN,
    orientation: COLOR.white,
    assetsUrl:   CDN_ASSETS,
    style: {
      cssClass:        'default',
      showCoordinates: true,
      borderType:      BORDER_TYPE.none,
      pieces: {
        type: PIECES_FILE_TYPE.svgSprite,
        file: 'pieces/standard.svg',
      },
      animationDuration: 0,
    },
  });

  // Enable drag for any piece (no color restriction)
  board.enableMoveInput(handleInput);

  // Fallback: cm-chessboard fires no cleanup event when a piece is dropped
  // on its own source square. Detect pointerup while still in drag state and
  // defer one tick — if cm-chessboard hasn't fired a cleanup event by then,
  // do it ourselves.
  document.addEventListener('pointerup', () => {
    if (!isDragging) return;
    const capturedGen = dragGeneration;
    setTimeout(() => {
      if (isDragging && dragGeneration === capturedGen) {
        // cm-chessboard silently swallowed the drop (same-square edge case).
        // No new drag has started since our pointerup — safe to clear.
        isDragging    = false;
        dragFromSq    = null;
        dragPieceType = null;
        heatmapOv?.clearAll();
      }
    }, 0);
  });

  document.addEventListener('pointerdown', () => {
    realPickupPending = true;
  });

  // Attach SVG overlays once the board's SVG is ready
  requestAnimationFrame(() => {
    const svgEl = getSvgElement();
    if (!svgEl) { console.warn('Could not find board SVG element.'); return; }

    try { heatmapOv = new HeatmapOverlay(svgEl, 'w'); }
    catch (e) { console.warn('HeatmapOverlay init failed:', e); }

    try { ruleOv = new RuleOverlay(svgEl, 'w'); }
    catch (e) { console.warn('RuleOverlay init failed:', e); }

    onRuleChanged();
    updatePositionDisplay();
  });
}

/** Retrieve the board's SVG DOM element. */
function getSvgElement() {
  // cm-chessboard v8: board.view.svg is the SVG element
  try {
    if (board?.view?.svg instanceof SVGElement) return board.view.svg;
  } catch { /* ignore */ }
  // DOM fallback
  return document.querySelector('#board svg');
}

// ── Move input handler ────────────────────────────────────────────────────────

function handleInput(event) {
  switch (event.type) {

    case INPUT_EVENT_TYPE.moveInputStarted: {
      realPickupPending = false;  // normal drag start — clear pending flag
      dragGeneration++;
      isDragging    = true;
      dragFromSq    = event.squareFrom;
      dragPieceType = detectPieceType(event.squareFrom);

      if (dragPieceType && elHeatmapToggle?.checked !== false) {
        renderHeatmapForPiece(dragPieceType);
      }
      return true;   // allow dragging any piece
    }

    case INPUT_EVENT_TYPE.movingOverSquare: {
      if (!isDragging && realPickupPending && event.squareFrom) {
        // cm-chessboard skipped moveInputStarted — fake-start on first move event
        realPickupPending = false;
        dragGeneration++;
        isDragging    = true;
        dragFromSq    = event.squareFrom;
        dragPieceType = detectPieceType(event.squareFrom);
        if (dragPieceType && elHeatmapToggle?.checked !== false) {
          renderHeatmapForPiece(dragPieceType);
        }
      }
      if (isDragging && dragPieceType) {
        if (event.squareTo && event.squareTo !== dragFromSq) {
          highlightTargetSquare(event.squareTo);
        } else {
          heatmapOv?.clearTints();
        }
      }
      return;
    }

    case INPUT_EVENT_TYPE.validateMoveInput: {
      // Drop on source square — treat as cancel so cm-chessboard doesn't
      // call board.setPosition() (which can trigger a spurious moveInputStarted)
      if (event.squareFrom === event.squareTo) {
        moveApplied   = false;
        isDragging    = false;
        dragFromSq    = null;
        dragPieceType = null;
        heatmapOv?.clearAll();
        return false;
      }
      // Apply the move to chess.js (free placement — no legality check)
      applyFreeMove(event.squareFrom, event.squareTo);
      moveApplied   = true;
      // Clear bars and tints immediately on drop — don't wait for moveInputFinished
      isDragging    = false;
      dragFromSq    = null;
      dragPieceType = null;
      heatmapOv?.clearAll();
      return true;
    }

    case INPUT_EVENT_TYPE.moveInputFinished: {
      if (!event.squareFrom && !event.squareTo) {
        updatePositionDisplay();
        renderRuleOverlay();
        break;
      }
      isDragging    = false;
      dragFromSq    = null;
      dragPieceType = null;
      if (moveApplied) {
        board.setPosition(chess.fen(), false);
        moveApplied = false;
      }
      heatmapOv?.clearAll();
      updatePositionDisplay();
      renderRuleOverlay();
      break;
    }

    case INPUT_EVENT_TYPE.moveInputCanceled: {
      realPickupPending = false;
      isDragging    = false;
      dragFromSq    = null;
      dragPieceType = null;
      heatmapOv?.clearAll();
      break;
    }
  }
}

// ── Piece identification ──────────────────────────────────────────────────────

function detectPieceType(algSq) {
  const pos = boardToPosition(chess);
  if (!pos) return null;

  const file = algSq.charCodeAt(0) - 97;
  const rank = parseInt(algSq[1]) - 1;

  if (file === pos.xFile   && rank === pos.xRank) return 'extraPawn';
  if (file === pos.wKf     && rank === pos.wKr)   return 'whiteKing';
  if (file === pos.bKf     && rank === pos.bKr)   return 'blackKing';
  if (file === pos.rookFile && rank === pos.wRR)  return 'whiteRookPawn';
  if (file === pos.rookFile && rank === pos.bRR)  return 'blackRookPawn';
  return null;
}

// ── Heatmap rendering ─────────────────────────────────────────────────────────

function renderHeatmapForPiece(pieceKey) {
  if (!heatmapOv || !aggregateData) return;
  const ruleData = aggregateData[currentRuleId]?.[pieceKey];
  const syzData  = syzygyAgg?.[pieceKey] ?? null;
  heatmapOv.renderBars(pieceKey, ruleData, syzData);
}

function highlightTargetSquare(algSq) {
  if (!algSq || !heatmapOv) return;
  const pos = boardToPosition(chess);
  if (!pos || !dragPieceType) return;

  const rule = findRule(currentRuleId);
  const file = algSq.charCodeAt(0) - 97;
  const rank = parseInt(algSq[1]) - 1;

  const tempPos = buildTempPosition(pos, dragPieceType, file, rank);
  if (!tempPos) return;

  const outcome = rule.predict(tempPos);
  heatmapOv.renderTints(new Map([[algSq, outcome]]));
}

/** Clone pos with the specified piece moved to (file, rank). */
function buildTempPosition(pos, pieceKey, file, rank) {
  const p = { ...pos };
  switch (pieceKey) {
    case 'extraPawn':      p.xFile    = file; p.xRank = rank; break;
    case 'whiteKing':      p.wKf      = file; p.wKr   = rank; break;
    case 'blackKing':      p.bKf      = file; p.bKr   = rank; break;
    case 'whiteRookPawn':  p.rookFile = file; p.wRR   = rank; p.bRR = rank + 1; break;
    case 'blackRookPawn':  p.bRR      = rank; p.wRR   = rank - 1; break;
    default: return null;
  }
  return p;
}

// ── Free-placement move application ──────────────────────────────────────────

/**
 * Move a piece from `from` to `to` in chess.js without legality checking.
 * Handles captures by removing any existing piece on the target square.
 */
function applyFreeMove(from, to) {
  try {
    const piece = chess.get(from);
    if (!piece) return;
    chess.remove(from);
    chess.remove(to);   // capture (if any)
    chess.put({ type: piece.type, color: piece.color }, to);
  } catch (e) {
    console.warn('applyFreeMove error:', e);
  }
}

// ── Rule change ───────────────────────────────────────────────────────────────

function onRuleChanged() {
  currentRuleId = elRuleSelect?.value ?? 'bahr';
  const rule = findRule(currentRuleId);

  if (elRuleDesc) elRuleDesc.innerHTML = rule.description;

  renderRuleOverlay();
  updatePositionDisplay();

  if (isDragging && dragPieceType) renderHeatmapForPiece(dragPieceType);
}

function renderRuleOverlay() {
  if (!ruleOv) return;
  const pos  = boardToPosition(chess);
  const rule = findRule(currentRuleId);
  ruleOv.render(rule, pos);
}

// ── Position display ──────────────────────────────────────────────────────────

function updatePositionDisplay() {
  const fen = chess.fen();

  if (elFenDisplay) elFenDisplay.textContent = fen;
  if (elFenInput)   elFenInput.value = fen;

  const pos = boardToPosition(chess);

  if (elValidityBadge) {
    if (pos) {
      elValidityBadge.textContent = '✓ Valid KPPvKP';
      elValidityBadge.className   = 'badge badge-valid';
    } else {
      elValidityBadge.textContent = '⚠ Not a KPPvKP position';
      elValidityBadge.className   = 'badge badge-invalid';
    }
  }

  updateScoreDisplay(pos);
}

function updateScoreDisplay(pos) {
  if (!elScoreDisplay) return;
  if (!pos) {
    elScoreDisplay.innerHTML = '<em>Set up a valid KPPvKP position to analyse.</em>';
    return;
  }

  const rule = findRule(currentRuleId);
  const pred = rule.predict(pos);
  const predLabel = pred === 'win' ? 'White wins' : 'Draw';
  const predClass = pred === 'win' ? 'win' : 'draw';

  let html = `Rule: <strong class="${predClass}">${predLabel}</strong>`;

  switch (currentRuleId) {
    case 'dvoretsky': {
      const sc = rule.getScore(pos);
      html += ` — White ${sc.whiteTotal} pts (pawn=${sc.whitePawnPts} + king=${sc.whiteKingBonus})`;
      html += ` vs Black ${sc.blackTotal} pts`;
      break;
    }
    case 'race': {
      const d = rule.getDistances(pos);
      html += ` — stq=${d.stq}, bDistQ=${d.bDistToQ}`;
      html += `; wDist=${d.wDistToPawn}, bDist=${d.bDistToPawn}`;
      break;
    }
    case 'muller': {
      const inter = rule.getIntersection(pos);
      const d1 = Math.max(Math.abs(pos.bKf - pos.xFile), Math.abs(pos.bKr - pos.xRank));
      const d2 = Math.max(Math.abs(pos.rookFile - inter.file), Math.abs(pos.bRR - inter.rank));
      html += ` — d1=${d1}, d2=${d2}, intersection=${coordToSquare(inter.file, inter.rank)}`;
      break;
    }
  }

  // Syzygy ground truth
  if (isSyzygyReady()) {
    const syz = lookupPosition(pos);
    if (syz !== 'unknown') {
      const syzLabel = { win: 'White wins', draw: 'Draw', loss: 'Black wins' }[syz];
      const syzClass = { win: 'win',        draw: 'draw', loss: 'loss'       }[syz];
      html += `<br>Syzygy: <strong class="${syzClass}">${syzLabel}</strong>`;
      if (pred !== syz) {
        html += ` <span class="loss" style="font-size:0.8em">✗ rule disagrees</span>`;
      } else {
        html += ` <span class="win" style="font-size:0.8em">✓ rule agrees</span>`;
      }
    }
  }

  elScoreDisplay.innerHTML = html;
}

// ── FEN load ──────────────────────────────────────────────────────────────────

function loadFen(fenStr) {
  const fen = fenStr.trim();
  if (!fen) return;
  try {
    loadChessFen(fen);
    board.setPosition(fen, false);
    updatePositionDisplay();
    renderRuleOverlay();
    heatmapOv?.clearAll();
    setStatus('Position loaded.');
  } catch (e) {
    setStatus(`Invalid FEN: ${e.message}`);
  }
}

/** Load a FEN into chess.js; handle v1 API (load may throw). */
function loadChessFen(fen) {
  try {
    chess.load(fen);
  } catch {
    // chess.js v1: try skipValidation for unusual positions
    chess.load(fen, { skipValidation: true });
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────

function setupEventListeners() {
  elRuleSelect?.addEventListener('change', onRuleChanged);

  document.getElementById('fen-load-btn')?.addEventListener('click', () => {
    loadFen(elFenInput?.value ?? '');
  });

  elFenInput?.addEventListener('keydown', e => {
    if (e.key === 'Enter') loadFen(elFenInput.value);
  });

  document.getElementById('reset-btn')?.addEventListener('click', () => {
    loadFen(DEFAULT_FEN);
  });

  document.getElementById('fen-copy-btn')?.addEventListener('click', () => {
    navigator.clipboard?.writeText(chess.fen());
    setStatus('FEN copied.');
  });
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function populateRuleSelector() {
  if (!elRuleSelect) return;
  elRuleSelect.innerHTML = '';
  for (const rule of ALL_RULES) {
    const opt = document.createElement('option');
    opt.value       = rule.id;
    opt.textContent = rule.name;
    elRuleSelect.appendChild(opt);
  }
}

function setStatus(msg) {
  if (elStatusBar) elStatusBar.textContent = msg;
}
