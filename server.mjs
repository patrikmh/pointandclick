import { createReadStream } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const MAX_BODY_BYTES = 6 * 1024 * 1024;
export const MAX_TOKENS = 4_096;

const DEFAULT_CHAT_MODEL = "~google/gemini-flash-latest";
const DEFAULT_VISION_MODEL = "~google/gemini-flash-latest";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RATE_LIMIT = 30;
const DEFAULT_RATE_WINDOW_MS = 60_000;
const DEFAULT_ELEVENLABS_STT_MODEL = "scribe_v2";
const DEFAULT_ELEVENLABS_TTS_MODEL = "eleven_flash_v2_5";
const DEFAULT_ELEVENLABS_VOICE_ID = "Xb7hH8MSUJpSbSDYk0k2";
const DEFAULT_SHRIMP_STT_KEYTERMS = "piano, hål, fel, Greta Thunberg, räkor";
export const SHRIMP_SPEAKER_NAME = "Vallgravsräkan";
export const SHRIMP_RIDDLES = [
  {
    prompt: "Jag bär tangenter men inga lås, och ändå ekar salen när jag rör mig. Vad är jag?",
    answers: ["piano", "ett piano"],
    hint: "Lyssna efter ett instrument med svarta och vita nycklar.",
    success: "Rätt. Murens damm skälver i takt.",
  },
  {
    prompt: "Ju mer du tar från mig, desto större blir jag. Vad är jag?",
    answers: ["hål", "ett hål"],
    hint: "Jag växer av tomrum och tuggar i sten.",
    success: "Rätt. Vallgraven håller andan ett ögonblick.",
  },
  {
    prompt: "Vilket ord stavas fel i ordboken?",
    answers: ["fel"],
    hint: "Det gömmer sig mitt i frågan och blinkar som en lykta.",
    success: "Rätt. Portjärnet sjunger lågt.",
  },
];
const MAX_MESSAGES = 50;

export const SHRIMP_CHARACTER_BIBLE = {
  identity: {
    role: "portvakt vid fästningens vallgrav, på post sedan murarna var nya",
    world: "murkrönet, det svarta vattnet, dimman, portjärnet och mossan på stenarna",
    neighbors: "månen över takåsarna, sälens hyss, fårets skuggteater och bläckfiskens tentakler är gamla bekanta som bara nämns i förbifarten, aldrig vid namn",
  },
  voice: {
    style: "kort, torr och saltstänkt svenska med underdrifter, stilla hotfullhet och varm skämtsamhet under skorpan",
    signature: ["mellan stenarna", "salt och järn", "vattnet hör allt", "porten minns"],
    avoids: "inga moderna ord, inga rollnamn eller citattecken, inga långa utläggningar, aldrig skarp eller otålig",
  },
  arc: [
    "första gåtan nyfiket och lekfullt, som när vattnet slår mot en ny gäst",
    "andra gåtan prövande och skarpare, som tidvatten som letar efter svagheter",
    "tredje gåtan högtidligt och mörkt, som portjärnet en vinternatt",
  ],
  hintStages: [
    [
      SHRIMP_RIDDLES[0].hint,
      "Tangenterna är svarta och vita, och salen svarar i toner när de trycks ner.",
      "Det är ett stort klaviaturinstrument som salen älskar. Det börjar på bokstaven P.",
    ],
    [
      SHRIMP_RIDDLES[1].hint,
      "Tänk på det som blir kvar när allt annat tagits bort; ju mer som försvinner, desto större blir det.",
      "Det finns i ostar, i strumpor och i gamla murar. Det börjar på bokstaven H.",
    ],
    [
      SHRIMP_RIDDLES[2].hint,
      "Ordet i ordboken som aldrig kan bli rätt stavat, hur noga man än letar.",
      "Ordet är motsatsen till rätt. Tre bokstäver, och det börjar på F.",
    ],
  ],
  celebration: "lågmält jubel när porten ger vika; räkan gör honnör med en antenn och låter järnet sjunga",
};

export function shrimpHintLevel(attempts = 0) {
  const count = Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
  return Math.min(count, 2);
}

export function buildShrimpAdaptiveHint({ step = 0, attempts = 0 } = {}) {
  const riddleIndex = Number.isInteger(step) && step >= 0
    ? Math.min(step, SHRIMP_RIDDLES.length - 1)
    : 0;
  const stages = SHRIMP_CHARACTER_BIBLE.hintStages[riddleIndex] || [];
  const level = shrimpHintLevel(attempts);
  return stages[Math.min(level, stages.length - 1)] || SHRIMP_RIDDLES[riddleIndex].hint;
}

export function shrimpNormalizeText(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function shrimpTextMatchesAnswer(text, answers = []) {
  const normalized = shrimpNormalizeText(text);
  return (answers || []).some((answer) => {
    const target = shrimpNormalizeText(answer);
    if (!target) return false;
    return normalized === target
      || normalized.includes(` ${target} `)
      || normalized.startsWith(`${target} `)
      || normalized.endsWith(` ${target}`)
      || normalized.includes(target);
  });
}

export function shrimpMentionsGreta(text) {
  return shrimpNormalizeText(text).includes("greta thunberg");
}

export function classifyShrimpAnswer(text, step = 0) {
  const currentStep = Number.isInteger(step) && step >= 0 ? step : 0;
  const riddle = SHRIMP_RIDDLES[Math.min(currentStep, SHRIMP_RIDDLES.length - 1)];
  if (shrimpMentionsGreta(text)) {
    return {
      kind: "win",
      reason: "greta",
      step: currentStep,
      nextStep: SHRIMP_RIDDLES.length,
      riddle,
      nextRiddle: null,
    };
  }
  if (shrimpTextMatchesAnswer(text, riddle.answers)) {
    const nextStep = currentStep + 1;
    const nextRiddle = nextStep < SHRIMP_RIDDLES.length ? SHRIMP_RIDDLES[nextStep] : null;
    return nextStep >= SHRIMP_RIDDLES.length
      ? {
        kind: "win",
        reason: "riddles",
        step: currentStep,
        nextStep,
        riddle,
        nextRiddle,
      }
      : {
        kind: "advance",
        step: currentStep,
        nextStep,
        riddle,
        nextRiddle,
      };
  }
  return {
    kind: "wrong",
    step: currentStep,
    nextStep: currentStep,
    riddle,
    nextRiddle: currentStep + 1 < SHRIMP_RIDDLES.length ? SHRIMP_RIDDLES[currentStep + 1] : null,
  };
}

function splitShrimpSentences(text) {
  const sentences = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (!/[.!?…]/.test(text[i])) continue;
    let end = i + 1;
    while (end < text.length && /\s/.test(text[end])) end += 1;
    if (end < text.length) {
      const sentence = text.slice(start, end).trim();
      if (sentence) sentences.push(sentence);
      start = end;
      i = end - 1;
    }
  }
  return {
    sentences,
    remainder: text.slice(start),
  };
}

export function buildShrimpSystemPrompt({ outcome, step, riddle, nextRiddle, playerText, attempts = 0, recentPlayerTexts = [] }) {
  const nextStepLabel = Math.min(step + 1, SHRIMP_RIDDLES.length);
  const bible = SHRIMP_CHARACTER_BIBLE;
  const riddleIndex = Number.isInteger(step) && step >= 0
    ? Math.min(step, SHRIMP_RIDDLES.length - 1)
    : 0;
  const wrongAttempts = Number.isInteger(attempts) && attempts > 0 ? attempts : 0;
  const resultingAttempts = outcome.kind === "wrong" ? wrongAttempts + 1 : 0;
  const hintLevel = shrimpHintLevel(resultingAttempts);
  const adaptiveHint = buildShrimpAdaptiveHint({ step, attempts: resultingAttempts });
  const earlierTries = (recentPlayerTexts || [])
    .filter((text) => typeof text === "string" && text.trim() && text.trim() !== String(playerText ?? "").trim())
    .slice(-3);
  return [
    `Du är ${SHRIMP_SPEAKER_NAME}, en väderbiten räka som vakar som gammal portvakt vid en fästningsvallgrav.`,
    `Din bakgrund: ${bible.identity.role}. Din värld är ${bible.identity.world}; ${bible.identity.neighbors}.`,
    `Din röst är ${bible.voice.style}.`,
    `Väv sparsamt in dina kännetecken: ${bible.voice.signature.join(", ")}.`,
    `Undvik: ${bible.voice.avoids}.`,
    "Du är en originalfigur och ska inte efterlikna, citera eller låna rytm från någon känd tv-karaktär.",
    "Svara på ren svenska med högst tre korta meningar, utan rollnamn, citattecken, punktlistor eller markdown.",
    "Tonen ska vara gåtfull, lite torr och saltstänkt, med kort naturligt småprat som reagerar på spelarens ord.",
    "Variera uttrycket: första gåtan nyfiket, andra mer prövande, tredje högtidligt och mörkt.",
    `Just nu gäller: ${bible.arc[riddleIndex]}.`,
    "Du avgör aldrig om svaret är rätt, fel eller spelets läge; servern bestämmer alltid utgången.",
    `Utgången från servern är låst: kind=${outcome.kind}, reason=${outcome.reason || "none"}, steg=${nextStepLabel}/${SHRIMP_RIDDLES.length}.`,
    `Nuvarande gåta: ${riddle.prompt}`,
    `Ledtråd: ${riddle.hint}`,
    nextRiddle ? `Nästa gåta: ${nextRiddle.prompt}` : "Alla gåtor är lösta.",
    `Spelarens senaste ord: ${playerText}`,
    earlierTries.length
      ? `Spelaren har tidigare försökt med: ${earlierTries.join("; ")}. Hänvisa gärna kort till det utan att upprepa dig.`
      : "",
    outcome.kind === "wrong"
      ? `Svara vänligt med ett litet stickspår, aldrig med skarp tillrättavisning. Spelaren har nu gissat fel ${resultingAttempts} ${resultingAttempts === 1 ? "gång" : "gånger"} på den här gåtan. Väv in denna ledtråd på nivå ${hintLevel} av 2, utan att upprepa tidigare ledtrådar ordagrant: ${adaptiveHint}`
      : "",
    outcome.kind === "advance"
      ? "Bekräfta kort och för portvakten naturligt vidare mot nästa gåta."
      : "",
    outcome.kind === "win"
      ? "Fira lågmält. Om spelaren själv nämner det hemliga namnet på den unga svenska klimatstridaren, låt porten ge med sig utan att du avslöjar namnet först."
      : "",
  ].filter(Boolean).join(" ");
}

export function buildShrimpFallbackReply({ outcome, riddle, nextRiddle, hint }) {
  if (outcome.kind === "wrong") {
    const clue = typeof hint === "string" && hint.trim() ? hint.trim() : riddle.hint;
    return `Mellan stenarna hör jag att du är nära. ${clue} Försök igen; vallgraven väntar tålmodigt.`;
  }
  if (outcome.kind === "advance") {
    const transition = [
      "Bra där. Den första portstenen skälver.",
      "Rätt igen. Saltvinden drar vidare genom valvet.",
      "Så ja. Mörkret i portgången flyttar på sig.",
    ][Math.min(Number.isInteger(outcome.step) ? outcome.step : 0, 2)];
    return `${transition} ${riddle.success}${nextRiddle ? ` Nästa gåta: ${nextRiddle.prompt}` : ""}`;
  }
  if (outcome.reason === "greta") {
    return "Du sade det hemliga namnet. Räkan gör honnör och järnet ger vika.";
  }
  return "Tre rätt i rad. Porten gnisslar upp och räkan håller vakt i det öppna ljuset.";
}

const MAX_PARTS_PER_MESSAGE = 16;
const MAX_SYSTEM_CHARS = 100_000;
const MAX_TOTAL_TEXT_CHARS = 250_000;
const PROJECT_DIRECTORY = fileURLToPath(new URL("./project", import.meta.url));
const HTML_FILE = "Adventure Scene.dc.html";
const TEMPLATE_IMAGE_PLACEHOLDER = Buffer.from(
  "R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=",
  "base64",
);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".gif", "image/gif"],
  [".html", "text/html; charset=utf-8"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".m4a", "audio/mp4"],
  [".mp3", "audio/mpeg"],
  [".ogg", "audio/ogg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
  [".wav", "audio/wav"],
]);

const ALLOWED_IMAGE_TYPES = new Set([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : fallback;
}

function envValue(env, name, fallback = "") {
  const value = env[name];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function invalidRequest(message) {
  throw new ApiError(400, "invalid_request", message);
}

function validateTextPart(part, messageIndex, partIndex) {
  if (typeof part.text !== "string" || !part.text) {
    invalidRequest(`messages[${messageIndex}].content[${partIndex}].text måste vara en sträng som inte är tom.`);
  }
  return part.text.length;
}

function validateImagePart(part, messageIndex, partIndex) {
  const source = part.source;
  if (!isRecord(source) || source.type !== "base64") {
    invalidRequest(`messages[${messageIndex}].content[${partIndex}] måste innehålla en base64-kodad bildkälla.`);
  }
  if (!ALLOWED_IMAGE_TYPES.has(source.media_type)) {
    invalidRequest(`messages[${messageIndex}].content[${partIndex}] har en medietyp för bilder som inte stöds.`);
  }
  if (typeof source.data !== "string" || !source.data || source.data.length > MAX_BODY_BYTES) {
    invalidRequest(`messages[${messageIndex}].content[${partIndex}] innehåller ogiltiga bilddata.`);
  }
  if (source.data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(source.data)) {
    invalidRequest(`messages[${messageIndex}].content[${partIndex}] innehåller felaktigt formaterade base64-data för bilden.`);
  }
}

function validateMessage(message, messageIndex) {
  if (!isRecord(message) || !["assistant", "user"].includes(message.role)) {
    invalidRequest(`messages[${messageIndex}].role måste vara "user" eller "assistant".`);
  }
  if (typeof message.content === "string") {
    if (!message.content) {
      invalidRequest(`messages[${messageIndex}].content får inte vara tomt.`);
    }
    return message.content.length;
  }
  if (!Array.isArray(message.content) || message.content.length === 0) {
    invalidRequest(`messages[${messageIndex}].content måste vara en sträng eller en lista som inte är tom.`);
  }
  if (message.content.length > MAX_PARTS_PER_MESSAGE) {
    invalidRequest(`messages[${messageIndex}].content innehåller för många delar.`);
  }

  let textLength = 0;
  message.content.forEach((part, partIndex) => {
    if (!isRecord(part)) {
      invalidRequest(`messages[${messageIndex}].content[${partIndex}] måste vara ett objekt.`);
    }
    if (part.type === "text") {
      textLength += validateTextPart(part, messageIndex, partIndex);
      return;
    }
    if (part.type === "image") {
      validateImagePart(part, messageIndex, partIndex);
      return;
    }
    invalidRequest(`messages[${messageIndex}].content[${partIndex}] har en typ som inte stöds.`);
  });
  return textLength;
}

export function validateCompletionRequest(input) {
  if (!isRecord(input)) invalidRequest("Begärans innehåll måste vara ett JSON-objekt.");
  if (typeof input.system !== "string" || input.system.length > MAX_SYSTEM_CHARS) {
    invalidRequest(`system måste vara en sträng med högst ${MAX_SYSTEM_CHARS} tecken.`);
  }
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    invalidRequest("messages måste vara en lista som inte är tom.");
  }
  if (input.messages.length > MAX_MESSAGES) {
    invalidRequest(`messages får innehålla högst ${MAX_MESSAGES} poster.`);
  }
  if (!Number.isInteger(input.max_tokens) || input.max_tokens < 1 || input.max_tokens > MAX_TOKENS) {
    invalidRequest(`max_tokens måste vara ett heltal mellan 1 och ${MAX_TOKENS}.`);
  }

  let totalTextLength = input.system.length;
  input.messages.forEach((message, index) => {
    totalTextLength += validateMessage(message, index);
  });
  if (totalTextLength > MAX_TOTAL_TEXT_CHARS) {
    invalidRequest("Den sammanlagda textmängden är för stor.");
  }

  return {
    system: input.system,
    messages: input.messages,
    max_tokens: input.max_tokens,
  };
}

export function convertAnthropicMessages(messages) {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === "string"
      ? message.content
      : message.content.map((part) => {
        if (part.type === "text") return { type: "text", text: part.text };
        return {
          type: "image_url",
          image_url: {
            url: `data:${part.source.media_type};base64,${part.source.data}`,
          },
        };
      }),
  }));
}

export function requestHasImage(messages) {
  return messages.some((message) => Array.isArray(message.content)
    && message.content.some((part) => part.type === "image"));
}

export function normalizeChatCompletionsUrl(baseUrl) {
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ApiError(503, "service_unconfigured", "OpenRouters bas-URL är ogiltig.");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new ApiError(503, "service_unconfigured", "OpenRouters bas-URL är ogiltig.");
  }

  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/chat/completions")) {
    // The endpoint is already complete.
  } else if (pathname.endsWith("/v1")) {
    pathname += "/chat/completions";
  } else {
    pathname += "/v1/chat/completions";
  }
  parsed.pathname = pathname;
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

export function extractCompletionContent(payload) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return null;

  const text = content
    .filter((part) => isRecord(part)
      && ["text", "output_text"].includes(part.type)
      && typeof part.text === "string")
    .map((part) => part.text)
    .join("");
  return text.trim() ? text : null;
}

export function buildOpenRouterRequest(completion, env = process.env, { stream = false } = {}) {
  const apiKey = envValue(env, "OPENROUTER_API_KEY");
  if (!apiKey) {
    throw new ApiError(503, "service_unconfigured", "OpenRouter är inte konfigurerat.");
  }

  const vision = requestHasImage(completion.messages);
  const chatModel = envValue(env, "OPENROUTER_CHAT_MODEL", DEFAULT_CHAT_MODEL);
  const visionModel = envValue(env, "OPENROUTER_VISION_MODEL", DEFAULT_VISION_MODEL);
  const model = vision ? visionModel : chatModel;
  if (!model) {
    throw new ApiError(503, "service_unconfigured", "Den OpenRouter-modell som krävs har inte konfigurerats.");
  }

  const headers = {
    Accept: "application/json",
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  const siteUrl = envValue(env, "OPENROUTER_SITE_URL");
  const appName = envValue(env, "OPENROUTER_APP_NAME");
  if (siteUrl) headers["HTTP-Referer"] = siteUrl;
  if (appName) headers["X-Title"] = appName;

  const messages = convertAnthropicMessages(completion.messages);
  if (completion.system) messages.unshift({ role: "system", content: completion.system });

  return {
    url: normalizeChatCompletionsUrl(envValue(
      env,
      "OPENROUTER_BASE_URL",
      DEFAULT_OPENROUTER_BASE_URL,
    )),
    options: {
      method: "POST",
      headers,
      body: JSON.stringify({
        model,
        messages,
        max_tokens: completion.max_tokens,
        reasoning: { effort: "minimal", exclude: true },
        stream,
      }),
    },
  };
}

function normalizeShrimpKeyterms(value, fallback = []) {
  const rawTerms = Array.isArray(value)
    ? value
    : String(value ?? "")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
  const extraTerms = Array.isArray(fallback)
    ? fallback
    : String(fallback ?? "")
      .split(",")
      .map((term) => term.trim())
      .filter(Boolean);
  const seen = new Set();
  const terms = [];
  for (const rawTerm of [...rawTerms, ...extraTerms]) {
    const term = String(rawTerm ?? "").trim();
    if (!term || term.length > 50 || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
  }
  return terms;
}

function normalizeShrimpAudioBase64(input) {
  if (typeof input !== "string" || !input.trim()) {
    invalidRequest("audioBase64 måste vara en icke-tom sträng.");
  }
  const cleaned = input.trim();
  const base64 = cleaned.startsWith("data:") ? cleaned.slice(cleaned.indexOf(",") + 1) : cleaned;
  if (!base64 || base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    invalidRequest("audioBase64 innehåller ogiltiga base64-data.");
  }
  return Buffer.from(base64, "base64");
}

function buildElevenLabsScribeTokenRequest(env = process.env) {
  const apiKey = envValue(env, "ELEVENLABS_API_KEY");
  if (!apiKey) {
    throw new ApiError(503, "service_unconfigured", "ElevenLabs är inte konfigurerat.");
  }
  return {
    url: "https://api.elevenlabs.io/v1/single-use-token/realtime_scribe",
    options: {
      method: "POST",
      headers: { "xi-api-key": apiKey },
    },
  };
}

function buildElevenLabsSpeechRequest(text, env = process.env, character = "") {
  const apiKey = envValue(env, "ELEVENLABS_API_KEY");
  if (!apiKey) {
    throw new ApiError(503, "service_unconfigured", "ElevenLabs är inte konfigurerat.");
  }
  // Varje karaktär kan ha en egen röst; utan träff faller vi tillbaka på den globala.
  const characterKey = typeof character === "string" ? character.trim().toUpperCase() : "";
  const voiceId = (/^[A-Z]{2,12}$/.test(characterKey) ? envValue(env, `ELEVENLABS_VOICE_${characterKey}`, "") : "")
    || envValue(env, "ELEVENLABS_VOICE_ID", DEFAULT_ELEVENLABS_VOICE_ID);
  if (!voiceId) {
    throw new ApiError(503, "service_unconfigured", "ElevenLabs-rösten är inte konfigurerad.");
  }
  const speech = typeof text === "string" ? text.trim() : "";
  if (!speech || speech.length > 1_000) {
    invalidRequest("text måste vara en icke-tom sträng med högst 1000 tecken.");
  }

  return {
    url: `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
    options: {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: speech,
        model_id: envValue(env, "ELEVENLABS_TTS_MODEL", DEFAULT_ELEVENLABS_TTS_MODEL),
        language_code: "sv",
        voice_settings: {
          stability: 0.45,
          similarity_boost: 0.8,
          style: 0,
          use_speaker_boost: false,
          speed: 1.03,
        },
      }),
    },
  };
}

function buildElevenLabsTranscriptionRequest(input, env = process.env) {
  const apiKey = envValue(env, "ELEVENLABS_API_KEY");
  if (!apiKey) {
    throw new ApiError(503, "service_unconfigured", "ElevenLabs är inte konfigurerat.");
  }
  const audioBuffer = input?.audioBuffer;
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length < 1_000) {
    invalidRequest("Ljudinspelningen är för kort eller saknas.");
  }
  const mimeType = typeof input?.mimeType === "string" && input.mimeType.startsWith("audio/")
    ? input.mimeType
    : "audio/webm";
  const fileName = typeof input?.fileName === "string" && input.fileName.trim()
    ? input.fileName.trim().slice(0, 100)
    : "shrimp-answer.webm";
  const keyterms = normalizeShrimpKeyterms(input?.keyterms, envValue(env, "SHRIMP_STT_KEYTERMS", DEFAULT_SHRIMP_STT_KEYTERMS));
  const form = new FormData();
  form.append("model_id", envValue(env, "ELEVENLABS_STT_MODEL", DEFAULT_ELEVENLABS_STT_MODEL));
  form.append("language_code", "swe");
  form.append("tag_audio_events", "false");
  form.append("diarize", "false");
  form.append("no_verbatim", "true");
  for (const keyterm of keyterms) {
    form.append("keyterms", keyterm);
  }
  const file = typeof File === "function"
    ? new File([audioBuffer], fileName, { type: mimeType })
    : new Blob([audioBuffer], { type: mimeType });
  form.append("file", file, fileName);

  return {
    url: "https://api.elevenlabs.io/v1/speech-to-text",
    options: {
      method: "POST",
      headers: { "xi-api-key": apiKey },
      body: form,
    },
  };
}

async function requestElevenLabsJson(upstream, { env, fetchImpl }) {
  const timeoutMs = positiveInteger(
    env.UPSTREAM_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(upstream.url, {
      ...upstream.options,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(504, "upstream_timeout", "ElevenLabs svarade inte i tid.");
    }
    throw new ApiError(502, "upstream_unavailable", "ElevenLabs kunde inte nås.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    const status = response?.status === 429 ? 503 : 502;
    throw new ApiError(status, "upstream_error", "ElevenLabs returnerade ett fel.");
  }

  try {
    return await response.json();
  } catch {
    throw new ApiError(502, "invalid_upstream_response", "ElevenLabs returnerade ett ogiltigt svar.");
  }
}

async function requestElevenLabsSpeech(text, { env, fetchImpl, character = "" }) {
  const upstream = buildElevenLabsSpeechRequest(text, env, character);
  const timeoutMs = positiveInteger(
    env.UPSTREAM_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(upstream.url, {
      ...upstream.options,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(504, "upstream_timeout", "ElevenLabs svarade inte i tid.");
    }
    throw new ApiError(502, "upstream_unavailable", "ElevenLabs kunde inte nås.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    const status = response?.status === 429 ? 503 : 502;
    throw new ApiError(status, "upstream_error", "ElevenLabs returnerade ett fel.");
  }

  try {
    return Buffer.from(await response.arrayBuffer());
  } catch {
    throw new ApiError(502, "invalid_upstream_response", "ElevenLabs returnerade ett ogiltigt svar.");
  }
}

async function requestElevenLabsTranscription(input, { env, fetchImpl }) {
  const upstream = buildElevenLabsTranscriptionRequest(input, env);
  const payload = await requestElevenLabsJson(upstream, { env, fetchImpl });
  const text = typeof payload?.text === "string" ? payload.text.trim() : "";
  if (!text) {
    throw new ApiError(502, "invalid_upstream_response", "ElevenLabs returnerade ingen text.");
  }
  return {
    text,
    language_code: payload.language_code,
    language_probability: payload.language_probability,
  };
}

async function requestElevenLabsScribeToken({ env, fetchImpl }) {
  const upstream = buildElevenLabsScribeTokenRequest(env);
  const payload = await requestElevenLabsJson(upstream, { env, fetchImpl });
  const token = typeof payload?.token === "string" ? payload.token.trim() : "";
  if (!token) {
    throw new ApiError(502, "invalid_upstream_response", "ElevenLabs returnerade ingen token.");
  }
  return token;
}

export function createRateLimiter({ limit, windowMs, now = Date.now }) {
  const clients = new Map();
  return (clientId) => {
    const currentTime = now();
    const existing = clients.get(clientId);
    if (!existing || existing.resetAt <= currentTime) {
      clients.set(clientId, { count: 1, resetAt: currentTime + windowMs });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (existing.count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - currentTime) / 1_000)),
      };
    }
    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

export function resolveStaticPath(projectDirectory, requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch {
    throw new ApiError(400, "invalid_path", "Sökvägen i begäran är felaktigt formaterad.");
  }
  if (decoded.includes("\0") || decoded.includes("\\")) {
    throw new ApiError(403, "forbidden", "Den begärda sökvägen är inte tillåten.");
  }
  const segments = decoded.split("/");
  if (segments.includes("..")) {
    throw new ApiError(403, "forbidden", "Den begärda sökvägen är inte tillåten.");
  }

  const relativePath = decoded === "/"
    ? HTML_FILE
    : decoded.replace(/^\/+/, "");
  const root = path.resolve(projectDirectory);
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
    throw new ApiError(403, "forbidden", "Den begärda sökvägen är inte tillåten.");
  }
  return target;
}

function requestPath(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("/")) {
    throw new ApiError(400, "invalid_path", "Sökvägen i begäran är felaktigt formaterad.");
  }
  return rawUrl.split(/[?#]/, 1)[0];
}

export function isTemplateImagePath(rawPath) {
  try {
    return /^\/\{\{\s*[A-Za-z_$][\w$]*\s*\}\}$/.test(decodeURIComponent(rawPath));
  } catch {
    return false;
  }
}

function serveTemplateImagePlaceholder(req, res) {
  res.writeHead(200, {
    "Cache-Control": "no-store",
    "Content-Length": TEMPLATE_IMAGE_PLACEHOLDER.length,
    "Content-Type": "image/gif",
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  res.end(TEMPLATE_IMAGE_PLACEHOLDER);
}

async function readJsonBody(req) {
  const contentType = String(req.headers["content-type"] ?? "").toLowerCase();
  if (!contentType.startsWith("application/json")) {
    req.resume();
    throw new ApiError(415, "unsupported_media_type", "Content-Type måste vara application/json.");
  }
  if (req.headers["content-encoding"] && req.headers["content-encoding"] !== "identity") {
    req.resume();
    throw new ApiError(415, "unsupported_media_type", "Komprimerade begäranden stöds inte.");
  }

  const declaredLength = Number(req.headers["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    req.resume();
    throw new ApiError(413, "payload_too_large", "Begärans innehåll är för stort.");
  }

  const chunks = [];
  let bytes = 0;
  const rawBody = await new Promise((resolve, reject) => {
    let finished = false;
    const fail = (error) => {
      if (finished) return;
      finished = true;
      reject(error);
    };
    req.on("data", (chunk) => {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) {
        chunks.length = 0;
        fail(new ApiError(413, "payload_too_large", "Begärans innehåll är för stort."));
        return;
      }
      if (!finished) chunks.push(chunk);
    });
    req.on("end", () => {
      if (finished) return;
      finished = true;
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
    req.on("error", () => fail(new ApiError(400, "invalid_request", "Begärans innehåll kunde inte läsas.")));
  });

  try {
    return JSON.parse(rawBody);
  } catch {
    throw new ApiError(400, "invalid_json", "Begärans innehåll måste vara giltig JSON.");
  }
}

function sendJson(res, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": Buffer.byteLength(body),
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(body);
}

function sendBinary(res, status, payload, contentType, extraHeaders = {}) {
  res.writeHead(status, {
    "Cache-Control": "no-store",
    "Content-Length": payload.length,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  res.end(payload);
}

function sendApiError(res, error) {
  const safeError = error instanceof ApiError
    ? error
    : new ApiError(500, "internal_error", "Ett internt serverfel inträffade.");
  sendJson(res, safeError.status, {
    error: { code: safeError.code, message: safeError.message },
  });
}

async function requestOpenRouter(completion, { env, fetchImpl }) {
  const upstream = buildOpenRouterRequest(completion, env);
  const timeoutMs = positiveInteger(
    env.UPSTREAM_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(upstream.url, {
      ...upstream.options,
      signal: controller.signal,
    });
  } catch {
    if (controller.signal.aborted) {
      throw new ApiError(504, "upstream_timeout", "AI-leverantören svarade inte i tid.");
    }
    throw new ApiError(502, "upstream_unavailable", "AI-leverantören kunde inte nås.");
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    const status = response?.status === 429 ? 503 : 502;
    throw new ApiError(status, "upstream_error", "AI-leverantören returnerade ett fel.");
  }

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError(502, "invalid_upstream_response", "AI-leverantören returnerade ett ogiltigt svar.");
  }
  const content = extractCompletionContent(payload);
  if (content === null) {
    throw new ApiError(502, "invalid_upstream_response", "AI-leverantörens svar innehöll ingen text.");
  }
  return content;
}

function writeNdjsonLine(res, payload) {
  res.write(`${JSON.stringify(payload)}\n`);
}

function encodeAudioBase64(buffer) {
  return Buffer.isBuffer(buffer) ? buffer.toString("base64") : Buffer.from(buffer || []).toString("base64");
}

function extractOpenRouterStreamDelta(payload) {
  const choice = payload?.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content ?? payload?.output_text ?? "";
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((part) => isRecord(part) && typeof part.text === "string")
      .map((part) => part.text)
      .join("");
  }
  return "";
}

async function requestOpenRouterStream(completion, { env, fetchImpl, onDelta, onSentence }) {
  const upstream = buildOpenRouterRequest(completion, env, { stream: true });
  const timeoutMs = positiveInteger(
    env.UPSTREAM_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS,
    1_000,
    120_000,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(upstream.url, {
      ...upstream.options,
      signal: controller.signal,
    });
  } catch {
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new ApiError(504, "upstream_timeout", "AI-leverantören svarade inte i tid.");
    }
    throw new ApiError(502, "upstream_unavailable", "AI-leverantören kunde inte nås.");
  }

  if (!response?.ok) {
    clearTimeout(timeout);
    const status = response?.status === 429 ? 503 : 502;
    throw new ApiError(status, "upstream_error", "AI-leverantören returnerade ett fel.");
  }

  if (!response.body) {
    const payload = await response.json().catch(() => null);
    const content = extractCompletionContent(payload);
    if (typeof content !== "string" || !content.trim()) {
      throw new ApiError(502, "invalid_upstream_response", "AI-leverantörens svar innehöll ingen text.");
    }
    if (typeof onDelta === "function") onDelta(content);
    if (typeof onSentence === "function") {
      const { sentences, remainder } = splitShrimpSentences(content);
      sentences.forEach((sentence) => onSentence(sentence));
      if (remainder.trim()) onSentence(remainder.trim());
    }
    clearTimeout(timeout);
    return content;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let fullText = "";
  let sentenceBuffer = "";
  const flushSentences = (final = false) => {
    const { sentences, remainder } = splitShrimpSentences(sentenceBuffer);
    sentences.forEach((sentence) => {
      if (typeof onSentence === "function") onSentence(sentence);
    });
    sentenceBuffer = final ? remainder : remainder;
    if (final && sentenceBuffer.trim() && typeof onSentence === "function") {
      onSentence(sentenceBuffer.trim());
      sentenceBuffer = "";
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) >= 0) {
        const eventText = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = eventText
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) continue;
        if (data === "[DONE]") continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = extractOpenRouterStreamDelta(payload);
        if (!delta) continue;
        fullText += delta;
        sentenceBuffer += delta;
        if (typeof onDelta === "function") onDelta(delta);
        flushSentences(false);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) {
      const chunks = buffer.split(/\n\n+/).map((part) => part.trim()).filter(Boolean);
      for (const chunk of chunks) {
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data || data === "[DONE]") continue;
        let payload;
        try {
          payload = JSON.parse(data);
        } catch {
          continue;
        }
        const delta = extractOpenRouterStreamDelta(payload);
        if (!delta) continue;
        fullText += delta;
        sentenceBuffer += delta;
        if (typeof onDelta === "function") onDelta(delta);
        flushSentences(false);
      }
    }
    flushSentences(true);
  } catch {
    reader.cancel().catch(() => {});
    clearTimeout(timeout);
    if (controller.signal.aborted) {
      throw new ApiError(504, "upstream_timeout", "AI-leverantörens svar tog för lång tid.");
    }
    throw new ApiError(502, "invalid_upstream_response", "AI-leverantörens ström avbröts eller var ogiltig.");
  }

  clearTimeout(timeout);
  return fullText.trim();
}

async function serveStatic(req, res, projectDirectory, rawPath, realProjectDirectory) {
  const target = resolveStaticPath(projectDirectory, rawPath);
  let fileStats;
  let realTarget;
  try {
    [fileStats, realTarget] = await Promise.all([stat(target), realpath(target)]);
  } catch {
    throw new ApiError(404, "not_found", "Filen hittades inte.");
  }
  if (!fileStats.isFile()) throw new ApiError(404, "not_found", "Filen hittades inte.");
  if (realTarget !== realProjectDirectory
    && !realTarget.startsWith(`${realProjectDirectory}${path.sep}`)) {
    throw new ApiError(403, "forbidden", "Den begärda sökvägen är inte tillåten.");
  }

  const contentType = MIME_TYPES.get(path.extname(realTarget).toLowerCase())
    ?? "application/octet-stream";
  res.writeHead(200, {
    "Cache-Control": rawPath === "/" || realTarget.endsWith(".html")
      ? "no-cache"
      : "public, max-age=3600",
    "Content-Length": fileStats.size,
    "Content-Type": contentType,
    "X-Content-Type-Options": "nosniff",
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(realTarget).pipe(res);
}

function validateShrimpConversationRequest(input) {
  if (!isRecord(input)) invalidRequest("Begärans innehåll måste vara ett JSON-objekt.");
  if (!Array.isArray(input.messages) || input.messages.length === 0) {
    invalidRequest("messages måste vara en lista som inte är tom.");
  }
  if (!Number.isInteger(input.step) || input.step < 0 || input.step >= SHRIMP_RIDDLES.length) {
    invalidRequest(`step måste vara ett heltal mellan 0 och ${SHRIMP_RIDDLES.length - 1}.`);
  }

  const messages = input.messages.slice(-24).map((message, index) => {
    if (!isRecord(message) || !["user", "assistant"].includes(message.role)) {
      invalidRequest(`messages[${index}].role måste vara \"user\" eller \"assistant\".`);
    }
    const text = typeof message.text === "string" ? message.text.trim() : "";
    if (!text) {
      invalidRequest(`messages[${index}].text måste vara en icke-tom sträng.`);
    }
    return {
      role: message.role,
      text: text.slice(0, 4_000),
    };
  });
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  if (!lastUser) {
    invalidRequest("messages måste innehålla minst ett användarvarv.");
  }
  const attempts = Number.isInteger(input.attempts) && input.attempts >= 0
    ? Math.min(input.attempts, 99)
    : 0;
  return {
    step: input.step,
    attempts,
    messages,
    playerText: lastUser.text,
  };
}

export function createAdventureServer({
  env = process.env,
  fetchImpl = globalThis.fetch,
  projectDir = PROJECT_DIRECTORY,
  now = Date.now,
} = {}) {
  const rateLimit = positiveInteger(
    env.RATE_LIMIT_MAX_REQUESTS,
    DEFAULT_RATE_LIMIT,
    1,
    10_000,
  );
  const rateWindowMs = positiveInteger(
    env.RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_WINDOW_MS,
    1_000,
    3_600_000,
  );
  const checkRateLimit = createRateLimiter({ limit: rateLimit, windowMs: rateWindowMs, now });
  const realProjectDirectory = realpath(projectDir);
  const enforceUpstreamRateLimit = (req, res) => {
    const clientIp = req.socket.remoteAddress || "unknown";
    const rate = checkRateLimit(clientIp);
    if (rate.allowed) return true;
    req.resume();
    sendJson(res, 429, {
      error: {
        code: "rate_limited",
        message: "För många AI-anrop. Försök igen om en liten stund.",
      },
    }, { "Retry-After": String(rate.retryAfterSeconds) });
    return false;
  };

  return http.createServer(async (req, res) => {
    try {
      const pathname = requestPath(req.url);
      if (pathname === "/healthz") {
        if (req.method !== "GET") {
          throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
        }
        const openrouterKey = envValue(env, "OPENROUTER_API_KEY");
        const chatModel = envValue(env, "OPENROUTER_CHAT_MODEL", DEFAULT_CHAT_MODEL);
        const visionModel = envValue(env, "OPENROUTER_VISION_MODEL", DEFAULT_VISION_MODEL);
        const elevenLabsKey = envValue(env, "ELEVENLABS_API_KEY");
        const elevenLabsVoice = envValue(env, "ELEVENLABS_VOICE_ID", DEFAULT_ELEVENLABS_VOICE_ID);
        sendJson(res, 200, {
          status: "ok",
          openrouter: {
            configured: Boolean(openrouterKey),
            chatReady: Boolean(openrouterKey && chatModel),
            visionReady: Boolean(openrouterKey && visionModel),
          },
          elevenlabs: {
            configured: Boolean(elevenLabsKey),
            transcriptionReady: Boolean(elevenLabsKey),
            speechReady: Boolean(elevenLabsKey && elevenLabsVoice),
          },
        });
        return;
      }

      if (pathname === "/api/shrimp/scribe-token") {
        if (req.method !== "GET") {
          throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
        }
        if (!enforceUpstreamRateLimit(req, res)) return;
        if (typeof fetchImpl !== "function") {
          throw new ApiError(503, "service_unconfigured", "Det finns ingen tillgänglig HTTP-klient för anslutning till ElevenLabs.");
        }
        const token = await requestElevenLabsScribeToken({ env, fetchImpl });
        sendJson(res, 200, { token });
        return;
      }

      if (pathname === "/api/shrimp/converse") {
        if (req.method !== "POST") {
          throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
        }
        if (!enforceUpstreamRateLimit(req, res)) return;
        const body = validateShrimpConversationRequest(await readJsonBody(req));
        const outcome = classifyShrimpAnswer(body.playerText, body.step);
        const riddle = outcome.riddle;
        const nextRiddle = outcome.nextRiddle;
        const resultingAttempts = outcome.kind === "wrong" ? body.attempts + 1 : 0;
        const adaptiveHint = buildShrimpAdaptiveHint({ step: body.step, attempts: resultingAttempts });
        const recentPlayerTexts = body.messages
          .filter((message) => message.role === "user")
          .map((message) => message.text)
          .slice(-4);
        const system = buildShrimpSystemPrompt({
          outcome,
          step: body.step,
          riddle,
          nextRiddle,
          playerText: body.playerText,
          attempts: body.attempts,
          recentPlayerTexts,
        });
        const completion = {
          system,
          messages: body.messages.map((message) => ({ role: message.role, content: message.text })),
          max_tokens: 220,
        };

        res.writeHead(200, {
          "Cache-Control": "no-store",
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "X-Content-Type-Options": "nosniff",
        });
        res.flushHeaders?.();
        writeNdjsonLine(res, {
          type: "meta",
          result: outcome,
          attempts: resultingAttempts,
          hintLevel: shrimpHintLevel(resultingAttempts),
        });

        let streamedText = "";
        const sentenceAudioJobs = [];
        // Each sentence is announced immediately for subtitles, then its TTS is synthesized
        // concurrently and emitted inline as soon as it resolves. Interleaving audio with the
        // ongoing stream keeps time-to-first-audio low; the job list is awaited below so the
        // terminal `done` event always lands after every audio/tts_error line.
        const emitSentence = (text) => {
          const sentence = String(text ?? "").trim();
          if (!sentence) return;
          writeNdjsonLine(res, { type: "sentence", text: sentence });
          sentenceAudioJobs.push(
            requestElevenLabsSpeech(sentence, { env, fetchImpl, character: "shrimp" })
              .then((audio) => {
                writeNdjsonLine(res, { type: "audio", text: sentence, audio_base64: encodeAudioBase64(audio) });
              })
              .catch((error) => {
                writeNdjsonLine(res, { type: "tts_error", text: sentence, error: error?.code || error?.message || "tts_error" });
              }),
          );
        };
        try {
          if (typeof fetchImpl === "function" && envValue(env, "OPENROUTER_API_KEY")) {
            await requestOpenRouterStream(completion, {
              env,
              fetchImpl,
              onDelta: (delta) => {
                streamedText += delta;
                writeNdjsonLine(res, { type: "delta", text: delta });
              },
              onSentence: emitSentence,
            });
          }
          if (!streamedText.trim()) {
            streamedText = buildShrimpFallbackReply({ outcome, riddle, nextRiddle, hint: adaptiveHint });
            const fallbackParts = splitShrimpSentences(streamedText);
            fallbackParts.sentences.forEach(emitSentence);
            if (fallbackParts.remainder.trim()) emitSentence(fallbackParts.remainder.trim());
          }
        } catch {
          if (!streamedText.trim()) {
            streamedText = buildShrimpFallbackReply({ outcome, riddle, nextRiddle, hint: adaptiveHint });
            const fallbackParts = splitShrimpSentences(streamedText);
            fallbackParts.sentences.forEach(emitSentence);
            if (fallbackParts.remainder.trim()) emitSentence(fallbackParts.remainder.trim());
          }
        }
        await Promise.allSettled(sentenceAudioJobs);
        writeNdjsonLine(res, { type: "done", result: outcome, text: streamedText.trim() });
        res.end();
        return;
      }

      if (pathname === "/api/shrimp/transcribe") {
        if (req.method !== "POST") {
          throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
        }
        if (!enforceUpstreamRateLimit(req, res)) return;
        if (typeof fetchImpl !== "function") {
          throw new ApiError(503, "service_unconfigured", "Det finns ingen tillgänglig HTTP-klient för anslutning till ElevenLabs.");
        }
        const body = await readJsonBody(req);
        const audioBuffer = normalizeShrimpAudioBase64(body.audioBase64);
        const transcript = await requestElevenLabsTranscription({
          audioBuffer,
          mimeType: typeof body.mimeType === "string" ? body.mimeType : "audio/webm",
          fileName: typeof body.fileName === "string" ? body.fileName : "shrimp-answer.webm",
          keyterms: body.keyterms,
        }, { env, fetchImpl });
        sendJson(res, 200, transcript);
        return;
      }

      if (pathname === "/api/shrimp/speak") {
        if (req.method !== "POST") {
          throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
        }
        if (!enforceUpstreamRateLimit(req, res)) return;
        if (typeof fetchImpl !== "function") {
          throw new ApiError(503, "service_unconfigured", "Det finns ingen tillgänglig HTTP-klient för anslutning till ElevenLabs.");
        }
        const body = await readJsonBody(req);
        const audio = await requestElevenLabsSpeech(body.text, { env, fetchImpl, character: body.character });
        sendBinary(res, 200, audio, "audio/mpeg");
        return;
      }

      if (pathname === "/api/complete") {
        if (req.method !== "POST") {
          throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
        }
        const clientIp = req.socket.remoteAddress || "unknown";
        const rate = checkRateLimit(clientIp);
        if (!rate.allowed) {
          req.resume();
          sendJson(res, 429, {
            error: {
              code: "rate_limited",
              message: "För många AI-anrop. Försök igen om en liten stund.",
            },
          }, { "Retry-After": String(rate.retryAfterSeconds) });
          return;
        }

        const body = await readJsonBody(req);
        const completion = validateCompletionRequest(body);
        if (typeof fetchImpl !== "function") {
          throw new ApiError(503, "service_unconfigured", "Det finns ingen tillgänglig HTTP-klient för anslutning till AI-leverantören.");
        }
        const content = await requestOpenRouter(completion, { env, fetchImpl });
        sendJson(res, 200, { content });
        return;
      }

      if (!["GET", "HEAD"].includes(req.method)) {
        throw new ApiError(405, "method_not_allowed", "Metoden är inte tillåten.");
      }
      // The generated design runtime replaces these image bindings immediately,
      // but browsers request the raw {{ name }} URLs during initial HTML parsing.
      if (isTemplateImagePath(pathname)) {
        serveTemplateImagePlaceholder(req, res);
        return;
      }
      await serveStatic(req, res, projectDir, pathname, await realProjectDirectory);
    } catch (error) {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      sendApiError(res, error);
    }
  });
}

function startServer() {
  const port = positiveInteger(process.env.PORT, 3_000, 1, 65_535);
  const host = envValue(process.env, "HOST", "127.0.0.1");
  const server = createAdventureServer();
  server.listen(port, host, () => {
    console.log(`Adventure Scene is running at http://${host}:${port}`);
  });
}

const entryPoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : "";
if (entryPoint === import.meta.url) startServer();
