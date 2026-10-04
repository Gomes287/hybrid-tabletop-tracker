'use strict';

const { WebSocket, WebSocketServer } = require('ws');

class Roll20BridgeServer {
  constructor({ host = '127.0.0.1', port = 8765, onEvent = () => {} } = {}) {
    this.host = host;
    this.port = port;
    this.onEvent = onEvent;
    this.server = null;
    this.tokenMovedHandler = () => {};
  }

  onTokenMoved(handler) {
    this.tokenMovedHandler = handler;
  }

  start() {
    this.server = new WebSocketServer({ host: this.host, port: this.port });

    this.server.on('listening', () => {
      this.onEvent({ type: 'LISTENING', url: `ws://${this.host}:${this.port}` });
    });

    this.server.on('connection', (socket) => {
      this.onEvent({ type: 'ROLL20_CONNECTED' });

      socket.on('message', (data, isBinary) => {
        if (isBinary) {
          this.onEvent({ type: 'INVALID_MESSAGE', reason: 'binary message' });
          return;
        }

        let message;
        try {
          message = JSON.parse(data.toString());
        } catch {
          this.onEvent({ type: 'INVALID_MESSAGE', reason: 'invalid JSON' });
          return;
        }

        if (!isTokenMovedMessage(message)) {
          this.onEvent({ type: 'INVALID_MESSAGE', reason: 'invalid or unsupported message' });
          return;
        }

        this.tokenMovedHandler(message);
      });

      socket.on('close', () => this.onEvent({ type: 'ROLL20_DISCONNECTED' }));
      socket.on('error', (error) => {
        this.onEvent({ type: 'CONNECTION_ERROR', error });
      });
    });

    this.server.on('error', (error) => {
      this.onEvent({ type: 'SERVER_ERROR', error });
    });
  }

  sendMoveToken({ commandId, tokenId, left, top }) {
    if (!this.server) return 0;

    const payload = JSON.stringify({
      type: 'MOVE_TOKEN',
      commandId,
      tokenId,
      left,
      top,
    });
    let recipients = 0;

    for (const client of this.server.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      client.send(payload);
      recipients += 1;
    }

    return recipients;
  }
}

function isTokenMovedMessage(message) {
  if (!message || typeof message !== 'object' || message.type !== 'TOKEN_MOVED') {
    return false;
  }

  const { token } = message;
  return Boolean(
    token &&
      typeof token === 'object' &&
      typeof token.id === 'string' &&
      token.id.length > 0 &&
      typeof token.name === 'string' &&
      (typeof token.pageId === 'string' || token.pageId == null) &&
      Number.isFinite(token.left) &&
      Number.isFinite(token.top) &&
      Number.isFinite(token.width) &&
      Number.isFinite(token.height),
  ) &&
    (message.origin === 'roll20' ||
      (message.origin === 'local-command' &&
        typeof message.commandId === 'string' &&
        message.commandId.length > 0));
}

module.exports = { Roll20BridgeServer };
