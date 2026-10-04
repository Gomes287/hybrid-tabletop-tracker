'use strict';

const readline = require('node:readline');
const { WebSocket, WebSocketServer } = require('ws');

const HOST = '127.0.0.1';
const PORT = 8765;

console.log('Hybrid Tabletop — Roll20 Bridge Spike');

const server = new WebSocketServer({ host: HOST, port: PORT });

server.on('listening', () => {
  console.log(`WebSocket listening on ws://${HOST}:${PORT}`);
  console.log('Waiting for Roll20...');
});

server.on('connection', (socket) => {
  console.log('ROLL20 CONNECTED');

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      console.warn('Ignored binary message from Roll20');
      return;
    }

    let message;

    try {
      message = JSON.parse(data.toString());
    } catch {
      console.warn('Ignored invalid JSON from Roll20');
      return;
    }

    if (!isTokenMovedMessage(message)) {
      console.warn('Ignored invalid or unsupported message from Roll20');
      return;
    }

    const { token } = message;
    console.log('TOKEN_MOVED');
    console.log(`name: ${token.name || '(unnamed)'}`);
    console.log(`id: ${token.id}`);
    console.log(`x: ${token.left}`);
    console.log(`y: ${token.top}`);
    console.log(`pageId: ${token.pageId || '(unknown)'}`);
  });

  socket.on('close', () => {
    console.log('ROLL20 DISCONNECTED');
  });

  socket.on('error', (error) => {
    console.warn(`Roll20 connection error: ${error.message}`);
  });
});

server.on('error', (error) => {
  console.error(`WebSocket server error: ${error.message}`);
});

const cli = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: Boolean(process.stdin.isTTY),
});

cli.on('line', (line) => {
  const input = line.trim();
  if (!input) return;

  const parts = input.split(/\s+/);
  const [command, tokenId, leftText, topText, ...extra] = parts;

  if (command !== 'move' || !tokenId || !leftText || !topText || extra.length > 0) {
    console.log('Usage: move <tokenId> <x> <y>');
    return;
  }

  const left = Number(leftText);
  const top = Number(topText);

  if (!Number.isFinite(left) || !Number.isFinite(top)) {
    console.log('Coordinates must be finite numbers');
    return;
  }

  const clients = [...server.clients].filter(
    (client) => client.readyState === WebSocket.OPEN,
  );

  if (clients.length === 0) {
    console.log('No Roll20 connection; command not sent');
    return;
  }

  const payload = JSON.stringify({
    type: 'MOVE_TOKEN',
    tokenId,
    left,
    top,
  });

  for (const client of clients) {
    client.send(payload);
  }

  console.log(`MOVE_TOKEN sent: ${tokenId} -> ${left},${top}`);
});

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
  );
}
