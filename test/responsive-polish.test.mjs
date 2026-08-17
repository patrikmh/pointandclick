import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "project", "Adventure Scene.dc.html"), "utf8");

test("mobile browsers are allowed to load the game", () => {
  assert.doesNotMatch(source, /mobile-blocked|isMobileUA|isCoarseAndNarrow/);
  assert.doesNotMatch(source, /bara går att spela på en dator/);
});

test("scene title and seal art have narrow viewport safeguards", () => {
  assert.match(source, /\.scene-title \{[^}]*width: 118px; max-width: 118px/);
  assert.match(source, /\.scene-title-name \{[^}]*overflow-wrap: anywhere[^}]*white-space: normal[^}]*font-size: clamp\(12px, 4vw, 16px\)/);
  assert.match(source, /\.scene-title-progress > div:first-child \{ width: 36px/);
  assert.match(source, /\.scene-title-progress > div:last-child \{[^}]*font-size: 8px[^}]*letter-spacing: -0\.02em/);
  assert.match(source, /class="scene-title-name"/);
  assert.match(source, /class="scene-title-progress"/);
  assert.match(source, /style="width: 100%; max-width: 590px; height: auto/);
});

test("music Web Audio graph is created only from the user gesture path", () => {
  const mountStart = source.indexOf("  componentDidMount() {");
  const mountEnd = source.indexOf("\n  // true audio-synced", mountStart);
  const mount = source.slice(mountStart, mountEnd);

  assert.match(source, /initMusicAudioContext\(\) \{[\s\S]*new AudioContextCtor\(\)/);
  assert.match(mount, /this\._audioGesture = \(\) => this\._tryPlay\(true\)/);
  assert.match(mount, /addEventListener\("pointerdown", this\._audioGesture\)/);
  assert.doesNotMatch(mount, /new \(window\.AudioContext \|\| window\.webkitAudioContext\)\(\)/);
  assert.doesNotMatch(mount, /this\.initMusicAudioContext\(\);\n\s*this\._fadeMusic/);
});
