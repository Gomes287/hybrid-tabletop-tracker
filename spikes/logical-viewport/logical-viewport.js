'use strict';

class LogicalViewportError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.name = 'LogicalViewportError';
    this.code = code;
  }
}

class LogicalViewport {
  constructor() {
    this.desired = null;
    this.observed = null;
  }

  initializePage(pageId) {
    requirePageId(pageId);
    if (!this.desired) {
      this.desired = { pageId, xCells: 0, yCells: 0 };
      return this.getDesired();
    }
    return this.getDesired();
  }

  setViewport(pageId, xCells, yCells) {
    requirePageId(pageId);
    requireIntegerCells(xCells, 'xCells');
    requireIntegerCells(yCells, 'yCells');
    this.assertDesiredPage(pageId);
    this.desired = { pageId, xCells, yCells };
    return this.getDesired();
  }

  panViewport(dxCells, dyCells) {
    this.requireDesired();
    requireIntegerCells(dxCells, 'dxCells');
    requireIntegerCells(dyCells, 'dyCells');
    this.desired = {
      pageId: this.desired.pageId,
      xCells: this.desired.xCells + dxCells,
      yCells: this.desired.yCells + dyCells,
    };
    return this.getDesired();
  }

  recordObserved(viewport) {
    validateObserved(viewport);
    this.initializePage(viewport.pageId);
    this.observed = {
      pageId: viewport.pageId,
      observedXCells: viewport.observedXCells,
      observedYCells: viewport.observedYCells,
      effectiveCellSize: viewport.effectiveCellSize,
    };
    return this.getStatus();
  }

  getDesired() {
    return this.desired ? { ...this.desired } : null;
  }

  getStatus() {
    return {
      desired: this.getDesired(),
      observed: this.observed ? { ...this.observed } : null,
      pageMatches: Boolean(
        this.desired &&
          this.observed &&
          this.desired.pageId === this.observed.pageId,
      ),
    };
  }

  requireDesired() {
    if (!this.desired) {
      throw new LogicalViewportError(
        'NO_ACTIVE_PAGE',
        'wait for the Roll20 Table View to report its current page',
      );
    }
    return this.getDesired();
  }

  assertDesiredPage(pageId) {
    if (this.desired && this.desired.pageId !== pageId) {
      throw new LogicalViewportError(
        'PAGE_MISMATCH',
        `desired page ${this.desired.pageId} does not match ${pageId}`,
      );
    }
  }
}

function requirePageId(pageId) {
  if (typeof pageId !== 'string' || pageId.length === 0) {
    throw new LogicalViewportError('INVALID_PAGE_ID', 'pageId must be a non-empty string');
  }
}

function requireIntegerCells(value, field) {
  if (!Number.isInteger(value)) {
    throw new LogicalViewportError(
      'INVALID_LOGICAL_VIEWPORT',
      `${field} must be an integer number of cells`,
    );
  }
}

function validateObserved(viewport) {
  if (!viewport || typeof viewport !== 'object') {
    throw new LogicalViewportError('INVALID_OBSERVED_VIEWPORT', 'viewport is required');
  }
  requirePageId(viewport.pageId);
  if (
    !Number.isFinite(viewport.observedXCells) ||
    !Number.isFinite(viewport.observedYCells)
  ) {
    throw new LogicalViewportError(
      'INVALID_OBSERVED_VIEWPORT',
      'observed cell coordinates must be finite',
    );
  }
  if (!Number.isFinite(viewport.effectiveCellSize) || viewport.effectiveCellSize <= 0) {
    throw new LogicalViewportError(
      'INVALID_OBSERVED_VIEWPORT',
      'effectiveCellSize must be finite and greater than zero',
    );
  }
}

module.exports = { LogicalViewport, LogicalViewportError };
