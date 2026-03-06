/**
 * js/overlay.js — Rule-specific SVG Overlays
 *
 * Draws rule-specific geometric shapes on top of the cm-chessboard SVG:
 *   Bähr       — gold V-shaped dividing line
 *   Müller     — intersection point + distance lines
 *   Dvoretsky  — blue model diagonal line
 *   Race       — green "square of the pawn" rectangle + distance annotations
 *
 * Usage:
 *   const ov = new RuleOverlay(svgEl, orientation);
 *   ov.render(rule, position);   // draw for a specific rule + position
 *   ov.clear();                  // remove all overlay elements
 */

import { BahrRule, MullerRule, DvoretskyRule, RaceRule } from './rules.js';

const OVERLAY_GROUP_ID = 'kppvkp-overlay';

export class RuleOverlay {
  constructor(svgEl, orientation = 'w') {
    this._svg         = svgEl;
    this._orientation = orientation;
    this._group       = this._ensureGroup();
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  render(rule, pos) {
    this.clear();
    if (!pos) return;

    switch (rule.id) {
      case 'bahr':      this._renderBahr(pos);      break;
      case 'muller':    this._renderMuller(pos);    break;
      case 'dvoretsky': this._renderDvoretsky(pos); break;
      case 'race':      this._renderRace(pos);      break;
    }
  }

  clear() {
    while (this._group.firstChild) this._group.removeChild(this._group.firstChild);
  }

  // ── Bähr's Rule overlay ────────────────────────────────────────────────────

  _renderBahr(pos) {
    const { points, apexFile, apexRank } = BahrRule.getLinePoints(pos);
    if (points.length < 2) return;

    const sq = this._sq();

    // Polyline through the CENTER of each threshold square (V-shape).
    const svgPts = points
      .map(p => { const c = this._squareCenter(p.file, p.rank); return `${c.x},${c.y}`; })
      .join(' ');

    const polyline = this._el('polyline');
    polyline.setAttribute('points',          svgPts);
    polyline.setAttribute('fill',            'none');
    polyline.setAttribute('stroke',          '#f0c040');
    polyline.setAttribute('stroke-width',    sq * 0.06);
    polyline.setAttribute('stroke-linecap',  'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    polyline.setAttribute('opacity',         '0.9');
    this._group.appendChild(polyline);

    // Small circle at the apex
    const { x: ax, y: ay } = this._squareCenter(apexFile, apexRank);
    const circle = this._el('circle');
    circle.setAttribute('cx',      ax);
    circle.setAttribute('cy',      ay);
    circle.setAttribute('r',       sq * 0.13);
    circle.setAttribute('fill',    '#f0c040');
    circle.setAttribute('opacity', '0.9');
    this._group.appendChild(circle);
  }

  // ── Müller & Lamprecht overlay ─────────────────────────────────────────────

  _renderMuller(pos) {
    const inter = MullerRule.getIntersection(pos);
    const sq    = this._sq();

    // Diamond at intersection point
    const { x: ix, y: iy } = this._squareCenter(inter.file, inter.rank);
    const d = sq * 0.18;
    const diamond = this._el('polygon');
    diamond.setAttribute('points',
      `${ix},${iy - d} ${ix + d},${iy} ${ix},${iy + d} ${ix - d},${iy}`);
    diamond.setAttribute('fill',    '#ff8844');
    diamond.setAttribute('opacity', '0.85');
    this._group.appendChild(diamond);

    // Line from extra pawn to intersection (d1 reference)
    this._dashedLine(
      this._squareCenter(pos.xFile, pos.xRank),
      { x: ix, y: iy },
      '#ff8844', sq * 0.04, '4,3'
    );

    // Line from black rook pawn to intersection (d2 reference)
    this._dashedLine(
      this._squareCenter(pos.rookFile, pos.bRR),
      { x: ix, y: iy },
      '#88aaff', sq * 0.04, '4,3'
    );

    // Distance labels
    const d1 = Math.max(Math.abs(pos.bKf - pos.xFile), Math.abs(pos.bKr - pos.xRank));
    const d2 = Math.max(Math.abs(pos.rookFile - inter.file), Math.abs(pos.bRR - inter.rank));

    const { x: xpX, y: xpY } = this._squareCenter(pos.xFile, pos.xRank);
    this._text(xpX + sq * 0.1, xpY - sq * 0.3, `d1=${d1}`, '#ff8844', sq * 0.22);

    const { x: rpX, y: rpY } = this._squareCenter(pos.rookFile, pos.bRR);
    this._text(rpX + sq * 0.1, rpY - sq * 0.3, `d2=${d2}`, '#88aaff', sq * 0.22);
  }

  // ── Dvoretsky's Rule overlay ───────────────────────────────────────────────

  _renderDvoretsky(pos) {
    const modelPts = DvoretskyRule.getModelLine(pos);
    const sq       = this._sq();

    if (modelPts.length < 2) return;

    const pts = modelPts
      .map(p => `${this._squareCenter(p.file, p.rank).x},${this._squareCenter(p.file, p.rank).y}`)
      .join(' ');

    const line = this._el('polyline');
    line.setAttribute('points',        pts);
    line.setAttribute('fill',          'none');
    line.setAttribute('stroke',        '#4488ff');
    line.setAttribute('stroke-width',  sq * 0.05);
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity',       '0.8');
    this._group.appendChild(line);

    // Score annotation on the extra pawn square
    const score = DvoretskyRule.getScore(pos);
    const { x, y } = this._squareCenter(pos.xFile, pos.xRank);
    this._text(x, y - sq * 0.32,
      `W:${score.whiteTotal} B:${score.blackTotal}`, '#4488ff', sq * 0.22);
  }

  // ── King Race Rule overlay ─────────────────────────────────────────────────

  _renderRace(pos) {
    const { fileMin, fileMax, rankMin, rankMax } = RaceRule.getSquare(pos);
    const sq = this._sq();

    // Draw the pawn square as a rectangle
    const { x: x0, y: y0 } = this._squareOrigin(fileMin, rankMax); // top-left (highest rank)
    const { x: x1, y: y1 } = this._squareOrigin(fileMax, rankMin); // bottom-right

    const rectW = Math.abs(x1 - x0) + sq;
    const rectH = Math.abs(y1 - y0) + sq;
    const rx    = Math.min(x0, x1);
    const ry    = Math.min(y0, y1);

    const rect = this._el('rect');
    rect.setAttribute('x',            rx);
    rect.setAttribute('y',            ry);
    rect.setAttribute('width',        rectW);
    rect.setAttribute('height',       rectH);
    rect.setAttribute('fill',         '#00cc44');
    rect.setAttribute('fill-opacity', '0.12');
    rect.setAttribute('stroke',       '#00cc44');
    rect.setAttribute('stroke-width', sq * 0.05);
    rect.setAttribute('opacity',      '0.8');
    this._group.appendChild(rect);

    // Distance annotations
    const dist = RaceRule.getDistances(pos);
    const { x: pX, y: pY } = this._squareCenter(pos.xFile, pos.xRank);

    // Line from white king to extra pawn
    this._dashedLine(
      this._squareCenter(pos.wKf, pos.wKr),
      { x: pX, y: pY },
      '#00cc44', sq * 0.04, '3,3'
    );

    // Line from black king to extra pawn
    this._dashedLine(
      this._squareCenter(pos.bKf, pos.bKr),
      { x: pX, y: pY },
      '#ff4444', sq * 0.04, '3,3'
    );

    // "Square" label
    const { x: qX, y: qY } = this._squareCenter(pos.xFile, 7);
    this._text(qX, qY - sq * 0.1, `stq=${dist.stq}`, '#00cc44', sq * 0.22);

    // wDist/bDist on pawn square
    this._text(pX, pY + sq * 0.4,
      `w=${dist.wDistToPawn} b=${dist.bDistToPawn}`, '#cccccc', sq * 0.2);
  }

  // ── SVG helpers ────────────────────────────────────────────────────────────

  _sq() {
    const vb = this._svg.viewBox.baseVal;
    if (vb && vb.width > 0) return vb.width / 8;
    return (this._svg.getBoundingClientRect().width || 400) / 8;
  }

  _squareOrigin(file, rank) {
    const sq = this._sq();
    if (this._orientation === 'w')
      return { x: file * sq, y: (7 - rank) * sq };
    else
      return { x: (7 - file) * sq, y: rank * sq };
  }

  _squareCenter(file, rank) {
    const { x, y } = this._squareOrigin(file, rank);
    const sq = this._sq();
    return { x: x + sq / 2, y: y + sq / 2 };
  }

  _ensureGroup() {
    let g = this._svg.querySelector(`#${OVERLAY_GROUP_ID}`);
    if (!g) {
      g = this._el('g');
      g.setAttribute('id', OVERLAY_GROUP_ID);
      g.setAttribute('pointer-events', 'none');
      // Rule overlays (lines, shapes) go on top of everything — append last
      this._svg.appendChild(g);
    }
    return g;
  }

  _el(tag) {
    return document.createElementNS('http://www.w3.org/2000/svg', tag);
  }

  _dashedLine(from, to, stroke, width, dasharray) {
    const line = this._el('line');
    line.setAttribute('x1',                from.x);
    line.setAttribute('y1',                from.y);
    line.setAttribute('x2',                to.x);
    line.setAttribute('y2',                to.y);
    line.setAttribute('stroke',            stroke);
    line.setAttribute('stroke-width',      width);
    line.setAttribute('stroke-dasharray',  dasharray);
    line.setAttribute('opacity',           '0.75');
    this._group.appendChild(line);
  }

  _text(x, y, label, fill, fontSize) {
    const t = this._el('text');
    t.setAttribute('x',           x);
    t.setAttribute('y',           y);
    t.setAttribute('fill',        fill);
    t.setAttribute('font-size',   fontSize);
    t.setAttribute('font-family', 'monospace');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('opacity',     '0.95');
    t.textContent = label;
    this._group.appendChild(t);
  }
}
