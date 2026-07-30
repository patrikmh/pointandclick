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
  assert.ok(match, `missing sonar field: ${name}`);
  return vm.runInNewContext(`(${match[1]})`);
}

const grid = extractField("sonarGrid");
const contract = extractField("sonarContract");
const columns = extractField("sonarColumns");

const distance = loadMethod("  sonarDistance(a, b) {", "\n  sonarCellLabel(");
const cellLabel = loadMethod("  sonarCellLabel(cell) {", "\n  // Distance bands only");
const echoLine = loadMethod("  sonarEchoLine(distance) {", "\n  sonarMatchesAll(");
const matchesAll = loadMethod("  sonarMatchesAll(cell, pings) {", "\n  // Cells still consistent");
const candidates = loadMethod("  sonarCandidates(pings) {", "\n  openSonarGame(");

function host() {
  return { sonarGrid: grid, sonarColumns: columns, sonarDistance: distance, sonarMatchesAll: matchesAll };
}

function pingFrom(cell, target) {
  return { x: cell.x, y: cell.y, distance: distance.call(host(), cell, target) };
}

function allCells() {
  const cells = [];
  for (let y = 0; y < grid.rows; y++) for (let x = 0; x < grid.cols; x++) cells.push({ x, y });
  return cells;
}

test("the chart holds three distinct wrecks, all inside the grid", () => {
  assert.equal(contract.rounds.length, 3);
  assert.equal(new Set(contract.rounds.map((round) => round.id)).size, 3);
  assert.equal(new Set(contract.rounds.map((round) => `${round.target.x},${round.target.y}`)).size, 3, "two rounds must not hide the wreck in the same cell");

  for (const round of contract.rounds) {
    assert.ok(round.target.x >= 0 && round.target.x < grid.cols, `${round.id} is off the chart horizontally`);
    assert.ok(round.target.y >= 0 && round.target.y < grid.rows, `${round.id} is off the chart vertically`);
    assert.ok(round.label && round.label.length > 3, `${round.id} needs a name the captain can bark`);
    assert.ok(round.budget >= 3 && round.budget <= 6, `${round.id} needs a sane star budget`);
  }
});

test("a ping reports true euclidean distance, and reads back as a chart square", () => {
  const scope = host();
  assert.equal(distance.call(scope, { x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  assert.equal(distance.call(scope, { x: 2, y: 2 }, { x: 2, y: 2 }), 0);
  assert.equal(
    distance.call(scope, { x: 1, y: 6 }, { x: 5, y: 2 }),
    distance.call(scope, { x: 5, y: 2 }, { x: 1, y: 6 }),
    "distance must be symmetric",
  );

  assert.equal(cellLabel.call(scope, { x: 0, y: 0 }), "A1");
  assert.equal(cellLabel.call(scope, { x: 8, y: 6 }), "I7");
  assert.equal(columns.length, grid.cols, "every column needs a letter");
});

test("every wreck is findable by triangulation, not by luck", () => {
  const scope = host();

  for (const round of contract.rounds) {
    const target = round.target;

    // no single ping from any corner may identify the wreck, or the round
    // collapses into one lucky click instead of a triangulation
    for (const corner of [{ x: 0, y: 0 }, { x: grid.cols - 1, y: 0 }, { x: 0, y: grid.rows - 1 }, { x: grid.cols - 1, y: grid.rows - 1 }]) {
      const single = candidates.call(scope, [pingFrom(corner, target)]);
      assert.ok(single.length > 1, `${round.id} is given away by a single ping from ${cellLabel.call(scope, corner)}`);
    }

    // three corner pings pin it down exactly, within the star budget
    const corners = [{ x: 0, y: 0 }, { x: grid.cols - 1, y: 0 }, { x: 0, y: grid.rows - 1 }];
    const pings = corners.map((corner) => pingFrom(corner, target));
    const narrowed = candidates.call(scope, pings);
    assert.equal(narrowed.length, 1, `${round.id} stays ambiguous after three pings`);
    assert.equal(narrowed[0].x, target.x, `${round.id} triangulates to the wrong column`);
    assert.equal(narrowed[0].y, target.y, `${round.id} triangulates to the wrong row`);
    assert.ok(pings.length <= round.budget, `${round.id} cannot be solved cleanly within its own budget`);
  }
});

test("candidates only ever narrow as more echoes come in", () => {
  const scope = host();
  const target = contract.rounds[0].target;
  const probes = [{ x: 1, y: 1 }, { x: 7, y: 1 }, { x: 4, y: 6 }];

  let previous = allCells().length;
  const pings = [];
  for (const probe of probes) {
    pings.push(pingFrom(probe, target));
    const remaining = candidates.call(scope, pings);
    assert.ok(remaining.length <= previous, "an echo must never widen the search");
    assert.ok(remaining.some((cell) => cell.x === target.x && cell.y === target.y), "the wreck must always survive its own echoes");
    previous = remaining.length;
  }
  assert.equal(previous, 1);
});

test("the captain reports range only — never a bearing", () => {
  const scope = host();
  const lines = [0, 1, 2, 3, 5, 9].map((d) => echoLine.call(scope, d));

  for (const line of lines) {
    assert.ok(line && line.length > 4, "every band needs a line");
    assert.doesNotMatch(
      line,
      /styrbord|babord|norr|söder|öster|väster|uppåt|nedåt|vänster|höger/i,
      `"${line}" leaks a direction, which would defeat triangulation`,
    );
  }
  assert.ok(new Set(lines).size >= 3, "the bands should sound different");
  assert.notEqual(echoLine.call(scope, 0), echoLine.call(scope, 9), "on top of the wreck must not read like empty water");
});

test("marking the right cell solves, marking the wrong one costs a lod", () => {
  const markStart = source.indexOf("  sonarMarkCell(cell) {");
  const mark = source.slice(markStart, source.indexOf("\n  sonarSolveRound(", markStart));
  assert.match(mark, /cell\.x !== round\.target\.x \|\| cell\.y !== round\.target\.y/);
  assert.match(mark, /missed: true/, "a wrong mark is recorded on the chart");
  assert.match(mark, /this\.sonarSolveRound\(\)/);

  const solveStart = source.indexOf("  sonarSolveRound() {");
  const solve = source.slice(solveStart, source.indexOf("\n  sonarToggleMark(", solveStart));
  assert.match(solve, /pure = this\.sonarPings\.length <= round\.budget/, "the star is earned by using few lod");
  assert.match(solve, /subHelped: true/, "finishing the chart is what makes the captain helped");
});

test("the captain counts as helped only when the wrecks are found", () => {
  assert.match(source, /sub: S\.subHelped,/, "clicking the periscope must not count as helping him");
  assert.doesNotMatch(source, /\n      sub: d\.sub,/);
});

test("the chest hands over the map and swallows the key", () => {
  const start = source.indexOf("  openChest() {");
  const open = source.slice(start, start + 700);
  assert.match(open, /defId !== "key"/, "the key is single-use like every other item");
  assert.match(open, /defId: "map"/, "the chest must actually yield the map");
  assert.match(source, /\n    map:\s+\{ type: "item"/, "the map needs an inventory definition");
});

test("the map on the submarine is the way in", () => {
  const start = source.indexOf('if (defId === "map" && target === "sub")');
  assert.notEqual(start, -1, "missing map-on-sub branch");
  const branch = source.slice(start, source.indexOf('if (target === "chest")', start));
  assert.match(branch, /label: "Ta rodret", onClick: \(\) => this\.openSonarGame\(\)/);
  assert.match(branch, /this\.state\.subHelped/, "a finished chart must not reopen the drill");
});

test("the sonar cleans up after itself", () => {
  const start = source.indexOf("  teardownSonarGame() {");
  const teardown = source.slice(start, source.indexOf("\n  initSonarCanvas(", start));
  assert.match(teardown, /removeEventListener\("keydown"/);
  assert.match(teardown, /cancelAnimationFrame\(this\.sonarRAF\)/);
  assert.match(teardown, /this\.sonarCanvasEl = null/);
  assert.match(teardown, /this\.sonarCtx = null/);

  assert.match(source, /this\.teardownSonarGame\(\);\s*\n\s*this\.sonarPings = \[\];/, "a game reset must drop the chart too");

  const loopStart = source.indexOf("  startSonarLoop() {");
  const loop = source.slice(loopStart, source.indexOf("\n  sonarCellRect(", loopStart));
  assert.match(loop, /\(this\.sonarGeneration \|\| 0\) !== generation/, "a reopened chart abandons the old frame loop");

  for (const field of ['sonarOpen: false', 'sonarRound: 0', 'sonarSolved: []', 'subHelped: false']) {
    assert.ok(source.split(field).length - 1 >= 2, `${field} must appear in both initial state and reset`);
  }
});
