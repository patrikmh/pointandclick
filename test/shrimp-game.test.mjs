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

test("shrimp modal is voice-only with a single toggle control", () => {
  assert.match(source, /role="dialog" aria-modal="true" aria-labelledby="shrimp-game-title" aria-describedby="shrimp-game-help shrimp-game-status shrimp-game-prompt shrimp-game-history"/);
  assert.match(source, /id="shrimp-game-title"/);
  assert.match(source, /id="shrimp-game-help"/);
  assert.match(source, /Klicka Starta samtal och svara med röst/);
  assert.match(source, /en ung svensk klimatstridare kan också fälla bron direkt/);
  assert.match(source, /void this\.shrimpSpeak\(intro\);/);
  assert.match(source, /id="shrimp-game-status" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /id="shrimp-game-history" ref="\{\{ setShrimpConversationRef \}\}" role="log" aria-live="polite" aria-relevant="additions text" aria-atomic="false"/);
  assert.match(source, /shrimpGameMessages/);
  assert.match(source, /shrimpGameVoiceState/);
  assert.match(source, /shrimpGameToggle/);
  assert.match(source, /shrimpGameActive/);
  assert.match(source, /Starta samtal/);
  assert.match(source, /Stoppa samtal/);
  assert.match(source, /window\.claude\?\.shrimpConverse/);
  assert.match(source, /setShrimpConversationRef/);
  assert.match(source, /shrimp: S\.shrimpHelped/);
  assert.doesNotMatch(source, /shrimpGameSpeakLabel/);
  assert.doesNotMatch(source, /shrimpGameRecordLabel/);
  assert.doesNotMatch(source, /shrimpGameInputKeyDown/);
  assert.doesNotMatch(source, /shrimpGameSubmit/);
  assert.doesNotMatch(source, /Svara med text eller röst/);
  assert.doesNotMatch(source, /Hör gåtan/);
  assert.doesNotMatch(source, /Skriv svaret till räkan/);
  assert.doesNotMatch(source, /shrimp: d\.shrimp/);
});

test("shrimp answer resolution remains deterministic and sentence splitting supports TTS", () => {
  const shrimpCurrentRiddle = loadMethod("  shrimpCurrentRiddle() {", "\n  shrimpNormalizeText(text) {");
  const shrimpNormalizeText = loadMethod("  shrimpNormalizeText(text) {", "\n  shrimpTextMatchesAnswer(text, answers = this.shrimpCurrentRiddle().answers) {");
  const shrimpTextMatchesAnswer = loadMethod("  shrimpTextMatchesAnswer(text, answers = this.shrimpCurrentRiddle().answers) {", "\n  shrimpMentionsGreta(text) {");
  const shrimpMentionsGreta = loadMethod("  shrimpMentionsGreta(text) {", "\n  shrimpDetermineOutcome(text, step = this.state?.shrimpGameStep ?? 0) {");
  const shrimpDetermineOutcome = loadMethod("  shrimpDetermineOutcome(text, step = this.state?.shrimpGameStep ?? 0) {", "\n  shrimpBuildFallbackReply(result) {");
  const shrimpBuildFallbackReply = loadMethod("  shrimpBuildFallbackReply(result) {", "\n  shrimpSplitSentences(text) {");
  const shrimpSplitSentences = loadMethod("  shrimpSplitSentences(text) {", "\n  shrimpSetStatus(message) {");

  const game = {
    state: { shrimpGameStep: 0 },
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
    shrimpCurrentRiddle,
    shrimpNormalizeText,
    shrimpTextMatchesAnswer,
    shrimpMentionsGreta,
    shrimpDetermineOutcome,
    shrimpBuildFallbackReply,
    shrimpSplitSentences,
  };

  assert.equal(shrimpNormalizeText.call(game, "  Ett PIANO!  "), "ett piano");
  assert.equal(shrimpTextMatchesAnswer.call(game, "Det är ett piano.", ["piano"]), true);
  assert.equal(shrimpTextMatchesAnswer.call(game, "Det är en fiol.", ["piano"]), false);
  assert.equal(shrimpMentionsGreta.call(game, "Jag sa Greta Thunberg i förbifarten."), true);

  const wrong = shrimpDetermineOutcome.call(game, "en fiol", 0);
  const advance = shrimpDetermineOutcome.call(game, "piano", 0);
  const win = shrimpDetermineOutcome.call(game, "Greta Thunberg", 1);

  assert.equal(wrong.kind, "wrong");
  assert.equal(wrong.nextStep, 0);
  assert.equal(advance.kind, "advance");
  assert.equal(advance.nextStep, 1);
  assert.equal(win.kind, "win");
  assert.equal(win.nextStep, 3);
  assert.equal(win.reason, "greta");
  assert.match(shrimpBuildFallbackReply.call(game, wrong), /vallgraven väntar tålmodigt/);
  assert.match(shrimpBuildFallbackReply.call(game, advance), /portstenen skälver/);
  assert.match(shrimpBuildFallbackReply.call(game, win), /hemliga namnet/);
  const sentences = shrimpSplitSentences.call(game, "En. Två? Tre!");
  assert.match(source, /audio\.onended = settleAudio;/);
  assert.doesNotMatch(source, /audio\.onpause = cleanup/);
  assert.equal(sentences.length, 3);
  assert.equal(sentences[0], "En.");
  assert.equal(sentences[1], "Två?");
  assert.equal(sentences[2], "Tre!");
});

test("shrimp adaptive hints follow stored attempt count", () => {
  const shrimpAdaptiveHint = loadMethod("  shrimpAdaptiveHint() {", "\n  shrimpAppendConversationMessage(message) {");
  const game = {
    state: { shrimpGameStep: 0, shrimpGameAttempts: 0 },
    shrimpGameHintStages: [
      ["Lyssna efter ett instrument med svarta och vita nycklar.", "Tangenterna är svarta och vita, och salen svarar i toner när de trycks ner.", "Det är ett stort klaviaturinstrument som salen älskar. Det börjar på bokstaven P."],
      ["Jag växer av tomrum och tuggar i sten.", "Tänk på det som blir kvar när allt annat tagits bort; ju mer som försvinner, desto större blir det.", "Det finns i ostar, i strumpor och i gamla murar. Det börjar på bokstaven H."],
      ["Det gömmer sig mitt i frågan och blinkar som en lykta.", "Ordet i ordboken som aldrig kan bli rätt stavat, hur noga man än letar.", "Ordet är motsatsen till rätt. Tre bokstäver, och det börjar på F."],
    ],
    shrimpCurrentRiddle() {
      return { hint: "Basledtråd" };
    },
  };

  assert.equal(shrimpAdaptiveHint.call(game), "Lyssna efter ett instrument med svarta och vita nycklar.");
  game.state.shrimpGameAttempts = 1;
  assert.equal(shrimpAdaptiveHint.call(game), "Tangenterna är svarta och vita, och salen svarar i toner när de trycks ner.");
  game.state.shrimpGameAttempts = 9;
  assert.equal(shrimpAdaptiveHint.call(game), "Det är ett stort klaviaturinstrument som salen älskar. Det börjar på bokstaven P.");
});

test("shrimp opening greeting is voiced when the modal opens", () => {
  const openShrimpGame = loadMethod("  openShrimpGame() {", "\n  shrimpStartConversation() {");
  const spoken = [];
  const game = {
    state: { shrimpHelped: false },
    shrimpGameIntro: "Mellan murkrönet och det svarta vattnet står en åldrad räka på post. Tala lugnt, så öppnar hon sprickan i stenen.",
    teardownShrimpGame() {},
    setState(update) {
      this.state = { ...this.state, ...(typeof update === "function" ? update(this.state) : update) };
    },
    shrimpSpeak: async (text) => {
      spoken.push(text);
    },
    shrimpSound: null,
  };

  openShrimpGame.call(game);

  assert.equal(spoken[0], game.shrimpGameIntro);
});

test("shrimp conversation speaks streamed sentences once and falls back when no sentence event arrives", async () => {
  const window = {
    claude: {
      shrimpConverse: async (_input, { onEvent }) => {
        onEvent({ type: "meta", result: { kind: "advance" } });
        onEvent({ type: "sentence", text: "Första satsen." });
        onEvent({ type: "done", text: "Första satsen. Andra satsen." });
        return { text: "Första satsen. Andra satsen.", result: { kind: "advance" } };
      },
    },
  };
  const shrimpHandleAnswer = loadMethod("  async shrimpHandleAnswer(rawText, source = \"voice\") {", "\n  shrimpClick(e) {", { window, AbortController: globalThis.AbortController });
  const spoken = [];
  const game = {
    state: { shrimpGameOpen: true, shrimpGameBusy: false, shrimpGameSolved: false, shrimpGameStep: 0, shrimpGameMessages: [] },
    shrimpGameSession: 1,
    shrimpGameAttempts: 0,
    shrimpDetermineOutcome: () => ({ kind: "advance", step: 0, nextStep: 1, riddle: {}, nextRiddle: {} }),
    shrimpInterruptSpeech() {},
    setState(update, callback) {
      this.state = { ...this.state, ...(typeof update === "function" ? update(this.state) : update) };
      if (callback) callback();
    },
    shrimpScrollConversation() {},
    shrimpUpdateConversationMessage() {},
    shrimpFinalizeConversationTurn() {
      this.state = { ...this.state, shrimpGameBusy: false, shrimpGameListening: false };
    },
    shrimpBuildFallbackReply() { return "Fallbackrepliken."; },
    shrimpSpeak: async (text) => {
      spoken.push(text);
    },
    shrimpConversationAbort: null,
  };

  await shrimpHandleAnswer.call(game, "piano");
  assert.deepEqual(spoken, ["Första satsen."]);

  spoken.length = 0;
  window.claude.shrimpConverse = async (_input, { onEvent }) => {
    onEvent({ type: "meta", result: { kind: "wrong" } });
    onEvent({ type: "done", text: "Så blir det tyst." });
    return { text: "Så blir det tyst.", result: { kind: "wrong" } };
  };
  await shrimpHandleAnswer.call(game, "fisk");
  assert.deepEqual(spoken, ["Så blir det tyst."]);

  spoken.length = 0;
  delete window.claude;
  await shrimpHandleAnswer.call(game, "något annat");
  assert.deepEqual(spoken, ["Fallbackrepliken."]);
});
