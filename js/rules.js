/**
 * js/rules.js — KPPvKP Rule Implementations
 *
 * JavaScript port of the C++ rule evaluators from the BahrRule project.
 *
 * Coordinate encoding (0-indexed, matching C++):
 *   file:  0 = a-file, 7 = h-file
 *   rank:  0 = rank 1 (white's back rank), 7 = rank 8 (black's back rank)
 *
 * Position object fields:
 *   rookFile   — 0 (a-file) or 7 (h-file): the file of the blocked rook pawn pair
 *   wRR        — white rook pawn rank (1–5)
 *   bRR        — black rook pawn rank (always wRR + 1)
 *   xFile      — extra white pawn file (0–7, ≠ rookFile)
 *   xRank      — extra white pawn rank (1–6)
 *   wKf, wKr   — white king file / rank
 *   bKf, bKr   — black king file / rank
 *
 * Each rule object exposes:
 *   id          — short identifier string
 *   name        — display name
 *   shortDesc   — one-sentence summary
 *   description — full HTML description
 *   predict(pos) → 'win' | 'draw'
 *   overlayLines(pos, sq) → array of SVG line/path descriptors for the board overlay
 */

// ── Shared helper ─────────────────────────────────────────────────────────────

export function chebyshev(f1, r1, f2, r2) {
  return Math.max(Math.abs(f1 - f2), Math.abs(r1 - r2));
}

// ── Bähr's Rule ───────────────────────────────────────────────────────────────

function bahrThreshold(rookFile, bRR, xFile) {
  const bishopFile = (rookFile === 0) ? 2 : 5;
  const stepDir    = (rookFile === 0) ? 1 : -1;

  let cornerFile = rookFile;
  let cornerRank = bRR;
  while (cornerFile !== bishopFile && cornerRank < 7) {
    cornerFile += stepDir;
    cornerRank++;
  }

  const onAscArm = (stepDir > 0) ? (xFile <= cornerFile) : (xFile >= cornerFile);
  if (onAscArm)
    return bRR + Math.abs(xFile - rookFile);
  else
    return cornerRank - Math.abs(xFile - cornerFile);
}

export const BahrRule = {
  id: 'bahr',
  name: "Bähr's Rule",
  shortDesc: "Geometric V-line from the black rook pawn to the nearest bishop file",
  description: `
    <p><strong>Source:</strong> Walter Bähr (1936), as reformulated by njswift on
    <a href="https://lichess.org/@/njswift/blog/formulating-bahrs-rule/r6Y2X63g" target="_blank">Lichess</a>.</p>
    <p>Draw a V-shaped dividing line starting at Black's rook pawn, ascending diagonally
    toward the nearest bishop file (c-file for an a-side rook pawn, f-file for h-side),
    one rank per file step. If rank 8 is reached before the bishop file, the ascent ends
    there (the apex). From the apex the line descends diagonally toward the board edge.</p>
    <ul>
      <li>Extra pawn <em>on or above</em> the line → <strong>White wins</strong></li>
      <li>Extra pawn <em>strictly below</em> the line → <strong>Draw</strong></li>
    </ul>
    <p>The line is drawn in gold on the board. The apex is shown as a circle.</p>`,

  predict(pos) {
    return (pos.xRank >= bahrThreshold(pos.rookFile, pos.bRR, pos.xFile))
      ? 'win' : 'draw';
  },

  /** Return the apex and V-arm endpoints for drawing on the SVG board. */
  getLinePoints(pos) {
    const { rookFile, bRR } = pos;
    const bishopFile = (rookFile === 0) ? 2 : 5;
    const stepDir    = (rookFile === 0) ? 1 : -1;

    // Ascending arm: from rook pawn diagonally to apex
    let apexFile = rookFile;
    let apexRank = bRR;
    while (apexFile !== bishopFile && apexRank < 7) {
      apexFile += stepDir;
      apexRank++;
    }

    // One point per file: the center of the threshold square at that file.
    // Including rookFile itself (threshold = bRR there, i.e. the rook pawn square).
    const points = [];
    for (let f = 0; f < 8; f++) {
      const rank = bahrThreshold(rookFile, bRR, f);
      if (rank >= 0 && rank <= 7) points.push({ file: f, rank });
    }
    points.sort((a, b) => a.file - b.file);

    return { points, apexFile, apexRank };
  },
};

// ── Müller & Lamprecht Rule ───────────────────────────────────────────────────

export const MullerRule = {
  id: 'muller',
  name: "Müller & Lamprecht Rule",
  shortDesc: "Distance race: defending king vs. rook pawn to the intersection point",
  description: `
    <p><strong>Source:</strong> Karsten Müller & Frank Lamprecht, <em>Secrets of Pawn Endings</em> (Gambit, 2000).</p>
    <p>Find the <em>intersection point</em>: step diagonally from the extra pawn toward
    the nearest bishop file (one rank higher per file step), capping at rank 8.
    Then compare two Chebyshev distances:</p>
    <ul>
      <li><strong>d1</strong> = distance from Black's king to the extra pawn</li>
      <li><strong>d2</strong> = distance from Black's rook pawn to the intersection</li>
    </ul>
    <p>d1 ≥ d2 → <strong>White wins</strong> &nbsp;|&nbsp; d1 &lt; d2 → <strong>Draw</strong></p>
    <p>The intersection point is shown as a diamond on the board.
    Distance annotations appear beside the board.</p>`,

  predict(pos) {
    const bishopFile = (pos.rookFile === 0) ? 2 : 5;
    const fileDist   = Math.abs(pos.xFile - bishopFile);
    const iRank      = Math.min(7, pos.xRank + fileDist);

    const d1 = chebyshev(pos.bKf, pos.bKr, pos.xFile, pos.xRank);
    const d2 = chebyshev(pos.rookFile, pos.bRR, bishopFile, iRank);
    return (d1 >= d2) ? 'win' : 'draw';
  },

  getIntersection(pos) {
    const bishopFile = (pos.rookFile === 0) ? 2 : 5;
    const fileDist   = Math.abs(pos.xFile - bishopFile);
    const iRank      = Math.min(7, pos.xRank + fileDist);
    return { file: bishopFile, rank: iRank };
  },
};

// ── Dvoretsky's Rule ──────────────────────────────────────────────────────────

export const DvoretskyRule = {
  id: 'dvoretsky',
  name: "Dvoretsky's Rule",
  shortDesc: "Point-scoring system based on a model diagonal line",
  description: `
    <p><strong>Source:</strong> Mark Dvoretsky, <em>Endgame Manual</em>.
    Presented on YouTube by Karsten Müller.</p>
    <p>A <em>model line</em> runs from the rook pawn's file at rank 3 diagonally
    up to the bishop file at rank 8 (one rank per file step).
    Points are assigned and compared:</p>
    <table>
      <tr><th>White's points</th><td>= (lineRank − extraPawnRank) + 1 if White king is above the extra pawn</td></tr>
      <tr><th>Black's points</th><td>= 4 − blackRookPawnRank</td></tr>
    </table>
    <p>White total &gt; Black total → <strong>White wins</strong>; otherwise → <strong>Draw</strong>.</p>
    <p>The model diagonal is drawn in blue on the board.</p>`,

  predict(pos) {
    const lineRank       = Math.min(7, 2 + Math.abs(pos.xFile - pos.rookFile));
    const whitePawnPts   = lineRank - pos.xRank;
    const whiteKingBonus = (pos.wKr > pos.xRank) ? 1 : 0;
    const whiteTotal     = whitePawnPts + whiteKingBonus;
    const blackTotal     = 4 - pos.bRR;
    return (whiteTotal > blackTotal) ? 'win' : 'draw';
  },

  /** Model line: from (rookFile, rank2) to (bishopFile, rank7), one step per file. */
  getModelLine(pos) {
    const bishopFile = (pos.rookFile === 0) ? 2 : 5;
    const stepDir    = (pos.rookFile === 0) ? 1 : -1;
    const points = [];
    let f = pos.rookFile, r = 2;
    while (true) {
      points.push({ file: f, rank: r });
      if (f === bishopFile || r >= 7) break;
      f += stepDir;
      r++;
    }
    return points;
  },

  getScore(pos) {
    const lineRank       = Math.min(7, 2 + Math.abs(pos.xFile - pos.rookFile));
    const whitePawnPts   = lineRank - pos.xRank;
    const whiteKingBonus = (pos.wKr > pos.xRank) ? 1 : 0;
    const whiteTotal     = whitePawnPts + whiteKingBonus;
    const blackTotal     = 4 - pos.bRR;
    return { whiteTotal, blackTotal, whitePawnPts, whiteKingBonus };
  },
};

// ── King Race Rule ─────────────────────────────────────────────────────────────

export const RaceRule = {
  id: 'race',
  name: "King Race Rule",
  shortDesc: "Square of the pawn + white-king escort correction",
  description: `
    <p><strong>Origin:</strong> Derived from first principles as part of this project.</p>
    <p><strong>Step 1 — Square of the pawn:</strong> If Black's king is outside the
    geometric square of the extra pawn, it cannot catch the pawn before it queens.</p>
    <p><strong>Step 2 — White-king escort:</strong> Even if Black's king is inside the
    square, if White's king is at least as close to the extra pawn as Black's king,
    White can escort the pawn safely to promotion.</p>
    <ul>
      <li>Black outside square → <strong>White wins</strong></li>
      <li>White king escorts (wDist ≤ bDist to pawn) → <strong>White wins</strong></li>
      <li>Otherwise → <strong>Draw</strong></li>
    </ul>
    <p>The square of the pawn is drawn as a green diamond on the board.
    The escort distance comparison is shown numerically.</p>`,

  predict(pos) {
    const stq      = 7 - pos.xRank;
    const bDistToQ = chebyshev(pos.bKf, pos.bKr, pos.xFile, 7);
    if (bDistToQ > stq) return 'win';

    const wDistToPawn = chebyshev(pos.wKf, pos.wKr, pos.xFile, pos.xRank);
    const bDistToPawn = chebyshev(pos.bKf, pos.bKr, pos.xFile, pos.xRank);
    return (wDistToPawn <= bDistToPawn) ? 'win' : 'draw';
  },

  /** The "square of the pawn": a Chebyshev square from pawn to queening square. */
  getSquare(pos) {
    const stq = 7 - pos.xRank;
    // Square corners (file range, rank range) centered on the pawn's queening path
    const fileMin = Math.max(0, pos.xFile - stq);
    const fileMax = Math.min(7, pos.xFile + stq);
    const rankMin = pos.xRank;
    const rankMax = 7;
    return { fileMin, fileMax, rankMin, rankMax };
  },

  getDistances(pos) {
    const stq      = 7 - pos.xRank;
    const bDistToQ = chebyshev(pos.bKf, pos.bKr, pos.xFile, 7);
    const wDistToPawn = chebyshev(pos.wKf, pos.wKr, pos.xFile, pos.xRank);
    const bDistToPawn = chebyshev(pos.bKf, pos.bKr, pos.xFile, pos.xRank);
    return { stq, bDistToQ, wDistToPawn, bDistToPawn };
  },
};

// ── Rule registry ─────────────────────────────────────────────────────────────

export const ALL_RULES = [BahrRule, MullerRule, DvoretskyRule, RaceRule];

/** Look up a rule by id. */
export function findRule(id) {
  return ALL_RULES.find(r => r.id === id) ?? ALL_RULES[0];
}
