/**
 * js/heatmap.js — Heatmap SVG Overlay
 *
 * Renders per-square win/draw statistics as two stacked horizontal bars
 * injected directly into the cm-chessboard SVG element.
 *
 * Bar layout (bottom of each square):
 *   ┌─────────────────────────────────┐
 *   │       chess piece / square      │
 *   │                                 │
 *   │  ████░░░░░░░████████████████░  │ ← rule bar   (white=win, gray=draw)
 *   │  ████████░░░░░░░░░░████████░░  │ ← syzygy bar (white=win, gray=draw, black=loss)
 *   └─────────────────────────────────┘
 *
 * When a piece is being dragged, each target square is additionally
 * tinted green (win) or gray (draw) based on the rule's prediction for
 * the current position.
 */

// (no local module imports needed — heatmap rendering is pure SVG)

// ── Constants ──────────────────────────────────────────────────────────────────

const HEATMAP_GROUP_ID = 'kppvkp-heatmap';
const TINT_GROUP_ID    = 'kppvkp-tint';
const BAR_HEIGHT_FRAC  = 0.14; // each bar is 14% of square height
const BAR_GAP_FRAC     = 0.02; // 2% gap between the two bars

// ── HeatmapOverlay class ──────────────────────────────────────────────────────

export class HeatmapOverlay {
  /**
   * @param {SVGSVGElement} svgEl         The cm-chessboard <svg> element.
   * @param {'w'|'b'}       orientation   Board orientation: 'w' = white at bottom.
   */
  constructor(svgEl, orientation = 'w') {
    this._svg         = svgEl;
    this._orientation = orientation;
    this._sq          = this._detectSquareSize();

    this._heatmapGroup = this._ensureGroup(HEATMAP_GROUP_ID);
    this._tintGroup    = this._ensureGroup(TINT_GROUP_ID);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Render the aggregate heatmap bars for a given piece type.
   *
   * @param {string}      pieceKey    e.g. 'extraPawn', 'whiteKing', etc.
   * @param {object}      ruleData    aggregateData[ruleId][pieceKey] — array of 64 {win,draw,total}
   * @param {object}      syzygyData  syzygy[pieceKey] or null
   * @param {Set<number>} skipFiles   file indices (0–7) to suppress entirely, or null
   */
  renderBars(pieceKey, ruleData, syzygyData, skipFiles = null) {
    this._clear(this._heatmapGroup);

    const sq = this._sq;
    const barH    = sq * BAR_HEIGHT_FRAC;
    const barGap  = sq * BAR_GAP_FRAC;
    const bar1Y   = sq * (1 - 2 * BAR_HEIGHT_FRAC - BAR_GAP_FRAC);
    const bar2Y   = sq * (1 - BAR_HEIGHT_FRAC);

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if (skipFiles && skipFiles.has(file)) continue;
        const idx = rank * 8 + file;
        const { x, y } = this._squareOrigin(file, rank);

        const rStat = ruleData?.[idx];
        const sStat = syzygyData?.[idx];

        if (rStat && rStat.total > 0) {
          this._drawBar(this._heatmapGroup, x, y + bar1Y, sq, barH, rStat, 'rule');
        }
        if (sStat && sStat.total > 0) {
          this._drawBar(this._heatmapGroup, x, y + bar2Y, sq, barH, sStat, 'syzygy');
        }
      }
    }
  }

  /**
   * Highlight target squares with a win/draw/unknown tint during piece dragging.
   *
   * @param {Map<string,string>} squarePredictions  algebraic → 'win' | 'draw' | 'unknown'
   */
  renderTints(squarePredictions) {
    this._clear(this._tintGroup);
    const sq = this._sq;

    for (const [algSq, outcome] of squarePredictions) {
      const file = algSq.charCodeAt(0) - 97;
      const rank = parseInt(algSq[1]) - 1;
      const { x, y } = this._squareOrigin(file, rank);

      const fill    = outcome === 'win'  ? '#00cc44'
                    : outcome === 'draw' ? '#aaaaaa'
                    : '#ff4444';
      const opacity = 0.35;

      const rect = this._makeSvgEl('rect');
      rect.setAttribute('x',       x);
      rect.setAttribute('y',       y);
      rect.setAttribute('width',   sq);
      rect.setAttribute('height',  sq);
      rect.setAttribute('fill',    fill);
      rect.setAttribute('opacity', opacity);
      rect.setAttribute('pointer-events', 'none');
      this._tintGroup.appendChild(rect);
    }
  }

  /** Remove all tint highlights. */
  clearTints() {
    this._clear(this._tintGroup);
  }

  /** Remove all heatmap bars. */
  clearBars() {
    this._clear(this._heatmapGroup);
  }

  /** Remove everything. */
  clearAll() {
    this.clearBars();
    this.clearTints();
  }

  /** Re-detect square size (call after board resize). */
  refresh() {
    this._sq = this._detectSquareSize();
  }

  // ── Private helpers ───────────────────────────────────────────────────────────

  _detectSquareSize() {
    const vb = this._svg.viewBox.baseVal;
    if (vb && vb.width > 0) return vb.width / 8;
    // Fallback: use rendered pixel width
    return (this._svg.getBoundingClientRect().width || 400) / 8;
  }

  _squareOrigin(file, rank) {
    const sq = this._sq;
    if (this._orientation === 'w') {
      return { x: file * sq, y: (7 - rank) * sq };
    } else {
      return { x: (7 - file) * sq, y: rank * sq };
    }
  }

  _ensureGroup(id) {
    let g = this._svg.querySelector(`#${id}`);
    if (!g) {
      g = this._makeSvgEl('g');
      g.setAttribute('id', id);
      g.setAttribute('pointer-events', 'none');
      // Append to SVG root — renders on top with low opacity, pieces remain visible
      this._svg.appendChild(g);
    }
    return g;
  }

  _clear(group) {
    while (group.firstChild) group.removeChild(group.firstChild);
  }

  _makeSvgEl(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  /**
   * Draw a single horizontal [win | draw | loss] bar.
   *
   * @param {SVGGElement} parent
   * @param {number} x, y         top-left corner
   * @param {number} w, h         bar dimensions
   * @param {{win,draw,total,loss?}} stat
   * @param {'rule'|'syzygy'} kind
   */
  _drawBar(parent, x, y, w, h, stat, kind) {
    const { win, draw, total } = stat;
    const loss = stat.loss ?? 0;

    const winFrac  = win  / total;
    const lossFrac = loss / total;
    const drawFrac = 1 - winFrac - lossFrac;

    // Background (dark border)
    const bg = this._makeSvgEl('rect');
    bg.setAttribute('x',       x);
    bg.setAttribute('y',       y);
    bg.setAttribute('width',   w);
    bg.setAttribute('height',  h);
    bg.setAttribute('fill',    '#1a1a1a');
    bg.setAttribute('opacity', '0.85');
    parent.appendChild(bg);

    let cx = x;
    const addSeg = (frac, fill) => {
      if (frac <= 0) return;
      const segW = frac * w;
      const rect = this._makeSvgEl('rect');
      rect.setAttribute('x',       cx);
      rect.setAttribute('y',       y);
      rect.setAttribute('width',   segW);
      rect.setAttribute('height',  h);
      rect.setAttribute('fill',    fill);
      rect.setAttribute('opacity', kind === 'rule' ? '0.90' : '0.80');
      parent.appendChild(rect);
      cx += segW;
    };

    // Win = white, draw = mid-gray, loss = near-black
    addSeg(winFrac,  '#f0f0f0');
    addSeg(drawFrac, '#888888');
    addSeg(lossFrac, '#1a1a1a');

    // Thin label line on top (rule=gold, syzygy=cyan)
    const labelLine = this._makeSvgEl('rect');
    labelLine.setAttribute('x',       x);
    labelLine.setAttribute('y',       y);
    labelLine.setAttribute('width',   w);
    labelLine.setAttribute('height',  Math.max(1, h * 0.12));
    labelLine.setAttribute('fill',    kind === 'rule' ? '#f0c040' : '#40c0f0');
    labelLine.setAttribute('opacity', '0.9');
    parent.appendChild(labelLine);
  }
}

// ── Legend helper ─────────────────────────────────────────────────────────────

/**
 * Build a small HTML legend element explaining the bar colors.
 * @returns {HTMLElement}
 */
export function buildLegend() {
  const div = document.createElement('div');
  div.className = 'heatmap-legend';
  div.innerHTML = `
    <div class="legend-title">Heatmap bars (bottom of each square)</div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#f0c040"></span>
      <span>Top bar = selected rule</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#40c0f0"></span>
      <span>Bottom bar = Syzygy (if data loaded)</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#f0f0f0; border:1px solid #555"></span>
      <span>White = White wins</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#888"></span>
      <span>Gray = Draw</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#1a1a1a; border:1px solid #555"></span>
      <span>Black = Black wins (rare in KPPvKP)</span>
    </div>
    <hr>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#00cc44; opacity:0.5"></span>
      <span>Green tint = rule predicts WIN</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#aaa; opacity:0.5"></span>
      <span>Gray tint = rule predicts DRAW</span>
    </div>
  `;
  return div;
}
