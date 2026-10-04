'use strict';

const readline = require('node:readline');
const { Roll20Adapter } = require('./roll20-adapter');
const { Roll20BridgeServer } = require('./roll20-bridge-server');
const { TableEngine, TableEngineError } = require('./table-engine');

console.log('Hybrid Tabletop — Table Engine Spike');

const bridge = new Roll20BridgeServer({ onEvent: printBridgeEvent });
const adapter = new Roll20Adapter({ bridge });
const engine = new TableEngine({ adapter, onEvent: printTableEvent });
adapter.setTableEngine(engine);
bridge.start();

const cli = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

cli.on('line', (line) => {
  const parts = line.trim().split(/\s+/);
  const command = parts[0];
  if (!command) return;

  try {
    if (command === 'bind' && parts.length === 3) {
      engine.bind(parts[1], parts[2]);
      return;
    }

    if (command === 'place' && parts.length === 4) {
      engine.place(parts[1], Number(parts[2]), Number(parts[3]));
      return;
    }

    if (command === 'status' && parts.length === 1) {
      printStatus(engine.getStatus());
      return;
    }

    console.log('Commands: bind <miniatureId> <tokenId> | place <miniatureId> <x> <y> | status');
  } catch (error) {
    if (error instanceof TableEngineError) {
      console.log(`ERROR ${error.code}: ${error.message}`);
      return;
    }
    console.error(error);
  }
});

function printTableEvent(event) {
  const { miniature } = event;

  if (event.type === 'BOUND') {
    console.log('BOUND');
    console.log(`miniature: ${miniature.id}`);
    console.log(`token: ${miniature.tokenId}`);
    return;
  }

  if (event.type === 'PLACED') {
    console.log('PLACED');
    console.log(`commandId: ${event.commandId}`);
    console.log(`miniature: ${miniature.id}`);
    console.log(`position: ${miniature.position.x},${miniature.position.y}`);
    if (!event.delivered) console.log('Roll20 not connected; movement was not sent');
    return;
  }

  if (event.type === 'REMOTE_MOVE') {
    console.log('REMOTE_MOVE');
    console.log(`miniature: ${miniature.id}`);
    console.log(`token: ${event.tokenName || miniature.tokenId}`);
    console.log(`position: ${miniature.position.x},${miniature.position.y}`);
    return;
  }

  if (event.type === 'LOCAL_MOVE_CONFIRMED') {
    console.log('LOCAL_MOVE_CONFIRMED');
    console.log(`commandId: ${event.commandId}`);
    console.log(`miniature: ${miniature.id}`);
    console.log(`token: ${event.tokenName || miniature.tokenId}`);
    console.log(`position: ${miniature.position.x},${miniature.position.y}`);
    return;
  }

  if (event.type === 'LOCAL_MOVE_CONFIRMATION_IGNORED') {
    console.warn(`Ignored unmatched local confirmation: ${event.commandId || '(missing)'}`);
  }
}

function printBridgeEvent(event) {
  if (event.type === 'LISTENING') {
    console.log(`WebSocket listening on ${event.url}`);
    console.log('Waiting for Roll20...');
  } else if (event.type === 'ROLL20_CONNECTED') {
    console.log('ROLL20 CONNECTED');
  } else if (event.type === 'ROLL20_DISCONNECTED') {
    console.log('ROLL20 DISCONNECTED');
  } else if (event.type === 'INVALID_MESSAGE') {
    console.warn(`Ignored ${event.reason} from Roll20`);
  } else if (event.type === 'CONNECTION_ERROR') {
    console.warn(`Roll20 connection error: ${event.error.message}`);
  } else if (event.type === 'SERVER_ERROR') {
    console.error(`WebSocket server error: ${event.error.message}`);
  }
}

function printStatus(miniatures) {
  console.log('MINIATURES');
  if (miniatures.length === 0) {
    console.log('(none)');
    return;
  }

  for (const miniature of miniatures) {
    console.log('');
    console.log(miniature.id);
    console.log(`  token: ${miniature.tokenId}`);
    const position = miniature.position
      ? `${miniature.position.x},${miniature.position.y}`
      : '(unknown)';
    console.log(`  position: ${position}`);
  }
}
