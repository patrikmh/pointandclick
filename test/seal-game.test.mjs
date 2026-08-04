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

test("seal photoshoot exposes modal, keyboard, progress, challenge, and live-status semantics", () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="seal-game-title" aria-describedby="seal-game-help seal-game-challenge"/);
  assert.match(source, /id="seal-game-challenge"/);
  assert.match(source, /Uppdrag \{\{ sealGameChallengeNumber \}\}\/3: \{\{ sealGameChallengePrompt \}\}/);
  assert.match(source, /class="seal-game-stage" role="application"/);
  assert.match(source, /aria-describedby="seal-game-help seal-game-challenge seal-game-status"/);
  assert.match(source, /aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Space Enter Escape"/);
  assert.match(source, /role="progressbar" aria-label="Fokus" aria-valuenow="\{\{ sealGameFocusPct \}\}"/);
  assert.match(source, /id="seal-game-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /sealGameFocusPct: S\.sealGameFocusPct/);
  assert.match(source, /sealGameA11yStatus: S\.sealGameA11yStatus/);
});

test("camera artwork has a clean silhouette over a separate full-stage vignette and guides", () => {
  const vignetteIndex = source.indexOf('data-seal-vignette="true"');
  const guideIndex = source.indexOf('data-seal-composition-guide="{{ sealGameChallengeKey }}"');
  const cameraIndex = source.indexOf('src="assets/camera-viewfinder.png"');

  assert.ok(vignetteIndex > 0);
  assert.ok(guideIndex > vignetteIndex);
  assert.ok(cameraIndex > guideIndex, "vignette and guide must sit behind the transparent camera artwork");
  assert.match(source, /data-seal-vignette="true"[^>]+inset:0[^>]+radial-gradient/);
  assert.doesNotMatch(source, /camera-viewfinder\.png[^>]+box-shadow/);
  assert.doesNotMatch(source, /box-shadow:0 0 0 2000px/);
  assert.match(source, /sealGuideCentered/);
  assert.match(source, /sealGuideThirds/);
  assert.match(source, /sealGuideAction/);
});

test("photo challenge exposes a visible stabilization affordance and safe action movement", () => {
  assert.match(source, /onClick="\{\{ sealGameStabilize \}\}"/);
  assert.match(source, /aria-label="Pausa eller återuppta sälens rörelse"/);
  assert.match(source, /if \(!this\.sealGameStabilized\)/);
  assert.match(source, /driftSpeedMin: 130/);
});

test("photo challenge config preserves balance and defines three distinct Swedish compositions", () => {
  assert.match(source, /goodShotThreshold: 70/);
  assert.match(source, /shotsToWin: 3/);
  assert.match(source, /filmPerBatch: 8/);
  assert.match(source, /key: "centered"[\s\S]*?Centrerat porträtt/);
  assert.match(source, /key: "thirds"[\s\S]*?Tredjedelsregeln/);
  assert.match(source, /key: "action"[\s\S]*?Actionbild/);
  assert.match(source, /minSpeed: 120/);
  assert.match(source, /inventory: s\.inventory\.concat\(\[\{ iid: \+\+this\.uid, defId: "battery" \}\]\)/);

  assert.match(source, /Android\|iPhone\|iPod\|Windows Phone\|Mobile/);
  assert.match(source, /window\.matchMedia\("\(pointer: coarse\)"\)/);
  assert.match(source, /Math\.min\(window\.innerWidth, window\.innerHeight\) < 700/);
});

test("seal geometry scales independently with the rendered stage dimensions", () => {
  const updateScale = loadMethod(
    "  sealGameUpdateScale() {",
    "\n  sealGameClampView() {",
  );
  const game = {
    sealGameConfig: { stageW: 760, stageH: 500 },
    sealGameStageEl: {
      getBoundingClientRect: () => ({ width: 380, height: 200 }),
    },
  };

  updateScale.call(game);

  assert.deepEqual(
    { x: game.sealGameScale.x, y: game.sealGameScale.y },
    { x: 0.5, y: 0.4 },
  );
  assert.match(source, /\(this\.sealGameView\.x - vw\) \* scale\.x/);
  assert.match(source, /\(this\.sealGameView\.y - vh\) \* scale\.y/);
  assert.match(source, /\(seal\.x - cfg\.sealW \/ 2\) \* scale\.x/);
  assert.match(source, /\(seal\.y - cfg\.sealH \/ 2\) \* scale\.y/);
  assert.match(source, /width:34\.47%/);
  assert.match(source, /width:60\.53%/);
});

test("keyboard aiming, shooting, and Escape use the real handlers", () => {
  const keyDown = loadMethod("  sealGameKeyDown(e) {", "\n  sealGameKeyUp(e) {");
  const keyUp = loadMethod("  sealGameKeyUp(e) {", "\n  sealGameLoop(ts) {");
  const stage = {};
  let shots = 0;
  let closes = 0;
  let prevented = 0;
  const game = {
    state: { sealGameOpen: true },
    sealGameStageEl: stage,
    sealGameKeys: {},
    shootSealPhoto() { shots += 1; },
    closeSealGame() { closes += 1; },
  };
  const event = (key, target = stage) => ({
    key,
    target,
    preventDefault() { prevented += 1; },
  });

  keyDown.call(game, event("ArrowLeft"));
  keyDown.call(game, event("ArrowUp"));
  assert.equal(game.sealGameKeys.left, true);
  assert.equal(game.sealGameKeys.up, true);

  keyDown.call(game, event(" "));
  keyDown.call(game, event(" "));
  assert.equal(shots, 1, "holding the shoot key must not consume repeat shots");
  keyUp.call(game, event(" "));
  keyDown.call(game, event("Enter"));
  assert.equal(shots, 2);

  keyUp.call(game, event("ArrowLeft"));
  keyUp.call(game, event("ArrowUp"));
  assert.equal(game.sealGameKeys.left, false);
  assert.equal(game.sealGameKeys.up, false);

  keyDown.call(game, event("Escape", {}));
  assert.equal(closes, 1, "Escape must close even when focus is on another modal control");
  assert.ok(prevented >= 5);
});

test("reduced motion suppresses flashes and teardown removes active flashes", () => {
  const reducedContext = {
    window: { matchMedia: () => ({ matches: true }) },
    document: { createElement: () => assert.fail("reduced motion created a flash") },
  };
  const prefersReducedMotion = loadMethod(
    "  sealGamePrefersReducedMotion() {",
    "\n  sealGameFlash(parent, opts) {",
    reducedContext,
  );
  const reducedFlash = loadMethod(
    "  sealGameFlash(parent, opts) {",
    "\n  sealGameClearFlashes() {",
    reducedContext,
  );
  const reducedGame = { sealGamePrefersReducedMotion: prefersReducedMotion };
  assert.equal(reducedFlash.call(reducedGame, {}, {}), null);

  let cancelled = 0;
  let removed = 0;
  const animation = { cancel() { cancelled += 1; } };
  const flash = {
    style: {},
    animate: () => animation,
    remove() { removed += 1; },
  };
  const normalContext = {
    window: { matchMedia: () => ({ matches: false }) },
    document: { createElement: () => flash },
  };
  const normalPrefersReducedMotion = loadMethod(
    "  sealGamePrefersReducedMotion() {",
    "\n  sealGameFlash(parent, opts) {",
    normalContext,
  );
  const normalFlash = loadMethod(
    "  sealGameFlash(parent, opts) {",
    "\n  sealGameClearFlashes() {",
    normalContext,
  );
  const clearFlashes = loadMethod(
    "  sealGameClearFlashes() {",
    "\n  shootSealPhoto() {",
    normalContext,
  );
  const normalGame = { sealGamePrefersReducedMotion: normalPrefersReducedMotion };
  const parent = { appendChild(node) { assert.equal(node, flash); } };

  assert.equal(normalFlash.call(normalGame, parent, { cssText: "opacity:1", opacity: 1, duration: 400 }), flash);
  assert.equal(normalGame.sealGameFlashes.size, 1);
  clearFlashes.call(normalGame);
  assert.equal(normalGame.sealGameFlashes.size, 0);
  assert.equal(cancelled, 1);
  assert.equal(removed, 1);
  assert.match(source, /this\.sealGameClearFlashes\(\);/);
});

test("seal hover audio cannot overlap and stops when hover ends", () => {
  const audioInstances = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.paused = true;
      this.ended = false;
      this.currentTime = 0;
      this.playCalls = 0;
      audioInstances.push(this);
    }

    play() {
      this.paused = false;
      this.playCalls += 1;
      return Promise.resolve();
    }

    pause() {
      this.paused = true;
    }
  }
  const enter = loadMethod("  sealEnter() {", "\n  sealLeave() {", { Audio: FakeAudio });
  const leave = loadMethod("  sealLeave() {", "\n  snorkelEnter() {", { Audio: FakeAudio });
  const game = {};

  enter.call(game);
  enter.call(game);
  assert.equal(audioInstances.length, 1);
  assert.equal(audioInstances[0].playCalls, 1);

  audioInstances[0].currentTime = 2;
  leave.call(game);
  assert.equal(audioInstances[0].paused, true);
  assert.equal(audioInstances[0].currentTime, 0);
  assert.match(source, /onMouseLeave="\{\{ sealLeave \}\}"/);
  assert.match(source, /sealLeave: \(\) => this\.sealLeave\(\)/);
});

test("composition checks cover centered, rule-of-thirds, and directional action framing", () => {
  const isCompositionMet = loadMethod(
    "  sealGameIsCompositionMet() {",
    "\n  sealGameKeyDown(e) {",
  );
  const compositions = [
    { key: "centered", centerX: 0.5, centerY: 0.5, toleranceX: 0.14, toleranceY: 0.2 },
    { key: "thirds", points: [[1 / 3, 1 / 3], [2 / 3, 2 / 3]], radius: 0.15 },
    { key: "action", leftMax: 0.45, rightMin: 0.55, minY: 0.16, maxY: 0.84, minSpeed: 120 },
  ];
  const game = {
    sealGameConfig: { stageW: 760, stageH: 500 },
    sealGameSeal: { x: 380, y: 250, vx: 80, vy: 0 },
    sealGameCurrentComposition() { return compositions[this.challengeIndex]; },
    challengeIndex: 0,
  };

  assert.equal(isCompositionMet.call(game), true);
  game.sealGameSeal.x = 150;
  assert.equal(isCompositionMet.call(game), false);

  game.challengeIndex = 1;
  game.sealGameSeal = { x: 760 / 3, y: 500 / 3, vx: 80, vy: 0 };
  assert.equal(isCompositionMet.call(game), true);
  game.sealGameSeal = { x: 380, y: 250, vx: 80, vy: 0 };
  assert.equal(isCompositionMet.call(game), false);

  game.challengeIndex = 2;
  game.sealGameSeal = { x: 250, y: 250, vx: 140, vy: 0 };
  assert.equal(isCompositionMet.call(game), true, "rightward action leaves room on the right");
  game.sealGameSeal = { x: 510, y: 250, vx: -140, vy: 0 };
  assert.equal(isCompositionMet.call(game), true, "leftward action leaves room on the left");
  game.sealGameSeal.vx = -80;
  assert.equal(isCompositionMet.call(game), false, "final action must be fast enough");
});

test("stabilization assist snaps and completes every challenge while unstabilized wrong shots miss", () => {
  const stabilize = loadMethod("  sealGameStabilize() {", "\n  sealGamePrefersReducedMotion() {");
  const snap = loadMethod("  sealGameSnapToComposition() {", "\n  sealGameStabilize() {");
  const isCompositionMet = loadMethod("  sealGameIsCompositionMet() {", "\n  sealGameKeyDown(e) {");
  const shoot = loadMethod("  shootSealPhoto() {", "\n  finishSealPhotoshoot() {", { Audio: class { play() { return Promise.resolve(); } } });
  const game = {
    state: { sealGameOpen: true, sealGameShots: 0, sealGameFilm: 8 },
    sealGameConfig: { stageW: 760, stageH: 500, goodShotThreshold: 70, filmPerBatch: 8, shotsToWin: 3, speedBoostPerShot: 1, compositions: [
      { key: "centered", centerX: 0.5, centerY: 0.5, toleranceX: 0.14, toleranceY: 0.2 },
      { key: "thirds", points: [[1 / 3, 1 / 3]], radius: 0.18 },
      { key: "action", leftMax: 0.5, minY: 0.12, maxY: 0.88, minSpeed: 120 },
    ] },
    sealGameSeal: { x: 10, y: 10, vx: 130, vy: 0 },
    sealGameView: { x: 10, y: 10 },
    sealGameCurrentComposition() { return this.sealGameConfig.compositions[this.state.sealGameShots]; },
    sealGameApplyViewTransform() {},
    sealGameFocusValue: 0,
    sealGameStabilized: false,
    sealGameIsCompositionMet: isCompositionMet,
    sealGameSnapToComposition: snap,
    sfx() {},
    setState(update) { this.state = { ...this.state, ...(typeof update === "function" ? update(this.state) : update) }; },
    finishSealPhotoshoot() {},
    teardownSealGame() {},
  };

  shoot.call(game);
  assert.equal(game.state.sealGameShots, 0, "an incorrect unstabilized shot must miss");
  for (let challenge = 0; challenge < 3; challenge += 1) {
    if (!game.sealGameStabilized) stabilize.call(game);
    game.sealGameFocusValue = 100;
    assert.equal(isCompositionMet.call(game), true, `assist should make challenge ${challenge + 1} valid`);
    shoot.call(game);
  }
  assert.equal(game.state.sealGameShots, 3);
});

test("only focused, correctly composed shots progress and exactly the third success wins", () => {
  class FakeAudio {
    play() { return Promise.resolve(); }
  }
  const shoot = loadMethod(
    "  shootSealPhoto() {",
    "\n  finishSealPhotoshoot() {",
    { Audio: FakeAudio },
  );
  const compositions = [
    { prompt: "Centrerat porträtt" },
    { prompt: "Tredjedelsregeln" },
    { prompt: "Actionbild" },
  ];
  let wins = 0;
  let teardowns = 0;
  const game = {
    state: { sealGameOpen: true, sealGameShots: 0, sealGameFilm: 8 },
    sealGameConfig: {
      goodShotThreshold: 70,
      shotsToWin: 3,
      filmPerBatch: 8,
      speedBoostPerShot: 1.45,
      compositions,
    },
    sealGameFocusValue: 80,
    sealGameSeal: { vx: 100, vy: 50 },
    sealGameIsCompositionMet: () => true,
    sealGameCurrentComposition() { return compositions[this.state.sealGameShots]; },
    sfx() {},
    setState(update) {
      const next = typeof update === "function" ? update(this.state) : update;
      this.state = { ...this.state, ...next };
    },
    teardownSealGame() { teardowns += 1; },
    finishSealPhotoshoot() { wins += 1; },
  };

  shoot.call(game);
  assert.equal(game.state.sealGameShots, 1);
  assert.match(game.state.sealGameMsg, /Tredjedelsregeln/);
  assert.equal(wins, 0);

  shoot.call(game);
  assert.equal(game.state.sealGameShots, 2);
  assert.match(game.state.sealGameMsg, /Actionbild/);
  assert.equal(wins, 0);

  shoot.call(game);
  assert.equal(game.state.sealGameShots, 3);
  assert.equal(wins, 1);
  assert.equal(teardowns, 1);
});

test("focus and composition misses both consume film without advancing", () => {
  const shoot = loadMethod(
    "  shootSealPhoto() {",
    "\n  finishSealPhotoshoot() {",
  );
  const challenge = { prompt: "Centrerat porträtt" };
  const game = {
    state: { sealGameOpen: true, sealGameShots: 0, sealGameFilm: 8 },
    sealGameConfig: { goodShotThreshold: 70, filmPerBatch: 8 },
    sealGameFocusValue: 80,
    sealGameIsCompositionMet: () => false,
    sealGameCurrentComposition: () => challenge,
    sfx() {},
    setState(update) { this.state = { ...this.state, ...update }; },
  };

  shoot.call(game);
  assert.equal(game.state.sealGameShots, 0);
  assert.equal(game.state.sealGameFilm, 7);
  assert.match(game.state.sealGameMsg, /Kompositionen missades/);

  game.sealGameFocusValue = 60;
  game.sealGameIsCompositionMet = () => true;
  shoot.call(game);
  assert.equal(game.state.sealGameShots, 0);
  assert.equal(game.state.sealGameFilm, 6);
  assert.match(game.state.sealGameMsg, /Suddigt/);
});

test("reopening resets progression and tears down a previous session first", () => {
  const open = loadMethod("  openSealGame() {", "\n  closeSealGame() {");
  let teardowns = 0;
  const game = {
    sealGameConfig: { filmPerBatch: 8, compositions: [{ prompt: "Centrerat porträtt" }] },
    setState(update) { this.state = { ...this.state, ...update }; },
    state: { sealGameShots: 2, sealGameFilm: 1, sealGameFocusPct: 85 },
    teardownSealGame() { teardowns += 1; },
  };

  open.call(game);

  assert.equal(teardowns, 1);
  assert.equal(game.state.sealGameOpen, true);
  assert.equal(game.state.sealGameShots, 0);
  assert.equal(game.state.sealGameFilm, 8);
  assert.equal(game.state.sealGameFocusPct, 0);
  assert.match(game.state.sealGameA11yStatus, /Centrerat porträtt/);
  assert.match(source, /this\.sealGameCompositionReady = null/);
  assert.match(source, /this\.sealGameFocusValue = 0/);
});

test("winning the seal game awards a numeric battery inventory id", () => {
  assert.match(source, /inventory: s\.inventory\.concat\(\[\{ iid: \+\+this\.uid, defId: "battery" \}\]\)/);
  assert.doesNotMatch(source, /iid: "battery-" \+ Date\.now\(\)/);
});
