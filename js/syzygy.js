/**
 * js/syzygy.js — Local Syzygy Tablebase Lookup
 *
 * Loads up to three pre-computed WDL binaries and provides O(1) lookups
 * for any subset of KPPvKP material:
 *
 *   data/syzygy_kppvkp.bin  (1.64 MB)  — full KPPvKP (wK + wRP + xP vs bK + bRP)
 *   data/syzygy_kpvkp.bin   (40 KB)    — KPvKP       (wK + wRP vs bK + bRP)
 *   data/syzygy_kpvk.bin    (192 KB)   — KPvK        (wK + xP  vs bK)
 *
 * KvK (just kings) is always a draw — no binary needed.
 *
 * ── Binary formats ─────────────────────────────────────────────────────────────
 *
 * syzygy_kppvkp.bin  — 2 × 5 × 7 × 6 × 64 × 64 = 1,720,320 bytes
 *   Index = rookSideIdx*(5·7·6·64·64) + (wRR-1)*(7·6·64·64)
 *         + xFileIdx*(6·64·64) + (xRank-1)*(64·64) + wKIdx*64 + bKIdx
 *   rookSideIdx = (rookFile===7)?1:0
 *   xFileIdx    = (rookFile===0)?(xFile-1):xFile
 *
 * syzygy_kpvkp.bin  — 2 × 5 × 64 × 64 = 40,960 bytes
 *   Index = rookSideIdx*(5·64·64) + (wRR-1)*(64·64) + wKIdx*64 + bKIdx
 *   rookSideIdx = (rookFile===7)?1:0
 *
 * syzygy_kpvk.bin  — 8 × 6 × 64 × 64 = 196,608 bytes
 *   Index = xFile*(6·64·64) + (xRank-1)*(64·64) + wKIdx*64 + bKIdx
 *
 * Byte values in all bins:  0=Draw, 1=White wins, 2=Black wins, 255=invalid
 */

import { iteratePositions } from './position.js';

// ── Module state ──────────────────────────────────────────────────────────────

let _kppvkp = null;   // Uint8Array — full KPPvKP table
let _kpvkp  = null;   // Uint8Array — KPvKP sub-endgame (extra pawn absent)
let _kpvk   = null;   // Uint8Array — KPvK  sub-endgame (rook pawn pair absent)

// ── Index helpers (mirror the C++ generators exactly) ─────────────────────────

function kppvkpIndex(rookFile, wRR, xFile, xRank, wKf, wKr, bKf, bKr) {
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

function kpvkpIndex(rookFile, wRR, wKf, wKr, bKf, bKr) {
  const rookSideIdx = (rookFile === 7) ? 1 : 0;
  const wKIdx       = wKr * 8 + wKf;
  const bKIdx       = bKr * 8 + bKf;
  return rookSideIdx * (5 * 64 * 64)
       + (wRR - 1)   * (    64 * 64)
       + wKIdx       * 64
       + bKIdx;
}

function kpvkIndex(xFile, xRank, wKf, wKr, bKf, bKr) {
  const wKIdx = wKr * 8 + wKf;
  const bKIdx = bKr * 8 + bKf;
  return xFile       * (6 * 64 * 64)
       + (xRank - 1) * (    64 * 64)
       + wKIdx       * 64
       + bKIdx;
}

// ── Byte-value decoder ────────────────────────────────────────────────────────

function decodeWdl(v) {
  if (v === 1) return 'win';
  if (v === 0) return 'draw';
  if (v === 2) return 'loss';
  return 'unknown';   // 255 = invalid / skipped
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetch all available Syzygy binaries.
 * The sub-endgame bins are loaded opportunistically — a failure is non-fatal.
 *
 * @returns {Promise<boolean>} true if at least the main KPPvKP table loaded.
 */
export async function initSyzygy() {
  const loadBin = async (path, expectedBytes) => {
    try {
      const r = await fetch(path);
      if (!r.ok) return null;
      const buf = await r.arrayBuffer();
      const arr = new Uint8Array(buf);
      return arr.length === expectedBytes ? arr : null;
    } catch {
      return null;
    }
  };

  // Load all three in parallel; sub-endgame failures don't block the main one.
  const [kppvkp, kpvkp, kpvk] = await Promise.all([
    loadBin('./data/syzygy_kppvkp.bin', 1_720_320),
    loadBin('./data/syzygy_kpvkp.bin',     40_960),
    loadBin('./data/syzygy_kpvk.bin',     196_608),
  ]);

  _kppvkp = kppvkp;
  _kpvkp  = kpvkp;
  _kpvk   = kpvk;

  return _kppvkp !== null;
}

/**
 * True if the full KPPvKP binary is loaded (minimum for normal operation).
 */
export function isSyzygyReady() {
  return _kppvkp !== null;
}

/**
 * True if all three sub-endgame binaries are loaded.
 */
export function isSubSyzygyReady() {
  return _kpvkp !== null && _kpvk !== null;
}

/**
 * Look up the WDL result for a full KPPvKP position.
 *
 * @param {object} pos  — {rookFile, wRR, xFile, xRank, wKf, wKr, bKf, bKr}
 * @returns {'win'|'draw'|'loss'|'unknown'}
 */
export function lookupPosition(pos) {
  if (!_kppvkp) return 'unknown';
  if (pos.rookFile !== 0 && pos.rookFile !== 7) return 'unknown';
  if (pos.wRR < 1 || pos.wRR > 5)              return 'unknown';
  if (pos.xRank < 1 || pos.xRank > 6)          return 'unknown';
  const idx = kppvkpIndex(pos.rookFile, pos.wRR, pos.xFile, pos.xRank,
                          pos.wKf, pos.wKr, pos.bKf, pos.bKr);
  if (idx < 0 || idx >= _kppvkp.length) return 'unknown';
  return decodeWdl(_kppvkp[idx]);
}

/**
 * Look up the WDL result for a partial KPPvKP position.
 *
 * Accepts a "partial position" where absent pieces have null/undefined fields:
 *   - rookFile / wRR absent  → rook pawn pair not placed
 *   - xFile / xRank absent   → extra pawn not placed
 *   - wKf / bKf absent       → king not placed (returns 'unknown')
 *
 * Routing:
 *   all present         → syzygy_kppvkp.bin
 *   rook pair absent    → syzygy_kpvk.bin     (KPvK)
 *   extra pawn absent   → syzygy_kpvkp.bin    (KPvKP)
 *   both pawns absent   → 'draw'              (KvK)
 *   either king absent  → 'unknown'
 *
 * @param {object} p  partial position
 * @returns {'win'|'draw'|'loss'|'unknown'}
 */
export function lookupPartialPosition(p) {
  // Both kings required for any meaningful syzygy result.
  if (p.wKf == null || p.bKf == null) return 'unknown';

  const hasRookPair  = p.rookFile != null && p.wRR != null;
  const hasExtraPawn = p.xFile    != null && p.xRank != null;

  if (hasRookPair && hasExtraPawn) {
    return lookupPosition(p);
  }

  if (hasRookPair && !hasExtraPawn) {
    // KPvKP — blocked rook pawns, no extra pawn.
    // Requires rookFile ∈ {0,7} and wRR ∈ [1,5] (same constraints as the bin).
    if (!_kpvkp) return 'unknown';
    if (p.rookFile !== 0 && p.rookFile !== 7) return 'unknown';
    if (p.wRR < 1 || p.wRR > 5) return 'unknown';
    const idx = kpvkpIndex(p.rookFile, p.wRR, p.wKf, p.wKr, p.bKf, p.bKr);
    if (idx < 0 || idx >= _kpvkp.length) return 'unknown';
    return decodeWdl(_kpvkp[idx]);
  }

  if (!hasRookPair && hasExtraPawn) {
    // KPvK — extra pawn only, no rook pawns.
    // Requires xRank ∈ [1,6] (pawns can't be on rank 0 or 7).
    if (!_kpvk) return 'unknown';
    if (p.xRank < 1 || p.xRank > 6) return 'unknown';
    const idx = kpvkIndex(p.xFile, p.xRank, p.wKf, p.wKr, p.bKf, p.bKr);
    if (idx < 0 || idx >= _kpvk.length) return 'unknown';
    return decodeWdl(_kpvk[idx]);
  }

  // KvK — always draw
  return 'draw';
}

/**
 * Compute per-square aggregate statistics from the full KPPvKP binary table.
 * Used as the fallback heatmap when the board is nearly empty.
 *
 * Returns:
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
  if (!_kppvkp) return null;

  const pieceKeys = ['extraPawn', 'whiteKing', 'blackKing', 'whiteRookPawn', 'blackRookPawn'];
  const agg = {};
  for (const key of pieceKeys) {
    agg[key] = Array.from({ length: 64 }, () => ({ win: 0, draw: 0, loss: 0, total: 0 }));
  }

  iteratePositions(pos => {
    const outcome = lookupPosition(pos);
    if (outcome === 'unknown') return;

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
