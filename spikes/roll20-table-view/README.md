# SPIKE 003 — Roll20 Table View Navigation

## Objective

Prove that Dragon's Den can pan a Roll20 Jumpgate Player View used as the table
display in logical grid-cell units through Jumpgate's native camera controller.
The spike does not simulate pointer input, modify camera position directly, or
reimplement the Roll20 renderer.

## Architecture

```text
CLI: pan <dxCells> <dyCells>
              |
              v
       local WebSocket server
              |
       PAN_VIEWPORT (cells)
              |
              v
   SPIKE 003 browser bridge
              |
              v
       Table View adapter
              |
              v
 Campaign.engine.moveCamera(Vector3)
```

Only the Table View adapter knows about Roll20 Jumpgate internals. The CLI and
WebSocket API use cells exclusively and never expose Babylon units.

## Empirically validated Roll20 behavior

- A Player View can act as the Table View while preserving Fog of War and
  Dynamic Lighting and hiding the GM Layer.
- Master View and Table View retain independent pan and zoom.
- `Campaign.engine` is the active renderer controller.
- `Campaign.engine.cameraTransform` is the `cam-transform` transform node.
- `MeshScene` contains `tabletop-square-grid`.
- `engine.moveCamera(Vector3)` performs native pan and runs Roll20's post-camera
  update path for the map, grid, tokens, and lighting viewport.
- A 70-unit camera delta moved exactly one square at approximately 0.73 and 0.89
  zoom, showing that logical world movement is independent of visual zoom.

The tested 25 by 25 square page had grid scaling `1750,-1750`, producing:

```text
cellX = abs(1750) / 25 = 70
cellY = abs(-1750) / 25 = 70
```

## Internal interfaces and compatibility guard

`Campaign.engine`, `MeshScene`, and `tabletop-square-grid` are undocumented
Roll20 internals and may change without notice. They are intentionally
encapsulated in `browser-bridge.js` and must not spread through the project.

Before every pan, the adapter validates:

- `window.Campaign` and `Campaign.engine`;
- the active page exposed by the engine;
- `window.MeshScene` and `MeshScene.getMeshByName()`;
- `engine.cameraTransform` and its clonable position;
- `engine.moveCamera()`;
- the `tabletop-square-grid` mesh and scaling;
- square grid type;
- positive page dimensions and calculated cell sizes.

Missing or changed internals produce `ROLL20_TABLE_VIEW_UNSUPPORTED`. A grid
other than square produces `UNSUPPORTED_GRID_TYPE`. There is deliberately no
fallback to synthetic mouse/pointer events.

## Readiness lifecycle

Jumpgate initializes its renderer asynchronously. A missing `engine.page` or
grid during startup is therefore `NOT_READY`, not immediate evidence of an
incompatible Roll20 version.

After the WebSocket connects, the bridge polls readiness every 150 ms for up to
10 seconds. It checks Campaign, `Campaign.engine`, `moveCamera()`, the active
page and dimensions, available page loading indicators, MeshScene, square-grid
mesh/scaling, calculated cell sizes, and the camera transform. Readiness
requires `engine.page`; `Campaign.activePage()` is only a guarded fallback for
adapter access after readiness and never bypasses that wait.

The bridge logs the waiting message once:

```text
[HTT3] Waiting for Roll20 Table View readiness...
```

When initialization completes it logs:

```text
[HTT3] Roll20 Table View ready
```

Only expiration of the readiness timeout converts a persistently missing
requirement into `ROLL20_TABLE_VIEW_UNSUPPORTED`, including the last missing
requirement in the error detail.

A `PAN_VIEWPORT` received while waiting is rejected immediately with
`NOT_READY`. It is not partially executed, queued, or silently replayed later;
the caller must issue the command again after the ready log.

## Native pan calculation

For each command, the adapter dynamically calculates:

```text
cellX = abs(grid.scaling.x) / page.attributes.width
cellY = abs(grid.scaling.y) / page.attributes.height
```

It obtains a Babylon-compatible vector without relying on a global `BABYLON`:

```js
const delta = engine.cameraTransform.position.clone();
delta.copyFromFloats(dxCells * cellX, dyCells * cellY, 0);
engine.moveCamera(delta);
```

The adapter never writes to `engine.cameraTransform.position`. Calling
`moveCamera()` is mandatory because Jumpgate's post-camera update keeps its
renderer and lighting subsystems synchronized.

## WebSocket protocol

Request:

```json
{
  "type": "PAN_VIEWPORT",
  "dxCells": 1,
  "dyCells": 0
}
```

Success:

```json
{
  "type": "VIEWPORT_PANNED",
  "dxCells": 1,
  "dyCells": 0,
  "cellX": 70,
  "cellY": 70,
  "cameraPosition": { "x": 70, "y": 0, "z": 0 }
}
```

`cameraPosition` is optional diagnostic data and is not part of the essential
public navigation API.

Controlled failure:

```json
{
  "type": "TABLE_VIEW_ERROR",
  "code": "ROLL20_TABLE_VIEW_UNSUPPORTED",
  "detail": "Campaign.engine is not available"
}
```

Transient readiness rejection:

```json
{
  "type": "TABLE_VIEW_ERROR",
  "code": "NOT_READY",
  "detail": "Roll20 Table View is still initializing; command was not queued"
}
```

## Run and CLI

From the repository root:

```bash
npm install
npm run spike:table-view
```

Paste the complete contents of `spikes/roll20-table-view/browser-bridge.js` in
the Roll20 Player View DevTools Console. The spike listens only on
`ws://127.0.0.1:8765`, so stop other spike servers first.

Available commands:

```text
pan 1 0
pan -1 0
pan 0 1
pan 0 -1
pan 5 0
```

All values are logical square-grid cells.

## Automated tests

```bash
npm test
```

The tests use minimal mocks for the engine, page, scene, grid, camera transform,
vector clone, and `moveCamera()`. They do not require Roll20 or a browser.

## Manual validation checklist

- [ ] Player View bridge connects, waits without an unsupported error, and
  reports ready with positive cell sizes.
- [ ] `pan 1 0` moves exactly one cell horizontally.
- [ ] `pan -1 0` moves exactly one cell in the opposite direction.
- [ ] `pan 0 1` and `pan 0 -1` move one cell vertically in each direction.
- [ ] `pan 5 0` moves exactly five horizontal cells.
- [ ] Each command returns `VIEWPORT_PANNED`.
- [ ] Pan remains one logical cell at two different zoom levels.
- [ ] Map, grid, tokens, Fog of War, and Dynamic Lighting remain synchronized.
- [ ] Master View pan/zoom does not change the Table View camera.
- [ ] No GM Layer content appears in the Player View.
- [ ] Unsupported internals fail explicitly without synthetic pointer fallback.

## Final manual validation result

SPIKE 003 was validated successfully against the real Roll20 Jumpgate Player
View used as the Table View.

The following positive, negative, and multi-cell commands were exercised:

```text
pan 1 0
pan 5 0
pan 3 0
pan -5 0
```

The tested square grid reported a cell size of `70,70` Roll20 world units. The
visual displacement matched the requested number and direction of cells for
each command. Native pan through `Campaign.engine.moveCamera()` moved the map,
grid, tokens, and lighting together correctly.

The readiness fix was also validated in the real Jumpgate environment. The
bridge waited for initialization and reached the operational state without the
earlier false unsupported result:

```text
[HTT3] Connected to localhost
[HTT3] Roll20 Table View ready
[HTT3] Cell size: 70,70
```

### Browser-session isolation

An important operational constraint was confirmed during validation. Two
windows sharing the same normal browser session are not sufficient for a robust
GM View plus **Re-Join as Player** Table View. The Re-Join as Player state
affects the browser session, so refreshing a GM View in that same session can
cause it to return as a Player View.

The issue does not occur when the views use isolated browser sessions. The
validated setup used:

- a normal Chrome session for the GM View;
- an incognito Chrome session for the Player/Table View;
- the SPIKE 003 browser bridge only in the isolated Player session.

After refreshing the GM View, it remained a GM View. Running `pan 1 0` then
moved only the Table View; the GM View remained completely stationary.

An incognito window is suitable during development. A persistent installation
should use a dedicated browser profile for the Table View instead of depending
on an incognito window. The validation used the same Roll20 account in both
isolated sessions; a second Roll20 account was not required.

## Risks and exclusions

Roll20 may rename or remove any Jumpgate internal used here. The compatibility
guard converts that into a controlled failure, but cannot guarantee future
compatibility.

This spike does not implement physical scale, projector calibration, zoom,
ArUco, NFC, full Navigation Mode, ghost positions, miniature repositioning,
persistence, UI, custom lighting, a renderer, hex/gridless support, or automatic
group viewport synchronization.
