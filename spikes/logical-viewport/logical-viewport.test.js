'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { LogicalViewport, LogicalViewportError } = require('./logical-viewport');
const {
  RECONCILIATION_EPSILON_CELLS,
  ViewportAdapterError,
  createRoll20ViewportAdapter,
} = require('./browser-bridge');

function createVector(x = 0, y = 0, z = 0) {
  return {
    x,
    y,
    z,
    clone() {
      return createVector(this.x, this.y, this.z);
    },
    copyFromFloats(nextX, nextY, nextZ) {
      this.x = nextX;
      this.y = nextY;
      this.z = nextZ;
      return this;
    },
  };
}

function createRoll20Mock({
  cameraX = 2555,
  cameraY = -1435,
  pageId = 'page-001',
  snappingIncrement = 1,
} = {}) {
  const cameraPosition = createVector(cameraX, cameraY, 0);
  const moveCameraCalls = [];
  const page = {
    id: pageId,
    attributes: {
      width: 73,
      height: 41,
      grid_type: 'square',
      snapping_increment: snappingIncrement,
    },
    fullyLoaded: true,
    isEverythingLoaded: true,
  };
  const grid = {
    position: createVector(2555, -1435, 0),
    scaling: { x: 5110, y: -2870 },
  };
  const engine = {
    page,
    cameraTransform: { position: cameraPosition },
    moveCamera(delta) {
      moveCameraCalls.push({ x: delta.x, y: delta.y, z: delta.z });
      cameraPosition.x += delta.x;
      cameraPosition.y += delta.y;
      cameraPosition.z += delta.z;
    },
  };
  const windowObject = {
    Campaign: { engine },
    MeshScene: {
      getMeshByName(name) {
        assert.equal(name, 'tabletop-square-grid');
        return grid;
      },
    },
  };
  return { cameraPosition, engine, grid, moveCameraCalls, page, windowObject };
}

function observed(pageId, x, y, effectiveCellSize = 70) {
  return {
    pageId,
    observedXCells: x,
    observedYCells: y,
    effectiveCellSize,
  };
}

test('initial desired state is 0,0 for the current page', () => {
  const viewport = new LogicalViewport();

  assert.deepEqual(viewport.initializePage('page-001'), {
    pageId: 'page-001',
    xCells: 0,
    yCells: 0,
  });
});

test('relative logical pan changes desired integer state', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-001');

  assert.deepEqual(viewport.panViewport(3, -2), {
    pageId: 'page-001',
    xCells: 3,
    yCells: -2,
  });
});

test('multiple logical pans accumulate', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-001');

  viewport.panViewport(2, 1);
  viewport.panViewport(1, -3);

  assert.deepEqual(viewport.getDesired(), {
    pageId: 'page-001',
    xCells: 3,
    yCells: -2,
  });
});

test('desired coordinates reject non-integers', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-001');

  assert.throws(
    () => viewport.setViewport('page-001', 1.5, 2),
    (error) =>
      error instanceof LogicalViewportError &&
      error.code === 'INVALID_LOGICAL_VIEWPORT',
  );
  assert.throws(() => viewport.panViewport(1, -0.25), LogicalViewportError);
});

test('camera equal to grid position observes logical 0,0', () => {
  const mock = createRoll20Mock();

  const result = createRoll20ViewportAdapter(mock.windowObject).observeViewport();

  assert.equal(result.observedXCells, 0);
  assert.equal(result.observedYCells, 0);
});

test('70-unit cell derives observed 2,-1 from camera-grid 140,-70', () => {
  const mock = createRoll20Mock({ cameraX: 2695, cameraY: -1505 });

  const result = createRoll20ViewportAdapter(mock.windowObject).observeViewport();

  assert.equal(result.effectiveCellSize, 70);
  assert.equal(result.observedXCells, 2);
  assert.equal(result.observedYCells, -1);
});

test('80-unit configured cell derives observed 3,2 from camera-grid 240,160', () => {
  const mock = createRoll20Mock({
    cameraX: 2795,
    cameraY: -1275,
    snappingIncrement: 1.1428571428571428,
  });

  const result = createRoll20ViewportAdapter(mock.windowObject).observeViewport();

  assert.ok(Math.abs(result.effectiveCellSize - 80) < 1e-9);
  assert.ok(Math.abs(result.observedXCells - 3) < 1e-9);
  assert.ok(Math.abs(result.observedYCells - 2) < 1e-9);
});

test('fractional observed viewport state is preserved', () => {
  const mock = createRoll20Mock({ cameraX: 2712, cameraY: -1377 });

  const result = createRoll20ViewportAdapter(mock.windowObject).observeViewport();

  assert.equal(result.observedXCells, 157 / 70);
  assert.equal(result.observedYCells, 58 / 70);
  assert.equal(Number.isInteger(result.observedXCells), false);
});

test('reconciliation converts fractional cell error to world delta', () => {
  const mock = createRoll20Mock({
    cameraX: 2675,
    cameraY: -1455,
    snappingIncrement: 1.1428571428571428,
  });
  const adapter = createRoll20ViewportAdapter(mock.windowObject);

  const result = adapter.reconcileViewport({
    pageId: 'page-001',
    desiredXCells: 3,
    desiredYCells: 2,
  });

  assert.ok(Math.abs(result.observedBefore.observedXCells - 1.5) < 1e-9);
  assert.ok(Math.abs(result.observedBefore.observedYCells - -0.25) < 1e-9);
  assert.ok(Math.abs(result.deltaWorldX - 120) < 1e-9);
  assert.ok(Math.abs(result.deltaWorldY - 180) < 1e-9);
  assert.deepEqual(mock.moveCameraCalls[0], { x: 120, y: 180, z: 0 });
});

test('epsilon treats tiny two-axis error as reconciled without moveCamera', () => {
  const cellSize = 70;
  const mock = createRoll20Mock({
    cameraX: 2555 + (3 - RECONCILIATION_EPSILON_CELLS / 2) * cellSize,
    cameraY: -1435 + (2 + RECONCILIATION_EPSILON_CELLS / 2) * cellSize,
  });

  const result = createRoll20ViewportAdapter(mock.windowObject).reconcileViewport({
    pageId: 'page-001',
    desiredXCells: 3,
    desiredYCells: 2,
  });

  assert.equal(result.moved, false);
  assert.equal(result.deltaWorldX, 0);
  assert.equal(result.deltaWorldY, 0);
  assert.equal(mock.moveCameraCalls.length, 0);
});

test('page mismatch fails explicitly without moving the camera', () => {
  const mock = createRoll20Mock({ pageId: 'page-B' });

  assert.throws(
    () => createRoll20ViewportAdapter(mock.windowObject).reconcileViewport({
      pageId: 'page-A',
      desiredXCells: 3,
      desiredYCells: 2,
    }),
    (error) => error instanceof ViewportAdapterError && error.code === 'PAGE_MISMATCH',
  );
  assert.equal(mock.moveCameraCalls.length, 0);
});

test('manual observed movement never mutates Mellon desired state', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-001');
  viewport.setViewport('page-001', 3, 2);

  viewport.recordObserved(observed('page-001', 1.73, -0.41));

  assert.deepEqual(viewport.getDesired(), {
    pageId: 'page-001',
    xCells: 3,
    yCells: 2,
  });
  assert.equal(viewport.getStatus().observed.observedXCells, 1.73);
});

test('simulated renderer reset to 0,0 never mutates desired state', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-001');
  viewport.setViewport('page-001', 3, 2);

  viewport.recordObserved(observed('page-001', 0, 0));

  assert.equal(viewport.getDesired().xCells, 3);
  assert.equal(viewport.getDesired().yCells, 2);
});

test('after renderer reset reconciliation moves Roll20 back to desired state', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-001');
  viewport.setViewport('page-001', 3, 2);
  viewport.recordObserved(observed('page-001', 0, 0));
  const mock = createRoll20Mock();

  const desired = viewport.getDesired();
  const result = createRoll20ViewportAdapter(mock.windowObject).reconcileViewport({
    pageId: desired.pageId,
    desiredXCells: desired.xCells,
    desiredYCells: desired.yCells,
  });

  assert.deepEqual(mock.moveCameraCalls[0], { x: 210, y: 140, z: 0 });
  assert.equal(result.observedAfter.observedXCells, 3);
  assert.equal(result.observedAfter.observedYCells, 2);
  assert.deepEqual(viewport.getDesired(), desired);
});

test('observing a different page exposes mismatch without reinterpreting desired state', () => {
  const viewport = new LogicalViewport();
  viewport.initializePage('page-A');
  viewport.setViewport('page-A', 3, 2);

  const status = viewport.recordObserved(observed('page-B', 0, 0));

  assert.equal(status.pageMatches, false);
  assert.equal(status.desired.pageId, 'page-A');
  assert.equal(status.observed.pageId, 'page-B');
});
