# SPIKE 002 — Table Engine

SPIKE 002 introduces an in-memory model of the physical tabletop between a
future physical tracker and the Roll20 integration.

```text
Physical simulator (CLI)
          |
          v
     Table Engine
          |
          v
    Roll20 Adapter
          |
          v
WebSocket bridge server
          |
          v
Spike 002 browser bridge
          |
          v
        Roll20
```

The Table Engine knows only miniature IDs, token bindings, positions, generic
movement origin/command metadata, and the small `moveToken()` adapter operation.
It does not know the WebSocket message format or manipulate Roll20 models.

## Run

Install dependencies once from the repository root:

```bash
npm install
```

Start the Table Engine server:

```bash
npm run spike:table-engine
```

Do not run the SPIKE 001 server at the same time because both servers bind to
`ws://127.0.0.1:8765`. Copy the contents of the SPIKE 002 bridge at
`spikes/table-engine/browser-bridge.js` into the Roll20 DevTools Console. The
validated and committed SPIKE 001 bridge remains unchanged.

## CLI

Bind a simulated physical miniature to a Roll20 token:

```text
bind mini-001 -P36gB08wsrxpoF58JMk
```

Place that miniature using temporary Roll20 `left`/`top` coordinates:

```text
place mini-001 945 735
```

Inspect the in-memory state:

```text
status
```

Bindings and positions are discarded when the process exits.

## Echo suppression

The Roll20 Adapter generates a unique `commandId` for every `MOVE_TOKEN`. The
SPIKE 002 browser bridge temporarily records that command ID together with its
token and expected position before calling `token.set()` and `token.save()`.

When the bridge observes the corresponding model change, it sends:

```json
{
  "type": "TOKEN_MOVED",
  "origin": "local-command",
  "commandId": "..."
}
```

An unrelated Roll20 movement is sent with `origin: "roll20"` and no command
ID. The Table Engine accepts a local confirmation only when its command ID,
token, and position all match a pending command. It never infers origin from a
time window or coordinates alone.

Pending correlations expire after ten seconds only to clean up commands that
never receive confirmation. An expired or unknown local confirmation is
ignored; it is not reclassified as a remote movement.

## Offline semantics

The Table Engine represents the latest physical truth observed by the system.
Roll20 represents the VTT state. Therefore `place` updates the miniature's
in-memory physical position even when the adapter is disconnected or delivery
fails; communication failure does not invalidate the observed physical
position.

The result can temporarily diverge from Roll20. A future version should expose
an explicit synchronization state such as `SYNCED`, `OUT_OF_SYNC`, or
`PENDING_SYNC`. SPIKE 002 reports failed delivery but does not implement that
state machine or automatic retry.

## Coordinate systems

For SPIKE 002 only, `place <miniatureId> <x> <y>` accepts Roll20 world-space
`left`/`top` directly. This is a temporary simulator shortcut, not the future
physical tracker contract.

The architecture must keep these spaces distinct:

```text
ROLL20 WORLD SPACE
        |
        v
VIEWPORT SPACE
        |
        v
PROJECTION SPACE
        |
        v
PHYSICAL TABLE SPACE
```

Map dimensions may vary. Pan and zoom change viewport and projection without
changing a token's Roll20 world position. Map, viewport, projection, and the
physical table must not implicitly share coordinates. The transformations
between these spaces remain outside this spike.

## Deterministic conflict behavior

Events are processed in arrival order. `place` immediately updates the
in-memory physical state, even if Roll20 is disconnected. An unmatched incoming
Roll20 movement then becomes the latest state. No locks or simultaneous-update
resolution are attempted in this spike.

## Automated tests

```bash
npm test
```

The tests use an in-memory fake bridge and do not require Roll20 or a listening
network port.

## Manual acceptance test with Goblin

1. Open the Roll20 campaign as GM and make sure the Goblin token is on the
   active page.
2. Run `npm run spike:table-engine`.
3. If the SPIKE 001 bridge is still running, stop it with
   `window.__HTTRoll20Bridge.stop()`. Paste
   `spikes/table-engine/browser-bridge.js` into the Roll20 DevTools
   Console.
4. In the server terminal, run:

   ```text
   bind mini-001 -P36gB08wsrxpoF58JMk
   place mini-001 945 735
   ```

5. Confirm that the Goblin moves to `945,735`. Its returning `TOKEN_MOVED`
   should include the same `commandId` and print `LOCAL_MOVE_CONFIRMED`, not
   `REMOTE_MOVE`.
6. Move the Goblin manually in Roll20. Confirm that the terminal prints:

   ```text
   REMOTE_MOVE
   miniature: mini-001
   token: Goblin
   position: X,Y
   ```

7. Run `status` and confirm that `mini-001` contains the new Roll20 position.

## Manual validation result

All SPIKE 002 acceptance criteria were validated manually against the current
Roll20 interface in Chrome, with the campaign open as GM.

- [x] Bind a simulated physical miniature to a Roll20 token.
- [x] Move the miniature from the Table Engine and move the token in Roll20.
- [x] Correlate the returning event with `commandId` and
  `origin: "local-command"`.
- [x] Suppress the local confirmation as a false `REMOTE_MOVE`.
- [x] Detect a later manual Roll20 movement with `origin: "roll20"`.
- [x] Update the in-memory miniature position from the remote movement.

The validated binding was:

```text
miniature: mini-001
token: -P36gB08wsrxpoF58JMk
token name: Goblin
```

For the Table Engine to Roll20 direction, this command was tested:

```text
place mini-001 1015 735
```

It generated command ID `53c24f90-8332-4fab-a95e-63d08db6c2cc`. The SPIKE 002
browser bridge applied the movement and reported the Goblin at `1015,735` with
`origin: "local-command"` and the same command ID. The server emitted
`LOCAL_MOVE_CONFIRMED`; it did not emit a false `REMOTE_MOVE`.

For the Roll20 to Table Engine direction, the Goblin was then dragged manually
to `455,1085`. The browser bridge reported `origin: "roll20"`, and the Table
Engine updated `mini-001` to `455,1085` as a remote movement.

These results validate the in-memory binding, both movement directions,
explicit event origin, command correlation, and echo suppression required by
SPIKE 002.

## Out of scope and known limitations

- `place` coordinates are temporarily Roll20 world-space `left`/`top`, not
  physical, viewport, or projection coordinates.
- Bindings and positions are in memory only.
- The active Roll20 page is fixed when the browser bridge starts.
- Pending command IDs are memory-only and expire after ten seconds.
- A failed Roll20 delivery is not retried or queued.
- Only one miniature may own a token; rebinding a token already owned by a
  different miniature returns a controlled error.
- ArUco, camera, NFC, calibration, projection, UI, authentication, and other VTT
  implementations remain outside this spike.
