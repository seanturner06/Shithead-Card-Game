/**
 * @file PartyKit server for The Parlor.
 *
 * One server class handles two distinct transports for a given room:
 *
 * - **WebSocket gameplay** — clients open a websocket via `partysocket`, send
 *   {@link ClientMessage} actions, and receive personalized state snapshots
 *   ({@link ServerMessage}). State is server-authoritative; the client never
 *   computes its own next state.
 *
 * - **HTTP voice-token endpoint** — `POST /parties/main/{ROOM_CODE}/voice-token`
 *   mints a LiveKit JWT bound to the LiveKit room `shithead-{ROOM_CODE}`.
 *   Voice is a parallel channel — game state and voice never share data.
 *
 * Persistence: the full {@link GameState} is written to PartyKit room
 * storage on every mutation, so a cold restart (or PartyKit pushing the room
 * back from idle) restores the in-flight game.
 *
 * Required environment variables (set via `npx partykit env add`):
 * - `LIVEKIT_API_KEY`
 * - `LIVEKIT_API_SECRET`
 * - `LIVEKIT_URL` — `wss://...livekit.cloud`
 *
 * If any are missing, the voice endpoint returns 500. Gameplay still works.
 */

import type * as Party from "partykit/server";
import { AccessToken } from "livekit-server-sdk";
import {
  createInitialState,
  dealGame,
  startPlay,
  applySwap,
  applyPlay,
  applyPickup,
  type GameState,
} from "../src/lib/game";

/**
 * Action messages sent by the client over the websocket.
 *
 * The server is authoritative — it re-validates every action against the
 * current state. Unknown types are silently dropped.
 *
 * - `join` — sent once on socket open. Seats the player or restores an
 *   existing seat by `playerId` (which the client persists in localStorage).
 *   On a fresh room the first joiner becomes the host.
 * - `deal` — host only. Moves the room from `lobby` → `swap`.
 * - `swap` — swap one hand card with one face-up card during the swap phase.
 * - `ready` — mark this player as ready. When everyone is ready, the server
 *   calls `startPlay` and moves into the `playing` phase.
 * - `play` — play one or more same-rank cards (from hand, face-up, or
 *   face-down). The server validates legality.
 * - `pickup` — current player takes the whole pile.
 * - `newGame` — host only. Resets the room back to `lobby` with the same
 *   players seated.
 */
type ClientMessage =
  | { type: "join"; playerId: string; name: string }
  | { type: "deal" }
  | { type: "swap"; handCardId: string; faceUpCardId: string }
  | { type: "ready" }
  | { type: "play"; cardIds: string[] }
  | { type: "pickup" }
  | { type: "newGame" };

/**
 * One PartyKit "Party" instance per room code. PartyKit spins these up on
 * demand and may hibernate them when idle — `onStart` rehydrates state from
 * storage when that happens.
 *
 * Each connected client has a `Party.Connection` with a unique `conn.id`.
 * We track the `connectionId → playerId` mapping in memory only — it's safe
 * to lose on restart because the next `join` message will re-establish it
 * from the client's persisted `playerId`.
 */
export default class ShitheadParty implements Party.Server {
  /** Full game state. `null` until the first player joins. */
  state: GameState | null = null;

  /** In-memory map from websocket connection id → playerId. Rebuilt on reconnect. */
  connectionToPlayer = new Map<string, string>();

  /** Players who have hit "Ready" in the current swap phase. Cleared on deal/restart. */
  readyPlayers = new Set<string>();

  constructor(readonly room: Party.Room) {}

  /** Restore persisted state if the room is waking up from hibernation. */
  async onStart() {
    const saved = await this.room.storage.get<GameState>("state");
    if (saved) this.state = saved;
  }

  /** Persist the current state. Called after every mutation. */
  async save() {
    if (this.state) await this.room.storage.put("state", this.state);
  }

  // ─────────────────────────────────────────────────────────────
  // HTTP: Voice token endpoint
  // ─────────────────────────────────────────────────────────────

  /**
   * Handle HTTP requests to `/parties/main/{ROOM_CODE}/voice-token`.
   *
   * Responds to:
   * - `OPTIONS` — CORS preflight.
   * - `POST` with JSON body `{ identity, name }` — mints a LiveKit JWT scoped
   *   to the room `shithead-{ROOM_CODE}` with publish + subscribe grants.
   *   TTL is 4h, which comfortably outlasts any session.
   *
   * Secrets stay server-side: the LiveKit API key/secret are read from
   * `this.room.env` (set via PartyKit env) and never returned to the client.
   */
  async onRequest(req: Party.Request) {
    if (req.method === "OPTIONS") {
      return new Response(null, {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

    const apiKey = (this.room.env as any).LIVEKIT_API_KEY as string | undefined;
    const apiSecret = (this.room.env as any).LIVEKIT_API_SECRET as string | undefined;
    const livekitUrl = (this.room.env as any).LIVEKIT_URL as string | undefined;

    if (!apiKey || !apiSecret || !livekitUrl) {
      return Response.json({ error: "Voice not configured" }, { status: 500, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const body = (await req.json()) as { identity: string; name: string };
    if (!body.identity || !body.name) {
      return Response.json({ error: "Missing identity or name" }, { status: 400, headers: { "Access-Control-Allow-Origin": "*" } });
    }

    const at = new AccessToken(apiKey, apiSecret, { identity: body.identity, name: body.name, ttl: "4h" });
    at.addGrant({ room: `shithead-${this.room.id}`, roomJoin: true, canPublish: true, canSubscribe: true });
    const token = await at.toJwt();

    return Response.json({ token, url: livekitUrl }, { headers: { "Access-Control-Allow-Origin": "*" } });
  }

  // ─────────────────────────────────────────────────────────────
  // WebSocket: Gameplay
  // ─────────────────────────────────────────────────────────────

  /**
   * Send each connected client a personalized state snapshot.
   *
   * Personalized because every client sees a different view: their own hand
   * and face-down cards in cleartext, every opponent's hand and face-down
   * cards masked. See {@link viewFor}.
   */
  broadcast() {
    if (!this.state) return;
    for (const conn of this.room.getConnections()) {
      const playerId = this.connectionToPlayer.get(conn.id);
      const view = this.viewFor(playerId);
      conn.send(JSON.stringify({ type: "state", state: view, you: playerId, ready: Array.from(this.readyPlayers) }));
    }
  }

  /**
   * Produce a personalized view of the game state for `playerId`.
   *
   * Masks every other player's hand and face-down cards by replacing each
   * card with a placeholder of unknown suit (`?`), rank 0, and a hidden id.
   * The client still receives an array of the correct **length**, so it can
   * render the right number of card backs without learning the actual cards.
   *
   * Also returns `deck: []`. The client only needs to know whether the deck
   * is empty (so it can hide the deck stack); content is irrelevant.
   *
   * Important: this is an anti-cheat boundary. Anything sensitive must be
   * stripped here — there is no other place that filters state before it
   * leaves the server.
   */
  viewFor(playerId: string | undefined): GameState {
    if (!this.state) return this.state!;
    const players = this.state.players.map((p) => {
      if (p.id === playerId) return p;
      return {
        ...p,
        hand: p.hand.map((c) => ({ ...c, s: "?" as any, r: 0, id: `hidden-${c.id}` })),
        faceDown: p.faceDown.map((c) => ({ ...c, s: "?" as any, r: 0, id: `hidden-${c.id}` })),
      };
    });
    return { ...this.state, players, deck: [] as any };
  }

  onConnect(_conn: Party.Connection, _ctx: Party.ConnectionContext) {}

  /**
   * Route an incoming client message to the appropriate engine call.
   *
   * Every successful mutation calls `save()` then `broadcast()`. Errors are
   * sent only to the offending sender as `{ type: "error", error: string }`;
   * other clients see no change.
   */
  onMessage(message: string, sender: Party.Connection) {
    let msg: ClientMessage;
    try { msg = JSON.parse(message); } catch { return; }

    switch (msg.type) {
      case "join": {
        if (!this.state) {
          // First connection to a brand-new room — this player becomes the host.
          this.state = createInitialState(msg.playerId, msg.name);
        } else {
          const existing = this.state.players.find((p) => p.id === msg.playerId);
          if (existing) {
            // Reconnect — restore the seat with a fresh name (in case they renamed).
            existing.connected = true;
            existing.name = msg.name;
          } else if (this.state.phase === "lobby" && this.state.players.length < 4) {
            // New seat in an open lobby. Max 4 players.
            this.state.players.push({ id: msg.playerId, name: msg.name, hand: [], faceUp: [], faceDown: [], finished: false, connected: true });
          } else {
            // Game in progress and this player wasn't already seated — reject.
            sender.send(JSON.stringify({ type: "error", error: "Room full or game in progress" }));
            return;
          }
        }
        this.connectionToPlayer.set(sender.id, msg.playerId);
        this.save(); this.broadcast();
        break;
      }
      case "deal": {
        if (!this.state) return;
        const playerId = this.connectionToPlayer.get(sender.id);
        if (playerId !== this.state.hostId) return;
        if (this.state.players.length < 2) {
          sender.send(JSON.stringify({ type: "error", error: "Need at least 2 players" }));
          return;
        }
        this.state = dealGame(this.state);
        this.readyPlayers.clear();
        this.save(); this.broadcast();
        break;
      }
      case "swap": {
        if (!this.state || this.state.phase !== "swap") return;
        const playerId = this.connectionToPlayer.get(sender.id);
        if (!playerId) return;
        this.state = applySwap(this.state, playerId, msg.handCardId, msg.faceUpCardId);
        this.save(); this.broadcast();
        break;
      }
      case "ready": {
        if (!this.state || this.state.phase !== "swap") return;
        const playerId = this.connectionToPlayer.get(sender.id);
        if (!playerId) return;
        this.readyPlayers.add(playerId);
        // When every seated player is ready, start play.
        if (this.readyPlayers.size === this.state.players.length) {
          this.state = startPlay(this.state);
          this.readyPlayers.clear();
        }
        this.save(); this.broadcast();
        break;
      }
      case "play": {
        if (!this.state || this.state.phase !== "playing") return;
        const playerId = this.connectionToPlayer.get(sender.id);
        if (!playerId) return;
        const result = applyPlay(this.state, playerId, msg.cardIds);
        if (result.error) {
          sender.send(JSON.stringify({ type: "error", error: result.error }));
          return;
        }
        this.state = result.state;
        this.save(); this.broadcast();
        break;
      }
      case "pickup": {
        if (!this.state || this.state.phase !== "playing") return;
        const playerId = this.connectionToPlayer.get(sender.id);
        if (!playerId) return;
        const result = applyPickup(this.state, playerId);
        if (result.error) {
          sender.send(JSON.stringify({ type: "error", error: result.error }));
          return;
        }
        this.state = result.state;
        this.save(); this.broadcast();
        break;
      }
      case "newGame": {
        if (!this.state) return;
        const playerId = this.connectionToPlayer.get(sender.id);
        if (playerId !== this.state.hostId) return;
        // Keep all seated players, reset their card piles, and snap back to lobby.
        const host = this.state.players.find((p) => p.id === this.state!.hostId)!;
        this.state = {
          ...createInitialState(this.state.hostId, host.name),
          players: this.state.players.map((p) => ({ ...p, hand: [], faceUp: [], faceDown: [], finished: false })),
        };
        this.readyPlayers.clear();
        this.save(); this.broadcast();
        break;
      }
    }
  }

  /**
   * Mark the disconnecting player as offline and broadcast.
   *
   * We deliberately do *not* remove them from `state.players` — they keep
   * their seat and cards. If they reconnect (same `playerId` from
   * localStorage), they pick up exactly where they left off.
   */
  onClose(conn: Party.Connection) {
    const playerId = this.connectionToPlayer.get(conn.id);
    this.connectionToPlayer.delete(conn.id);
    if (playerId && this.state) {
      const p = this.state.players.find((pl) => pl.id === playerId);
      if (p) p.connected = false;
      this.save(); this.broadcast();
    }
  }
}

ShitheadParty satisfies Party.Worker;
