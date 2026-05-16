# Architecture

This document describes how the pieces of The Parlor fit together at runtime.

## System overview

```
                ┌────────────────────────┐
                │   Browser (any client) │
                │  - React UI            │
                │  - PartyKit WebSocket  │
                │  - LiveKit WebRTC      │
                └───────────┬────────────┘
                            │
              ┌─────────────┼──────────────┐
              │             │              │
              ▼             ▼              ▼
   ┌───────────────┐  ┌─────────────┐  ┌─────────────┐
   │    Render     │  │  PartyKit   │  │  LiveKit    │
   │ (static site, │  │ (one Party  │  │ (WebRTC SFU)│
   │  index.html + │  │  per room — │  │             │
   │  JS bundle)   │  │  WS + HTTP) │  │             │
   └───────────────┘  └─────────────┘  └─────────────┘
       initial load        game state       voice audio
```

Three independent services. Failure isolation: voice can go down without affecting the game; the game can hiccup without affecting voice; if Render is down, the app doesn't load at all but rooms already open keep working.

## Components

### Frontend (`src/`)

A single-page React app built with Vite. Two routes:

- `/` — `Landing.tsx`: enter your name, create or join a room.
- `/room/:code` — `Room.tsx`: lobby, gameplay, voice integration.

No state-management library. State lives in:
- React component state (transient UI)
- `localStorage` (player identity and name, persisted across sessions)
- The server (everything else)

### Real-time backend (`party/server.ts`)

A single PartyKit server class, `ShitheadParty`, that handles **both** WebSocket gameplay and an HTTP voice-token endpoint. PartyKit gives us one of these per room code; instances hibernate when idle and rehydrate from storage on next access.

It imports the game engine from `src/lib/game.ts` directly — same TypeScript file, both client and server. That's the only file shared across the boundary.

### Game engine (`src/lib/game.ts`)

Pure functions over `GameState`. No I/O, no React, no PartyKit imports. Every action — `applyPlay`, `applyPickup`, `applySwap`, `dealGame`, `startPlay` — is a deterministic transform.

This is the most important constraint in the codebase. It lets us:
- Run the engine on the server as the authority.
- Reuse the same code client-side for optimistic UI hints.
- Test the engine in isolation, no mocks (see [TESTING.md](TESTING.md)).

### Voice (LiveKit Cloud)

We use LiveKit Cloud as a black box. The PartyKit server mints short-lived (4h) JWTs that grant access to a per-room LiveKit room named `shithead-{ROOM_CODE}`. Clients connect to LiveKit directly with the token — no audio flows through PartyKit.

See [VOICE.md](VOICE.md) for the token flow and integration details.

## Data flow: a single play

A high-level trace of one player playing a card:

1. **Client UI** — player taps a card → `handlePlay()` collects selected card ids → `socket.send({ type: "play", cardIds })`.
2. **PartyKit server** receives the message → looks up the player by connection id → calls `applyPlay(state, playerId, cardIds)`.
3. If the engine returns an error, the server replies *only to the sender* with `{ type: "error", error }`.
4. If the engine returns new state, the server persists it (`room.storage.put`) and broadcasts to all connections.
5. **Broadcast** is personalized — each client gets a masked `viewFor(playerId)` snapshot where other players' hands and face-down cards are replaced with placeholders.
6. **All clients** receive `{ type: "state", state, you, ready }` and re-render.

Average round-trip latency: ~50–150ms depending on geography. Voice operates on a totally separate WebRTC path with much lower latency.

## State authority

The server is the single source of truth. Clients never compute their own next state — they wait for the broadcast. This trades a small latency cost for:

- **No cheating.** A modified client can't fake a play because the server re-validates with `canPlayOn`.
- **No divergence.** If two clients send conflicting actions, the server resolves the order deterministically.
- **Trivial reconnect.** A reconnecting client just re-receives the current state.

## Persistence

PartyKit gives each room a key-value storage. We use one key: `state`. Every successful action calls `save()` which writes the full state. Reads happen on `onStart`, which fires when the Party wakes up from hibernation.

There is no global database. Rooms are isolated.

When a room is unused for an extended period (PartyKit's hibernation policy), the in-memory Party instance is shut down. On next access, a new instance spins up and restores state from storage. To the user this is invisible — at worst there's a few-hundred-ms delay on the first WebSocket message.

## Deployment topology

| Service | Trigger | What it ships |
|---|---|---|
| **Render** | `git push origin main` | Static files in `dist/` (Vite build output) |
| **PartyKit** | `npm run deploy:party` (manual) | `party/server.ts` + everything it imports (including `src/lib/game.ts`) |
| **LiveKit** | — | Already running (cloud service) |

### When to redeploy PartyKit

You **must** run `npm run deploy:party` when any of the following change:

- `party/server.ts` — the server itself.
- `src/lib/game.ts` — the shared engine. The client picks this up automatically on the next Render deploy, but the server keeps running the old version until you push.
- `partykit.json` — PartyKit deployment config.
- A backend dependency (`partykit`, `livekit-server-sdk`).
- A PartyKit env var (`npx partykit env add KEY VALUE`) — the var takes effect only after the next deploy.

You **don't** need to redeploy PartyKit for:

- UI tweaks (CSS, layout, copy)
- New pages or frontend-only routes
- Frontend-only dep upgrades
- Test changes (they don't ship at all)

### A common skew bug to avoid

If you change a rule in `src/lib/game.ts` and only push (no PartyKit deploy), the client UI will reflect the new rule (because Render auto-deploys), but the server will keep enforcing the old rule. Plays the new client thinks are legal will be rejected by the server with confusing error messages. **Always redeploy PartyKit alongside engine changes.**

## Why not auto-deploy PartyKit?

We could add a GitHub Actions step that runs `partykit deploy` on push to `main` — see the README's roadmap notes. It's not in place because:
- It requires a `PARTYKIT_LOGIN` token stored as a GitHub Actions secret.
- "Push to deploy backend" is a sharper foot-gun than for frontend; a broken commit can take down all rooms instantly.

For a more mature project this would be worth turning on. For now the manual step is a deliberate speed bump.

## Anti-cheat boundary

There is exactly one place in the code where client-visible state is filtered: `ShitheadParty.viewFor()` in `party/server.ts`. It:

- Replaces other players' `hand` and `faceDown` cards with placeholder cards of unknown suit, rank 0, and a hidden id (`hidden-{realId}`).
- Returns `deck: []` so the client only knows whether the deck is non-empty, not what's in it.

If you add a new field to `GameState` that should be hidden, **add the redaction here**. This is the only firewall.

## Reconnection model

- The client persists `playerId` (random, generated on first visit) in localStorage.
- On socket open, the client sends `{ type: "join", playerId, name }`.
- The server looks up `playerId`:
  - **Match found** → restore the seat, mark `connected: true`.
  - **No match, lobby phase, room not full** → seat them.
  - **No match, game in progress** → reject with `{ type: "error", error: "Room full or game in progress" }`.

Disconnect (`onClose`) sets `connected: false` but **does not remove the player from `state.players`**. Their cards and turn position are preserved. Voice connections are entirely separate and don't affect this.

## Why this stack

A short rationale for the choices, since they may look unusual:

- **PartyKit** instead of a custom Node server because it gives us per-room isolation, automatic websocket handling, persistence, and a generous free tier without managing infra.
- **LiveKit Cloud** instead of self-hosted WebRTC because audio is hard and LiveKit's free tier (10k participant-min/mo) covers indie use.
- **Render static site** instead of Vercel because Render's free tier doesn't sleep, and the rewrite rules are simpler for SPAs.
- **No global database** because the game state per room is small (<10KB), short-lived, and naturally partitioned by room code. PartyKit room storage is plenty.
- **No state-management library** because the server is the source of truth and the client's job is to render one snapshot at a time. Redux/Zustand would be overhead.

## Future extensions

Possible directions, none currently implemented:

- **Persistent stats per group** — keyed on `{roomCode, playerId}` so a friend group accumulates stats over many sessions, no accounts needed.
- **PWA manifest** for "Add to Home Screen" on mobile.
- **More games** — extend the engine pattern (pure functions, shared between client/server) to other shedding games or party games.
- **Spectator mode** — connections without seats that receive masked state.
