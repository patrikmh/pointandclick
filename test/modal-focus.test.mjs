import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "project", "Adventure Scene.dc.html"), "utf8");

function extractMethod(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker for ${startMarker}`);
  return source.slice(start, end);
}

function focusNode(name) {
  return { name, isConnected: true, focused: 0, focus() { this.focused++; } };
}

const modalNames = ["settings", "reset-confirm", "guide", "gull-game", "skeda-game", "dolphan-game", "shrimp-game", "paint", "scrub", "atelier", "sonar", "seal-game", "octo-game", "badger-game", "sheep-game", "glodis-game"];
for (const name of modalNames) {
  test(`modal ${name} has dialog semantics`, () => {
    const rootTag = source.match(new RegExp(`<[^>]*data-modal="${name}"[^>]*>`));
    assert.ok(rootTag);
    assert.match(rootTag[0], /role="(?:dialog|alertdialog)"/);
    assert.match(rootTag[0], /aria-modal="true"/);
  });
}



test("Skeda sequence callbacks ignore closed, reopened, and superseded sessions", () => {
  const play = vm.runInNewContext(`({${extractMethod("  playSkedaSequence() {", "\n\n  flashSkedaAction")}}).playSkedaSequence`);
  const queued = [];
  const flashes = [];
  const game = {
    state: { skedaGameOpen: true, skedaSequence: [2, 4], skedaGamePhase: "watch" },
    skedaSessionGeneration: 10,
    scheduleGameAction(callback) { queued.push(callback); },
    flashSkedaAction(action) { flashes.push(action); },
    setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); },
  };
  play.call(game);
  const firstRun = queued.splice(0);
  game.state.skedaGameOpen = false;
  game.skedaSessionGeneration++;
  game.state.skedaGameOpen = true;
  firstRun.forEach((callback) => callback());
  assert.deepEqual(flashes, []);
  assert.equal(game.state.skedaGamePhase, "watch");

  play.call(game);
  const currentRun = queued.splice(0);
  currentRun.forEach((callback) => callback());
  assert.deepEqual(flashes, [2, 4]);
  assert.equal(game.state.skedaGamePhase, "input");

  play.call(game);
  const superseded = queued.splice(0);
  play.call(game);
  superseded.forEach((callback) => callback());
  assert.deepEqual(flashes, [2, 4]);
});

function visualElement() {
  return {
    isConnected: true,
    style: {},
    classList: { add() {}, remove() {} },
    setAttribute() {},
    appendChild() {},
    remove() {},
    animate() { return { onfinish: null }; },
  };
}

function gameDocument() {
  return { createElement: () => visualElement() };
}

test("Gull win and out-of-bombs callbacks reject stale generations and run once when current", () => {
  const resolve = vm.runInNewContext(`({${extractMethod("  resolveGullBomb(b) {", "\n\n  resetGullRound")}}).resolveGullBomb`, {
    document: gameDocument(),
    performance: { now: () => 100 },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
  });
  const scheduled = [];
  const game = {
    state: { gullGameOpen: true, gullGameBombs: 1 },
    gullSessionGeneration: 3,
    gullGameConfig: { hitRx: 10, hitRy: 10, winHits: 1, stageW: 100, stageH: 100 },
    gullGameStageEl: { appendChild() {} }, gullBoat: { x: 0, y: 0 }, gullPlane: { x: 0, y: 0 }, gullBombs: [],
    scheduleGameAction(callback) { scheduled.push(callback); },
    setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); },
    spawnGullSplash() {}, sfx() {}, rerollGullBoatHeading() {}, closeGullGame() { this.closed = (this.closed || 0) + 1; }, cutLine() { this.cut = (this.cut || 0) + 1; }, resetGullRound() { this.reset = (this.reset || 0) + 1; },
  };
  resolve.call(game, { x: 0, y: 0 });
  const winOld = scheduled.pop();
  game.gullSessionGeneration++;
  game.state.gullGameOpen = false;
  game.gullSessionGeneration++;
  game.state.gullGameOpen = true;
  winOld();
  assert.equal(game.closed || 0, 0);
  assert.equal(game.cut || 0, 0);

  game.gullSessionGeneration++;
  game.state.gullGameBombs = 0;
  resolve.call(game, { x: 50, y: 50 });
  const resetCurrent = scheduled.pop();
  resetCurrent();
  assert.equal(game.reset, 1);

  game.state.gullGameBombs = 1;
  game.gullSessionGeneration++;
  resolve.call(game, { x: 0, y: 0 });
  const winCurrent = scheduled.pop();
  winCurrent();
  assert.equal(game.closed, 1);
  assert.equal(game.cut, 1);
});

test("Dolphan win and out-of-buoys callbacks reject stale generations and run once when current", () => {
  const resolve = vm.runInNewContext(`({${extractMethod("  resolveDolphanThrow(b) {", "\n\n  resetDolphanRound")}}).resolveDolphanThrow`, {
    document: gameDocument(),
  });
  const scheduled = [];
  const game = {
    state: { dolphanGameOpen: true, dolphanGameThrows: 1 },
    dolphanSessionGeneration: 4,
    dolphanGameConfig: { hitRx: 10, hitRy: 10, winHits: 1, stageW: 100, stageH: 100, throwCount: 3 },
    dolphanGameStageEl: { appendChild() {} }, dolphanSwimmer: { x: 0, y: 0 }, dolphanBuoys: [],
    scheduleGameAction(callback) { scheduled.push(callback); },
    setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); },
    spawnDolphanSplash() {}, sfx() {}, rerollDolphanSwimmer() {}, closeDolphanGame() { this.closed = (this.closed || 0) + 1; }, dolphanWin() { this.won = (this.won || 0) + 1; }, resetDolphanRound() { this.reset = (this.reset || 0) + 1; },
  };
  resolve.call(game, { tx: 0, ty: 0 });
  const winOld = scheduled.pop();
  game.dolphanSessionGeneration++;
  game.state.dolphanGameOpen = false;
  game.dolphanSessionGeneration++;
  game.state.dolphanGameOpen = true;
  winOld();
  assert.equal(game.closed || 0, 0);
  assert.equal(game.won || 0, 0);

  game.dolphanSessionGeneration++;
  game.state.dolphanGameThrows = 0;
  resolve.call(game, { tx: 50, ty: 50 });
  const resetCurrent = scheduled.pop();
  resetCurrent();
  assert.equal(game.reset, 1);

  game.state.dolphanGameThrows = 1;
  game.dolphanSessionGeneration++;
  resolve.call(game, { tx: 0, ty: 0 });
  const winCurrent = scheduled.pop();
  winCurrent();
  assert.equal(game.closed, 1);
  assert.equal(game.won, 1);
});

for (const [name, initMarker, teardownMarker, focusProp, rafProp] of [
  ["Gull", "  initGullStage(el) {", "  teardownGullGame(clearRefs) {", "gullGameFocusRAF", "gullGameRAF"],
  ["Dolphan", "  initDolphanStage(el) {", "  teardownDolphanGame(clearRefs) {", "dolphanGameFocusRAF", "dolphanGameRAF"],
]) {
  test(`${name} initial focus RAF is owned and cancelled by teardown`, () => {
    const pending = new Map();
    const cancelled = new Set();
    let nextId = 0;
    const requestAnimationFrame = (callback) => { const id = ++nextId; pending.set(id, callback); return id; };
    const cancelAnimationFrame = (id) => { cancelled.add(id); };
    const context = { requestAnimationFrame, cancelAnimationFrame };
    const init = vm.runInNewContext(`({${extractMethod(initMarker, `\n\n  start${name}Game`)}}).${initMarker.trim().split("(")[0]}`, context);
    const teardown = vm.runInNewContext(`({${extractMethod(teardownMarker, name === "Gull" ? "\n\n  initGullWaterCanvas" : "\n\n  initDolphanWaterCanvas")}}).teardown${name}Game`, context);
    const stage = { isConnected: true, focusCount: 0, focus() { this.focusCount++; } };
    const game = {
      [`start${name}Game`]() {},
      [`${focusProp}`]: null,
      [`${rafProp}`]: null,
      [`gullGameStageEl`]: null, [`dolphanGameStageEl`]: null,
    };
    init.call(game, stage);
    const focusId = game[focusProp];
    assert.ok(focusId);
    teardown.call(game, false);
    assert.equal(cancelled.has(focusId), true);
    assert.equal(game[focusProp], null);
    if (!cancelled.has(focusId)) pending.get(focusId)?.();
    assert.equal(stage.focusCount, 0);
  });
}

test("confirmReset restores focus only after reset commit, while cancel remains immediate", () => {
  const confirm = vm.runInNewContext(`({${extractMethod("  confirmReset() {", "\n\n  reset(onComplete)")}}).confirmReset`);
  const cancel = vm.runInNewContext(`({${extractMethod("  cancelReset() {", "\n\n  confirmReset()")}}).cancelReset`);
  const trigger = focusNode("reset-trigger");
  let commit;
  let restores = 0;
  const game = {
    resetReturnFocus: trigger,
    teardownResetConfirm() {},
    restoreFocusTarget(target) { restores++; target.focus(); },
    reset(callback) { commit = callback; },
  };
  confirm.call(game);
  assert.equal(restores, 0);
  commit();
  assert.equal(restores, 1);
  assert.equal(trigger.focused, 1);

  game.resetReturnFocus = trigger;
  game.setState = (update, callback) => callback();
  cancel.call(game);
  assert.equal(restores, 2);
});

test("all modal labelled roots resolve their accessible name", () => {
  for (const name of modalNames) {
    const rootTag = source.match(new RegExp(`<[^>]*data-modal="${name}"[^>]*>`))[0];
    const labelledBy = rootTag.match(/aria-labelledby="([^"]+)"/);
    assert.ok(labelledBy, `${name} is labelled`);
    for (const id of labelledBy[1].split(/\\s+/)) {
      assert.match(source, new RegExp(`<[^>]*\\bid="${id}"(?:\\s|>)`), `${name} label ${id} resolves`);
    }
  }
});

test("modal lifecycle schedules one RAF focus job and tears down stale jobs and listeners", () => {
  const pending = new Map();
  const cancelled = [];
  const added = [], removed = [];
  let next = 0;
  const dialog = { focusCount: 0, focus() { this.focusCount++; }, querySelector() { return this; } };
  const context = {
    document: { activeElement: focusNode("origin"), querySelector() { return dialog; } },
    window: {
      addEventListener(type, fn) { added.push([type, fn]); },
      removeEventListener(type, fn) { removed.push([type, fn]); },
      requestAnimationFrame(fn) { const id = ++next; pending.set(id, fn); return id; },
      cancelAnimationFrame(id) { cancelled.push(id); pending.delete(id); },
    },
    setTimeout() { throw new Error("setupModalLifecycle must prefer requestAnimationFrame"); },
    clearTimeout() {},
  };
  const lifecycle = {};
  Object.assign(lifecycle, vm.runInNewContext(`({${extractMethod("  setupModalLifecycle(name, selector, close, initial) {", "\n  teardownModalLifecycle")}})`, context));
  Object.assign(lifecycle, vm.runInNewContext(`({${extractMethod("  teardownModalLifecycle(name, restore = true) {", "\n\n  teardownAllModalLifecycles")}})`, context));
  Object.assign(lifecycle, vm.runInNewContext(`({${extractMethod("  teardownAllModalLifecycles() {", "\n\n\n  toggleSettings")}})`, context));
  const game = { restoreFocusTarget() { throw new Error("restoration is not expected"); }, teardownModalLifecycle: lifecycle.teardownModalLifecycle, teardownAllModalLifecycles: lifecycle.teardownAllModalLifecycles, _guidePendingFocus: null };
  lifecycle.setupModalLifecycle.call(game, "paint", "[data-modal=paint]", null, "button");
  assert.equal(added.length, 1);
  const firstJob = game._modalFocusJob_paint.id;
  lifecycle.setupModalLifecycle.call(game, "paint", "[data-modal=paint]", null, "button");
  assert.deepEqual(cancelled, [firstJob]);
  assert.equal(added.length, 2);
  assert.equal(dialog.focusCount, 0);
  pending.get(game._modalFocusJob_paint.id)();
  assert.equal(dialog.focusCount, 1);
  lifecycle.teardownModalLifecycle.call(game, "paint", false);
  assert.equal(game._modalFocusJob_paint, null);
  assert.equal(removed.length, 2);
  pending.get(firstJob)?.();
  assert.equal(dialog.focusCount, 1);

  game._guideProceed = () => {};
  game._guidePendingFocus = focusNode("pending");
  game._guideReturnFocus = game._guidePendingFocus;
  lifecycle.teardownAllModalLifecycles.call(game);
  assert.equal(game._guideProceed, null);
  assert.equal(game._guidePendingFocus, null);
  assert.equal(game._guideReturnFocus, null);
});

test("trapModalFocus uses production method at every modal boundary", () => {
  const first = { getClientRects: () => [1], focusCount: 0, focus() { this.focusCount++; } };
  const last = { getClientRects: () => [1], focusCount: 0, focus() { this.focusCount++; } };
  const dialog = { focusCount: 0, focus() { this.focusCount++; }, querySelectorAll() { return [first, last]; }, contains(node) { return node === first || node === last; } };
  const document = { activeElement: dialog, querySelector() { return dialog; } };
  const context = { document };
  const trap = vm.runInNewContext(`({${extractMethod("  trapModalFocus(event, selector) {", "\n\n  setupModalLifecycle")}}).trapModalFocus`, context);
  const event = (shiftKey) => ({ key: "Tab", shiftKey, prevented: 0, preventDefault() { this.prevented++; } });
  let e = event(false); assert.equal(trap.call({}, e, "#modal"), true); assert.equal(e.prevented, 1); assert.equal(first.focusCount, 1);
  document.activeElement = dialog; e = event(true); trap.call({}, e, "#modal"); assert.equal(last.focusCount, 1);
  document.activeElement = last; e = event(false); trap.call({}, e, "#modal"); assert.equal(e.prevented, 1); assert.equal(first.focusCount, 2);
  document.activeElement = first; e = event(true); trap.call({}, e, "#modal"); assert.equal(e.prevented, 1); assert.equal(last.focusCount, 2);
  document.activeElement = { outside: true }; e = event(false); trap.call({}, e, "#modal"); assert.equal(first.focusCount, 3);
});

test("restoreFocusTarget safely restores only a usable attached target", () => {
  const restore = vm.runInNewContext(`({${extractMethod("  restoreFocusTarget(target) {", "\n\n  teardownSettingsModal")}}).restoreFocusTarget`);
  const valid = focusNode("valid"); restore.call({}, valid); assert.equal(valid.focused, 1);
  for (const target of [{ isConnected: false, focus() { throw new Error(); } }, { disabled: true, focus() { throw new Error(); } }, { isConnected: true, focus() { throw new Error(); } }]) assert.doesNotThrow(() => restore.call({}, target));
});

test("paint and scrub canvas teardown clears handlers, refs, images, and generations", () => {
  const paint = vm.runInNewContext(`({${extractMethod("  teardownPaintCanvas() {", "\n\n  initPaintCanvas")}}).teardownPaintCanvas`);
  const scrub = vm.runInNewContext(`({${extractMethod("  teardownScrubCanvas() {", "\n\n  drawScrubLayers")}}).teardownScrubCanvas`);
  const canvas = { onpointerdown: 1, onpointermove: 1, onpointerup: 1, onpointerleave: 1 };
  const img = { onload: 1, onerror: 1 };
  const game = { paintCanvasEl: canvas, paintUndoStack: [1] }; paint.call(game);
  assert.equal(game.paintCanvasEl, null); assert.equal(game.paintUndoStack.length, 0); assert.equal(canvas.onpointerdown, null);
  const scrubGame = { scrubGeneration: 2, scrubCanvasEl: canvas, scrubBrushEl: {}, scrubLayers: [{ img }] }; scrub.call(scrubGame);
  assert.equal(scrubGame.scrubGeneration, 3); assert.equal(scrubGame.scrubCanvasEl, null); assert.equal(scrubGame.scrubBrushEl, null); assert.equal(scrubGame.scrubLayers.length, 0); assert.equal(img.onload, null); assert.equal(img.onerror, null);
});

test("guide handoff starts once, preserves explicit focus, and cancellation clears it", () => {
  const gate = vm.runInNewContext(`({${extractMethod("  _guideGate(key, proceed, returnFocus) {", "\n  _guideOrOpen")}})._guideGate`);
  const start = vm.runInNewContext(`({${extractMethod("  guideStart() {", "\n  guideClose")}}).guideStart`);
  const close = vm.runInNewContext(`({${extractMethod("  guideClose() {", "\n  guideResetDismissals")}}).guideClose`);
  const trigger = focusNode("trigger");
  let proceeds = 0;
  const game = { gameGuides: { paint: {} }, state: { guideGame: "paint", guideDismissChecked: false }, _guideDismissed() { return false; }, setupModalLifecycle() {}, teardownModalLifecycle() {}, setState(update) { Object.assign(this.state, update); } };
  assert.equal(gate.call(game, "paint", () => { proceeds++; }, trigger), true);
  assert.equal(game._guidePendingFocus, trigger);
  start.call(game);
  assert.equal(proceeds, 1); assert.equal(game._guidePendingFocus, null); assert.equal(game._guideReturnFocus, null);
  gate.call(game, "paint", () => { proceeds++; }, trigger); close.call(game);
  assert.equal(proceeds, 1); assert.equal(game._guidePendingFocus, null); assert.equal(game._guideProceed, null);
});

test("generic and owned Escape listeners have one owner and route through close", () => {
  const listeners = [];
  const context = { document: { activeElement: null }, window: { addEventListener(_, fn) { listeners.push(fn); }, requestAnimationFrame() { return 1; }, cancelAnimationFrame() {} }, setTimeout() { return 1; }, clearTimeout() {} };
  const lifecycle = vm.runInNewContext(`({${extractMethod("  setupModalLifecycle(name, selector, close, initial) {", "\n  teardownModalLifecycle")}}).setupModalLifecycle`, context);
  const close = { count: 0 }; const game = { trapModalFocus() {}, teardownModalLifecycle() {} };
  lifecycle.call(game, "guide", "#guide", () => { close.count++; }, "button");
  const owned = listeners.at(-1); const ownedEvent = { key: "Escape", preventDefault() { this.prevented = true; } }; owned(ownedEvent);
  assert.equal(close.count, 1); assert.equal(ownedEvent.prevented, true);
  lifecycle.call(game, "octo-game", "#octo", null, "button");
  const generic = listeners.at(-1); const genericEvent = { key: "Escape", preventDefault() { this.prevented = true; } }; generic(genericEvent);
  assert.equal(close.count, 1); assert.equal(genericEvent.prevented, undefined);
});

test("automatic modal completion closers own teardown for every restored path", () => {
  const cases = [["closeOctoGame", "octo-game", "teardownOctoGame"], ["closeBadgerGame", "badger-game", null], ["closeSonarGame", "sonar", "teardownSonarGame"], ["closeSealGame", "seal-game", "teardownSealGame"], ["closePaintGame", "paint", "teardownPaintCanvas"], ["closeOtterAtelier", "atelier", "teardownOtterAtelier"], ["closeScrubGame", "scrub", "teardownScrubCanvas"]];
  for (const [name, modal, extra] of cases) {
    const method = vm.runInNewContext(`({${extractMethod(`  ${name}() {`, "\n\n")}})`)[name];
    const calls = []; const game = { state: { paintOpen: true, scrubOpen: true }, teardownModalLifecycle(value) { calls.push(value); }, setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); } };
    if (extra) game[extra] = () => calls.push(extra); if (name === "closePaintGame") game.paintGeneration = 0; if (name === "closeScrubGame") game.teardownScrubHeat = () => calls.push("heat");
    assert.doesNotThrow(() => method.call(game)); assert.equal(calls.includes(modal), true, `${name} tears down ${modal}`);
  }
});
