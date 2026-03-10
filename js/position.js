/**
 * js/position.js — KPPvKP Position Handling
 *
 * Provides:
 *   iteratePositions(callback)   — enumerate all ~1.2M valid KPPvKP positions
 *   validateKPPvKP(chess)        — check if a Chess.js position is valid KPPvKP
 *   boardToPosition(chess)       — convert a Chess.js board to a Position object
 *   computeAggregates(rules)     — precompute per-square statistics for each rule
 *
 * A "valid KPPvKP position" (white to move) has exactly:
 *   White: King + rook pawn (a/h file) + extra pawn (b–g file)
 *   Black: King + rook pawn (same a/h file, one rank above white's rook pawn)
 *   No king in check, kings not adjacent.
 */

import { ALL_RULES } from './rules.js';

// ── Position iterator (mirrors C++ PositionIterator::iterate) ─────────────────

/**
 * Iterate every valid KPPvKP position (white to move) and call
 * callback(pos) for each one.  The callback receives a plain object
 * with fields: rookFile, wRR, bRR, xFile, xRank, wKf, wKr, bKf, bKr.
 */
export function iteratePositions(callback) {
  for (const rookFile of [0, 7]) {
    for (let wRR = 1; wRR <= 5; wRR++) {
      const bRR = wRR + 1;

      for (let xFile = 0; xFile < 8; xFile++) {
        if (xFile === rookFile) continue;

        for (let xRank = 1; xRank <= 6; xRank++) {
          for (let wKf = 0; wKf < 8; wKf++) {
          for (let wKr = 0; wKr < 8; wKr++) {
            if (wKf === rookFile && wKr === wRR)   continue;
            if (wKf === rookFile && wKr === bRR)   continue;
            if (wKf === xFile   && wKr === xRank)  continue;

          for (let bKf = 0; bKf < 8; bKf++) {
          for (let bKr = 0; bKr < 8; bKr++) {
            if (bKf === wKf && bKr === wKr)                          continue;
            if (bKf === rookFile && bKr === wRR)                     continue;
            if (bKf === rookFile && bKr === bRR)                     continue;
            if (bKf === xFile   && bKr === xRank)                    continue;
            // Kings not adjacent
            if (Math.abs(wKf - bKf) <= 1 && Math.abs(wKr - bKr) <= 1) continue;
            // Black king not in check from white rook pawn
            if (Math.abs(bKf - rookFile) === 1 && bKr === wRR + 1)  continue;
            // Black king not in check from white extra pawn
            if (Math.abs(bKf - xFile)    === 1 && bKr === xRank + 1) continue;

            callback({ rookFile, wRR, bRR, xFile, xRank, wKf, wKr, bKf, bKr });
          }}
          }}
        }
      }
    }
  }
}

// ── Aggregate statistics ──────────────────────────────────────────────────────

/**
 * Pre-compute per-square aggregate statistics for every rule.
 *
 * Returns an object:
 *   result[ruleId][pieceKey][squareIndex] = { win, draw, total }
 *
 * pieceKeys: 'extraPawn', 'whiteKing', 'blackKing', 'whiteRookPawn', 'blackRookPawn'
 * squareIndex: rank*8 + file  (rank 0–7, file 0–7)
 *
 * This processes ~1.2M positions; takes < 500 ms in a modern browser.
 */
export function computeAggregates(rules = ALL_RULES) {
  const pieceKeys = ['extraPawn', 'whiteKing', 'blackKing', 'whiteRookPawn', 'blackRookPawn'];

  // Initialize result structure
  const result = {};
  for (const rule of rules) {
    result[rule.id] = {};
    for (const key of pieceKeys) {
      result[rule.id][key] = Array.from({ length: 64 }, () => ({ win: 0, draw: 0, total: 0 }));
    }
  }

  iteratePositions(pos => {
    for (const rule of rules) {
      if (!rule.isApplicable(pos)) continue;
      const prediction = rule.predict(pos);
      const d = result[rule.id];

      const update = (key, idx) => {
        d[key][idx].total++;
        if (prediction === 'win') d[key][idx].win++;
        else                      d[key][idx].draw++;
      };

      update('extraPawn',      pos.xRank   * 8 + pos.xFile);
      update('whiteKing',      pos.wKr     * 8 + pos.wKf);
      update('blackKing',      pos.bKr     * 8 + pos.bKf);
      update('whiteRookPawn',  pos.wRR     * 8 + pos.rookFile);
      update('blackRookPawn',  pos.bRR     * 8 + pos.rookFile);
    }
  });

  return result;
}

// ── Syzygy aggregate loading ──────────────────────────────────────────────────

/**
 * Attempt to load pre-computed Syzygy aggregate data from
 * ./data/syzygy-aggregates.json.  Returns null if not available.
 *
 * Expected JSON format (same shape as computeAggregates result):
 * {
 *   "extraPawn":     [ {"win":N,"draw":N,"loss":N,"total":N}, ... ],  // 64 entries
 *   "whiteKing":     [...],
 *   "blackKing":     [...],
 *   "whiteRookPawn": [...],
 *   "blackRookPawn": [...]
 * }
 */
export async function loadSyzygyAggregates() {
  try {
    const response = await fetch('./data/syzygy-aggregates.json');
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

// ── Board position validation and conversion ──────────────────────────────────

/**
 * Parse a chess.js board into a KPPvKP Position object, or return null
 * if the position does not match the KPPvKP material/structure requirements.
 *
 * @param {import('chess.js').Chess} chess  A chess.js Chess instance.
 * @returns {object|null}  Position object, or null if invalid.
 */
export function boardToPosition(chess) {
  // chess.js v1: board()[row][col] where row=0 is rank 8 (top), row=7 is rank 1 (bottom)
  // Convert: my_rank = 7 - row,  my_file = col  (0=a, 7=h)
  const boardArr = chess.board();

  const wPawns = [], bPawns = [];
  let wKf = -1, wKr = -1, bKf = -1, bKr = -1;

  for (let row = 0; row < 8; row++) {
    const rank = 7 - row;   // my 0-indexed rank (0 = rank 1, 7 = rank 8)
    for (let f = 0; f < 8; f++) {
      const sq = boardArr[row][f];
      if (!sq) continue;
      if (sq.type === 'k' && sq.color === 'w') { wKf = f; wKr = rank; }
      if (sq.type === 'k' && sq.color === 'b') { bKf = f; bKr = rank; }
      if (sq.type === 'p' && sq.color === 'w') wPawns.push({ file: f, rank });
      if (sq.type === 'p' && sq.color === 'b') bPawns.push({ file: f, rank });
    }
  }

  // Material check: exactly WK + 2WP + BK + 1BP
  if (wKf === -1 || bKf === -1) return null;
  if (wPawns.length !== 2 || bPawns.length !== 1) return null;

  // The black pawn determines the rook file (it must be on a- or h-file)
  const bRookPawn = bPawns[0];
  if (bRookPawn.file !== 0 && bRookPawn.file !== 7) return null;
  const rookFile = bRookPawn.file;

  // White rook pawn must be on the same file as the black pawn
  const rookPawnIdx = wPawns.findIndex(p => p.file === rookFile);
  if (rookPawnIdx === -1) return null;

  const wRookPawn = wPawns[rookPawnIdx];
  const xPawn     = wPawns[1 - rookPawnIdx];

  // Extra pawn must not be on the rook file
  if (xPawn.file === rookFile) return null;

  // Black rook pawn must be directly above white's
  if (bRookPawn.rank !== wRookPawn.rank + 1) return null;

  // Rank range checks (0-indexed)
  if (wRookPawn.rank < 1 || wRookPawn.rank > 5) return null;
  if (xPawn.rank    < 1 || xPawn.rank    > 6) return null;

  return {
    rookFile,
    wRR:  wRookPawn.rank,
    bRR:  bRookPawn.rank,
    xFile: xPawn.file,
    xRank: xPawn.rank,
    wKf, wKr, bKf, bKr,
  };
}

/**
 * Return true if the chess position has exactly KPP vs KP material,
 * regardless of structural validity for the rules.
 */
export function hasMaterial(chess) {
  const boardArr = chess.board();
  let wP = 0, bP = 0, wK = false, bK = false;
  for (let row = 0; row < 8; row++) {
    for (let f = 0; f < 8; f++) {
      const sq = boardArr[row][f];
      if (!sq) continue;
      if (sq.type === 'k') { sq.color === 'w' ? (wK = true) : (bK = true); }
      if (sq.type === 'p') { sq.color === 'w' ? wP++ : bP++; }
    }
  }
  return wK && bK && wP === 2 && bP === 1;
}

/**
 * Build a FEN string from a KPPvKP position object (white to move, no castling/ep).
 */
export function positionToFen(pos) {
  const grid = Array.from({ length: 8 }, () => Array(8).fill(null));

  const place = (type, file, rank) => { grid[rank][file] = type; };

  place('K', pos.wKf,    pos.wKr);
  place('P', pos.rookFile, pos.wRR);
  place('P', pos.xFile,  pos.xRank);
  place('k', pos.bKf,    pos.bKr);
  place('p', pos.rookFile, pos.bRR);

  // Build FEN ranks from rank 7 (top) to rank 0 (bottom)
  const ranks = [];
  for (let r = 7; r >= 0; r--) {
    let rankStr = '';
    let empty = 0;
    for (let f = 0; f < 8; f++) {
      if (grid[r][f]) {
        if (empty) { rankStr += empty; empty = 0; }
        rankStr += grid[r][f];
      } else {
        empty++;
      }
    }
    if (empty) rankStr += empty;
    ranks.push(rankStr);
  }

  return ranks.join('/') + ' w - - 0 1';
}

/** Convert file index to algebraic letter ('a'–'h'). */
export function fileToLetter(f) {
  return String.fromCharCode(97 + f);
}

/** Convert algebraic square name to { file, rank } (0-indexed). */
export function squareToCoord(sq) {
  return { file: sq.charCodeAt(0) - 97, rank: parseInt(sq[1]) - 1 };
}

/** Convert { file, rank } to algebraic square name. */
export function coordToSquare(file, rank) {
  return String.fromCharCode(97 + file) + (rank + 1);
}
