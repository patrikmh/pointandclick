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

  window.claude = Object.assign({}, window.claude, { complete });
})();
