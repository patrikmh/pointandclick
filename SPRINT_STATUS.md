# Sprint Status: Shadowmatic-style shadow theatre (Bäärnts skuggteater)

## Shipped

- **Silhouette-first geometry** — `sheepPrismLimb` / `sheepPart` build limbs by extruding a convex 2D
  outline along z with a per-vertex wobble, so every limb is genuinely non-planar. Each round's
  target is authored as flat art in `sheepOutlines`; facing the light a piece throws exactly that
  outline, turned away it foreshortens into an unreadable sliver. That contrast is the puzzle.
- **Four readable silhouettes** — `lighthouse` (Fyr) → `sailboat` (Segelbåt) → `anchor` (Ankare) →
  `fish` (Fisk). Each is three essential pieces plus a decoy that only disappears edge-on. Outlines
  are deliberately shared between rounds: one slab reads as a lighthouse roof, an anchor fluke, and
  a fish fin.
- **Vector shadow rendering** — the 192×120 mask stays the matcher's business; the wall gets real
  polygons with a three-pass penumbra. Blur radius is driven by match quality, so a wrong pose
  throws a soft murky blur and a right one resolves into a crisp black cut-out.
- **Union outlining** — the target ghost strokes a double-width band and erases the filled union,
  so overlapping pieces never draw their internal seams onto the plaster. One clean silhouette line.
- **Camera off the light axis** — `sheepDisplayView` views the pieces from a few degrees off the
  lamp, so they stay visibly three-dimensional even when their shadow is perfectly flat. The wall
  says "fyr"; the objects still say "junk".
- **Lit room** — cached plaster texture with grain, blemishes and vignette; a pool of lamplight; 70
  drifting dust motes; per-face Lambert + specular + rim shading from the same light that casts the
  shadow; a warm bloom that builds as the shape resolves.
- **Resolve moment** — on a passing match the ghost steps aside, the plaster blooms and the round's
  name rises in letter-spaced Cinzel. A snapped piece plays a click.
- **Direct manipulation** — click a sculpture on the canvas to select it (hit-tested against the
  bounds the renderer measured), drag to turn it, Shift + drag to roll, with a capped, decaying
  coast on release. Arrow keys, number keys and the button row all still work.
- **Rendered at device resolution** — the stage is authored in 1000×610 logical units but displays
  up to 840 CSS px, so a fixed backing store was upscaled on HiDPI screens. `sheepRenderScale`
  sizes the canvas and both offscreen layers by the device ratio and scales the context, keeping
  every drawing call in logical units.
- **Hover, selection and settle feedback** — hovering a sculpture lights its silhouette hull and
  switches the cursor; the active piece carries a warmer hull and a caret; a piece snapping home
  flashes and clicks. Selection is drawn from the convex hull, never per-face, so a sculpture never
  turns into a wireframe.
- **Minimal chrome** — the control row is rotation only; Vink, Ställ in skuggan and Återställ moved
  into the ⚙ drawer alongside the accessibility settings. Fits 1280×720 without scrolling (685px).
- **Retained from the previous sprint** — Fri skugga practice mode, resume-on-reopen, replay for a
  pure star, honest assist provenance, ghost brightness and colourblind palettes, the swing-aware
  target-mask cache, keyboard accessibility, and full teardown.

## Fixed after playtest

- **Rounds solved themselves and got skipped.** `completeSheepRound` incremented `sheepGameRound`
  immediately but `startSheepRound` only dealt the new pieces 650ms later. In that window
  `sheepCurrentRound()` was already the *next* round while `sheepObjects` still held the *previous*
  round's pieces at their solved poses — and since every round shares the same solution vector
  (`[0,0,0] x3` plus the decoy's `ry: 1.45`), progress was persisted as "next round, already
  solved". The next `startSheepRound` resumed straight into a finished board, completed itself, and
  cascaded into the round after that. `sheepObjectsBelongTo(round)` now compares the loaded pieces'
  ids against the round's, and both progress-saving and match-scoring sit out the window where they
  disagree.
- **Roll (Z) was unreachable on a Swedish keyboard.** It was bound to `[` and `]`, which are AltGr+8
  and AltGr+9 on that layout. Roll is now on the **scroll wheel** over the canvas (non-passive
  listener, so the dialog never scrolls instead), on **Q / E**, and still on Shift + drag and the
  bracket keys. The buttons read `↺ Q` / `E ↻`.

- **A shadow that looked right could still be refused.** The magnet only pulled the *selected*
  piece, so a player who eyeballed all four into place was never locked in. Measured: on the anchor,
  four pieces within 0.10 rad of their solutions scored IoU 0.75 against a 0.75 threshold — a fail
  on a shadow that reads as correct. Every piece inside the snap radius now settles; the return
  value still reports the active piece because that is what the hold timer keys on.
- **Settled pieces are marked in the chip strip** (`✓`, green border). The click and the flash are
  easy to miss, and without a standing record the player cannot tell which pieces are already home.
  The strip re-renders only when the settled set actually changes, not once per frame.

- **Replay was a dead end.** Finishing a replay deliberately schedules nothing and leaves
  `sheepGameRound` on the replayed round (two existing tests pin that down). But the story round's
  chip is locked, so the only way back was closing and reopening the dialog. There is now an
  explicit **↩ Tillbaka till berättelsen** control, shown only while a replay is running. It stays a
  user action rather than an automatic jump so replaying several rounds in a row still works.
- **Self-heal for a stuck board.** Skipping the match while round and pieces disagree is right for
  the 650ms hand-over, but a permanent disagreement would mean the round could never be scored and
  the player would sit in an unwinnable puzzle that gates the rest of the adventure. After 1.5s of
  mismatch the round is re-dealt. `setState` is synchronous in this runtime so no current path can
  trigger it; it is there so a future one cannot hang the game silently.

## Test Results

- Targeted: `node --test test/sheep-game.test.mjs` — **53/53 passing**, exit 0.
- Full suite: `npm test` — **106/106 passing**, exit 0.

Four regression tests were added for the bugs above, and each was checked against the broken code
rather than only the fixed code:

- reverting the `sheepObjectsBelongTo` guard fails *progress is not persisted for a round whose
  pieces have not been dealt yet*;
- reverting the snap to active-only fails *every piece inside the snap radius settles, not only the
  selected one*;
- reverting the story-round restore fails *leaving a replay returns to the first unsolved story
  round*.

The Z key bindings are still only asserted as source matches and were verified in the browser.

Note: this file previously recorded a pre-existing `npm test` failure (`the game exposes an agent
for every visible character`, which asserted hard-coded `<option value="moon">` markup against a
chat picker that renders from an `sc-for` loop). That test was updated to match the loop by
concurrent work in this repo during this sprint, not by anything here. The suite also grew from 80
to 94 tests over the same window as `test/otter-atelier.test.mjs` and `test/seal-game.test.mjs`
landed. The sheep work coexists with those changes; all five test files pass together.

## Browser Evidence (Chromium)

Driven against the running `npm start` server with `playwright-cli`.

- All four rounds solved through the real match loop at 1440×900: each round *starts* unsolved
  (`pass: false`, poses equal to its own scramble) and has to be solved; gallery recorded
  `[lighthouse, sailboat, anchor, fish]` all pure, `sheepRevealed` true.
- Roll verified on all four inputs: holding `Q` and `E` rotates and releases cleanly, the wheel over
  the canvas rolls without scrolling the dialog (`scrollTop` stays 0), and Shift + drag still rolls.
- Reopen → Fri skugga → close: `sheepGameRAF` null and `sheepCanvasEl` null. Clean teardown.
- Hover picks the piece under the cursor (`Lös bricka`, cursor `pointer`) and clears to `grab` off
  the pieces. Canvas click selects the hovered piece; the following drag rotates it and the release
  coast settles instead of hitting the angle limits.
- HiDPI: with `devicePixelRatio` forced to 2 the canvas, wall texture and outline layer all size to
  2000×1220 and render without doubling or offset. 109 fps.
- 1280×720: dialog is 685px tall and does not scroll.
- Frame pacing is identical at `devicePixelRatio` 1 and 2 (median 8.3ms, p95 8.6ms, 120fps cap in
  both), so rendering at device resolution costs nothing measurable. Timing the canvas calls in JS
  was not used for this — those are queued, so they measure command submission, not rasterisation.
- Assist paths re-verified after the redesign: `Vink` reports the axis without touching the pose or
  the assist flag; `Ställ in skuggan` records the round as assisted (`pure: false`); `Återställ`
  returns to the scramble and clears saved progress; an unassisted replay upgrades ✓ to ★ without
  advancing the story or re-revealing the sheep.
- Console across a full playthrough: **0 errors**, 1 warning (the pre-existing autoplay notice).
- The otter atelier and seal game added concurrently still resolve on the logic prototype
  (`openOtterAtelier`, `openSealGame`) with the sheep game loaded.

## Notes

- `sheepDrawTargetGhost(ctx, mask, rawAlpha)` and `sheepDrawBestGhost` keep `mask` in their
  signatures — the ghost and the matcher have to agree on what the target is — but draw from the
  vector polygons cached in the same frame, which is the only way to get a smooth edge.
- `sheepLimbFacesFor` derives prism faces from `limb.sides`; legacy eight-vertex box limbs (still
  produced by Fri skugga's generator) fall back to the fixed `sheepLimbFaces` topology.
- The matcher records `sheepBestPoses` rather than calling into rendering; the renderer rebuilds the
  best-attempt polygons at draw time.

## Files Modified

- `project/Adventure Scene.dc.html` — sheep-specific geometry, contract, rendering, interaction,
  and dialog layout only.
- `SPRINT_STATUS.md` — updated to the shipped state.
