import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import usePartySocket from "partysocket/react";
import { LiveKitRoom, useParticipants, useLocalParticipant } from "@livekit/components-react";
import "@livekit/components-styles";
import type { GameState, Card as CardType } from "../lib/game";
import { rankLabel, isRed } from "../lib/game";

const PARTYKIT_HOST = import.meta.env.VITE_PARTYKIT_HOST || "127.0.0.1:1999";

const getOrCreatePlayerId = () => {
  let id = localStorage.getItem("playerId");
  if (!id) {
    id = `p_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem("playerId", id);
  }
  return id;
};

export default function Room() {
  const { code } = useParams<{ code: string }>();
  const nav = useNavigate();
  const roomCode = (code || "").toUpperCase();
  const [playerId, setPlayerId] = useState("");
  const [name, setName] = useState("");
  const [voiceToken, setVoiceToken] = useState<string | null>(null);
  const [voiceUrl, setVoiceUrl] = useState<string | null>(null);
  const [voiceConnected, setVoiceConnected] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem("playerName");
    if (!stored) { nav("/"); return; }
    setName(stored);
    setPlayerId(getOrCreatePlayerId());
  }, [nav]);

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

  if (!playerId || !name) return null;

  const inner = <GameRoom code={roomCode} playerId={playerId} name={name} voiceConnected={voiceConnected} onRequestVoice={requestVoice} hasVoiceToken={!!voiceToken} />;

  if (voiceToken && voiceUrl) {
    return (
      <LiveKitRoom token={voiceToken} serverUrl={voiceUrl} connect audio video={false} onConnected={() => setVoiceConnected(true)} onDisconnected={() => setVoiceConnected(false)} className="contents">
        {inner}
      </LiveKitRoom>
    );
  }
  return inner;
}

function GameRoom({ code, playerId, name, voiceConnected, onRequestVoice, hasVoiceToken }: { code: string; playerId: string; name: string; voiceConnected: boolean; onRequestVoice: () => void; hasVoiceToken: boolean }) {
  const nav = useNavigate();
  const [state, setState] = useState<GameState | null>(null);
  const [readyPlayers, setReadyPlayers] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [swapPick, setSwapPick] = useState<{ hand?: string; faceUp?: string }>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

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
          setState(msg.state);
          setReadyPlayers(msg.ready || []);
          if (msg.state.lastEvent?.type === "burn") triggerFlash("🔥 BURN");
          else if (msg.state.lastEvent?.type === "reset") triggerFlash("RESET");
          else if (msg.state.lastEvent?.type === "pickup") triggerFlash("PICK UP");
        } else if (msg.type === "error") {
          setError(msg.error);
          setTimeout(() => setError(null), 2000);
        }
      } catch {}
    },
  });

  const send = (msg: any) => socket.send(JSON.stringify(msg));
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

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
        <div className="text-amber-100/60 text-sm tracking-widest">CONNECTING…</div>
      </div>
    );
  }

  const me = state.players.find((p) => p.id === playerId);
  const opponents = state.players.filter((p) => p.id !== playerId);
  const isHost = state.hostId === playerId;
  const isMyTurn = state.currentPlayerId === playerId;

  const toggleSelect = (cardId: string) => {
    if (!me) return;
    const card = me.hand.find((c) => c.id === cardId);
    if (!card) return;
    if (selected.includes(cardId)) setSelected(selected.filter((id) => id !== cardId));
    else {
      const firstSel = selected[0] && me.hand.find((c) => c.id === selected[0]);
      if (!firstSel || firstSel.r === card.r) setSelected([...selected, cardId]);
      else setSelected([cardId]);
    }
  };

  return (
    <div className="min-h-screen w-full overflow-hidden relative" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255, 200, 100, 0.12) 0%, transparent 50%)" }} />

      <div className="relative z-10 flex flex-col h-screen max-w-md mx-auto px-3 py-2">
        <div className="flex items-center justify-between pb-2">
          <button onClick={() => nav("/")} className="text-amber-100/50 text-xs tracking-widest">← LEAVE</button>
          <button onClick={copyCode} className="flex items-center gap-2 text-amber-100/80 hover:text-amber-100">
            <span className="text-[10px] tracking-[0.3em] uppercase">Room</span>
            <span className="text-2xl tracking-[0.3em] italic">{code}</span>
            <span className="text-[10px] text-amber-200/60">{copied ? "✓" : "⧉"}</span>
          </button>
          {voiceConnected ? <VoiceControls /> : <div className="w-12" />}
        </div>

        {state.phase === "lobby" && (
          <Lobby state={state} playerId={playerId} isHost={isHost} onDeal={() => send({ type: "deal" })} voiceConnected={voiceConnected} hasVoiceToken={hasVoiceToken} onRequestVoice={onRequestVoice} />
        )}

        {state.phase !== "lobby" && me && (
          <>
            <div className="flex justify-around py-2">
              {opponents.map((p) => (
                <Opponent key={p.id} player={p} active={state.currentPlayerId === p.id && state.phase === "playing"} voiceConnected={voiceConnected} />
              ))}
            </div>

            <div className="flex-1 flex items-center justify-center relative">
              <div className="flex items-center gap-4">
                <DeckStack />
                <PileStack pile={state.pile} />
              </div>
              {state.sevenActive && state.phase === "playing" && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="absolute top-2 right-2 text-[10px] tracking-[0.2em] text-amber-300/90 border border-amber-300/40 px-2 py-1 rounded-sm bg-amber-900/20">
                  ≤ 7 ONLY
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
              onSwapTap={(zone, id) => {
                if (state.phase !== "swap") return;
                setSwapPick((s) => ({ ...s, [zone]: s[zone] === id ? undefined : id }));
              }}
              onPlayFaceUp={(id) => {
                if (!me || me.hand.length > 0 || !isMyTurn) return;
                send({ type: "play", cardIds: [id] });
              }}
              onPlayFaceDown={(id) => {
                if (!me || me.hand.length > 0 || me.faceUp.length > 0 || !isMyTurn) return;
                send({ type: "play", cardIds: [id] });
              }}
              onPlay={() => {
                if (selected.length === 0) return;
                send({ type: "play", cardIds: selected });
                setSelected([]);
              }}
              onPickup={() => send({ type: "pickup" })}
              onReady={() => send({ type: "ready" })}
              onNewGame={() => send({ type: "newGame" })}
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
      </div>
    </div>
  );
}

function Lobby({ state, playerId, isHost, onDeal, voiceConnected, hasVoiceToken, onRequestVoice }: any) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4">
      <div className="text-amber-100/60 text-xs tracking-[0.4em] uppercase mb-4">The Table</div>
      <div className="w-full max-w-xs space-y-2 mb-6">
        {state.players.map((p: any) => (
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
          <div key={`empty-${i}`} className="border border-dashed border-amber-100/10 px-4 py-3 rounded-sm text-amber-100/30 text-sm">empty seat…</div>
        ))}
      </div>

      {!voiceConnected && !hasVoiceToken && (
        <button onClick={onRequestVoice} className="mb-3 px-5 py-2 border border-amber-100/40 text-amber-100 rounded-sm tracking-[0.2em] text-xs uppercase active:scale-95 transition">
          🎙 Join Voice Chat
        </button>
      )}
      {voiceConnected && <div className="mb-3 text-emerald-300 text-xs tracking-[0.2em] uppercase">🎙 Voice Connected</div>}

      {isHost ? (
        <button onClick={onDeal} disabled={state.players.length < 2} className="px-8 py-3 bg-amber-100 text-stone-900 rounded-sm tracking-[0.3em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition">
          Deal Cards ({state.players.length}/4)
        </button>
      ) : (
        <div className="text-amber-100/60 text-sm italic">waiting for host to deal…</div>
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
      {muted ? "🔇" : "🎙"}
    </button>
  );
}

function Opponent({ player, active, voiceConnected }: any) {
  const participants = voiceConnected ? useParticipants() : [];
  const speaking = voiceConnected && participants.find((p) => p.identity === player.id)?.isSpeaking;
  const inVoice = voiceConnected && participants.some((p) => p.identity === player.id);

  return (
    <div className={`flex flex-col items-center transition-opacity ${active ? "opacity-100" : "opacity-50"} ${!player.connected ? "opacity-30" : ""}`}>
      <div className="flex items-center gap-1 mb-1">
        {inVoice && <span className={`text-[8px] ${speaking ? "text-emerald-300 animate-pulse" : "text-amber-100/40"}`}>●</span>}
        <div className={`text-[10px] tracking-[0.2em] uppercase ${active ? "text-amber-200" : speaking ? "text-emerald-200" : "text-amber-100/50"}`}>{player.name}</div>
      </div>
      <div className="flex gap-0.5 mb-0.5">
        {player.faceDown.slice(0, 3).map((_: any, i: number) => (
          <div key={i} className="w-5 h-7 rounded bg-gradient-to-br from-red-900 to-red-950 border border-amber-200/20" />
        ))}
      </div>
      <div className="flex gap-0.5 -mt-3">
        {player.faceUp.map((c: any) => (
          <div key={c.id} className="w-5 h-7 rounded bg-stone-100 border border-stone-300 flex items-center justify-center text-[8px] font-bold" style={{ color: isRed(c.s) ? "#991b1b" : "#1c1917" }}>
            {rankLabel(c.r)}
          </div>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-amber-100/60 tracking-wider">{player.hand.length} 🂠</div>
      {active && <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1 h-1 rounded-full bg-amber-300 mt-1" />}
    </div>
  );
}

function DeckStack() {
  return (
    <div className="relative w-16 h-24">
      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-red-900 to-red-950 border border-amber-200/30 shadow-lg" style={{ transform: "translate(-2px,-2px)" }} />
      <div className="absolute inset-0 rounded-lg bg-gradient-to-br from-red-800 to-red-950 border border-amber-200/40 shadow-xl" />
    </div>
  );
}

function PileStack({ pile }: { pile: CardType[] }) {
  return (
    <div className="relative w-20 h-28">
      <AnimatePresence>
        {pile.slice(-4).map((c, i, arr) => (
          <motion.div
            key={c.id}
            initial={{ y: -100, opacity: 0 }}
            animate={{ y: 0, opacity: 1, rotate: (i - arr.length / 2) * 4 + (c.id.charCodeAt(0) % 7 - 3) }}
            exit={{ opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 280, damping: 22 }}
            className="absolute inset-0"
            style={{ zIndex: i }}
          >
            <Card card={c} size="md" />
          </motion.div>
        ))}
      </AnimatePresence>
      {pile.length === 0 && <div className="w-full h-full rounded-lg border border-dashed border-amber-100/15 flex items-center justify-center text-amber-100/30 text-[10px] tracking-widest">EMPTY</div>}
    </div>
  );
}

function PlayerArea({ me, state, selected, swapPick, isMyTurn, isHost, isReady, onToggleSelect, onSwapTap, onPlayFaceUp, onPlayFaceDown, onPlay, onPickup, onReady, onNewGame }: any) {
  return (
    <div className="pb-2">
      <div className="flex justify-center gap-2 mb-1">
        {me.faceDown.map((c: CardType) => (
          <motion.button key={c.id} whileTap={{ scale: 0.95 }} onClick={() => onPlayFaceDown(c.id)} disabled={me.hand.length > 0 || me.faceUp.length > 0 || !isMyTurn || state.phase !== "playing"}>
            <CardBack size="sm" />
          </motion.button>
        ))}
      </div>

      <div className="flex justify-center gap-2 mb-2 -mt-4">
        {me.faceUp.map((c: CardType) => (
          <motion.button
            key={c.id}
            whileTap={{ scale: 0.95 }}
            onClick={() => (state.phase === "swap" ? onSwapTap("faceUp", c.id) : onPlayFaceUp(c.id))}
            disabled={state.phase === "playing" && (me.hand.length > 0 || !isMyTurn)}
            animate={{ y: swapPick.faceUp === c.id ? -8 : 0, scale: swapPick.faceUp === c.id ? 1.05 : 1 }}
            className="disabled:opacity-60"
          >
            <Card card={c} size="sm" />
          </motion.button>
        ))}
      </div>

      <div className="flex justify-center items-end h-32 relative">
        {me.hand.map((c: CardType, i: number) => {
          const total = me.hand.length;
          const spread = Math.min(total * 36, 280);
          const offset = (i - (total - 1) / 2) * (spread / Math.max(total, 1));
          const rot = (i - (total - 1) / 2) * 4;
          const isSel = selected.includes(c.id) || swapPick.hand === c.id;
          return (
            <motion.button
              key={c.id}
              onClick={() => (state.phase === "swap" ? onSwapTap("hand", c.id) : onToggleSelect(c.id))}
              className="absolute"
              initial={{ y: 100, opacity: 0 }}
              animate={{ x: offset, y: isSel ? -20 : 0, rotate: isSel ? 0 : rot, opacity: 1, scale: isSel ? 1.08 : 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              whileTap={{ scale: 1.1 }}
              style={{ zIndex: isSel ? 50 : i }}
            >
              <Card card={c} size="md" highlight={isSel} />
            </motion.button>
          );
        })}
      </div>

      <div className="flex justify-center gap-2 mt-2">
        {state.phase === "swap" ? (
          <button onClick={onReady} disabled={isReady} className="px-6 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-50 active:scale-95 transition">
            {isReady ? "Waiting for others…" : "Ready"}
          </button>
        ) : state.phase === "over" ? (
          isHost ? (
            <button onClick={onNewGame} className="px-6 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold active:scale-95 transition">New Game</button>
          ) : (
            <div className="text-amber-100/60 text-sm italic">waiting for host…</div>
          )
        ) : isMyTurn && me.hand.length > 0 ? (
          <>
            <button onClick={onPlay} disabled={selected.length === 0} className="px-5 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition">
              Play {selected.length > 1 ? `(${selected.length})` : ""}
            </button>
            <button onClick={onPickup} disabled={state.pile.length === 0} className="px-5 py-2 border border-amber-100/40 text-amber-100 rounded-sm tracking-[0.2em] text-xs uppercase disabled:opacity-30 active:scale-95 transition">Pick Up</button>
          </>
        ) : isMyTurn ? (
          <div className="text-amber-100/80 text-sm italic">tap a card above to play</div>
        ) : null}
      </div>
    </div>
  );
}

function Card({ card, size = "md", highlight }: { card: CardType; size?: "sm" | "md"; highlight?: boolean }) {
  const sizes = { sm: "w-12 h-16 text-xs", md: "w-16 h-24 text-base" };
  return (
    <div
      className={`${sizes[size]} rounded-lg bg-gradient-to-br from-stone-50 to-stone-200 border ${highlight ? "border-amber-400 ring-2 ring-amber-300/60" : "border-stone-300"} shadow-lg flex flex-col justify-between p-1.5 relative overflow-hidden`}
      style={{ boxShadow: highlight ? "0 8px 24px rgba(255, 200, 100, 0.4)" : "0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.8)" }}
    >
      <div className={`leading-none font-bold ${isRed(card.s) ? "text-red-700" : "text-stone-900"}`} style={{ fontFamily: "Georgia, serif" }}>
        <div>{rankLabel(card.r)}</div>
        <div className="text-[10px] -mt-0.5">{card.s}</div>
      </div>
      <div className={`text-center text-2xl ${isRed(card.s) ? "text-red-700" : "text-stone-900"}`}>{card.s}</div>
      <div className={`leading-none font-bold rotate-180 self-end ${isRed(card.s) ? "text-red-700" : "text-stone-900"}`} style={{ fontFamily: "Georgia, serif" }}>
        <div>{rankLabel(card.r)}</div>
        <div className="text-[10px] -mt-0.5">{card.s}</div>
      </div>
    </div>
  );
}

function CardBack({ size = "md" }: { size?: "sm" | "md" }) {
  const sizes = { sm: "w-12 h-16", md: "w-16 h-24" };
  return (
    <div className={`${sizes[size]} rounded-lg border border-amber-200/30 shadow-lg relative overflow-hidden`} style={{ background: "linear-gradient(135deg, #7a1818 0%, #4a0e0e 100%)" }}>
      <div className="absolute inset-1 border border-amber-200/20 rounded-md flex items-center justify-center">
        <div className="text-amber-200/30 text-xl italic">♣</div>
      </div>
    </div>
  );
}
