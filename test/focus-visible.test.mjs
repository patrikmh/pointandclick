import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "project", "Adventure Scene.dc.html"), "utf8");

function baselineRule() {
  const match = source.match(/:where\(input, select, textarea, canvas\[tabindex\], \[role="application"\]\[tabindex\]\):focus-visible\s*\{[\s\S]*?\n  \}/);
  assert.ok(match, "missing centralized focus-visible baseline");
  return match[0];
}

function baselineSelector() {
  return baselineRule().match(/^[^{]+/u)[0].trim();
}

test("native controls and custom surfaces use the centralized focus-visible baseline", () => {
  const rule = baselineRule();
  assert.equal(
    baselineSelector(),
    ':where(input, select, textarea, canvas[tabindex], [role="application"][tabindex]):focus-visible',
  );
  assert.match(rule, /outline:\s*2px solid oklch\(0\.78 0\.1 75\) !important/);
  assert.match(rule, /outline-offset:\s*2px/);
});

test("baseline selector stays low-specificity, narrow, and does not change layout", () => {
  const rule = baselineRule();
  const selector = baselineSelector();
  assert.match(selector, /^:where\([^)]*\):focus-visible$/);
  assert.doesNotMatch(selector, /(?:^|[,.#])(?:button|\[data-drop\]|\[role="button"\])/);
  assert.ok(
    selector.startsWith(":where(") && !selector.includes(".seal-game-stage"),
    "central baseline must remain less specific than the seal game stage ring",
  );
  assert.doesNotMatch(rule, /(?:border|padding|(?:min-|max-)?(?:width|height)|(?:translate|transform)\s*):/i);
});

test("specialized seal game ring outranks the centralized baseline", () => {
  const specialized = source.match(/\.seal-game-stage:focus-visible\s*\{[\s\S]*?\n  \}/u);
  assert.ok(specialized, "missing specialized seal game focus ring");
  assert.match(specialized[0], /outline:\s*2px solid oklch\(0\.9 0\.12 82\) !important/);
  assert.match(specialized[0], /outline-offset:\s*3px/);
  assert.equal((baselineSelector().match(/:focus-visible/g) ?? []).length, 1);
  assert.match(baselineSelector(), /^:where\(/);
  assert.match(specialized[0], /^\.seal-game-stage:focus-visible/);
});

test("audited focusable controls and surfaces remain in the markup", () => {
  assert.match(source, /<input[^>]+aria-label="Musikvolym"/);
  assert.match(source, /<select[^>]+aria-label="Välj karaktär att prata med"/);
  assert.match(source, /<textarea\b|<input[^>]+aria-label="Skriv ett meddelande"/);
  assert.match(source, /<canvas[^>]+tabindex="0"/);
  assert.match(source, /role="application"[^>]+tabindex="0"[^>]+[^>]*outline:none/);
});

test("existing button, item, inventory, sheep, and seal focus rings are preserved", () => {
  assert.match(source, /\[role="button"\]\[tabindex="0"\]:focus-visible, \[data-drop\]:focus-visible, button:focus-visible/);
  assert.match(source, /\.inventory-region:focus-visible/);
  assert.match(source, /\.sheep-dialog button:focus-visible/);
  assert.match(source, /\.sheep-dialog canvas:focus-visible/);
  assert.match(source, /\.seal-game-stage:focus-visible/);
});
