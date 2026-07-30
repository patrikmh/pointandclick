import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "project", "Adventure Scene.dc.html"), "utf8");

test("a full pack wraps instead of scrolling items out of reach", () => {
  const match = source.match(/<div id="inventory-items" style="([^"]+)"/);
  assert.ok(match, "missing the inventory item strip");
  const style = match[1];

  // An item you cannot see is an item you cannot drag, and the horizontal
  // scrollbar is hidden by default on macOS.
  assert.match(style, /flex-wrap:\s*wrap/, "the pack must wrap onto a second row");
  assert.doesNotMatch(style, /overflow-x:\s*auto/, "sideways scrolling hides draggable items");
  assert.match(style, /max-height:\s*\d+px/, "the pack must not be allowed to eat the whole scene");
  assert.match(style, /overflow-y:\s*auto/, "beyond the cap it scrolls vertically, where the scrollbar is visible");
});

test("inventory slots stay small enough for two rows inside the cap", () => {
  const slot = source.match(/const slotBase =\s*\n\s*"width:(\d+)px;height:(\d+)px/);
  assert.ok(slot, "missing slotBase");
  const size = Number(slot[2]);

  const cap = Number(source.match(/<div id="inventory-items"[^>]*max-height:\s*(\d+)px/)[1]);
  const gap = Number(source.match(/<div id="inventory-items" style="display:flex;gap:(\d+)px/)[1]);

  assert.ok(size * 2 + gap <= cap, `two rows of ${size}px slots must fit inside the ${cap}px cap`);
  assert.ok(size >= 80, "slots must stay large enough to read and grab");
});
