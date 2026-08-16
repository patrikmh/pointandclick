import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(root, "project", "Adventure Scene.dc.html"), "utf8");

function method(signature, nextSignature, globals = {}) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);
  assert.ok(start >= 0 && end >= 0, `missing method ${signature}`);
  const text = source.slice(start, end).trim();
  const name = signature.match(/([\w$]+)\s*\(/)[1];
  return vm.runInNewContext(`({${text}}).${name}`, globals);
}

function game(state = {}) {
  return {
    state: { moonState: "awake", inventory: [], sonarRound: 0, sonarSolved: [], sonarOpen: true, ...state },
    uid: 100,
    nextUid: method("  nextUid() {", "\n\n  defs = {"),
    setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); },
    say(...args) { this.messages.push(args); },
    messages: [],
    sfx() {},
    teardownSonarGame: method("  teardownSonarGame() {", "\n  initSonarCanvas(element) {").bind(null),
  };
}

test("selected items survive navigation and reach the real otter and shrimp sequence", () => {
  const invSay = method("  invSay(defId, iid) {", "\n  trapModalFocus(");
  const goScene = method("  goScene(id) {", "\n  setUnderwaterAudio(", { document: { body: { classList: { remove() {} } } }, clearInterval() {} });
  const useSelected = method("  tryUseSelectedItem(target, e) {", "\n  useItemOn(defId, target, targetUid) {");
  const useItemOn = method("  useItemOn(defId, target, targetUid) {", "\n  repairOctopus(defId) {", { Audio: class { play() { return Promise.resolve(); } } });
  const state = {
    moonState: "awake",
    scene: "center",
    returnScene: "center",
    inventory: [
      { iid: "shard-1", defId: "shard" },
      { iid: "helmet-1", defId: "helmet" },
      { iid: "bottle-1", defId: "bottle" },
    ],
    selectedInventoryIid: null,
    otterAtelierUnlocked: false,
    otterCoutureDone: false,
    underwaterUnlocked: false,
  };
  const messages = [];
  const host = {
    state,
    defs: { shard: { name: "Glasskärva", desc: "" }, helmet: { name: "Dykhjälm", desc: "" }, bottle: { name: "Flaska", desc: "" } },
    messages,
    setState(update) { Object.assign(this.state, typeof update === "function" ? update(this.state) : update); },
    say(...args) { messages.push(args); },
    sfx() {},
    setUnderwaterAudio() {},
    _guideOrOpen(_key, proceed) { proceed(); },
    openShrimpGame() { messages.push(["shrimp-open"]); },
    scheduleGameAction(callback) { callback(); },
    otterAtelierInvite() {},
    discoverChar() {},
    useItemOn,
    goScene,
  };
  const event = { preventDefault() {}, stopPropagation() {} };
  invSay.call(host, "shard", "shard-1");
  goScene.call(host, "camp");
  goScene.call(host, "right");
  useSelected.call(host, "otter", event);
  assert.equal(state.otterAtelierUnlocked, true);
  assert.equal(state.selectedInventoryIid, null);

  invSay.call(host, "helmet", "helmet-1");
  goScene.call(host, "center");
  useSelected.call(host, "snorkel", event);
  assert.equal(state.underwaterUnlocked, true);
  assert.equal(state.scene, "underwater");

  invSay.call(host, "bottle", "bottle-1");
  useSelected.call(host, "shrimp", event);
  assert.equal(state.selectedInventoryIid, null);
  assert.deepEqual(messages.at(-1), ["shrimp-open"], "the bottle reaches shrimp without a dead-end interaction");
});

test("dynamic scene entities activate once from Enter and Space", () => {
  const activate = method("  activateSceneCharacter(e, activate) {", "\n  skedaKeyDown(e) {");
  const hotspot = method("  sceneHotspotKeyDown(e) {", "\n  crabLeave() {");
  for (const key of ["Enter", " "]) {
    const calls = [];
    const target = { dataset: { drop: "gull" } };
    const event = { key, currentTarget: target, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    const g = { gullClick() { calls.push("gull"); } };
    hotspot.call(g, event);
    assert.deepEqual(calls, ["gull"]);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
    let activated = 0;
    const activationEvent = { key, preventDefault() {}, stopPropagation() {} };
    activate.call({}, activationEvent, () => { activated += 1; });
    assert.equal(activated, 1);
  }
});

test("Dolphan helped state returns before opening a new modal", () => {
  const click = method("  dolphanClick(e) {", "\n  closeDolphanGame()");
  const g = game({ dolphanHelped: true });
  let setup = 0;
  g.setupCharacterModal = () => { setup += 1; };
  g.tryUseSelectedItem = () => false;
  click.call(g, { stopPropagation() {} });
  assert.equal(setup, 0);
  assert.equal(g.state.dolphanGameOpen, undefined);
  assert.match(g.messages[0][1], /legendarisk/);
});

test("optional audio is skipped while valid root audio resolves", () => {
  const audioAsset = method("  audioAsset(name, voice = true) {", "\n  playVoice(voiceId, charId) {");
  const g = { optionalAudioMissing: new Set(["cave-ambience", "narr-det-hander-ingenting", "narr-salen-ligger-och-slumrar-cigaretten"]) };
  assert.equal(audioAsset.call(g, "cave-ambience", false), "");
  assert.equal(audioAsset.call(g, "narr-det-hander-ingenting"), "");
  assert.equal(audioAsset.call(g, "ambience", false), "assets/ambience.mp3");
  assert.equal(audioAsset.call(g, "moon-snore"), "assets/moon-snore.mp3");
});

test("sonar final completion closes cleanly without a subTalk dependency", () => {
  const solve = method("  sonarSolveRound() {", "\n  sonarToggleMark()");
  const g = game({ sonarRound: 2 });
  g.sonarRound = () => g.sonarContract.rounds[g.state.sonarRound];
  g.sonarContract = { rounds: [
    { id: "a", label: "A", budget: 4 }, { id: "b", label: "B", budget: 4 }, { id: "c", label: "C", budget: 3 },
  ] };
  g.sonarPings = [{ x: 1, y: 1 }];
  g.sfx = () => {};
  g.teardownSonarGame = () => { g.tornDown = true; };
  solve.call(g);
  assert.equal(g.state.sonarOpen, false);
  assert.equal(g.state.subHelped, true);
  assert.equal(g.tornDown, true);
  assert.equal(g.state.sonarRound, 0);
  assert.equal(g.messages.length, 1);
});

test("flashlight and battery combine in either inventory order", () => {
  const combine = method("  combine(iidA, iidB) {", "\n  infoDefs = {");
  for (const inventory of [
    [{ iid: 1, defId: "flashlight" }, { iid: 2, defId: "battery" }],
    [{ iid: 2, defId: "battery" }, { iid: 1, defId: "flashlight" }],
  ]) {
    const g = game({ inventory });
    g.uid = 10;
    g.recipes = { "battery+flashlight": "flashlight-loaded" };
    g.defs = { "flashlight-loaded": { name: "Ficklampa" } };
    combine.call(g, 1, 2);
    assert.equal(g.state.inventory.map((item) => item.defId).join(","), "flashlight-loaded");
  }
});

test("gull bomb drop creates a droppings entity and consumes one bomb", () => {
  const children = [];
  const stage = { appendChild(node) { children.push(node); } };
  const document = { createElement() { return { style: {}, setAttribute() {}, appendChild() {} }; } };
  const globals = { performance: { now: () => 1000 }, document, Audio: class { play() { return Promise.resolve(); } } };
  const g = game({ gullGameBombs: 2 });
  Object.assign(g, { gullGameConfig: { throwCooldownMs: 0 }, gullGameStageEl: stage, gullPlane: { x: 30, y: 40 }, gullBombs: [], gullGameLastThrow: 0 });
  const drop = method("  dropGullBomb() {", "\n  spawnGullSplash(x, y, hit) {", globals);
  drop.call(g);
  assert.equal(g.state.gullGameBombs, 1);
  assert.equal(g.gullBombs.length, 1);
  assert.equal(children.length, 2);
  assert.equal(children[1].src, "assets/gull-droppings.png");
});

test("Web Animations are suppressed when reduced motion is requested", () => {
  const animate = method("  webAnimate(node, keyframes, options) {", "\n  sealPuffOnce()", { window: { matchMedia: () => ({ matches: true }) } });
  let called = 0;
  assert.equal(animate.call({}, { animate() { called += 1; } }, [], {}), null);
  assert.equal(called, 0);
});

test("seal challenge has an achievable three-shot balance", () => {
  const start = source.indexOf("  sealGameConfig = {");
  const end = source.indexOf("\n  sealGameOpen()", start);
  const config = source.slice(start, end);
  assert.match(config, /goodShotThreshold:\s*70/);
  assert.match(config, /shotsToWin:\s*3/);
  assert.match(config, /filmPerBatch:\s*8/);
});

test("moon keyboard wake requires directional reversals, not a single activation key", () => {
  const keyDown = method("  moonKeyDown(e) {", "\n  moonLeave()");
  const g = game({ moonState: "asleep" });
  g.wake = () => { g.woken = true; };
  g.setState = (update) => Object.assign(g.state, typeof update === "function" ? update(g.state) : update);
  const event = (key) => ({ key, preventDefault() {}, stopPropagation() {} });
  keyDown.call(g, event("Enter"));
  assert.equal(g.woken, undefined);
  ["ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight"].forEach((key) => keyDown.call(g, event(key)));
  assert.equal(g.woken, true);
});

test("gull keyboard accepts the browser Space key and keeps movement keys held", () => {
  const keyDown = method("  handleGullKeyDown(e) {", "\n  handleGullKeyUp(e) {");
  const g = game({ gullGameOpen: true });
  g.gullKeys = {};
  let drops = 0;
  g.dropGullBomb = () => { drops += 1; };
  const event = { key: "Space", repeat: false, preventDefault() { this.prevented = true; } };
  keyDown.call(g, event);
  assert.equal(drops, 1);
  assert.equal(event.prevented, true);
  keyDown.call(g, { key: "ArrowLeft", repeat: false, preventDefault() {} });
  assert.equal(g.gullKeys.left, true);
});

test("octopus splint controls settle either splint when entering its tolerance band", () => {
  const rotate = method("  octoRotateSplint(i, delta) {", "\n  octoClickAnchor(i)");
  const g = game({ octoGamePhase: 1, octoGameSplints: [{ rot: 15 }, { rot: -15 }] });
  g.octoGameConfig = { splintTargets: [0, 0], splintTolerance: 12 };
  g.octoAdvancePhase = () => {};
  rotate.call(g, 0, -11);
  assert.equal(g.state.octoGameSplints[0].rot, 0);
});

test("expanded camp keeps hotspot targets distinct from draggable inventory cards", () => {
  assert.match(source, /\.camp-target, \.camp-character \{ translate: 0 -14vh/);
  assert.match(source, /data-inv-bar=\"1\" style=\"position:absolute;left:0;right:0;bottom:0;z-index:30/);
  assert.match(source, /class=\"camp-character\" data-drop=\"badger\"/);
});

test("shrimp answer path retains deterministic fallback text when the bridge is absent", () => {
  const start = source.indexOf("  async shrimpHandleAnswer(rawText, source = \"voice\") {");
  const body = source.slice(start, source.indexOf("\n  shrimpClick(e)", start));
  assert.match(body, /assistantText = this\.shrimpBuildFallbackReply\(result\)/);
  assert.match(source, /if \(typeof window !== \"undefined\" && window\.speechSynthesis/);
});
