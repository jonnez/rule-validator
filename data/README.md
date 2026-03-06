# data/ — Syzygy Binary Lookup Table

## syzygy_kppvkp.bin

A pre-computed flat binary file containing the WDL (Win/Draw/Loss) result for
every possible KPPvKP position slot.  Loaded by `js/syzygy.js` at startup for
instant O(1) per-position lookups — no network calls required.

### File properties

| Property      | Value            |
|---------------|------------------|
| Size          | 1,720,320 bytes  |
| Format        | Flat `Uint8Array` |
| Positions probed | 1,195,966    |
| White wins    | 1,037,910        |
| Draws         | 154,420          |
| Black wins    | 3,636            |
| Skipped/invalid | 115,876        |

### Byte values

| Value | Meaning          |
|-------|------------------|
| `0`   | Draw             |
| `1`   | White wins       |
| `2`   | Black wins (loss for White) |
| `255` | Invalid / probe failed |

### Index formula

```
index = rookSideIdx * (5 * 7 * 6 * 64 * 64)
      + (wRR - 1)   * (    7 * 6 * 64 * 64)
      + xFileIdx    * (        6 * 64 * 64)
      + (xRank - 1) * (            64 * 64)
      + (wKr*8+wKf) * 64
      + (bKr*8+bKf)

rookSideIdx = (rookFile === 7) ? 1 : 0
xFileIdx    = (rookFile === 0) ? (xFile - 1) : xFile   // always 0..6
```

### How to regenerate

The generator lives in the `BahrRule` project:

```bash
cd /path/to/BahrRule

# Build the generator
bazel build //src/main/cpp:generate_lookup --config=release

# Run it (outputs to the RuleValidator/data/ directory)
bazel run //src/main/cpp:generate_lookup --config=release -- \
    --out=/path/to/RuleValidator/data/syzygy_kppvkp.bin

# (The tablebase files KPPvKP.rtbw / .rtbz must be in
#  BahrRule/src/main/resources/syzygy/)
```

Source: `BahrRule/src/main/cpp/generate_lookup.cpp`
