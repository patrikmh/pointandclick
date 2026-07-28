# Sprint Status: Sprint 1 — Volumetric two-round shadow sculpture

## Completed
- [x] Volumetric rendering and interaction — non-planar eight-vertex/eight-face meshes, material palettes with changing face light, perspective/foreshortening, depth-sorted self-occlusion, foreground sculpture overlap, shared two-axis poses, combined crisp wall masks, bidirectional recall/precision/IoU matching, visible selection/rotation controls, and cleanup.
- [x] Two-round progression — exact deterministic `seagull` (`Fiskmås`) → `sailboat` (`Segelbåt`) contract, legal scramble/solution poses, normal selection/alignment/completion path, one final sheep reveal, and close/reopen safety.

## TDD Evidence
- Rendering RED: `/tmp/sheep-red.log` — 5 expected failures (missing volumetric contract/UI).
- Rendering GREEN: 6/6 targeted tests passed before progression work.
- Progression RED: `/tmp/sheep-progression-red.log` — 1 expected failure (missing production advancement path).
- Final GREEN: `node --test test/sheep-game.test.mjs` — 7/7 passing.

## Test Results
- Targeted: 7/7 passing.
- Full suite: 27/28 passing. Sole failure is the recorded unrelated baseline assertion `missing moon chat option`; no new failures.
- Final full output: `/tmp/sheep-full-final.log`.

## Browser Evidence (1440×900 Chromium)
- Reference: `/tmp/Shadowmatic-010.png`
- Round 1 unsolved: `/tmp/sheep-r1-before.png`
- Round 1 manipulated on both axes: `/tmp/sheep-r1-after-rotation.png`
- Round 1 solved: `/tmp/sheep-r1-solved.png`
- Round 2 unsolved: `/tmp/sheep-r2-before.png`
- Round 2 solved: `/tmp/sheep-r2-solved.png`
- Final sheep reveal: `/tmp/sheep-final-reveal.png`
- Pose/control/reopen logs: `/tmp/sheep-r1-pose.txt`, `/tmp/sheep-r1-solved-state.txt`, `/tmp/sheep-r2-solved-state.txt`, `/tmp/sheep-reopen-control.txt`
- Console: 0 errors (`.playwright-cli/console-2026-07-28T19-20-02-396Z.log`); autoplay-only warnings recorded separately.
- Page errors: 0 (`/tmp/sheep-page-errors.txt`).

## Notes
- Parent task IDs #2/#4/#5 were not visible in this sub-agent task namespace (`TaskList` returned no tasks), so local tracking tasks record the corresponding parent IDs in metadata.
- Existing unrelated/uncommitted changes were preserved. No dependencies, server files, other mini-games, or planner artifacts were modified.
- The user-facing `Ställ in skuggan` affordance aligns only the currently selected sculpture; players still select and align all three through normal controls. It does not mutate completion/reveal flags.

## Files Created or Modified
- Modified: `project/Adventure Scene.dc.html` (sheep-specific template, model, matching, rendering, controls, progression, lifecycle only)
- Created: `test/sheep-game.test.mjs`
- Created: `SPRINT_STATUS.md`

## Build Metrics
- Start: 2026-07-28T19:06:08Z
- End: 2026-07-28T19:21:00Z
- Duration: 15 min
- Features: 2
- Tests: 7 created, 7/7 targeted passing; 27/28 full (known baseline only)
- Files: 2 created, 1 modified
- Iteration: 1
