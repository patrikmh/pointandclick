(function installAiBridge() {
  "use strict";

  const MAX_SYSTEM_CHARS = 16000;
  const MAX_MESSAGE_CHARS = 20000;
  const MAX_MESSAGES = 30;
  const MAX_CONTENT_BLOCKS = 8;
  const MAX_IMAGE_CHARS = 8000000;
  const MAX_ERROR_CHARS = 220;

  function conciseError(value, fallback) {
    let message = fallback;
    if (typeof value === "string") message = value;
    else if (value && typeof value.message === "string") message = value.message;
    else if (value && typeof value.error === "string") message = value.error;
    else if (value && value.error && typeof value.error.message === "string") message = value.error.message;
    return String(message || "AI-anropet misslyckades")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_ERROR_CHARS);
  }

  function cleanContent(content) {
    if (typeof content === "string") return content.slice(0, MAX_MESSAGE_CHARS);
    if (!Array.isArray(content)) throw new Error("Meddelandets innehåll måste vara text eller bildblock.");

    const blocks = content.slice(0, MAX_CONTENT_BLOCKS).map((block) => {
      if (!block || typeof block !== "object") throw new Error("Ogiltigt innehållsblock i meddelandet.");
      if (block.type === "text" && typeof block.text === "string") {
        return { type: "text", text: block.text.slice(0, MAX_MESSAGE_CHARS) };
      }
      if (block.type === "image" && block.source && block.source.type === "base64") {
        const data = block.source.data;
        const mediaType = block.source.media_type;
        if (typeof data !== "string" || data.length > MAX_IMAGE_CHARS) throw new Error("Bilden av målningen är för stor.");
        if (!/^image\/(png|jpeg|webp|gif)$/.test(mediaType || "")) throw new Error("Bildformatet för målningen stöds inte.");
        return { type: "image", source: { type: "base64", media_type: mediaType, data } };
      }
      throw new Error("Innehållsblocket i meddelandet stöds inte.");
    });

    if (!blocks.length) throw new Error("Meddelandets innehåll är tomt.");
    return blocks;
  }

  function cleanRequest(input) {
    if (!input || typeof input !== "object") throw new Error("AI-anropet är ogiltigt.");
    const messages = Array.isArray(input.messages) ? input.messages.slice(-MAX_MESSAGES) : [];
    if (!messages.length) throw new Error("AI-anropet innehåller inga meddelanden.");

    return {
      system: typeof input.system === "string" ? input.system.slice(0, MAX_SYSTEM_CHARS) : "",
      messages: messages.map((message) => {
        if (!message || (message.role !== "user" && message.role !== "assistant")) {
          throw new Error("AI-meddelandets roll är ogiltig.");
        }
        return { role: message.role, content: cleanContent(message.content) };
      }),
      max_tokens: Math.max(1, Math.min(1200, Number(input.max_tokens) || 500)),
    };
  }

  const MAX_SHRIMP_MESSAGES = 24;
  const MAX_SHRIMP_TEXT_CHARS = 4000;

  function cleanShrimpConversation(input) {
    if (!input || typeof input !== "object") throw new Error("Räkchatten är ogiltig.");
    const step = Number.isInteger(input.step) && input.step >= 0 ? input.step : 0;
    const attempts = Number.isInteger(input.attempts) && input.attempts >= 0 ? Math.min(input.attempts, 99) : 0;
    const messages = Array.isArray(input.messages) ? input.messages.slice(-MAX_SHRIMP_MESSAGES) : [];
    if (!messages.length) throw new Error("Räkchatten innehåller inga meddelanden.");

    return {
      step,
      attempts,
      messages: messages.map((message) => {
        if (!message || (message.role !== "user" && message.role !== "assistant")) {
          throw new Error("Räkchattens roll är ogiltig.");
        }
        const text = typeof message.text === "string" ? message.text.trim() : "";
        if (!text) throw new Error("Räkchattens meddelande får inte vara tomt.");
        return { role: message.role, text: text.slice(0, MAX_SHRIMP_TEXT_CHARS) };
      }),
    };
  }

  function parseNdjsonLine(line) {
    const trimmed = String(line || "").trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }

  async function readNdjsonResponse(response, { onEvent, signal } = {}) {
    if (!response.ok) throw response;
    if (!response.body) {
      const text = await response.text();
      let final = null;
      for (const line of String(text || "").split(/\r?\n/)) {
        const event = parseNdjsonLine(line);
        if (!event) continue;
        if (typeof onEvent === "function") onEvent(event);
        if (event.type === "done") final = event;
      }
      return final;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let final = null;

    try {
      while (true) {
        if (signal?.aborted) {
          await reader.cancel().catch(() => {});
          throw new DOMException("The operation was aborted.", "AbortError");
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary;
        while ((boundary = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 1);
          const event = parseNdjsonLine(line);
          if (!event) continue;
          if (typeof onEvent === "function") onEvent(event);
          if (event.type === "done") final = event;
        }
      }
      buffer += decoder.decode();
      for (const line of buffer.split(/\r?\n/)) {
        const event = parseNdjsonLine(line);
        if (!event) continue;
        if (typeof onEvent === "function") onEvent(event);
        if (event.type === "done") final = event;
      }
      return final;
    } finally {
      reader.releaseLock?.();
    }
  }

  async function shrimpConverse(input, options = {}) {
    const response = await fetch("/api/shrimp/converse", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/x-ndjson" },
      body: JSON.stringify(cleanShrimpConversation(input)),
      signal: options.signal,
    });

    if (!response.ok) {
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        payload = null;
      }
      throw new Error(conciseError(payload, "Räkchatten misslyckades."));
    }

    return await readNdjsonResponse(response, options);
  }

  // Realtime Scribe STT over WebSocket. Fetches a single-use token from the server, opens the
  // ElevenLabs realtime speech-to-text socket, and exposes a tiny controller for sending PCM16
  // chunks and closing cleanly. Mirrors the reference voice-chat client.
  async function shrimpRealtimeScribe({ onOpen, onPartial, onCommit, onError, onClose, signal, languageCode = "swe", keyterms = [] } = {}) {
    const tokenResponse = await fetch("/api/shrimp/scribe-token", {
      method: "GET",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!tokenResponse.ok) {
      const message = await tokenResponse.text().catch(() => "Kunde inte hämta scribe-token.");
      throw new Error(message || "Kunde inte hämta scribe-token.");
    }
    const { token } = await tokenResponse.json();
    if (!token) throw new Error("Servern returnerade ingen scribe-token.");

    const wsUrl = new URL("wss://api.elevenlabs.io/v1/speech-to-text/realtime");
    wsUrl.searchParams.set("model_id", "scribe_v2_realtime");
    wsUrl.searchParams.set("audio_format", "pcm_16000");
    wsUrl.searchParams.set("language_code", languageCode);
    wsUrl.searchParams.set("commit_strategy", "vad");
    wsUrl.searchParams.set("vad_silence_threshold_secs", "0.7");
    wsUrl.searchParams.set("vad_threshold", "0.5");
    wsUrl.searchParams.set("min_speech_duration_ms", "180");
    wsUrl.searchParams.set("min_silence_duration_ms", "120");
    wsUrl.searchParams.set("no_verbatim", "true");
    wsUrl.searchParams.set("token", token);
    for (const term of keyterms) {
      const value = String(term || "").trim().slice(0, 20);
      if (value) wsUrl.searchParams.append("keyterms", value);
    }

    let intentionallyClosed = false;
    let steadyAbort = null;
    const socket = new WebSocket(wsUrl.toString());
    let firstChunk = true;
    let previousText = "";

    // Force-close the socket whenever it is still CONNECTING or OPEN. Safe to call
    // at any readyState: the browser ignores close() on an already-closed socket.
    const destroySocket = () => {
      try { if (socket.readyState === 0 || socket.readyState === 1) socket.close(); } catch { /* ignored */ }
    };

    const send = (pcmBase64, contextText) => {
      if (socket.readyState !== 1) return; // OPEN
      const payload = { message_type: "input_audio_chunk", audio_base_64: pcmBase64 };
      if (firstChunk && contextText) payload.previous_text = contextText.slice(-50);
      firstChunk = false;
      try { socket.send(JSON.stringify(payload)); } catch { /* ignored */ }
    };

    const close = () => {
      intentionallyClosed = true;
      if (signal && steadyAbort) {
        signal.removeEventListener("abort", steadyAbort);
        steadyAbort = null;
      }
      destroySocket();
    };

    const handleMessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }
      const type = data.message_type;
      if (type === "partial_transcript" || type === "final_transcript") {
        if (data.text) previousText = String(data.text).trim();
        if (typeof onPartial === "function") onPartial(previousText);
      } else if (type === "committed_transcript") {
        const text = String(data.text || "").trim();
        if (text && typeof onCommit === "function") onCommit(text);
        previousText = "";
      } else if (type === "error" || type === "rate_limited" || type === "auth_error" || type === "quota_exceeded" || type === "transcriber_error" || type === "input_error" || type === "queue_overflow" || type === "resource_exhausted" || type === "session_time_limit_exceeded") {
        if (typeof onError === "function") onError(data.error || data.message || "STT-fel");
      }
    };
    socket.onmessage = handleMessage;

    // The open promise settles exactly once. Every path — timeout, AbortSignal while
    // CONNECTING or OPEN, socket error, or early close — clears the timer, removes the
    // abort listener, destroys the socket on failure, and never leaves it alive.
    await new Promise((resolve, reject) => {
      let settled = false;
      let timer = null;
      let onAbort = null;

      const teardown = () => {
        if (timer) { clearTimeout(timer); timer = null; }
        if (signal && onAbort) { signal.removeEventListener("abort", onAbort); onAbort = null; }
      };

      const settleFail = (error) => {
        if (settled) return;
        settled = true;
        teardown();
        destroySocket();
        reject(error);
      };

      timer = setTimeout(() => settleFail(new Error("STT-anslutningen tog för lång tid.")), 10000);

      if (signal) {
        onAbort = () => settleFail(new DOMException("The operation was aborted.", "AbortError"));
        if (signal.aborted) { onAbort(); return; }
        signal.addEventListener("abort", onAbort, { once: true });
      }

      socket.onopen = () => {
        if (settled) { destroySocket(); return; }
        settled = true;
        teardown();
        if (typeof onOpen === "function") onOpen();
        resolve();
      };

      socket.onerror = () => {
        if (typeof onError === "function") onError("Kunde inte ansluta till ElevenLabs realtime STT.");
        settleFail(new Error("Kunde inte ansluta till ElevenLabs realtime STT."));
      };

      socket.onclose = () => {
        settleFail(new Error("STT-anslutningen stängdes för tidigt."));
      };
    });

    // Steady-state: the socket is now OPEN. Replace the connecting-phase handlers.
    socket.onerror = () => {
      if (typeof onError === "function") onError("Kunde inte ansluta till ElevenLabs realtime STT.");
      destroySocket();
    };
    socket.onclose = () => {
      if (signal && steadyAbort) {
        signal.removeEventListener("abort", steadyAbort);
        steadyAbort = null;
      }
      if (typeof onClose === "function") onClose(!!intentionallyClosed);
    };

    if (signal) {
      steadyAbort = close;
      if (signal.aborted) close();
      else signal.addEventListener("abort", steadyAbort, { once: true });
    }

    return { socket, send, close, get readyState() { return socket.readyState; } };
  }

  async function complete(input) {
    const response = await fetch("/api/complete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify(cleanRequest(input)),
    });

    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      throw new Error(response.ok ? "AI-tjänsten returnerade ett ogiltigt svar." : "AI-tjänsten är inte tillgänglig.");
    }

    if (!response.ok) throw new Error(conciseError(payload, "AI-anropet misslyckades."));
    if (!payload || typeof payload.content !== "string") throw new Error("AI-tjänsten returnerade inget svar.");
    const content = payload.content.trim();
    if (!content) throw new Error("AI-tjänsten returnerade ett tomt svar.");
    return content;
  }

  window.claude = Object.assign({}, window.claude, { complete, shrimpConverse, shrimpRealtimeScribe, readNdjsonResponse });
})();
