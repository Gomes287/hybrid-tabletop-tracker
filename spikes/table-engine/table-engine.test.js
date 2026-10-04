'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { Roll20Adapter } = require('./roll20-adapter');
const { TableEngine, TableEngineError } = require('./table-engine');

class FakeBridge {
  constructor() {
    this.commands = [];
    this.connected = true;
    this.handler = () => {};
  }

  onTokenMoved(handler) {
    this.handler = handler;
  }

  sendMoveToken(command) {
    if (!this.connected) return 0;
    this.commands.push(command);
    return 1;
  }

  emitTokenMoved(event) {
    return this.handler(event);
  }
}

function createSystem(options = {}) {
  const events = [];
  const bridge = new FakeBridge();
  let commandSequence = 0;
  const adapter = new Roll20Adapter({
    bridge,
    createCommandId: () => `command-${++commandSequence}`,
  });
  const engine = new TableEngine({
    adapter,
    onEvent: (event) => events.push(event),
    now: options.now || Date.now,
    pendingCommandTtlMs: options.pendingCommandTtlMs || 10000,
  });
  adapter.setTableEngine(engine);
  return { adapter, bridge, engine, events };
}

function token(overrides = {}) {
  return {
    id: 'token-001',
    name: 'Goblin',
    pageId: 'page-001',
    left: 100,
    top: 200,
    width: 70,
    height: 70,
    ...overrides,
  };
}

function remoteMove(overrides = {}) {
  return { type: 'TOKEN_MOVED', origin: 'roll20', token: token(overrides) };
}

function localConfirmation(command, overrides = {}) {
  return {
    type: 'TOKEN_MOVED',
    origin: 'local-command',
    commandId: command.commandId,
    token: token({
      id: command.tokenId,
      left: command.left,
      top: command.top,
      ...overrides,
    }),
  };
}

test('bind associates a miniature with a Roll20 token', () => {
  const { engine, events } = createSystem();

  const miniature = engine.bind('mini-001', 'token-001');

  assert.deepEqual(miniature, {
    id: 'mini-001',
    tokenId: 'token-001',
    position: null,
  });
  assert.equal(events.at(-1).type, 'BOUND');
});

test('place updates the in-memory miniature position', () => {
  const { engine } = createSystem();
  engine.bind('mini-001', 'token-001');

  engine.place('mini-001', 945, 735);

  assert.deepEqual(engine.getStatus()[0].position, { x: 945, y: 735 });
});

test('place sends a movement command through the adapter', () => {
  const { bridge, engine } = createSystem();
  engine.bind('mini-001', 'token-001');

  engine.place('mini-001', 945, 735);

  assert.deepEqual(bridge.commands, [
    {
      type: 'MOVE_TOKEN',
      commandId: 'command-1',
      tokenId: 'token-001',
      left: 945,
      top: 735,
    },
  ]);
});

test('the adapter generates a unique commandId for each local movement', () => {
  const { bridge, engine } = createSystem();
  engine.bind('mini-001', 'token-001');

  engine.place('mini-001', 100, 200);
  engine.place('mini-001', 300, 400);

  assert.deepEqual(
    bridge.commands.map((command) => command.commandId),
    ['command-1', 'command-2'],
  );
});

test('a remote TOKEN_MOVED updates the bound miniature', () => {
  const { bridge, engine, events } = createSystem();
  engine.bind('mini-001', 'token-001');

  bridge.emitTokenMoved(remoteMove({ left: 1015, top: 735 }));

  assert.deepEqual(engine.getStatus()[0].position, { x: 1015, y: 735 });
  assert.equal(events.at(-1).type, 'REMOTE_MOVE');
});

test('the echo of a local movement is suppressed as a remote move', () => {
  const { bridge, engine, events } = createSystem();
  engine.bind('mini-001', 'token-001');
  engine.place('mini-001', 945, 735);
  const command = bridge.commands[0];

  const result = bridge.emitTokenMoved(localConfirmation(command));

  assert.equal(result, 'local-confirmation');
  assert.equal(events.at(-1).type, 'LOCAL_MOVE_CONFIRMED');
  assert.equal(events.at(-1).commandId, 'command-1');
  assert.equal(events.some((event) => event.type === 'REMOTE_MOVE'), false);
  assert.deepEqual(engine.getStatus()[0].position, { x: 945, y: 735 });
});

test('origin roll20 remains remote even when token and coordinates match a pending command', () => {
  const { bridge, engine, events } = createSystem();
  engine.bind('mini-001', 'token-001');
  engine.place('mini-001', 945, 735);

  const result = bridge.emitTokenMoved(remoteMove({ left: 945, top: 735 }));

  assert.equal(result, 'remote');
  assert.equal(events.at(-1).type, 'REMOTE_MOVE');
});

test('a later remote movement of the same token is still detected', () => {
  const { bridge, engine, events } = createSystem();
  engine.bind('mini-001', 'token-001');
  engine.place('mini-001', 945, 735);
  bridge.emitTokenMoved(localConfirmation(bridge.commands[0]));

  const result = bridge.emitTokenMoved(remoteMove({ left: 1015, top: 735 }));

  assert.equal(result, 'remote');
  assert.equal(events.at(-1).type, 'REMOTE_MOVE');
  assert.deepEqual(engine.getStatus()[0].position, { x: 1015, y: 735 });
});

test('an unbound token does not alter miniature state', () => {
  const { bridge, engine, events } = createSystem();
  engine.bind('mini-001', 'token-001');
  const eventCountBeforeMove = events.length;

  const result = bridge.emitTokenMoved(remoteMove({ id: 'unbound-token' }));

  assert.equal(result, 'unbound');
  assert.equal(events.length, eventCountBeforeMove);
  assert.equal(engine.getStatus()[0].position, null);
});

test('placing an unknown miniature produces a controlled error', () => {
  const { engine } = createSystem();

  assert.throws(
    () => engine.place('missing-miniature', 10, 20),
    (error) =>
      error instanceof TableEngineError && error.code === 'MINIATURE_NOT_FOUND',
  );
});

test('an expired commandId is ignored instead of becoming a remote move', () => {
  let now = 1000;
  const { bridge, engine, events } = createSystem({ now: () => now });
  engine.bind('mini-001', 'token-001');
  engine.place('mini-001', 945, 735);
  const command = bridge.commands[0];
  now += 10001;

  const result = bridge.emitTokenMoved(localConfirmation(command));

  assert.equal(result, 'unmatched-local-confirmation');
  assert.equal(events.at(-1).type, 'LOCAL_MOVE_CONFIRMATION_IGNORED');
  assert.equal(events.some((event) => event.type === 'REMOTE_MOVE'), false);
});

test('place preserves physical state while the adapter is offline', () => {
  const { bridge, engine } = createSystem();
  bridge.connected = false;
  engine.bind('mini-001', 'token-001');

  const event = engine.place('mini-001', 945, 735);

  assert.equal(event.delivered, false);
  assert.deepEqual(engine.getStatus()[0].position, { x: 945, y: 735 });
  assert.deepEqual(bridge.commands, []);
});
