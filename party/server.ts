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

type ClientMessage =
  | { type: "join"; playerId: string; name: string }
  | { type: "deal" }
  | { type: "swap"; handCardId: string; faceUpCardId: string }
  | { type: "ready" }
  | { type: "play"; cardIds: string[] }
  | { type: "pickup" }
  | { type: "newGame" };

export default class ShitheadParty implements Party.Server {
  state: GameState | null = null;
  connectionToPlayer = new Map<string, string>();
  readyPlayers = new Set<string>();

  constructor(readonly room: Party.Room) {}

  async onStart() {
    const saved = await this.room.storage.get<GameState>("state");
    if (saved) this.state = saved;
  }

  async save() {
    if (this.state) await this.room.storage.put("state", this.state);
  }

  // ============ HTTP: Voice token endpoint ============
  // Same server handles both WebSocket gameplay and HTTP token requests.
  // Hit POST /parties/main/{ROOM_CODE}/voice-token to get a LiveKit token.
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

  // ============ WebSocket: Gameplay ============
  broadcast() {
    if (!this.state) return;
    for (const conn of this.room.getConnections()) {
      const playerId = this.connectionToPlayer.get(conn.id);
      const view = this.viewFor(playerId);
      conn.send(JSON.stringify({ type: "state", state: view, you: playerId, ready: Array.from(this.readyPlayers) }));
    }
  }

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

  onMessage(message: string, sender: Party.Connection) {
    let msg: ClientMessage;
    try { msg = JSON.parse(message); } catch { return; }

    switch (msg.type) {
      case "join": {
        if (!this.state) {
          this.state = createInitialState(msg.playerId, msg.name);
        } else {
          const existing = this.state.players.find((p) => p.id === msg.playerId);
          if (existing) {
            existing.connected = true;
            existing.name = msg.name;
          } else if (this.state.phase === "lobby" && this.state.players.length < 4) {
            this.state.players.push({ id: msg.playerId, name: msg.name, hand: [], faceUp: [], faceDown: [], finished: false, connected: true });
          } else {
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
