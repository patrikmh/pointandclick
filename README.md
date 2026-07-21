# Adventure Scene

A production-ready wrapper around the original Claude Design handoff. The five-scene point-and-click game keeps its original art, audio, puzzles, and animation, while character conversations and painting reviews are routed through OpenRouter on the server so the API key never reaches the browser.

## Run locally

Requirements: Node.js 24 or newer and an OpenRouter API key.

```bash
cp .env.example .env
# Add your OPENROUTER_API_KEY to .env
npm start
```

Open `http://127.0.0.1:3000`. The status endpoint at `/healthz` reports whether OpenRouter is configured without exposing credentials.

## AI models

- `OPENROUTER_CHAT_MODEL` controls the model used by all character agents.
- `OPENROUTER_VISION_MODEL` controls the vision-capable model that judges paintings.
- Both default to OpenRouter's `~google/gemini-flash-latest` alias and can be changed independently in `.env`.

Every visible character has a distinct agent persona. Use the **Samtal** button or right-click a character and choose **Prata**. Painting images are submitted only when the player presses **Klar!**; they are not stored by this project.

## Validate

```bash
npm test
```

The test suite uses mocked upstream responses and never spends OpenRouter credits.

---

# CODING AGENTS: READ THIS FIRST

This is a **handoff bundle** from Claude Design (claude.ai/design).

A user mocked up designs in HTML/CSS/JS using an AI design tool, then exported this bundle so a coding agent can implement the designs for real.

## What you should do — IMPORTANT

**Read `point-and-click-adventure-scene/project/Adventure Scene.dc.html` in full.** The user had this file open when they triggered the handoff, so it's almost certainly the primary design they want built. Read it top to bottom — don't skim. Then **follow its imports**: open every file it pulls in (shared components, CSS, scripts) so you understand how the pieces fit together before you start implementing.

**If anything is ambiguous, ask the user to confirm before you start implementing.** It's much cheaper to clarify scope up front than to build the wrong thing.

## About the design files

The design medium is **HTML/CSS/JS** — these are prototypes, not production code. Your job is to **recreate them pixel-perfectly** in whatever technology makes sense for the target codebase (React, Vue, native, whatever fits). Match the visual output; don't copy the prototype's internal structure unless it happens to fit.

**Don't render these files in a browser or take screenshots unless the user asks you to.** Everything you need — dimensions, colors, layout rules — is spelled out in the source. Read the HTML and CSS directly; a screenshot won't tell you anything they don't.

## Bundle contents

- `point-and-click-adventure-scene/README.md` — this file
- `point-and-click-adventure-scene/project/` — the `Point and click adventure scene` project files (HTML prototypes, assets, components)
