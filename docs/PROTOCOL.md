# Client ↔ Server Protocol

The PartyKit server in `party/server.ts` exposes **two** transports:

1. **WebSocket** — gameplay actions and state broadcasts.
2. **HTTP POST** — voice token minting (see also [VOICE.md](VOICE.md)).

This document describes both.

## Connection

Clients connect to `wss://{PARTYKIT_HOST}/parties/main/{ROOM_CODE}` (handled by the `partysocket` library — `usePartySocket({ host, room })`).

The PartyKit room name is the case-uppercased 4-letter code (e.g. `ABCD`). PartyKit guarantees that all clients pointing at the same room name reach the same server instance.

## Client → Server messages

All messages are JSON-encoded over the WebSocket. The discriminator is the `type` field. The server silently drops any message it can't parse or doesn't recognize.

### `join`

```ts
{ type: "join"; playerId: string; name: string }
```

Sent immediately on socket open. The `playerId` is the per-browser stable id from localStorage; `name` is what the user typed on the landing page.

Behavior:
- **Brand-new room** (`state === null`): this player becomes the host. State is initialized via `createInitialState`.
- **Existing room, same `playerId`**: this is a reconnect. `connected` is set back to true; `name` is refreshed in case the user renamed.
- **Existing room, new `playerId`, lobby phase, < 4 seats**: seated as a new player.
- **Existing room, new `playerId`, otherwise**: rejected. Sender receives:
  ```ts
  { type: "error"; error: "Room full or game in progress" }
  ```

### `deal`

```ts
{ type: "deal" }
```

Host-only. Moves the room from `lobby` → `swap`. Each player gets 3/3/3 cards.

Errors (sent only to the sender):
- Not the host → silently ignored.
- < 2 players → `{ type: "error"; error: "Need at least 2 players" }`.

### `swap`

```ts
{ type: "swap"; handCardId: string; faceUpCardId: string }
```

Swap one hand card with one face-up card. Only meaningful during the `swap` phase; otherwise silently ignored.

If either card id is unknown for this player, the swap is a no-op (no error sent).

### `ready`

```ts
{ type: "ready" }
```

Mark this player as ready to start. The server maintains a `readyPlayers: Set<string>`. When every seated player has sent `ready`, the server calls `startPlay` and the phase becomes `playing`.

### `play`

```ts
{ type: "play"; cardIds: string[] }
```

Play one or more cards. The server figures out whether they came from hand, face-up, or face-down based on which zone contains all of them.

Engine errors (any failure case in [GAME_RULES.md](GAME_RULES.md)) are returned only to the sender as:
```ts
{ type: "error"; error: string }
```

Possible error strings (from `applyPlay`):
- `"Not your turn"`
- `"No cards"`
- `"Invalid cards"` — none of hand/faceUp/faceDown contains all the ids
- `"Same rank only"`
- `"Play hand first"` — tried to play face-up while hand non-empty
- `"Play hand and face-up first"` — tried to play face-down while hand or face-up non-empty
- `"Can't play that"` — fails `canPlayOn`

Note: an illegal **face-down** flip is *not* an error — the player picks up the pile + card and the turn passes. All clients see a normal state update.

### `pickup`

```ts
{ type: "pickup" }
```

Take the whole pile. Errors:
- `"Not your turn"`
- `"Nothing to pick up"` — pile is empty

### `newGame`

```ts
{ type: "newGame" }
```

Host-only. Resets the room to `lobby` while keeping all seated players. Each player's `hand`/`faceUp`/`faceDown` are emptied; `finished` is reset to `false`.

Non-hosts sending this are silently ignored.

## Server → Client messages

### `state`

```ts
{
  type: "state";
  state: GameState;       // personalized view, see viewFor
  you: string | undefined; // your playerId
  ready: string[];         // playerIds currently marked ready
}
```

Broadcast after every successful mutation. Each connection receives a different `state` object because `viewFor()` masks data the receiving player shouldn't see.

The `state` payload is a near-complete `GameState`, but:
- Other players' `hand` cards are replaced with placeholders (`s: "?"`, `r: 0`, `id: "hidden-<realId>"`). The array length is preserved.
- Other players' `faceDown` cards are similarly masked.
- The owner's own hand and face-down are sent in cleartext.
- `deck` is always returned as `[]` — clients only need to know it exists / is empty, not its contents. The length doesn't matter for any client logic.

### `error`

```ts
{ type: "error"; error: string }
```

Sent **only to the sender** of an action that the engine rejected. Other clients see no message — the state didn't change for them.

The client displays these as a brief floating message that auto-clears after 2 seconds.

## HTTP: voice token endpoint

### `OPTIONS /parties/main/{ROOM_CODE}/voice-token`

CORS preflight. Returns:

```http
HTTP/1.1 200 OK
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

### `POST /parties/main/{ROOM_CODE}/voice-token`

Request body:
```json
{ "identity": "p_xxxxxxxx", "name": "Sean" }
```

`identity` should be the player's stable `playerId`. `name` is the display name shown to other voice participants.

Successful response (200):
```json
{
  "token": "<LiveKit JWT, valid 4h>",
  "url": "wss://your-project.livekit.cloud"
}
```

The JWT grants `roomJoin`, `canPublish`, and `canSubscribe` in the LiveKit room `shithead-{ROOM_CODE}`.

Error responses:
- `400` `{ "error": "Missing identity or name" }` — body fields missing.
- `405` `"Method not allowed"` — non-POST/OPTIONS.
- `500` `{ "error": "Voice not configured" }` — server is missing one of `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` / `LIVEKIT_URL`. Gameplay still works — only voice is unavailable.

All error responses include `Access-Control-Allow-Origin: *` so they can be read from the browser.

## State machine summary

```
lobby ──(host: deal)──► swap ──(everyone: ready)──► playing ──(only 1 unfinished)──► over
                                                       │
                                                       └─(host: newGame)──► lobby
```

`newGame` is the only transition that can come from `over` or any other phase (host-initiated reset).

## Adding a new message type

If you need to extend the protocol:

1. Add a discriminated variant to `ClientMessage` in `party/server.ts`.
2. Add a `case` in `onMessage`'s `switch`.
3. Validate (phase check, player lookup) and call the engine or mutate state.
4. Always end with `this.save(); this.broadcast();` on success, or `sender.send(... error ...)` on failure.
5. If the engine needs a new pure function, add it to `src/lib/game.ts` and test it.
6. Redeploy PartyKit (`npm run deploy:party`).

If you add new fields to `GameState` that should be hidden from non-owners, **add the redaction to `ShitheadParty.viewFor()`** in `party/server.ts`. That's the only place that filters state before it goes over the wire.
