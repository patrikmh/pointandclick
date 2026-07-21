import assert from "node:assert/strict";
import http from "node:http";
import { afterEach, test } from "node:test";

import {
  MAX_BODY_BYTES,
  buildOpenRouterRequest,
  convertAnthropicMessages,
  createAdventureServer,
  extractCompletionContent,
  isTemplateImagePath,
  normalizeChatCompletionsUrl,
} from "../server.mjs";

const openServers = new Set();

afterEach(async () => {
  await Promise.all([...openServers].map((server) => closeServer(server)));
});

function completionRequest(overrides = {}) {
  return {
    system: "Stay in character.",
    messages: [{ role: "user", content: "Hello" }],
    max_tokens: 400,
    ...overrides,
  };
}

function successfulUpstream(content = "Ahoy!") {
  return async () => new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function listen(options = {}) {
  const server = createAdventureServer(options);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  openServers.add(server);
  return server;
}

async function closeServer(server) {
  if (!openServers.delete(server) || !server.listening) return;
  await new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

function request(server, { method = "GET", path = "/", body, headers = {} } = {}) {
  const address = server.address();
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: "127.0.0.1",
      port: address.port,
      method,
      path,
      headers,
    }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        const contentType = String(res.headers["content-type"] ?? "");
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text,
          json: text && contentType.includes("application/json") ? JSON.parse(text) : null,
        });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function postCompletion(server, payload, headers = {}) {
  const body = JSON.stringify(payload);
  return request(server, {
    method: "POST",
    path: "/api/complete",
    body,
    headers: {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
      ...headers,
    },
  });
}

test("text completions use the configured OpenRouter chat model", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return successfulUpstream("Månen svarar.")();
  };
  const server = await listen({
    env: {
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_BASE_URL: "https://router.invalid/api/v1/",
      OPENROUTER_CHAT_MODEL: "example/chat-model",
      OPENROUTER_VISION_MODEL: "example/vision-model",
      OPENROUTER_SITE_URL: "https://game.invalid",
      OPENROUTER_APP_NAME: "Adventure Test",
    },
    fetchImpl,
  });

  const response = await postCompletion(server, completionRequest());

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { content: "Månen svarar." });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://router.invalid/api/v1/chat/completions");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-key");
  assert.equal(calls[0].options.headers["HTTP-Referer"], "https://game.invalid");
  assert.equal(calls[0].options.headers["X-Title"], "Adventure Test");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    model: "example/chat-model",
    messages: [
      { role: "system", content: "Stay in character." },
      { role: "user", content: "Hello" },
    ],
    max_tokens: 400,
    reasoning: { effort: "minimal", exclude: true },
    stream: false,
  });
});

test("image completions use the OpenRouter vision model and convert base64 images", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return successfulUpstream([
      { type: "text", text: "{\"godkand\":true}" },
    ])();
  };
  const server = await listen({
    env: {
      OPENROUTER_API_KEY: "test-key",
      OPENROUTER_CHAT_MODEL: "example/chat-model",
      OPENROUTER_VISION_MODEL: "example/vision-model",
    },
    fetchImpl,
  });
  const imageContent = [
    { type: "text", text: "Does this painting show a moon?" },
    {
      type: "image",
      source: {
        type: "base64",
        media_type: "image/png",
        data: "aGVsbG8=",
      },
    },
  ];

  const response = await postCompletion(server, completionRequest({
    messages: [{ role: "user", content: imageContent }],
    max_tokens: 200,
  }));

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { content: "{\"godkand\":true}" });
  const upstreamBody = JSON.parse(calls[0].options.body);
  assert.equal(upstreamBody.model, "example/vision-model");
  assert.deepEqual(upstreamBody.reasoning, { effort: "minimal", exclude: true });
  assert.deepEqual(upstreamBody.messages[1].content, [
    { type: "text", text: "Does this painting show a moon?" },
    {
      type: "image_url",
      image_url: { url: "data:image/png;base64,aGVsbG8=" },
    },
  ]);
});

test("conversion and response extraction helpers support OpenAI-compatible parts", () => {
  const converted = convertAnthropicMessages([{ role: "assistant", content: [
    { type: "text", text: "First" },
    {
      type: "image",
      source: { type: "base64", media_type: "image/webp", data: "YWJj" },
    },
  ] }]);

  assert.deepEqual(converted[0].content[1], {
    type: "image_url",
    image_url: { url: "data:image/webp;base64,YWJj" },
  });
  assert.equal(extractCompletionContent({
    choices: [{ message: { content: [
      { type: "text", text: "First" },
      { type: "output_text", text: " second" },
    ] } }],
  }), "First second");
  assert.equal(normalizeChatCompletionsUrl("https://host.invalid/v1"), "https://host.invalid/v1/chat/completions");
  assert.equal(normalizeChatCompletionsUrl("https://host.invalid/v1/chat/completions/"), "https://host.invalid/v1/chat/completions");
});

test("default chat and vision routes use OpenRouter's stable latest alias", () => {
  const env = { OPENROUTER_API_KEY: "test-key" };
  const chat = JSON.parse(buildOpenRouterRequest(completionRequest(), env).options.body);
  const vision = JSON.parse(buildOpenRouterRequest(completionRequest({
    messages: [{ role: "user", content: [
      { type: "text", text: "Inspect this." },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } },
    ] }],
  }), env).options.body);

  assert.equal(chat.model, "~google/gemini-flash-latest");
  assert.equal(vision.model, "~google/gemini-flash-latest");
});

test("malformed and oversized completion requests are rejected before provider calls", async () => {
  let providerCalls = 0;
  const server = await listen({
    env: { OPENROUTER_API_KEY: "test-key" },
    fetchImpl: async () => {
      providerCalls += 1;
      return successfulUpstream()();
    },
  });

  const malformed = await request(server, {
    method: "POST",
    path: "/api/complete",
    body: "{not-json",
    headers: {
      "content-type": "application/json",
      "content-length": 9,
    },
  });
  const oversized = await request(server, {
    method: "POST",
    path: "/api/complete",
    body: "x".repeat(MAX_BODY_BYTES + 1),
    headers: {
      "content-type": "application/json",
      "content-length": MAX_BODY_BYTES + 1,
    },
  });

  assert.equal(malformed.status, 400);
  assert.equal(malformed.json.error.code, "invalid_json");
  assert.equal(oversized.status, 413);
  assert.equal(oversized.json.error.code, "payload_too_large");
  assert.equal(providerCalls, 0);
});

test("request validation rejects unsupported message content and excessive max tokens", async () => {
  const server = await listen({
    env: { OPENROUTER_API_KEY: "test-key" },
    fetchImpl: successfulUpstream(),
  });

  const badContent = await postCompletion(server, completionRequest({
    messages: [{ role: "user", content: [{ type: "audio", data: "nope" }] }],
  }));
  const tooManyTokens = await postCompletion(server, completionRequest({ max_tokens: 100_000 }));

  assert.equal(badContent.status, 400);
  assert.equal(badContent.json.error.code, "invalid_request");
  assert.equal(tooManyTokens.status, 400);
  assert.equal(tooManyTokens.json.error.code, "invalid_request");
});

test("upstream failures return sanitized errors without provider response content", async () => {
  const providerSecret = "provider-debug-secret";
  const server = await listen({
    env: { OPENROUTER_API_KEY: "test-key" },
    fetchImpl: async () => new Response(providerSecret, { status: 500 }),
  });

  const response = await postCompletion(server, completionRequest());

  assert.equal(response.status, 502);
  assert.equal(response.json.error.code, "upstream_error");
  assert.doesNotMatch(response.text, new RegExp(providerSecret));
});

test("an absent OpenRouter API key reports service_unconfigured", async () => {
  let providerCalls = 0;
  const server = await listen({
    env: {},
    fetchImpl: async () => {
      providerCalls += 1;
      return successfulUpstream()();
    },
  });

  const response = await postCompletion(server, completionRequest());

  assert.equal(response.status, 503);
  assert.equal(response.json.error.code, "service_unconfigured");
  assert.equal(providerCalls, 0);
});

test("the root serves the adventure while encoded traversal stays outside the project", async () => {
  const server = await listen({ env: {} });

  const root = await request(server);
  const traversal = await request(server, { path: "/..%2fserver.mjs" });
  const templateImage = await request(server, { path: "/%7B%7B%20moonSrc%20%7D%7D" });

  assert.equal(root.status, 200);
  assert.match(root.headers["content-type"], /^text\/html/);
  assert.match(root.text, /<title>|<x-dc>/);
  assert.equal(traversal.status, 403);
  assert.doesNotMatch(traversal.text, /createAdventureServer/);
  assert.equal(isTemplateImagePath("/%7B%7B%20moonSrc%20%7D%7D"), true);
  assert.equal(isTemplateImagePath("/%7B%7B%20moon.src%20%7D%7D"), false);
  assert.equal(templateImage.status, 200);
  assert.equal(templateImage.headers["content-type"], "image/gif");
  assert.ok(templateImage.text.length > 0);
});

test("health reports provider readiness without exposing secrets", async () => {
  const secret = "never-show-this-key";
  const server = await listen({
    env: {
      OPENROUTER_API_KEY: secret,
      OPENROUTER_CHAT_MODEL: "example/chat-model",
      OPENROUTER_VISION_MODEL: "example/vision-model",
    },
  });

  const response = await request(server, { path: "/healthz" });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    status: "ok",
    openrouter: {
      configured: true,
      chatReady: true,
      visionReady: true,
    },
  });
  assert.doesNotMatch(response.text, new RegExp(secret));
});

test("completion requests are rate-limited per client IP", async () => {
  const server = await listen({
    env: {
      OPENROUTER_API_KEY: "test-key",
      RATE_LIMIT_MAX_REQUESTS: "1",
      RATE_LIMIT_WINDOW_MS: "60000",
    },
    fetchImpl: successfulUpstream(),
  });

  const first = await postCompletion(server, completionRequest());
  const second = await postCompletion(server, completionRequest());

  assert.equal(first.status, 200);
  assert.equal(second.status, 429);
  assert.equal(second.json.error.code, "rate_limited");
  assert.equal(second.headers["retry-after"], "60");
});
