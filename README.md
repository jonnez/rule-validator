# KPPvKP Endgame Rule Validator

A static website (GitHub Pages) for exploring and comparing heuristic rules
for the **KPPvKP chess endgame**: White has a King, a rook pawn (a- or h-file),
and one extra passed pawn; Black has a King and a rook pawn on the same file,
directly blocking White's rook pawn.

## Live demo

Hosted at: `https://jonnez.github.io/rule-validator/`

## Features

| Feature | Details |
|---------|---------|
| **Interactive board** | Drag pieces freely; FEN paste/load |
| **Legal move list** | Click any move to play it |
| **Four rules** | Bähr, Müller & Lamprecht, Dvoretsky, King Race Rule |
| **SVG overlays** | Rule-specific lines/shapes drawn on the board |
| **Heatmap** | Drag a piece to see aggregate win/draw% per square |
| **Syzygy lookup** | Instant local WDL lookup from bundled binary (no network) |
| **Example positions** | Quick-load buttons for representative positions |

## Rules implemented

### 1. Bähr's Rule (1936)
Draw a V-shaped dividing line from Black's rook pawn toward the nearest bishop
file, then descending.  Extra pawn **on or below** → White wins; **strictly above** → Draw.
Gold line drawn on the board.

### 2. Müller & Lamprecht Rule (*Secrets of Pawn Endings*, 2000)
Compare Chebyshev distances d1 (Black king → extra pawn) and d2 (Black rook
pawn → intersection point).  d1 ≥ d2 → White wins; d1 < d2 → Draw.
Intersection point and distance lines shown on the board.

### 3. Dvoretsky's Rule (*Endgame Manual*)
A model diagonal from the rook pawn file (rank 3) to the bishop file (rank 8).
Points: White = (lineRank − extraPawnRank) + king bonus; Black = 4 − rookPawnRank.
White total > Black total → White wins.  Model diagonal drawn in blue.

### 4. King Race Rule (new)
Step 1: if Black's king is outside the square of the extra pawn → White wins.
Step 2: if White's king is at least as close to the extra pawn as Black's → White wins.
Otherwise → Draw.  Pawn square rectangle drawn in green.

## Heatmap bars

When you **drag a piece**, each square shows two thin horizontal bars:

```
┌──────────────────────┐
│       square         │
│  ████░░░░░░█████░░  │  ← selected rule  (white=win, gray=draw)
│  ████████░░░░████░  │  ← Syzygy         (white=win, gray=draw, black=loss)
└──────────────────────┘
```

The bars show **aggregate statistics** across all valid KPPvKP positions where
the dragged piece is on that square — a distribution over all king and pawn
placements.  This lets you immediately see which squares are "structurally"
strong or weak, independent of the current position.

The Syzygy bar is computed at startup from the bundled
`data/syzygy_kppvkp.bin` binary (loaded automatically).

## File structure

```
RuleValidator/
├── index.html          Main page
├── css/
│   └── style.css       Dark theme
├── js/
│   ├── rules.js        Rule implementations (Bähr, Müller, Dvoretsky, Race)
│   ├── position.js     KPPvKP position iterator + validation
│   ├── heatmap.js      SVG heatmap overlay renderer
│   ├── overlay.js      Rule-specific line/shape overlays
│   ├── syzygy.js       Local binary tablebase lookup
│   └── app.js          Main application logic
├── data/
│   ├── README.md           How to regenerate the binary
│   └── syzygy_kppvkp.bin   Pre-computed WDL table (~1.6 MB)
└── README.md
```

## Adding a new rule

1. Open `js/rules.js`.
2. Add a new object following the pattern of `BahrRule`:
   ```js
   export const MyRule = {
     id:          'myrule',
     name:        'My Rule',
     shortDesc:   'One sentence.',
     description: '<p>HTML description…</p>',
     predict(pos) { return pos.xRank > 3 ? 'win' : 'draw'; },
   };
   ```
3. Append it to `ALL_RULES` at the bottom of `rules.js`.
4. Optionally add a `renderOverlay` method and a case in `js/overlay.js`.

The rule is immediately available in the selector, the heatmap, and the
position analysis panel.

## Dependencies (CDN)

| Library | Version | Purpose |
|---------|---------|---------|
| [cm-chessboard](https://github.com/shaack/cm-chessboard) | 6.x | SVG chessboard |
| [chess.js](https://github.com/jhlywa/chess.js) | 1.x | Move generation & FEN |

No build step needed — open `index.html` directly or serve with any static
file server.

## Running locally

```bash
# Python 3
python3 -m http.server 8080
# then open http://localhost:8080

# Node / npx
npx serve .
```

Opening `index.html` directly via `file://` may fail for the ES module imports;
use a local server.

## GitHub Pages deployment

1. Push this folder to a GitHub repository.
2. Go to **Settings → Pages → Source**: select `main` branch, `/ (root)`.
3. The site is live at `https://jonnez.github.io/rule-validator/`.

## Related project

The rule implementations are ported from the C++ validators in
[BahrRule](../BahrRule/) which evaluate all ~1.2 M valid KPPvKP positions
against the Syzygy tablebase and report accuracy statistics.

## References

1. Walter Bähr, *Opposition und kritische Felder im Bauernendspiel*, 1936.
2. Karsten Müller & Frank Lamprecht, *Secrets of Pawn Endings*, Gambit 2000/2007.
3. Mark Dvoretsky, *Endgame Manual*, Russell Enterprises 2003–2025.
4. njswift, [Formulating Bähr's Rule](https://lichess.org/@/njswift/blog/formulating-bahrs-rule/r6Y2X63g) (Lichess blog).
5. Karsten Müller, [YouTube video on Dvoretsky's rule](https://www.youtube.com/watch?v=YfqdxnfCd0w).
