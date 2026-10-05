'use strict';

const readline = require('node:readline');
const { WebSocket, WebSocketServer } = require('ws');

const HOST = '127.0.0.1';
const PORT = 8765;

console.log('Hybrid Tabletop — Roll20 Table View Navigation Spike');

const server = new WebSocketServer({ host: HOST, port: PORT });

server.on('listening', () => {
  console.log(`WebSocket listening on ws://${HOST}:${PORT}`);
  console.log('Waiting for Roll20 Table View...');
});

server.on('connection', (socket) => {
  console.log('ROLL20 TABLE VIEW CONNECTED');

  socket.on('message', (data, isBinary) => {
    if (isBinary) {
      console.warn('Ignored binary message from Roll20 Table View');
      return;
    }

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      console.warn('Ignored invalid JSON from Roll20 Table View');
      return;
    }

    if (isViewportPanned(message)) {
      console.log('VIEWPORT_PANNED');
      console.log(`cells: ${message.dxCells},${message.dyCells}`);
      console.log(`cell size: ${message.cellX},${message.cellY}`);
      if (message.cameraPosition) {
        const { x, y, z } = message.cameraPosition;
        console.log(`camera: ${x},${y},${z}`);
      }
      return;
    }

    if (isTableViewError(message)) {
      console.warn(`${message.code}: ${message.detail}`);
      return;
    }

    console.warn('Ignored invalid or unsupported message from Roll20 Table View');
  });

  socket.on('close', () => console.log('ROLL20 TABLE VIEW DISCONNECTED'));
  socket.on('error', (error) => {
    console.warn(`Roll20 Table View connection error: ${error.message}`);
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
  const parts = line.trim().split(/\s+/);
  const [command, dxText, dyText, ...extra] = parts;

  if (command !== 'pan' || !dxText || !dyText || extra.length > 0) {
    console.log('Usage: pan <dxCells> <dyCells>');
    return;
  }

  const dxCells = Number(dxText);
  const dyCells = Number(dyText);
  if (!Number.isFinite(dxCells) || !Number.isFinite(dyCells)) {
    console.log('dxCells and dyCells must be finite numbers');
    return;
  }

  const clients = [...server.clients].filter(
    (client) => client.readyState === WebSocket.OPEN,
  );
  if (clients.length === 0) {
    console.log('No Roll20 Table View connection; command not sent');
    return;
  }

  const payload = JSON.stringify({ type: 'PAN_VIEWPORT', dxCells, dyCells });
  for (const client of clients) client.send(payload);
  console.log(`PAN_VIEWPORT sent: ${dxCells},${dyCells}`);
});

function isViewportPanned(message) {
  return Boolean(
    message &&
      message.type === 'VIEWPORT_PANNED' &&
      Number.isFinite(message.dxCells) &&
      Number.isFinite(message.dyCells) &&
      Number.isFinite(message.cellX) &&
      message.cellX > 0 &&
      Number.isFinite(message.cellY) &&
      message.cellY > 0 &&
      (!message.cameraPosition || isVector(message.cameraPosition)),
  );
}

function isTableViewError(message) {
  return Boolean(
    message &&
      message.type === 'TABLE_VIEW_ERROR' &&
      typeof message.code === 'string' &&
      typeof message.detail === 'string',
  );
}

function isVector(value) {
  return (
    value &&
    Number.isFinite(value.x) &&
    Number.isFinite(value.y) &&
    Number.isFinite(value.z)
  );
}
