'use strict';

const readline = require('node:readline');
const { WebSocket, WebSocketServer } = require('ws');
const { LogicalViewport, LogicalViewportError } = require('./logical-viewport');

const HOST = '127.0.0.1';
const PORT = 8765;
const RECONCILIATION_EPSILON_CELLS = 0.01;

console.log('Mellon — Logical Viewport Spike');

const logicalViewport = new LogicalViewport();
const server = new WebSocketServer({ host: HOST, port: PORT });
let statusRequested = false;

server.on('listening', () => {
  console.log(`WebSocket listening on ws://${HOST}:${PORT}`);
  console.log('Waiting for Roll20 Table View...');
});

server.on('connection', (socket) => {
  console.log('ROLL20 TABLE VIEW CONNECTED');

  socket.on('message', (data, isBinary) => {
    if (isBinary) return console.warn('Ignored binary viewport message');

    let message;
    try {
      message = JSON.parse(data.toString());
    } catch {
      console.warn('Ignored invalid JSON from Roll20 Table View');
      return;
    }

    try {
      if (message.type === 'VIEWPORT_STATE' && isObservedViewport(message)) {
        logicalViewport.recordObserved(message);
        printObserved(message);
        if (statusRequested) {
          statusRequested = false;
          printStatus(logicalViewport.getStatus());
        }
        return;
      }

      if (message.type === 'VIEWPORT_RECONCILED' && isReconciliation(message)) {
        logicalViewport.recordObserved(message.observedAfter);
        console.log('VIEWPORT_RECONCILED');
        console.log(`page: ${message.pageId}`);
        console.log(`desired: ${message.desiredXCells},${message.desiredYCells}`);
        console.log(
          `observed before: ${message.observedBefore.observedXCells},${message.observedBefore.observedYCells}`,
        );
        console.log(
          `observed after: ${message.observedAfter.observedXCells},${message.observedAfter.observedYCells}`,
        );
        console.log(`correction world: ${message.deltaWorldX},${message.deltaWorldY}`);
        console.log(`moved: ${message.moved}`);
        return;
      }

      if (message.type === 'VIEWPORT_ERROR' && isViewportError(message)) {
        console.warn(`${message.code}: ${message.detail}`);
        return;
      }

      console.warn('Ignored invalid or unsupported viewport message');
    } catch (error) {
      printError(error);
    }
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
  const command = parts[0];

  try {
    if (command === 'status' && parts.length === 1) {
      if (requestObservedViewport() === 0) {
        printStatus(logicalViewport.getStatus());
      } else {
        statusRequested = true;
        console.log('VIEWPORT_STATE requested');
      }
      return;
    }

    if (command === 'set' && parts.length === 3) {
      const desired = logicalViewport.requireDesired();
      logicalViewport.setViewport(
        desired.pageId,
        parseInteger(parts[1], 'xCells'),
        parseInteger(parts[2], 'yCells'),
      );
      printDesired(logicalViewport.getDesired());
      return;
    }

    if (command === 'pan' && parts.length === 3) {
      logicalViewport.panViewport(
        parseInteger(parts[1], 'dxCells'),
        parseInteger(parts[2], 'dyCells'),
      );
      printDesired(logicalViewport.getDesired());
      return;
    }

    if (command === 'reconcile' && parts.length === 1) {
      const desired = logicalViewport.requireDesired();
      const recipients = broadcast({
        type: 'RECONCILE_VIEWPORT',
        pageId: desired.pageId,
        desiredXCells: desired.xCells,
        desiredYCells: desired.yCells,
        epsilonCells: RECONCILIATION_EPSILON_CELLS,
      });
      if (recipients === 0) {
        console.log('No Roll20 Table View connection; reconciliation not sent');
      } else {
        console.log(
          `RECONCILE_VIEWPORT sent: ${desired.xCells},${desired.yCells} page=${desired.pageId}`,
        );
      }
      return;
    }

    console.log('Commands: status | set <xCells> <yCells> | pan <dxCells> <dyCells> | reconcile');
  } catch (error) {
    printError(error);
  }
});

function requestObservedViewport() {
  return broadcast({ type: 'GET_VIEWPORT_STATE' });
}

function broadcast(message) {
  const payload = JSON.stringify(message);
  let recipients = 0;
  for (const client of server.clients) {
    if (client.readyState !== WebSocket.OPEN) continue;
    client.send(payload);
    recipients += 1;
  }
  return recipients;
}

function parseInteger(value, field) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new LogicalViewportError(
      'INVALID_LOGICAL_VIEWPORT',
      `${field} must be an integer`,
    );
  }
  return parsed;
}

function isObservedViewport(value) {
  return Boolean(
    value &&
      typeof value.pageId === 'string' &&
      Number.isFinite(value.observedXCells) &&
      Number.isFinite(value.observedYCells) &&
      Number.isFinite(value.effectiveCellSize) &&
      value.effectiveCellSize > 0,
  );
}

function isReconciliation(value) {
  return Boolean(
    value &&
      typeof value.pageId === 'string' &&
      Number.isInteger(value.desiredXCells) &&
      Number.isInteger(value.desiredYCells) &&
      isObservedViewport(value.observedBefore) &&
      isObservedViewport(value.observedAfter) &&
      Number.isFinite(value.deltaWorldX) &&
      Number.isFinite(value.deltaWorldY) &&
      typeof value.moved === 'boolean',
  );
}

function isViewportError(value) {
  return Boolean(
    value &&
      typeof value.code === 'string' &&
      typeof value.detail === 'string',
  );
}

function printDesired(desired) {
  console.log('DESIRED_VIEWPORT');
  console.log(`page: ${desired.pageId}`);
  console.log(`cells: ${desired.xCells},${desired.yCells}`);
}

function printObserved(observed) {
  console.log('VIEWPORT_STATE');
  console.log(`page: ${observed.pageId}`);
  console.log(`observed cells: ${observed.observedXCells},${observed.observedYCells}`);
  console.log(`effective cell size: ${observed.effectiveCellSize}`);
}

function printStatus(status) {
  console.log('LOGICAL_VIEWPORT_STATUS');
  if (status.desired) {
    console.log(
      `desired: page=${status.desired.pageId} cells=${status.desired.xCells},${status.desired.yCells}`,
    );
  } else {
    console.log('desired: awaiting Roll20 page');
  }
  if (status.observed) {
    console.log(
      `observed: page=${status.observed.pageId} cells=${status.observed.observedXCells},${status.observed.observedYCells}`,
    );
  } else {
    console.log('observed: unavailable');
  }
  console.log(`page match: ${status.pageMatches}`);
}

function printError(error) {
  if (error instanceof LogicalViewportError) {
    console.warn(error.message);
  } else {
    console.error(error);
  }
}
