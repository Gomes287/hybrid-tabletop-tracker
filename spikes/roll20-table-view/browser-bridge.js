(function bootstrap(root, factory) {
  'use strict';

  const api = factory();

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }

  if (root) api.installBrowserBridge(root);
})(typeof window === 'undefined' ? null : window, () => {
  'use strict';

  const BRIDGE_KEY = '__HTTRoll20TableViewBridge';
  const SOCKET_URL = 'ws://127.0.0.1:8765';
  const RECONNECT_DELAY_MS = 2000;
  const READINESS_POLL_INTERVAL_MS = 150;
  const READINESS_TIMEOUT_MS = 10000;
  const ROLL20_BASE_UNIT = 70;
  const ROLL20_BASE_UNIT_TOLERANCE = 0.01;

  class TableViewError extends Error {
    constructor(code, detail) {
      super(`${code}: ${detail}`);
      this.name = 'TableViewError';
      this.code = code;
      this.detail = detail;
    }
  }

  function unsupported(detail) {
    throw new TableViewError('ROLL20_TABLE_VIEW_UNSUPPORTED', detail);
  }

  function getSquareGridMetrics(page, grid) {
    if (!page || !page.attributes) {
      unsupported('the active page attributes are not available');
    }
    if (page.attributes.grid_type !== 'square') {
      throw new TableViewError(
        'UNSUPPORTED_GRID_TYPE',
        `expected square, received ${String(page.attributes.grid_type)}`,
      );
    }

    const width = Number(page.attributes.width);
    const height = Number(page.attributes.height);
    if (!Number.isFinite(width) || width <= 0) {
      unsupported('active page width must be finite and greater than zero');
    }
    if (!Number.isFinite(height) || height <= 0) {
      unsupported('active page height must be finite and greater than zero');
    }

    const snappingIncrement = page.attributes.snapping_increment;
    if (!Number.isFinite(snappingIncrement) || snappingIncrement <= 0) {
      unsupported('snapping_increment must be a finite number greater than zero');
    }

    if (!grid || !grid.scaling) {
      unsupported('tabletop-square-grid.scaling is not available');
    }
    const scalingX = Number(grid.scaling.x);
    const scalingY = Number(grid.scaling.y);
    if (!Number.isFinite(scalingX) || !Number.isFinite(scalingY)) {
      unsupported('tabletop-square-grid scaling must be finite');
    }

    const rendererBaseUnitX = Math.abs(scalingX) / width;
    const rendererBaseUnitY = Math.abs(scalingY) / height;
    if (
      Math.abs(rendererBaseUnitX - ROLL20_BASE_UNIT) > ROLL20_BASE_UNIT_TOLERANCE ||
      Math.abs(rendererBaseUnitY - ROLL20_BASE_UNIT) > ROLL20_BASE_UNIT_TOLERANCE
    ) {
      unsupported(
        `Jumpgate renderer base unit mismatch: expected approximately ${ROLL20_BASE_UNIT}, received ${rendererBaseUnitX},${rendererBaseUnitY}`,
      );
    }

    const effectiveCellSize = ROLL20_BASE_UNIT * snappingIncrement;
    if (!Number.isFinite(effectiveCellSize) || effectiveCellSize <= 0) {
      unsupported('effective square-grid cell size must be finite and greater than zero');
    }

    return {
      cellX: effectiveCellSize,
      cellY: effectiveCellSize,
    };
  }

  function createTableViewAdapter(windowObject) {
    function getActivePage(engine) {
      if (engine.page) return engine.page;

      if (
        windowObject.Campaign &&
        typeof windowObject.Campaign.activePage === 'function'
      ) {
        const campaignPage = windowObject.Campaign.activePage();
        if (campaignPage) return campaignPage;
      }

      return typeof engine.activePage === 'function'
        ? engine.activePage()
        : engine.activePage;
    }

    function getContext() {
      if (!windowObject || !windowObject.Campaign) {
        unsupported('window.Campaign is not available');
      }

      const engine = windowObject.Campaign.engine;
      if (!engine) unsupported('Campaign.engine is not available');
      if (!windowObject.MeshScene) unsupported('window.MeshScene is not available');
      if (!engine.cameraTransform) unsupported('engine.cameraTransform is not available');
      if (typeof engine.moveCamera !== 'function') {
        unsupported('engine.moveCamera is not a function');
      }

      const page = getActivePage(engine);
      if (!page || !page.attributes) {
        unsupported('the active page is not available from Campaign.engine');
      }

      if (typeof windowObject.MeshScene.getMeshByName !== 'function') {
        unsupported('MeshScene.getMeshByName is not a function');
      }
      const grid = windowObject.MeshScene.getMeshByName('tabletop-square-grid');
      if (!grid) unsupported('tabletop-square-grid mesh is not available');
      const { cellX, cellY } = getSquareGridMetrics(page, grid);

      const position = engine.cameraTransform.position;
      if (!position || typeof position.clone !== 'function') {
        unsupported('engine.cameraTransform.position.clone is not available');
      }

      return { cellX, cellY, engine, position };
    }

    function getMetrics() {
      const { cellX, cellY } = getContext();
      return { cellX, cellY };
    }

    function panViewport(dxCells, dyCells) {
      if (!Number.isFinite(dxCells) || !Number.isFinite(dyCells)) {
        throw new TableViewError(
          'INVALID_PAN_PAYLOAD',
          'dxCells and dyCells must be finite numbers',
        );
      }

      const { cellX, cellY, engine, position } = getContext();
      const delta = position.clone();
      if (!delta || typeof delta.copyFromFloats !== 'function') {
        unsupported('camera position clone cannot create a Vector3 delta');
      }

      delta.copyFromFloats(dxCells * cellX, dyCells * cellY, 0);
      engine.moveCamera(delta);

      const result = { dxCells, dyCells, cellX, cellY };
      const finalPosition = engine.cameraTransform.position;
      if (
        finalPosition &&
        Number.isFinite(finalPosition.x) &&
        Number.isFinite(finalPosition.y) &&
        Number.isFinite(finalPosition.z)
      ) {
        result.cameraPosition = {
          x: finalPosition.x,
          y: finalPosition.y,
          z: finalPosition.z,
        };
      }
      return result;
    }

    return { getMetrics, panViewport };
  }

  function readLoadingIndicator(page, name) {
    const indicator = page[name];
    return typeof indicator === 'function' ? indicator.call(page) : indicator;
  }

  function inspectTableViewReadiness(windowObject) {
    if (!windowObject || !windowObject.Campaign) {
      return { ready: false, detail: 'window.Campaign is not available' };
    }

    const { Campaign } = windowObject;
    const engine = Campaign.engine;
    if (!engine) return { ready: false, detail: 'Campaign.engine is not available' };
    if (typeof engine.moveCamera !== 'function') {
      return { ready: false, detail: 'engine.moveCamera is not a function' };
    }

    const page = engine.page;
    if (!page) {
      return { ready: false, detail: 'Campaign.engine.page is not available' };
    }
    if (readLoadingIndicator(page, 'fullyLoaded') === false) {
      return { ready: false, detail: 'the active page is not fully loaded' };
    }
    if (readLoadingIndicator(page, 'isEverythingLoaded') === false) {
      return { ready: false, detail: 'the active page has not finished loading' };
    }

    if (!windowObject.MeshScene) {
      return { ready: false, detail: 'window.MeshScene is not available' };
    }
    if (typeof windowObject.MeshScene.getMeshByName !== 'function') {
      return { ready: false, detail: 'MeshScene.getMeshByName is not a function' };
    }
    const grid = windowObject.MeshScene.getMeshByName('tabletop-square-grid');
    if (!grid) {
      return { ready: false, detail: 'tabletop-square-grid mesh is not available' };
    }
    try {
      getSquareGridMetrics(page, grid);
    } catch (error) {
      return {
        ready: false,
        detail: error instanceof TableViewError
          ? error.detail
          : error.message || String(error),
      };
    }
    if (
      !engine.cameraTransform ||
      !engine.cameraTransform.position ||
      typeof engine.cameraTransform.position.clone !== 'function'
    ) {
      return { ready: false, detail: 'the camera transform is not ready' };
    }

    return { ready: true, detail: null };
  }

  function waitForTableViewReadiness(
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
    let waitingLogged = false;

    return new Promise((resolve, reject) => {
      function poll() {
        const readiness = inspectTableViewReadiness(windowObject);
        if (readiness.ready) {
          resolve(readiness);
          return;
        }

        if (!waitingLogged) {
          waitingLogged = true;
          onWaiting(readiness.detail);
        }

        if (now() - startedAt >= timeoutMs) {
          reject(
            new TableViewError(
              'ROLL20_TABLE_VIEW_UNSUPPORTED',
              `readiness timeout: ${readiness.detail}`,
            ),
          );
          return;
        }

        schedule(poll, pollIntervalMs);
      }

      poll();
    });
  }

  function isPanViewportMessage(message) {
    return Boolean(
      message &&
        message.type === 'PAN_VIEWPORT' &&
        Number.isFinite(message.dxCells) &&
        Number.isFinite(message.dyCells),
    );
  }

  function handlePanViewportMessage(message, adapter, readiness = { status: 'ready' }) {
    if (!isPanViewportMessage(message)) {
      throw new TableViewError(
        'INVALID_PAN_PAYLOAD',
        'PAN_VIEWPORT requires finite dxCells and dyCells',
      );
    }

    if (readiness.status === 'waiting') {
      throw new TableViewError(
        'NOT_READY',
        'Roll20 Table View is still initializing; command was not queued',
      );
    }
    if (readiness.status === 'unsupported') {
      throw new TableViewError(
        'ROLL20_TABLE_VIEW_UNSUPPORTED',
        readiness.detail || 'Roll20 Table View readiness failed',
      );
    }

    return {
      type: 'VIEWPORT_PANNED',
      ...adapter.panViewport(message.dxCells, message.dyCells),
    };
  }

  function installBrowserBridge(windowObject) {
    if (windowObject[BRIDGE_KEY]) {
      console.log('[HTT3] Replacing existing Table View bridge');
      windowObject[BRIDGE_KEY].stop();
    }

    const adapter = createTableViewAdapter(windowObject);
    const state = {
      socket: null,
      reconnectTimer: null,
      stopped: false,
      readiness: { status: 'waiting', detail: 'initialization has not completed' },
      readinessStarted: false,
    };

    function send(message) {
      if (!state.socket || state.socket.readyState !== windowObject.WebSocket.OPEN) {
        console.warn('[HTT3] Localhost is not connected; response not sent');
        return;
      }
      state.socket.send(JSON.stringify(message));
    }

    function sendError(error) {
      const code = error instanceof TableViewError
        ? error.code
        : 'ROLL20_TABLE_VIEW_UNSUPPORTED';
      const detail = error instanceof TableViewError
        ? error.detail
        : error.message || String(error);
      console.error(`[HTT3] ${code}: ${detail}`);
      send({ type: 'TABLE_VIEW_ERROR', code, detail });
    }

    function handleServerMessage(event) {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        sendError(new TableViewError('INVALID_PAN_PAYLOAD', 'invalid JSON'));
        return;
      }

      try {
        const confirmation = handlePanViewportMessage(message, adapter, state.readiness);
        console.log(
          `[HTT3] VIEWPORT_PANNED ${confirmation.dxCells},${confirmation.dyCells} cell=${confirmation.cellX},${confirmation.cellY}`,
        );
        send(confirmation);
      } catch (error) {
        sendError(error);
      }
    }

    function startReadiness() {
      if (state.readinessStarted) return;
      state.readinessStarted = true;

      waitForTableViewReadiness(windowObject, {
        onWaiting() {
          console.log('[HTT3] Waiting for Roll20 Table View readiness...');
        },
      }).then(() => {
        if (state.stopped) return;

        try {
          const metrics = adapter.getMetrics();
          state.readiness = { status: 'ready', detail: null };
          console.log('[HTT3] Roll20 Table View ready');
          console.log(`[HTT3] Cell size: ${metrics.cellX},${metrics.cellY}`);
        } catch (error) {
          state.readiness = {
            status: 'unsupported',
            detail: error.detail || error.message || String(error),
          };
          sendError(error);
        }
      }).catch((error) => {
        if (state.stopped) return;
        state.readiness = { status: 'unsupported', detail: error.detail };
        sendError(error);
      });
    }

    function connect() {
      if (state.stopped) return;

      const socket = new windowObject.WebSocket(SOCKET_URL);
      state.socket = socket;
      socket.addEventListener('open', () => {
        console.log('[HTT3] Connected to localhost');
        startReadiness();
        if (state.readiness.status === 'unsupported') {
          sendError(
            new TableViewError(
              'ROLL20_TABLE_VIEW_UNSUPPORTED',
              state.readiness.detail,
            ),
          );
        }
      });
      socket.addEventListener('message', handleServerMessage);
      socket.addEventListener('close', () => {
        if (state.socket === socket) state.socket = null;
        if (state.stopped) return;
        console.warn(`[HTT3] Localhost disconnected; retrying in ${RECONNECT_DELAY_MS / 1000}s`);
        state.reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      });
      socket.addEventListener('error', () => {
        console.warn('[HTT3] WebSocket connection error');
      });
    }

    function stop() {
      state.stopped = true;
      clearTimeout(state.reconnectTimer);
      if (state.socket) state.socket.close();
      state.socket = null;
    }

    windowObject[BRIDGE_KEY] = { panViewport: adapter.panViewport, stop };
    connect();
    return windowObject[BRIDGE_KEY];
  }

  return {
    ROLL20_BASE_UNIT,
    TableViewError,
    createTableViewAdapter,
    handlePanViewportMessage,
    inspectTableViewReadiness,
    installBrowserBridge,
    isPanViewportMessage,
    waitForTableViewReadiness,
  };
});
