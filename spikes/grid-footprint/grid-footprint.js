'use strict';

const DEFAULT_TOLERANCE_CELLS = 1e-5;
const SUPPORTED_SQUARE_FOOTPRINTS = Object.freeze([1, 2, 3, 4]);
const STATUS = Object.freeze({
  CANONICAL: 'CANONICAL',
  OFF_GRID: 'OFF_GRID',
  INVALID_FOOTPRINT: 'INVALID_FOOTPRINT',
});

class GridFootprintError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'GridFootprintError';
    this.code = code;
  }
}

function toRoll20Geometry(canonicalPosition, effectiveCellSize) {
  requireEffectiveCellSize(effectiveCellSize);
  requireCanonicalPosition(canonicalPosition);

  const {
    gridX,
    gridY,
    footprintWidth,
    footprintHeight,
  } = canonicalPosition;

  return {
    left: (gridX + footprintWidth / 2) * effectiveCellSize,
    top: (gridY + footprintHeight / 2) * effectiveCellSize,
    width: footprintWidth * effectiveCellSize,
    height: footprintHeight * effectiveCellSize,
  };
}

function fromRoll20Geometry(
  roll20Geometry,
  effectiveCellSize,
  options = {},
) {
  requireEffectiveCellSize(effectiveCellSize);
  const toleranceCells = resolveTolerance(options);
  requireRoll20GeometryObject(roll20Geometry);

  const { left, top, width, height } = roll20Geometry;

  if (!Number.isFinite(width) || !Number.isFinite(height)) {
    return invalidFootprint('width and height must be finite numbers');
  }
  if (width <= 0 || height <= 0) {
    return invalidFootprint('width and height must be greater than zero');
  }
  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    throw new GridFootprintError(
      'INVALID_ROLL20_GEOMETRY',
      'left and top must be finite numbers',
    );
  }

  const widthCells = width / effectiveCellSize;
  const heightCells = height / effectiveCellSize;
  const footprintWidth = Math.round(widthCells);
  const footprintHeight = Math.round(heightCells);

  const dimensionsMatchCells =
    isWithinTolerance(widthCells, footprintWidth, toleranceCells) &&
    isWithinTolerance(heightCells, footprintHeight, toleranceCells);
  const isSupportedSquare =
    footprintWidth === footprintHeight &&
    SUPPORTED_SQUARE_FOOTPRINTS.includes(footprintWidth);

  if (!dimensionsMatchCells || !isSupportedSquare) {
    return invalidFootprint(
      'dimensions do not represent a supported square footprint',
      { widthCells, heightCells },
    );
  }

  const gridXCells = left / effectiveCellSize - footprintWidth / 2;
  const gridYCells = top / effectiveCellSize - footprintHeight / 2;
  const nearestGridX = Math.round(gridXCells);
  const nearestGridY = Math.round(gridYCells);

  if (
    isWithinTolerance(gridXCells, nearestGridX, toleranceCells) &&
    isWithinTolerance(gridYCells, nearestGridY, toleranceCells)
  ) {
    return {
      status: STATUS.CANONICAL,
      gridX: nearestGridX,
      gridY: nearestGridY,
      footprintWidth,
      footprintHeight,
    };
  }

  return {
    status: STATUS.OFF_GRID,
    gridX: gridXCells,
    gridY: gridYCells,
    nearestGridX,
    nearestGridY,
    footprintWidth,
    footprintHeight,
  };
}

function requireCanonicalPosition(canonicalPosition) {
  if (!canonicalPosition || typeof canonicalPosition !== 'object') {
    throw new GridFootprintError(
      'INVALID_CANONICAL_POSITION',
      'canonicalPosition must be an object',
    );
  }

  requireInteger(canonicalPosition.gridX, 'gridX');
  requireInteger(canonicalPosition.gridY, 'gridY');
  requireInteger(canonicalPosition.footprintWidth, 'footprintWidth');
  requireInteger(canonicalPosition.footprintHeight, 'footprintHeight');

  if (
    canonicalPosition.footprintWidth !== canonicalPosition.footprintHeight ||
    !SUPPORTED_SQUARE_FOOTPRINTS.includes(canonicalPosition.footprintWidth)
  ) {
    throw new GridFootprintError(
      'UNSUPPORTED_FOOTPRINT',
      'footprint must be a supported square from 1x1 through 4x4',
    );
  }
}

function requireInteger(value, field) {
  if (!Number.isInteger(value)) {
    throw new GridFootprintError(
      'INVALID_CANONICAL_POSITION',
      `${field} must be an integer`,
    );
  }
}

function requireEffectiveCellSize(effectiveCellSize) {
  if (!Number.isFinite(effectiveCellSize) || effectiveCellSize <= 0) {
    throw new GridFootprintError(
      'INVALID_CELL_SIZE',
      'effectiveCellSize must be finite and greater than zero',
    );
  }
}

function requireRoll20GeometryObject(roll20Geometry) {
  if (!roll20Geometry || typeof roll20Geometry !== 'object') {
    throw new GridFootprintError(
      'INVALID_ROLL20_GEOMETRY',
      'roll20Geometry must be an object',
    );
  }
}

function resolveTolerance(options) {
  if (!options || typeof options !== 'object') {
    throw new GridFootprintError(
      'INVALID_TOLERANCE',
      'options must be an object',
    );
  }

  const toleranceCells =
    options.toleranceCells === undefined
      ? DEFAULT_TOLERANCE_CELLS
      : options.toleranceCells;

  if (!Number.isFinite(toleranceCells) || toleranceCells < 0) {
    throw new GridFootprintError(
      'INVALID_TOLERANCE',
      'toleranceCells must be finite and greater than or equal to zero',
    );
  }

  return toleranceCells;
}

function isWithinTolerance(value, target, tolerance) {
  return Math.abs(value - target) <= tolerance;
}

function invalidFootprint(reason, diagnostics = {}) {
  return {
    status: STATUS.INVALID_FOOTPRINT,
    reason,
    ...diagnostics,
  };
}

module.exports = {
  DEFAULT_TOLERANCE_CELLS,
  GridFootprintError,
  STATUS,
  SUPPORTED_SQUARE_FOOTPRINTS,
  fromRoll20Geometry,
  toRoll20Geometry,
};
