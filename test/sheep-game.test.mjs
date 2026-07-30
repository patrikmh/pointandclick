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
  game.sheepTargetMask = loadMethod("  sheepTargetMask(round) {", "\n  sheepDrawInspector(");
  game.sheepEvaluateMask = loadMethod("  sheepEvaluateMask(targetMask, liveMask, round) {", "\n  sheepCountMaskComponents(");
  game.sheepCountMaskComponents = loadMethod("  sheepCountMaskComponents(", "\n  sheepApplyPoseDelta(");
  game.sheepApplyPoseDelta = loadMethod("  sheepApplyPoseDelta(deltaX, deltaY, deltaZ = 0) {", "\n  sheepUseSolutionAssist(");
  game.sheepCurrentRound = loadMethod("  sheepCurrentRound() {", "\n  sheepSaveProgress(");
  game.sheepMatchProximityLabel = loadMethod("  sheepMatchProximityLabel(match) {", "\n  sheepSyncA11yStatus(");
  game.sheepSyncA11yStatus = loadMethod("  sheepSyncA11yStatus(match = this.sheepLastMatch) {", "\n  makeSheepWallCracks(");
  game.sheepMaybeSnapActive = loadMethod("  sheepMaybeSnapActive(round) {", "\n  sheepGameLoop(");
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

test("production contract declares lighthouse, sailboat, anchor, then fish with legal deterministic poses and per-round thresholds", () => {
  const contract = loadContract();
  assert.deepEqual(Array.from(contract.rounds, (round) => round.id), ["lighthouse", "sailboat", "anchor", "fish"]);
  assert.deepEqual(Array.from(contract.rounds, (round) => round.label), ["Fyr", "Segelbåt", "Ankare", "Fisk"]);
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
  assert.ok(reused >= 4, `expected at least 4 reused limb shapes across the anchor/fish rounds, found ${reused}`);
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
  game.setSheepActive = loadMethod("  setSheepActive(", "\n  handleSheepKeyDown(");
  game.sheepUseSolutionAssist = loadMethod("  sheepUseSolutionAssist() {", "\n  sheepUseNudgeHint(");
  game.sheepAdvanceMatch = loadMethod("  sheepAdvanceMatch(elapsedMs) {", "\n  sheepMaybeSnapActive(");
  game.sheepMaybeSnapActive = loadMethod("  sheepMaybeSnapActive(round) {", "\n  sheepGameLoop(");
  game.startSheepRound = loadMethod("  startSheepRound() {", "\n  sheepCurrentRound(");
  game.completeSheepRound = loadMethod("  completeSheepRound() {", "\n  revealSheep(");
  game.sheepGameTotalRounds = contract.rounds.length;
  game.sheepHoldMs = 700;
  game.sheepGameGen = 10;
  game.revealCount = 0;
  game.sfx = () => {};
  game.revealSheep = () => { game.revealCount++; };
  game.teardownSheepGame = () => { game.sheepGameGen++; };
  let scheduledAction = null;
  game.scheduleGameAction = (callback) => { scheduledAction = callback; };
  game.sheepMarkSolved = () => {};

  for (let roundNumber = 1; roundNumber <= contract.rounds.length; roundNumber++) {
    game.state.sheepGameRound = roundNumber;
    game.startSheepRound();
    assert.equal(game.sheepAdvanceMatch(700).pass, false, `round ${roundNumber} starts unsolved`);
    game.sheepObjects.forEach((_, index) => {
      game.setSheepActive(index);
      game.sheepUseSolutionAssist();
    });
    const solved = game.sheepAdvanceMatch(700);
    assert.ok(solved && solved.pass);
    if (scheduledAction) {
      const action = scheduledAction;
      scheduledAction = null;
      action();
    }
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
  game.sheepMarkSolved("lighthouse", { pure: false });
  assert.deepEqual(gallery(), [{ id: "lighthouse", pure: false }]);
  game.sheepMarkSolved("lighthouse", { pure: true });
  assert.deepEqual(gallery(), [{ id: "lighthouse", pure: true }], "a later replay without assistance must upgrade the same round to pure");
  game.sheepMarkSolved("lighthouse", { pure: false });
  assert.deepEqual(gallery(), [{ id: "lighthouse", pure: true }], "marking the same round twice must not duplicate it, and a pure solve must not be downgraded");
  game.sheepMarkSolved("fish");
  assert.deepEqual(gallery(), [{ id: "lighthouse", pure: true }, { id: "fish", pure: false }]);
});

test("legacy bare-string gallery entries from a prior session load as assisted, not pure", () => {
  const store = { sheepShadowGallery: JSON.stringify(["lighthouse", "sailboat"]) };
  const fakeLocalStorage = { getItem: (key) => (key in store ? store[key] : null), setItem: (key, value) => { store[key] = value; } };
  const context = { localStorage: fakeLocalStorage };
  vm.createContext(context);
  const loadGallerySrc = rawMethodSource("  sheepLoadGallery() {", "\n  sheepMarkSolved(");
  const HostClass = vm.runInContext(`(class {\n${loadGallerySrc}\n})`, context);
  const game = new HostClass();
  const gallery = Array.from(game.sheepLoadGallery(), (entry) => ({ id: entry.id, pure: entry.pure }));
  assert.deepEqual(gallery, [{ id: "lighthouse", pure: false }, { id: "sailboat", pure: false }]);
});

test("completing a round without ever calling the full solution assist is recorded as a pure solve", () => {
  assert.match(source, /this\.sheepUsedFullAssistThisRound\s*=\s*true/);
  assert.match(source, /sheepMarkSolved\(rounds\[round - 1\]\.id, \{ pure: !this\.sheepUsedFullAssistThisRound \}\)/);
  assert.match(source, /sheepUsedFullAssistThisRound\s*=\s*false/);
});

test("the sheep game header exposes a solved-shadow gallery strip", () => {
  assert.match(source, /sheepGalleryChips/);
  assert.match(source, /sheepSolvedGallery/);
  assert.match(source, /mark: solved \? \(pure \? "★" : "✓"\) : "○"/);
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
    rawMethodSource("  sheepSaveProgress(force = false) {", "\n  sheepLoadProgress("),
    rawMethodSource("  sheepLoadProgress() {", "\n  sheepClearProgress("),
    rawMethodSource("  sheepClearProgress() {", "\n  sheepSeededRandom("),
    rawMethodSource("  startSheepRound() {", "\n  sheepCurrentRound("),
    rawMethodSource("  sheepResetRound() {", "\n  closeSheepGame("),
    rawMethodSource("  sheepMatchProximityLabel(match) {", "\n  sheepSyncA11yStatus("),
    rawMethodSource("  sheepSyncA11yStatus(match = this.sheepLastMatch) {", "\n  makeSheepWallCracks("),
    rawMethodSource("  sheepMaybeSnapActive(round) {", "\n  sheepGameLoop("),
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
  assert.equal(saved.roundId, "lighthouse");
  assert.equal(saved.poses.length, 4);

  game.startSheepRound();
  assert.deepEqual({ ...game.sheepObjects[0].rot }, pose, "resuming the same round must restore the saved pose, not the scramble pose");

  store.sheepRoundProgress = JSON.stringify({ roundId: "sailboat", poses: contract.rounds[1].scramble });
  game.startSheepRound();
  assert.deepEqual({ ...game.sheepObjects[0].rot }, { ...contract.rounds[0].scramble[0] }, "progress saved for a different round must be ignored");

  game.sheepObjects = contract.rounds[0].pieces.map((piece) => ({ ...piece, rot: { ...pose } }));
  store.sheepRoundProgress = JSON.stringify({ roundId: "lighthouse", poses: [pose, pose, pose, pose] });
  game.sheepResetRound();
  assert.equal(store.sheepRoundProgress, undefined, "resetting to scramble must clear any persisted mid-round progress");
});

function loadSheepGameOpener(contract, store) {
  const fakeLocalStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
  };
  const context = {
    localStorage: fakeLocalStorage,
    performance: { now: () => Date.now() },
    requestAnimationFrame: () => 1,
    window: { addEventListener: () => {} },
  };
  vm.createContext(context);
  const bodies = [
    rawMethodSource("  openSheepGame() {", "\n  sheepStartHum("),
    rawMethodSource("  sheepBeginSession() {", "\n  sheepReplayRound("),
    rawMethodSource("  sheepReplayRound(index) {", "\n  sheepResetRound("),
    rawMethodSource("  sheepMarkSolved(id, options = {}) {", "\n  openSheepGame("),
    rawMethodSource("  completeSheepRound() {", "\n  revealSheep("),
    rawMethodSource("  sheepLoadA11ySettings() {", "\n  sheepSaveA11ySettings("),
    rawMethodSource("  startSheepRound() {", "\n  sheepCurrentRound("),
    rawMethodSource("  sheepCurrentRound() {", "\n  sheepSaveProgress("),
    rawMethodSource("  sheepSaveProgress(force = false) {", "\n  sheepLoadProgress("),
    rawMethodSource("  sheepLoadProgress() {", "\n  sheepClearProgress("),
    rawMethodSource("  sheepClearProgress() {", "\n  sheepSeededRandom("),
    rawMethodSource("  sheepLoadGallery() {", "\n  sheepMarkSolved("),
    rawMethodSource("  sheepUseSolutionAssist() {", "\n  sheepUseNudgeHint("),
    rawMethodSource("  sheepMatchProximityLabel(match) {", "\n  sheepSyncA11yStatus("),
    rawMethodSource("  sheepSyncA11yStatus(match = this.sheepLastMatch) {", "\n  makeSheepWallCracks("),
    rawMethodSource("  sheepMaybeSnapActive(round) {", "\n  sheepGameLoop("),
  ].join("\n");
  const HostClass = vm.runInContext(`(class {\n${bodies}\n})`, context);
  const game = new HostClass();
  game.sheepPuzzleContract = contract;
  game.sheepGameGen = 0;
  game.state = {};
  game.setState = (update) => Object.assign(game.state, update);
  game.teardownSheepGame = () => {};
  game.sheepStartHum = () => {};
  game.sheepGameTotalRounds = contract.rounds.length;
  game.sfx = () => {};
  game.revealCount = 0;
  game.revealSheep = () => { game.revealCount++; };
  game.scheduleGameAction = (callback) => { game.scheduledAction = callback; };
  return game;
}

test("reopening the sheep game resumes the persisted mandatory round with its saved poses", () => {
  const contract = loadContract();
  const sailboatPoses = contract.rounds[1].pieces.map((piece, index) => ({ rx: 0.3 + index * 0.1, ry: -0.4, rz: 0.2 }));
  const game = loadSheepGameOpener(contract, {
    sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: true }]),
    sheepRoundProgress: JSON.stringify({ roundId: "sailboat", poses: sailboatPoses }),
  });
  game.openSheepGame();
  assert.equal(game.state.sheepGameRound, 2, "closing during sailboat and reopening must resume round 2, not restart at round 1");
  assert.equal(game.state.sheepGameTargetName, "Segelbåt");
  game.sheepObjects.forEach((object, index) => assert.deepEqual({ ...object.rot }, sailboatPoses[index], "the resumed round must restore the saved poses, not the scramble"));
  assert.equal(game.state.sheepGameMsg, "Du fortsätter där du slutade.");

  const crabGame = loadSheepGameOpener(contract, {
    sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: false }, { id: "sailboat", pure: true }, { id: "anchor", pure: true }]),
    sheepRoundProgress: JSON.stringify({ roundId: "fish", poses: contract.rounds[3].solution }),
  });
  crabGame.openSheepGame();
  assert.equal(crabGame.state.sheepGameRound, 4, "closing during fish and reopening must resume the final round");
  assert.equal(crabGame.state.sheepGameTargetName, "Fisk");
  crabGame.sheepObjects.forEach((object, index) => assert.deepEqual({ ...object.rot }, { ...contract.rounds[3].solution[index] }));
});

test("full alignment keeps assisted provenance across save and reopen", () => {
  const contract = loadContract();
  const store = {};
  const game = loadSheepGameOpener(contract, store);
  game.openSheepGame();
  game.sheepObjects = contract.rounds[0].pieces.map((piece, index) => ({ ...piece, rot: { ...contract.rounds[0].scramble[index] } }));
  game.sheepActiveIdx = 0;
  game.sheepUseSolutionAssist();
  assert.equal(game.sheepUsedFullAssistThisRound, true, "full alignment must mark the round as assisted");
  assert.match(game.state.sheepGameMsg, /assistans/i, "full alignment must label itself as assistance");
  assert.deepEqual({ ...game.sheepObjects[0].rot }, { ...contract.rounds[0].solution[0] }, "full alignment must still snap to the exact solution");
  assert.equal(JSON.parse(store.sheepRoundProgress).usedFullAssistThisRound, true, "saved progress must remember the assisted provenance");

  const reopened = loadSheepGameOpener(contract, store);
  reopened.openSheepGame();
  assert.equal(reopened.sheepUsedFullAssistThisRound, true, "reopening must restore assisted provenance before completion");
});

// Think: the assisted -> pure upgrade in sheepMarkSolved is only honest if a player can actually
// reach it, and reaching it must never re-run the story or reveal the sheep a second time.
test("replaying an assisted round without the assist upgrades it to a pure star", () => {
  const contract = loadContract();
  const store = { sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: false }, { id: "sailboat", pure: true }]) };
  const game = loadSheepGameOpener(contract, store);
  game.openSheepGame();
  assert.equal(game.state.sheepGameRound, 3, "with lighthouse and sailboat solved, opening lands on anchor");

  game.sheepReplayRound(0);
  assert.equal(game.state.sheepGameRound, 1, "replaying the lighthouse must switch the active round to it");
  assert.equal(game.sheepUsedFullAssistThisRound, false, "a replay must start eligible for a pure star");
  game.sheepObjects.forEach((object, index) => assert.deepEqual({ ...object.rot }, { ...contract.rounds[0].scramble[index] }, "a replay must start from the scramble, not stale saved poses"));

  game.completeSheepRound();
  const gallery = JSON.parse(store.sheepShadowGallery);
  assert.deepEqual(gallery.find((entry) => entry.id === "lighthouse"), { id: "lighthouse", pure: true }, "solving the replay without assistance must upgrade the entry to pure");
  assert.equal(game.state.sheepGameRound, 1, "a replay must not advance the story to the next round");
  assert.equal(game.revealCount, 0, "a replay must never trigger the sheep reveal");
  assert.equal(game.scheduledAction, undefined, "a replay must not schedule an advance or reveal");
});

test("a replay solved with the assist never downgrades an existing pure star", () => {
  const contract = loadContract();
  const store = { sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: true }]) };
  const game = loadSheepGameOpener(contract, store);
  game.openSheepGame();
  game.sheepReplayRound(0);
  game.sheepActiveIdx = 0;
  game.sheepUseSolutionAssist();
  assert.equal(game.sheepUsedFullAssistThisRound, true);
  game.completeSheepRound();
  assert.deepEqual(JSON.parse(store.sheepShadowGallery), [{ id: "lighthouse", pure: true }], "an assisted replay must leave an already-pure star intact");
  assert.match(game.state.sheepGameMsg, /assistans/i, "an assisted replay must say the star was not earned cleanly");
});

test("replaying the final round does not re-reveal the sheep", () => {
  const contract = loadContract();
  const solvedAll = contract.rounds.map((round) => ({ id: round.id, pure: false }));
  const store = { sheepShadowGallery: JSON.stringify(solvedAll) };
  const game = loadSheepGameOpener(contract, store);
  game.openSheepGame();
  game.sheepReplayRound(contract.rounds.length - 1);
  assert.equal(game.state.sheepGameRound, contract.rounds.length);
  game.completeSheepRound();
  assert.equal(game.revealCount, 0, "replaying the last round must not fall through to the reveal branch");
  assert.equal(JSON.parse(store.sheepShadowGallery).at(-1).pure, true);
});

test("gallery chips expose a replay action and lock the rounds that are not solved yet", () => {
  assert.match(source, /locked:\s*!solved/, "unsolved chips must be marked locked");
  assert.match(source, /replay:\s*\(\)\s*=>\s*this\.sheepReplayRound\(index\)/, "each chip must be able to replay its own round");
  const chipMarkup = source.match(/<sc-for list="\{\{ sheepGalleryChips \}\}"[\s\S]*?<\/sc-for>/);
  assert.ok(chipMarkup, "the gallery strip must still render from sheepGalleryChips");
  assert.match(chipMarkup[0], /<button[^>]*onClick="\{\{ gchip\.replay \}\}"/, "chips must be real buttons so they are keyboard reachable");
  assert.match(chipMarkup[0], /disabled="\{\{ gchip\.locked \}\}"/);
  assert.match(chipMarkup[0], /aria-label="\{\{ gchip\.aria \}\}"/);
});

// Think: a persisted preference that nothing reads is not accessibility. Prove the settings reach
// the pixels the player actually looks at, and that they never touch pose, match, or story state.
function loadSheepA11y(contract, store = {}) {
  const fakeLocalStorage = {
    getItem: (key) => (key in store ? store[key] : null),
    setItem: (key, value) => { store[key] = value; },
    removeItem: (key) => { delete store[key]; },
  };
  const context = { localStorage: fakeLocalStorage };
  vm.createContext(context);
  const bodies = [
    rawMethodSource("  sheepLoadA11ySettings() {", "\n  sheepSaveA11ySettings("),
    rawMethodSource("  sheepSaveA11ySettings(settings) {", "\n  sheepSetGhostBrightness("),
    rawMethodSource("  sheepSetGhostBrightness(value) {", "\n  sheepGhostBrightnessLevels"),
    rawMethodSource("  sheepGhostBrightnessLevels = ", "\n  sheepToggleColorblind("),
    rawMethodSource("  sheepToggleColorblind() {", "\n  sheepUpdateHum("),
    rawMethodSource("  sheepGhostPalette() {", "\n  sheepDrawTargetGhost("),
    rawMethodSource("  sheepGhostAlpha(alpha) {", "\n  sheepDrawTargetGhost("),
  ].join("\n");
  const HostClass = vm.runInContext(`(class {\n${bodies}\n})`, context);
  const game = new HostClass();
  game.sheepPuzzleContract = contract;
  game.state = {};
  game.setState = (update) => Object.assign(game.state, update);
  game.sheepA11y = game.sheepLoadA11ySettings();
  return game;
}

test("ghost brightness and colour mode round-trip through storage and reach the ghost pixels", () => {
  const contract = loadContract();
  const store = {};
  const game = loadSheepA11y(contract, store);
  assert.deepEqual({ ...game.sheepA11y }, { ghostBrightness: 1, colorblind: false });
  assert.equal(game.sheepGhostAlpha(0.5), 0.5, "the default brightness must leave the ghost alpha untouched");

  game.sheepCycleGhostBrightness();
  assert.equal(game.sheepA11y.ghostBrightness, 1.6);
  assert.equal(game.sheepGhostBrightnessLabel(), "Hög", "the button must name the level it is on");
  assert.ok(game.sheepGhostAlpha(0.5) > 0.5, "a brighter setting must measurably brighten the ghost");
  assert.equal(game.sheepGhostAlpha(0.9), 1, "the ghost alpha must stay a legal 0..1 value");

  game.sheepCycleGhostBrightness();
  assert.equal(game.sheepA11y.ghostBrightness, 0.5);
  assert.equal(game.sheepGhostBrightnessLabel(), "Låg");
  assert.equal(game.sheepGhostAlpha(0.5), 0.25, "a dimmer setting must measurably dim the ghost");

  const wrapped = loadSheepA11y(contract, { sheepAccessibilitySettings: JSON.stringify({ ghostBrightness: 0.5, colorblind: false }) });
  wrapped.sheepCycleGhostBrightness();
  assert.equal(wrapped.sheepA11y.ghostBrightness, 1, "the brightness control must wrap rather than dead-end at the dimmest level");

  const standard = game.sheepGhostPalette();
  game.sheepToggleColorblind();
  const contrast = game.sheepGhostPalette();
  assert.notEqual(contrast.target, standard.target, "the colour mode must change the target ghost colour");
  assert.notEqual(contrast.pass, standard.pass, "the colour mode must also change the green pass readout");
  assert.notEqual(contrast.target, contrast.best, "the two ghosts must stay distinguishable from each other");

  const reopened = loadSheepA11y(contract, store);
  assert.deepEqual({ ...reopened.sheepA11y }, { ghostBrightness: 0.5, colorblind: true }, "both settings must survive a close and reopen");
});

test("accessibility settings never touch pose, matching, or story state", () => {
  const settingsSource = [
    rawMethodSource("  sheepSetGhostBrightness(value) {", "\n  sheepGhostBrightnessLevels"),
    rawMethodSource("  sheepGhostBrightnessLevels = ", "\n  sheepToggleColorblind("),
    rawMethodSource("  sheepToggleColorblind() {", "\n  sheepUpdateHum("),
  ].join("\n");
  assert.doesNotMatch(settingsSource, /\.rot\s*=|sheepBuildMask|sheepEvaluateMask|sheepGameRound|sheepMarkSolved|sheepMatchHold/);
  assert.match(source, /openSheepGame\(\)\s*\{[^]*?this\.sheepA11y = this\.sheepLoadA11ySettings\(\);/, "settings must be applied when the game opens");
  assert.match(source, /sheepDrawTargetGhost\(ctx, mask, rawAlpha\)[^]*?this\.sheepGhostAlpha\(rawAlpha\)/, "the target ghost must honour the brightness setting");
  assert.match(source, /sheepDrawBestGhost\(ctx, mask, rawAlpha\)[^]*?this\.sheepGhostAlpha\(rawAlpha\)/, "the best-attempt ghost must honour the same brightness setting");
});

test("the dialog exposes focusable accessibility controls", () => {
  assert.match(source, /onClick="\{\{ sheepCycleGhostBrightnessAction \}\}"/);
  assert.match(source, /onClick="\{\{ sheepToggleColorblindAction \}\}"/);
  assert.match(source, /aria-pressed="\{\{ sheepColorblindOn \}\}"/, "the colour toggle must report its state to assistive tech");
  for (const binding of ["sheepCycleGhostBrightnessAction", "sheepToggleColorblindAction", "sheepGhostBrightnessLabel", "sheepColorblindLabel", "sheepA11yVersion"]) {
    assert.match(source, new RegExp(`${binding}:`), `missing render binding: ${binding}`);
  }
});

// Think: the win is collapsing two identical builds per frame into one, but the light swings, so the
// dangerous failure is a cache that outlives the swing and freezes the ghost against the live shadow.
test("the target mask is built once per frame and rebuilt whenever the light swings", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepTargetMask = loadMethod("  sheepTargetMask(round) {", "\n  sheepDrawInspector(");
  const round = contract.rounds[0];
  let builds = 0;
  const realBuildMask = game.sheepBuildMask;
  game.sheepBuildMask = function (...args) { builds++; return realBuildMask.apply(this, args); };

  game.sheepLightSwing = { x: 0.1, y: -0.05 };
  const first = game.sheepTargetMask(round);
  const second = game.sheepTargetMask(round);
  assert.equal(builds, 1, "two calls within one frame must share a single build");
  assert.equal(second, first, "the cached call must return the very same mask");

  game.sheepLightSwing = { x: 0.14, y: -0.05 };
  const swung = game.sheepTargetMask(round);
  assert.equal(builds, 2, "a moved light must invalidate the cache");
  assert.notDeepEqual(Array.from(swung), Array.from(first), "a moved light must actually change the projected target shape");

  const otherRound = contract.rounds[1];
  game.sheepTargetMask(otherRound);
  assert.equal(builds, 3, "a different round must never reuse the previous round's mask");

  game.sheepTargetMaskCache = null;
  game.sheepTargetMask(round);
  assert.equal(builds, 4, "clearing the cache must force a rebuild");
});

test("the cached target mask is identical to an uncached build and is dropped on teardown", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepTargetMask = loadMethod("  sheepTargetMask(round) {", "\n  sheepDrawInspector(");
  const round = contract.rounds[2];
  game.sheepLightSwing = { x: -0.07, y: 0.03 };
  const cached = game.sheepTargetMask(round);
  const direct = game.sheepBuildMask(round, round.solution, { target: true });
  assert.deepEqual(Array.from(cached), Array.from(direct), "caching must not change the mask the matcher sees");

  const teardownBody = rawMethodSource("  teardownSheepGame() {", "\n  initSheepCanvas(");
  assert.match(teardownBody, /this\.sheepTargetMaskCache = null;/, "teardown must drop the cache so a stale round cannot leak into the next one");
  assert.match(rawMethodSource("  openSheepGame() {", "\n  sheepStartHum("), /this\.sheepTargetMaskCache = null;/);
});

test("reopening skips completed mandatory rounds instead of replaying them", () => {
  const contract = loadContract();

  const fresh = loadSheepGameOpener(contract, {});
  fresh.openSheepGame();
  assert.equal(fresh.state.sheepGameRound, 1, "a brand new game still starts at round 1");

  const partial = loadSheepGameOpener(contract, {
    sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: true }, { id: "sailboat", pure: false }]),
  });
  partial.openSheepGame();
  assert.equal(partial.state.sheepGameRound, 3, "solved rounds must not be replayed when there is no in-progress save");
  assert.equal(partial.state.sheepGameTargetName, "Ankare");

  const staleCompletedSave = loadSheepGameOpener(contract, {
    sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: true }, { id: "sailboat", pure: false }]),
    sheepRoundProgress: JSON.stringify({ roundId: "sailboat", poses: contract.rounds[1].scramble }),
  });
  staleCompletedSave.openSheepGame();
  assert.equal(staleCompletedSave.state.sheepGameRound, 3, "a save for an already-completed round must be ignored in favour of the first unsolved round");

  const allDone = loadSheepGameOpener(contract, {
    sheepShadowGallery: JSON.stringify(["lighthouse", "sailboat", "anchor", "fish"]),
  });
  allDone.openSheepGame();
  assert.equal(allDone.state.sheepGameRound, 1, "with every mandatory round solved the game safely falls back to round 1");
});

test("malformed or obsolete saved progress falls back to the first unsolved round with scramble poses", () => {
  const contract = loadContract();

  const malformed = loadSheepGameOpener(contract, {
    sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: true }]),
    sheepRoundProgress: "{not json",
  });
  malformed.openSheepGame();
  assert.equal(malformed.state.sheepGameRound, 2, "malformed JSON must fall back to the first unsolved round");
  assert.deepEqual({ ...malformed.sheepObjects[0].rot }, { ...contract.rounds[1].scramble[0] }, "the fallback round starts from the scramble poses");

  const obsolete = loadSheepGameOpener(contract, {
    sheepRoundProgress: JSON.stringify({ roundId: "starfish", poses: [] }),
  });
  obsolete.openSheepGame();
  assert.equal(obsolete.state.sheepGameRound, 1, "a round id that no longer exists must fall back safely");

  const wrongShape = loadSheepGameOpener(contract, {
    sheepRoundProgress: JSON.stringify({ roundId: "fish", poses: [{ rx: 0, ry: 0, rz: 0 }] }),
  });
  wrongShape.openSheepGame();
  assert.equal(wrongShape.state.sheepGameRound, 4, "a valid in-progress round is still resumed even if its saved poses are unusable");
  assert.deepEqual({ ...wrongShape.sheepObjects[0].rot }, { ...contract.rounds[3].scramble[0] }, "unusable saved poses fall back to the scramble");
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
  game.sheepAdvanceMatch = loadMethod("  sheepAdvanceMatch(elapsedMs) {", "\n  sheepMaybeSnapActive(");
  game.sheepMaybeSnapActive = loadMethod("  sheepMaybeSnapActive(round) {", "\n  sheepGameLoop(");
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

test("the nudge hint reports axis guidance without mutating pose, hold, or story state", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepUseNudgeHint = loadMethod("  sheepUseNudgeHint() {", "\n  sheepAdvanceMatch(");
  const round = contract.rounds[0];
  game.state.sheepGameRound = 1;
  game.state.sheepGameTargetName = round.label;
  game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: { ...round.scramble[index] } }));
  game.sheepActiveIdx = 0;
  const target = round.solution[0];
  const yDelta = target.ry - contract.angleBounds.min > 0.4 ? -0.4 : 0.4;
  const expectedDirection = yDelta < 0 ? "åt höger" : "åt vänster";
  const poseBefore = { rx: target.rx, ry: target.ry + yDelta, rz: target.rz };
  game.sheepObjects[0].rot = { ...poseBefore };
  game.sheepMatchHold = 123;
  game.sheepRoundComplete = false;
  game.sheepUsedFullAssistThisRound = false;
  game.sheepLastMatch = { pass: false, iou: 0.2, recall: 0.1, precision: 0.1 };
  const stateBefore = { ...game.state };

  game.sheepUseNudgeHint();

  assert.deepEqual(game.sheepObjects[0].rot, poseBefore, "Vink must not mutate the selected pose");
  assert.equal(game.sheepMatchHold, 123, "Vink must not touch the hold timer");
  assert.equal(game.sheepRoundComplete, false, "Vink must not complete the round");
  assert.equal(game.sheepUsedFullAssistThisRound, false, "Vink must not flip the assisted-completion flag");
  assert.equal(game.state.sheepGameRound, stateBefore.sheepGameRound);
  assert.equal(game.state.sheepGameTargetName, stateBefore.sheepGameTargetName);
  assert.match(game.state.sheepGameMsg, /Vink: Y-axeln behöver/);
  assert.match(game.state.sheepGameMsg, new RegExp(expectedDirection));
  assert.match(game.state.sheepGameA11yStatus, /Aktiv skulptur: /);
  assert.match(game.state.sheepGameA11yStatus, /Skuggmatch: /);
  assert.match(game.state.sheepGameA11yStatus, /Y-axeln behöver/);
  assert.match(game.state.sheepGameA11yStatus, new RegExp(expectedDirection));
});

test("pointer-drag rotation is wired to the canvas and rotates the active piece via mouse movement, not a click", () => {
  assert.match(source, /onMouseDown="\{\{ sheepCanvasMouseDown \}\}"/);
  assert.match(source, /handleSheepCanvasMouseDown\(event\)\s*\{[\s\S]{0,600}this\.sheepDragState\s*=/);
  assert.match(source, /handleSheepDragMove\(event\)\s*\{[\s\S]{0,1200}this\.sheepApplyPoseDelta/);
  assert.match(source, /addEventListener\("mousemove", this\._sheepDragMove\)/);
  assert.match(source, /removeEventListener\("mousemove", this\._sheepDragMove\)/);
});

test("sheep dialog is labelled, focusable, and exposes a live status for the active piece", () => {
  assert.match(source, /class="sheep-dialog"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /aria-labelledby="sheep-game-title"/);
  assert.match(source, /aria-describedby="sheep-game-help"/);
  assert.match(source, /id="sheep-game-title"/);
  assert.match(source, /id="sheep-game-help"/);
  assert.match(source, /id="sheep-game-status"/);
  assert.match(source, /role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(source, /tabindex="0"/);
  assert.match(source, /aria-label="Skuggteaterns spelplan"/);
  assert.match(source, /aria-label="Stäng skuggteatern"/);
});

test("sheep dialog keeps the control row inside a 1280x720 viewport budget", () => {
  assert.match(source, /@media \(max-height: 760px\)[^]*\.sheep-stage-shell \{ max-width: 720px !important;/);
});

test("sheep keyboard handling only reacts from the canvas, leaves Tab alone, and closes on Escape", () => {
  const handleSheepKeyDown = loadMethod("  handleSheepKeyDown(event) {", "\n  handleSheepKeyUp(event) {");
  const calls = { closed: 0, selected: [] };
  const canvas = { tagName: "CANVAS" };
  const game = {
    state: { sheepGameOpen: true },
    sheepCanvasEl: canvas,
    sheepObjects: [{ rot: {} }, { rot: {} }, { rot: {} }, { rot: {} }],
    sheepActiveIdx: 0,
    sheepGameKeys: {},
    sheepApplyPoseDelta: () => {},
    setSheepActive: (index) => { calls.selected.push(index); game.sheepActiveIdx = index; },
    closeSheepGame: () => { calls.closed += 1; },
  };
  const event = (key, target = canvas) => ({ key, target, repeat: false, prevented: false, preventDefault() { this.prevented = true; } });

  const canvasArrow = event("ArrowLeft");
  handleSheepKeyDown.call(game, canvasArrow);
  assert.equal(canvasArrow.prevented, true);
  assert.equal(game.sheepGameKeys.left, true);

  const buttonArrow = event("ArrowRight", { tagName: "BUTTON" });
  handleSheepKeyDown.call(game, buttonArrow);
  assert.equal(buttonArrow.prevented, false);
  assert.equal(game.sheepGameKeys.right, undefined);

  const canvasTab = event("Tab");
  handleSheepKeyDown.call(game, canvasTab);
  assert.equal(canvasTab.prevented, false);
  assert.equal(game.sheepActiveIdx, 0);

  const canvasNumber = event("1");
  handleSheepKeyDown.call(game, canvasNumber);
  assert.equal(canvasNumber.prevented, true);
  assert.equal(game.sheepActiveIdx, 0);
  assert.deepEqual(calls.selected, [0]);

  const escapeFromButton = event("Escape", { tagName: "BUTTON" });
  handleSheepKeyDown.call(game, escapeFromButton);
  assert.equal(escapeFromButton.prevented, true);
  assert.equal(calls.closed, 1);
});

// The puzzle is easier to read than the previous build: IoU is the threshold the player feels
// most (it is the live readout), so it has to be loose enough to forgive a small wobble while
// still rejecting an incomplete shadow. Recall stays tight so a missing essential piece can never
// pass on its own.
test("per-round match thresholds are looser on IoU so the final wobble is forgiven", () => {
  const contract = loadContract();
  for (const round of contract.rounds) {
    assert.ok(round.match.iou < 0.85, `${round.id} IoU ${round.match.iou} must be looser than the old 0.85`);
    assert.ok(round.match.recall >= 0.9, `${round.id} recall ${round.match.recall} must still reject a missing essential piece`);
    assert.ok(round.match.precision >= 0.8, `${round.id} precision ${round.match.precision} must still reject a blanket mask`);
  }
  assert.ok(contract.snapRadius > 0 && contract.snapRadius < 1, `snapRadius ${contract.snapRadius} must be a small but non-zero angle`);
});

test("the magnetic snap pulls the active piece to the exact solution when it is within the snap radius", () => {
  const contract = loadContract();
  const game = harness(contract);
  for (const round of contract.rounds) {
    game.sheepActiveIdx = 1;
    const target = round.solution[1];
    const radius = contract.snapRadius;
    const wobble = radius * 0.5;
    const nearSolution = { rx: target.rx + wobble, ry: target.ry - wobble, rz: target.rz + wobble * 0.5 };
    game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: index === 1 ? { ...nearSolution } : { ...round.solution[index] } }));
    const before = game.sheepObjects[1].rot;
    assert.equal(before.rx, nearSolution.rx, "before snap: rx should be the wobble value");
    assert.equal(before.ry, nearSolution.ry, "before snap: ry should be the wobble value");
    assert.equal(before.rz, nearSolution.rz, "before snap: rz should be the wobble value");
    const snapped = game.sheepMaybeSnapActive(round);
    assert.equal(snapped, true, "a pose inside the snap radius must trigger a snap");
    const after = game.sheepObjects[1].rot;
    assert.equal(after.rx, target.rx, "after snap: rx must be the exact solution");
    assert.equal(after.ry, target.ry, "after snap: ry must be the exact solution");
    assert.equal(after.rz, target.rz, "after snap: rz must be the exact solution");
    const other = game.sheepObjects[0].rot;
    assert.equal(other.rx, round.solution[0].rx, "snap must not touch other pieces");
    assert.equal(other.ry, round.solution[0].ry, "snap must not touch other pieces");
    assert.equal(other.rz, round.solution[0].rz, "snap must not touch other pieces");
  }
});

test("the magnetic snap leaves the active piece alone when it is outside the snap radius", () => {
  const contract = loadContract();
  const game = harness(contract);
  for (const round of contract.rounds) {
    game.sheepActiveIdx = 0;
    const target = round.solution[0];
    const far = { rx: target.rx + contract.snapRadius * 1.5, ry: target.ry, rz: target.rz };
    game.sheepObjects = round.pieces.map((piece, index) => ({ ...piece, rot: index === 0 ? { ...far } : { ...round.solution[index] } }));
    const before = { ...game.sheepObjects[0].rot };
    const snapped = game.sheepMaybeSnapActive(round);
    assert.equal(snapped, false, "a pose outside the snap radius must not trigger a snap");
    const after = game.sheepObjects[0].rot;
    assert.equal(after.rx, before.rx, "outside the radius the rx must be left untouched");
    assert.equal(after.ry, before.ry, "outside the radius the ry must be left untouched");
    assert.equal(after.rz, before.rz, "outside the radius the rz must be left untouched");
  }
});

test("calling sheepAdvanceMatch on a wobble pose inside the snap radius produces a passing match", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepAdvanceMatch = loadMethod("  sheepAdvanceMatch(elapsedMs) {", "\n  sheepMaybeSnapActive(");
  for (const round of contract.rounds) {
    game.state.sheepGameRound = contract.rounds.indexOf(round) + 1;
    game.sheepGameTotalRounds = contract.rounds.length;
    game.sheepMatchHold = 0;
    game.sheepBestScore = 0;
    game.sheepBestMask = null;
    game.sheepLastMatch = null;
    game.sheepHoldMs = 700;
    game.completeSheepRound = () => {};
    const wobble = contract.snapRadius * 0.4;
    game.sheepObjects = round.pieces.map((piece, index) => {
      const target = round.solution[index];
      return { ...piece, rot: { rx: target.rx + wobble, ry: target.ry - wobble, rz: target.rz + wobble * 0.3 } };
    });
    game.sheepActiveIdx = 0;
    const beforeRx = game.sheepObjects[0].rot.rx;
    const after = game.sheepAdvanceMatch(16);
    assert.equal(after.pass, true, `${round.id}: a wobble pose inside the snap radius must pass after a single advance`);
    assert.equal(game.sheepObjects[0].rot.rx, round.solution[0].rx, `${round.id}: the advance must have snapped the active piece home on rx`);
    assert.equal(game.sheepObjects[0].rot.ry, round.solution[0].ry, `${round.id}: the advance must have snapped the active piece home on ry`);
    assert.notEqual(game.sheepObjects[0].rot.rx, beforeRx, `${round.id}: the advance must actually change the rx pose`);
  }
});

// The prior build shipped with seagull and crab producing byte-identical target masks (IoU 1.0),
// which meant the rounds were indistinguishable to the matcher. The contract is now built from
// hard-edged nautical objects, so every pair must read as a different silhouette on the wall.
test("the four round target silhouettes are pairwise distinct so the rounds can be told apart", () => {
  const contract = loadContract();
  const game = harness(contract);
  const targets = contract.rounds.map((round) => game.sheepBuildMask(round, round.solution, { target: true }));
  for (let i = 0; i < targets.length; i++) {
    for (let j = i + 1; j < targets.length; j++) {
      let targetCount = 0, liveCount = 0, intersection = 0;
      for (let k = 0; k < targets[i].length; k++) {
        if (targets[i][k]) targetCount++;
        if (targets[j][k]) liveCount++;
        if (targets[i][k] && targets[j][k]) intersection++;
      }
      const iou = intersection / Math.max(1, targetCount + liveCount - intersection);
      assert.ok(iou < 0.55, `rounds ${contract.rounds[i].id} and ${contract.rounds[j].id} are too similar (IoU ${iou.toFixed(3)})`);
    }
  }
});

// Regression: a round used to solve itself and get skipped. completeSheepRound() increments
// sheepGameRound straight away, but startSheepRound() only deals the new pieces 650ms later. In
// that window sheepCurrentRound() is already the NEXT round while sheepObjects still holds the
// PREVIOUS round's pieces at their solved poses -- and every round shares the same solution vector,
// so progress got persisted as "next round, already solved" and the next startSheepRound resumed
// into a finished board, which completed itself and cascaded. The suite never caught it because it
// drives rounds synchronously and so never enters the window.
test("progress is not persisted for a round whose pieces have not been dealt yet", () => {
  const contract = loadContract();
  const store = {};
  const game = loadSheepGameOpener(contract, store);
  game.openSheepGame();
  assert.equal(game.state.sheepGameRound, 1);

  game.sheepObjects.forEach((object, index) => { object.rot = { ...contract.rounds[0].solution[index] }; });
  game.completeSheepRound();
  assert.equal(game.state.sheepGameRound, 2, "finishing round 1 must advance the round counter immediately");

  // This is the transition window: the game loop keeps saving while the old pieces are still out.
  game.sheepLastProgressSaveAt = 0;
  game.sheepSaveProgress();
  game.sheepLastProgressSaveAt = 0;
  game.sheepSaveProgress(true);
  assert.equal(store.sheepRoundProgress, undefined, "solved poses from the finished round must never be persisted against the next round");

  game.scheduledAction();
  game.sheepObjects.forEach((object, index) => {
    assert.deepEqual({ ...object.rot }, { ...contract.rounds[1].scramble[index] }, "the next round must start at its own scramble, not pre-solved");
  });
});

test("a round is only scored while the pieces on the table belong to it", () => {
  const contract = loadContract();
  const game = harness(contract);
  game.sheepObjectsBelongTo = loadMethod("  sheepObjectsBelongTo(round) {", "\n  sheepSettledSignature(");

  game.sheepObjects = contract.rounds[0].pieces.map((piece, index) => ({ ...piece, rot: { ...contract.rounds[0].scramble[index] } }));
  assert.equal(game.sheepObjectsBelongTo(contract.rounds[0]), true, "the dealt round must be scoreable");
  assert.equal(game.sheepObjectsBelongTo(contract.rounds[1]), false, "another round's pieces must not be scoreable against this board");

  game.sheepObjects = [];
  assert.equal(game.sheepObjectsBelongTo(contract.rounds[0]), false, "an empty board belongs to no round");
});

// Regression: the magnet only pulled the selected piece, so a player who eyeballed all four into
// place was refused by a shadow that already looked right -- on the anchor, four pieces within
// 0.10 rad scored an IoU of 0.75 against a 0.75 threshold.
test("every piece inside the snap radius settles, not only the selected one", () => {
  const contract = loadContract();
  const game = harness(contract);
  for (const round of contract.rounds) {
    const wobble = contract.snapRadius * 0.3;
    game.sheepActiveIdx = 0;
    game.sheepObjects = round.pieces.map((piece, index) => ({
      ...piece,
      rot: { rx: round.solution[index].rx + wobble, ry: round.solution[index].ry - wobble, rz: round.solution[index].rz + wobble * 0.5 },
    }));

    game.sheepMaybeSnapActive(round);

    game.sheepObjects.forEach((object, index) => {
      assert.deepEqual({ ...object.rot }, { ...round.solution[index] }, `${round.id}: piece ${index} was inside the radius and must have settled`);
    });
    const target = game.sheepBuildMask(round, round.solution, { target: true });
    const live = game.sheepBuildMask(round, game.sheepObjects.map((object) => object.rot));
    assert.equal(game.sheepEvaluateMask(target, live, round).pass, true, `${round.id}: a board where every piece is inside the radius must pass`);
  }
});

test("the snap still reports whether the active piece specifically settled", () => {
  const contract = loadContract();
  const game = harness(contract);
  const round = contract.rounds[0];
  const far = contract.snapRadius * 1.5;

  game.sheepActiveIdx = 0;
  game.sheepObjects = round.pieces.map((piece, index) => ({
    ...piece,
    rot: index === 0 ? { rx: round.solution[0].rx + far, ry: round.solution[0].ry, rz: round.solution[0].rz } : { ...round.solution[index] },
  }));
  assert.equal(game.sheepMaybeSnapActive(round), false, "an active piece outside the radius must report no snap even when the others settle");
  assert.equal(game.sheepObjects[0].rot.rx, round.solution[0].rx + far, "a piece outside the radius must be left alone");

  game.sheepActiveIdx = 1;
  assert.equal(game.sheepMaybeSnapActive(round), true, "an active piece already at its solution must report settled");
});

// A replay deliberately schedules nothing and leaves sheepGameRound on the replayed round (see the
// two tests above). That left the player stranded: the story round's chip is locked, so only
// closing and reopening the dialog restored it. Leaving a replay is now an explicit action.
test("leaving a replay returns to the first unsolved story round", () => {
  const contract = loadContract();
  const store = { sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: false }, { id: "sailboat", pure: true }]) };
  const game = loadSheepGameOpener(contract, store);
  game.sheepExitReplay = loadMethod("  sheepExitReplay() {", "\n  sheepResetRound(");
  game.openSheepGame();
  assert.equal(game.state.sheepGameRound, 3, "opening lands on the first unsolved round");

  game.sheepReplayRound(0);
  assert.equal(game.state.sheepGameRound, 1);
  assert.equal(game.sheepReplayActive, true);

  game.sheepExitReplay();

  assert.equal(game.sheepReplayActive, false, "leaving a replay must clear the replay flag");
  assert.equal(game.state.sheepGameRound, 3, "leaving a replay must restore the first unsolved story round");
  game.sheepObjects.forEach((object, index) => {
    assert.deepEqual({ ...object.rot }, { ...contract.rounds[2].scramble[index] }, "the restored story round must be dealt at its own scramble");
  });
});

test("leaving a replay is a no-op when no replay is running", () => {
  const contract = loadContract();
  const store = { sheepShadowGallery: JSON.stringify([{ id: "lighthouse", pure: true }]) };
  const game = loadSheepGameOpener(contract, store);
  game.sheepExitReplay = loadMethod("  sheepExitReplay() {", "\n  sheepResetRound(");
  game.openSheepGame();
  const round = game.state.sheepGameRound;
  const poses = game.sheepObjects.map((object) => ({ ...object.rot }));

  game.sheepExitReplay();

  assert.equal(game.state.sheepGameRound, round, "a stray call must not move the story round");
  game.sheepObjects.forEach((object, index) => assert.deepEqual({ ...object.rot }, poses[index], "a stray call must not re-deal the board"));
});

test("the replay exit is reachable from the dialog only while a replay is running", () => {
  assert.match(source, /sheepExitReplayAction:\s*\(\)\s*=>\s*this\.sheepExitReplay\(\)/, "the exit must be bound for the template");
  assert.match(source, /sheepReplayActive:\s*!!this\.sheepReplayActive/, "the template needs the replay flag to gate the control");
  const gate = source.match(/<sc-if value="\{\{ sheepReplayActive \}\}"[\s\S]*?<\/sc-if>/);
  assert.ok(gate, "the exit control must sit behind a replay-only gate");
  assert.match(gate[0], /<button[^>]*onClick="\{\{ sheepExitReplayAction \}\}"/, "the exit must be a real button so it is keyboard reachable");
});
