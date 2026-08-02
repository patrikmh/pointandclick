import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gamePath = join(projectRoot, "project", "Adventure Scene.dc.html");
const source = await readFile(gamePath, "utf8");

function loadMethod(signature, nextSignature, context = {}) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);

  assert.notEqual(start, -1, `missing production method: ${signature.trim()}`);
  assert.notEqual(end, -1, `missing method boundary: ${nextSignature.trim()}`);

  const methodSource = source.slice(start, end).trim();
  const methodName = signature.match(/([\w$]+)\s*\(/)?.[1];
  return vm.runInNewContext(`({${methodSource}}).${methodName}`, context);
}

// ── Gating: modal opens only when both items are present ──────────────────

test("repairOctopus opens the mini-game when both driftwood and fishline are available", () => {
  const repair = loadMethod("  repairOctopus(defId) {", "\n  octoGameConfig = {");
  let opens = 0;
  let said = null;
  const game = {
    state: {
      octoHealed: false,
      inventory: [{ iid: "w1", defId: "driftwood" }, { iid: "f1", defId: "fishline" }],
    },
    say: (speaker, text) => { said = { speaker, text }; },
    _guideOrOpen: (key, proceed) => proceed(),
    openOctoGame: () => { opens += 1; },
  };

  repair.call(game, "driftwood");
  assert.equal(opens, 1);
  assert.equal(said, null);
});

test("repairOctopus shows a hint when only one of the two items is present", () => {
  const repair = loadMethod("  repairOctopus(defId) {", "\n  octoGameConfig = {");
  let opens = 0;
  let said = null;
  const game = {
    state: {
      octoHealed: false,
      inventory: [{ iid: "w1", defId: "driftwood" }],
    },
    say: (speaker, text) => { said = { speaker, text }; },
    openOctoGame: () => { opens += 1; },
  };

  repair.call(game, "driftwood");
  assert.equal(opens, 0);
  assert.equal(said.speaker, "Bläckfisken");
  assert.match(said.text, /något långt och starkt att binda/);
});

test("repairOctopus refuses when already healed", () => {
  const repair = loadMethod("  repairOctopus(defId) {", "\n  octoGameConfig = {");
  let opens = 0;
  let said = null;
  const game = {
    state: {
      octoHealed: true,
      inventory: [{ iid: "w1", defId: "driftwood" }, { iid: "f1", defId: "fishline" }],
    },
    say: (speaker, text) => { said = { speaker, text }; },
    openOctoGame: () => { opens += 1; },
  };

  repair.call(game, "driftwood");
  assert.equal(opens, 0);
  assert.match(said.text, /Redan förstklassigt reparerad/);
});

// ── Phase 0: tentacle selection ───────────────────────────────────────────

test("phase 0 only accepts tentacles 3 and 4 and advances when both are selected", () => {
  const toggle = loadMethod("  octoToggleTentacle(idx) {", "\n  octoRotateSplint(i, delta) {");
  const msgs = ["a", "b", "c", "d"];
  const a11y = ["1", "2", "3", "4"];
  let advanceCalls = [];
  const game = {
    state: {
      octoGamePhase: 0,
      octoGameDone: false,
      octoGameTentacles: [false, false, false, false],
    },
    octoGameMsgs: () => msgs,
    octoGameA11yForPhase: (p) => a11y[p],
    octoAdvancePhase: (p) => { advanceCalls.push(p); },
    setState(up) { this.state = { ...this.state, ...(typeof up === "function" ? up(this.state) : up) }; },
  };

  // Clicking tentacle 1 (idx 0) should be rejected.
  toggle.call(game, 0);
  assert.equal(advanceCalls.length, 0);
  assert.match(game.state.octoGameMsg, /Den tentakeln är oskadd/);

  // Select tentacle 3 (idx 2).
  game.state.octoGameTentacles = [false, false, false, false];
  toggle.call(game, 2);
  assert.deepEqual(game.state.octoGameTentacles, [false, false, true, false]);
  assert.equal(advanceCalls.length, 0);

  // Select tentacle 4 (idx 3) → should advance.
  toggle.call(game, 3);
  assert.deepEqual(advanceCalls, [1]);
});

// ── Phase 1: splint alignment ─────────────────────────────────────────────

test("phase 1 marks splints aligned within tolerance and advances when both are done", () => {
  const rotate = loadMethod("  octoRotateSplint(i, delta) {", "\n  octoClickAnchor(i) {");
  const msgs = ["a", "b", "c", "d"];
  const a11y = ["1", "2", "3", "4"];
  let advanceCalls = [];
  const game = {
    octoGameConfig: { splintTargets: [0, 0], splintTolerance: 12, splintStep: 11 },
    state: {
      octoGamePhase: 1,
      octoGameDone: false,
      octoGameSplints: [{ rot: 10, aligned: false }, { rot: -10, aligned: false }],
    },
    octoGameMsgs: () => msgs,
    octoGameA11yForPhase: (p) => a11y[p],
    octoAdvancePhase: (p) => { advanceCalls.push(p); },
    setState(up) { this.state = { ...this.state, ...(typeof up === "function" ? up(this.state) : up) }; },
  };

  // Rotate splint 0 to 0.
  rotate.call(game, 0, -11);
  assert.ok(Math.abs(game.state.octoGameSplints[0].rot) <= 12);
  assert.equal(game.state.octoGameSplints[0].aligned, true);
  assert.equal(advanceCalls.length, 0);

  // Rotate splint 1 to 0.
  rotate.call(game, 1, 11);
  assert.equal(advanceCalls.length, 1);
  assert.deepEqual(advanceCalls, [2]);
});

test("octoAdvancePhase switches the patient art to splinted once the splints are on", () => {
  const advance = loadMethod("  octoAdvancePhase(newPhase) {", "\n  octoGameComplete() {");
  const game = {
    state: { octoFrame: "open" },
    octoGameMsgs: () => ["a", "b", "c", "d"],
    octoGameA11yForPhase: () => "",
    setState(up) { this.state = { ...this.state, ...(typeof up === "function" ? up(this.state) : up) }; },
  };

  advance.call(game, 1);
  assert.equal(game.state.octoFrame, "splinted");

  advance.call(game, 0);
  assert.equal(game.state.octoFrame, "open");
});

// ── Phase 2: ordered anchor clicking ──────────────────────────────────────

test("phase 2 requires anchors in order and resets on wrong order", () => {
  const click = loadMethod("  octoClickAnchor(i) {", "\n  octoRopeStart(i, e) {");
  const msgs = ["a", "b", "c", "d"];
  const a11y = ["1", "2", "3", "4"];
  let advanceCalls = [];
  const game = {
    octoGameConfig: { anchorCount: 3 },
    state: {
      octoGamePhase: 2,
      octoGameDone: false,
      octoGameAnchors: [false, false, false],
    },
    octoGameMsgs: () => msgs,
    octoGameA11yForPhase: (p) => a11y[p],
    octoAdvancePhase: (p) => { advanceCalls.push(p); },
    setState(up) { this.state = { ...this.state, ...(typeof up === "function" ? up(this.state) : up) }; },
  };

  // Clicking anchor 2 before 1 should reset.
  click.call(game, 1);
  assert.equal(game.state.octoGameAnchors.filter(Boolean).length, 0);
  assert.match(game.state.octoGameMsg, /Fel ordning/);

  // Click in correct order: 0, 1, 2.
  click.call(game, 0);
  assert.equal(game.state.octoGameAnchors[0], true);
  assert.equal(game.state.octoGameAnchors[1], false);
  click.call(game, 1);
  assert.equal(game.state.octoGameAnchors[1], true);
  click.call(game, 2);
  assert.deepEqual(advanceCalls, [3]);
});

// ── Phase 3: tension hold ─────────────────────────────────────────────────

test("phase 3 loop accumulates hold time inside the band and completes when threshold reached", () => {
  const loop = loadMethod("  octoGameLoop(ts) {", "\n  octoAdvancePhase(newPhase) {", {
    requestAnimationFrame: () => {},
  });
  const msgs = ["a", "b", "c", "d"];
  const a11y = ["1", "2", "3", "4"];
  let completed = 0;
  const game = {
    octoGameConfig: {
      tensionBandMin: 60, tensionBandMax: 80,
      tensionRisePerSec: 70, tensionDecayPerSec: 95,
      tensionHoldNeeded: 1.6,
    },
    octoGameRunning: true,
    octoGameLastTs: null,
    octoGameHoldingNow: true,
    octoGameRAF: null,
    requestAnimationFrame: () => {},
    state: {
      octoGamePhase: 3,
      octoGameDone: false,
      octoGameTension: 70,
      octoGameTensionHold: 0,
      octoGameOpen: true,
    },
    octoGameMsgs: () => msgs,
    octoGameA11yForPhase: (p) => a11y[p],
    octoGameComplete: () => { completed += 1; },
    setState(up) {
      const next = typeof up === "function" ? up(this.state) : up;
      this.state = { ...this.state, ...next };
    },
  };

  // The first frame establishes the timestamp; the next frame advances time.
  loop.call(game, 100);
  loop.call(game, 150);
  assert.ok(game.state.octoGameTensionHold > 0);
  assert.equal(completed, 0);

  // Jump hold past threshold to trigger completion.
  game.state.octoGameTensionHold = 1.56;
  loop.call(game, 200);
  assert.equal(completed, 1);
});

test("phase 3 tension decays when not holding", () => {
  const loop = loadMethod("  octoGameLoop(ts) {", "\n  octoAdvancePhase(newPhase) {", {
    requestAnimationFrame: () => {},
  });
  const game = {
    octoGameConfig: {
      tensionBandMin: 60, tensionBandMax: 80,
      tensionRisePerSec: 70, tensionDecayPerSec: 95,
      tensionHoldNeeded: 1.6,
    },
    octoGameRunning: true,
    octoGameLastTs: null,
    octoGameHoldingNow: false,
    octoGameRAF: null,
    requestAnimationFrame: () => {},
    state: {
      octoGamePhase: 3,
      octoGameDone: false,
      octoGameTension: 50,
      octoGameTensionHold: 0,
      octoGameOpen: true,
    },
    setState(up) {
      const next = typeof up === "function" ? up(this.state) : up;
      this.state = { ...this.state, ...next };
    },
  };

  const before = game.state.octoGameTension;
  loop.call(game, 100);
  loop.call(game, 150);
  assert.ok(game.state.octoGameTension < before, "tension must decay when not holding");
});

// ── One-time consume and octoHealed ───────────────────────────────────────

test("octoGameComplete consumes exactly one driftwood and one fishline, sets octoHealed once", () => {
  const complete = loadMethod("  octoGameComplete() {", "\n  octoGamePrefersReducedMotion() {");
  let tornDown = 0;
  let said = null;
  const game = {
    octoGameConfig: { tensionHoldNeeded: 1.6 },
    octoNode: null,
    state: {
      octoGameDone: false,
      octoHealed: false,
      inventory: [
        { iid: "w1", defId: "driftwood" },
        { iid: "f1", defId: "fishline" },
        { iid: "w2", defId: "driftwood" },
        { iid: "f2", defId: "fishline" },
      ],
    },
    octoGameMsgs: () => ["a", "b", "c", "d"],
    octoGameA11yForPhase: () => "",
    teardownOctoGame: () => { tornDown += 1; },
    say: (speaker, text) => { said = { speaker, text }; },
    setState(up) {
      const next = typeof up === "function" ? up(this.state) : up;
      this.state = { ...this.state, ...next };
    },
  };

  complete.call(game);

  assert.equal(tornDown, 1);
  assert.equal(game.state.octoHealed, true);
  assert.equal(game.state.octoGameDone, true);
  assert.equal(game.state.octoGameOpen, false);
  assert.equal(game.state.octoGameProgress, 100);

  const wood = game.state.inventory.filter((i) => i.defId === "driftwood");
  const line = game.state.inventory.filter((i) => i.defId === "fishline");
  assert.equal(wood.length, 1, "exactly one driftwood consumed");
  assert.equal(line.length, 1, "exactly one fishline consumed");
});

test("octoGameComplete is idempotent — calling twice does not consume twice", () => {
  const complete = loadMethod("  octoGameComplete() {", "\n  octoGamePrefersReducedMotion() {");
  let tornDown = 0;
  const game = {
    state: {
      octoGameDone: true,
      octoHealed: true,
      inventory: [{ iid: "w1", defId: "driftwood" }],
    },
    teardownOctoGame: () => { tornDown += 1; },
    setState(up) {
      const next = typeof up === "function" ? up(this.state) : up;
      this.state = { ...this.state, ...next };
    },
    say: () => {},
  };

  complete.call(game);
  assert.equal(tornDown, 0, "already done — must not teardown or consume again");
  assert.equal(game.state.inventory.length, 1);
});

// ── Reset: reopening preserves items and resets progress ──────────────────

test("openOctoGame tears down previous session and resets phase without consuming items", () => {
  const open = loadMethod("  openOctoGame() {", "\n  closeOctoGame() {", {
    clearInterval: () => {},
    clearTimeout: () => {},
  });
  let tornDown = 0;
  const game = {
    octoGameConfig: {
      splintTargets: [0, 0],
      anchorCount: 3,
    },
    octoGameMsgs: () => ["a", "b", "c", "d"],
    octoGameA11yForPhase: () => "",
    teardownOctoGame: () => { tornDown += 1; },
    setState(up) {
      const next = typeof up === "function" ? up(this.state) : up;
      this.state = { ...this.state, ...next };
    },
    state: {
      octoGameOpen: false,
      octoGamePhase: 3,
      octoGameProgress: 90,
      inventory: [{ iid: "w1", defId: "driftwood" }, { iid: "f1", defId: "fishline" }],
    },
  };

  open.call(game);

  assert.equal(tornDown, 1);
  assert.equal(game.state.octoGameOpen, true);
  assert.equal(game.state.octoGamePhase, 0);
  assert.equal(game.state.octoGameProgress, 0);
  assert.equal(game.state.octoGameDone, false);
  assert.equal(game.state.octoFrame, "open");
  // Items preserved.
  assert.equal(game.state.inventory.length, 2);
  assert.equal(game.state.inventory.filter((i) => i.defId === "driftwood").length, 1);
  assert.equal(game.state.inventory.filter((i) => i.defId === "fishline").length, 1);
});

test("closeOctoGame tears down, closes, and preserves items", () => {
  const close = loadMethod("  closeOctoGame() {", "\n  teardownOctoGame() {");
  let tornDown = 0;
  const game = {
    teardownOctoGame: () => { tornDown += 1; },
    setState(up) { this.state = { ...this.state, ...(typeof up === "function" ? up(this.state) : up) }; },
    state: {
      octoGameOpen: true,
      octoGameHolding: true,
      octoGamePhase: 2,
      inventory: [{ iid: "w1", defId: "driftwood" }, { iid: "f1", defId: "fishline" }],
    },
  };

  close.call(game);

  assert.equal(tornDown, 1);
  assert.equal(game.state.octoGameOpen, false);
  assert.equal(game.state.octoGameHolding, false);
  assert.equal(game.state.inventory.length, 2);
});

test("teardownOctoGame cancels RAF and removes listeners", () => {
  const teardown = loadMethod("  teardownOctoGame() {", "\n  initOctoGameStage(el) {");
  let rafCancelled = 0;
  let keyDownRemoved = 0;
  let keyUpRemoved = 0;
  const game = {
    octoGameRAF: {},
    _octoGameKeyDown: () => {},
    _octoGameKeyUp: () => {},
    cancelAnimationFrame: () => { rafCancelled += 1; },
    document: {
      removeEventListener: (type) => {
        if (type === "keydown") keyDownRemoved += 1;
        if (type === "keyup") keyUpRemoved += 1;
      },
    },
  };
  // Patch global document in the vm context.
  const ctx = { document: game.document, cancelAnimationFrame: game.cancelAnimationFrame };
  const teardownWithContext = loadMethod("  teardownOctoGame() {", "\n  initOctoGameStage(el) {", ctx);

  teardownWithContext.call(game);

  assert.equal(rafCancelled, 1);
  assert.equal(keyDownRemoved, 1);
  assert.equal(keyUpRemoved, 1);
  assert.equal(game.octoGameRAF, null);
  assert.equal(game.octoGameRunning, false);
  assert.equal(game._octoGameKeyDown, null);
  assert.equal(game._octoGameKeyUp, null);
});

// ── Keyboard handling ─────────────────────────────────────────────────────

test("Escape closes the octo game even when focus is elsewhere", () => {
  const keyDown = loadMethod("  octoGameKeyDown(e) {", "\n  octoGameKeyUp(e) {");
  let closes = 0;
  let prevented = 0;
  const game = {
    state: { octoGameOpen: true, octoGamePhase: 0 },
    octoGameConfig: { splintStep: 11 },
    closeOctoGame: () => { closes += 1; },
    setState: () => {},
  };
  const event = (key, target = {}) => ({ key, target, preventDefault() { prevented += 1; } });

  keyDown.call(game, event("Escape", {}));
  assert.equal(closes, 1);
  assert.ok(prevented >= 1);
});

test("arrow keys rotate splints during phase 1", () => {
  const keyDown = loadMethod("  octoGameKeyDown(e) {", "\n  octoGameKeyUp(e) {");
  let rotates = [];
  let prevented = 0;
  const game = {
    state: { octoGameOpen: true, octoGamePhase: 1, octoGameSplints: [{ rot: 30 }, { rot: -30 }] },
    octoGameConfig: { splintStep: 11 },
    octoRotateSplint: (i, d) => { rotates.push([i, d]); },
    closeOctoGame: () => {},
    setState: () => {},
  };
  const event = (key) => ({ key, target: {}, preventDefault() { prevented += 1; } });

  keyDown.call(game, event("ArrowLeft"));
  assert.deepEqual(rotates[0], [0, -11]);
  keyDown.call(game, event("ArrowRight"));
  assert.deepEqual(rotates[1], [0, 11]);
  keyDown.call(game, event("ArrowUp"));
  assert.deepEqual(rotates[2], [1, -11]);
  keyDown.call(game, event("ArrowDown"));
  assert.deepEqual(rotates[3], [1, 11]);
  assert.ok(prevented >= 4);
});

test("space or enter starts tension hold during phase 3", () => {
  const keyDown = loadMethod("  octoGameKeyDown(e) {", "\n  octoGameKeyUp(e) {");
  const keyUp = loadMethod("  octoGameKeyUp(e) {", "\n  octoToggleTentacle(idx) {");
  let prevented = 0;
  const states = [];
  const game = {
    state: { octoGameOpen: true, octoGamePhase: 3 },
    octoGameConfig: { splintStep: 11 },
    octoGameHoldingNow: false,
    closeOctoGame: () => {},
    setState(up) {
      states.push(up);
      this.state = { ...this.state, ...up };
    },
  };
  const event = (key) => ({ key, target: {}, preventDefault() { prevented += 1; } });

  keyDown.call(game, event(" "));
  assert.equal(game.octoGameHoldingNow, true);
  assert.equal(states[0].octoGameHolding, true);

  keyUp.call(game, event(" "));
  assert.equal(game.octoGameHoldingNow, false);
});

// ── Accessibility: dialog semantics, progress bar, live status ────────────

test("modal has dialog role, progress bar, and live status with Swedish labels", () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="octo-game-title" aria-describedby="octo-game-help octo-game-status"/);
  assert.match(source, /id="octo-game-title"/);
  assert.match(source, /id="octo-game-help"/);
  assert.match(source, /id="octo-game-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /role="progressbar" aria-label="Tentakeltriage framsteg" aria-valuenow="\{\{ octoGameProgress \}\}"/);
  assert.match(source, /role="application" aria-label="Tentakeltriage spelplan"/);
  assert.match(source, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter Escape"/);
  assert.match(source, /aria-label="Stäng tentakeltriagen"/);
});

test("bandage tension meter exposes a meter role with live value", () => {
  assert.match(source, /role="meter" aria-label="Bandagespänning" aria-valuenow="\{\{ octoGameTensionDisplay \}\}"/);
});

test("tentacle selection and mouse-guided rope points expose interaction state", () => {
  assert.match(source, /aria-pressed="\{\{ tc.selected \}\}"/);
  assert.match(source, /aria-pressed="\{\{ ac.done \}\}"/);
  assert.match(source, /onPointerDown="\{\{ ac.start \}\}"/);
  assert.match(source, /onPointerEnter="\{\{ ac.enter \}\}"/);
  assert.match(source, /assets\/tentacle-placeholder\.svg/);
  assert.match(source, /octoRopeSegments/);
  assert.match(source, /octoCompletedRopeWraps/);
  assert.match(source, /octoBandagePointerStyle/);
  assert.match(source, /octoReactionText/);
  assert.match(source, /onPointerMove="\{\{ octoRopeMove \}\}"/);
  assert.match(source, /octoBandageMove/);
  assert.match(source, /octoBandageTurns/);
  assert.match(source, /octoTentacleChips/);
  assert.match(source, /octoSplintChips/);
  assert.match(source, /octoAnchorChips/);
});

// ── Config and source structure ───────────────────────────────────────────

test("octo game config defines four phases with balanced thresholds", () => {
  assert.match(source, /phases: 4/);
  assert.match(source, /splintTargets: \[0, 0\]/);
  assert.match(source, /splintTolerance: 12/);
  assert.match(source, /anchorCount: 7/);
  assert.match(source, /tensionBandMin: 60/);
  assert.match(source, /tensionBandMax: 80/);
  assert.match(source, /tensionHoldNeeded: 1\.6/);
});

test("teardownOctoGame is wired into componentWillUnmount and reset", () => {
  assert.match(source, /this\.teardownOctoGame\(\);/);
  const teardownCount = (source.match(/this\.teardownOctoGame\(\);/g) || []).length;
  assert.ok(teardownCount >= 4, "teardownOctoGame must be called from open, close, unmount, and reset");
});

test("repairOctopus no longer heals instantly — it delegates to openOctoGame", () => {
  // The old instant-heal block is gone from repairOctopus.
  const repairStart = source.indexOf("  repairOctopus(defId) {");
  const configStart = source.indexOf("  octoGameConfig = {");
  const repairBody = source.slice(repairStart, configStart);
  assert.doesNotMatch(repairBody, /octoHealed: true/);
  assert.match(repairBody, /this\.openOctoGame\(\)/);
});

test("four phase flags drive the modal UI sections", () => {
  assert.match(source, /octoPhaseSelect:/);
  assert.match(source, /octoPhaseSplints:/);
  assert.match(source, /octoPhaseAnchors:/);
  assert.match(source, /octoPhaseTension:/);
});
