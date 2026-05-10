// Pure game engine — used by both client (rendering) and server (authoritative state).

export type Suit = "♠" | "♥" | "♦" | "♣";
export type Card = { s: Suit; r: number; id: string };

export type Player = {
  id: string;
  name: string;
  hand: Card[];
  faceUp: Card[];
  faceDown: Card[];
  finished: boolean;
  connected: boolean;
};

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
const RANKS = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 2];

export const rankLabel = (r: number) =>
  ({ 11: "J", 12: "Q", 13: "K", 14: "A" } as Record<number, string>)[r] || String(r);
export const isRed = (s: Suit) => s === "♥" || s === "♦";
const isSpecial = (r: number) => r === 2 || r === 3 || r === 10;

export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ s, r, id: `${r}${s}` });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// "Effective top" of the pile — skip 3s, since 3s are invisible.
// If the entire pile is 3s, treat as empty (anything plays).
function effectiveTop(pile: Card[]): Card | null {
  for (let i = pile.length - 1; i >= 0; i--) {
    if (pile[i].r !== 3) return pile[i];
  }
  return null;
}

export function canPlayOn(card: Card, pile: Card[], sevenActive: boolean): boolean {
  // 2, 3, 10 always playable
  if (card.r === 2 || card.r === 3 || card.r === 10) return true;
  const top = effectiveTop(pile);
  if (!top) return true; // empty pile (or all 3s)
  if (top.r === 2) return true; // reset means anything goes
  if (sevenActive) return card.r <= 7;
  return card.r >= top.r;
}

// Four of a kind — count from the top, ignoring 3s (since 3s are invisible).
// Returns true when the top 4 non-3 cards on the pile are all the same rank.
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

function nextPlayerId(players: Player[], currentId: string): string {
  const active = players.filter((p) => !p.finished);
  if (active.length <= 1) return currentId;
  const idx = players.findIndex((p) => p.id === currentId);
  let next = idx;
  do { next = (next + 1) % players.length; } while (players[next].finished);
  return players[next].id;
}

function drawUpTo3(player: Player, deck: Card[]) {
  while (player.hand.length < 3 && deck.length > 0) player.hand.push(deck.shift()!);
}

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
  if (deck.length > 0 && inHand) drawUpTo3(player, deck);

  let burnPile = state.burnPile;
  let newPile = pile;
  let sevenActive = state.sevenActive; // 3 preserves the previous state — see below
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
    // 3 is invisible — leave sevenActive as it was, since the 3 doesn't change pile state
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

  const currentPlayerId = extraTurn ? playerId : nextPlayerId(players, playerId);
  return { state: { ...state, players, deck, pile: newPile, burnPile, sevenActive, currentPlayerId, message, lastEvent: { type: eventType, playerId, ts: Date.now() } } };
}

export function applyPickup(state: GameState, playerId: string): { state: GameState; error?: string } {
  if (state.currentPlayerId !== playerId) return { state, error: "Not your turn" };
  if (state.pile.length === 0) return { state, error: "Nothing to pick up" };
  const players = state.players.map((p) => ({ ...p, hand: [...p.hand] }));
  const player = players.find((p) => p.id === playerId)!;
  player.hand.push(...state.pile);
  return { state: { ...state, players, pile: [], sevenActive: false, currentPlayerId: nextPlayerId(players, playerId), message: `${player.name} picked up`, lastEvent: { type: "pickup", playerId, ts: Date.now() } } };
}
