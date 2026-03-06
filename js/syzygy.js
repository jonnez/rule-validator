/**
 * js/syzygy.js — Local Syzygy Tablebase Lookup
 *
 * Loads data/syzygy_kppvkp.bin (1.64 MB pre-computed WDL table) and
 * provides O(1) per-position lookups without any network calls.
 *
 * ── Binary format ──────────────────────────────────────────────────────────
 *  Total slots : 2 × 5 × 7 × 6 × 64 × 64 = 1,720,320 bytes
 *
 *  Index = rookSideIdx * (5·7·6·64·64)
 *        + (wRR - 1)   * (  7·6·64·64)
 *        + xFileIdx    * (    6·64·64)
 *        + (xRank - 1) * (      64·64)
 *        + (wKr·8+wKf) * 64
 *        + (bKr·8+bKf)
 *
 *  rookSideIdx = (rookFile === 7) ? 1 : 0
 *  xFileIdx    = (rookFile === 0) ? (xFile - 1) : xFile   // always 0..6
 *
 *  Byte values:  0 = Draw,  1 = White wins,  2 = Black wins,  255 = invalid
 */

import { iteratePositions } from './position.js';

// ── Module state ──────────────────────────────────────────────────────────────

let _table = null;   // Uint8Array of 1,720,320 bytes, or null if not loaded

// ── Index formula (mirrors generate_lookup.cpp) ───────────────────────────────

function posIndex(rookFile, wRR, xFile, xRank, wKf, wKr, bKf, bKr) {
  const rookSideIdx = (rookFile === 7) ? 1 : 0;
  const xFileIdx    = (rookFile === 0) ? (xFile - 1) : xFile;
  const wKIdx       = wKr * 8 + wKf;
  const bKIdx       = bKr * 8 + bKf;
  return rookSideIdx * (5 * 7 * 6 * 64 * 64)
       + (wRR - 1)   * (    7 * 6 * 64 * 64)
       + xFileIdx    * (        6 * 64 * 64)
       + (xRank - 1) * (            64 * 64)
       + wKIdx       * 64
       + bKIdx;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch data/syzygy_kppvkp.bin and store it for instant lookups.
 * Call once at startup; await the result before calling lookupPosition().
 *
 * @returns {Promise<boolean>} true if loaded successfully, false otherwise.
 */
export async function initSyzygy() {
  try {
    const response = await fetch('./data/syzygy_kppvkp.bin');
    if (!response.ok) return false;
    const buffer = await response.arrayBuffer();
    _table = new Uint8Array(buffer);
    return _table.length === 1_720_320;
  } catch {
    return false;
  }
}

/**
 * True if the binary table has been loaded successfully.
 */
export function isSyzygyReady() {
  return _table !== null;
}

/**
 * Look up the WDL result for a KPPvKP position.
 *
 * @param {object} pos  KPPvKP position object
 * @returns {'win'|'draw'|'loss'|'unknown'}
 */
export function lookupPosition(pos) {
  if (!_table) return 'unknown';
  const idx = posIndex(pos.rookFile, pos.wRR, pos.xFile, pos.xRank,
                       pos.wKf, pos.wKr, pos.bKf, pos.bKr);
  if (idx < 0 || idx >= _table.length) return 'unknown';
  const v = _table[idx];
  if (v === 1) return 'win';
  if (v === 0) return 'draw';
  if (v === 2) return 'loss';
  return 'unknown';   // 255 = invalid/skipped position
}

/**
 * Compute per-square aggregate statistics from the binary table.
 * Iterates all ~1.2M valid positions and tallies win/draw/loss for each
 * (pieceKey, square) combination.
 *
 * Returns the same shape as position.js computeAggregates(), but for Syzygy:
 * {
 *   extraPawn:     [{win, draw, loss, total} × 64],
 *   whiteKing:     [...],
 *   blackKing:     [...],
 *   whiteRookPawn: [...],
 *   blackRookPawn: [...],
 * }
 *
 * Returns null if the table has not been loaded.
 */
export function computeSyzygyAggregates() {
  if (!_table) return null;

  const pieceKeys = ['extraPawn', 'whiteKing', 'blackKing', 'whiteRookPawn', 'blackRookPawn'];
  const agg = {};
  for (const key of pieceKeys) {
    agg[key] = Array.from({ length: 64 }, () => ({ win: 0, draw: 0, loss: 0, total: 0 }));
  }

  iteratePositions(pos => {
    const outcome = lookupPosition(pos);
    if (outcome === 'unknown') return;   // invalid/skipped slot

    const update = (key, idx) => {
      agg[key][idx].total++;
      if      (outcome === 'win')  agg[key][idx].win++;
      else if (outcome === 'draw') agg[key][idx].draw++;
      else                         agg[key][idx].loss++;
    };

    update('extraPawn',      pos.xRank  * 8 + pos.xFile);
    update('whiteKing',      pos.wKr    * 8 + pos.wKf);
    update('blackKing',      pos.bKr    * 8 + pos.bKf);
    update('whiteRookPawn',  pos.wRR    * 8 + pos.rookFile);
    update('blackRookPawn',  pos.bRR    * 8 + pos.rookFile);
  });

  return agg;
}
