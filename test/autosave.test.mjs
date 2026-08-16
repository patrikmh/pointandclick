import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const source = await readFile(new URL("../project/Adventure%20Scene.dc.html", import.meta.url), "utf8");

function method(name) {
  const start = source.indexOf(`  ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}" && --depth === 0) {
      return Function(`return ({ ${source.slice(start, i + 1).trim()} }).${name}`)();
    }
  }
  throw new Error(`could not extract ${name}`);
}

const sanitize = method("sanitizeDurableState");
const project = method("projectDurableState");
const restore = method("restoreDurableState");
const coherent = method("isDurableStateCoherent");
const scheduleGameAction = method("scheduleGameAction");
const openSonarGame = method("openSonarGame");
const sheepLoadGallery = method("sheepLoadGallery");
const update = method("componentDidUpdate");
const flush = method("flushDurableSave");

const durableKeys = [
  "inventory", "placed", "scene", "returnScene", "discovered", "moonState", "moonSpeechesPlayed",
  "crabFreed", "gullFreed", "underwaterUnlocked", "chestOpen", "sealHappy", "otterFreed", "otterAtelierUnlocked",
  "subHelped", "otterCoutureDone", "badgerHappy", "sheepRevealed", "crabWatered", "skedaHelped", "glodisHelped",
  "dolphanHelped", "dolphanArmed", "skedaTooled", "skedaPanGiven", "skedaSlevGiven", "fryingPanFound", "otterLook", "otterLookBox", "octoHealed",
  "codDone", "sonarSolved", "shrimpHelped", "shrimpGameSolved",
];

function coherentState(overrides = {}) {
  return {
    inventory: [], placed: [], scene: "center", returnScene: "center", discovered: {}, moonState: "asleep", moonSpeechesPlayed: [],
    crabFreed: false, gullFreed: false, underwaterUnlocked: false, chestOpen: false, sealHappy: false, otterFreed: false,
    otterAtelierUnlocked: false, subHelped: false, otterCoutureDone: false, badgerHappy: false, sheepRevealed: false,
    crabWatered: false, skedaHelped: false, glodisHelped: false, dolphanHelped: false, dolphanArmed: false,
    skedaTooled: false, skedaPanGiven: false, skedaSlevGiven: false, fryingPanFound: false, octoHealed: false,
    codDone: false, sonarSolved: [], shrimpHelped: false, shrimpGameSolved: false, ...overrides,
  };
}

function harness(save) {
  harness.lastWrite = undefined;
  harness.removed = undefined;
  globalThis.localStorage = {
    getItem: () => save == null ? null : JSON.stringify(save),
    setItem: (_key, value) => { harness.lastWrite = JSON.parse(value); },
    removeItem: (key) => { harness.removed = key; },
  };
  return {
    durableVersion: 1,
    durableStorageKey: "pointAndClickAdventureSave",
    durableKeys,
    isDurableStateCoherent: coherent,
    personas: { moon: {}, dolphan: {} },
    defs: { buoy: {}, key: {} },
    deriveDurableVisuals: (state) => ({ ...state, derived: true }),
    sanitizeDurableState: sanitize,
    state: { scene: "center" },
    _durableReferences: { scene: "center" },
    scheduleGameAction,
    openSonarGame,
    sheepLoadGallery,
  };
}

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const box = { left: 10, top: 20, width: 50, height: 60 };

 test("valid restore keeps durable progress, rejects unknown data, and skips intro", () => {
  const game = harness({ version: 1, state: coherentState({
    scene: "camp", inventory: [{ iid: 240, defId: "buoy" }],
    dolphanArmed: true, otterCoutureDone: true, otterFreed: true, otterAtelierUnlocked: true, otterLook: png, otterLookBox: box,
    sonarSolved: [{ id: "slupen", label: "Slupen Vinga", pure: true }],
    dialogText: "transient", introActive: true,
  }) });
  const restored = restore.call(game, { introActive: true, inventory: [{ iid: "start", defId: "key" }] });
  assert.equal(restored.scene, "camp");
  assert.deepEqual(restored.inventory, [{ iid: 240, defId: "buoy" }]);
  assert.equal(restored.dolphanArmed, true);
  assert.equal(restored.otterLook, png);
  assert.deepEqual(restored.otterLookBox, box);
  assert.deepEqual(restored.sonarSolved, [{ id: "slupen", label: "Slupen Vinga", pure: true }]);
  assert.equal(restored.dialogText, undefined);
  assert.equal(restored.introActive, false);
});

test("malformed and unsupported envelopes preserve defaults", () => {
  for (const save of [null, { version: 2, state: { inventory: [] } }, { version: 1, state: [] }]) {
    const game = harness(save);
    const restored = restore.call(game, { introActive: true, inventory: [{ iid: "start", defId: "key" }] });
    assert.deepEqual(restored.inventory, [{ iid: "start", defId: "key" }]);
    assert.equal(restored.introActive, true);
  }
  const game = harness();
  assert.deepEqual(sanitize.call(game, { inventory: "bad", placed: null }), {});
});

test("non-empty invalid inventory preserves starter defaults and empty inventory remains valid", () => {
  const game = harness({ version: 1, state: coherentState({ inventory: [{ iid: 1, defId: "removed-item" }] }) });
  const restored = restore.call(game, { introActive: true, inventory: [{ iid: "start-0", defId: "key" }] });
  assert.deepEqual(restored.inventory, [{ iid: "start-0", defId: "key" }]);
  assert.equal(restored.introActive, true);
  const empty = restore.call(harness({ version: 1, state: coherentState() }), { introActive: true, inventory: [{ iid: "start-0", defId: "key" }] });
  assert.deepEqual(empty.inventory, []);
  assert.equal(empty.introActive, false);
});

test("restore bounds collections and deduplicates canonical ids across inventory and placed", () => {
  const game = harness({ version: 1, state: coherentState({
    inventory: [{ iid: 1, defId: "key" }, { iid: "1", defId: "buoy" }],
    placed: [{ uid: "A-1", defId: "key", x: 3, y: 4 }],
  }) });
  const restored = restore.call(game, { introActive: true });
  assert.equal(restored.inventory, undefined, "a malformed collection rejects the whole snapshot");
  assert.equal(restored.placed, undefined);
  assert.equal(restore.call(harness({ version: 1, state: { dialogText: "only transient" } }), { introActive: true }).introActive, true);
});

test("PNG restore fails closed for invalid signatures and dimensions", () => {
  const invalid = "data:image/png;base64," + "A".repeat(80);
  const game = harness({ version: 1, state: coherentState({ otterLook: invalid }) });
  assert.equal(restore.call(game, { introActive: true }).otterLook, undefined);
  assert.equal(restore.call(harness({ version: 1, state: coherentState({ otterLook: png }) }), { introActive: true }).otterLook, png);
});

test("raw saves over the storage cap are rejected before parsing", () => {
  const game = harness(null);
  globalThis.localStorage.getItem = () => "{" + "x".repeat(500 * 1024) + "}";
  const restored = restore.call(game, { introActive: true, inventory: [{ iid: "start-0", defId: "key" }] });
  assert.deepEqual(restored.inventory, [{ iid: "start-0", defId: "key" }]);
});

test("transient-only updates skip durable projection entirely", () => {
  const game = harness();
  game.durableSignature = () => { throw new Error("transient update should not compute a durable signature"); };
  game.state = { scene: "center", dialogText: "new" };
  update.call(game, {});
});

test("projected transient-only changes do not schedule, but progression after reset does", () => {
  const game = harness();
  game.projectDurableState = project;
  game.durableSignature = (state) => JSON.stringify(project.call(game, state));
  game._durableSignature = game.durableSignature({ scene: "center" });
  game._durableDirty = false;
  game._suppressSave = false;
  let scheduled = 0;
  game.scheduleDurableSave = () => { scheduled += 1; };
  game.state = { scene: "center", dialogText: "new" };
  update.call(game);
  assert.equal(scheduled, 0);
  game._suppressSave = true;
  game.state = { scene: "center", inventory: [{ iid: "start", defId: "key" }] };
  update.call(game);
  assert.equal(scheduled, 0);
  assert.deepEqual(game._durableReferences.inventory, game.state.inventory);
  game._durableSignature = game.durableSignature(game.state);
  game._suppressSave = false;
  game.state = { ...game.state, scene: "camp" };
  update.call(game);
  assert.equal(scheduled, 1);
  assert.equal(game._durableDirty, true);
});

test("flush does not recreate a clean save and clears dirty after a successful write", () => {
  const game = harness();
  game.projectDurableState = project;
  game.state = { scene: "center" };
  game._saveTimer = null;
  game._suppressSave = false;
  game._durableDirty = false;
  flush.call(game);
  assert.equal(harness.lastWrite, undefined);

  game._durableDirty = true;
  flush.call(game);
  assert.equal(harness.lastWrite.version, 1);
  assert.equal(game._durableDirty, false);
});

test("every always-emitted durable field is required and boolean strings reject the snapshot", () => {
  for (const key of durableKeys.filter((name) => !["otterLook", "otterLookBox"].includes(name))) {
    const state = coherentState();
    delete state[key];
    const restored = restore.call(harness({ version: 1, state }), { introActive: true });
    assert.equal(restored.introActive, true, `missing ${key} must retain intro`);
  }
  for (const [key, value] of [["underwaterUnlocked", "false"], ["subHelped", "true"]]) {
    const restored = restore.call(harness({ version: 1, state: coherentState({ [key]: value }) }), { introActive: true });
    assert.equal(restored.introActive, true, `${key} string must reject`);
  }
});

test("durable cross-field invariants reject incoherent progress", () => {
  const invalid = [
    { sonarSolved: [{ id: "angaren", label: "Angaren", pure: true }] },
    { sonarSolved: [{ id: "slupen", label: "Slupen Vinga", pure: true }], subHelped: true },
    { skedaTooled: true },
    { skedaPanGiven: true, skedaSlevGiven: false, skedaTooled: true },
    { skedaHelped: true, skedaTooled: false },
    { otterCoutureDone: true, otterFreed: false },
    { otterCoutureDone: false, otterFreed: true },
    { otterCoutureDone: true, otterAtelierUnlocked: false, otterLook: png, otterLookBox: box },
    { otterCoutureDone: true, otterAtelierUnlocked: true, otterLook: png },
    { shrimpHelped: true, shrimpGameSolved: false },
    { crabFreed: true, crabWatered: false },
    { dolphanHelped: true, dolphanArmed: false },
  ];
  for (const overrides of invalid) {
    const restored = restore.call(harness({ version: 1, state: coherentState(overrides) }), { introActive: true });
    assert.equal(restored.introActive, true, JSON.stringify(overrides));
  }
});

test("a valid advanced durable state restores without intro", () => {
  const state = coherentState({
    sonarSolved: [
      { id: "slupen", label: "Slupen Vinga", pure: true },
      { id: "angaren", label: "Angaren", pure: false },
      { id: "ubaten", label: "Ubaten", pure: true },
    ],
    subHelped: true, skedaTooled: true, skedaPanGiven: true, skedaSlevGiven: true, skedaHelped: true,
    otterFreed: true, otterCoutureDone: true, otterAtelierUnlocked: true, otterLook: png, otterLookBox: box,
    shrimpHelped: true, shrimpGameSolved: true, crabFreed: true, crabWatered: true, dolphanHelped: true, dolphanArmed: true,
  });
  assert.equal(restore.call(harness({ version: 1, state }), { introActive: true }).introActive, false);
});

test("generation guards execute unchanged callbacks and suppress changed ones", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const callbacks = [];
  globalThis.setTimeout = (callback) => { callbacks.push(callback); return callbacks.length; };
  try {
    const game = { gameGeneration: 3 };
    let runs = 0;
    scheduleGameAction.call(game, () => { runs += 1; }, 0);
    callbacks.shift()();
    assert.equal(runs, 1);
    scheduleGameAction.call(game, () => { runs += 1; }, 0);
    game.gameGeneration += 1;
    callbacks.shift()();
    assert.equal(runs, 1);
  } finally { globalThis.setTimeout = originalSetTimeout; }
});

test("sonar resumes at the solved prefix under the custom runtime", () => {
  const previousWindow = globalThis.window;
  globalThis.window = { addEventListener() {}, removeEventListener() {} };
  try {
    for (const [solved, expected] of [[[{ id: "slupen" }], 1], [[{ id: "slupen" }, { id: "angaren" }], 2]]) {
      const game = harness();
      game.state = { sonarSolved: solved };
      game.sonarContract = { rounds: [{}, {}, {}] };
      game.teardownSonarGame = () => {};
      game.handleSonarKeyDown = () => {};
      game.setState = (update) => { game.state = { ...game.state, ...update }; };
      openSonarGame.call(game);
      assert.equal(game.state.sonarRound, expected);
    }
  } finally { globalThis.window = previousWindow; }
});

test("sheep gallery fails safely for oversized and malformed raw data", () => {
  for (const raw of ["x".repeat(32 * 1024 + 1), JSON.stringify([{ id: "bad", pure: "yes" }, null, 4])]) {
    globalThis.localStorage = { getItem: () => raw };
    const game = harness();
    game.sheepPuzzleContract = { rounds: [{ id: "lighthouse" }] };
    assert.deepEqual(sheepLoadGallery.call(game), []);
  }
});

test("reward inventory ids do not derive from Date.now", () => {
  assert.doesNotMatch(source, /(?:iid|uid)\\s*:\\s*[^,\\n}]*Date\\.now/);
  assert.doesNotMatch(source, /Date\\.now\\s*\\([^)]*\\)[^\\n]*(?:iid|uid)/);
});

test("reset wiring cancels pending saves, removes storage, and restores a clean signature", () => {
  assert.match(source, /this\._suppressSave = true;/);
  assert.match(source, /this\._durableDirty = false;/);
  assert.match(source, /localStorage\.removeItem\(this\.durableStorageKey\)/);
  assert.match(source, /this\._durableSignature = this\.durableSignature\(this\.state\);\s*\n\s*this\._durableReferences = this\.durableKeys\.reduce/);
  assert.match(source, /this\._durableDirty = false;\s*\n\s*this\._suppressSave = false;/);
});

test("the extracted Component class remains syntactically valid", () => {
  const start = source.indexOf("class Component extends DCLogic {");
  assert.ok(start >= 0);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  let end = -1;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  assert.ok(end > bodyStart, "Component class closes");
  assert.doesNotThrow(() => Function("DCLogic", `return ${source.slice(start, end)}`)(class {}));
});

test("wiring keeps sheep out of the general contract and teardown owns save cleanup", () => {
  assert.match(source, /"dolphanArmed"/);
  assert.doesNotMatch(source.slice(source.indexOf("  durableKeys = ["), source.indexOf("\n  componentDidMount()")), /sheepSolvedGallery/);
  assert.equal((source.match(/componentWillUnmount\(\)/g) || []).length, 1);
  const teardown = source.slice(source.lastIndexOf("  componentWillUnmount()"));
  assert.match(teardown, /this\.flushDurableSave\(\);/);
  assert.match(teardown, /removeEventListener\("pagehide", this\._pagehide\)/);
  assert.match(source, /localStorage\.removeItem\(this\.durableStorageKey\)/);
});
