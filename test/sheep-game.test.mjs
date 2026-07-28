import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { test } from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const gamePath = join(projectRoot, "project", "Adventure Scene.dc.html");
const source = await readFile(gamePath, "utf8");

const CONTRACT_START = "/* SHEEP_CONTRACT_START */";
const CONTRACT_END = "/* SHEEP_CONTRACT_END */";
const contractStart = source.indexOf(CONTRACT_START);
const contractEnd = source.indexOf(CONTRACT_END, contractStart);
assert.notEqual(contractStart, -1, "missing sheep contract start marker");
assert.notEqual(contractEnd, -1, "missing sheep contract end marker");
const contractBody = source.slice(contractStart + CONTRACT_START.length, contractEnd).trim();

function loadMethod(signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);
  assert.notEqual(start, -1, `missing production method: ${signature.trim()}`);
  assert.notEqual(end, -1, `missing method boundary: ${nextSignature.trim()}`);
  const methodSource = source.slice(start, end).trim();
  const name = signature.match(/([\w$]+)\s*\(/)?.[1];
  return vm.runInNewContext(`({${methodSource}}).${name}`);
}

function rawMethodSource(signature, nextSignature) {
  const start = source.indexOf(signature);
  const end = source.indexOf(nextSignature, start);
  assert.notEqual(start, -1, `missing production method: ${signature.trim()}`);
  assert.notEqual(end, -1, `missing method boundary: ${nextSignature.trim()}`);
  return source.slice(start, end).trim();
}

// The contract's piece limbs call this.sheepBoxLimb()/this.sheepWedgeLimb() (defined inside
// SHEEP_CONTRACT) which in turn may call this.sheepRotateVertex() (defined later in the file),
// so the contract must be evaluated on a host that has all three.
function loadContract() {
  const rotateBody = rawMethodSource("  sheepRotateVertex(vertex, pose) {", "\n  sheepProjectVertex(");
  const HostClass = vm.runInNewContext(`(class {\n${rotateBody}\n${contractBody}\n})`);
  return new HostClass().sheepPuzzleContract;
}

function extractField(name) {
  const match = contractBody.match(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*=\\s*([^;]+);"));
  assert.ok(match, `missing sheep field: ${name}`);
  return vm.runInNewContext(`(${match[1]})`);
}

function determinant(a, b, c, d) {
  const u = b.map((value, i) => value - a[i]);
  const v = c.map((value, i) => value - a[i]);
  const w = d.map((value, i) => value - a[i]);
  return u[0] * (v[1] * w[2] - v[2] * w[1])
    - u[1] * (v[0] * w[2] - v[2] * w[0])
    + u[2] * (v[0] * w[1] - v[1] * w[0]);
}

function harness(contract) {
  const game = {
    sheepPuzzleContract: contract,
    sheepLight: extractField("sheepLight"),
    sheepWallZ: extractField("sheepWallZ"),
    sheepWallScale: extractField("sheepWallScale"),
    sheepActiveIdx: 0,
    sheepObjects: [],
    state: { sheepGameOpen: true, sheepGameRound: 1 },
    setState(update) { Object.assign(this.state, update); },
  };
  game.sheepRotateVertex = loadMethod("  sheepRotateVertex(vertex, pose) {", "\n  sheepProjectVertex(");
  game.sheepProjectToWall = loadMethod("  sheepProjectToWall(vertexWorld) {", "\n  sheepConvexHull(");
  game.sheepConvexHull = loadMethod("  sheepConvexHull(points) {", "\n  sheepLimbWallPolygon(");
  game.sheepLimbWallPolygon = loadMethod("  sheepLimbWallPolygon(limb, piecePose, pieceWorldPos) {", "\n  sheepPointInPolygon(");
  game.sheepPointInPolygon = loadMethod("  sheepPointInPolygon(", "\n  sheepBuildMask(");
  game.sheepBuildMask = loadMethod("  sheepBuildMask(round, poses, options = {}) {", "\n  sheepEvaluateMask(");
  game.sheepEvaluateMask = loadMethod("  sheepEvaluateMask(targetMask, liveMask, round) {", "\n  sheepCountMaskComponents(");
  game.sheepCountMaskComponents = loadMethod("  sheepCountMaskComponents(", "\n  sheepApplyPoseDelta(");
  game.sheepApplyPoseDelta = loadMethod("  sheepApplyPoseDelta(deltaX, deltaY, deltaZ = 0) {", "\n  sheepUseSolutionAssist(");
  game.sheepCurrentRound = loadMethod("  sheepCurrentRound() {", "\n  sheepSaveProgress(");
  game.sheepLoadProgress = () => null;
  game.sheepClearProgress = () => {};
  game.sheepSaveProgress = () => {};
  return game;
}

// Think: prove actual volume (not merely z metadata), pose isolation on all three axes, and that
// the exact same deterministic production mask/matcher rejects incomplete and spill-heavy shadows.
test("every displayed sculpture piece is built from non-planar, surface-bearing limbs", () => {
  const contract = loadContract();
  for (const round of contract.rounds) {
    assert.ok(round.pieces.length >= 4, `${round.id} needs a red-herring piece alongside the essential three`);
    for (const piece of round.pieces) {
      assert.ok(piece.limbs.length >= 1, `${piece.id} needs at least one limb`);
      assert.ok(piece.worldPos.length === 3, `${piece.id} needs a 3D world position`);
      for (const limb of piece.limbs) {
        assert.ok(limb.vertices.length >= 8, `${piece.id} limb needs volumetric vertices`);
        const depths = limb.vertices.map((vertex) => vertex[2]);
        assert.ok(Math.max(...depths) - Math.min(...depths) > 0.05, `${piece.id} limb has no thickness`);
        assert.ok(Math.abs(determinant(...limb.vertices.slice(0, 4))) > 1e-5, `${piece.id} limb is coplanar`);
      }
    }
  }
});

test("three-axis manipulation changes only the selected piece within legal bounds", () => {
  const contract = loadContract();
  const game = harness(contract);
  const round = contract.rounds[0];
  game.sheepObjects = round.pieces.map((piece, index) => ({
    ...piece,
    rot: { ...round.scramble[index] },
  }));
  game.sheepActiveIdx = 1;
  const before = game.sheepObjects.map((piece) => ({ ...piece.rot }));

  game.sheepApplyPoseDelta(0.25, -0.3, 0.4);

  assert.deepEqual(game.sheepObjects[0].rot, before[0]);
  assert.notDeepEqual(game.sheepObjects[1].rot, before[1]);
  assert.deepEqual(game.sheepObjects[2].rot, before[2]);
  assert.ok(game.sheepObjects[1].rot.rx >= contract.angleBounds.min);
  assert.ok(game.sheepObjects[1].rot.ry <= contract.angleBounds.max);
  assert.ok(game.sheepObjects[1].rot.rz <= contract.angleBounds.max);
});

test("a piece rolled edge-on to the light projects far less shadow area than scrambled", () => {
  const contract = loadContract();
  const game = harness(contract);
  for (const round of contract.rounds) {
    const herringIndex = round.pieces.length - 1;
    const width = contract.mask.width, height = contract.mask.height;
    const scrambledMask = game.sheepBuildMask(round, round.scramble, { only: herringIndex });
    const solvedMask = game.sheepBuildMask(round, round.solution, { only: herringIndex });
    const count = (mask) => mask.reduce((sum, v) => sum + v, 0);
    assert.ok(count(solvedMask) < count(scrambledMask) * 0.5, `${round.id} red herring must shrink sharply when rotated to its solution pose`);
  }
});

test("solution is one combined component while incomplete and blanket masks fail", () => {
  const contract = loadContract();
  const game = harness(contract);
  for (const round of contract.rounds) {
    const target = game.sheepBuildMask(round, round.solution, { target: true });
    const solved = game.sheepBuildMask(round, round.solution);
    const match = game.sheepEvaluateMask(target, solved, round);
    assert.equal(game.sheepCountMaskComponents(solved, contract.mask.width, contract.mask.height), 1, round.id);
    assert.equal(match.pass, true, `${round.id} solution must pass`);

    const scrambled = game.sheepBuildMask(round, round.scramble);
    assert.equal(game.sheepEvaluateMask(target, scrambled, round).pass, false, `${round.id} scramble must fail`);
    for (let omitted = 0; omitted < round.pieces.length - 1; omitted++) {
      const incomplete = game.sheepBuildMask(round, round.solution, { omitted });
      assert.equal(game.sheepEvaluateMask(target, incomplete, round).pass, false, `${round.id} without ${omitted}`);
      const alone = game.sheepBuildMask(round, round.solution, { only: omitted });
      assert.equal(game.sheepEvaluateMask(target, alone, round).pass, false, `${round.id} piece ${omitted} alone`);
    }
    const blanket = new Uint8Array(target.length).fill(1);
    assert.equal(game.sheepEvaluateMask(target, blanket, round).pass, false, `${round.id} blanket`);
  }
});

test("production contract declares seagull, sailboat, anchor, then crab with legal deterministic poses and per-round thresholds", () => {
  const contract = loadContract();
  assert.deepEqual(Array.from(contract.rounds, (round) => round.id), ["seagull", "sailboat", "anchor", "crab"]);
  assert.deepEqual(Array.from(contract.rounds, (round) => round.label), ["Fiskmås", "Segelbåt", "Ankare", "Krabba"]);
  for (const round of contract.rounds) {
    assert.equal(round.scramble.length, round.pieces.length);
    assert.equal(round.solution.length, round.pieces.length);
    assert.ok(round.match.recall > 0 && round.match.precision > 0 && round.match.iou > 0, `${round.id} needs its own match thresholds`);
    for (const pose of [...round.scramble, ...round.solution]) {
      assert.ok(pose.rx >= contract.angleBounds.min && pose.rx <= contract.angleBounds.max);
      assert.ok(pose.ry >= contract.angleBounds.min && pose.ry <= contract.angleBounds.max);
      assert.ok(pose.rz >= contract.angleBounds.min && pose.rz <= contract.angleBounds.max);
    }
  }
  assert.doesNotMatch(contractBody, /starfish|sjöstjärna|snäcka|drivved/i);
});

test("later rounds reuse limb geometry from the earlier piece pool instead of authoring everything from scratch", () => {
  const contract = loadContract();
  const earlierLimbSignatures = new Set();
  contract.rounds.slice(0, 2).forEach((round) => {
    round.pieces.forEach((piece) => piece.limbs.forEach((limb) => earlierLimbSignatures.add(JSON.stringify(limb.vertices))));
  });
  let reused = 0;
  contract.rounds.slice(2).forEach((round) => {
    round.pieces.forEach((piece) => piece.limbs.forEach((limb) => {
      if (earlierLimbSignatures.has(JSON.stringify(limb.vertices))) reused++;
    }));
  });
  assert.ok(reused >= 4, `expected at least 4 reused limb shapes across the anchor/crab rounds, found ${reused}`);
});

function loadFreeRoundGenerator() {
  const rotateBody = rawMethodSource("  sheepRotateVertex(vertex, pose) {", "\n  sheepProjectVertex(");
  const boxLimbBody = rawMethodSource("  sheepBoxLimb(length, width, thickness, twist = 0) {", "\n  sheepWedgeLimb(");
  const wedgeLimbBody = rawMethodSource("  sheepWedgeLimb(baseWidth, height, thickness) {", "\n  sheepMakeLimb(");
  const makeLimbBody = rawMethodSource("  sheepMakeLimb({ length, width, thickness, twist = 0, bend = 0, taper = 1 }) {", "\n  sheepPuzzleContract = {");
  const seededRandomBody = rawMethodSource("  sheepSeededRandom(seed) {", "\n  sheepGenerateFreeRound(");
  const generateBody = rawMethodSource("  sheepGenerateFreeRound(seed) {", "\n  sheepLoadFreeRound(");
  const HostClass = vm.runInNewContext(`(class {\n${rotateBody}\n${boxLimbBody}\n${wedgeLimbBody}\n${makeLimbBody}\n${seededRandomBody}\n${generateBody}\n})`);
  return new HostClass();
}

test("Fri skugga generates a deterministic, self-consistent practice round whose solution always passes its own thresholds", () => {
  const contract = loadContract();
  const game = harness(contract);
  const freeRound = loadFreeRoundGenerator().sheepGenerateFreeRound(1234);
  const freeRoundAgain = loadFreeRoundGenerator().sheepGenerateFreeRound(1234);
  assert.deepEqual(JSON.parse(JSON.stringify(freeRound)), JSON.parse(JSON.stringify(freeRoundAgain)), "the same seed must produce the same round");
  assert.equal(freeRound.pieces.length, 4);
  assert.equal(freeRound.label, "Fri skugga");

  const target = game.sheepBuildMask(freeRound, freeRound.solution, { target: true });
  const solved = game.sheepBuildMask(freeRound, freeRound.solution);
  const match = game.sheepEvaluateMask(target, solved, freeRound);
  assert.equal(match.pass, true, "a generated round's own solution must always satisfy its own thresholds");
});

test("Fri skugga is a standalone practice mode that cannot advance the story sequence or the solved gallery", () => {
  const completeBody = rawMethodSource("  completeSheepRound() {", "\n  revealSheep(");
  const freeBranch = completeBody.split("if (this.sheepFreeRoundActive)")[1].split("return;")[0];
  assert.doesNotMatch(freeBranch, /sheepMarkSolved|revealSheep\(\)|sheepGameRound:/);
  assert.match(source, /this\.sheepFreeRoundActive\s*=\s*false;/);
});

test("normal selection and alignment path advances once per round and reveals only after the final round", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.startSheepRound = loadMethod("  startSheepRound() {", "\n  sheepCurrentRound(");
  game.setSheepActive = loadMethod("  setSheepActive(", "\n  handleSheepKeyDown(");
  game.sheepUseSolutionAssist = loadMethod("  sheepUseSolutionAssist() {", "\n  sheepUseNudgeHint(");
  game.sheepAdvanceMatch = loadMethod("  sheepAdvanceMatch(elapsedMs) {", "\n  sheepGameLoop(");
  game.completeSheepRound = loadMethod("  completeSheepRound() {", "\n  revealSheep(");
  game.sheepGameTotalRounds = contract.rounds.length;
  game.sheepHoldMs = 700;
  game.sheepGameGen = 10;
  game.revealCount = 0;
  game.sfx = () => {};
  game.revealSheep = () => { game.revealCount++; };
  game.teardownSheepGame = () => { game.sheepGameGen++; };
  game.scheduleGameAction = (callback) => callback();
  game.sheepMarkSolved = () => {};

  for (let roundNumber = 1; roundNumber <= contract.rounds.length; roundNumber++) {
    game.state.sheepGameRound = roundNumber;
    game.startSheepRound();
    assert.equal(game.sheepAdvanceMatch(700).pass, false, `round ${roundNumber} starts unsolved`);
    game.sheepObjects.forEach((_, index) => {
      game.setSheepActive(index);
      game.sheepUseSolutionAssist();
    });
    assert.equal(game.sheepAdvanceMatch(700).pass, true);
    assert.equal(game.revealCount, roundNumber === contract.rounds.length ? 1 : 0);
  }
  assert.equal(game.state.sheepGameRound, contract.rounds.length);
});

test("solved rounds are recorded to a persisted gallery keyed by round id, without duplicates", () => {
  const store = {};
  const fakeLocalStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value; },
  };
  const context = { localStorage: fakeLocalStorage };
  vm.createContext(context);
  const loadGallerySrc = rawMethodSource("  sheepLoadGallery() {", "\n  sheepMarkSolved(");
  const markSolvedSrc = rawMethodSource("  sheepMarkSolved(id, options = {}) {", "\n  openSheepGame(");
  const HostClass = vm.runInContext(`(class {\n${loadGallerySrc}\n${markSolvedSrc}\n})`, context);
  const game = new HostClass();
  game.setState = (update) => Object.assign(game, update);

  const gallery = () => Array.from(game.sheepLoadGallery(), (entry) => ({ id: entry.id, pure: entry.pure }));
  assert.deepEqual(gallery(), []);
  game.sheepMarkSolved("seagull", { pure: true });
  assert.deepEqual(gallery(), [{ id: "seagull", pure: true }]);
  game.sheepMarkSolved("seagull", { pure: false });
  assert.deepEqual(gallery(), [{ id: "seagull", pure: true }], "marking the same round twice must not duplicate it, and a pure solve must not be downgraded");
  game.sheepMarkSolved("crab");
  assert.deepEqual(gallery(), [{ id: "seagull", pure: true }, { id: "crab", pure: false }]);
});

test("legacy bare-string gallery entries from a prior session load as assisted, not pure", () => {
  const store = { sheepShadowGallery: JSON.stringify(["seagull", "sailboat"]) };
  const fakeLocalStorage = { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = value; } };
  const context = { localStorage: fakeLocalStorage };
  vm.createContext(context);
  const loadGallerySrc = rawMethodSource("  sheepLoadGallery() {", "\n  sheepMarkSolved(");
  const HostClass = vm.runInContext(`(class {\n${loadGallerySrc}\n})`, context);
  const game = new HostClass();
  const gallery = Array.from(game.sheepLoadGallery(), (entry) => ({ id: entry.id, pure: entry.pure }));
  assert.deepEqual(gallery, [{ id: "seagull", pure: false }, { id: "sailboat", pure: false }]);
});

test("completing a round without ever calling the full solution assist is recorded as a pure solve", () => {
  assert.match(source, /this\.sheepUsedFullAssistThisRound\s*=\s*true/);
  assert.match(source, /sheepMarkSolved\(rounds\[round - 1\]\.id, \{ pure: !this\.sheepUsedFullAssistThisRound \}\)/);
  assert.match(source, /sheepUsedFullAssistThisRound\s*=\s*false/);
});

test("the sheep game header exposes a solved-shadow gallery strip", () => {
  assert.match(source, /sheepGalleryChips/);
  assert.match(source, /sheepSolvedGallery/);
});

test("mid-round poses persist to localStorage and are restored on startSheepRound only for a matching round", () => {
  const contract = loadContract();
  const store = {};
  const fakeLocalStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
  };
  const context = { localStorage: fakeLocalStorage, performance: { now: () => Date.now() } };
  vm.createContext(context);
  const bodies = [
    rawMethodSource("  sheepCurrentRound() {", "\n  sheepSaveProgress("),
    rawMethodSource("  sheepSaveProgress() {", "\n  sheepLoadProgress("),
    rawMethodSource("  sheepLoadProgress() {", "\n  sheepClearProgress("),
    rawMethodSource("  sheepClearProgress() {", "\n  sheepSeededRandom("),
    rawMethodSource("  startSheepRound() {", "\n  sheepCurrentRound("),
    rawMethodSource("  sheepResetRound() {", "\n  closeSheepGame("),
  ].join("\n");
  const HostClass = vm.runInContext(`(class {\n${bodies}\n})`, context);
  const game = new HostClass();
  game.setState = (update) => Object.assign(game, update);
  game.state = { sheepGameRound: 1 };
  game.sheepPuzzleContract = contract;
  game.sheepFreeRoundActive = false;

  const pose = { rx: 0.4, ry: -0.2, rz: 0.1 };
  game.sheepObjects = contract.rounds[0].pieces.map((piece) => ({ ...piece, rot: { ...pose } }));
  game.sheepLastProgressSaveAt = 0;
  game.sheepSaveProgress();
  const saved = JSON.parse(store.sheepRoundProgress);
  assert.equal(saved.roundId, "seagull");
  assert.equal(saved.poses.length, 4);

  game.startSheepRound();
  assert.deepEqual({ ...game.sheepObjects[0].rot }, pose, "resuming the same round must restore the saved pose, not the scramble pose");

  store.sheepRoundProgress = JSON.stringify({ roundId: "sailboat", poses: contract.rounds[1].scramble });
  game.startSheepRound();
  assert.deepEqual({ ...game.sheepObjects[0].rot }, { ...contract.rounds[0].scramble[0] }, "progress saved for a different round must be ignored");

  game.sheepObjects = contract.rounds[0].pieces.map((piece) => ({ ...piece, rot: { ...pose } }));
  store.sheepRoundProgress = JSON.stringify({ roundId: "seagull", poses: [pose, pose, pose, pose] });
  game.sheepResetRound();
  assert.equal(store.sheepRoundProgress, undefined, "resetting to scramble must clear any persisted mid-round progress");
});

test("reset-to-scramble snaps poses back without touching round or best-score progress", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepResetRound = loadMethod("  sheepResetRound() {", "\n  closeSheepGame(");
  const round = contract.rounds[0];
  game.state.sheepGameRound = 1;
  game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: { ...round.solution[index] } }));
  game.sheepBestScore = 0.77;
  game.sheepBestMask = new Uint8Array([1, 0, 1]);
  game.sfx = () => {};

  game.sheepResetRound();

  game.sheepObjects.forEach((object, index) => {
    assert.equal(object.rot.rx, round.scramble[index].rx);
    assert.equal(object.rot.ry, round.scramble[index].ry);
    assert.equal(object.rot.rz, round.scramble[index].rz);
  });
  assert.equal(game.state.sheepGameRound, 1);
  assert.equal(game.sheepBestScore, 0.77, "manual reset must not erase the tracked best attempt");
  assert.equal(game.sheepMatchHold, 0);
});

test("advancing the match only records a new best when the live pose actually improves on it", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepAdvanceMatch = loadMethod("  sheepAdvanceMatch(elapsedMs) {", "\n  sheepGameLoop(");
  game.completeSheepRound = () => {};
  const round = contract.rounds[0];
  game.state.sheepGameRound = 1;

  game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: { ...round.scramble[index] } }));
  game.sheepAdvanceMatch(16);
  const firstBest = game.sheepBestScore;
  assert.ok(firstBest > 0, "a scrambled pose still records some baseline best score");

  game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: { ...round.solution[index] } }));
  game.sheepAdvanceMatch(16);
  assert.equal(game.sheepBestScore, 1, "the solved pose must become the new best");
  assert.ok(game.sheepBestMask.some((v) => v), "best mask must be captured, not left empty");

  game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: { ...round.scramble[index] } }));
  game.sheepAdvanceMatch(16);
  assert.equal(game.sheepBestScore, 1, "regressing to a worse pose must not overwrite a better recorded best");
});

test("the procedural limb generator produces non-planar, taperable, bendable geometry", () => {
  const makeLimb = loadMethod("  sheepMakeLimb({ length, width, thickness, twist = 0, bend = 0, taper = 1 }) {", "\n  sheepPuzzleContract = {");
  const straight = makeLimb.call({ sheepRotateVertex: loadMethod("  sheepRotateVertex(vertex, pose) {", "\n  sheepProjectVertex(") }, { length: 1, width: 0.3, thickness: 0.2 });
  const bent = makeLimb.call({ sheepRotateVertex: loadMethod("  sheepRotateVertex(vertex, pose) {", "\n  sheepProjectVertex(") }, { length: 1, width: 0.3, thickness: 0.2, bend: 0.4, taper: 0.3 });
  assert.equal(straight.length, 8);
  const depths = straight.map((v) => v[2]);
  assert.ok(Math.max(...depths) - Math.min(...depths) > 0.05, "generated limb must have real thickness");
  const bentPositiveX = bent.filter((v) => v[0] > 0);
  const straightPositiveX = straight.filter((v) => v[0] > 0);
  bentPositiveX.forEach((v, i) => assert.notEqual(v[1], straightPositiveX[i][1], "bend must offset the far end sideways"));
  const straightWidth = Math.max(...straightPositiveX.map((v) => v[1])) - Math.min(...straightPositiveX.map((v) => v[1]));
  const taperedWidth = Math.max(...bentPositiveX.map((v) => v[1] - 0.4)) - Math.min(...bentPositiveX.map((v) => v[1] - 0.4));
  assert.ok(taperedWidth < straightWidth, "taper must narrow the far end relative to the straight limb");
});

test("the sheep game renders a camera-only orbit inspector that cannot affect matching", () => {
  assert.match(source, /sheepDrawInspector\(ctx, object, timestamp\)/);
  assert.match(source, /this\.sheepDrawInspector\(ctx, this\.sheepObjects\[this\.sheepActiveIdx\], timestamp\)/);
  assert.doesNotMatch(rawMethodSource("  sheepDrawInspector(ctx, object, timestamp) {", "\n  drawSheepShadow("), /sheepBuildMask|sheepEvaluateMask|object\.rot\s*=/, "the inspector must only read the pose, never influence matching");
});

test("the inspector orbit can be dragged manually without ever touching a piece's actual pose", () => {
  assert.match(source, /this\.sheepInspectorDrag\s*=\s*\{ active: true/);
  const dragMoveBody = rawMethodSource("  handleSheepDragMove(event) {", "\n  handleSheepDragUp(");
  assert.match(dragMoveBody, /this\.sheepInspectorManualRy/);
  assert.match(dragMoveBody, /this\.sheepInspectorManualRx/);
  assert.doesNotMatch(dragMoveBody.split("sheepInspectorIdleUntil")[0], /sheepApplyPoseDelta/, "the inspector-drag branch must return before reaching the piece-rotation branch");
});

test("the shared light swing feeds both rendering and matching through sheepProjectToWall", () => {
  assert.match(source, /this\.sheepLightSwing\s*=\s*\{/);
  assert.match(source, /const swing = this\.sheepLightSwing/);
});

test("a continuous match-driven hum starts and stops with the sheep game lifecycle", () => {
  assert.match(source, /sheepStartHum\(\)\s*\{[\s\S]{0,1000}this\.sheepHumOsc\.start\(\)/);
  assert.match(source, /sheepStopHum\(\)\s*\{[\s\S]{0,400}this\.sheepHumOsc\.stop\(\)/);
  assert.match(source, /openSheepGame\(\)\s*\{[\s\S]*?this\.sheepStartHum\(\);/);
  assert.match(source, /teardownSheepGame\(\)\s*\{[\s\S]{0,200}this\.sheepStopHum\(\);/);
});

test("close and reset teardown clears keys, listeners, animation, and canvas references", () => {
  assert.match(source, /this\.sheepGameKeys\s*=\s*\{\}/);
  assert.match(source, /removeEventListener\("keydown", this\._sheepKeyDown\)/);
  assert.match(source, /removeEventListener\("keyup", this\._sheepKeyUp\)/);
  assert.match(source, /cancelAnimationFrame\(this\.sheepGameRAF\)/);
  assert.match(source, /this\.sheepCanvasEl\s*=\s*null/);
  assert.match(source, /this\.teardownSheepGame\(\);[\s\S]{0,500}sheepGameOpen:\s*false/);
});

test("UI exposes selectors, three-axis controls, and a user-facing alignment assist", () => {
  assert.match(source, /data-sheep-piece="\{\{ chip\.id \}\}"/);
  assert.match(source, /sheepRotateLeft/);
  assert.match(source, /sheepRotateRight/);
  assert.match(source, /sheepRotateUp/);
  assert.match(source, /sheepRotateDown/);
  assert.match(source, /sheepRollLeft/);
  assert.match(source, /sheepRollRight/);
  assert.match(source, /sheepSolutionAssist/);
  assert.match(source, /Ställ in skuggan/);
  assert.match(source, /sheepResetRoundAction/);
  assert.match(source, /Återställ till blandning/);
  assert.match(source, /sheepNudgeHint/);
  assert.match(source, />Vink</);
});

test("the nudge hint moves the active piece halfway to its solution without fully snapping it", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepUseNudgeHint = loadMethod("  sheepUseNudgeHint() {", "\n  sheepAdvanceMatch(");
  const round = contract.rounds[0];
  game.state.sheepGameRound = 1;
  game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: { ...round.scramble[index] } }));
  game.sheepActiveIdx = 0;
  const before = { ...game.sheepObjects[0].rot };
  const target = round.solution[0];

  game.sheepUseNudgeHint();

  assert.equal(game.sheepObjects[0].rot.rx, before.rx + (target.rx - before.rx) * 0.5);
  assert.equal(game.sheepObjects[0].rot.ry, before.ry + (target.ry - before.ry) * 0.5);
  assert.notEqual(game.sheepObjects[0].rot.rx, target.rx, "a nudge must not fully solve the piece");
});

test("pointer-drag rotation is wired to the canvas and rotates the active piece via mouse movement, not a click", () => {
  assert.match(source, /onMouseDown="\{\{ sheepCanvasMouseDown \}\}"/);
  assert.match(source, /handleSheepCanvasMouseDown\(event\)\s*\{[\s\S]{0,600}this\.sheepDragState\s*=/);
  assert.match(source, /handleSheepDragMove\(event\)\s*\{[\s\S]{0,1200}this\.sheepApplyPoseDelta/);
  assert.match(source, /addEventListener\("mousemove", this\._sheepDragMove\)/);
  assert.match(source, /removeEventListener\("mousemove", this\._sheepDragMove\)/);
});
