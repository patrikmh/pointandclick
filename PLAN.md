# Plan: Shadowmatic-style redesign of the sheep mini-game

## Context
The game is served by `server.mjs`, while its UI and game logic live primarily in `project/Adventure Scene.dc.html` on the existing DC runtime. The current uncommitted sheep mini-game already opens from the loaded-flashlight/cave interaction and uses one responsive canvas, two rounds, selectable chips, arrow-key rotation, mask-based matching, and lifecycle cleanup. However, it renders flat 2D point polygons as black silhouettes, shows no illuminated objects between the viewer and wall, and repeats a starfish target in both rounds. A browser inspection at 1440×900 confirmed that the scene reads as one flat cutout rather than the volumetric, twisted found-object sculpture in `/tmp/Shadowmatic-010.png`.

This redesign will retain the current mini-game entry/exit flow and lightweight canvas architecture while replacing the sheep-specific geometry, rendering, round data, matching contract, and player-facing copy. Round 1 must resolve to one seagull outline and round 2 to one sailboat outline. Several independently selectable, genuinely non-planar organic/junk pieces must remain visible in front of the wall and jointly cast one crisp, recognizable shadow.

## Architecture Decisions
- Keep the redesign inside the existing DC component and browser canvas pipeline; do not add Three.js, Babylon.js, a new application framework, or another heavyweight runtime. Native canvas/browser capabilities and deterministic game data are sufficient for this focused scene.
- Represent every manipulated piece as genuinely non-planar geometry with surface information, not as a target outline subjected to 2D scaling. The visible-object render and cast-shadow/matching calculation must derive from the same pose and light/camera model so player feedback cannot disagree with completion logic.
- Define both rounds as deterministic data with explicit target identity, object set, scramble state, legal control bounds, and at least one known solution pose. This makes order, solvability, and regression behavior contract-testable.
- Preserve the loaded-flashlight cave entry, sheep reveal, reset/unmount cleanup, current Swedish UI convention, and all unrelated working-tree edits. Limit surgical changes in the large HTML file to sheep-specific template/state/rendering/bindings unless integration requires a minimal adjacent edit.
- Use the built-in Node test runner for deterministic unit/contract coverage. Use `playwright-cli` against `npm start` for visual and interaction evidence; no browser-test dependency needs to be added to `package.json`.

## Sprint Overview
| Sprint | Name | Features | Depends on |
|--------|------|----------|------------|
| 1 | Volumetric two-round shadow sculpture | Non-planar pieces, shared light/wall rendering, selection and rotation, seagull then sailboat targets, deterministic matching/solutions, lifecycle and visual verification | - |

## Sprint 1: Volumetric two-round shadow sculpture
**Scope:** Replace only the sheep mini-game presentation and puzzle contract so it evokes the Shadowmatic reference while preserving its existing place in the adventure. This is the final sprint and includes unit, contract, and end-to-end browser integration verification.

**Files to create/modify:**
- Modify `project/Adventure Scene.dc.html` only in the sheep mini-game template, state/configuration, geometry/rendering/matching, interaction, render bindings, and directly related lifecycle integration.
- Create `test/sheep-game.test.mjs` for deterministic unit and contract tests using the repository’s existing `node:test` conventions.
- Do not modify `package.json`, `server.mjs`, `project/support.js`, `project/ai-bridge.js`, other mini-games, or unrelated local assets/changes.

**Acceptance criteria:**
1. Each round displays at least three illuminated, independently identifiable organic/junk sculpture pieces in front of a wall; every piece is backed by non-planar geometry and visibly shows thickness, changing face lighting/foreshortening, and self/peer occlusion as it rotates rather than behaving like a flat target-shaped cutout.
2. The player can select any displayed piece through the visible UI and rotate the selected piece on two axes with the documented controls; selection is unambiguous, only the selected pose changes, and both the visible piece and its contribution to the wall shadow update continuously.
3. All round pieces contribute through one light model to exactly one crisp combined wall-shadow silhouette at the solved pose; no individual piece alone can satisfy the target, and matching penalizes both missing target area and excess spill so a large blanket shape cannot pass.
4. The only target sequence is round 1 `seagull` (one seagull outline) followed by round 2 `sailboat` (one sailboat outline); the old starfish/anchor/shell/driftwood target copy is absent, round 2 cannot begin before round 1 succeeds, and sheep reveal occurs only after round 2 succeeds.
5. Both rounds are deterministically solvable: their declared solution poses are inside player control bounds and pass the same production matcher, their declared scramble poses fail it, and each round can be completed through the real selection/rotation/completion path without direct completion-state mutation.
6. `test/sheep-game.test.mjs` has automated unit/contract tests for non-planar geometry, active-object manipulation, one-component combined shadows, anti-blanket matching, exact sequence/progression, known scramble/solution poses, and close/reset teardown; `node --test test/sheep-game.test.mjs` passes. Running `npm test` introduces no failures beyond the already-observed unrelated `missing moon chat option` baseline failure.
7. Browser integration at 1440×900 through the existing loaded-flashlight/cave flow produces the required screenshot/evidence set for both rounds, completes to the normal sheep reveal, and records zero page errors or console errors during open, selection, rotation, round transition, completion, close, and reopen.

**Entry conditions:**
- Existing working tree is preserved, including the uncommitted sheep mini-game and loaded-flashlight recipe/entry work in `project/Adventure Scene.dc.html`.
- `npm start` serves the game at `http://127.0.0.1:3000` (or an explicitly selected free port), and `/tmp/Shadowmatic-010.png` is available as the visual reference.
- Baseline `npm test` result is recorded as 20 passing and one unrelated failing assertion: `missing moon chat option`.

**Exit conditions:**
- All seven criteria above pass with the automated and visual evidence specified in `SPRINT_CONTRACT.md`.
- The sheep mini-game completes seagull → sailboat → sheep reveal without errors, while unrelated behavior and dirty working-tree content remain intact.
- No new production dependency or unrelated refactor has been introduced.

## Risks and Assumptions
- “Like Shadowmatic” is treated as a visual-depth contract, not a demand for photorealistic parity: evidence must show non-planar forms, surface lighting, foreshortening, occlusion, separation from the wall, and one crisp cast shadow.
- The source reference is JPEG XL, but `/tmp/Shadowmatic-010.png` is the grading preview; no runtime use or conversion of the reference is required.
- The current HTML is large and already modified. Builders must inspect the live diff and edit sheep-specific regions surgically rather than replacing the file or resetting unrelated hunks.
- The repository starts with one unrelated failing test. It is out of scope to rewrite the chat/persona behavior or hide that failure; evaluation distinguishes the targeted green test command from the documented baseline.
