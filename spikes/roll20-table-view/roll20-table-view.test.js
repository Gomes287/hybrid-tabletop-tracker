'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  TableViewError,
  createTableViewAdapter,
  handlePanViewportMessage,
  inspectTableViewReadiness,
  isPanViewportMessage,
  waitForTableViewReadiness,
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

function createRoll20Mock(overrides = {}) {
  const position = createVector(10, 20, 30);
  const deltas = [];
  const page = {
    attributes: {
      width: 25,
      height: 25,
      grid_type: 'square',
      snapping_increment: 1,
      ...overrides.pageAttributes,
    },
  };
  const grid = overrides.grid === undefined
    ? { scaling: { x: 1750, y: -1750 } }
    : overrides.grid;
  const engine = {
    page,
    cameraTransform: { position },
    moveCamera(delta) {
      deltas.push(delta);
    },
    ...overrides.engine,
  };
  const windowObject = {
    Campaign: { engine, activePage: () => page },
    MeshScene: {
      getMeshByName(name) {
        assert.equal(name, 'tabletop-square-grid');
        return grid;
      },
    },
    ...overrides.windowObject,
  };
  return { deltas, engine, grid, page, position, windowObject };
}

function assertErrorCode(action, code) {
  assert.throws(
    action,
    (error) => error instanceof TableViewError && error.code === code,
  );
}

test('snapping_increment 1 produces an effective 70-unit cell', () => {
  const mock = createRoll20Mock();
  const adapter = createTableViewAdapter(mock.windowObject);

  assert.deepEqual(adapter.getMetrics(), { cellX: 70, cellY: 70 });
});

test('snapping_increment 1.1428571428571428 produces an effective 80-unit cell', () => {
  const mock = createRoll20Mock({
    pageAttributes: {
      width: 73,
      height: 41,
      snapping_increment: 1.1428571428571428,
    },
    grid: { scaling: { x: 5110, y: -2870 } },
  });
  const adapter = createTableViewAdapter(mock.windowObject);

  const metrics = adapter.getMetrics();
  adapter.panViewport(1, 0);

  assert.ok(Math.abs(metrics.cellX - 80) < 1e-9);
  assert.ok(Math.abs(metrics.cellY - 80) < 1e-9);
  assert.ok(Math.abs(mock.deltas[0].x - 80) < 1e-9);
});

test('snapping_increment 0.5 produces an effective 35-unit cell', () => {
  const mock = createRoll20Mock({ pageAttributes: { snapping_increment: 0.5 } });
  const adapter = createTableViewAdapter(mock.windowObject);

  assert.deepEqual(adapter.getMetrics(), { cellX: 35, cellY: 35 });
  adapter.panViewport(1, 0);
  assert.equal(mock.deltas[0].x, 35);
});

test('multi-cell negative movement uses the effective configured cell size', () => {
  const mock = createRoll20Mock({
    pageAttributes: {
      width: 73,
      height: 41,
      snapping_increment: 1.1428571428571428,
    },
    grid: { scaling: { x: 5110, y: -2870 } },
  });

  createTableViewAdapter(mock.windowObject).panViewport(4, -3);

  assert.ok(Math.abs(mock.deltas[0].x - 320) < 1e-9);
  assert.ok(Math.abs(mock.deltas[0].y - -240) < 1e-9);
});

test('pans one cell horizontally in the positive direction', () => {
  const mock = createRoll20Mock();

  createTableViewAdapter(mock.windowObject).panViewport(1, 0);

  assert.deepEqual(
    { x: mock.deltas[0].x, y: mock.deltas[0].y, z: mock.deltas[0].z },
    { x: 70, y: 0, z: 0 },
  );
});

test('pans one cell horizontally in the negative direction', () => {
  const mock = createRoll20Mock();

  createTableViewAdapter(mock.windowObject).panViewport(-1, 0);

  assert.equal(mock.deltas[0].x, -70);
});

test('pans vertically using the absolute grid scale', () => {
  const mock = createRoll20Mock();

  createTableViewAdapter(mock.windowObject).panViewport(0, 1);

  assert.deepEqual(
    { x: mock.deltas[0].x, y: mock.deltas[0].y, z: mock.deltas[0].z },
    { x: 0, y: 70, z: 0 },
  );
});

test('pans multiple cells', () => {
  const mock = createRoll20Mock();

  createTableViewAdapter(mock.windowObject).panViewport(5, -2);

  assert.deepEqual(
    { x: mock.deltas[0].x, y: mock.deltas[0].y, z: mock.deltas[0].z },
    { x: 350, y: -140, z: 0 },
  );
});

test('calls moveCamera exactly once with the calculated Vector3 delta', () => {
  const mock = createRoll20Mock();

  createTableViewAdapter(mock.windowObject).panViewport(1, 0);

  assert.equal(mock.deltas.length, 1);
  assert.notEqual(mock.deltas[0], mock.position);
});

test('does not directly alter cameraTransform.position', () => {
  const mock = createRoll20Mock();
  const originalPosition = { x: mock.position.x, y: mock.position.y, z: mock.position.z };

  createTableViewAdapter(mock.windowObject).panViewport(2, 3);

  assert.deepEqual(
    { x: mock.position.x, y: mock.position.y, z: mock.position.z },
    originalPosition,
  );
});

test('fails clearly when Campaign.engine is absent', () => {
  const mock = createRoll20Mock({ windowObject: { Campaign: {} } });

  assertErrorCode(
    () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
    'ROLL20_TABLE_VIEW_UNSUPPORTED',
  );
});

test('fails clearly when MeshScene is absent', () => {
  const mock = createRoll20Mock({ windowObject: { MeshScene: null } });

  assertErrorCode(
    () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
    'ROLL20_TABLE_VIEW_UNSUPPORTED',
  );
});

test('fails clearly when tabletop-square-grid is absent', () => {
  const mock = createRoll20Mock({ grid: null });

  assertErrorCode(
    () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
    'ROLL20_TABLE_VIEW_UNSUPPORTED',
  );
});

test('rejects non-square grids', () => {
  const mock = createRoll20Mock({ pageAttributes: { grid_type: 'hex' } });

  assertErrorCode(
    () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
    'UNSUPPORTED_GRID_TYPE',
  );
});

test('rejects invalid page dimensions', () => {
  const mock = createRoll20Mock({ pageAttributes: { width: 0 } });

  assertErrorCode(
    () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
    'ROLL20_TABLE_VIEW_UNSUPPORTED',
  );
});

test('rejects invalid snapping_increment values without defaulting', () => {
  const invalidValues = [
    undefined,
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    0,
    -1,
    '1',
  ];

  for (const snappingIncrement of invalidValues) {
    const mock = createRoll20Mock({
      pageAttributes: { snapping_increment: snappingIncrement },
    });
    assertErrorCode(
      () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
      'ROLL20_TABLE_VIEW_UNSUPPORTED',
    );
    assert.equal(inspectTableViewReadiness(mock.windowObject).ready, false);
  }
});

test('accepts renderer base units approximately equal to 70', () => {
  const mock = createRoll20Mock({
    grid: { scaling: { x: 1750.125, y: -1749.875 } },
  });

  assert.deepEqual(
    createTableViewAdapter(mock.windowObject).getMetrics(),
    { cellX: 70, cellY: 70 },
  );
});

test('rejects a material renderer base-unit compatibility mismatch', () => {
  const mock = createRoll20Mock({
    grid: { scaling: { x: 1800, y: -1750 } },
  });

  assertErrorCode(
    () => createTableViewAdapter(mock.windowObject).panViewport(1, 0),
    'ROLL20_TABLE_VIEW_UNSUPPORTED',
  );
  assert.match(
    inspectTableViewReadiness(mock.windowObject).detail,
    /renderer base unit mismatch/,
  );
});

test('rejects an invalid PAN_VIEWPORT WebSocket payload', () => {
  assert.equal(isPanViewportMessage({ type: 'PAN_VIEWPORT', dxCells: '1', dyCells: 0 }), false);
  assertErrorCode(
    () => handlePanViewportMessage(
      { type: 'PAN_VIEWPORT', dxCells: Number.NaN, dyCells: 0 },
      { panViewport() {} },
    ),
    'INVALID_PAN_PAYLOAD',
  );
});

test('returns VIEWPORT_PANNED confirmation with metrics and diagnostics', () => {
  const mock = createRoll20Mock({
    pageAttributes: {
      width: 73,
      height: 41,
      snapping_increment: 1.1428571428571428,
    },
    grid: { scaling: { x: 5110, y: -2870 } },
  });
  const adapter = createTableViewAdapter(mock.windowObject);

  const confirmation = handlePanViewportMessage(
    { type: 'PAN_VIEWPORT', dxCells: 1, dyCells: -1 },
    adapter,
  );

  assert.equal(confirmation.type, 'VIEWPORT_PANNED');
  assert.equal(confirmation.dxCells, 1);
  assert.equal(confirmation.dyCells, -1);
  assert.ok(Math.abs(confirmation.cellX - 80) < 1e-9);
  assert.ok(Math.abs(confirmation.cellY - 80) < 1e-9);
  assert.deepEqual(confirmation.cameraPosition, { x: 10, y: 20, z: 30 });
});

test('readiness succeeds when engine.page becomes available after initialization', async () => {
  const mock = createRoll20Mock();
  mock.engine.page = null;
  mock.windowObject.Campaign.activePage = () => null;
  setTimeout(() => {
    mock.engine.page = mock.page;
  }, 5);

  const readiness = await waitForTableViewReadiness(mock.windowObject, {
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(readiness.ready, true);
});

test('readiness waits for available page loading indicators', async () => {
  const mock = createRoll20Mock();
  mock.page.fullyLoaded = false;
  mock.page.isEverythingLoaded = false;
  setTimeout(() => {
    mock.page.fullyLoaded = true;
    mock.page.isEverythingLoaded = true;
  }, 5);

  const readiness = await waitForTableViewReadiness(mock.windowObject, {
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(readiness.ready, true);
});

test('readiness succeeds when the square grid becomes available', async () => {
  const mock = createRoll20Mock();
  let currentGrid = null;
  mock.windowObject.MeshScene.getMeshByName = () => currentGrid;
  setTimeout(() => {
    currentGrid = mock.grid;
  }, 5);

  const readiness = await waitForTableViewReadiness(mock.windowObject, {
    pollIntervalMs: 1,
    timeoutMs: 100,
  });

  assert.equal(readiness.ready, true);
});

test('missing moveCamera becomes unsupported only after readiness timeout', async () => {
  const mock = createRoll20Mock({ engine: { moveCamera: undefined } });
  let currentTime = 0;

  await assert.rejects(
    waitForTableViewReadiness(mock.windowObject, {
      pollIntervalMs: 0,
      timeoutMs: 2,
      now: () => currentTime++,
      schedule: (callback) => setImmediate(callback),
    }),
    (error) =>
      error instanceof TableViewError &&
      error.code === 'ROLL20_TABLE_VIEW_UNSUPPORTED' &&
      error.detail.includes('moveCamera'),
  );
});

test('missing page becomes unsupported only after readiness timeout', async () => {
  const mock = createRoll20Mock();
  mock.engine.page = null;
  mock.windowObject.Campaign.activePage = () => null;
  let currentTime = 0;

  await assert.rejects(
    waitForTableViewReadiness(mock.windowObject, {
      pollIntervalMs: 0,
      timeoutMs: 2,
      now: () => currentTime++,
      schedule: (callback) => setImmediate(callback),
    }),
    (error) =>
      error instanceof TableViewError &&
      error.code === 'ROLL20_TABLE_VIEW_UNSUPPORTED' &&
      error.detail.includes('Campaign.engine.page'),
  );
});

test('PAN_VIEWPORT before readiness is rejected without calling moveCamera', () => {
  const mock = createRoll20Mock();
  const adapter = createTableViewAdapter(mock.windowObject);

  assertErrorCode(
    () => handlePanViewportMessage(
      { type: 'PAN_VIEWPORT', dxCells: 1, dyCells: 0 },
      adapter,
      { status: 'waiting' },
    ),
    'NOT_READY',
  );
  assert.equal(mock.deltas.length, 0);
});

test('PAN_VIEWPORT after readiness calls moveCamera normally', () => {
  const mock = createRoll20Mock();
  const adapter = createTableViewAdapter(mock.windowObject);
  assert.equal(inspectTableViewReadiness(mock.windowObject).ready, true);

  handlePanViewportMessage(
    { type: 'PAN_VIEWPORT', dxCells: 1, dyCells: 0 },
    adapter,
    { status: 'ready' },
  );

  assert.equal(mock.deltas.length, 1);
  assert.equal(mock.deltas[0].x, 70);
});
