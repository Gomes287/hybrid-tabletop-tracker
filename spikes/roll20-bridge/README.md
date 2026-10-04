# SPIKE 001 — Roll20 browser bridge

This spike proves bidirectional communication between the Roll20 page open in the
Game Master's browser and a local Node.js process.

```text
Roll20 Campaign models <-> browser bridge <-> WebSocket <-> local Node.js CLI
```

It deliberately uses the Roll20 `Campaign` object already validated manually.
This is an experiment against an internal page API, so Roll20 may change it
without notice.

## Requirements

- Node.js 18 or newer
- npm
- Chrome with a Roll20 campaign open as GM

## Start the local server

From the repository root:

```bash
npm install
npm run spike:server
```

Expected startup output:

```text
Hybrid Tabletop — Roll20 Bridge Spike
WebSocket listening on ws://127.0.0.1:8765
Waiting for Roll20...
```

## Start the browser bridge

1. Open the Roll20 campaign and the page to test.
2. Open Chrome DevTools and select the Console.
3. Copy the complete contents of `spikes/roll20-bridge/browser-bridge.js`.
4. Paste it in the Console and press Enter.

Chrome may require typing `allow pasting` before it accepts pasted Console code.
The bridge connects only to `ws://127.0.0.1:8765` and watches the tokens currently
in `Campaign.activePage().thegraphics`. It also watches tokens added to that
collection later.

Re-running the script is safe: it stops the previous socket, removes its token
and collection listeners, and replaces the bridge instance.

## Test Roll20 -> local

Move a token on the active Roll20 page. The browser should log:

```text
[HTT] Goblin moved: 595,735
```

The terminal should receive the corresponding `TOKEN_MOVED` event and token
details.

## Test local -> Roll20

In the same terminal in which the server is running, enter:

```text
move -P36gB08wsrxpoF58JMk 665 735
```

The server sends a `MOVE_TOKEN` message to every connected browser bridge. The
bridge finds the token by ID, calls `set({ left, top })`, and then calls `save()`.

Invalid commands print usage information, and a command entered without an open
Roll20 connection is not queued.

## Manual validation result

All acceptance criteria for SPIKE 001 were validated manually against the
current Roll20 interface in Chrome, with the campaign open as GM.

- The browser bridge watched the existing Goblin token and connected to the
  local WebSocket server.
- Moving the Goblin manually in Roll20 produced `TOKEN_MOVED` messages at
  `805,735` and `875,735`, including the expected token ID, name, and page ID.
- Running `move -P36gB08wsrxpoF58JMk 945 735` in the server CLI produced a
  `MOVE_TOKEN` message, which the browser bridge received.
- The Goblin moved visually in Roll20 to `945,735`.

Validated Roll20 identifiers:

```text
Token ID: -P36gB08wsrxpoF58JMk
Token name: Goblin
Page ID: -OtUSoN66S_kJa71wOSo
```

### Known echo behavior

When a `MOVE_TOKEN` command changes a token through `token.set()` and
`token.save()`, the same token's `left`/`top` listener observes that change and
sends a new `TOKEN_MOVED` message back to the local server. For example, the
command that moved the Goblin to `945,735` was followed by a `TOKEN_MOVED` event
for `945,735`.

This echo is expected in the current spike and does not invalidate the
bidirectional communication result. SPIKE 001 does not attempt to suppress it or
track event origin; that concern is intentionally deferred.

## Next architectural concerns

- Prevent movement echo loops or attach origin/correlation metadata to events.
- Handle changes to the active Roll20 page after the bridge starts.
- Define and persist the binding between a physical miniature and a Roll20
  token.
- Transform calibrated physical/tabletop coordinates into Roll20 coordinates.

ArUco tracking remains separate and is not integrated by this spike.

## Stop and restart

Press Ctrl+C to stop the server. The browser bridge retries its local WebSocket
connection every two seconds. To stop the bridge explicitly in DevTools:

```js
window.__HTTRoll20Bridge.stop();
```

This spike has no Chrome extension, userscript, UI, tracker integration, or
coordinate mapping. Those concerns are intentionally outside SPIKE 001.
