/**
 * @file Shared game-table UI components.
 *
 * Renders the table itself — opponents, deck, pile, the player's hand and
 * controls, rules modal, game-over modal. Voice-agnostic by design: the
 * multiplayer `Room` page wraps these with voice; the solo page renders them
 * directly. Anything that touches LiveKit hooks (voice controls, speaking
 * indicators) stays in `Room.tsx`, not here.
 *
 * The `Opponent` component takes an optional `voiceLabel` slot — the
 * multiplayer page passes a voice-aware label, solo passes nothing and the
 * plain name renders.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { GameState, Card as CardType, Player } from "../lib/game";
import { rankLabel, isRed, effectiveTop } from "../lib/game";

/** Tracks which hand card + face-up card the player has tapped during swap phase. */
export type SwapPick = { hand?: string; faceUp?: string };

/** Which row of the player's cards a tap originated from during swap phase. */
export type SwapZone = "hand" | "faceUp";

/**
 * Ranks that get the amber "special card" glow in the hand.
 *
 * Differs from the engine's `isSpecial` (which is {2, 3, 10} — ranks that
 * bypass the normal "≥ top" rule). The UI also glows 7s because they have a
 * meaningful side-effect (forcing the next play ≤ 7).
 */
export const isSpecial = (r: number) => r === 2 || r === 3 || r === 7 || r === 10;

export const SHITHEAD_LINES = [
  "absolute clown behavior",
  "you played like that on purpose?",
  "this is your villain origin story",
  "buy your friends a drink. they earned it",
  "history will remember this",
  "the cards have spoken. you stink",
];

/**
 * Hand size threshold at which the layout switches from a fanned arc (≤6 cards)
 * to a horizontal scrollable strip (≥7 cards). The fan looks great with few
 * cards but gets crowded past 6.
 */
export const FAN_LIMIT = 6;

export function RulesModal({ onClose }: { onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 bg-black/80 z-[70] flex items-center justify-center p-4 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.9, y: 10 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 10 }}
        onClick={(e) => e.stopPropagation()}
        className="bg-stone-900/95 border border-amber-100/20 rounded-sm max-w-sm w-full max-h-[85vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-stone-900/95 backdrop-blur border-b border-amber-100/10 px-5 py-3 flex items-center justify-between">
          <div className="text-amber-100/60 text-[10px] tracking-[0.4em] uppercase">House Rules</div>
          <button onClick={onClose} className="text-amber-100/60 hover:text-amber-100 text-lg leading-none">&times;</button>
        </div>

        <div className="px-5 py-4 space-y-4 text-amber-50/90 text-sm">
          <Section title="Goal">
            <p>Get rid of all your cards. Last one holding cards is the <span className="italic text-amber-200">Shithead</span>.</p>
          </Section>

          <Section title="Setup">
            <p>Each player gets 9 cards: 3 face-down (blind), 3 face-up on top of those, and 3 in hand. Before play starts, swap any cards between your hand and face-up row.</p>
          </Section>

          <Section title="Turn">
            <p>Play a card equal to or higher than the top of the pile. Draw back up to 3 from the deck. Can't play? Pick up the whole pile.</p>
            <p className="text-amber-100/60 text-xs italic">You can play multiple cards if they're the same rank.</p>
          </Section>

          <Section title="Special Cards">
            <div className="space-y-2">
              <SpecialRow rank="2" label="Reset">
                Plays on anything. Next player can play anything too.
              </SpecialRow>
              <SpecialRow rank="3" label="Invisible">
                Plays on anything. The next player plays as if the 3 isn't there — they react to whatever's underneath.
              </SpecialRow>
              <SpecialRow rank="7" label="Lower">
                Next player must play a 7 or lower.
              </SpecialRow>
              <SpecialRow rank="10" label="Burn">
                Burns the entire pile. You go again.
              </SpecialRow>
              <SpecialRow rank="4&times;" label="Burn">
                Four of a kind on top of the pile (across one or several plays) burns it.
              </SpecialRow>
            </div>
          </Section>

          <Section title="Endgame">
            <p>When your hand is empty, play your face-up cards. When those are gone, blindly tap a face-down card. If it can't play, you pick up the pile plus that card.</p>
          </Section>

          <div className="text-amber-100/40 text-[10px] tracking-widest uppercase pt-2 border-t border-amber-100/10">
            specials are highlighted with a glow in your hand
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-amber-200/80 text-[10px] tracking-[0.3em] uppercase mb-1.5">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function SpecialRow({ rank, label, children }: { rank: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="shrink-0 w-10 h-12 rounded bg-gradient-to-br from-stone-50 to-stone-200 border border-amber-300 ring-1 ring-amber-300/40 flex items-center justify-center text-stone-900 font-bold text-sm" style={{ fontFamily: "Georgia, serif", boxShadow: "0 0 12px rgba(255, 200, 100, 0.3)" }} dangerouslySetInnerHTML={{ __html: rank }} />
      <div className="flex-1">
        <div className="text-amber-200 text-xs tracking-widest uppercase">{label}</div>
        <div className="text-amber-50/80 text-xs">{children}</div>
      </div>
    </div>
  );
}

export function ShitheadModal({ loserName, youLost, line, canRestart, onNewGame }: { loserName: string; youLost: boolean; line: string; canRestart: boolean; onNewGame: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/85 z-[55] flex items-center justify-center p-4 backdrop-blur-md"
    >
      <motion.div
        initial={{ scale: 0.7, y: 30, rotate: -3 }}
        animate={{ scale: 1, y: 0, rotate: 0 }}
        transition={{ type: "spring", stiffness: 200, damping: 15 }}
        className="text-center max-w-xs"
      >
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1, rotate: [0, -8, 8, -4, 4, 0] }}
          transition={{ delay: 0.2, duration: 0.8, type: "spring" }}
          className="text-8xl mb-4"
        >
          💩
        </motion.div>
        <div className="text-amber-100/50 text-[10px] tracking-[0.5em] uppercase mb-2">Game Over</div>
        <div className="text-amber-100 text-4xl mb-2 italic" style={{ textShadow: "0 0 40px rgba(255, 200, 100, 0.4)" }}>
          {youLost ? "You're the" : `${loserName} is the`}
        </div>
        <motion.div
          initial={{ scale: 1.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.4, type: "spring" }}
          className="text-red-300 text-5xl mb-4 italic font-bold"
          style={{ fontFamily: "Cormorant Garamond, Georgia, serif", textShadow: "0 0 30px rgba(255, 100, 100, 0.5)" }}
        >
          SHITHEAD
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.7 }}
          className="text-amber-100/70 text-sm italic mb-6"
        >
          {line}
        </motion.div>
        {canRestart ? (
          <motion.button
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 }}
            onClick={onNewGame}
            className="px-8 py-3 bg-amber-100 text-stone-900 rounded-sm tracking-[0.3em] text-xs uppercase font-semibold active:scale-95 transition"
          >
            Deal Again
          </motion.button>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1 }} className="text-amber-100/50 text-xs tracking-widest uppercase">
            waiting for host...
          </motion.div>
        )}
      </motion.div>
    </motion.div>
  );
}

type OpponentProps = {
  player: Player;
  active: boolean;
  /**
   * Optional voice-aware label slot. When provided (multiplayer + voice), it
   * renders in place of the plain name. When omitted (solo, or multiplayer
   * without voice), a plain name label renders.
   */
  voiceLabel?: React.ReactNode;
};

/**
 * Renders one opponent: name, face-down stack, face-up row, hand count, and an
 * active-turn indicator. Voice-agnostic — pass a `voiceLabel` to swap in a
 * speaking indicator from outside.
 */
export function Opponent({ player, active, voiceLabel }: OpponentProps) {
  return (
    <div className={`flex flex-col items-center transition-opacity ${active ? "opacity-100" : "opacity-50"} ${!player.connected ? "opacity-30" : ""}`}>
      {voiceLabel ?? (
        <div className="flex items-center gap-1 mb-1">
          <div className={`text-[10px] tracking-[0.2em] uppercase ${active ? "text-amber-200" : "text-amber-100/50"}`}>{player.name}</div>
        </div>
      )}
      <div className="flex gap-0.5 mb-0.5">
        {player.faceDown.slice(0, 3).map((_, i) => (
          <div key={i} className="w-5 h-7 rounded bg-gradient-to-br from-red-900 to-red-950 border border-amber-200/20" />
        ))}
      </div>
      <div className="flex gap-0.5 -mt-3">
        {player.faceUp.map((c) => (
          <div key={c.id} className="w-5 h-7 rounded bg-stone-100 border border-stone-300 flex items-center justify-center text-[8px] font-bold" style={{ color: isRed(c.s) ? "#991b1b" : "#1c1917" }}>
            {rankLabel(c.r)}
          </div>
        ))}
      </div>
      <div className="mt-1 text-[10px] text-amber-100/60 tracking-wider">{player.hand.length} cards</div>
      {active && <motion.div animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }} className="w-1 h-1 rounded-full bg-amber-300 mt-1" />}
    </div>
  );
}

/**
 * The draw-deck visual at the center of the table. Two `CardBack`s offset
 * slightly to suggest a stack — both carry the Parlor monogram, matching
 * the face-down cards in the player's row.
 */
export function DeckStack() {
  return (
    <div className="relative w-16 h-24">
      <div className="absolute" style={{ transform: "translate(-2px,-2px)" }}>
        <CardBack size="md" />
      </div>
      <div className="absolute">
        <CardBack size="md" />
      </div>
    </div>
  );
}

/**
 * Render the discard pile (top of stack).
 *
 * When a 3 (the "invisible" card) sits on top, the pile becomes peekable: on
 * hover (desktop) or tap (mobile, auto-clears after 2.5s) the topmost 3s are
 * temporarily hidden so the player can see what they actually have to play
 * against. The "what's under" answer comes from the engine's
 * {@link effectiveTop} helper, the same function that decides legality — so
 * the peek shows exactly the card that matters.
 */
export function PileStack({ pile }: { pile: CardType[] }) {
  const [peeking, setPeeking] = useState(false);

  const top = pile[pile.length - 1];
  const underTop = effectiveTop(pile);
  // Only offer peek when the visible top is a 3 AND there's a real card
  // beneath it — peeking an all-3s pile shows the same thing.
  const canPeek = top?.r === 3 && underTop !== null;

  // While peeking, strip the topmost run of 3s so the player sees the
  // effective top exposed.
  const displayPile = useMemo(() => {
    if (!peeking || !canPeek) return pile;
    let i = pile.length - 1;
    while (i >= 0 && pile[i].r === 3) i--;
    return pile.slice(0, i + 1);
  }, [pile, peeking, canPeek]);

  // Mobile auto-dismiss: clear peek after a couple of seconds. Desktop uses
  // mouse-leave instead and won't hit this path.
  useEffect(() => {
    if (!peeking) return;
    const t = setTimeout(() => setPeeking(false), 2500);
    return () => clearTimeout(t);
  }, [peeking]);

  return (
    <div
      className="relative w-20 h-28"
      onMouseEnter={() => canPeek && setPeeking(true)}
      onMouseLeave={() => setPeeking(false)}
      onClick={() => canPeek && setPeeking((p) => !p)}
      style={{ cursor: canPeek ? "pointer" : "default" }}
    >
      <AnimatePresence>
        {displayPile.slice(-4).map((c, i, arr) => (
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
      {canPeek && (
        <div className="absolute -bottom-4 left-1/2 -translate-x-1/2 text-[8px] tracking-[0.25em] uppercase italic whitespace-nowrap pointer-events-none transition-opacity" style={{ opacity: peeking ? 0.45 : 0.75, color: "rgb(252 211 77 / 0.7)" }}>
          {peeking ? "under the 3" : "peek under"}
        </div>
      )}
    </div>
  );
}

type PlayerAreaProps = {
  me: Player;
  state: GameState;
  selected: string[];
  swapPick: SwapPick;
  isMyTurn: boolean;
  isHost: boolean;
  isReady: boolean;
  onToggleSelect: (id: string) => void;
  onSwapTap: (zone: SwapZone, id: string) => void;
  onPlayFaceDown: (id: string) => void;
  onPlay: () => void;
  onPickup: () => void;
  onReady: () => void;
  onNewGame: () => void;
};

/**
 * The current player's area at the bottom of the screen.
 *
 * Layered top-to-bottom:
 * 1. Row of face-down card backs (tappable in face-down phase only).
 * 2. Row of face-up cards (tappable for swap during swap phase, or to play
 *    once hand is empty).
 * 3. Hand — `FanHand` if ≤{@link FAN_LIMIT} cards, else `ScrollHand`.
 * 4. Action button row — Ready / Play / Pickup / New Game depending on phase.
 *
 * Purely presentational. All state lives in the parent; all actions are sent
 * up via the `on*` callbacks.
 */
export function PlayerArea({ me, state, selected, swapPick, isMyTurn, isHost, isReady, onToggleSelect, onSwapTap, onPlayFaceDown, onPlay, onPickup, onReady, onNewGame }: PlayerAreaProps) {
  const useFan = me.hand.length <= FAN_LIMIT;

  // You're in face-down phase only when hand AND face-up are both empty.
  const inFaceDownPhase = me.hand.length === 0 && me.faceUp.length === 0;

  // Can pick up: it's your turn during play, there's a pile, and you're not in face-down phase.
  const canPickup =
    state.phase === "playing" &&
    isMyTurn &&
    state.pile.length > 0 &&
    !inFaceDownPhase;

  // Show action buttons when you have a hand or face-up card to play.
  const showActions =
    state.phase === "playing" &&
    isMyTurn &&
    !inFaceDownPhase;

  return (
    <div className="pb-2 shrink-0">
      <div className="flex justify-center gap-2 mb-1">
        {me.faceDown.map((c) => (
          <motion.button key={c.id} whileTap={{ scale: 0.95 }} onClick={() => onPlayFaceDown(c.id)} disabled={me.hand.length > 0 || me.faceUp.length > 0 || !isMyTurn || state.phase !== "playing"}>
            <CardBack size="sm" />
          </motion.button>
        ))}
      </div>

      <div className="flex justify-center gap-2 mb-2 -mt-4">
        {me.faceUp.map((c) => {
          const isSel = selected.includes(c.id);
          const isSwapPick = swapPick.faceUp === c.id;
          // During playing phase, face-up cards become a normal selection
          // surface once the hand is empty: tap to select (multi-select if
          // same rank), then hit Play. This matches hand behavior and
          // unlocks playing multiple same-rank face-ups in one move.
          const handleClick = () => {
            if (state.phase === "swap") onSwapTap("faceUp", c.id);
            else if (state.phase === "playing" && me.hand.length === 0 && isMyTurn) onToggleSelect(c.id);
          };
          return (
            <motion.button
              key={c.id}
              whileTap={{ scale: 0.95 }}
              onClick={handleClick}
              disabled={state.phase === "playing" && (me.hand.length > 0 || !isMyTurn)}
              animate={{
                y: isSwapPick ? -8 : isSel ? -10 : 0,
                scale: isSwapPick || isSel ? 1.05 : 1,
              }}
              className="disabled:opacity-60"
            >
              <Card card={c} size="sm" special={isSpecial(c.r)} highlight={isSel} />
            </motion.button>
          );
        })}
      </div>

      {/* Render hand area only when there's a hand. When hand is empty, hide it so action row sits closer to face-up. */}
      {me.hand.length > 0 ? (
        useFan ? (
          <FanHand me={me} state={state} selected={selected} swapPick={swapPick} onToggleSelect={onToggleSelect} onSwapTap={onSwapTap} />
        ) : (
          <ScrollHand me={me} state={state} selected={selected} swapPick={swapPick} onToggleSelect={onToggleSelect} onSwapTap={onSwapTap} />
        )
      ) : (
        <div className="h-2" />
      )}

      <div className="flex justify-center gap-2 mt-2">
        {state.phase === "swap" ? (
          <button onClick={onReady} disabled={isReady} className="px-6 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-50 active:scale-95 transition">
            {isReady ? "Waiting for others..." : "Ready"}
          </button>
        ) : state.phase === "over" ? (
          isHost ? (
            <button onClick={onNewGame} className="px-6 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold active:scale-95 transition">New Game</button>
          ) : (
            <div className="text-amber-100/60 text-sm italic">waiting for host...</div>
          )
        ) : showActions ? (
          <>
            {(me.hand.length > 0 || me.faceUp.length > 0) && (
              <button onClick={onPlay} disabled={selected.length === 0} className="px-5 py-2 bg-amber-100 text-stone-900 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition">
                Play {selected.length > 1 ? `(${selected.length})` : ""}
              </button>
            )}
            {canPickup && (
              <button onClick={onPickup} className="px-5 py-2 border border-amber-100/40 text-amber-100 rounded-sm tracking-[0.2em] text-xs uppercase active:scale-95 transition">
                Pick Up
              </button>
            )}
          </>
        ) : isMyTurn && state.phase === "playing" && me.faceDown.length > 0 ? (
          <div className="text-amber-100/80 text-sm italic">tap a face-down card (blind!)</div>
        ) : null}
      </div>
    </div>
  );
}

type HandSubProps = {
  me: Player;
  state: GameState;
  selected: string[];
  swapPick: SwapPick;
  onToggleSelect: (id: string) => void;
  onSwapTap: (zone: SwapZone, id: string) => void;
};

/**
 * Cards spread in a fanned arc — used when the hand has ≤{@link FAN_LIMIT}
 * cards. Each card is absolutely positioned with a per-index x-offset and
 * rotation to produce the curve. Selected cards lift up and straighten.
 */
function FanHand({ me, state, selected, swapPick, onToggleSelect, onSwapTap }: HandSubProps) {
  return (
    <div className="flex justify-center items-end h-32 relative overflow-visible">
      {me.hand.map((c, i) => {
        const total = me.hand.length;
        const spread = Math.min(total * 36, 240);
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
            <Card card={c} size="md" highlight={isSel} special={isSpecial(c.r)} />
          </motion.button>
        );
      })}
    </div>
  );
}

/**
 * Cards in a horizontally-scrollable strip — used when the hand is too big for
 * a fan to read cleanly (>{@link FAN_LIMIT} cards). Sorted by rank ascending
 * with a stable secondary sort on id.
 */
function ScrollHand({ me, state, selected, swapPick, onToggleSelect, onSwapTap }: HandSubProps) {
  const ref = useRef<HTMLDivElement>(null);
  const prevHandLen = useRef(me.hand.length);

  const sortedHand = useMemo(() => {
    return [...me.hand].sort((a, b) => {
      if (a.r !== b.r) return a.r - b.r;
      return a.id.localeCompare(b.id);
    });
  }, [me.hand]);

  useEffect(() => {
    if (me.hand.length > prevHandLen.current && ref.current) {
      const el = ref.current;
      el.scrollTo({ left: 0, behavior: "smooth" });
    }
    prevHandLen.current = me.hand.length;
  }, [me.hand.length]);

  // Desktop wheel-to-horizontal-scroll. Mobile swiping and trackpad
  // horizontal-scrolling both work via the native `overflow-x-auto`; this
  // covers the third case — a normal PC mouse with only a vertical wheel,
  // which otherwise has no way to traverse a large hand. Attached natively
  // (not via React's onWheel) so we can pass `passive: false` and call
  // preventDefault to keep the page from scrolling instead.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      // Only intercept when there's actually somewhere to scroll horizontally,
      // so vertical-wheel events still bubble up on small hands.
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  return (
    <div className="relative h-32">
      <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 z-10" style={{ background: "linear-gradient(to right, rgba(13, 31, 24, 1), transparent)" }} />
      <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-6 z-10" style={{ background: "linear-gradient(to left, rgba(13, 31, 24, 1), transparent)" }} />

      <div
        ref={ref}
        className="hand-scroll flex items-end h-full overflow-x-auto overflow-y-visible gap-2 px-4 pb-2 pt-6"
        style={{ scrollbarWidth: "none", WebkitOverflowScrolling: "touch" }}
      >
        <style>{`.hand-scroll::-webkit-scrollbar { display: none; }`}</style>
        {sortedHand.map((c) => {
          const isSel = selected.includes(c.id) || swapPick.hand === c.id;
          return (
            <motion.button
              key={c.id}
              onClick={() => (state.phase === "swap" ? onSwapTap("hand", c.id) : onToggleSelect(c.id))}
              className="shrink-0"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: isSel ? -12 : 0, opacity: 1, scale: isSel ? 1.08 : 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 20 }}
              whileTap={{ scale: 1.1 }}
              style={{ zIndex: isSel ? 50 : 1 }}
            >
              <Card card={c} size="md" highlight={isSel} special={isSpecial(c.r)} />
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * Render one face-up playing card.
 *
 * - `highlight` — currently selected (lifted, glowing).
 * - `special` — has a special rule effect (2/3/7/10). Amber glow even when not
 *   selected.
 */
export function Card({ card, size = "md", highlight, special }: { card: CardType; size?: "sm" | "md"; highlight?: boolean; special?: boolean }) {
  const sizes = { sm: "w-12 h-16 text-xs", md: "w-16 h-24 text-base" };

  let boxShadow = "0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.8)";
  if (highlight) {
    boxShadow = "0 8px 24px rgba(255, 200, 100, 0.5)";
  } else if (special) {
    boxShadow = "0 0 14px rgba(255, 200, 100, 0.55), 0 4px 8px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.8)";
  }

  const borderClass = highlight
    ? "border-amber-400 ring-2 ring-amber-300/60"
    : special
    ? "border-amber-300 ring-1 ring-amber-300/40"
    : "border-stone-300";

  return (
    <div
      className={`${sizes[size]} rounded-lg bg-gradient-to-br from-stone-50 to-stone-200 border ${borderClass} shadow-lg flex flex-col justify-between p-1.5 relative overflow-hidden`}
      style={{ boxShadow }}
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

/**
 * Render the back of a card — used for the deck stack and face-down rows.
 *
 * Custom Parlor monogram: an italic "P" in a vintage diamond medallion,
 * amber-on-deep-red. Stylistically borrows from late-19th-century playing
 * card backs (concentric framing + central crest). Drawn as inline SVG so
 * it scales cleanly at every render size without rasterizing.
 */
export function CardBack({ size = "md" }: { size?: "sm" | "md" }) {
  const sizes = { sm: "w-12 h-16", md: "w-16 h-24" };
  return (
    <div className={`${sizes[size]} rounded-lg border border-amber-200/30 shadow-lg relative overflow-hidden`} style={{ background: "linear-gradient(135deg, #7a1818 0%, #4a0e0e 100%)" }}>
      <div className="absolute inset-1 border border-amber-200/20 rounded-md overflow-hidden">
        <svg viewBox="0 0 40 60" className="w-full h-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
          {/* Outer diamond medallion */}
          <path
            d="M 20 10 L 33 30 L 20 50 L 7 30 Z"
            fill="none"
            stroke="rgb(252 211 77 / 0.35)"
            strokeWidth="0.6"
          />
          {/* Inner diamond — thinner, gives the nested-frame vintage feel */}
          <path
            d="M 20 16 L 28 30 L 20 44 L 12 30 Z"
            fill="none"
            stroke="rgb(252 211 77 / 0.22)"
            strokeWidth="0.4"
          />
          {/* Corner ornaments — small dots reading as classic deco filigree */}
          <circle cx="5" cy="5" r="0.7" fill="rgb(252 211 77 / 0.4)" />
          <circle cx="35" cy="5" r="0.7" fill="rgb(252 211 77 / 0.4)" />
          <circle cx="5" cy="55" r="0.7" fill="rgb(252 211 77 / 0.4)" />
          <circle cx="35" cy="55" r="0.7" fill="rgb(252 211 77 / 0.4)" />
          {/* The Parlor monogram — italic serif P, the brand glyph */}
          <text
            x="20"
            y="36.5"
            fontFamily="Cormorant Garamond, Georgia, serif"
            fontSize="16"
            fontStyle="italic"
            fontWeight="600"
            textAnchor="middle"
            fill="rgb(252 211 77 / 0.6)"
          >
            P
          </text>
        </svg>
      </div>
    </div>
  );
}
