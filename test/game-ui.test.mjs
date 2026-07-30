import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gamePath = join(projectRoot, "project", "Adventure Scene.dc.html");
const bridgePath = join(projectRoot, "project", "ai-bridge.js");
const serverPath = join(projectRoot, "server.mjs");

function loadGameMethod(source, signature, nextSignature, context) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);

  assert.notEqual(start, -1, `missing method: ${signature.trim()}`);
  assert.notEqual(end, -1, `missing method boundary: ${nextSignature.trim()}`);

  const methodSource = source.slice(start, end).trim();
  const methodName = signature.match(/(?:async\s+)?([\w$]+)\s*\(/)?.[1];
  return vm.runInNewContext(`({${methodSource}}).${methodName}`, context);
}

test("the game exposes an agent for every visible character", async () => {
  const source = await readFile(gamePath, "utf8");
  const characterIds = [
    "moon", "seal", "octo", "badger", "otter", "gull",
    "crab", "cod", "sub", "sheep", "shrimp",
  ];

  for (const id of characterIds) {
    assert.match(source, new RegExp(`\\n    ${id}: \\{`), `missing ${id} persona`);
  }

  assert.match(source, /<sc-for list="\{\{ discoveredPersonaList \}\}" as="p"/);
  assert.match(source, /<option value="\{\{ p\.id \}\}">\{\{ p\.label \}\}<\/option>/);
  assert.match(source, /discoveredPersonaList: Object\.keys\(this\.personas\)/);
  assert.match(source, /\.filter\(\(id\) => S\.discovered\[id\]\)/);
  assert.match(source, /\.map\(\(id\) => \(\{ id, label: this\.personas\[id\]\.name \}\)\)/);

  assert.match(source, /else if \(charId === "crab"\) this\.setState/);
  assert.doesNotMatch(source, /charId === "crab" && this\.state\.moonState/);
  assert.match(source, /Skriv endast ren replikttext utan rollnamn, scenanvisningar, asterisker eller Markdown/);
  assert.match(source, /Tonen ska vara absurd och komisk, men karaktären tar sin egen situation på fullaste allvar/);
});

test("painting review and replay state use the production behavior", async () => {
  const source = await readFile(gamePath, "utf8");

  assert.match(source, /paintProgress: S\.paintIdx \+ 1/);
  assert.match(source, /OpenRouters bildgranskare/);
  assert.doesNotMatch(source, /painted > 400/);
  assert.match(source, /repairOctopus\(defId\)/);
  assert.match(source, /octoHealed: false/);
  assert.match(source, /crabWatered: false/);
  assert.match(source, /if \(this\.state\.crabWatered\)/);
  assert.match(source, /scheduleGameAction\(callback, delay\)/);
  assert.match(source, /this\.gameGeneration \+= 1/);
  assert.match(source, /pendingPickups = new Set\(\)/);
  assert.match(source, /if \(this\.pendingPickups\.has\(p\.uid\)\) return/);
  assert.match(source, /if \(this\.gameGeneration !== generation\)/);
  assert.match(source, /a\.oncancel = \(\) =>/);
  assert.match(source, /this\.pendingPickups\.clear\(\)/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => this\.goScene\("underwater"\)/);
  assert.match(source, /scene: "center"/);
  assert.match(source, /chatLogs = \{\}/);
});

test("AI chat replies are normalized before storage and display", async () => {
  const source = await readFile(gamePath, "utf8");
  const context = {
    clearInterval: () => {},
    setInterval: () => 1,
    window: {
      claude: {
        complete: async () => "Månen: *Gäsp*... Välkommen till mina tysta stränder.",
      },
    },
  };
  const sendChat = loadGameMethod(source, "  async sendChat() {", "\n  scrollChat() {", context);
  const game = {
    state: {
      chatInput: "Hej",
      chatBusy: false,
      chatChar: "moon",
      chatMsgs: [],
    },
    chatLogs: { moon: [] },
    chatGeneration: 0,
    charSystemPrompt: () => "Svara som månen.",
    scrollChat: () => {},
    setCharMouth: () => {},
    speakAs: async () => false,
    setState(update) {
      Object.assign(this.state, typeof update === "function" ? update(this.state) : update);
    },
  };

  await sendChat.call(game);

  assert.equal(game.chatLogs.moon.at(-1).text, "Gäsp... Välkommen till mina tysta stränder.");
  assert.equal(game.state.chatMsgs.at(-1).text, "Gäsp... Välkommen till mina tysta stränder.");
});

test("local painting response errors are distinct from an OpenRouter network error", async () => {
  const source = await readFile(gamePath, "utf8");

  async function reviewWith(reply) {
    const context = {
      window: { claude: { complete: async () => reply } },
    };
    const submitPainting = loadGameMethod(
      source,
      "  async submitPainting() {",
      "\n  octoClick(e) {",
      context,
    );
    const game = {
      state: { paintBusy: false, paintIdx: 0 },
      paintCanvasEl: {
        toDataURL: () => "data:image/png;base64,cGl4ZWw=",
      },
      paintGeneration: 0,
      paintTargets: [{ label: "en fisk" }],
      setState(update) {
        Object.assign(this.state, typeof update === "function" ? update(this.state) : update);
      },
    };

    await submitPainting.call(game);
    return game.state.paintVerdict;
  }

  const malformedJsonVerdict = await reviewWith("Det föreställer nog en fisk.");
  const invalidSchemaVerdict = await reviewWith('{"kommentar":"Fin fisk!"}');

  assert.match(malformedJsonVerdict, /bildgranskarens svar|bildgranskaren svarade/i);
  assert.match(invalidSchemaVerdict, /bildgranskarens svar|bildgranskaren svarade/i);
  assert.doesNotMatch(malformedJsonVerdict, /kan inte nå OpenRouters bildgranskare/i);
  assert.doesNotMatch(invalidSchemaVerdict, /kan inte nå OpenRouters bildgranskare/i);
});

test("the inventory is collapsible and camp navigation appears on hover", async () => {
  const source = await readFile(gamePath, "utf8");

  assert.match(source, /inventoryOpen: true/);
  assert.match(source, /aria-expanded="\{\{ inventoryOpen \}\}"/);
  assert.match(source, /<sc-if value="\{\{ inventoryOpen \}\}"/);
  assert.match(source, /inventoryToggle: \(\) => this\.setState/);
  assert.match(source, />NATTLÄGRET ↓<\/button>/);
  assert.match(source, /showArrowB: S\.scene !== "camp" && S\.scene !== "underwater"/);
  assert.match(source, /campNavVisible: S\.edgeB/);
  assert.match(source, /onFocus="\{\{ campNavFocus \}\}"/);
  assert.match(source, /style="\{\{ bottomNavButtonStyle \}\}"/);
  assert.match(source, /onMouseMove="\{\{ stagePointerMove \}\}"/);
  assert.match(source, /onPointerDown="\{\{ stagePointerDown \}\}"/);
  assert.match(source, /class="camp-nav"/);
  assert.match(source, /@media \(max-width: 760px\) and \(hover: none\), \(max-width: 760px\) and \(pointer: coarse\)/);
  assert.match(source, /\.camp-nav \{ left: auto !important; right: 10px !important/);
  assert.match(source, /bottomNavStyle: `[^`]*z-index:19/);
  assert.match(source, /p\.defId === "shard" \? 21 : hov \? 16 : 12/);
  assert.match(source, /stagePointerMove: \(e\) =>/);
  assert.match(source, /stagePointerDown: \(e\) =>/);
  assert.match(source, /if \(!touchNav\) return/);
  assert.match(source, /bottomNavStyle: `[^`]*pointer-events:none/);
  assert.match(source, /pointer-events:\$\{S\.edgeB \? "auto" : "none"\}/);
  assert.doesNotMatch(source, /opacity:\$\{S\.edgeB \|\| touchNav/);
  assert.match(source, /bottomNavStyle:/);
});

test("new image assets are preloaded and wired into runtime UI", async () => {
  const source = await readFile(gamePath, "utf8");

  assert.match(source, /"rope","fishing-line","cap","cork","patriks-currency-2024","gull-droppings"/);
  assert.match(source, /assets\/octo-splinted\.png/);
  assert.match(source, /assets\/patriks-currency-2024\.png/);
  assert.match(source, /assets\/gull-droppings\.png/);
  assert.match(source, /octoPatientSrc: S\.octoFrame === "splinted" \? "assets\/octo-splinted\.png" : "assets\/octo-open\.png"/);
  assert.match(source, /droppingsEl/);
  assert.doesNotMatch(source, /new_images/);
});

test("all puzzle objects, including the shrimp bottle, are available in the starting inventory", async () => {
  const source = await readFile(gamePath, "utf8");

  assert.match(source, /initialPlaced = \[\]/);
  for (const defId of ["key", "bucket", "shard", "camera", "briefcase", "flashlight-loaded", "battery", "driftwood", "fishline", "bottle", "helmet", "seaweed"]) {
    assert.match(source, new RegExp(`\\b${defId.replace("-", "\\-")}\\b`));
  }
  assert.match(source, /inventory: this\.initialInventory\.map/);
});

test("the scene artwork covers the full viewport", async () => {
  const source = await readFile(gamePath, "utf8");

  assert.match(source, /<div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center">/);
  assert.match(source, /stageStyle: `position:absolute;inset:0;background:/);
  assert.match(source, /center\/cover no-repeat/);
});

test("all player-facing copy and surfaced errors are Swedish", async () => {
  const [game, bridge, server] = await Promise.all([
    readFile(gamePath, "utf8"),
    readFile(bridgePath, "utf8"),
    readFile(serverPath, "utf8"),
  ]);

  assert.match(game, /<html lang="sv">/);
  assert.match(game, /<title>Det sjunkna äventyret<\/title>/);
  assert.match(game, /alt="Månen"/);
  assert.match(game, /alt="En krabba intrasslad i sjögräs"/);

  const foreignPlayerCopy = [
    "The moon",
    "A crab tangled in seaweed",
    "Speak with the octopus",
    "The octopus ponders",
    "The Moon",
    "Take the ",
    "Good evening old chap",
    "Smash the capital",
    "Splendidly repaired",
    "By Jove",
    "Mon ami",
    "Bonjour",
    "Magnifique",
    "BOSS",
  ];
  for (const text of foreignPlayerCopy) {
    assert.doesNotMatch(game, new RegExp(text, "i"), `foreign player copy remains: ${text}`);
  }

  assert.doesNotMatch(bridge, /AI request failed|AI service is unavailable|Painting image is too large/);
  assert.match(bridge, /AI-tjänsten är inte tillgänglig/);
  assert.doesNotMatch(server, /The AI provider|OpenRouter is not configured|Method not allowed/);
  assert.match(server, /OpenRouter är inte konfigurerat/);
});

test("the browser bridge posts sanitized requests and unwraps content", async () => {
  const source = await readFile(bridgePath, "utf8");
  const calls = [];
  const context = {
    window: {},
    fetch: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        json: async () => ({ content: "  Ett svar från månen.  " }),
      };
    },
  };
  vm.runInNewContext(source, context, { filename: bridgePath });

  const result = await context.window.claude.complete({
    system: "Stay in character.",
    messages: [{ role: "user", content: "Hej" }],
    max_tokens: 400,
  });

  assert.equal(result, "Ett svar från månen.");
  assert.equal(calls[0].url, "/api/complete");
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    system: "Stay in character.",
    messages: [{ role: "user", content: "Hej" }],
    max_tokens: 400,
  });
});

test("the browser bridge surfaces safe API errors", async () => {
  const source = await readFile(bridgePath, "utf8");
  const context = {
    window: {},
    fetch: async () => ({
      ok: false,
      json: async () => ({ error: { code: "service_unconfigured", message: "OpenRouter är inte konfigurerat." } }),
    }),
  };
  vm.runInNewContext(source, context, { filename: bridgePath });

  await assert.rejects(
    context.window.claude.complete({ messages: [{ role: "user", content: "Hej" }] }),
    /OpenRouter är inte konfigurerat/,
  );
});
