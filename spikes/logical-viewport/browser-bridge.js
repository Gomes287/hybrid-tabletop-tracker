(function bootstrap(root, factory) {
  'use strict';

  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) api.installBrowserBridge(root);
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';

  const BRIDGE_KEY = '__MellonLogicalViewportBridge';
  const SOCKET_URL = 'ws://127.0.0.1:8765';
  const RECONNECT_DELAY_MS = 2000;
  const READINESS_POLL_INTERVAL_MS = 150;
  const READINESS_TIMEOUT_MS = 10000;
  const ROLL20_BASE_UNIT = 70;
  const ROLL20_BASE_UNIT_TOLERANCE = 0.01;
  const RECONCILIATION_EPSILON_CELLS = 0.01;

  class ViewportAdapterError extends Error {
    constructor(code, detail) {
      super(`${code}: ${detail}`);
      this.name = 'ViewportAdapterError';
      this.code = code;
      this.detail = detail;
    }
  }

  function fail(code, detail) {
    throw new ViewportAdapterError(code, detail);
  }

  function createRoll20ViewportAdapter(windowObject) {
    function getContext() {
      const Campaign = windowObject && windowObject.Campaign;
      const engine = Campaign && Campaign.engine;
      const page = engine && engine.page;
      const scene = windowObject && windowObject.MeshScene;

      if (!engine) fail('ROLL20_VIEWPORT_UNSUPPORTED', 'Campaign.engine is not available');
      if (!page || !page.attributes) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'Campaign.engine.page is not available');
      }
      if (!scene || typeof scene.getMeshByName !== 'function') {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'MeshScene is not available');
      }
      if (typeof engine.moveCamera !== 'function') {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'engine.moveCamera is not a function');
      }
      if (
        !engine.cameraTransform ||
        !engine.cameraTransform.position ||
        typeof engine.cameraTransform.position.clone !== 'function'
      ) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'cameraTransform is not available');
      }

      const pageId = page.id || page.attributes.id || page.attributes._id;
      if (typeof pageId !== 'string' || pageId.length === 0) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'active page ID is not available');
      }
      if (page.attributes.grid_type !== 'square') {
        fail('UNSUPPORTED_GRID_TYPE', `expected square, received ${page.attributes.grid_type}`);
      }

      const width = Number(page.attributes.width);
      const height = Number(page.attributes.height);
      const snappingIncrement = page.attributes.snapping_increment;
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'page dimensions must be positive and finite');
      }
      if (!Number.isFinite(snappingIncrement) || snappingIncrement <= 0) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'snapping_increment must be positive and finite');
      }

      const grid = scene.getMeshByName('tabletop-square-grid');
      if (!grid || !grid.scaling || !grid.position) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'tabletop-square-grid geometry is unavailable');
      }
      const scalingX = Number(grid.scaling.x);
      const scalingY = Number(grid.scaling.y);
      const gridWorldX = Number(grid.position.x);
      const gridWorldY = Number(grid.position.y);
      if (
        !Number.isFinite(scalingX) ||
        !Number.isFinite(scalingY) ||
        !Number.isFinite(gridWorldX) ||
        !Number.isFinite(gridWorldY)
      ) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'grid scaling and position must be finite');
      }

      const rendererBaseX = Math.abs(scalingX) / width;
      const rendererBaseY = Math.abs(scalingY) / height;
      if (
        Math.abs(rendererBaseX - ROLL20_BASE_UNIT) > ROLL20_BASE_UNIT_TOLERANCE ||
        Math.abs(rendererBaseY - ROLL20_BASE_UNIT) > ROLL20_BASE_UNIT_TOLERANCE
      ) {
        fail(
          'ROLL20_VIEWPORT_UNSUPPORTED',
          `renderer base unit mismatch: ${rendererBaseX},${rendererBaseY}`,
        );
      }

      const effectiveCellSize = ROLL20_BASE_UNIT * snappingIncrement;
      if (!Number.isFinite(effectiveCellSize) || effectiveCellSize <= 0) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'effective cell size is invalid');
      }

      return {
        effectiveCellSize,
        engine,
        gridWorldX,
        gridWorldY,
        pageId,
      };
    }

    function observeViewport() {
      const context = getContext();
      const camera = context.engine.cameraTransform.position;
      const cameraWorldX = Number(camera.x);
      const cameraWorldY = Number(camera.y);
      if (!Number.isFinite(cameraWorldX) || !Number.isFinite(cameraWorldY)) {
        fail('ROLL20_VIEWPORT_UNSUPPORTED', 'camera position must be finite');
      }

      return {
        pageId: context.pageId,
        observedXCells:
          (cameraWorldX - context.gridWorldX) / context.effectiveCellSize,
        observedYCells:
          (cameraWorldY - context.gridWorldY) / context.effectiveCellSize,
        effectiveCellSize: context.effectiveCellSize,
        cameraWorldX,
        cameraWorldY,
        gridWorldX: context.gridWorldX,
        gridWorldY: context.gridWorldY,
      };
    }

    function reconcileViewport({
      pageId,
      desiredXCells,
      desiredYCells,
      epsilonCells = RECONCILIATION_EPSILON_CELLS,
    }) {
      if (!Number.isInteger(desiredXCells) || !Number.isInteger(desiredYCells)) {
        fail('INVALID_DESIRED_VIEWPORT', 'desired cell coordinates must be integers');
      }
      if (!Number.isFinite(epsilonCells) || epsilonCells < 0) {
        fail('INVALID_EPSILON', 'epsilonCells must be finite and non-negative');
      }

      const observedBefore = observeViewport();
      if (observedBefore.pageId !== pageId) {
        fail(
          'PAGE_MISMATCH',
          `desired page ${pageId} does not match observed page ${observedBefore.pageId}`,
        );
      }

      const errorXCells = desiredXCells - observedBefore.observedXCells;
      const errorYCells = desiredYCells - observedBefore.observedYCells;
      const withinEpsilon =
        Math.abs(errorXCells) <= epsilonCells &&
        Math.abs(errorYCells) <= epsilonCells;
      const deltaWorldX = withinEpsilon
        ? 0
        : errorXCells * observedBefore.effectiveCellSize;
      const deltaWorldY = withinEpsilon
        ? 0
        : errorYCells * observedBefore.effectiveCellSize;

      if (!withinEpsilon) {
        const engine = windowObject.Campaign.engine;
        const delta = engine.cameraTransform.position.clone();
        if (!delta || typeof delta.copyFromFloats !== 'function') {
          fail('ROLL20_VIEWPORT_UNSUPPORTED', 'camera position cannot create a delta vector');
        }
        delta.copyFromFloats(deltaWorldX, deltaWorldY, 0);
        engine.moveCamera(delta);
      }

      return {
        pageId,
        desiredXCells,
        desiredYCells,
        observedBefore,
        observedAfter: observeViewport(),
        errorXCells,
        errorYCells,
        deltaWorldX,
        deltaWorldY,
        moved: !withinEpsilon,
        epsilonCells,
      };
    }

    return { observeViewport, reconcileViewport };
  }

  function readLoadingIndicator(page, name) {
    const value = page[name];
    return typeof value === 'function' ? value.call(page) : value;
  }

  function inspectReadiness(windowObject) {
    const page = windowObject && windowObject.Campaign && windowObject.Campaign.engine
      ? windowObject.Campaign.engine.page
      : null;
    if (!page) return { ready: false, detail: 'Campaign.engine.page is not available' };
    if (readLoadingIndicator(page, 'fullyLoaded') === false) {
      return { ready: false, detail: 'the page is not fully loaded' };
    }
    if (readLoadingIndicator(page, 'isEverythingLoaded') === false) {
      return { ready: false, detail: 'the page has not finished loading' };
    }
    try {
      createRoll20ViewportAdapter(windowObject).observeViewport();
      return { ready: true, detail: null };
    } catch (error) {
      return { ready: false, detail: error.detail || error.message || String(error) };
    }
  }

  function waitForReadiness(
    windowObject,
    {
      pollIntervalMs = READINESS_POLL_INTERVAL_MS,
      timeoutMs = READINESS_TIMEOUT_MS,
      now = Date.now,
      schedule = setTimeout,
      onWaiting = () => {},
    } = {},
  ) {
    const startedAt = now();
    let notified = false;
    return new Promise((resolve, reject) => {
      function poll() {
        const readiness = inspectReadiness(windowObject);
        if (readiness.ready) return resolve(readiness);
        if (!notified) {
          notified = true;
          onWaiting(readiness.detail);
        }
        if (now() - startedAt >= timeoutMs) {
          return reject(
            new ViewportAdapterError(
              'ROLL20_VIEWPORT_UNSUPPORTED',
              `readiness timeout: ${readiness.detail}`,
            ),
          );
        }
        schedule(poll, pollIntervalMs);
      }
      poll();
    });
  }

  function installBrowserBridge(windowObject) {
    if (windowObject[BRIDGE_KEY]) windowObject[BRIDGE_KEY].stop();

    const adapter = createRoll20ViewportAdapter(windowObject);
    const state = {
      readiness: 'waiting',
      reconnectTimer: null,
      socket: null,
      stopped: false,
    };

    function send(message) {
      if (state.socket && state.socket.readyState === windowObject.WebSocket.OPEN) {
        state.socket.send(JSON.stringify(message));
      }
    }

    function sendError(error) {
      const code = error instanceof ViewportAdapterError
        ? error.code
        : 'ROLL20_VIEWPORT_UNSUPPORTED';
      const detail = error.detail || error.message || String(error);
      console.error(`[MELLON4] ${code}: ${detail}`);
      send({ type: 'VIEWPORT_ERROR', code, detail });
    }

    function sendObserved() {
      send({ type: 'VIEWPORT_STATE', ...adapter.observeViewport() });
    }

    function handleMessage(event) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        sendError(new ViewportAdapterError('INVALID_MESSAGE', 'invalid JSON'));
        return;
      }

      if (state.readiness !== 'ready') {
        sendError(new ViewportAdapterError('NOT_READY', 'Roll20 viewport is initializing'));
        return;
      }

      try {
        if (message.type === 'GET_VIEWPORT_STATE') {
          sendObserved();
          return;
        }
        if (message.type === 'RECONCILE_VIEWPORT') {
          const result = adapter.reconcileViewport(message);
          send({ type: 'VIEWPORT_RECONCILED', ...result });
          return;
        }
        fail('INVALID_MESSAGE', `unsupported message type ${String(message.type)}`);
      } catch (error) {
        sendError(error);
      }
    }

    function connect() {
      if (state.stopped) return;
      const socket = new windowObject.WebSocket(SOCKET_URL);
      state.socket = socket;
      socket.addEventListener('open', () => {
        console.log('[MELLON4] Connected to localhost');
        state.readiness = 'waiting';
        waitForReadiness(windowObject, {
          onWaiting() {
            console.log('[MELLON4] Waiting for Roll20 viewport readiness...');
          },
        }).then(() => {
          if (state.stopped) return;
          state.readiness = 'ready';
          console.log('[MELLON4] Logical viewport bridge ready');
          sendObserved();
        }).catch((error) => {
          if (state.stopped) return;
          state.readiness = 'unsupported';
          sendError(error);
        });
      });
      socket.addEventListener('message', handleMessage);
      socket.addEventListener('close', () => {
        if (state.socket === socket) state.socket = null;
        if (state.stopped) return;
        state.reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
      socket.addEventListener('error', () => {
        console.warn('[MELLON4] WebSocket connection error');
      });
    }

    function stop() {
      state.stopped = true;
      clearTimeout(state.reconnectTimer);
      if (state.socket) state.socket.close();
      state.socket = null;
    }

    windowObject[BRIDGE_KEY] = { stop };
    connect();
    return windowObject[BRIDGE_KEY];
  }

  return {
    RECONCILIATION_EPSILON_CELLS,
    ROLL20_BASE_UNIT,
    ViewportAdapterError,
    createRoll20ViewportAdapter,
    inspectReadiness,
    installBrowserBridge,
    waitForReadiness,
  };
});
