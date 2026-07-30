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
  const methodName = signature.match(/(?:async\s+)?([\w$]+)\s*\(/)?.[1];
  return vm.runInNewContext(`({${methodSource}}).${methodName}`, context);
}

test("shrimp modal exposes dialog, status, audio, keyboard, and text fallback semantics", () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="shrimp-game-title" aria-describedby="shrimp-game-help shrimp-game-status"/);
  assert.match(source, /id="shrimp-game-title"/);
  assert.match(source, /id="shrimp-game-help"/);
  assert.match(source, /id="shrimp-game-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /data-drop="shrimp" role="button" tabindex="0" aria-label="Öppna räkornas röstgåta" onClick="\{\{ shrimpClick \}\}" onKeyDown="\{\{ shrimpKeyDown \}\}"/);
  assert.match(source, /shrimpGameInputKeyDown/);
  assert.match(source, /shrimpGameRecordLabel/);
  assert.match(source, /shrimpGameSpeakLabel/);
  assert.match(source, /shrimp: S\.shrimpHelped/);
  assert.doesNotMatch(source, /shrimp: d\.shrimp/);
});

test("shrimp riddle matching is deterministic and the Greta shortcut wins immediately", async () => {
  const shrimpCurrentRiddle = loadMethod("  shrimpCurrentRiddle() {", "\n  shrimpNormalizeText(text) {");
  const shrimpNormalizeText = loadMethod("  shrimpNormalizeText(text) {", "\n  shrimpTextMatchesAnswer(text, answers = this.shrimpCurrentRiddle().answers) {");
  const shrimpTextMatchesAnswer = loadMethod("  shrimpTextMatchesAnswer(text, answers = this.shrimpCurrentRiddle().answers) {", "\n  shrimpMentionsGreta(text) {");
  const shrimpMentionsGreta = loadMethod("  shrimpMentionsGreta(text) {", "\n  shrimpSetStatus(message) {");
  const shrimpSetStatus = loadMethod("  shrimpSetStatus(message) {", "\n  openShrimpGame() {");
  const shrimpAdvanceRiddle = loadMethod("  async shrimpAdvanceRiddle(nextStep, reply) {", "\n  async shrimpWin(reason) {");
  const shrimpWin = loadMethod("  async shrimpWin(reason) {", "\n  async shrimpHandleAnswer(rawText, source = \"text\") {");
  const shrimpHandleAnswer = loadMethod("  async shrimpHandleAnswer(rawText, source = \"text\") {", "\n  shrimpClick(e) {");

  const spoken = [];
  const game = {
    state: {
      shrimpGameOpen: true,
      shrimpGameStep: 0,
      shrimpGameInput: "",
      shrimpGameTranscript: "",
      shrimpGameBusy: false,
      shrimpGameSolved: false,
      shrimpHelped: false,
      shrimpGameListening: false,
    },
    shrimpGameRiddles: [
      {
        prompt: "Jag har tangenter men inga lås. Vad är jag?",
        answers: ["piano", "ett piano"],
        hint: "Tänk på ett instrument som spelar när du trycker på tangenterna.",
        success: "Rätt. Räkorna slår i sina plåtskyltar.",
      },
      {
        prompt: "Ju mer du tar från mig, desto större blir jag. Vad är jag?",
        answers: ["hål", "ett hål"],
        hint: "Jag växer av tomrum.",
        success: "Rätt. Räkorna håller andan.",
      },
      {
        prompt: "Vilket ord stavas fel i ordboken?",
        answers: ["fel"],
        hint: "Svaret står och blinkar i frågan.",
        success: "Perfekt. Räkorna kapitulerar.",
      },
    ],
    setState(update) {
      const next = typeof update === "function" ? update(this.state) : update;
      this.state = { ...this.state, ...next };
    },
    shrimpSpeak: async (message) => {
      spoken.push(message);
    },
    shrimpGameSession: 1,
    shrimpCurrentRiddle,
    shrimpNormalizeText,
    shrimpTextMatchesAnswer,
    shrimpMentionsGreta,
    shrimpSetStatus,
    shrimpAdvanceRiddle,
    shrimpWin,
  };

  assert.equal(shrimpNormalizeText.call(game, "  Ett PIANO!  "), "ett piano");
  assert.equal(shrimpTextMatchesAnswer.call(game, "Det är ett piano.", ["piano"]), true);
  assert.equal(shrimpTextMatchesAnswer.call(game, "Det är en fiol.", ["piano"]), false);
  assert.equal(shrimpMentionsGreta.call(game, "Jag sa Greta Thunberg i förbifarten."), true);

  await shrimpHandleAnswer.call(game, "en fiol", "text");
  assert.equal(game.state.shrimpHelped, false);
  assert.match(game.state.shrimpGameMsg, /Tänk på ett instrument/);
  assert.equal(spoken.at(-1), game.state.shrimpGameMsg);

  spoken.length = 0;
  await shrimpHandleAnswer.call(game, "piano", "text");
  assert.equal(game.state.shrimpGameStep, 1);
  assert.equal(game.state.shrimpHelped, false);
  assert.match(game.state.shrimpGameMsg, /Nästa gåta/);
  assert.match(spoken.at(-1), /Nästa gåta/);

  spoken.length = 0;
  await shrimpHandleAnswer.call(game, "Greta Thunberg", "text");
  assert.equal(game.state.shrimpHelped, true);
  assert.equal(game.state.shrimpGameSolved, true);
  assert.match(game.state.shrimpGameMsg, /hemliga namnet/);
  assert.match(spoken.at(-1), /hemliga namnet/);
});
