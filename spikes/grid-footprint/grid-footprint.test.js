'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  DEFAULT_TOLERANCE_CELLS,
  GridFootprintError,
  STATUS,
  fromRoll20Geometry,
  toRoll20Geometry,
} = require('./grid-footprint');

function canonical(gridX, gridY, size) {
  return {
    gridX,
    gridY,
    footprintWidth: size,
    footprintHeight: size,
  };
}

test('1x1 forward transform matches the empirical Roll20 geometry at cell size 70', () => {
  assert.deepEqual(toRoll20Geometry(canonical(13, 14, 1), 70), {
    left: 945,
    top: 1015,
    width: 70,
    height: 70,
  });
});

test('2x2 forward transform matches the empirical Roll20 geometry at cell size 70', () => {
  assert.deepEqual(toRoll20Geometry(canonical(13, 13, 2), 70), {
    left: 980,
    top: 980,
    width: 140,
    height: 140,
  });
});

test('3x3 forward transform matches the empirical Roll20 geometry at cell size 70', () => {
  assert.deepEqual(toRoll20Geometry(canonical(13, 12, 3), 70), {
    left: 1015,
    top: 945,
    width: 210,
    height: 210,
  });
});

test('4x4 forward transform uses the same formula at cell size 70', () => {
  assert.deepEqual(toRoll20Geometry(canonical(13, 12, 4), 70), {
    left: 1050,
    top: 980,
    width: 280,
    height: 280,
  });
});

test('1x1 through 4x4 use the same forward formula at cell size 80', () => {
  for (const size of [1, 2, 3, 4]) {
    assert.deepEqual(toRoll20Geometry(canonical(5, -2, size), 80), {
      left: (5 + size / 2) * 80,
      top: (-2 + size / 2) * 80,
      width: size * 80,
      height: size * 80,
    });
  }
});

test('inverse transform recognizes the empirical 1x1 fixture', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 945,
    top: 1015,
    width: 70,
    height: 70,
  }, 70), {
    status: STATUS.CANONICAL,
    gridX: 13,
    gridY: 14,
    footprintWidth: 1,
    footprintHeight: 1,
  });
});

test('inverse transform recognizes the empirical 2x2 fixture', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 980,
    top: 980,
    width: 140,
    height: 140,
  }, 70), {
    status: STATUS.CANONICAL,
    gridX: 13,
    gridY: 13,
    footprintWidth: 2,
    footprintHeight: 2,
  });
});

test('inverse transform recognizes the empirical 3x3 fixture', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 1015,
    top: 945,
    width: 210,
    height: 210,
  }, 70), {
    status: STATUS.CANONICAL,
    gridX: 13,
    gridY: 12,
    footprintWidth: 3,
    footprintHeight: 3,
  });
});

test('inverse transform recognizes a canonical 4x4 footprint', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 1050,
    top: 980,
    width: 280,
    height: 280,
  }, 70), {
    status: STATUS.CANONICAL,
    gridX: 13,
    gridY: 12,
    footprintWidth: 4,
    footprintHeight: 4,
  });
});

test('forward and inverse transforms round-trip every supported size at 70 and 80', () => {
  for (const cellSize of [70, 80]) {
    for (const size of [1, 2, 3, 4]) {
      const position = canonical(-3, 11, size);
      const geometry = toRoll20Geometry(position, cellSize);

      assert.deepEqual(fromRoll20Geometry(geometry, cellSize), {
        status: STATUS.CANONICAL,
        ...position,
      });
    }
  }
});

test('small floating point noise remains canonical', () => {
  const noiseCells = DEFAULT_TOLERANCE_CELLS / 2;
  const cellSize = 80;
  const geometry = toRoll20Geometry(canonical(5, 6, 3), cellSize);

  const result = fromRoll20Geometry({
    left: geometry.left + noiseCells * cellSize,
    top: geometry.top - noiseCells * cellSize,
    width: geometry.width + noiseCells * cellSize,
    height: geometry.height - noiseCells * cellSize,
  }, cellSize);

  assert.deepEqual(result, {
    status: STATUS.CANONICAL,
    gridX: 5,
    gridY: 6,
    footprintWidth: 3,
    footprintHeight: 3,
  });
});

test('real Jumpgate 4x4 width noise is canonical at cell size 70', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 1050,
    top: 910,
    width: 280.00006103515625,
    height: 280,
  }, 70), {
    status: STATUS.CANONICAL,
    gridX: 13,
    gridY: 11,
    footprintWidth: 4,
    footprintHeight: 4,
  });
});

test('real Jumpgate 4x4 width noise is canonical at cell size 80', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 1040,
    top: 880,
    width: 319.99993896484375,
    height: 320,
  }, 80), {
    status: STATUS.CANONICAL,
    gridX: 11,
    gridY: 9,
    footprintWidth: 4,
    footprintHeight: 4,
  });
});

test('a deliberate displacement returns OFF_GRID without silent rounding', () => {
  const result = fromRoll20Geometry({
    left: 960,
    top: 1015,
    width: 70,
    height: 70,
  }, 70);

  assert.equal(result.status, STATUS.OFF_GRID);
  assert.equal(result.gridX, 13.214285714285714);
  assert.equal(result.gridY, 14);
  assert.equal(result.nearestGridX, 13);
  assert.equal(result.footprintWidth, 1);
});

test('real Roll20 displacement well above tolerance remains OFF_GRID', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 930,
    top: 840,
    width: 240,
    height: 240,
  }, 80), {
    status: STATUS.OFF_GRID,
    gridX: 10.125,
    gridY: 9,
    nearestGridX: 10,
    nearestGridY: 9,
    footprintWidth: 3,
    footprintHeight: 3,
  });
});

test('a custom tolerance controls classification explicitly', () => {
  const geometry = { left: 945.007, top: 1015, width: 70, height: 70 };

  assert.equal(
    fromRoll20Geometry(geometry, 70).status,
    STATUS.OFF_GRID,
  );
  assert.equal(
    fromRoll20Geometry(geometry, 70, { toleranceCells: 0.001 }).status,
    STATUS.CANONICAL,
  );
});

test('dimensions incompatible with cell size return INVALID_FOOTPRINT', () => {
  const result = fromRoll20Geometry({
    left: 945,
    top: 1015,
    width: 100,
    height: 70,
  }, 70);

  assert.equal(result.status, STATUS.INVALID_FOOTPRINT);
  assert.match(result.reason, /supported square footprint/);
});

test('real 100x80 geometry remains INVALID_FOOTPRINT at cell size 80', () => {
  assert.deepEqual(fromRoll20Geometry({
    left: 930,
    top: 840,
    width: 100,
    height: 80,
  }, 80), {
    status: STATUS.INVALID_FOOTPRINT,
    reason: 'dimensions do not represent a supported square footprint',
    widthCells: 1.25,
    heightCells: 1,
  });
});

test('rectangular and larger-than-supported footprints are invalid', () => {
  assert.equal(fromRoll20Geometry({
    left: 70,
    top: 105,
    width: 70,
    height: 140,
  }, 70).status, STATUS.INVALID_FOOTPRINT);
  assert.equal(fromRoll20Geometry({
    left: 175,
    top: 175,
    width: 350,
    height: 350,
  }, 70).status, STATUS.INVALID_FOOTPRINT);
});

test('non-finite or non-positive dimensions return INVALID_FOOTPRINT', () => {
  for (const invalidDimension of [Number.NaN, Infinity, -Infinity, 0, -70]) {
    assert.equal(fromRoll20Geometry({
      left: 945,
      top: 1015,
      width: invalidDimension,
      height: 70,
    }, 70).status, STATUS.INVALID_FOOTPRINT);
  }
});

test('non-finite Roll20 positions are rejected clearly', () => {
  for (const invalidPosition of [Number.NaN, Infinity, -Infinity]) {
    assert.throws(
      () => fromRoll20Geometry({
        left: invalidPosition,
        top: 1015,
        width: 70,
        height: 70,
      }, 70),
      (error) =>
        error instanceof GridFootprintError &&
        error.code === 'INVALID_ROLL20_GEOMETRY',
    );
  }
});

test('invalid cell size is rejected by both transforms', () => {
  for (const invalidCellSize of [Number.NaN, Infinity, 0, -70]) {
    assert.throws(
      () => toRoll20Geometry(canonical(0, 0, 1), invalidCellSize),
      (error) =>
        error instanceof GridFootprintError && error.code === 'INVALID_CELL_SIZE',
    );
    assert.throws(
      () => fromRoll20Geometry({ left: 35, top: 35, width: 70, height: 70 }, invalidCellSize),
      (error) =>
        error instanceof GridFootprintError && error.code === 'INVALID_CELL_SIZE',
    );
  }
});

test('forward transform rejects fractional or non-finite grid coordinates', () => {
  for (const invalidCoordinate of [1.25, Number.NaN, Infinity]) {
    assert.throws(
      () => toRoll20Geometry({
        gridX: invalidCoordinate,
        gridY: 2,
        footprintWidth: 1,
        footprintHeight: 1,
      }, 70),
      (error) =>
        error instanceof GridFootprintError &&
        error.code === 'INVALID_CANONICAL_POSITION',
    );
  }
});

test('forward transform rejects unsupported footprints', () => {
  for (const [footprintWidth, footprintHeight] of [[0, 0], [1, 2], [5, 5]]) {
    assert.throws(
      () => toRoll20Geometry({
        gridX: 0,
        gridY: 0,
        footprintWidth,
        footprintHeight,
      }, 70),
      GridFootprintError,
    );
  }
});

test('odd and even center alignment emerges from the general formula', () => {
  for (const size of [1, 2, 3, 4]) {
    const geometry = toRoll20Geometry(canonical(10, 20, size), 70);
    const centerXCells = geometry.left / 70;
    const expectedFraction = size / 2 - Math.floor(size / 2);

    assert.equal(centerXCells - Math.floor(centerXCells), expectedFraction);
  }
});
