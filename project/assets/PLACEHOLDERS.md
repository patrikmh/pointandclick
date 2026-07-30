# Placeholder art — Lady Di-Otters strandateljé

These eight files are flat placeholder shapes, drawn programmatically so the
atelier mini-game has a real palette to play with. Replace any of them by
**overwriting the file with the same name**. No code change is needed.

| File | Subject | In-game label | Traits |
|---|---|---|---|
| `feather.png` | gull feather | Fjäder | organiskt, volym |
| `shell-spiral.png` | spiral snail shell | Snäcka | organiskt, glans |
| `shell-mussel.png` | blue mussel shell | Musselskal | organiskt, glans |
| `starfish.png` | starfish | Sjöstjärna | organiskt, volym |
| `rope.png` | coiled rope end | Repstump | skräp, volym |
| `net.png` | torn net fragment | Nätbit | skräp, volym |
| `cap.png` | rusted bottle cap | Kapsyl | skräp, glans |
| `cork.png` | cork float | Korkflöte | skräp, volym |

## What the replacement has to satisfy

- **Transparent PNG.** Anything fully transparent is ignored.
- **Any resolution, any padding.** The game measures each sprite's opaque
  bounding box at load (`opaqueBoxOf`) and draws from that box, so the subject
  can sit anywhere in the frame at any size. The current placeholders are
  420×540 but nothing depends on that.
- **Alpha threshold is 12/255.** Very faint glow pixels outside the subject
  will be treated as part of it and will inflate its box — keep the halo clean
  or fully opaque.
- **One subject per file**, roughly upright. The item is scaled by its longest
  side and rotated about its centre.

## Tuning after a swap

In `project/Adventure Scene.dc.html`, `atelierMaterials`:

- `size` — the item's longest side as a fraction of the otter's height
  (`0.13` for the bottle cap, `0.34` for the seaweed). Adjust if a new texture
  reads too large or too small.
- `traits` — drives the per-round trend requirement and which character shouts
  from the audience. Traits are `organiskt`, `skrap`, `glans`, `volym`.
- `origin` — `hav` or `skrap`, which palette row the chip appears in.

The four painted assets already in the game (`seaweed-item`, `barnacle1`,
`barnacle2`, `driftwood`, plus `bottle`, `fishing-line`, `snorkel`) are the
original artwork and are **not** placeholders.

## Regenerating the placeholders

They were produced by a throwaway PIL script (flat polygons, no external
assets). It is not checked in — if you want them regenerated rather than
replaced, ask and I will re-emit it.
