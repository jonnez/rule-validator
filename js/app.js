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
  hasMaterial,
} from './position.js';
import { HeatmapOverlay, buildLegend }     from './heatmap.js';
import { RuleOverlay }                     from './overlay.js';
import {
  initSyzygy, isSyzygyReady,
  lookupPosition, lookupPartialPosition,
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
let aggregateData = null;   // rule fallback when ≥3 KPPvKP pieces are missing
let isDragging       = false;
let dragFromSq       = null;
let dragPieceType    = null;   // 'extraPawn' | 'whiteKing' | ...
let moveApplied      = false;  // true when applyFreeMove was called; false for same-square drops
let dragGeneration   = 0;      // incremented each time a new drag starts; lets stale timeouts self-cancel
let realPickupPending = false; // set by pointerdown; cleared when drag tracking begins
let lastPointerX      = 0;    // updated by pointermove — used for off-board drop detection
let lastPointerY      = 0;

// ── Palette state ──────────────────────────────────────────────────────────────
const PIECE_LIMITS   = { wk: 1, wp: 2, bk: 1, bp: 1 };
let paletteDragColor = null;
let paletteDragType  = null;
let paletteGhost     = null;

// ── DOM references ────────────────────────────────────────────────────────────

let elRuleSelect, elRuleDesc, elFenInput, elFenDisplay,
    elValidityBadge, elLichessLink,
    elStatusBar, elHeatmapToggle, elScoreDisplay;

// ── Bootstrap ─────────────────────────────────────────────────────────────────

window.addEventListener('DOMContentLoaded', init);

async function init() {
  grabDomRefs();
  populateRuleSelector();
  setupBoard();
  setupPalette();
  injectSvgSprite();   // async; doesn't block init
  setupEventListeners();

  // Pre-compute rule aggregates (~200–400 ms) — used as fallback when the board
  // has ≥3 KPPvKP pieces missing (nearly empty board during free placement).
  aggregateData = computeAggregates(ALL_RULES);

  setStatus('Loading Syzygy tablebase…');
  const syzygyLoaded = await initSyzygy();

  if (syzygyLoaded) {
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
  elLichessLink   = document.getElementById('lichess-link');
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
  document.addEventListener('pointerup', (e) => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
    if (!isDragging) return;
    const capturedGen    = dragGeneration;
    const capturedFromSq = dragFromSq;
    setTimeout(() => {
      if (dragGeneration !== capturedGen) return;
      if (!isDragging) return;
      // cm-chessboard swallowed the event without firing any cleanup.
      isDragging    = false;
      dragFromSq    = null;
      dragPieceType = null;
      heatmapOv?.clearAll();
      if (!isPointerOverBoard() && capturedFromSq) {
        chess.remove(capturedFromSq);
        board.setPosition(chess.fen(), false);
        updatePositionDisplay();
        renderRuleOverlay();
      }
    }, 0);
  });

  document.addEventListener('pointerdown', () => {
    realPickupPending = true;
  });

  document.addEventListener('pointermove', (e) => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }, { passive: true });

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
      // Drop on source square — treat as cancel.
      if (event.squareFrom === event.squareTo) {
        moveApplied   = false;
        isDragging    = false;
        dragFromSq    = null;
        dragPieceType = null;
        heatmapOv?.clearAll();
        return false;
      }

      // Drop outside the board (squareTo is null) — remove the piece.
      if (!event.squareTo) {
        chess.remove(event.squareFrom);
        isDragging    = false;
        dragFromSq    = null;
        dragPieceType = null;
        heatmapOv?.clearAll();
        // cm-chessboard will revert visually; sync it to the updated position.
        requestAnimationFrame(() => {
          board.setPosition(chess.fen(), false);
          updatePositionDisplay();
          renderRuleOverlay();
        });
        return false;
      }

      // Normal move — free placement, no legality check.
      applyFreeMove(event.squareFrom, event.squareTo);
      moveApplied   = true;
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
      const fromSq  = dragFromSq;   // capture before clearing
      isDragging    = false;
      dragFromSq    = null;
      dragPieceType = null;
      heatmapOv?.clearAll();
      // If the drag ended outside the board bounds, remove the piece.
      if (fromSq && !isPointerOverBoard()) {
        chess.remove(fromSq);
        requestAnimationFrame(() => {
          board.setPosition(chess.fen(), false);
          updatePositionDisplay();
          renderRuleOverlay();
        });
      }
      break;
    }
  }
}

// ── Piece identification ──────────────────────────────────────────────────────

/**
 * Scan the chess.js board and return a partial KPPvKP position object.
 * Falls through to the full boardToPosition() first; on failure, populates
 * only the fields that can be identified from what's on the board.
 *
 * Missing pieces have undefined fields (not null) so that `?? null` guards
 * in callers work correctly.
 */
function boardToPartialPosition(chess) {
  // Full KPPvKP — all five pieces present and valid.
  const full = boardToPosition(chess);
  if (full) return full;

  const squares = chess.board();
  let wKing = null, bKing = null;
  const wPawns = [], bPawns = [];

  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = squares[r][f];
      if (!sq) continue;
      const rank = 7 - r;
      if      (sq.color === 'w' && sq.type === 'k') wKing = { f, rank };
      else if (sq.color === 'b' && sq.type === 'k') bKing = { f, rank };
      else if (sq.color === 'w' && sq.type === 'p') wPawns.push({ f, rank });
      else if (sq.color === 'b' && sq.type === 'p') bPawns.push({ f, rank });
    }
  }

  const p = {};
  if (wKing) { p.wKf = wKing.f; p.wKr = wKing.rank; }
  if (bKing) { p.bKf = bKing.f; p.bKr = bKing.rank; }

  // Rook pawn pair: white pawn on a/h file with black pawn directly above.
  for (const wp of wPawns) {
    if (wp.f !== 0 && wp.f !== 7) continue;
    const bp = bPawns.find(b => b.f === wp.f && b.rank === wp.rank + 1);
    if (bp) {
      p.rookFile = wp.f; p.wRR = wp.rank; p.bRR = bp.rank;
      break;
    }
  }

  // Extra pawn: any white pawn that isn't the identified rook pawn.
  for (const wp of wPawns) {
    if (p.rookFile != null && wp.f === p.rookFile && wp.rank === p.wRR) continue;
    p.xFile = wp.f; p.xRank = wp.rank;
    break;
  }

  return p;
}

function detectPieceType(algSq) {
  const file = algSq.charCodeAt(0) - 97;
  const rank = parseInt(algSq[1]) - 1;

  // Try full position first (fast path, most common case).
  const pos = boardToPosition(chess);
  if (pos) {
    if (file === pos.xFile    && rank === pos.xRank) return 'extraPawn';
    if (file === pos.wKf      && rank === pos.wKr)   return 'whiteKing';
    if (file === pos.bKf      && rank === pos.bKr)   return 'blackKing';
    if (file === pos.rookFile && rank === pos.wRR)   return 'whiteRookPawn';
    if (file === pos.rookFile && rank === pos.bRR)   return 'blackRookPawn';
    return null;
  }

  // Partial board — identify by chess piece type and position heuristics.
  const piece = chess.get(algSq);
  if (!piece) return null;
  if (piece.color === 'w' && piece.type === 'k') return 'whiteKing';
  if (piece.color === 'b' && piece.type === 'k') return 'blackKing';
  if (piece.color === 'b' && piece.type === 'p') return 'blackRookPawn';
  if (piece.color === 'w' && piece.type === 'p') {
    // White pawn on a/h file with a black pawn directly above → rook pawn.
    if (file === 0 || file === 7) {
      const aboveSq = String.fromCharCode(97 + file) + (rank + 2);
      const above = chess.get(aboveSq);
      if (above && above.type === 'p' && above.color === 'b') return 'whiteRookPawn';
    }
    return 'extraPawn';
  }
  return null;
}

// ── Heatmap rendering ─────────────────────────────────────────────────────────

/**
 * Compute the rule win/draw stats for a (partially) specified KPPvKP position.
 *
 * tempPos has all *fixed* pieces set.  Any "missing" KPPvKP slot (rookPair or
 * xP) is iterated over all valid placements and the rule results are tallied.
 *
 * Returns null when there are ≥3 missing slots (caller falls back to the
 * pre-computed aggregate).  Also returns null when either king is absent
 * (rules require both kings).
 */
function computeRuleStatsForPartialPos(tempPos, rule) {
  if (tempPos.wKf == null || tempPos.bKf == null) return null;

  const hasRookPair  = tempPos.rookFile != null && tempPos.wRR != null;
  const hasExtraPawn = tempPos.xFile    != null && tempPos.xRank != null;
  const missingSlots = (hasRookPair ? 0 : 1) + (hasExtraPawn ? 0 : 1);
  if (missingSlots > 2) return null;   // too expensive; caller uses aggregate

  const stats = { win: 0, draw: 0, loss: 0, total: 0 };
  const { wKf, wKr, bKf, bKr } = tempPos;

  const rookFiles = hasRookPair  ? [tempPos.rookFile] : [0, 7];
  const wRRs      = hasRookPair  ? [tempPos.wRR]      : [1, 2, 3, 4, 5];
  const xFiles    = hasExtraPawn ? [tempPos.xFile]     : [0, 1, 2, 3, 4, 5, 6, 7];
  const xRanks    = hasExtraPawn ? [tempPos.xRank]     : [1, 2, 3, 4, 5, 6];

  for (const rookFile of rookFiles) {
    for (const wRR of wRRs) {
      const bRR = wRR + 1;
      for (const xFile of xFiles) {
        if (xFile === rookFile) continue;
        for (const xRank of xRanks) {
          // Mirrors the validity checks in iteratePositions().
          if (wKf === rookFile && wKr === wRR)   continue;
          if (wKf === rookFile && wKr === bRR)   continue;
          if (wKf === xFile   && wKr === xRank)  continue;
          if (bKf === wKf     && bKr === wKr)    continue;
          if (bKf === rookFile && bKr === wRR)   continue;
          if (bKf === rookFile && bKr === bRR)   continue;
          if (bKf === xFile   && bKr === xRank)  continue;
          if (Math.abs(wKf - bKf) <= 1 && Math.abs(wKr - bKr) <= 1) continue;
          if (Math.abs(bKf - rookFile) === 1 && bKr === wRR + 1)     continue;
          if (Math.abs(bKf - xFile)    === 1 && bKr === xRank + 1)   continue;

          try {
            const p = { rookFile, wRR, bRR, xFile, xRank, wKf, wKr, bKf, bKr };
            if (!rule.isApplicable(p)) continue;
            const outcome = rule.predict(p);
            stats.total++;
            if      (outcome === 'win')  stats.win++;
            else if (outcome === 'draw') stats.draw++;
            else                         stats.loss++;
          } catch { /* skip structurally invalid combinations */ }
        }
      }
    }
  }

  // Return the stats even when total===0 (rule not applicable for any combination
  // at this square).  Returning null here would wrongly trigger the aggregate
  // fallback; returning {total:0} lets renderBars skip the bar silently.
  return stats;
}

/**
 * Render heatmap bars for the piece currently being dragged.
 *
 * For each of the 64 squares the piece could land on, computes:
 *   - Rule bar:   iterate over any missing KPPvKP pieces and aggregate
 *                 rule.predict(); falls back to pre-computed aggregate when
 *                 ≥3 pieces are missing (nearly empty board).
 *   - Syzygy bar: O(1) lookup via lookupPartialPosition(); routes to the
 *                 appropriate sub-endgame bin automatically.
 */
function renderHeatmapForPiece(pieceKey) {
  if (!heatmapOv) return;

  const partialPos = boardToPartialPosition(chess);
  const rule       = findRule(currentRuleId);

  // Extra pawn cannot land on the rook file — suppress those columns.
  let skipFiles = null;
  if (pieceKey === 'extraPawn' && partialPos.rookFile != null) {
    skipFiles = new Set([partialPos.rookFile]);
  }

  const ruleStats = {};
  const syzStats  = {};

  for (let rank = 0; rank < 8; rank++) {
    for (let file = 0; file < 8; file++) {
      if (skipFiles?.has(file)) continue;

      const tempPos = buildTempPosition(partialPos, pieceKey, file, rank);
      if (!tempPos) continue;

      // ── Syzygy bar: single O(1) partial lookup ───────────────────────────
      if (isSyzygyReady()) {
        const syz = lookupPartialPosition(tempPos);
        if (syz !== 'unknown') {
          syzStats[rank * 8 + file] = {
            win:   syz === 'win'  ? 1 : 0,
            draw:  syz === 'draw' ? 1 : 0,
            loss:  syz === 'loss' ? 1 : 0,
            total: 1,
          };
        }
      }

      // ── Rule bar: iterate missing pieces, or fall back to aggregate ───────
      const computed = computeRuleStatsForPartialPos(tempPos, rule);
      if (computed !== null) {
        ruleStats[rank * 8 + file] = computed;
      } else {
        // ≥3 missing pieces — use pre-computed aggregate as approximation.
        const agg = aggregateData?.[currentRuleId]?.[pieceKey];
        if (agg) ruleStats[rank * 8 + file] = agg[rank * 8 + file];
      }
    }
  }

  heatmapOv.renderBars(pieceKey, ruleStats, isSyzygyReady() ? syzStats : null, skipFiles);
}

function highlightTargetSquare(algSq) {
  if (!algSq || !heatmapOv || !dragPieceType) return;

  const file = algSq.charCodeAt(0) - 97;
  const rank = parseInt(algSq[1]) - 1;

  const partialPos = boardToPartialPosition(chess);

  // Extra pawn cannot land on the rook file.
  if (dragPieceType === 'extraPawn' && partialPos.rookFile != null && file === partialPos.rookFile) {
    heatmapOv.clearTints();
    return;
  }

  const tempPos = buildTempPosition(partialPos, dragPieceType, file, rank);
  if (!tempPos) return;

  // Determine if this is a full KPPvKP position — if so use rule.predict()
  // directly; otherwise fall back to syzygy for the tint colour.
  const isFullKPPvKP = tempPos.rookFile != null && tempPos.xFile != null
                    && tempPos.wKf      != null && tempPos.bKf  != null;

  let outcome;
  if (isFullKPPvKP) {
    try { outcome = findRule(currentRuleId).predict(tempPos); }
    catch { outcome = 'unknown'; }
  } else {
    outcome = lookupPartialPosition(tempPos);
  }

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

  if (elFenDisplay)  elFenDisplay.textContent = fen;
  if (elFenInput)    elFenInput.value = fen;
  if (elLichessLink) elLichessLink.href = `https://lichess.org/analysis/${fen.replace(/ /g, '_')}`;

  const pos = boardToPosition(chess);
  // Syzygy returns 'unknown' (value 255) for illegal positions (e.g. adjacent kings).
  // Treat those the same as structurally invalid.
  const syzygyInvalid = pos && isSyzygyReady() && lookupPosition(pos) === 'unknown';
  const effectivePos  = syzygyInvalid ? null : pos;

  // Distinguish "wrong material" from "right material but outside rule structure"
  const outsideScope  = !effectivePos && !pos && hasMaterial(chess);

  if (elValidityBadge) {
    if (!effectivePos) {
      if (outsideScope) {
        elValidityBadge.textContent = '⚠ Outside rule scope';
        elValidityBadge.className   = 'badge badge-invalid';
      } else {
        elValidityBadge.textContent = '⚠ Not a KPPvkp position';
        elValidityBadge.className   = 'badge badge-invalid';
      }
    } else if (findRule(currentRuleId).isApplicable(effectivePos)) {
      elValidityBadge.textContent = '✓ Valid KPPvkp';
      elValidityBadge.className   = 'badge badge-valid';
    } else {
      elValidityBadge.textContent = '✓ Valid KPPvkp — rule not applicable';
      elValidityBadge.className   = 'badge badge-valid';
    }
  }

  updateScoreDisplay(effectivePos, outsideScope);
  updatePalette();
}

function updateScoreDisplay(pos, outsideScope = false) {
  if (!elScoreDisplay) return;
  if (!pos) {
    if (outsideScope) {
      elScoreDisplay.innerHTML = '<em>Position has KPPvKP material but is outside the scope of these rules (e.g. both white pawns on the same file). The local Syzygy data does not cover this case — use the Lichess link to look it up.</em>';
    } else {
      elScoreDisplay.innerHTML = '<em>Set up a valid KPPvkp position to analyse.</em>';
    }
    return;
  }

  const rule       = findRule(currentRuleId);
  const applicable = rule.isApplicable(pos);

  let html = '';

  if (applicable) {
    const pred      = rule.predict(pos);
    const predLabel = pred === 'win' ? 'White wins' : 'Draw';
    const predClass = pred === 'win' ? 'win' : 'draw';

    html = `Rule: <strong class="${predClass}">${predLabel}</strong>`;

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

    // Syzygy ground truth (with agree/disagree only when rule is applicable)
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
  } else {
    html = `<em>Rule not applicable to this position.</em>`;

    // Still show Syzygy when available
    if (isSyzygyReady()) {
      const syz = lookupPosition(pos);
      if (syz !== 'unknown') {
        const syzLabel = { win: 'White wins', draw: 'Draw', loss: 'Black wins' }[syz];
        const syzClass = { win: 'win',        draw: 'draw', loss: 'loss'       }[syz];
        html += `<br>Syzygy: <strong class="${syzClass}">${syzLabel}</strong>`;
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

// ── Off-board detection ────────────────────────────────────────────────────────

function isPointerOverBoard() {
  const rect = document.getElementById('board')?.getBoundingClientRect();
  if (!rect) return false;
  return lastPointerX >= rect.left && lastPointerX <= rect.right
      && lastPointerY >= rect.top  && lastPointerY <= rect.bottom;
}

/** Convert client coordinates to an algebraic square (e.g. 'e4'), or null if off-board. */
function clientCoordsToSquare(clientX, clientY) {
  const boardEl = document.getElementById('board');
  if (!boardEl) return null;
  const rect = boardEl.getBoundingClientRect();
  const relX  = clientX - rect.left;
  const relY  = clientY - rect.top;
  if (relX < 0 || relX >= rect.width || relY < 0 || relY >= rect.height) return null;
  const fileIdx = Math.floor(relX / rect.width  * 8);  // 0 = a-file
  const rankIdx = Math.floor(relY / rect.height * 8);  // 0 = rank 8
  return String.fromCharCode(97 + fileIdx) + (8 - rankIdx);
}

// ── Piece palette ──────────────────────────────────────────────────────────────

/** Fetch and inline the cm-chessboard SVG sprite so #wK, #bP, etc. resolve. */
async function injectSvgSprite() {
  if (document.getElementById('svg-sprite-container')) return;
  try {
    const res  = await fetch(CDN_ASSETS + 'pieces/standard.svg');
    const text = await res.text();
    const div  = document.createElement('div');
    div.id    = 'svg-sprite-container';
    // Must NOT use display:none — that prevents <use> from resolving the symbols.
    // Position off-screen instead.
    div.setAttribute('aria-hidden', 'true');
    div.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    div.innerHTML = text;
    document.body.prepend(div);
  } catch (e) {
    console.warn('Could not load piece sprite for palette:', e);
  }
}

function getPieceCounts() {
  const grid   = chess.board();
  const counts = { wk: 0, wp: 0, bk: 0, bp: 0 };
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const sq = grid[r][f];
      if (!sq) continue;
      const key = sq.color + sq.type;
      if (key in counts) counts[key]++;
    }
  }
  return counts;
}

function updatePalette() {
  const counts = getPieceCounts();
  for (const el of document.querySelectorAll('.palette-piece')) {
    const key   = el.dataset.color + el.dataset.type;
    const limit = PIECE_LIMITS[key] ?? 0;
    const count = counts[key] ?? 0;
    const countEl = el.querySelector('.palette-count');
    if (countEl) countEl.textContent = `${count} / ${limit}`;
    el.classList.toggle('palette-piece-disabled', count >= limit);
  }
}

function setupPalette() {
  for (const el of document.querySelectorAll('.palette-piece')) {
    el.addEventListener('pointerdown', onPalettePointerDown);
  }
}

function onPalettePointerDown(e) {
  const el    = e.currentTarget;
  const color = el.dataset.color;
  const type  = el.dataset.type;
  const key   = color + type;

  const counts = getPieceCounts();
  if ((counts[key] ?? 0) >= (PIECE_LIMITS[key] ?? 0)) return;

  e.preventDefault();
  e.stopPropagation();
  el.setPointerCapture(e.pointerId);

  paletteDragColor = color;
  paletteDragType  = type;

  // Create floating ghost piece
  paletteGhost = document.createElement('div');
  paletteGhost.id = 'palette-drag-ghost';
  paletteGhost.innerHTML =
    `<svg viewBox="0 0 40 40"><use href="#${color}${type}"/></svg>`;
  document.body.appendChild(paletteGhost);
  movePaletteGhost(e.clientX, e.clientY);

  el.addEventListener('pointermove',   onPalettePointerMove);
  el.addEventListener('pointerup',     onPalettePointerUp);
  el.addEventListener('pointercancel', onPalettePointerCancel);
}

function onPalettePointerMove(e) {
  lastPointerX = e.clientX;
  lastPointerY = e.clientY;
  movePaletteGhost(e.clientX, e.clientY);
}

function onPalettePointerUp(e) {
  e.stopPropagation();
  const el = e.currentTarget;
  el.releasePointerCapture(e.pointerId);
  el.removeEventListener('pointermove',   onPalettePointerMove);
  el.removeEventListener('pointerup',     onPalettePointerUp);
  el.removeEventListener('pointercancel', onPalettePointerCancel);
  cleanupPaletteGhost();

  const sq = clientCoordsToSquare(e.clientX, e.clientY);
  if (sq && paletteDragColor && paletteDragType) {
    placePieceFromPalette(paletteDragColor, paletteDragType, sq);
  }
  paletteDragColor = null;
  paletteDragType  = null;
}

function onPalettePointerCancel(e) {
  const el = e.currentTarget;
  el.releasePointerCapture(e.pointerId);
  el.removeEventListener('pointermove',   onPalettePointerMove);
  el.removeEventListener('pointerup',     onPalettePointerUp);
  el.removeEventListener('pointercancel', onPalettePointerCancel);
  cleanupPaletteGhost();
  paletteDragColor = null;
  paletteDragType  = null;
}

function movePaletteGhost(x, y) {
  if (!paletteGhost) return;
  paletteGhost.style.left = x + 'px';
  paletteGhost.style.top  = y + 'px';
}

function cleanupPaletteGhost() {
  if (paletteGhost) { paletteGhost.remove(); paletteGhost = null; }
}

function placePieceFromPalette(color, type, sq) {
  try {
    chess.remove(sq);
    chess.put({ type, color }, sq);
    board.setPosition(chess.fen(), false);
    updatePositionDisplay();
    renderRuleOverlay();
    heatmapOv?.clearAll();
  } catch (e) {
    console.warn('placePieceFromPalette error:', e);
  }
}
