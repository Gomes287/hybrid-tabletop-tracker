'use strict';

const { randomUUID } = require('node:crypto');

class Roll20Adapter {
  constructor({ bridge, createCommandId = randomUUID }) {
    if (
      !bridge ||
      typeof bridge.sendMoveToken !== 'function' ||
      typeof bridge.onTokenMoved !== 'function'
    ) {
      throw new TypeError('Roll20Adapter requires a compatible bridge');
    }

    this.bridge = bridge;
    this.createCommandId = createCommandId;
    this.tableEngine = null;

    bridge.onTokenMoved((event) => this.handleTokenMoved(event));
  }

  setTableEngine(tableEngine) {
    if (!tableEngine || typeof tableEngine.handleTokenMoved !== 'function') {
      throw new TypeError('Roll20Adapter requires a compatible Table Engine');
    }
    this.tableEngine = tableEngine;
  }

  moveToken(tokenId, left, top) {
    const commandId = this.createCommandId();
    const recipients = this.bridge.sendMoveToken({
      type: 'MOVE_TOKEN',
      commandId,
      tokenId,
      left,
      top,
    });
    return { commandId, delivered: recipients > 0 };
  }

  handleTokenMoved(event) {
    if (!this.tableEngine) {
      throw new Error('Roll20Adapter has no Table Engine');
    }
    return this.tableEngine.handleTokenMoved(event);
  }
}

module.exports = { Roll20Adapter };
