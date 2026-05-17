/**
 * @file Room page — multiplayer lobby + active game + voice integration.
 * Mounted at `/room/:code`.
 *
 * Structural layers:
 *
 * 1. **`Room`** — outer wrapper. Bootstraps player identity, fetches a
 *    LiveKit voice token on demand, conditionally wraps in `<LiveKitRoom>`.
 *    Renders the inline {@link NameGate} when no name is stored (cold-link
 *    flow) so the room code in the URL survives.
 *
 * 2. **`GameRoom`** — the real component. Opens the PartyKit websocket,
 *    receives state snapshots, dispatches actions, and renders the lobby +
 *    table views.
 *
 * 3. **Table UI** — imported from `../components/Table`. Shared with the
 *    solo page. Anything voice-specific (`OpponentVoiceLabel`,
 *    `VoiceControls`, `StartAudioGate`) stays here in Room.tsx, and the
 *    multiplayer page passes it into `<Opponent voiceLabel={...} />` as a slot.
 */

import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import usePartySocket from "partysocket/react";
import { LiveKitRoom, useParticipants, useLocalParticipant, useRoomContext, RoomAudioRenderer, useStartAudio } from "@livekit/components-react";
import "@livekit/components-styles";
import type { GameState } from "../lib/game";
import { getPlayerName, setPlayerName } from "../lib/playerName";
import {
  type SwapPick,
  type SwapZone,
  Opponent,
  DeckStack,
  PileStack,
  PlayerArea,
  RulesModal,
  ShitheadModal,
} from "../components/Table";

/**
 * PartyKit host. In production this is set via the `VITE_PARTYKIT_HOST`
 * environment variable at build time (e.g. `shithead-party.YOURNAME.partykit.dev`).
 * Local dev defaults to PartyKit's local dev server on port 1999.
 */
const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";

/**
 * Get a stable per-browser player id, generating one if this is the first visit.
 *
 * Persisted to localStorage so a reload or wifi drop preserves the same
 * identity — the server restores the seat by matching `playerId` on `join`.
 */
const getOrCreatePlayerId = () => {
  let id = localStorage.getItem("playerId");
  if (!id) {
    id = `p_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("playerId", id);
  }
  return id;
};

/**
 * Outer Room component. Handles player identity, voice token fetching, and
 * conditional wrapping in the LiveKit provider.
 *
 * Cold-link path: if no name is stored, render an inline name gate on this
 * same URL so the room code in the link survives. Only once the user submits
 * a name do we mount `GameRoom` and open the websocket.
 */
export default function Room() {
  const { code } = useParams<{ code: string }>();
  const roomCode = (code || "").toUpperCase();
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [needsName, setNeedsName] = useState(false);
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceConnected, setVoiceConnected] = useState(false);

  useEffect(() => {
    const stored = getPlayerName();
    if (!stored) {
      setNeedsName(true);
      return;
    }
    // Touch the timestamp so an active session doesn't expire mid-game.
    setPlayerName(stored);
    setName(stored);
    setPlayerId(getOrCreatePlayerId());
  }, []);

  const commitName = (chosen: string) => {
    const trimmed = chosen.trim().slice(0, 16);
    if (!trimmed) return;
    setPlayerName(trimmed);
    setName(trimmed);
    setPlayerId(getOrCreatePlayerId());
    setNeedsName(false);
  };

  const requestVoice = async () => {
    if (!playerId || !name) return;
    const protocol = PARTYKIT_HOST.includes("localhost") || PARTYKIT_HOST.includes("127.0.0.1") ? "http" : "https";
    try {
      const res = await fetch(`${protocol}://${PARTYKIT_HOST}/parties/main/${roomCode}/voice-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ identity: playerId, name }),
      });
      const data = await res.json();
      if (data.token && data.url) {
        setVoiceToken(data.token);
        setVoiceUrl(data.url);
      } else {
        alert(data.error || "Voice unavailable");
      }
    } catch (err) {
      alert("Voice connection failed");
    }
  };

  if (needsName) return <NameGate roomCode={roomCode} onSubmit={commitName} />;
  if (!playerId || !name) return null;

  const inner = <GameRoom code={roomCode} playerId={playerId} name={name} voiceConnected={voiceConnected} onRequestVoice={requestVoice} />;

  if (voiceToken && voiceUrl) {
    return (
      <LiveKitRoom token={voiceToken} serverUrl={voiceUrl} connect audio video={false} onConnected={() => setVoiceConnected(true)} onDisconnected={() => setVoiceConnected(false)} className="contents">
        <RoomAudioRenderer />
        <StartAudioGate />
        {inner}
      </LiveKitRoom>
    );
  }
  return inner;
}

/**
 * Workaround for iOS Safari's audio-after-gesture requirement.
 *
 * iOS won't auto-play remote audio tracks until the user has tapped *something*
 * after page load. `useStartAudio` reports whether playback is currently
 * allowed; if not, we render a floating "Tap to Enable Audio" button that
 * unlocks it. Once `canPlayAudio` is true the button unmounts.
 */
function StartAudioGate() {
  const room = useRoomContext();
  const { mergedProps, canPlayAudio } = useStartAudio({ room, props: {} });
  if (canPlayAudio) return null;
  return (
    <button
      {...mergedProps}
      className="fixed inset-x-0 bottom-20 mx-auto z-[60] px-6 py-3 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold w-max active:scale-95 transition shadow-2xl"
      style={{ boxShadow: "0 0 40px rgba(255, 200, 100, 0.5)" }}
    >
      Tap to Enable Audio
    </button>
  );
}

/**
 * Inline name input shown when someone hits `/room/:code` with no stored name
 * (the cold-link path). The room code stays in the URL, so there's no bounce
 * back to landing — the user types a name once and lands directly in the room.
 */
function NameGate({ roomCode, onSubmit }: { roomCode: string; onSubmit: (name: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255, 200, 100, 0.12) 0%, transparent 50%)" }} />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-amber-100/60 text-xs tracking-[0.4em] uppercase mb-2">The Parlor</div>
          <h1 className="text-amber-100 text-4xl italic" style={{ textShadow: "0 0 40px rgba(255, 200, 100, 0.3)" }}>Join Room</h1>
          <div className="text-amber-100/70 text-3xl tracking-[0.3em] italic mt-3">{roomCode}</div>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSubmit(value); }}
          className="space-y-3"
        >
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.slice(0, 16))}
            placeholder="Your name"
            autoFocus
            className="w-full bg-stone-900/60 border border-amber-100/20 text-amber-50 px-4 py-3 rounded-sm focus:outline-none focus:border-amber-200/60 placeholder:text-amber-100/30"
          />
          <button
            type="submit"
            disabled={!value.trim()}
            className="w-full bg-amber-100 text-stone-900 px-4 py-3 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition"
          >
            Join Game
          </button>
        </form>
      </motion.div>
    </div>
  );
}

type GameRoomProps = {
  code: string;
  playerId: string;
  name: string;
  voiceConnected: boolean;
  onRequestVoice: () => void;
};

/**
 * Inner game component. Owns the websocket and renders the active room view.
 *
 * State responsibilities:
 * - `state` — last server snapshot. Treat as read-only; never mutate locally.
 *   The server is authoritative — to change anything, call `send(...)`.
 * - `selected` — card ids the player has tapped in their hand, ready to play.
 *   Same-rank only (enforced by `toggleSelect`).
 * - `swapPick` — during swap phase, which hand and which face-up card are
 *   pending the swap. When both are set, the effect below sends the swap.
 * - `flash` / `error` — transient UI overlays. Auto-clear via setTimeout.
 * - `joinError` — sticky terminal error (room full / game in progress).
 *   Distinguishes itself from `error` because the join itself failed, so we
 *   show a recoverable screen instead of "CONNECTING..." forever.
 */
function GameRoom({ code, playerId, name, voiceConnected, onRequestVoice }: GameRoomProps) {
  const nav = useNavigate();
  const [state, setState] = useState<GameState | null>(null);
  const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [swapPick, setSwapPick] = useState<SwapPick>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [showRules, setShowRules] = useState(false);
  // Tracks whether we've ever received a `state` snapshot. An error received
  // before the first state means the join itself failed (room full / game in
  // progress) — that's terminal, not a transient action error.
  const hasReceivedStateRef = useRef(false);

  const socket = usePartySocket({
    host: PARTYKIT_HOST,
    room: code,
    onOpen() {
      socket.send(JSON.stringify({ type: "join", playerId, name }));
    },
    onMessage(e) {
      try {
        const msg = JSON.parse(e.data);
        if (msg.type === "state") {
          hasReceivedStateRef.current = true;
          setState(msg.state);
          setReadyPlayers(msg.ready || []);
          if (msg.state.lastEvent?.type === "burn") triggerFlash("BURN");
          else if (msg.state.lastEvent?.type === "reset") triggerFlash("RESET");
          else if (msg.state.lastEvent?.type === "pickup") triggerFlash("PICK UP");
        } else if (msg.type === "error") {
          if (hasReceivedStateRef.current) {
            setError(msg.error);
            setTimeout(() => setError(null), 2000);
          } else {
            setJoinError(msg.error);
          }
        }
      } catch {}
    },
  });

  const send = (msg: unknown) => socket.send(JSON.stringify(msg));
  const triggerFlash = (t: string) => { setFlash(t); setTimeout(() => setFlash(null), 1300); };

  useEffect(() => {
    if (swapPick.hand && swapPick.faceUp) {
      send({ type: "swap", handCardId: swapPick.hand, faceUpCardId: swapPick.faceUp });
      setSwapPick({});
    }
  }, [swapPick]);

  const copyCode = () => {
    navigator.clipboard?.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (joinError) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
        <div className="text-center space-y-5 max-w-xs">
          <div className="text-amber-100/60 text-[10px] tracking-[0.5em] uppercase">Can't Join</div>
          <div className="text-amber-100 text-xl italic">{joinError}</div>
          <button onClick={() => nav("/")} className="px-6 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.3em] text-xs uppercase font-semibold active:scale-95 transition">
            Back Home
          </button>
        </div>
      </div>
    );
  }

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
        <div className="text-amber-100/60 text-sm tracking-widest">CONNECTING...</div>
      </div>
    );
  }

  const me = state.players.find((p) => p.id === playerId);
  const opponents = state.players.filter((p) => p.id !== playerId);
  const isHost = state.hostId === playerId;
  const isMyTurn = state.currentPlayerId === playerId;
  const loser = state.loserId ? state.players.find((p) => p.id === state.loserId) : null;
  const youLost = loser?.id === playerId;

  const toggleSelect = (cardId: string) => {
    if (!me) return;
    // The active selection zone is hand if the hand has any cards, otherwise
    // face-up. The engine forbids face-up plays while the hand is non-empty,
    // so this matches what the server will actually accept.
    const zone = me.hand.length > 0 ? me.hand : me.faceUp;
    const card = zone.find((c) => c.id === cardId);
    if (!card) return;
    if (selected.includes(cardId)) setSelected(selected.filter((id) => id !== cardId));
    else {
      const firstSelId = selected[0];
      const firstSel = firstSelId ? zone.find((c) => c.id === firstSelId) : undefined;
      if (!firstSel || firstSel.r === card.r) setSelected([...selected, cardId]);
      else setSelected([cardId]);
    }
  };

  const handleSwapTap = (zone: SwapZone, id: string) => {
    if (state.phase !== "swap") return;
    setSwapPick((s) => ({
      ...s,
      [zone]: s[zone] === id ? undefined : id,
    }));
  };

  const handlePlayFaceDown = (id: string) => {
    if (!me || me.hand.length > 0 || me.faceUp.length > 0 || !isMyTurn) return;
    send({ type: "play", cardIds: [id] });
  };

  const handlePlay = () => {
    if (selected.length === 0) return;
    send({ type: "play", cardIds: selected });
    setSelected([]);
  };

  const handleNewGame = () => {
    send({ type: "newGame" });
  };

  return (
    <div className="min-h-screen w-full overflow-hidden relative" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255, 200, 100, 0.12) 0%, transparent 50%)" }} />

      <div
        className="relative z-10 flex flex-col h-screen max-w-md mx-auto"
        style={{
          paddingTop: "max(0.5rem, env(safe-area-inset-top))",
          paddingBottom: "max(0.5rem, env(safe-area-inset-bottom))",
          paddingLeft: "max(0.75rem, env(safe-area-inset-left))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right))",
        }}
      >
        <div className="flex items-center justify-between pb-2 gap-2">
          <button
            onClick={() => nav("/")}
            className="px-2 py-2 -my-2 text-amber-100/50 text-xs tracking-widest active:scale-95 transition"
          >
            LEAVE
          </button>
          <button onClick={copyCode} className="flex items-center gap-2 text-amber-100/80 hover:text-amber-100 min-w-0">
            <span className="text-[10px] tracking-[0.3em] uppercase">Room</span>
            <span className="text-2xl tracking-[0.3em] italic">{code}</span>
            <span className="text-[10px] text-amber-200/60">{copied ? "OK" : "copy"}</span>
          </button>
          <div className="flex items-center gap-2">
            {voiceConnected ? (
              <VoiceControls />
            ) : (
              <button
                onClick={onRequestVoice}
                className="px-2 py-2 rounded-sm border border-amber-100/40 text-amber-100/70 hover:text-amber-100 text-[10px] tracking-widest active:scale-95 transition"
                aria-label="Join voice"
              >
                JOIN VOICE
              </button>
            )}
            <button
              onClick={() => setShowRules(true)}
              className="w-10 h-10 rounded-full border border-amber-100/40 text-amber-100/70 hover:text-amber-100 hover:border-amber-100/70 flex items-center justify-center text-sm italic transition active:scale-95"
              aria-label="Rules"
            >
              i
            </button>
          </div>
        </div>

        {state.phase === "lobby" && (
          <Lobby state={state} playerId={playerId} isHost={isHost} onDeal={() => send({ type: "deal" })} />
        )}

        {state.phase !== "lobby" && me && (
          <>
            <div className="flex justify-around py-2">
              {opponents.map((p) => (
                <Opponent
                  key={p.id}
                  player={p}
                  active={state.currentPlayerId === p.id && state.phase === "playing"}
                  voiceLabel={voiceConnected ? <OpponentVoiceLabel playerId={p.id} playerName={p.name} active={state.currentPlayerId === p.id && state.phase === "playing"} /> : undefined}
                />
              ))}
            </div>

            <div className="flex-1 flex items-center justify-center relative min-h-0">
              <div className="flex items-center gap-4">
                <DeckStack />
                <PileStack pile={state.pile} />
              </div>
              {state.sevenActive && state.phase === "playing" && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="absolute top-2 right-2 text-[10px] tracking-[0.2em] text-amber-300/90 border border-amber-300/40 px-2 py-1 rounded-sm bg-amber-900/20">
                  &le; 7 ONLY
                </motion.div>
              )}
            </div>

            <div className="text-center py-2 min-h-[28px]">
              <motion.div key={state.message} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="text-amber-100/90 text-sm italic">{state.message}</motion.div>
              {error && <div className="text-red-400/80 text-xs mt-1">{error}</div>}
            </div>

            <PlayerArea
              me={me}
              state={state}
              selected={selected}
              swapPick={swapPick}
              isMyTurn={isMyTurn}
              isHost={isHost}
              isReady={readyPlayers.includes(playerId)}
              onToggleSelect={toggleSelect}
              onSwapTap={handleSwapTap}
              onPlayFaceDown={handlePlayFaceDown}
              onPlay={handlePlay}
              onPickup={() => send({ type: "pickup" })}
              onReady={() => send({ type: "ready" })}
              onNewGame={handleNewGame}
            />
          </>
        )}

        <AnimatePresence>
          {flash && (
            <motion.div initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.2 }} className="fixed inset-0 flex items-center justify-center pointer-events-none z-50">
              <div className="text-5xl tracking-[0.1em] text-amber-100 italic" style={{ textShadow: "0 0 40px rgba(255, 200, 100, 0.6)" }}>{flash}</div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showRules && <RulesModal onClose={() => setShowRules(false)} />}
        </AnimatePresence>

        <AnimatePresence>
          {state.phase === "over" && loser && (
            <ShitheadModal loserName={loser.name} youLost={youLost} line={state.shitheadLine ?? ""} canRestart={isHost} onNewGame={handleNewGame} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

type LobbyProps = {
  state: GameState;
  playerId: string;
  isHost: boolean;
  onDeal: () => void;
};

function Lobby({ state, playerId, isHost, onDeal }: LobbyProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="text-amber-100/60 text-xs tracking-[0.4em] uppercase mb-4">The Table</div>
      <div className="w-full max-w-xs space-y-2 mb-6">
        {state.players.map((p) => (
          <div key={p.id} className="flex items-center justify-between bg-stone-900/40 border border-amber-100/10 px-4 py-3 rounded-sm">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${p.connected ? "bg-emerald-400" : "bg-stone-600"}`} />
              <span className="text-amber-100">{p.name}</span>
              {p.id === state.hostId && <span className="text-[10px] text-amber-200/60 tracking-widest uppercase">Host</span>}
              {p.id === playerId && <span className="text-[10px] text-amber-200/60">(you)</span>}
            </div>
          </div>
        ))}
        {Array.from({ length: Math.max(0, 4 - state.players.length) }).map((_, i) => (
          <div key={`empty-${i}`} className="border border-dashed border-amber-100/10 px-4 py-3 rounded-sm text-amber-100/30 text-sm">empty seat...</div>
        ))}
      </div>

      {isHost ? (
        <button onClick={onDeal} disabled={state.players.length < 2} className="px-8 py-3 bg-amber-100 text-stone-900 rounded-sm tracking-[0.3em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition">
          Deal Cards ({state.players.length}/4)
        </button>
      ) : (
        <div className="text-amber-100/60 text-sm italic">waiting for host to deal...</div>
      )}
    </div>
  );
}

function VoiceControls() {
  const { localParticipant } = useLocalParticipant();
  const [muted, setMuted] = useState(false);
  const toggleMute = async () => {
    const next = !muted;
    await localParticipant?.setMicrophoneEnabled(!next);
    setMuted(next);
  };
  return (
    <button onClick={toggleMute} className={`px-2 py-1 rounded-sm border text-[10px] tracking-widest ${muted ? "border-red-400/40 text-red-300" : "border-emerald-400/40 text-emerald-300"}`}>
      {muted ? "MUTED" : "LIVE"}
    </button>
  );
}

/**
 * Voice-aware opponent name label. Shows a speaking-indicator dot when the
 * opponent is mid-utterance.
 *
 * Must be rendered inside `<LiveKitRoom>` — `useParticipants` crashes outside
 * the provider context. The plain `Opponent` component (in Table.tsx) accepts
 * this as the `voiceLabel` slot prop and falls back to a plain name label
 * when omitted.
 */
function OpponentVoiceLabel({ playerId, playerName, active }: { playerId: string; playerName: string; active: boolean }) {
  const participants = useParticipants();
  const speaking = participants.find((p) => p.identity === playerId)?.isSpeaking;
  const inVoice = participants.some((p) => p.identity === playerId);
  return (
    <div className="flex items-center gap-1 mb-1">
      {inVoice && <span className={`text-[8px] ${speaking ? "text-emerald-300 animate-pulse" : "text-amber-100/40"}`}>&bull;</span>}
      <div className={`text-[10px] tracking-[0.2em] uppercase ${active ? "text-amber-200" : speaking ? "text-emerald-200" : "text-amber-100/50"}`}>{playerName}</div>
    </div>
  );
}

