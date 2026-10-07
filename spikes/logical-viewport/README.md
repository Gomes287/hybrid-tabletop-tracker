# SPIKE 004 — Mellon Logical Viewport

## Goal

Prove that Mellon can own a desired logical viewport independently from the
ephemeral Roll20 Jumpgate renderer camera, observe Roll20's actual viewport,
and explicitly reconcile Roll20 back to Mellon's desired state.

This spike stores state in Node memory only. It does not add persistence or
automatic restoration.

## Architecture

```text
CLI
 |
 v
Mellon LogicalViewport model (source of truth)
 |
 | WebSocket reconciliation request
 v
SPIKE 004 browser bridge
 |
 v
Roll20 viewport adapter
 |
 v
Campaign.engine.moveCamera(delta)
```

The Node process owns desired state. The browser owns no desired state; it only
observes the current renderer and executes one requested correction through the
native Jumpgate camera controller.

## Desired and observed state

Mellon's desired state is page-specific and integer-valued:

```text
pageId
desiredXCells
desiredYCells
```

The desired origin `(0,0)` is the page's neutral camera state, where
`cameraTransform.position` equals `tabletop-square-grid.position`.

Observed state is derived from the current renderer and remains fractional:

```text
observedXCells = (cameraWorldX - gridWorldX) / effectiveCellSize
observedYCells = (cameraWorldY - gridWorldY) / effectiveCellSize
```

Manual Roll20 pan and browser refresh update observed state only. They never
overwrite Mellon desired state.

## Effective square-grid cell size

SPIKE 004 preserves the semantics validated by SPIKE 003:

```text
ROLL20_BASE_UNIT = 70
effectiveCellSize = 70 * page.attributes.snapping_increment
```

Only square grids are supported. The adapter also checks that Jumpgate renderer
scaling divided by page dimensions remains approximately 70 before using these
internals.

## Reconciliation

One explicit `reconcile` operation calculates:

```text
errorXCells = desiredXCells - observedXCells
errorYCells = desiredYCells - observedYCells

deltaWorldX = errorXCells * effectiveCellSize
deltaWorldY = errorYCells * effectiveCellSize
```

Fractional-cell corrections are valid. The adapter creates a delta vector by
cloning the camera position and calls `Campaign.engine.moveCamera(delta)`. It
never directly mutates `cameraTransform.position`.

## Epsilon

The centrally defined reconciliation epsilon is `0.01` cells. At Cell Size 70
this is 0.7 world units; at Cell Size 80 it is 0.8 world units. This is small
enough to preserve cell intent while preventing repeated correction for minor
Jumpgate pixel-snapping differences.

If both axis errors are within epsilon, reconciliation reports success without
calling `moveCamera()`. Each explicit command makes at most one correction
attempt; there is no feedback loop.

## Page identity

Desired state belongs to one Roll20 page. A reconciliation request whose
`pageId` differs from the observed engine page fails with `PAGE_MISMATCH` and
does not move the camera. Page switching is intentionally outside this spike.

## WebSocket protocol

Node requests observation:

```json
{ "type": "GET_VIEWPORT_STATE" }
```

Browser reports renderer state:

```json
{
  "type": "VIEWPORT_STATE",
  "pageId": "page-001",
  "observedXCells": 1.73,
  "observedYCells": -0.41,
  "effectiveCellSize": 80,
  "cameraWorldX": 2693.4,
  "cameraWorldY": -1467.8,
  "gridWorldX": 2555,
  "gridWorldY": -1435
}
```

Node sends desired state explicitly:

```json
{
  "type": "RECONCILE_VIEWPORT",
  "pageId": "page-001",
  "desiredXCells": 3,
  "desiredYCells": 2,
  "epsilonCells": 0.01
}
```

Browser returns `VIEWPORT_RECONCILED` with desired state, observed state before
and after, cell error, world delta, epsilon, and whether `moveCamera()` ran.
Controlled failures use `VIEWPORT_ERROR`, including `PAGE_MISMATCH`,
`NOT_READY`, and compatibility errors.

## Run and CLI

Stop other spike servers that use port 8765, then run:

```bash
npm install
npm run spike:logical-viewport
```

Paste the complete contents of `spikes/logical-viewport/browser-bridge.js` into
the isolated Roll20 Player/Table View DevTools Console. Once the bridge is
ready, it automatically reports the current page and initializes Mellon desired
state to `(0,0)`.

Commands:

```text
status
set <xCells> <yCells>
pan <dxCells> <dyCells>
reconcile
```

- `status` requests a fresh observation and prints the latest desired and
  observed states.
- `set 3 2` changes desired state only.
- `pan 1 -1` changes desired state relatively and requires integer cells.
- `reconcile` performs one explicit observation/correction operation.

## Automated tests

```bash
npm test
```

The tests use a fake Roll20 engine, page, grid, camera transform, and native
`moveCamera()` implementation. No live Roll20 session is required. At final
validation, the complete repository suite passed with 54 tests.

## Manual validation

SPIKE 004 was validated end-to-end in a real Roll20 Jumpgate Player/Table View
on page `-P3LjkXComwM4xFHGV5q`, with an effective square-grid cell size of 70
world units.

### 1. Initial state and logical origin

After refreshing the Table View, Mellon reported desired `(0,0)`, observed
`(0,0)`, and a matching page. This empirically confirmed that the neutral
Table View state corresponds to logical origin `(0,0)` on the tested page.

Before the refresh, the renderer still contained a known residual pan of one
cell from SPIKE 003. SPIKE 004 correctly represented it as desired `(0,0)` and
observed `(1,0)`.

### 2. Desired and observed separation

After `set 3 2`, `status` reported desired `(3,2)`, observed `(0,0)`, and a
matching page. Roll20 did not move. Changing Mellon's desired state therefore
does not implicitly mutate the renderer.

### 3. Basic reconciliation

Running `reconcile` produced:

```text
desired: 3,2
observed before: 0,0
observed after: 3,2
correction world: 210,140
moved: true
```

With cell size 70, the correction is exactly `3 * 70 = 210` and
`2 * 70 = 140`. The visual movement occurred correctly through
`Campaign.engine.moveCamera(delta)`.

### 4. Renderer refresh survival

With the Node process still running and desired state `(3,2)`, only the Roll20
Player/Table View was refreshed. After the browser bridge reconnected, Mellon
reported desired `(3,2)`, observed `(0,0)`, and a matching page. The logical
state therefore remained owned by Mellon while the renderer reset.

The next `reconcile` restored the renderer from observed `(0,0)` to `(3,2)`,
using world correction `(210,140)` and reporting `moved: true`.

### 5. Manual interference and fractional observation

Starting aligned at desired and observed `(3,2)`, an arbitrary manual Table
View pan resulted in:

```text
desired: 3,2
observed: 8.257142857142858,7.357142857142857
page match: true
```

The manual pan changed observed state without changing desired state, and the
model preserved the renderer's fractional-cell position.

### 6. Reconciliation after fractional manual pan

Running `reconcile` then produced:

```text
desired: 3,2
observed before: 8.257142857142858,7.357142857142857
observed after: 3,2
correction world: -368.00000000000006,-375
moved: true
```

The result matches the cell-to-world calculation:

```text
(3 - 8.257142857142858) * 70 ~= -368
(2 - 7.357142857142857) * 70 = -375
```

### 7. Idempotence and epsilon

With desired and observed both `(3,2)`, another `reconcile` caused no further
movement and reported `moved: false`. Reconciliation is therefore idempotent
when the renderer is already within the configured tolerance.

## Conclusion

**APPROVED.** SPIKE 004 empirically demonstrated that Mellon can own an
integer, page-specific desired viewport independently of Roll20; observe
fractional renderer state; preserve desired state across a renderer refresh
while Node remains alive; restore the renderer after refresh or manual pan;
and reconcile idempotently through `Campaign.engine.moveCamera(delta)`. The
cell-to-world conversion was validated with an effective cell size of 70.

## Limitations and future work

- Desired state is memory-only and is lost when Node restarts.
- Restoration is explicit, never automatic.
- Only one current page and square grids are supported.
- No zoom ownership or reconciliation exists.
- Manual pan can create fractional observed state by design.
- The browser bridge must be reinjected after a browser refresh.
- Jumpgate pixel-snapping behavior affects the appropriate epsilon tolerance.
- Jumpgate and Roll20 internal APIs are undocumented compatibility risks.
- Persistence, page switching, physical coordinates, projector calibration,
  ArUco, NFC, miniature state, Navigation Mode, party following, UI,
  authentication, and deployment remain outside SPIKE 004.
