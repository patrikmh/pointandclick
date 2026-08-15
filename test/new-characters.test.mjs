import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const gamePath = join(root, "project", "Adventure Scene.dc.html");
const consoleAssetPath = join(root, "project", "assets", "glodis-console.svg");
const source = await readFile(gamePath, "utf8");
const consoleAsset = await readFile(consoleAssetPath, "utf8");

function loadMethod(signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);
  assert.notEqual(start, -1, `missing production method: ${signature.trim()}`);
  assert.notEqual(end, -1, `missing method boundary: ${nextSignature.trim()}`);
  const methodSource = source.slice(start, end).trim();
  const name = signature.match(/([\w$]+)\s*\(/)[1];
  return vm.runInNewContext(`({${methodSource}}).${name}`);
}


function gameHarness() {
  const game = {
    state: {
      discovered: {}, skedaGameOpen: false, skedaGameStep: 0, skedaGameRound: 0, skedaGamePhase: "watch", skedaSequence: [],
      glodisGameOpen: false, glodisGameStep: 0, glodisGameRound: 0, glodisFaces: null, glodisTarget: null, dolphanGameOpen: false,
      skedaHelped: false, glodisHelped: false, dolphanHelped: false,
      inventory: [], dolphanArmed: false,
    },
    setState(update) {
      Object.assign(this.state, typeof update === "function" ? update(this.state) : update);
    },
    discoverChar(charId) {
      this.state.discovered[charId] = true;
    },
    say() {},
    sfx() {},
    _scheduled: [],
    scheduleGameAction(cb) { this._scheduled.push(cb); },
    tryUseSelectedItem() { return false; },
    _guideOrOpen(_key, proceed) { proceed(); },
    dolphanGameConfig: { throwCount: 8 },
  };
  game.openSkedaGame = loadMethod("  openSkedaGame() {", "\n  closeSkedaGame()").bind(game);
  game.closeSkedaGame = loadMethod("  closeSkedaGame() {", "\n  pickSkeda(step)").bind(game);
  game.pickSkeda = loadMethod("  pickSkeda(step) {", "\n  startSkedaRound()").bind(game);
  game.startSkedaRound = loadMethod("  startSkedaRound() {", "\n  playSkedaSequence()").bind(game);
  game.playSkedaSequence = loadMethod("  playSkedaSequence() {", "\n  flashSkedaAction(").bind(game);
  game.flashSkedaAction = loadMethod("  flashSkedaAction(a) {", "\n  openGlodisGame()").bind(game);
  game.openGlodisGame = loadMethod("  openGlodisGame() {", "\n  closeGlodisGame()").bind(game);
  game.closeGlodisGame = loadMethod("  closeGlodisGame() {", "\n  glodisRotated(faces, move)").bind(game);
  game.glodisRotated = loadMethod("  glodisRotated(faces, move) {", "\n  setupGlodisRound()").bind(game);
  game.setupGlodisRound = loadMethod("  setupGlodisRound() {", "\n  glodisRotate(move)").bind(game);
  game.glodisRotate = loadMethod("  glodisRotate(move) {", "\n  dolphanClick(e)").bind(game);
  game.dolphanClick = loadMethod("  dolphanClick(e) {", "\n  closeDolphanGame()").bind(game);
  game.pickDolphan = loadMethod("  pickDolphan(item) {", "\n  activateSceneCharacter(e, activate)").bind(game);
  return game;
}

test("the three new characters are placed in the intended scene, use matching art, and are keyboard controls", () => {
  assert.match(source, /data-drop="skeda" role="button" tabindex="0" aria-label="[^"]+" onClick="\{\{ openSkedaGame \}\}" onKeyDown="\{\{ skedaKeyDown \}\}"[\s\S]*?assets\/skeda-kahlo\.svg/);
  assert.match(source, /data-drop="glodis" role="button" tabindex="0" aria-label="[^"]+" onClick="\{\{ openGlodisGame \}\}" onKeyDown="\{\{ glodisKeyDown \}\}"[\s\S]*?assets\/glodis-console\.svg/);
  assert.match(source, /data-drop="dolphan" role="button" tabindex="0" aria-label="[^"]+" onClick="\{\{ dolphanClick \}\}" onKeyDown="\{\{ dolphanKeyDown \}\}"[\s\S]*?\{\{ dolphanSrc \}\}/);
  assert.match(source, /data-drop="skeda"[\s\S]*?assets\/skeda-kahlo\.svg/);
  assert.match(source, /data-drop="glodis"[\s\S]*?assets\/glodis-console\.svg/);
  assert.match(source, /data-drop="dolphan"[\s\S]*?\{\{ dolphanSrc \}\}/);
  assert.match(source, /name: "GLÖDIS", kind: "eldflugan", img: "assets\/glodis-console\.svg"/);
  assert.match(source, /name: "DOLPHAN LUNDGREN", kind: "delfinen", img: "assets\/dolphan\.png"/);
  for (const asset of ["skeda-kahlo.svg", "glodis-console.svg", "dolphan.png", "dolphan-talking.png", "dolphan-buoy.png", "lifesaver-buoy.png"]) {
    assert.ok(source.includes(`assets/${asset}`), `${asset} must be wired into the scene`);
  }
  assert.ok(consoleAsset.includes("url(#facet"), "the prism card must be built from shaded facets, not flat dots");
  for (const tone of ["#8bb5ff", "#ffdc68", "#ff7188"]) {
    assert.ok(consoleAsset.includes(tone), `the prism must keep the ${tone} face from the puzzle`);
  }
  assert.ok(!/<circle/.test(consoleAsset), "no flat lamp dots on the prism card");
});

test("new-character progress includes all personas and reset state fields", () => {
  const helpedCount = loadMethod("  helpedCount(S) {", "\n  toggleChat(").bind({});
  const game = gameHarness();
  assert.equal(helpedCount(game.state), 0);
  for (const helped of ["skedaHelped", "glodisHelped", "dolphanHelped"]) {
    game.state[helped] = true;
    assert.equal(helpedCount(game.state), ["skedaHelped", "glodisHelped", "dolphanHelped"].indexOf(helped) + 1);
  }
  for (const field of ["skedaHelped", "glodisHelped", "dolphanHelped", "skedaGameOpen", "skedaGameStep", "glodisGameOpen", "glodisGameStep", "dolphanGameOpen"]) {
    assert.match(source, new RegExp(`${field}: (?:false|0)`), `${field} must have a reset value`);
  }
  assert.match(source, /skeda: S\.skedaHelped[\s\S]*glodis: S\.glodisHelped[\s\S]*dolphan: S\.dolphanHelped/);
});

test("Skeda's cooking minigame runs three escalating recipe rounds and grants the buoy", () => {
  const game = gameHarness();
  const flush = () => { game._scheduled.splice(0).forEach((cb) => cb()); };
  game.openSkedaGame();
  assert.equal(game.state.skedaGameOpen, true);
  assert.equal(game.state.discovered.skeda, true);
  assert.equal(game.state.skedaGameRound, 0);
  flush();
  assert.equal(game.state.skedaGamePhase, "input", "the watch phase must hand over to the player");
  assert.equal(game.state.skedaSequence.length, 3, "round one is a three-step recipe");

  // A wrong ingredient spoils the pot and replays the recipe from a fresh watch phase.
  const wrong = (game.state.skedaSequence[0] + 1) % 6;
  game.pickSkeda(wrong);
  assert.equal(game.state.skedaGamePhase, "watch");
  assert.equal(game.state.skedaGameStep, 0);
  assert.equal(game.state.skedaHelped, false);
  flush();
  assert.equal(game.state.skedaGamePhase, "input");

  const cookRound = () => { for (const step of game.state.skedaSequence.slice()) game.pickSkeda(step); };
  cookRound();
  assert.equal(game.state.skedaGameRound, 1, "finishing a recipe advances to a longer round");
  flush();
  assert.equal(game.state.skedaSequence.length, 4, "recipes grow longer each round");
  cookRound();
  assert.equal(game.state.skedaGameRound, 2);
  flush();
  assert.equal(game.state.skedaSequence.length, 5);
  cookRound();

  assert.equal(game.state.skedaHelped, true);
  assert.equal(game.state.skedaGameOpen, false);
  flush();
  assert.ok(game.state.inventory.some((it) => it.defId === "buoy"), "Skeda must grant her old lifesaver buoy");
  const buoyCount = game.state.inventory.filter((it) => it.defId === "buoy").length;
  game._scheduled.forEach((cb) => cb());
  assert.equal(game.state.inventory.filter((it) => it.defId === "buoy").length, buoyCount, "reward must not duplicate the buoy");
});

test("Glödis's 3D prism puzzle rotates the crystal and solves three target orientations", () => {
  // The prism modal renders a real CSS-3D cube and keeps its focus target.
  const start = source.indexOf('<sc-if value="{{ glodisGameOpen }}"');
  const end = source.indexOf('<sc-if value="{{ dolphanGameOpen }}"', start);
  const markup = source.slice(start, end);
  assert.match(markup, /class="gcube"/, "the prism must render as a 3D cube");
  assert.equal((markup.match(/class="gcube-face"/g) || []).length, 6, "a cube has six faces");
  const rotControls = [...markup.matchAll(/onClick="\{\{ (glodis(?:Yaw|Pitch|Roll)\w*) \}\}" aria-label="([^\"]+)"/g)];
  assert.equal(rotControls.length, 6, "six rotation controls (three axes, both directions)");
  for (const modal of ["skeda-game", "glodis-game"]) {
    assert.match(source, new RegExp(`data-modal="${modal}"[\\s\\S]*?document\\.querySelector\\('\\[data-modal="${modal}"\\] button'\\)`));
  }
  // The dolphan rescue game focuses its keyboard stage instead of a button.
  assert.match(source, /data-modal="dolphan-game"/);
  assert.match(source, /initDolphanStage\(el\) \{[\s\S]*?el\.focus\?\.\(\)/);

  const game = gameHarness();
  const faceVec = (o) => [o.U, o.D, o.F, o.B, o.L, o.R];
  game.openGlodisGame();
  assert.equal(game.state.glodisGameOpen, true);
  assert.equal(game.state.discovered.glodis, true);
  assert.equal(game.state.glodisGameRound, 0);
  assert.deepEqual(faceVec(game.state.glodisFaces), [0, 5, 2, 3, 4, 1], "round one starts from the home orientation");

  // Rotations permute faces purely: yaw brings the right face to the front, keeps the top.
  const yawed = game.glodisRotated(game.state.glodisFaces, "yawRight");
  assert.equal(yawed.F, 1, "yaw brings the right face to the front");
  assert.equal(yawed.U, 0, "yaw keeps the top face in place");

  // A wrong rotation does not solve the round.
  game.glodisRotate("yawLeft");
  assert.equal(game.state.glodisGameRound, 0);
  assert.equal(game.state.glodisHelped, false);

  // Reopening resets the crystal and the round.
  game.openGlodisGame();
  assert.equal(game.state.glodisGameRound, 0);
  assert.deepEqual(faceVec(game.state.glodisFaces), [0, 5, 2, 3, 4, 1]);

  // Solve each round with its intended orientation sequence.
  game.glodisRotate("pitchBack");
  assert.equal(game.state.glodisGameRound, 1, "round one solved by tipping the red beam up");
  game.glodisRotate("yawRight");
  game.glodisRotate("pitchBack");
  assert.equal(game.state.glodisGameRound, 2);
  game.glodisRotate("rollRight");
  game.glodisRotate("yawRight");
  game.glodisRotate("pitchBack");
  assert.equal(game.state.glodisHelped, true, "all three orientations solved");
  assert.equal(game.state.glodisGameOpen, false);
});

test("scene character keyboard handlers activate each target once without native-click duplication", () => {
  const game = gameHarness();
  const calls = { skeda: 0, glodis: 0, dolphan: 0 };
  game.openSkedaGame = () => { calls.skeda += 1; };
  game.openGlodisGame = () => { calls.glodis += 1; };
  game.dolphanClick = () => { calls.dolphan += 1; };
  game.activateSceneCharacter = loadMethod("  activateSceneCharacter(e, activate) {", "\n  skedaKeyDown(e) {").bind(game);
  game.skedaKeyDown = loadMethod("  skedaKeyDown(e) {", "\n  glodisKeyDown(e) {").bind(game);
  game.glodisKeyDown = loadMethod("  glodisKeyDown(e) {", "\n  dolphanKeyDown(e) {").bind(game);
  game.dolphanKeyDown = loadMethod("  dolphanKeyDown(e) {", "\n  openDolphanGame() {").bind(game);

  for (const [handler, target] of [[game.skedaKeyDown, "skeda"], [game.glodisKeyDown, "glodis"], [game.dolphanKeyDown, "dolphan"]]) {
    const event = { key: "Enter", prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    handler(event);
    assert.equal(calls[target], 1);
    assert.equal(event.prevented, true);
    assert.equal(event.stopped, true);
  }
  const ignored = { key: "ArrowRight", preventDefault() { throw new Error("arrow key must not activate"); }, stopPropagation() { throw new Error("arrow key must not stop propagation"); } };
  game.skedaKeyDown(ignored);
});

test("Dolphan's rescue minigame rejects wrong gear and accepts the buoy", () => {
  const game = gameHarness();
  game.openDolphanGame = loadMethod("  openDolphanGame() {", "\n  initDolphanStage(el) {").bind(game);
  game.dolphanClick({ stopPropagation() {} });
  assert.equal(game.state.discovered.dolphan, true);
  assert.equal(game.state.dolphanGameOpen, false, "a plain click must hint, not open the rescue");
  game.pickDolphan("rope");
  assert.equal(game.state.dolphanHelped, false);
  assert.equal(game.state.dolphanGameOpen, false);
  game.pickDolphan("buoy");
  assert.equal(game.state.dolphanGameOpen, true);
  assert.equal(game.state.dolphanGameThrows, 8);
});
