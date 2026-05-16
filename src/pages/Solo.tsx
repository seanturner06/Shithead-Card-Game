/**
 * @file Solo page — single-player Shithead vs. 3 bots. Mounted at `/solo`.
 *
 * Fully client-side: no PartyKit, no LiveKit, no networking cost. The
 * authoritative {@link GameState} lives in this component's local state and
 * mutates via the pure engine functions in `src/lib/game.ts`. The same engine
 * the multiplayer server uses — so the game plays identically.
 *
 * The bots run during a useEffect that detects "current player is not the
 * human" and schedules a {@link botAct} dispatch after a randomized think
 * delay (600–1500ms). That delay matters more than the AI itself: instant
 * moves feel like a glitch, not a game.
 *
 * Bot identities are fixed (Reggie / Maude / Vincent) — three is the max
 * table size and gives the fullest game experience.
 */

import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import {
  type GameState,
  type Player,
  applyPickup,
  applyPlay,
  applySwap,
  createInitialState,
  dealGame,
  startPlay,
} from "../lib/game";
import { botAct, botSwap } from "../lib/bot";
import { getPlayerName } from "../lib/playerName";
import {
  type SwapPick,
  type SwapZone,
  SHITHEAD_LINES,
  Opponent,
  DeckStack,
  PileStack,
  PlayerArea,
  RulesModal,
  ShitheadModal,
} from "../components/Table";

/** Fixed identity for the human seat. Stable across new games. */
const HUMAN_ID = "you";

/**
 * The three bot opponents. Fixed identities and names — three seats means a
 * full 4-player table every game, which gives the best feel for the game's
 * dynamics (burns, four-of-a-kinds, longer endgames).
 */
const BOTS: { id: string; name: string }[] = [
  { id: "bot_reggie", name: "Reggie" },
  { id: "bot_maude", name: "Maude" },
  { id: "bot_vincent", name: "Vincent" },
];

/** Bot think delay in ms — randomized so they feel less robotic. */
const BOT_DELAY_MIN = 600;
const BOT_DELAY_RANGE = 900;

/**
 * Build the initial solo game state: deal cards to all 4 seats and let each
 * bot greedily optimize its face-up row. Returns a state in the `swap` phase
 * with bots already settled — the human still gets to swap manually.
 */
function buildInitialState(humanName: string): GameState {
  let state = createInitialState(HUMAN_ID, humanName);
  // Add the 3 bots into the seat array. `createInitialState` already seated
  // the human as the host.
  state = {
    ...state,
    players: [
      state.players[0],
      ...BOTS.map((b) => ({
        id: b.id,
        name: b.name,
        hand: [],
        faceUp: [],
        faceDown: [],
        finished: false,
        connected: true,
      } as Player)),
    ],
  };
  state = dealGame(state);
  // Bots auto-swap their face-up row to a strong layout. Done eagerly so the
  // swap phase only waits on the human.
  for (const bot of BOTS) {
    state = botSwap(state, bot.id);
  }
  return state;
}

export default function Solo() {
  const nav = useNavigate();
  const [state, setState] = useState<GameState | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [swapPick, setSwapPick] = useState<SwapPick>({});
  const [flash, setFlash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showRules, setShowRules] = useState(false);
  const [shitheadLine, setShitheadLine] = useState("");

  // Track which lastEvent we've already flashed for, so we don't re-flash on
  // unrelated state updates (selection changes, etc.).
  const lastEventTsRef = useRef<number | null>(null);
  // Track previous phase to detect the swap→over transition for the shithead
  // line.
  const prevPhaseRef = useRef<GameState["phase"] | undefined>(undefined);

  // Initialize once on mount. The human's name is read from localStorage
  // (set during the landing page flow); falls back to "You" for direct-link
  // visitors who haven't been through landing yet.
  useEffect(() => {
    const humanName = getPlayerName() || "You";
    setState(buildInitialState(humanName));
  }, []);

  // Bot turn loop. Whenever state changes and it's a bot's turn during play,
  // schedule the bot's action after a randomized delay. The cleanup function
  // cancels the pending timer if state changes before it fires — important
  // when the human triggers an action mid-think.
  useEffect(() => {
    if (!state || state.phase !== "playing") return;
    const currentId = state.currentPlayerId;
    if (!currentId || currentId === HUMAN_ID) return;

    const delay = BOT_DELAY_MIN + Math.random() * BOT_DELAY_RANGE;
    const timer = setTimeout(() => {
      setState((curState) => {
        if (!curState || curState.phase !== "playing") return curState;
        const botId = curState.currentPlayerId;
        if (!botId || botId === HUMAN_ID) return curState;

        const action = botAct(curState, botId);
        if (action.type === "pickup") {
          return applyPickup(curState, botId).state;
        }
        const result = applyPlay(curState, botId, action.cardIds);
        if (result.error) {
          // Bot returned an illegal action — shouldn't happen given the
          // tests, but fall back to pickup so we never deadlock.
          console.warn("Bot illegal action:", result.error);
          return applyPickup(curState, botId).state;
        }
        return result.state;
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [state]);

  // Flash overlay for burn/reset/pickup events.
  useEffect(() => {
    const e = state?.lastEvent;
    if (!e) return;
    if (lastEventTsRef.current === e.ts) return;
    lastEventTsRef.current = e.ts;
    if (e.type === "burn") triggerFlash("BURN");
    else if (e.type === "reset") triggerFlash("RESET");
    else if (e.type === "pickup") triggerFlash("PICK UP");
  }, [state?.lastEvent]);

  // Pick a random "you stink" line the moment the game ends.
  useEffect(() => {
    if (state?.phase === "over" && prevPhaseRef.current !== "over") {
      setShitheadLine(SHITHEAD_LINES[Math.floor(Math.random() * SHITHEAD_LINES.length)]);
    }
    prevPhaseRef.current = state?.phase;
  }, [state?.phase]);

  // Swap-phase: when both hand and face-up are picked, perform the swap.
  useEffect(() => {
    if (!state || state.phase !== "swap") return;
    if (swapPick.hand && swapPick.faceUp) {
      setState((s) => (s ? applySwap(s, HUMAN_ID, swapPick.hand!, swapPick.faceUp!) : s));
      setSwapPick({});
    }
  }, [swapPick, state?.phase]);

  const triggerFlash = (t: string) => {
    setFlash(t);
    setTimeout(() => setFlash(null), 1300);
  };

  if (!state) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
        <div className="text-amber-100/60 text-sm tracking-widest">DEALING...</div>
      </div>
    );
  }

  const me = state.players.find((p) => p.id === HUMAN_ID);
  const opponents = state.players.filter((p) => p.id !== HUMAN_ID);
  const isMyTurn = state.currentPlayerId === HUMAN_ID;
  const loser = state.loserId ? state.players.find((p) => p.id === state.loserId) : null;
  const youLost = loser?.id === HUMAN_ID;

  const toggleSelect = (cardId: string) => {
    if (!me) return;
    // Active selection zone: hand first, fall back to face-up once the hand
    // is empty. Matches the order the engine enforces.
    const zone = me.hand.length > 0 ? me.hand : me.faceUp;
    const card = zone.find((c) => c.id === cardId);
    if (!card) return;
    if (selected.includes(cardId)) {
      setSelected(selected.filter((id) => id !== cardId));
    } else {
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
    runHumanPlay([id]);
  };

  const handlePlay = () => {
    if (selected.length === 0) return;
    runHumanPlay(selected);
    setSelected([]);
  };

  const runHumanPlay = (cardIds: string[]) => {
    const result = applyPlay(state, HUMAN_ID, cardIds);
    if (result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 2000);
      return;
    }
    setState(result.state);
  };

  const handlePickup = () => {
    const result = applyPickup(state, HUMAN_ID);
    if (result.error) {
      setError(result.error);
      setTimeout(() => setError(null), 2000);
      return;
    }
    setState(result.state);
  };

  const handleReady = () => {
    // Solo skips the lobby; we go directly from swap → playing the moment the
    // human is ready, since bots have already auto-swapped.
    setState((s) => (s ? startPlay(s) : s));
  };

  const handleNewGame = () => {
    const humanName = getPlayerName() || "You";
    setState(buildInitialState(humanName));
    setSelected([]);
    setSwapPick({});
    setShitheadLine("");
    lastEventTsRef.current = null;
    prevPhaseRef.current = undefined;
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
          <div className="flex items-center gap-2 text-amber-100/80">
            <span className="text-[10px] tracking-[0.3em] uppercase">Vs</span>
            <span className="text-base tracking-[0.3em] italic">Computer</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRules(true)}
              className="w-10 h-10 rounded-full border border-amber-100/40 text-amber-100/70 hover:text-amber-100 hover:border-amber-100/70 flex items-center justify-center text-sm italic transition active:scale-95"
              aria-label="Rules"
            >
              i
            </button>
          </div>
        </div>

        {me && (
          <>
            <div className="flex justify-around py-2">
              {opponents.map((p) => (
                <Opponent
                  key={p.id}
                  player={p}
                  active={state.currentPlayerId === p.id && state.phase === "playing"}
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
              isHost={true}
              isReady={false}
              onToggleSelect={toggleSelect}
              onSwapTap={handleSwapTap}
              onPlayFaceDown={handlePlayFaceDown}
              onPlay={handlePlay}
              onPickup={handlePickup}
              onReady={handleReady}
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
            <ShitheadModal loserName={loser.name} youLost={youLost} line={shitheadLine} canRestart={true} onNewGame={handleNewGame} />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
