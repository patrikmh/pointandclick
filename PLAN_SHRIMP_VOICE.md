# Plan: Realtime voice-chat shrimp (ElevenLabs) + richer character agent

> Reference implementation: `/Users/patrikandersson/Downloads/openrouter_swedish_voice_chat/voice_chat_openrouter.py`
> Target: shrimp game in `project/Adventure Scene.dc.html` + `server.mjs`

## 1. Goal

Turn the shrimp ("Vallgravsräkan") interaction into a **realtime, low-latency Swedish voice conversation** using ElevenLabs the same way `voice_chat_openrouter.py` does — continuous mic → realtime Scribe STT → streaming OpenRouter reply → interleaved streaming TTS — wrapped in a **voice-chat interface** that mirrors the reference (state avatar, live transcript, message bubbles, text fallback, status/timing chips), with the **orb replaced by a shrimp icon**, and a **much richer shrimp character/agent** driving the dialogue. The deterministic 3-riddle gate (and the "Greta Thunberg" shortcut) stays server-authoritative and tested.

## 2. Current state (what exists today)

The shrimp game already has voice, but it is **turn-based / batch**, not realtime:

- **STT:** client tries browser `SpeechRecognition`; falls back to `MediaRecorder` + silence detection → `POST /api/shrimp/transcribe` (ElevenLabs **batch** Scribe v2). No realtime WebSocket. No live partial transcript. No adaptive local VAD.
- **LLM reply:** `POST /api/shrimp/converse` → OpenRouter **streaming** NDJSON (`meta` / `delta` / `sentence` / `done`). Server classifies the answer first, then streams a persona reply.
- **TTS:** client calls `POST /api/shrimp/speak` **once per emitted sentence**, serialized (fetch→play→fetch). Not pipelined with generation.
- **UI:** a riddle card (`Gåta x/3`, prompt, hint, transcript log, Starta/Stoppa samtal toggle). No state avatar, no live transcript row, no text input, no timing chips.
- **Barge-in:** exists (`shrimpInterruptSpeech`) but only fires on a new turn, not while the shrimp is mid-speech.
- **Server helpers already present and reusable:** `/api/shrimp/scribe-token` (mints single-use realtime token), `requestElevenLabsSpeech`, `requestElevenLabsTranscription`, `splitShrimpSentences`, `buildShrimpSystemPrompt`, `classifyShrimpAnswer`.
- **Config gap:** `.env` currently has **no** `ELEVENLABS_API_KEY` / `ELEVENLABS_VOICE_ID`. Voice is inert until those are added.
- **Tests:** `test/shrimp-game.test.mjs` covers the deterministic classifier helpers. Must keep passing.

## 3. The gap vs `voice_chat_openrouter.py` (the delta we are closing)

| Capability | Reference | Current shrimp | Action |
|---|---|---|---|
| STT mode | Realtime Scribe **WebSocket** (continuous, server-VAD commit) | Batch per turn | **Add realtime WebSocket client** (token already mintable server-side) |
| Local VAD | Adaptive RMS, noise floor, pre-roll, level meter | Basic analyser only | **Port reference VAD** for meter + barge-in |
| Live transcript | Partial + final shown live | None | **Add live transcript row** |
| Turn commit | Auto on VAD silence; optional HQ re-transcribe | Manual start/stop per turn | **Auto-commit pipeline** + optional HQ re-check |
| LLM streaming | OpenRouter stream | OpenRouter stream (already) | Keep; wire into new pipeline |
| TTS | **Interleaved** with generation (synth sentence N while gen N+1), queued playback | One `/speak` per sentence, serialized | **Move TTS server-side into the stream** (emit `audio` events) OR pipeline client fetches |
| Barge-in | User speech interrupts assistant mid-speech | Only on new turn | **Interrupt on local-VAD speech onset** |
| Avatar/state | "orb" with idle/listening/user/assistant states + breathing | None | **Shrimp avatar** with the same states |
| Text input | Always available | None | **Add text fallback input** |
| Status | Timing chips (first token / first audio / STT ms) | One status line | **Add timing chips** |

## 4. Architecture decisions

### 4.1 Keep server-authoritative game logic
The riddle classifier (`classifyShrimpAnswer`), answer matching, and the Greta shortcut stay on the server and stay deterministic. The realtime upgrade changes **how turns are captured and spoken**, not **how the game is won**. This protects existing tests and the puzzle contract.

### 4.2 TTS: server-side inline audio in the NDJSON stream (recommended)
Extend `/api/shrimp/converse` so that, as OpenRouter streams, each finished sentence is synthesized **on the server** and emitted as an `audio` event (`{ type: "audio", audio_base64, text }`) — exactly the reference's event shape. The client just queues and plays. Benefits: lower time-to-first-audio, no per-sentence client round-trips, simpler client, graceful fallback (`tts_error` events, text still shows). We keep `/api/shrimp/speak` for non-streamed fallback (intro line, idle lines).

> *Fallback option (higher latency):* keep emitting `sentence` and let the client fetch `/api/shrimp/speak` per sentence but **pipelined** (prefetch next while playing current). Only if server-side audio proves problematic.

### 4.3 STT: realtime Scribe WebSocket + optional HQ re-check
- Client opens `wss://api.elevenlabs.io/v1/speech-to-text/realtime` with the token from existing `/api/shrimp/scribe-token`, sending 16 kHz PCM16 chunks (resampled from the mic).
- Receives `partial_transcript` / `final_transcript` / `committed_transcript`; `committed_transcript` (server VAD) ends a turn.
- Optional **HQ re-transcribe** via existing `/api/shrimp/transcribe` (full Scribe v2 with `SHRIMP_STT_KEYTERMS`) to correct the realtime preview before classification — mirrors the reference's two-stage STT.
- Mic stays open for the whole conversation; no per-turn start/stop.

### 4.4 Local VAD (client) — port from reference
Adaptive RMS with noise-floor tracking, pre-roll buffer, speech-onset/offset detection. Used for:
- the shrimp avatar's reactive "level" animation,
- **barge-in**: speech onset while the shrimp is speaking → `shrimpInterruptSpeech()`,
- guarding against speaker echo (reject commits with no local speech while assistant was active).

### 4.5 Shrimp avatar (replaces the orb)
Reuse `assets/shrimp-protest.png` as the base avatar inside a circular "stage". State styles map from the reference orb:
- **idle:** dim, slow sway (reuse `shrimpMarch`).
- **listening:** cool glow, antennae/level react to `--level`, label "Jag lyssnar – prata när du vill".
- **user-speaking:** warmer ring, "Du pratar…".
- **assistant-speaking:** talk animation (bob/mouth) + breathing ring, "Jag pratar – börja prata för att avbryta".
A dedicated favicon + dialog header shrimp icon also derived from the PNG. *(Optional: generate a cleaner square shrimp avatar image if the wide PNG crops poorly in a circle.)*

### 4.6 Richer character/agent ("make the character rich with an agent")
Upgrade the shrimp from a thin 3-line persona to a **structured character bible** that drives the system prompt, while keeping the riddle gate intact:
- **Identity & world:** name, origin, role as moat guardian of the fortress, relationship to neighbouring characters (moon, seal, sheep, octo) and the environment (salt water, fog, iron gate, moss).
- **Personality & voice:** speech patterns, vocabulary, dry/salt humor, cadence, signature phrases, what it never says.
- **Emotional arc:** curious (riddle 1) → testing (riddle 2) → solemn/dark (riddle 3) → celebratory on win — already hinted, made explicit and consistent.
- **Adaptive hinting:** track attempts per riddle; escalate hints (nudge → strong clue → near-answer) instead of repeating the same hint. Server keeps an attempts counter in the conversation state.
- **Memory & continuity:** richer use of message history; the shrimp recalls what the player tried and references it.
- **Safety rails retained:** max 3 short sentences, Swedish, no role names/quotes/markdown, server decides outcome (never the model).
- **Originality clause retained:** must not mimic/cite any known TV character.

The bible lives as a versioned data block in `server.mjs` (and mirrored client fallback text), so it is testable and reviewable.

## 5. Implementation phases (sequenced, each independently shippable)

### Phase 0 — Config & decisions *(blocking, ~10 min)*
- Add `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`, `SHRIMP_STT_KEYTERMS` to `.env`. Confirm shrimp voice id (`ELEVENLABS_VOICE_SHRIMP`).
- Decide: dedicated shrimp avatar image vs reuse `shrimp-protest.png`.
- Decide: keep 3-riddle gate + Greta shortcut (recommended) vs fully open chat.

### Phase 1 — Richer character agent *(server-only, low risk)*
- Add `SHRIMP_CHARACTER_BIBLE` data block + expand `buildShrimpSystemPrompt` to consume it (arc, adaptive hint level, memory of recent attempts).
- Add per-riddle attempt counter threaded through `/api/shrimp/converse` (returned in `meta`, echoed back by client).
- Add escalating hint helper; keep deterministic classifier untouched.
- Update/extend `test/shrimp-game.test.mjs` for hint escalation + bible-driven prompt shape.
- *Visible win:* shrimp already sounds richer before any UI/voice change.

### Phase 2 — Server-side streaming TTS *(server, medium)*
- In `/api/shrimp/converse`, synthesize each finished sentence via `requestElevenLabsSpeech` and emit `{type:"audio", audio_base64, text}` inline; keep `delta`/`sentence`; add `{type:"timing", name:"first_audio_ms"}`.
- Emit `tts_error` (non-fatal) so text always works.
- Keep `/api/shrimp/speak` for intro/idle lines.
- Test: NDJSON event ordering + that a missing ElevenLabs key degrades to text-only without 500s.

### Phase 3 — Realtime STT client + local VAD + barge-in *(frontend, largest)*
- Add `ai-bridge.js` helper `shrimpRealtimeScribe({ onPartial, onFinal, onCommit, onOpen, onError })` using `/api/shrimp/scribe-token`.
- In the shrimp component: continuous mic (resample → 16 kHz PCM16), local VAD (port reference: RMS, noise floor, pre-roll, onset/offset), live transcript state, echo-cancellation guard.
- On `committed_transcript`: optional HQ re-transcribe via `/api/shrimp/transcribe`, then `shrimpHandleAnswer`.
- Barge-in: local-VAD speech onset while assistant audio is playing → `shrimpInterruptSpeech()` + abort in-flight `/converse`.
- Wire `audio` events from `/converse` into the existing audio queue (replace per-sentence `/speak` fetch).
- Keep Web Speech API + MediaRecorder as a **fallback** only when realtime WS is unavailable/blocked.

### Phase 4 — Voice-chat UI matching the reference *(frontend)*
Restructure the shrimp dialog to mirror `voice_chat_openrouter.py`:
- **Shrimp avatar stage** (replaces orb) with idle/listening/user/assistant states + level-driven animation + state label.
- **Live transcript row** under the stage.
- **Conversation bubbles** (user right / shrimp left), preserving the riddle prompt + hint + `Gåta x/3` chips.
- **Primary control:** `🎙️ Starta samtal` / `■ Stoppa samtal` + `Rensa`.
- **Text input fallback** (`Skicka` button) always available.
- **Status/timing chips:** status, `Slut-STT`, `Första token`, `Första ljud`.
- Collapsible settings (model, voice id, silence threshold, VAD sensitivity, keyterms, HQ-STT toggle) — server-backed defaults via a `/config`-style endpoint or existing `/healthz`.

### Phase 5 — Polish, a11y, tests, QA
- Animations tuned (talk/sway/glow), mobile layout, keyboard + screen-reader labels (`aria-live` regions kept).
- `node --test` green (no new failures beyond documented baselines).
- Manual QA via `npm start`: open conversation, speak, see live transcript, hear streamed reply, barge-in, win by riddles, win by Greta, text fallback, close/reopen lifecycle, zero console errors.
- Update `README.md` + `.env.example` notes.

## 6. Risks & mitigations
- **Continuous STT cost/credits** — realtime Scribe streams continuously. Mitigation: only open the WS while the conversation is active; close on `Stoppa`/close dialog; reuse reference's reconnect/backoff.
- **Autoplay policy** — audio must unlock on the user's first gesture (the `Starta samtal` click). Port the reference's silence-clip unlock.
- **Echo cancellation** — mic may pick up the shrimp's own voice. Mitigation: request `echoCancellation/noiseSuppression/autoGainControl`; keep the reference's "no local speech while assistant active → reject commit" guard.
- **Browser support** — `AudioContext`/WebSocket are universal; Web Speech fallback retained for odd environments.
- **Latency regression** — server-side TTS adds work per sentence; mitigate with `eleven_flash_v2_5` + sentence splitting + streaming (first audio while still generating).
- **Large HTML file** — edit only the shrimp dialog template + shrimp JS block; avoid unrelated hunks (per project's editing convention).

## 7. Open questions (need your call before Phase 1)
1. **ElevenLabs keys/voice** — please confirm `ELEVENLABS_API_KEY` + which voice id for the shrimp (`ELEVENLABS_VOICE_SHRIMP`). Currently `.env` has none.
2. **Game shape** — keep the 3-riddle gate + Greta shortcut (recommended), or open-ended free chat with the shrimp? (Plan assumes keep.)
3. **Avatar asset** — reuse `shrimp-protest.png`, or generate a dedicated square shrimp avatar/icon?
4. **STT cost** — OK to use continuous realtime Scribe (credits per second of open mic)? Or prefer push-to-talk to limit cost?
5. **Language** — Swedish throughout for the shrimp dialogue/UI (matches today + the reference). Confirm.

## 8. Out of scope
- Other characters' conversations, other mini-games, the painting atelier, server static serving, and unrelated working-tree changes.
- Replacing the game framework; everything stays in the existing DC component + canvas/HTML pipeline.
- No new runtime dependencies (no Three.js etc.); only existing ElevenLabs/OpenRouter HTTP + WebSocket APIs.
