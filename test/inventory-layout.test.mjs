import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const source = await readFile(join(projectRoot, "project", "Adventure Scene.dc.html"), "utf8");

function inventoryMarkup() {
  const start = source.indexOf('<div id="inventory-items"');
  assert.ok(start >= 0, "missing the inventory item strip");
  return source.slice(source.lastIndexOf('<sc-if value="{{ inventoryStripOpen }}"', start), start + 2400);
}

test("inventory is a compact, single-row native horizontal scroller", () => {
  const markup = inventoryMarkup();
  assert.match(markup, /flex-wrap:nowrap/);
  assert.match(markup, /overflow-x:auto/);
  assert.match(markup, /overflow-y:hidden/);
  assert.match(markup, /scroll-behavior:smooth/);
  assert.doesNotMatch(markup, /max-height:\s*\d+px/);
  assert.match(markup, /role="region"/);
  assert.match(markup, /aria-label="Packningens föremål"/);
  assert.match(markup, /tabindex="0"/);
});

test("inventory region has a palette-consistent focus-visible treatment without layout styles", () => {
  assert.match(source, /\.inventory-region:focus-visible\s*\{[^}]*outline:\s*2px solid oklch\(0\.78 0\.1 75\)[^}]*outline-offset:\s*2px/);
  assert.match(source, /\[role="button"\]\[tabindex="0"\]:focus-visible/);
  assert.match(inventoryMarkup(), /class="inventory-region"[^>]*role="region"[^>]*tabindex="0"/);
});

test("inventory has discoverable Swedish-labelled navigation controls", () => {
  const markup = inventoryMarkup();
  assert.match(markup, /aria-label="Visa föregående föremål"/);
  assert.match(markup, /aria-label="Visa nästa föremål"/);
  assert.match(markup, /inventoryScrollLeft/);
  assert.match(markup, /inventoryScrollRight/);
});

test("inventory keyboard navigation implements arrows, pages, and boundaries", () => {
  assert.match(source, /inventoryKeyDown\(e\)/);
  assert.match(source, /e\.key === "ArrowLeft"/);
  assert.match(source, /e\.key === "ArrowRight"/);
  assert.match(source, /e\.key === "PageUp"/);
  assert.match(source, /e\.key === "PageDown"/);
  assert.match(source, /e\.key === "Home"/);
  assert.match(source, /e\.key === "End"/);
  assert.match(source, /strip\.scrollTo\(\{ left: 0/);
  assert.match(source, /strip\.scrollTo\(\{ left: strip\.scrollWidth/);
  assert.match(source, /e\.preventDefault\(\);[\s\S]*e\.stopPropagation\(\);/);
});

test("inventory items preserve pointer, keyboard, and context-menu semantics", () => {
  const markup = inventoryMarkup();
  assert.match(markup, /role="button" tabindex="0"/);
  assert.match(markup, /onKeyDown="\{\{ it\.onKeyDown \}\}"/);
  assert.match(markup, /onPointerDown="\{\{ it\.onDown \}\}"/);
  assert.match(markup, /onContextMenu="\{\{ infoCtx \}\}"/);
});

test("inventory drop targets stay mounted while an item is dragged", () => {
  assert.match(source, /inventoryStripOpen: S\.inventoryOpen,/);
  assert.doesNotMatch(source, /inventoryStripOpen: S\.inventoryOpen && !S\.invDrag/);
  assert.match(source, /if \(kind === "inv"\) \{[\s\S]*this\.combine\(info\.iid, t\.dataset\.iid\);/);
});
