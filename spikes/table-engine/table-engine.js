'use strict';

class TableEngineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TableEngineError';
    this.code = code;
  }
}

class TableEngine {
  constructor({
    adapter,
    onEvent = () => {},
    pendingCommandTtlMs = 10000,
    now = Date.now,
  }) {
    if (!adapter || typeof adapter.moveToken !== 'function') {
      throw new TypeError('TableEngine requires an adapter with moveToken()');
    }

    this.adapter = adapter;
    this.onEvent = onEvent;
    this.pendingCommandTtlMs = pendingCommandTtlMs;
    this.now = now;
    this.miniatures = new Map();
    this.miniatureIdByTokenId = new Map();
    this.pendingCommands = new Map();
  }

  bind(miniatureId, tokenId) {
    requireIdentifier(miniatureId, 'miniatureId');
    requireIdentifier(tokenId, 'tokenId');

    const currentOwner = this.miniatureIdByTokenId.get(tokenId);
    if (currentOwner && currentOwner !== miniatureId) {
      throw new TableEngineError(
        'TOKEN_ALREADY_BOUND',
        `Token ${tokenId} is already bound to miniature ${currentOwner}`,
      );
    }

    const miniature = this.miniatures.get(miniatureId) || {
      id: miniatureId,
      tokenId: null,
      position: null,
    };

    if (miniature.tokenId && miniature.tokenId !== tokenId) {
      this.miniatureIdByTokenId.delete(miniature.tokenId);
    }

    miniature.tokenId = tokenId;
    this.miniatures.set(miniatureId, miniature);
    this.miniatureIdByTokenId.set(tokenId, miniatureId);

    const event = {
      type: 'BOUND',
      miniature: snapshot(miniature),
    };
    this.onEvent(event);
    return event.miniature;
  }

  place(miniatureId, x, y) {
    const miniature = this.miniatures.get(miniatureId);
    if (!miniature) {
      throw new TableEngineError(
        'MINIATURE_NOT_FOUND',
        `Miniature ${miniatureId} is not bound`,
      );
    }

    requireCoordinate(x, 'x');
    requireCoordinate(y, 'y');

    miniature.position = { x, y };
    const command = this.adapter.moveToken(miniature.tokenId, x, y);

    if (command.delivered) {
      this.removeExpiredCommands();
      this.pendingCommands.set(command.commandId, {
        commandId: command.commandId,
        miniatureId,
        tokenId: miniature.tokenId,
        x,
        y,
        expiresAt: this.now() + this.pendingCommandTtlMs,
      });
    }

    const event = {
      type: 'PLACED',
      miniature: snapshot(miniature),
      commandId: command.commandId,
      delivered: command.delivered,
    };
    this.onEvent(event);
    return event;
  }

  handleTokenMoved(event) {
    if (!event || !event.token) return 'invalid';

    if (event.origin === 'local-command') {
      return this.handleLocalConfirmation(event);
    }

    if (event.origin !== 'roll20') return 'invalid';

    const { token } = event;
    if (!token || typeof token.id !== 'string') return 'invalid';

    const miniatureId = this.miniatureIdByTokenId.get(token.id);
    if (!miniatureId) return 'unbound';

    requireCoordinate(token.left, 'left');
    requireCoordinate(token.top, 'top');

    const miniature = this.miniatures.get(miniatureId);
    miniature.position = { x: token.left, y: token.top };

    this.onEvent({
      type: 'REMOTE_MOVE',
      miniature: snapshot(miniature),
      tokenName: token.name || '',
    });
    return 'remote';
  }

  getStatus() {
    return [...this.miniatures.values()].map(snapshot);
  }

  handleLocalConfirmation(event) {
    this.removeExpiredCommands();
    const pending = this.pendingCommands.get(event.commandId);
    const { token } = event;
    const miniature = pending && this.miniatures.get(pending.miniatureId);

    if (
      !pending ||
      !miniature ||
      miniature.tokenId !== pending.tokenId ||
      pending.tokenId !== token.id ||
      pending.x !== token.left ||
      pending.y !== token.top
    ) {
      this.onEvent({
        type: 'LOCAL_MOVE_CONFIRMATION_IGNORED',
        commandId: event.commandId,
        token: { ...token },
      });
      return 'unmatched-local-confirmation';
    }

    this.pendingCommands.delete(event.commandId);
    this.onEvent({
      type: 'LOCAL_MOVE_CONFIRMED',
      commandId: event.commandId,
      miniature: snapshot(miniature),
      tokenName: token.name || '',
    });
    return 'local-confirmation';
  }

  removeExpiredCommands() {
    const now = this.now();
    for (const [commandId, command] of this.pendingCommands) {
      if (command.expiresAt < now) this.pendingCommands.delete(commandId);
    }
  }
}

function requireIdentifier(value, name) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TableEngineError('INVALID_IDENTIFIER', `${name} must be a non-empty string`);
  }
}

function requireCoordinate(value, name) {
  if (!Number.isFinite(value)) {
    throw new TableEngineError('INVALID_POSITION', `${name} must be a finite number`);
  }
}

function snapshot(miniature) {
  return {
    id: miniature.id,
    tokenId: miniature.tokenId,
    position: miniature.position ? { ...miniature.position } : null,
  };
}

module.exports = { TableEngine, TableEngineError };
