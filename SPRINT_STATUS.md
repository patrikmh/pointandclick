# Sprint Status: Volumetric shadow sculpture (Bäärnts skuggteater)

## Shipped

- **Volumetric rendering and interaction** — non-planar eight-vertex/eight-face meshes, material palettes with
  changing face light, perspective/foreshortening, depth-sorted self-occlusion, foreground sculpture overlap,
  three-axis poses, combined crisp wall masks, bidirectional recall/precision/IoU matching, pointer-drag rotation,
  a camera-only orbit inspector, a match-driven hum, and full teardown.
- **Four-round story progression** — `seagull` (Fiskmås) → `sailboat` (Segelbåt) → `anchor` (Ankare) →
  `crab` (Krabba), each with legal deterministic scramble/solution poses, per-round thresholds, and a red-herring
  piece. Later rounds reuse limb geometry from the earlier piece pool. The sheep reveal fires once, after the
  final round only.
- **Fri skugga practice mode** — a deterministic seeded generator that produces a self-consistent practice round.
  Standalone: it cannot advance the story sequence or write the solved gallery.
- **Resume on reopen** — mid-round poses persist to `localStorage` and are restored for a matching round.
  Reopening skips completed rounds; malformed or obsolete saved progress falls back to the first unsolved round.
- **Keyboard accessibility** — labelled `role="dialog"`, focusable canvas, an `aria-live` status for the active
  piece and match proximity, native Tab navigation (never suppressed), Escape to close with full cleanup, and
  visible focus rings. The whole control set fits a 1280×720 viewport.
- **Honest assistance** — `Vink` reports which axis needs which way *without* mutating any pose. Only
  `Ställ in skuggan` changes a pose, and using it records the round as assisted (✓) rather than pure (★).
  Provenance survives save/reopen; legacy bare-string gallery entries load as assisted.
- **Replay for a pure star** — solved gallery chips are buttons. Replaying a round clears saved progress, resets
  the assist flag, and on completion upgrades ✓ → ★ without advancing the story or re-revealing the sheep.
  An assisted replay never downgrades an existing ★.
- **Accessibility preferences** — target-ghost brightness (Låg / Normal / Hög) and a colourblind-safe palette that
  moves the target ghost from mint to amber and the pass readout from green to blue. Both persist across sessions
  and are applied on open. Neither touches pose, matching, or story state.
- **Swing-aware target-mask cache** — the matcher and the renderer share one target-mask build per frame. The
  cache key includes the light swing, so a moving light always rebuilds and the ghost can never lag the live
  shadow.

## Test Results

- Targeted: `node --test test/sheep-game.test.mjs` — **41/41 passing**, exit 0.
- Full suite: `npm test` — **61/62 passing**. The sole failure is the pre-existing, out-of-scope
  `missing moon chat option` assertion in `test/game-ui.test.mjs:25`, unchanged from the recorded baseline.

## Browser Evidence (Chromium, 1280×720)

Driven against the running `npm start` server with `playwright-cli`.

- Dialog renders inside the viewport with all controls reachable: 20 focusable elements in the dialog.
- Gallery chips render and label correctly: `✓ Fiskmås` ("löst med assistans — spela om för en ren stjärna"),
  `★ Segelbåt`, and `○ Ankare` / `○ Krabba` disabled.
- Clicking the assisted `✓ Fiskmås` chip enters replay: round 1, `sheepReplayActive=true`,
  `sheepUsedFullAssistThisRound=false`, poses back at the scramble.
- Solving that replay through the real match loop (no assist) upgraded the gallery to
  `[{"id":"seagull","pure":true},{"id":"sailboat","pure":true}]` while `sheepGameRound` stayed at 1 and
  `sheepRevealed` stayed `false` — no story advance, no second reveal.
- Both accessibility controls toggle and persist: `{"ghostBrightness":1.6,"colorblind":true}` written to
  `sheepAccessibilitySettings` and restored after close → reopen. The colourblind palette resolves to
  `{target:"247,181,41", best:"96,158,255", pass:"#7fc3ff"}` and the amber target ghost is visibly rendered.
- Escape closes the dialog; the mask cache is cleared on teardown and rebuilt on the next open.
- Console: **0 errors**. One pre-existing autoplay warning (`AudioContext was not allowed to start`), which is a
  browser gesture policy notice, not a game fault.

## Notes

- The browser session drove the dialog through the component's public entry points rather than replaying the full
  battery → flashlight → cave adventure each time; the cave entry itself is unchanged.
- `sheepBeginSession()` was extracted from `openSheepGame` / `sheepStartFreeRound` / `sheepReplayRound`, which
  otherwise would have carried three copies of the same listener/RAF/hum setup.
- The unrelated `missing moon chat option` failure is explicitly out of scope and was left untouched.

## Files Modified

- `project/Adventure Scene.dc.html` — sheep-specific template, state, geometry, matching, rendering, controls,
  progression, and lifecycle only.
- `test/sheep-game.test.mjs` — 41 deterministic unit/contract tests.
- `SPRINT_STATUS.md`, `SPRINT_CONTRACT.md` — updated to the shipped state.
