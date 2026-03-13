/**
 * js/heatmap.js — Heatmap SVG Overlay
 *
 * Renders per-square win/draw statistics as stacked horizontal bars
 * injected directly into the cm-chessboard SVG element.
 *
 * Bar layout (bottom of each square), one bar per selected rule + syzygy:
 *   ┌─────────────────────────────────┐
 *   │       chess piece / square      │
 *   │  ████░░░░░░░████████████████░  │ ← rule bar 1
 *   │  ████████░░░░░░░░░░████████░░  │ ← rule bar 2
 *   │  ████████░░░░░░░░░░████████░░  │ ← syzygy bar
 *   └─────────────────────────────────┘
 *
 * Each bar has a thin colored label line on top (rule's color / cyan for syzygy).
 * When a piece is being dragged, each target square is additionally
 * tinted green (win) or gray (draw) based on the first rule's prediction.
 */

const HEATMAP_GROUP_ID = 'kppvkp-heatmap';
const TINT_GROUP_ID    = 'kppvkp-tint';
const SYZYGY_COLOR     = '#40c0f0';
const ZONE_FRAC        = 0.30;  // bottom 30% of square reserved for bars
const BAR_GAP_FRAC     = 0.015; // gap between bars as fraction of square size

export class HeatmapOverlay {
  constructor(svgEl, orientation = 'w') {
    this._svg         = svgEl;
    this._orientation = orientation;
    this._sq          = this._detectSquareSize();

    this._heatmapGroup = this._ensureGroup(HEATMAP_GROUP_ID);
    this._tintGroup    = this._ensureGroup(TINT_GROUP_ID);
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  /**
   * Render aggregate heatmap bars for a given piece type.
   *
   * @param {string}   pieceKey   e.g. 'extraPawn', 'whiteKing', etc.
   * @param {Array}    rulesData  [{color, stats}] — one entry per selected rule;
   *                              stats is an object keyed by rank*8+file → {win,draw,total,loss?}
   * @param {object}   syzygyData rank*8+file → {win,draw,loss,total}, or null
   * @param {Set}      skipFiles  file indices (0–7) to suppress, or null
   */
  renderBars(pieceKey, rulesData, syzygyData, skipFiles = null) {
    this._clear(this._heatmapGroup);

    const sq    = this._sq;
    const nBars = rulesData.length + (syzygyData ? 1 : 0);
    if (nBars === 0) return;

    const totalGapH = Math.max(0, nBars - 1) * BAR_GAP_FRAC * sq;
    const barH      = (ZONE_FRAC * sq - totalGapH) / nBars;
    const zoneTopY  = sq * (1 - ZONE_FRAC);

    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        if (skipFiles && skipFiles.has(file)) continue;
        const idx        = rank * 8 + file;
        const { x, y }  = this._squareOrigin(file, rank);

        let i = 0;
        for (const { color, stats } of rulesData) {
          const stat = stats?.[idx];
          if (stat && stat.total > 0) {
            const barY = y + zoneTopY + i * (barH + BAR_GAP_FRAC * sq);
            this._drawBar(this._heatmapGroup, x, barY, sq, barH, stat, color);
          }
          i++;
        }

        if (syzygyData) {
          const stat = syzygyData[idx];
          if (stat && stat.total > 0) {
            const barY = y + zoneTopY + i * (barH + BAR_GAP_FRAC * sq);
            this._drawBar(this._heatmapGroup, x, barY, sq, barH, stat, SYZYGY_COLOR);
          }
        }
      }
    }
  }

  /**
   * Highlight target squares with a win/draw/unknown tint during piece dragging.
   * @param {Map<string,string>} squarePredictions  algebraic → 'win' | 'draw' | 'unknown'
   */
  renderTints(squarePredictions) {
    this._clear(this._tintGroup);
    const sq = this._sq;

    for (const [algSq, outcome] of squarePredictions) {
      const file = algSq.charCodeAt(0) - 97;
      const rank = parseInt(algSq[1]) - 1;
      const { x, y } = this._squareOrigin(file, rank);

      const fill = outcome === 'win'  ? '#00cc44'
                 : outcome === 'draw' ? '#aaaaaa'
                 : '#ff4444';

      const rect = this._makeSvgEl('rect');
      rect.setAttribute('x',             x);
      rect.setAttribute('y',             y);
      rect.setAttribute('width',         sq);
      rect.setAttribute('height',        sq);
      rect.setAttribute('fill',          fill);
      rect.setAttribute('opacity',       '0.35');
      rect.setAttribute('pointer-events','none');
      this._tintGroup.appendChild(rect);
    }
  }

  clearTints() { this._clear(this._tintGroup); }
  clearBars()  { this._clear(this._heatmapGroup); }
  clearAll()   { this.clearBars(); this.clearTints(); }

  refresh() { this._sq = this._detectSquareSize(); }

  // ── Private helpers ───────────────────────────────────────────────────────────

  _detectSquareSize() {
    const vb = this._svg.viewBox.baseVal;
    if (vb && vb.width > 0) return vb.width / 8;
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
   * Draw a single [win | draw | loss] bar with a colored label line on top.
   * @param {string} color  hex color for the label line
   */
  _drawBar(parent, x, y, w, h, stat, color) {
    const { win, draw, total } = stat;
    const loss     = stat.loss ?? 0;
    const winFrac  = win  / total;
    const lossFrac = loss / total;
    const drawFrac = 1 - winFrac - lossFrac;

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
      const rect = this._makeSvgEl('rect');
      rect.setAttribute('x',       cx);
      rect.setAttribute('y',       y);
      rect.setAttribute('width',   frac * w);
      rect.setAttribute('height',  h);
      rect.setAttribute('fill',    fill);
      rect.setAttribute('opacity', '0.88');
      parent.appendChild(rect);
      cx += frac * w;
    };

    addSeg(winFrac,  '#f0f0f0');
    addSeg(drawFrac, '#888888');
    addSeg(lossFrac, '#1a1a1a');

    // Thin colored label line on top
    const line = this._makeSvgEl('rect');
    line.setAttribute('x',       x);
    line.setAttribute('y',       y);
    line.setAttribute('width',   w);
    line.setAttribute('height',  Math.max(1, h * 0.14));
    line.setAttribute('fill',    color);
    line.setAttribute('opacity', '0.9');
    parent.appendChild(line);
  }
}

// ── Legend helper ─────────────────────────────────────────────────────────────

/**
 * Build a small HTML legend element.
 * @param {Array}  rules       ALL_RULES array
 * @param {object} ruleColors  {ruleId: hexColor}
 */
export function buildLegend(rules, ruleColors) {
  const div = document.createElement('div');
  div.className = 'heatmap-legend';

  const ruleRows = rules.map(r =>
    `<div class="legend-row">
      <span class="legend-stripe" style="background:${ruleColors[r.id] ?? '#888'}"></span>
      <span>${r.name}</span>
    </div>`
  ).join('');

  div.innerHTML = `
    <div class="legend-title">Bar colors (label line)</div>
    ${ruleRows}
    <div class="legend-row">
      <span class="legend-stripe" style="background:${SYZYGY_COLOR}"></span>
      <span>Syzygy (always bottom)</span>
    </div>
    <hr>
    <div class="legend-title">Bar segments</div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#f0f0f0;border:1px solid #555"></span>
      <span>White = White wins</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#888"></span>
      <span>Gray = Draw</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#1a1a1a;border:1px solid #555"></span>
      <span>Black = Black wins</span>
    </div>
    <hr>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#00cc44;opacity:0.5"></span>
      <span>Green tint = predicts WIN</span>
    </div>
    <div class="legend-row">
      <span class="legend-stripe" style="background:#aaa;opacity:0.5"></span>
      <span>Gray tint = predicts DRAW</span>
    </div>
  `;
  return div;
}
