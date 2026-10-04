(() => {
  'use strict';

  const BRIDGE_KEY = '__HTTRoll20Bridge';
  const SOCKET_URL = 'ws://127.0.0.1:8765';
  const RECONNECT_DELAY_MS = 2000;

  if (window[BRIDGE_KEY]) {
    console.log('[HTT] Replacing existing bridge');
    window[BRIDGE_KEY].stop();
  }

  const page = Campaign.activePage();
  const tokens = page && page.thegraphics;

  if (!page || !tokens || !Array.isArray(tokens.models)) {
    console.error('[HTT] Active Roll20 page or token collection not available');
    return;
  }

  const state = {
    socket: null,
    reconnectTimer: null,
    stopped: false,
    tokenListeners: new Map(),
    pendingMoves: new Map(),
    collectionAddHandler: null,
  };

  function findToken(tokenId) {
    if (typeof tokens.get === 'function') {
      const token = tokens.get(tokenId);
      if (token) return token;
    }

    return tokens.models.find((token) => token.id === tokenId);
  }

  function tokenSnapshot(token) {
    return {
      id: token.id,
      name: token.get('name') || '',
      pageId: token.get('page_id') || null,
      left: Number(token.get('left')),
      top: Number(token.get('top')),
      width: Number(token.get('width')),
      height: Number(token.get('height')),
    };
  }

  function sendTokenMoved(token) {
    const snapshot = tokenSnapshot(token);
    console.log(`[HTT] ${snapshot.name || snapshot.id} moved: ${snapshot.left},${snapshot.top}`);

    if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
      console.warn('[HTT] Localhost is not connected; movement not sent');
      return;
    }

    state.socket.send(
      JSON.stringify({
        type: 'TOKEN_MOVED',
        token: snapshot,
      }),
    );
  }

  function scheduleTokenMoved(token) {
    if (state.pendingMoves.has(token.id)) return;

    const timer = setTimeout(() => {
      state.pendingMoves.delete(token.id);
      sendTokenMoved(token);
    }, 0);

    state.pendingMoves.set(token.id, timer);
  }

  function watchToken(token) {
    if (!token || state.tokenListeners.has(token.id)) return;

    const handler = () => scheduleTokenMoved(token);
    token.on('change:left change:top', handler);
    state.tokenListeners.set(token.id, { token, handler });
  }

  function handleServerMessage(event) {
    let message;

    try {
      message = JSON.parse(event.data);
    } catch {
      console.warn('[HTT] Ignored invalid JSON from localhost');
      return;
    }

    if (
      !message ||
      message.type !== 'MOVE_TOKEN' ||
      typeof message.tokenId !== 'string' ||
      !Number.isFinite(message.left) ||
      !Number.isFinite(message.top)
    ) {
      console.warn('[HTT] Ignored invalid or unsupported message from localhost');
      return;
    }

    const token = findToken(message.tokenId);
    if (!token) {
      console.warn(`[HTT] Token not found: ${message.tokenId}`);
      return;
    }

    console.log(
      `[HTT] MOVE_TOKEN received: ${token.get('name') || token.id} -> ${message.left},${message.top}`,
    );
    token.set({ left: message.left, top: message.top });
    token.save();
  }

  function connect() {
    if (state.stopped) return;

    const socket = new WebSocket(SOCKET_URL);
    state.socket = socket;

    socket.addEventListener('open', () => {
      console.log('[HTT] Connected to localhost');
    });

    socket.addEventListener('message', handleServerMessage);

    socket.addEventListener('close', () => {
      if (state.socket === socket) state.socket = null;
      if (state.stopped) return;

      console.warn(`[HTT] Localhost disconnected; retrying in ${RECONNECT_DELAY_MS / 1000}s`);
      state.reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
    });

    socket.addEventListener('error', () => {
      console.warn('[HTT] WebSocket connection error');
    });
  }

  function stop() {
    state.stopped = true;
    clearTimeout(state.reconnectTimer);

    for (const timer of state.pendingMoves.values()) clearTimeout(timer);
    state.pendingMoves.clear();

    for (const { token, handler } of state.tokenListeners.values()) {
      token.off('change:left change:top', handler);
    }
    state.tokenListeners.clear();

    if (state.collectionAddHandler && typeof tokens.off === 'function') {
      tokens.off('add', state.collectionAddHandler);
    }

    if (state.socket) {
      state.socket.close();
      state.socket = null;
    }
  }

  for (const token of tokens.models) watchToken(token);
  console.log(`[HTT] Watching ${state.tokenListeners.size} token(s)`);

  if (typeof tokens.on === 'function') {
    state.collectionAddHandler = (token) => {
      watchToken(token);
      console.log(`[HTT] Watching new token: ${token.get('name') || token.id}`);
    };
    tokens.on('add', state.collectionAddHandler);
  }

  window[BRIDGE_KEY] = { stop };
  connect();
})();
