# SPIKE 005 — Grid & Footprint Model

## Spike question

Can Mellon represent a creature using a canonical grid position plus a square
footprint, convert that model deterministically to Roll20 token geometry, and
classify the inverse conversion without automatically moving or correcting the
token?

This spike is intentionally a small, pure geometry model. It has no browser
bridge, WebSocket server, renderer mutation, or physical tracking.

## Current model / assumption

Mellon's logical representation is:

```js
{
  gridX,
  gridY,
  footprintWidth,
  footprintHeight,
}
```

`gridX` and `gridY` identify the top-left occupied cell. All four values are
integers. This spike supports square footprints `1x1`, `2x2`, `3x3`, and
`4x4`.

Roll20 `left` and `top` describe the token center in world units, while
`width` and `height` describe renderer dimensions. These are adapter geometry,
not Mellon logical state. Keeping them outside the canonical model avoids
making logical identity depend on cell size or renderer-specific center
alignment.

The current model assumes **grid offset is zero**. Grid offset is a separate,
not-yet-derived variable and no offset formula is invented here.

## Effective cell size

The pure API receives `effectiveCellSize` as input. It is not fixed to 70.
Following SPIKE 003, a Roll20 adapter can derive it as:

```text
effectiveCellSize = 70 * snapping_increment
```

Automated coverage includes effective cell sizes 70 and 80.

## Forward transform: Mellon to Roll20

For zero grid offset:

```text
width  = footprintWidth  * effectiveCellSize
height = footprintHeight * effectiveCellSize
left   = (gridX + footprintWidth  / 2) * effectiveCellSize
top    = (gridY + footprintHeight / 2) * effectiveCellSize
```

No even/odd branch is required. The top-left cell plus half the footprint
naturally places odd footprints at half-cell centers and even footprints at
cell intersections.

Invalid canonical input fails with a `GridFootprintError`. Grid coordinates
must be integers, cell size must be finite and positive, and the footprint must
be one of the supported squares.

## Inverse transform: Roll20 to Mellon

The inverse first derives values in cell units:

```text
footprintWidthCells  = width  / effectiveCellSize
footprintHeightCells = height / effectiveCellSize

gridXCells = left / effectiveCellSize - footprintWidth / 2
gridYCells = top  / effectiveCellSize - footprintHeight / 2
```

Dimensions are compared with supported integer square footprints. When the
footprint is valid, grid coordinates are compared with their nearest integers.
Rounding is used only to produce the candidate integer and is accepted only
when the original value is within the explicit tolerance.

## Floating-point tolerance

`DEFAULT_TOLERANCE_CELLS` is `1e-5` cells and applies to both footprint
dimensions and grid coordinates. The inverse API accepts a configurable
`toleranceCells` option for controlled experiments. Tolerance is expressed in
cells so its meaning remains stable across different world-unit cell sizes.

The default includes a conservative margin over noise measured in Jumpgate:
`280.00006103515625` instead of 280 at cell size 70 (approximately
`8.72e-7` cells), and `319.99993896484375` instead of 320 at cell size 80
(approximately `-7.63e-7` cells). At cell size 70, the configured tolerance is
only `0.0007` world units and remains geometrically negligible.

Values outside tolerance remain `OFF_GRID`; the implementation does not
silently snap them. Invalid, negative, or non-finite tolerance is rejected.

## Classification

`fromRoll20Geometry()` returns one of three statuses:

- `CANONICAL`: width and height form a supported square footprint and the
  derived `gridX` and `gridY` are integers within tolerance.
- `OFF_GRID`: the footprint is valid, but at least one derived grid coordinate
  is outside tolerance. The result preserves fractional coordinates and also
  reports the nearest integer candidates for diagnosis.
- `INVALID_FOOTPRINT`: dimensions are non-finite, non-positive, not integral in
  cells within tolerance, non-square, or outside the supported `1x1`–`4x4`
  range.

Non-finite `left` or `top` cannot describe a position and produce an explicit
`INVALID_ROLL20_GEOMETRY` error. Invalid cell size is always an explicit
`INVALID_CELL_SIZE` error. The inverse transform only detects and represents;
it never moves or corrects a token.

## Manual validation — Roll20 Jumpgate

SPIKE 005 was validated against real Roll20 Jumpgate geometry. Roll20 geometry
is renderer/VTT state; canonical Mellon grid position is domain state. Mellon
must not use Roll20 `left` and `top` as the primary logical representation of a
creature's position.

### Cell size 70

With `snapping_increment = 1`, the effective cell size was 70.

| Footprint | Roll20 geometry | Canonical top-left cell | Result |
| --- | --- | --- | --- |
| `1x1` | `left=945`, `top=1015`, `width=70`, `height=70` | `(13,14)` | `CANONICAL` |
| `2x2` | `left=980`, `top=980`, `width=140`, `height=140` | `(13,13)` | `CANONICAL` |
| `3x3` | `left=1015`, `top=945`, `width=210`, `height=210` | `(13,12)` | `CANONICAL` |
| `4x4` | `left=1050`, `top=910`, `width=280.00006103515625`, `height=280` | `(13,11)` | `CANONICAL` |

The `4x4` result confirmed both even-footprint alignment at a grid
intersection and tolerance of real Jumpgate floating-point noise.

### Cell size 80

With `snapping_increment = 1.1428571428571428`, the effective cell size was
80. The following real cases were classified correctly:

```text
4x4
left=1040, top=880
width=319.99993896484375, height=320
CANONICAL: gridX=11, gridY=9, footprint=4x4

3x3
left=920, top=840
width=240, height=240
CANONICAL: gridX=10, gridY=9, footprint=3x3
```

These cases confirmed effective-cell-size parameterization, even and odd
footprints at a non-default cell size, and tolerance of the same class of
renderer noise seen at cell size 70.

Changing the Roll20 Cell Size setting from 70 to 80 did **not** automatically
resize an existing approximately `280x280` world-unit token. Its geometry then
represented `3.5x3.5` cells rather than preserving a logical `4x4` footprint.
This is **EMPIRICALLY VALIDATED IN ROLL20**: Mellon must always interpret token
`width` and `height` against the current `effectiveCellSize` and must not assume
that a previously `4x4` token remains `4x4` after configuration changes.

### Real off-grid geometry

A canonical `3x3` token at cell size 80 was moved from `left=920`, `top=840`
to `left=930`, `top=840`, while keeping `width=240`, `height=240`. Roll20
preserved that unsnapped position. The inverse transform returned:

```js
{
  status: 'OFF_GRID',
  gridX: 10.125,
  gridY: 9,
  nearestGridX: 10,
  nearestGridY: 9,
  footprintWidth: 3,
  footprintHeight: 3,
}
```

This confirmed that Mellon preserves real fractional position, reports nearest
grid candidates separately, does not round silently, and performs no automatic
correction.

### Real invalid footprint

Roll20 accepted `left=930`, `top=840`, `width=100`, `height=80` at cell size
80. This is `1.25x1` cells and the inverse transform returned:

```js
{
  status: 'INVALID_FOOTPRINT',
  reason: 'dimensions do not represent a supported square footprint',
  widthCells: 1.25,
  heightCells: 1,
}
```

This confirmed that Roll20 can hold geometry incompatible with Mellon's model,
and Mellon detects it without coercion or automatic resizing.

### Geometric conclusion

The real results support the canonical top-left-cell model and both transform
formulae documented above. Odd footprints naturally center on half-cell
coordinates; even footprints naturally center on integer-cell/grid-intersection
coordinates. No separate even/odd positioning rule is necessary.

## Public API

```js
const {
  DEFAULT_TOLERANCE_CELLS,
  GridFootprintError,
  STATUS,
  SUPPORTED_SQUARE_FOOTPRINTS,
  fromRoll20Geometry,
  toRoll20Geometry,
} = require('./grid-footprint');
```

Example:

```js
toRoll20Geometry({
  gridX: 13,
  gridY: 14,
  footprintWidth: 1,
  footprintHeight: 1,
}, 70);
// { left: 945, top: 1015, width: 70, height: 70 }
```

## Automated tests

Run only this spike:

```bash
npm run spike:grid-footprint:test
```

Run the complete repository suite:

```bash
npm test
```

Coverage includes forward and inverse transforms for `1x1` through `4x4`,
cell sizes 70 and 80, round trips, the empirical Roll20 fixtures,
floating-point noise, configurable tolerance, deliberate off-grid placement,
invalid footprints, invalid numbers, invalid cell sizes, and strict canonical
input validation, including the exact noisy geometries observed in Jumpgate.
At final validation, all 25 SPIKE 005 tests and all 79 tests in the complete
repository suite passed.

## Future physical chain — documentation only

The expected future data path is approximately:

```text
camera
  -> table registration
  -> continuous physical position
  -> tracking / jitter filtering
  -> snap + hysteresis
  -> canonical Mellon grid position
  -> Roll20 geometry
```

A physical table may vibrate or shift naturally. Global table or camera motion
must not be interpreted as miniature movement. The planned strategy is to use
fiducials fixed to the table surface to continuously establish the table's own
coordinate frame. Table registration would first compensate for global motion
and parallax, tracking filters would reduce jitter, and snap/hysteresis would
then decide whether a logical cell transition occurred. None of this is
implemented in SPIKE 005.

## Limitations and out of scope

- Only square grids, zero grid offset, and square `1x1`–`4x4` footprints are
  supported.
- Roll20 geometry is interpreted but never mutated or automatically snapped.
- There is no tracking, ArUco, camera, NFC, projection, physical-unit model,
  calibration, table registration, parallax correction, jitter filtering,
  hysteresis, Navigation Mode, ghost position, viewport-relative coordinate,
  Fog of War, Dynamic Lighting, persistence, database, UI, gridless, or hex
  support.
- The future behavior of grid offset and arbitrary footprints remains unknown
  and is deliberately not inferred by this spike.

Status: **SPIKE 005 VALIDATED**.
