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
      discovered: {}, skedaGameOpen: false, skedaGameStep: 0,
      glodisGameOpen: false, glodisGameStep: 0, dolphanGameOpen: false,
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
  game.pickSkeda = loadMethod("  pickSkeda(step) {", "\n  openGlodisGame()").bind(game);
  game.openGlodisGame = loadMethod("  openGlodisGame() {", "\n  closeGlodisGame()").bind(game);
  game.pickGlodis = loadMethod("  pickGlodis(step) {", "\n  dolphanClick(e)").bind(game);
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
  assert.match(source, /name: "GLÖDIS", img: "assets\/glodis-console\.svg"/);
  assert.match(source, /name: "DOLPHAN LUNDGREN", img: "assets\/dolphan\.png"/);
  for (const asset of ["skeda-kahlo.svg", "glodis-console.svg", "dolphan.png", "dolphan-talking.png", "dolphan-buoy.png", "lifesaver-buoy.png"]) {
    assert.ok(source.includes(`assets/${asset}`), `${asset} must be wired into the scene`);
  }
  assert.deepEqual(
    [...consoleAsset.matchAll(/<circle[^>]+fill="([^"]+)"/g)].map(([, fill]) => fill),
    ["#8bb5ff", "#ffdc68", "#ff7188", "#8bb5ff"],
  );
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

test("Skeda's rhythm minigame resets on a miss and completes its full sequence", () => {
  const game = gameHarness();
  game.openSkedaGame();
  assert.equal(game.state.skedaGameOpen, true);
  assert.equal(game.state.discovered.skeda, true);
  game.pickSkeda(0);
  assert.equal(game.state.skedaGameStep, 0);
  assert.equal(game.state.skedaHelped, false);
  game.state.skedaGameStep = 3;
  game.openSkedaGame();
  assert.equal(game.state.skedaGameStep, 0);
  for (const step of [1, 2, 0, 2]) game.pickSkeda(step);
  assert.equal(game.state.skedaHelped, true);
  assert.equal(game.state.skedaGameOpen, false);
  assert.equal(game.state.skedaGameStep, 4);
  assert.equal(game._scheduled.length, 1, "winning must schedule the buoy reward");
  game._scheduled.forEach((cb) => cb());
  assert.ok(game.state.inventory.some((it) => it.defId === "buoy"), "Skeda must grant her old lifesaver buoy");
  const buoyCount = game.state.inventory.filter((it) => it.defId === "buoy").length;
  game._scheduled.forEach((cb) => cb());
  assert.equal(game.state.inventory.filter((it) => it.defId === "buoy").length, buoyCount, "reward must not duplicate the buoy");
});

test("Glödis's light-pattern minigame accepts the sequence declared by its controls", () => {
  const start = source.indexOf('<sc-if value="{{ glodisGameOpen }}"');
  const end = source.indexOf('<sc-if value="{{ dolphanGameOpen }}"', start);
  const markup = source.slice(start, end);
  const declaration = markup.match(/Återskapa mönstret: ([^.]+)\./)?.[1].split(/,\s*/);
  const controls = [...markup.matchAll(/onClick="\{\{ glodisPick(\d) \}\}" aria-label="([^\"]+)"/g)];
  const colorNames = ["blå", "gul", "röd", "lila"];
  const declaredSteps = declaration?.map((color) => {
    const control = controls.find(([, , label]) => label.toLowerCase().startsWith(`${color} `));
    assert.ok(control, `missing rendered control for ${color}`);
    return Number(control[1]);
  });
  assert.deepEqual(declaration, ["blå", "gul", "röd", "blå"]);
  assert.deepEqual(declaredSteps, [0, 1, 2, 0]);
  assert.deepEqual(colorNames.map((color) => controls.find(([, , label]) => label.toLowerCase().startsWith(`${color} `))?.[1]), ["0", "1", "2", "3"]);
  for (const modal of ["skeda-game", "glodis-game"]) {
    assert.match(source, new RegExp(`data-modal="${modal}"[\\s\\S]*?document\\.querySelector\\('\\[data-modal="${modal}"\\] button'\\)`));
  }
  // The dolphan rescue game focuses its keyboard stage instead of a button.
  assert.match(source, /data-modal="dolphan-game"/);
  assert.match(source, /initDolphanStage\(el\) \{[\s\S]*?el\.focus\?\.\(\)/);

  const game = gameHarness();
  game.openGlodisGame();
  game.pickGlodis(3);
  assert.equal(game.state.glodisGameStep, 0);
  assert.equal(game.state.glodisHelped, false);
  game.state.glodisGameStep = 2;
  game.openGlodisGame();
  assert.equal(game.state.glodisGameStep, 0);
  for (const step of declaredSteps) game.pickGlodis(step);
  assert.equal(game.state.discovered.glodis, true);
  assert.equal(game.state.glodisHelped, true);
  assert.equal(game.state.glodisGameOpen, false);
  assert.equal(game.state.glodisGameStep, 4);
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
