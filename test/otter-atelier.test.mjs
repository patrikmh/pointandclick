import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gamePath = join(projectRoot, "project", "Adventure Scene.dc.html");
const source = await readFile(gamePath, "utf8");

function loadMethod(signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);
  assert.notEqual(start, -1, `missing production method: ${signature.trim()}`);
  assert.notEqual(end, -1, `missing method boundary: ${nextSignature.trim()}`);
  const methodSource = source.slice(start, end).trim();
  const name = signature.match(/([\w$]+)\s*\(/)?.[1];
  return vm.runInNewContext(`({${methodSource}}).${name}`);
}

function extractField(name) {
  const match = source.match(new RegExp("\\n  " + name + "\\s*=\\s*([\\s\\S]*?);\\n"));
  assert.ok(match, `missing atelier field: ${name}`);
  return vm.runInNewContext(`(${match[1]})`);
}

const briefs = extractField("atelierBriefs");
const materials = extractField("atelierMaterials");
const stage = extractField("atelierStage");
const modelRect = extractField("atelierModelRect");
const zoneSplit = extractField("atelierZoneSplit");
const zoneLabels = extractField("atelierZoneLabels");
const audience = extractField("atelierAudience");
const zoneCenters = extractField("atelierZoneCenters");

const requirementsOf = loadMethod("  atelierRequirements(placed, brief) {", "\n  atelierRuleMet(");
const ruleMet = loadMethod("  atelierRuleMet(rule, counted, worn) {", "\n  atelierTraitsOf(");
const traitsOf = loadMethod("  atelierTraitsOf(defId) {", "\n  atelierTraitCount(");
const traitCount = loadMethod("  atelierTraitCount(items, trait) {", "\n  // The loudest trait");
const audienceLine = loadMethod("  atelierAudienceLine(placed) {", "\n  atelierZoneOf(");
const zoneOf = loadMethod("  atelierZoneOf(item) {", "\n  scoreOtterLook(");
const scoreOtterLook = loadMethod("  scoreOtterLook(placed, brief) {", "\n  joinMissing(");
const joinMissing = loadMethod("  joinMissing(missing) {", "\n  otterAtelierInvite(");
const itemSize = loadMethod("  atelierItemSize(item) {", "\n  drawAtelier(");

function host(extra = {}) {
  return {
    atelierStage: stage,
    atelierModelRect: { ...modelRect },
    atelierZoneSplit: zoneSplit,
    atelierZoneLabels: zoneLabels,
    atelierZoneCenters: zoneCenters,
    atelierBriefs: briefs,
    atelierMaterials: materials,
    atelierZoneOf: zoneOf,
    atelierRequirements: requirementsOf,
    atelierRuleMet: ruleMet,
    atelierTraitsOf: traitsOf,
    atelierTraitCount: traitCount,
    atelierAudience: audience,
    ...extra,
  };
}

function wear(defId, zone, rot = 0) {
  return { defId, zone, rot };
}

test("each round is one theme with at most two things to satisfy", () => {
  assert.equal(briefs.length, 3);
  assert.equal(briefs.map((brief) => brief.key).join(","), "aterbruk,volym,kontrast");
  assert.equal(briefs.map((brief) => brief.zone).join(","), "huvud,axlar,alla");

  for (const brief of briefs) {
    assert.match(brief.theme, /^[A-ZÅÄÖ]{4,}$/, `${brief.key} needs a one-word theme`);
    assert.ok(brief.label.endsWith("."), `${brief.key} needs one plain sentence`);
    assert.ok(brief.rules.length >= 1 && brief.rules.length <= 2, `${brief.key} must stay single-themed`);
    for (const rule of brief.rules) {
      assert.ok(rule.kind && rule.label, "every rule needs a kind and a player-facing label");
      assert.ok(rule.label.length < 46, `rule "${rule.label}" is too long for a chip`);
    }
  }
  assert.equal(new Set(briefs.map((brief) => brief.theme)).size, 3, "the three rounds must not repeat a theme");
});

test("every material chip maps to an asset that exists in the bundle", async () => {
  assert.ok(materials.length >= 4, "the collage needs a real material palette");
  for (const material of materials) {
    const assetPath = join(projectRoot, "project", "assets", `${material.defId}.png`);
    await readFile(assetPath);
    assert.ok(material.size > 0 && material.size <= 1, `${material.defId} needs a sane base size`);
    assert.ok(Array.isArray(material.traits) && material.traits.length, `${material.defId} needs traits`);
    assert.match(material.origin, /^(hav|skrap)$/, `${material.defId} needs a palette group`);
  }
  assert.ok(materials.length >= 12, "the palette should be worth browsing");
  for (const trait of ["organiskt", "skrap", "glans", "volym"]) {
    assert.ok(materials.some((m) => m.traits.includes(trait)), `no material carries ${trait}`);
  }
  assert.ok(materials.some((material) => material.defId === "bottle"), "the bottle must be reusable as a material");
});

test("zones are read off the doll, and anything beside her counts as worn by nobody", () => {
  const rect = modelRect;
  const at = (fx, fy) => zoneOf.call(host(), { x: rect.x + fx * rect.w, y: rect.y + fy * rect.h });

  assert.equal(at(0.5, 0.1), "huvud");
  assert.equal(at(0.5, zoneSplit.head - 0.01), "huvud");
  assert.equal(at(0.5, zoneSplit.head + 0.01), "axlar");
  assert.equal(at(0.5, zoneSplit.shoulders + 0.01), "fall");
  assert.equal(at(0.5, 0.99), "fall");
  assert.equal(at(0.5, -0.2), "utanfor");
  assert.equal(at(0.5, 1.2), "utanfor");
  assert.equal(at(-0.5, 0.5), "utanfor");
  assert.equal(at(1.5, 0.5), "utanfor");
});

test("ÅTERBRUK wants the bottle worn on her head with a sea find", () => {
  const brief = briefs[0];
  const score = (placed) => scoreOtterLook.call(host(), placed, brief);

  const bottleOnly = score([wear("bottle", "huvud")]);
  assert.equal(bottleOnly.pass, false);
  assert.ok(bottleOnly.missing.some((label) => label.includes("havsfynd")));

  const bottleElsewhere = score([wear("bottle", "fall"), wear("seaweed-item", "huvud")]);
  assert.equal(bottleElsewhere.pass, false);
  assert.ok(bottleElsewhere.missing.some((label) => label.includes("flaskan")));

  const junkOnly = score([wear("bottle", "huvud"), wear("cap", "huvud")]);
  assert.equal(junkOnly.pass, false, "two pieces of litter is not a sea find");

  const done = score([wear("bottle", "huvud"), wear("seaweed-item", "huvud")]);
  assert.equal(done.pass, true, done.missing.join(", "));
  assert.equal(done.missing.length, 0);
});

test("VOLYM wants two bulky finds on the shoulders, one of them tilted", () => {
  const brief = briefs[1];
  const score = (placed) => scoreOtterLook.call(host(), placed, brief);

  const thin = score([wear("fishing-line", "axlar", 30), wear("snorkel", "axlar")]);
  assert.equal(thin.pass, false);
  assert.ok(thin.missing.some((label) => label.includes("skrymmande")));

  const flat = score([wear("seaweed-item", "axlar"), wear("driftwood", "axlar")]);
  assert.equal(flat.pass, false);
  assert.ok(flat.missing.some((label) => label.includes("vinklat")));

  const wrongZone = score([wear("seaweed-item", "fall", 30), wear("driftwood", "fall")]);
  assert.equal(wrongZone.pass, false, "volume has to sit on the graded zone");

  assert.equal(score([wear("seaweed-item", "axlar", -20), wear("driftwood", "axlar")]).pass, true);
  assert.equal(score([wear("net", "axlar", 14), wear("cork", "axlar")]).pass, false, "14 degrees is not a statement");
});

test("KONTRAST wants the sea set against the litter, across all three zones", () => {
  const brief = briefs[2];
  const score = (placed) => scoreOtterLook.call(host(), placed, brief);

  const allOrganic = score([
    wear("seaweed-item", "huvud", 25), wear("starfish", "huvud"),
    wear("feather", "axlar"), wear("driftwood", "axlar"), wear("shell-mussel", "fall"),
  ]);
  assert.equal(allOrganic.pass, false);
  assert.ok(allOrganic.missing.some((label) => label.includes("skräpfynd")));

  const headHeavy = score([
    wear("seaweed-item", "huvud", 25), wear("starfish", "huvud"), wear("net", "huvud"), wear("cork", "huvud"),
  ]);
  assert.equal(headHeavy.pass, false);
  assert.ok(headHeavy.missing.some((label) => label.includes("fållen")));

  const full = score([
    wear("seaweed-item", "huvud", 25), wear("net", "huvud"),
    wear("starfish", "axlar"), wear("cork", "axlar"), wear("shell-mussel", "fall"),
  ]);
  assert.equal(full.pass, true, full.missing.join(", "));

  const beside = score([
    wear("seaweed-item", "huvud", 25), wear("net", "huvud"),
    wear("starfish", "axlar"), wear("cork", "utanfor"), wear("shell-mussel", "fall"),
  ]);
  assert.equal(beside.pass, false, "material on the floor is not worn");
});

test("the live checklist and her verdict come from one requirement list", () => {
  const brief = briefs[0];
  const score = scoreOtterLook.call(host(), [wear("bottle", "huvud")], brief);

  assert.deepEqual(
    score.requirements.filter((requirement) => !requirement.met).map((requirement) => requirement.label),
    score.missing,
  );
  assert.ok(score.requirements.some((requirement) => requirement.met), "a partly-built look shows progress, not just failure");
  assert.equal(score.requirements.length, brief.rules.length, "the checklist is exactly the brief's rules");

  const done = scoreOtterLook.call(host(), [wear("bottle", "huvud"), wear("seaweed-item", "huvud")], brief);
  assert.equal(done.requirements.every((requirement) => requirement.met), true);

  assert.match(source, /atelierChecklist: this\.atelierRequirements\(this\.atelierPlacedSummary\(\), brief\)/);
  assert.match(source, /atelierChecklistChips: S\.atelierChecklist\.map/);
});

test("the brief's requirements are on screen the moment the atelier opens", () => {
  const start = source.indexOf("  openOtterAtelier() {");
  const open = source.slice(start, source.indexOf("\n  closeOtterAtelier(", start));
  assert.match(open, /atelierChecklist: this\.atelierRequirements\(\[\], brief\)/, "an empty doll must still show what is being asked");
  assert.match(open, /atelierCanUndo: false/);
});

test("advancing a round rebuilds the checklist for the new brief", () => {
  const start = source.indexOf("  async submitOtterLook() {");
  const submit = source.slice(start, source.indexOf("\n  async fetchOtterCritique(", start));

  assert.match(submit, /atelierChecklist: this\.atelierRequirements\(\[\], nextBrief\)/, "the new brief's requirements must replace the passed one's");
  assert.match(submit, /this\.atelierHistory = \[\]/, "undo must not reach back into a finished round");
  assert.match(submit, /atelierCanUndo: false/);

  // a fresh round starts with nothing ticked
  const fresh = requirementsOf.call(host(), [], briefs[1]);
  assert.equal(fresh.some((requirement) => requirement.met), false);
  assert.ok(fresh.some((requirement) => requirement.label.includes("axlarna")), "round 2 grades the shoulders");
});

test("undo restores the previous arrangement and layering is a neighbour swap", () => {
  const undoStart = source.indexOf("  atelierUndo() {");
  assert.notEqual(undoStart, -1, "missing atelierUndo");
  const undo = source.slice(undoStart, source.indexOf("\n  // Paint order", undoStart));
  assert.match(undo, /JSON\.parse\(this\.atelierHistory\.pop\(\)\)/);
  assert.match(undo, /atelierSelectedId = null/, "a piece that undo removed cannot stay selected");

  // every mutation records history first
  for (const method of ["atelierAddMaterial", "atelierRemoveSelected", "atelierClearAll", "atelierRestack", "atelierTransformSelected"]) {
    const start = source.indexOf("  " + method + "(");
    const body = source.slice(start, start + 900);
    assert.match(body, /this\.atelierSnapshot\(\)/, method + " must be undoable");
  }
  assert.match(source, /atelierHistory\.length > this\.atelierMaxHistory\) this\.atelierHistory\.shift\(\)/, "history must be bounded");
});

test("placement is anchored to her body, not the middle of the frame", () => {
  const start = source.indexOf("  measureModelAnchors(image, box) {");
  assert.notEqual(start, -1, "missing measureModelAnchors");
  const measure = source.slice(start, source.indexOf("\n  atelierAnchorFor(", start));
  assert.match(measure, /pixels\[\(y \* box\.w \+ x\) \* 4 \+ 3\] < 24/, "anchors come from the sprite's own alpha");
  for (const zone of ["huvud", "axlar", "fall"]) assert.ok(measure.includes(zone), "missing band " + zone);

  const anchorStart = source.indexOf("  atelierAnchorFor(zone) {");
  const anchorFor = source.slice(anchorStart, source.indexOf("\n  atelierBoxOf(", anchorStart));
  assert.match(anchorFor, /anchor \? anchor\.fx : 0\.5/, "must fall back before the sprite is measured");

  const addStart = source.indexOf("  atelierAddMaterial(defId) {");
  const add = source.slice(addStart, source.indexOf("\n  atelierTransformSelected(", addStart));
  assert.match(add, /this\.atelierAnchorFor\(zone\)/);
  assert.doesNotMatch(add, /rect\.w \/ 2/, "no more frame-centre placement");
});

test("the catwalk reveal is time-boxed and cancelled with the dialog", () => {
  const start = source.indexOf("  playAtelierReveal() {");
  assert.notEqual(start, -1, "missing playAtelierReveal");
  const reveal = source.slice(start, source.indexOf("\n  drawAtelierSpotlight(", start));
  assert.match(reveal, /if \(!this\.atelierCtx\) return Promise\.resolve\(\)/, "must not animate a closed dialog");
  assert.match(reveal, /\(this\.atelierGeneration \|\| 0\) !== generation/, "a reopened dialog abandons the old sweep");
  assert.match(reveal, /resolve\(\)/);

  const teardownStart = source.indexOf("  teardownOtterAtelier() {");
  const teardown = source.slice(teardownStart, source.indexOf("\n  initAtelierCanvas(", teardownStart));
  assert.match(teardown, /cancelAnimationFrame\(this\.atelierRevealRAF\)/);

  // the sweep runs while the critique is written, not before it
  assert.match(source, /Promise\.all\(\[\s*\n\s*this\.fetchOtterCritique\(brief, placed\),\s*\n\s*this\.playAtelierReveal\(\),/);
});

test("the three rounds ask for genuinely different things", () => {
  const shapes = briefs.map((brief) => JSON.stringify(brief.rules.map((rule) => [rule.kind, rule.trait || "", rule.min || 0])));
  assert.equal(new Set(shapes).size, 3, "no two rounds may grade the same way");

  const kinds = new Set(briefs.flatMap((brief) => brief.rules.map((rule) => rule.kind)));
  for (const kind of kinds) {
    const met = ruleMet.call(host(), { kind, trait: "volym", min: 1 }, [], []);
    assert.equal(typeof met, "boolean", `rule kind ${kind} must be interpretable`);
  }
  assert.equal(ruleMet.call(host(), { kind: "nonsense" }, [], []), false, "an unknown rule fails closed");
});

test("the loudest trait decides who in the cast shouts", () => {
  const scope = host();
  const shiny = audienceLine.call(scope, [wear("cap", "huvud"), wear("shell-mussel", "huvud"), wear("bottle", "huvud")]);
  assert.match(shiny, /^Sälen: /, "glans belongs to the seal");

  const junk = audienceLine.call(scope, [wear("net", "fall"), wear("rope", "fall"), wear("snorkel", "fall"), wear("fishing-line", "fall")]);
  assert.match(junk, /^(Fiskmåsen|Grävlingen): /, "litter belongs to the gull or the badger");

  assert.equal(audienceLine.call(scope, []), "", "an empty doll draws no crowd");
  assert.equal(audienceLine.call(scope, [wear("bottle", "utanfor")]), "", "material on the floor is not a look");

  // deterministic: same look, same reaction
  const look = [wear("starfish", "axlar"), wear("seaweed-item", "axlar")];
  assert.equal(audienceLine.call(scope, look), audienceLine.call(scope, look));
  assert.match(source, /atelierAudienceLine\(placed\)/, "the reaction must reach the player");
});

test("her complaint reads as one Swedish sentence", () => {
  assert.equal(joinMissing.call(host(), []), "");
  assert.equal(joinMissing.call(host(), ["a"]), "a");
  assert.equal(joinMissing.call(host(), ["a", "b"]), "a och b");
  assert.equal(joinMissing.call(host(), ["a", "b", "c"]), "a, b och c");
});

test("placed material keeps its own aspect ratio", () => {
  const boxes = { "driftwood": { x: 0, y: 0, w: 600, h: 150 }, "snorkel": { x: 0, y: 0, w: 50, h: 300 } };
  const scope = host({
    atelierBoxOf: (defId) => boxes[defId],
  });

  const wide = itemSize.call(scope, { defId: "driftwood", scale: 1 });
  assert.ok(Math.abs(wide.w / wide.h - 4) < 0.001, "wide material stays wide");

  const tall = itemSize.call(scope, { defId: "snorkel", scale: 1 });
  assert.ok(Math.abs(tall.h / tall.w - 6) < 0.001, "tall material stays tall");

  const scaled = itemSize.call(scope, { defId: "driftwood", scale: 2 });
  assert.ok(Math.abs(scaled.w - wide.w * 2) < 0.001, "scale multiplies the drawn size");

  const longest = Math.max(wide.w, wide.h);
  assert.ok(longest <= modelRect.h, "no single find dwarfs the doll");
});

test("cutting the bottle loose with the shard is what opens the atelier", () => {
  const shardStart = source.indexOf('if (defId === "shard" && target === "otter")');
  assert.notEqual(shardStart, -1, "missing shard-on-otter branch");
  const shardBlock = source.slice(shardStart, source.indexOf('if ((defId === "driftwood"', shardStart));

  assert.match(shardBlock, /cutting\.mp3/, "the cut should still be audible");
  assert.match(shardBlock, /label: "Öppna ateljén", onClick: \(\) => this\._guideOrOpen\("atelier", \(\) => this\.openOtterAtelier\(\)\)/);
  assert.match(shardBlock, /otterCoutureDone\)/, "a finished collection must not reopen the fitting");

  // the old bottle-as-item entry point is gone with the item itself
  assert.doesNotMatch(source, /defId === "bottle" && target === "otter"/);
});

test("the bottle stays on her head until the collection is finished", () => {
  const shardStart = source.indexOf('if (defId === "shard" && target === "otter")');
  const shardBlock = source.slice(shardStart, source.indexOf('if ((defId === "driftwood"', shardStart));

  assert.doesNotMatch(shardBlock, /otterFreed: true/, "cutting it loose must not bare her head yet");
  assert.doesNotMatch(shardBlock, /defId: "bottle"/, "the bottle must not become a carryable item");
  assert.match(shardBlock, /otterAtelierUnlocked: true/);
  assert.match(shardBlock, /label: "Öppna ateljén"/);

  // the sprite swap is driven by otterFreed, which only the finish sets
  assert.match(source, /otterSrc: S\.otterFreed \? "assets\/otter-free\.png"/);
  const finishStart = source.indexOf("  finishOtterCouture(critique) {");
  const finish = source.slice(finishStart, source.indexOf("\n  octoClick(", finishStart));
  assert.match(finish, /otterFreed: true/, "the finish is what takes the bottle off");
});

test("re-entry into an unfinished collection goes through the otter herself", () => {
  const clickStart = source.indexOf("  otterClick(e) {");
  const click = source.slice(clickStart, source.indexOf("\n  subEnter(", clickStart));
  assert.match(click, /otterAtelierUnlocked && !this\.state\.otterCoutureDone/);
  assert.match(click, /this\.otterAtelierInvite\(\)/);
  assert.match(click, /otterCoutureDone \?/, "she must acknowledge the finished collection");
});

test("the finished collection dresses her in the scene", () => {
  const start = source.indexOf("  finishOtterCouture(critique) {");
  assert.notEqual(start, -1, "missing finishOtterCouture");
  const finish = source.slice(start, source.indexOf("\n  gullEnter(", start));

  assert.match(finish, /otterCoutureDone: true/);
  assert.match(finish, /otterLook: look\.dataUrl/);
  assert.match(finish, /this\.teardownOtterAtelier\(\)/);
  assert.match(source, /<img src="\{\{ otterLookSrc \}\}"/, "the look must be worn in the scene");
});

test("the verdict never depends on the vision model", () => {
  const start = source.indexOf("  async fetchOtterCritique(brief, placed) {");
  assert.notEqual(start, -1, "missing fetchOtterCritique");
  const critique = source.slice(start, source.indexOf("\n  // She is allowed two sentences", start));

  assert.match(critique, /catch \(err\) \{\s*\n\s*return fallbacks\[brief\.key\];/, "an unreachable model must fall back to a written line");
  for (const brief of briefs) {
    assert.ok(critique.includes(`${brief.key}:`), `missing offline critique for ${brief.key}`);
  }

  const submitStart = source.indexOf("  async submitOtterLook() {");
  const submit = source.slice(submitStart, source.indexOf("\n  async fetchOtterCritique(", submitStart));
  assert.ok(
    submit.indexOf("this.scoreOtterLook(") < submit.indexOf("this.fetchOtterCritique("),
    "the local score decides pass/fail before the model is asked for wording"
  );
});

test("her critique is trimmed on a sentence, never mid-word", () => {
  const trim = loadMethod("  trimCritique(reply) {", "\n  // The finished look");

  assert.equal(trim.call({}, "  Godtagbart.\n Nästan avantgarde. "), "Godtagbart. Nästan avantgarde.");
  assert.equal(trim.call({}, "En. Två. Tre."), "En. Två.", "she is allowed two sentences");
  assert.equal(trim.call({}, "Utan punkt alls"), "Utan punkt alls");
  assert.equal(trim.call({}, ""), "");
  assert.equal(trim.call({}, null), "");

  const rambling = ("ordet ".repeat(80)).trim();
  const trimmed = trim.call({}, rambling);
  assert.ok(trimmed.length <= 261, "long replies stay short");
  assert.ok(trimmed.endsWith("…"), "an elided reply is marked as elided");
  assert.doesNotMatch(trimmed, /orde…$/, "never cut inside a word");

  const longSentences = `${"a".repeat(200)}. ${"b".repeat(200)}.`;
  assert.ok(trim.call({}, longSentences).length <= 261, "two huge sentences still get capped");
});

test("the atelier is torn down on close and on game reset", () => {
  assert.match(source, /closeOtterAtelier\(\) \{\s*\n\s*this\.teardownOtterAtelier\(\);/);
  assert.match(source, /this\.teardownOtterAtelier\(\);\s*\n\s*this\.atelierPlaced = \[\];/);

  const teardownStart = source.indexOf("  teardownOtterAtelier() {");
  const teardown = source.slice(teardownStart, source.indexOf("\n  initAtelierCanvas(", teardownStart));
  for (const listener of ["keydown", "mousemove", "mouseup"]) {
    assert.ok(teardown.includes(`removeEventListener("${listener}"`), `${listener} listener must be removed`);
  }

  for (const field of ["atelierOpen: false", "atelierRound: 0", "otterCoutureDone: false", "otterLook: \"\"", "otterLookBox: null"]) {
    const occurrences = source.split(field).length - 1;
    assert.ok(occurrences >= 2, `${field} must appear in both initial state and reset`);
  }
});
