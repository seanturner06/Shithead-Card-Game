/**
 * @file Pure game engine for Shithead.
 *
 * Shared by both client (rendering / optimistic UI hints) and server
 * (authoritative state). Every function in this module is a pure transform
 * over {@link GameState} — no I/O, no React, no PartyKit imports. That's
 * deliberate: it keeps the engine portable and trivially testable
 * (see `game.test.ts`).
 *
 * House rules implemented here:
 * - **2** — reset. Plays on anything; next player can play anything.
 * - **3** — invisible. Plays on anything; the pile behaves as if the 3 isn't
 *   there, so the next player reacts to the card underneath. A pile of all
 *   3s is treated as empty (anything plays).
 * - **7** — restrictor. Next player must play a card of rank 7 or lower.
 * - **10** — burn. The entire pile goes to the burn pile and the player goes
 *   again.
 * - **Four of a kind on top** burns the pile (skipping 3s when scanning, since
 *   3s are invisible). Player goes again.
 * - Multiple same-rank cards may be played in one move.
 *
 * @see {@link canPlayOn} for the legality check.
 * @see {@link applyPlay} for the main action handler.
 */

/** The four playing-card suits, rendered as their unicode glyphs. */
export type Suit = "♠" | "♥" | "♦" | "♣";

/**
 * A single playing card.
 *
 * - `r` is the rank as an integer 2..14 (where J=11, Q=12, K=13, A=14).
 *   2 sits **after** the ace in the deck-building order — it's a special card,
 *   not a low card — but its numeric rank is still 2.
 * - `id` is unique per card and stable across server → client snapshots.
 *   It's the identifier the client uses when telling the server which card
 *   to play.
 */
export type Card = { s: Suit; r: number; id: string };

/**
 * Per-player state. A "seat" in the room.
 *
 * - `hand` — cards only this player can see.
 * - `faceUp` — visible to everyone, played after the hand is empty.
 * - `faceDown` — hidden from everyone (including the owner) until flipped
 *   one-by-one in the endgame.
 * - `finished` — true once the player has played their last card. The game
 *   ends when only one player is still `finished: false` — that player is
 *   the Shithead.
 * - `connected` — websocket connection status. Used purely for UI; a
 *   disconnected player keeps their seat and state.
 */
export type Player = {
  id: string;
  name: string;
  hand: Card[];
  faceUp: Card[];
  faceDown: Card[];
  finished: boolean;
  connected: boolean;
};

/**
 * The full, authoritative game state.
 *
 * The server stores one of these per room in PartyKit storage; the client
 * receives masked views (see `viewFor` in `party/server.ts`) that hide other
 * players' hidden cards and the deck contents.
 *
 * Phases:
 * - `lobby` — players joining; host can deal when ≥2 are seated.
 * - `swap` — cards dealt; players may swap hand ↔ face-up before readying up.
 * - `playing` — normal play. `currentPlayerId` is whose turn it is.
 * - `over` — game finished; `loserId` points at the Shithead.
 *
 * `sevenActive` is the only sticky modifier — when true, the next play must
 * be rank ≤ 7. It clears on any non-3 play (including the next valid ≤7 play
 * and pickup).
 *
 * `lastEvent` is a hint for client-side animations (BURN / RESET / PICK UP
 * flashes etc.). It's not used for any game logic.
 */
export type GameState = {
  players: Player[];
  deck: Card[];
  pile: Card[];
  burnPile: Card[];
  currentPlayerId: string | null;
  sevenActive: boolean;
  phase: "lobby" | "swap" | "playing" | "over";
  message: string;
  loserId: string | null;
  lastEvent: { type: string; playerId?: string; ts: number } | null;
  hostId: string;
};

const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];
// 2 sorts last so it isn't picked as the "lowest non-special" starter card.
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

/**
 * Human label for a rank — faces and aces become letters, others stay numeric.
 * @example rankLabel(11) // "J"
 * @example rankLabel(7)  // "7"
 */
export const rankLabel = (r: number) =>
  ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] || String(r);

/** True if the suit should render red (hearts or diamonds). */
export const isRed = (s: Suit) => s === "♥" || s === "♦";

// Internal: which ranks bypass the normal "≥ top" rule. Used by startPlay to
// avoid picking a special card as the lowest-card starter. UI has its own
// isSpecial that includes 7 (for the glow effect).
const isSpecial = (r: number) => r === 2 || r === 3 || r === 10;

/**
 * Build and shuffle a fresh 52-card deck.
 *
 * Uses Fisher–Yates. Each card gets an `id` of form `"<rank><suit>"`,
 * unique within the deck.
 */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r, id: `${r}${s}` });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Find the "effective top" of the pile — the topmost non-3 card.
 *
 * Returns `null` if the pile is empty OR consists entirely of 3s. Both cases
 * mean "anything plays next" since 3s are invisible.
 *
 * Exported so the UI can show "what's under the 3" in the pile peek interaction.
 */
export function effectiveTop(pile: Card[]): Card | null {
  for (let i = pile.length - 1; i >= 0; i--) {
    if (pile[i].r !== 3) return pile[i];
  }
  return null;
}

/**
 * Whether `card` can legally play on `pile` given the current 7-active state.
 *
 * Rules, in priority order:
 * 1. **2, 3, 10 always play**, regardless of pile or 7-active.
 * 2. **Empty effective pile** (no pile, or all 3s) — anything plays.
 * 3. **Top is a 2** — anything plays (the 2 is a reset).
 * 4. **`sevenActive`** — card must be rank ≤ 7.
 * 5. Otherwise — card rank must be ≥ the effective top's rank.
 *
 * Used both client-side (to enable/disable cards) and server-side (to validate
 * incoming plays). Same function, same result — clients can't fake legality
 * because the server re-runs this check.
 */
export function canPlayOn(card: Card, pile: Card[], sevenActive: boolean): boolean {
  if (card.r === 2 || card.r === 3 || card.r === 10) return true;
  const top = effectiveTop(pile);
  if (!top) return true;
  if (top.r === 2) return true;
  if (sevenActive) return card.r <= 7;
  return card.r >= top.r;
}

/**
 * Whether the top of the pile is four cards of the same rank (a burn condition).
 *
 * Scans from the top, **ignoring 3s** (since 3s are invisible). Returns true
 * iff the top 4 non-3 cards share a rank. A pile with fewer than 4 non-3 cards
 * returns false.
 *
 * Note: this scan only catches the trivial case where the top 4 visible cards
 * happen to match. Long-tail four-of-a-kind across many turns is still
 * detected because each play re-checks against the new top.
 */
export function fourOfAKindTop(pile: Card[]): boolean {
  const visible: Card[] = [];
  for (let i = pile.length - 1; i >= 0; i--) {
    if (pile[i].r !== 3) {
      visible.push(pile[i]);
      if (visible.length === 4) break;
    }
  }
  if (visible.length < 4) return false;
  return visible.every((c) => c.r === visible[0].r);
}

/**
 * Create a new game in the lobby phase with the host as the only seated player.
 * Other players are added via the `join` server message.
 */
export function createInitialState(hostId: string, hostName: string): GameState {
  return {
    players: [
      { id: hostId, name: hostName, hand: [], faceUp: [], faceDown: [], finished: false, connected: true },
    ],
    deck: [],
    pile: [],
    burnPile: [],
    currentPlayerId: null,
    sevenActive: false,
    phase: "lobby",
    message: "Waiting for players to join…",
    loserId: null,
    lastEvent: null,
    hostId,
  };
}

/**
 * Deal cards to every seated player and enter the swap phase.
 *
 * Each player receives 3 face-down, 3 face-up (placed on top of the face-down),
 * and 3 in hand. Pile and burn pile are cleared; `sevenActive` is reset.
 *
 * Idempotent at the state-machine level — calling this on an already-dealt
 * state will reshuffle and redeal.
 */
export function dealGame(state: GameState): GameState {
  const deck = buildDeck();
  const players = state.players.map((p) => ({
    ...p,
    faceDown: deck.splice(0, 3),
    faceUp: deck.splice(0, 3),
    hand: deck.splice(0, 3),
    finished: false,
  }));
  return { ...state, players, deck, pile: [], burnPile: [], phase: "swap", message: "Swap cards, then ready up", sevenActive: false, loserId: null };
}

/**
 * Transition from swap phase into active play.
 *
 * The starter is whichever player holds the lowest non-special card in hand
 * (ties go to whoever was checked first — i.e. seat order). If no player has
 * a non-special card at all, falls back to the first seated player.
 */
export function startPlay(state: GameState): GameState {
  let starterId = state.players[0].id;
  let bestRank = 999;
  for (const p of state.players) {
    for (const c of p.hand) {
      if (!isSpecial(c.r) && c.r < bestRank) {
        bestRank = c.r;
        starterId = p.id;
      }
    }
  }
  return { ...state, phase: "playing", currentPlayerId: starterId, message: `${state.players.find((p) => p.id === starterId)?.name} starts` };
}

/**
 * Advance the turn pointer, skipping any players who have finished.
 *
 * If only one (or zero) active players remain, returns `currentId` unchanged —
 * this case is handled by the game-over check in {@link applyPlay}.
 */
function nextPlayerId(players: Player[], currentId: string): string {
  const active = players.filter((p) => !p.finished);
  if (active.length <= 1) return currentId;
  const idx = players.findIndex((p) => p.id === currentId);
  let next = idx;
  do { next = (next + 1) % players.length; } while (players[next].finished);
  return players[next].id;
}

/** Mutates `player.hand` to refill from `deck` up to 3 cards. */
function drawUpTo3(player: Player, deck: Card[]) {
  while (player.hand.length < 3 && deck.length > 0) player.hand.push(deck.shift()!);
}

/**
 * Swap one card from a player's hand with one of their face-up cards.
 *
 * Intended for use during the `swap` phase before play begins. No-op if either
 * card id is unknown for that player. Doesn't validate phase — that's the
 * server's job; this function is permissive so it can be reused for testing.
 */
export function applySwap(state: GameState, playerId: string, handCardId: string, faceUpCardId: string): GameState {
  const players = state.players.map((p) => {
    if (p.id !== playerId) return p;
    const handCard = p.hand.find((c) => c.id === handCardId);
    const faceUpCard = p.faceUp.find((c) => c.id === faceUpCardId);
    if (!handCard || !faceUpCard) return p;
    return {
      ...p,
      hand: p.hand.map((c) => (c.id === handCardId ? faceUpCard : c)),
      faceUp: p.faceUp.map((c) => (c.id === faceUpCardId ? handCard : c)),
    };
  });
  return { ...state, players };
}

/**
 * Apply a play action and return the resulting state (or an error).
 *
 * The single biggest function in the engine. Handles, in order:
 *
 * 1. **Turn / input validation** — returns `error` for not-your-turn, empty
 *    selection, mixed ranks, or unknown card ids.
 *
 * 2. **Zone resolution** — figures out whether the cards came from `hand`,
 *    `faceUp`, or `faceDown`. Enforces the "hand → face-up → face-down" play
 *    order (you can't play face-up while you still have a hand, etc.).
 *
 * 3. **Legality check** — `canPlayOn`. For face-down plays, an illegal flip
 *    is *not* an error; instead the player picks up the whole pile plus the
 *    flipped card, and the turn passes. For hand/face-up, illegal plays
 *    return `error: "Can't play that"`.
 *
 * 4. **Pile update + draw** — moves the played cards to the pile, and if the
 *    play came from `hand`, draws back up to 3 from the deck.
 *
 * 5. **Special effects** — 10 burns, 2 resets `sevenActive`, 3 preserves
 *    `sevenActive` (it's invisible), 7 sets `sevenActive`, four-of-a-kind on
 *    top burns. Normal plays clear `sevenActive`.
 *
 * 6. **Finish detection** — if the player has no cards left in any zone they
 *    become `finished`. If that leaves exactly one non-finished player, the
 *    game ends and that lone survivor is the loser (Shithead).
 *
 * 7. **Turn advancement** — burns and four-of-a-kind grant an extra turn
 *    (player stays current). Otherwise the turn passes to the next
 *    non-finished player.
 *
 * The function never mutates the input state — it shallow-clones players
 * and arrays before modifying them.
 *
 * @returns `{ state }` on success, or `{ state, error }` if the action was
 * rejected. On error, the returned `state` is the unchanged input.
 */
export function applyPlay(state: GameState, playerId: string, cardIds: string[]): { state: GameState; error?: string } {
  if (state.currentPlayerId !== playerId) return { state, error: "Not your turn" };
  if (cardIds.length === 0) return { state, error: "No cards" };

  const players = state.players.map((p) => ({ ...p, hand: [...p.hand], faceUp: [...p.faceUp], faceDown: [...p.faceDown] }));
  const player = players.find((p) => p.id === playerId)!;

  const inHand = cardIds.every((id) => player.hand.some((c) => c.id === id));
  const inFaceUp = !inHand && cardIds.every((id) => player.faceUp.some((c) => c.id === id));
  const inFaceDown = !inHand && !inFaceUp && cardIds.length === 1 && player.faceDown.some((c) => c.id === cardIds[0]);

  if (!inHand && !inFaceUp && !inFaceDown) return { state, error: "Invalid cards" };
  if (inFaceUp && player.hand.length > 0) return { state, error: "Play hand first" };
  if (inFaceDown && (player.hand.length > 0 || player.faceUp.length > 0)) return { state, error: "Play hand and face-up first" };

  let cards: Card[];
  if (inHand) cards = cardIds.map((id) => player.hand.find((c) => c.id === id)!);
  else if (inFaceUp) cards = cardIds.map((id) => player.faceUp.find((c) => c.id === id)!);
  else cards = [player.faceDown.find((c) => c.id === cardIds[0])!];

  if (!cards.every((c) => c.r === cards[0].r)) return { state, error: "Same rank only" };

  const pile = [...state.pile];

  if (inFaceDown) {
    // Face-down is a blind flip. Illegal flips don't error — they trigger
    // a forced pickup of the pile + the flipped card.
    const card = cards[0];
    if (!canPlayOn(card, pile, state.sevenActive)) {
      player.faceDown = player.faceDown.filter((c) => c.id !== card.id);
      player.hand.push(...pile, card);
      const nextId = nextPlayerId(players, playerId);
      return { state: { ...state, players, pile: [], sevenActive: false, currentPlayerId: nextId, message: `${player.name} flipped ${rankLabel(card.r)} — picked up`, lastEvent: { type: "pickup", playerId, ts: Date.now() } } };
    }
  } else {
    if (!canPlayOn(cards[0], pile, state.sevenActive)) return { state, error: "Can't play that" };
  }

  if (inHand) player.hand = player.hand.filter((c) => !cardIds.includes(c.id));
  else if (inFaceUp) player.faceUp = player.faceUp.filter((c) => !cardIds.includes(c.id));
  else player.faceDown = player.faceDown.filter((c) => !cardIds.includes(c.id));

  pile.push(...cards);
  const deck = [...state.deck];
  // Drawing only happens when playing from hand — face-up / face-down plays
  // don't refill the hand. (And by the time you're on face-up, the deck is
  // empty anyway in any normal game.)
  if (deck.length > 0 && inHand) drawUpTo3(player, deck);

  let burnPile = state.burnPile;
  let newPile = pile;
  let sevenActive = state.sevenActive; // 3 preserves this — see the 3 branch below.
  let extraTurn = false;
  let message = `${player.name} played ${rankLabel(cards[0].r)}`;
  let eventType = "play";

  if (cards[0].r === 10) {
    burnPile = [...burnPile, ...pile]; newPile = []; extraTurn = true;
    sevenActive = false;
    message = `${player.name} burned the pile 🔥`; eventType = "burn";
  } else if (fourOfAKindTop(pile)) {
    burnPile = [...burnPile, ...pile]; newPile = []; extraTurn = true;
    sevenActive = false;
    message = `Four of a kind! ${player.name} burned 🔥`; eventType = "burn";
  } else if (cards[0].r === 2) {
    sevenActive = false;
    message = `${player.name} played a 2 — reset`; eventType = "reset";
  } else if (cards[0].r === 3) {
    // 3 is invisible — leave sevenActive untouched. The card sits on top of
    // the pile, but the next player reacts to whatever's underneath.
    message = `${player.name} played a 3 — invisible`;
    eventType = "play";
  } else if (cards[0].r === 7) {
    sevenActive = true;
    message = `${player.name} played 7 — next ≤7`;
  } else {
    sevenActive = false;
  }

  if (player.hand.length === 0 && player.faceUp.length === 0 && player.faceDown.length === 0) {
    player.finished = true;
    message = `${player.name} is OUT! 🎉`; eventType = "finish";
  }

  const stillIn = players.filter((p) => !p.finished);
  if (stillIn.length === 1) {
    return { state: { ...state, players, deck, pile: newPile, burnPile, sevenActive, phase: "over", loserId: stillIn[0].id, message: `${stillIn[0].name} is the Shithead 💩`, lastEvent: { type: "gameover", ts: Date.now() } } };
  }

  // If the player earned an extra turn (10 burn or four-of-a-kind) but went
  // out on that same play, hand the turn to the next active player instead —
  // they have no cards to play, so the extra turn is meaningless and would
  // deadlock the game.
  const currentPlayerId = extraTurn && !player.finished ? playerId : nextPlayerId(players, playerId);
  return { state: { ...state, players, deck, pile: newPile, burnPile, sevenActive, currentPlayerId, message, lastEvent: { type: eventType, playerId, ts: Date.now() } } };
}

/**
 * Apply a pickup action — current player takes the whole pile into their hand.
 *
 * Always clears `sevenActive`. Errors if it isn't this player's turn or if
 * the pile is already empty. Turn passes to the next non-finished player.
 *
 * (The face-down illegal-flip pickup is handled inside {@link applyPlay}, not
 * here — that one is involuntary and bundles the flipped card with the pile.)
 */
export function applyPickup(state: GameState, playerId: string): { state: GameState; error?: string } {
  if (state.currentPlayerId !== playerId) return { state, error: "Not your turn" };
  if (state.pile.length === 0) return { state, error: "Nothing to pick up" };
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const player = players.find((p) => p.id === playerId)!;
  player.hand.push(...state.pile);
  return { state: { ...state, players, pile: [], sevenActive: false, currentPlayerId: nextPlayerId(players, playerId), message: `${player.name} picked up`, lastEvent: { type: "pickup", playerId, ts: Date.now() } } };
}
