import { describe, it, expect } from "vitest";
import {
  buildDeck,
  canPlayOn,
  fourOfAKindTop,
  rankLabel,
  isRed,
  createInitialState,
  dealGame,
  startPlay,
  applySwap,
  applyPlay,
  applyPickup,
  type Card,
  type GameState,
  type Player,
  type Suit,
} from "./game";

const card = (r: number, s: Suit = "♠", id?: string): Card => ({
  r,
  s,
  id: id ?? `${r}${s}-${Math.random().toString(36).slice(2, 8)}`,
});

const player = (id: string, overrides: Partial<Player> = {}): Player => ({
  id,
  name: id.toUpperCase(),
  hand: [],
  faceUp: [],
  faceDown: [],
  finished: false,
  connected: true,
  ...overrides,
});

const baseState = (overrides: Partial<GameState> = {}): GameState => ({
  players: [],
  deck: [],
  pile: [],
  burnPile: [],
  currentPlayerId: null,
  sevenActive: false,
  phase: "playing",
  message: "",
  loserId: null,
  lastEvent: null,
  hostId: "a",
  ...overrides,
});

describe("rankLabel", () => {
  it("maps face cards to letters", () => {
    expect(rankLabel(11)).toBe("J");
    expect(rankLabel(12)).toBe("Q");
    expect(rankLabel(13)).toBe("K");
    expect(rankLabel(14)).toBe("A");
  });
  it("returns numeric string for number cards", () => {
    expect(rankLabel(2)).toBe("2");
    expect(rankLabel(7)).toBe("7");
    expect(rankLabel(10)).toBe("10");
  });
});

describe("isRed", () => {
  it("returns true for hearts and diamonds", () => {
    expect(isRed("♥")).toBe(true);
    expect(isRed("♦")).toBe(true);
  });
  it("returns false for spades and clubs", () => {
    expect(isRed("♠")).toBe(false);
    expect(isRed("♣")).toBe(false);
  });
});

describe("buildDeck", () => {
  it("returns 52 cards", () => {
    expect(buildDeck()).toHaveLength(52);
  });
  it("has 13 of each suit and 4 of each rank", () => {
    const deck = buildDeck();
    const bySuit: Record<string, number> = {};
    const byRank: Record<number, number> = {};
    for (const c of deck) {
      bySuit[c.s] = (bySuit[c.s] || 0) + 1;
      byRank[c.r] = (byRank[c.r] || 0) + 1;
    }
    for (const s of ["♠", "♥", "♦", "♣"]) expect(bySuit[s]).toBe(13);
    for (const r of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) {
      expect(byRank[r]).toBe(4);
    }
  });
  it("assigns each card a unique id", () => {
    const ids = new Set(buildDeck().map((c) => c.id));
    expect(ids.size).toBe(52);
  });
});

describe("canPlayOn", () => {
  it("allows anything on an empty pile", () => {
    expect(canPlayOn(card(4), [], false)).toBe(true);
    expect(canPlayOn(card(14), [], false)).toBe(true);
  });

  it("allows 2, 3, 10 on anything", () => {
    const pile = [card(14)]; // Ace on top
    expect(canPlayOn(card(2), pile, false)).toBe(true);
    expect(canPlayOn(card(3), pile, false)).toBe(true);
    expect(canPlayOn(card(10), pile, false)).toBe(true);
  });

  it("requires rank >= top for normal play", () => {
    const pile = [card(7)];
    expect(canPlayOn(card(6), pile, false)).toBe(false);
    expect(canPlayOn(card(7), pile, false)).toBe(true);
    expect(canPlayOn(card(8), pile, false)).toBe(true);
  });

  it("treats top-2 as reset (anything plays)", () => {
    const pile = [card(14), card(2)];
    expect(canPlayOn(card(4), pile, false)).toBe(true);
  });

  it("restricts to <=7 when sevenActive", () => {
    const pile = [card(7)];
    expect(canPlayOn(card(6), pile, true)).toBe(true);
    expect(canPlayOn(card(7), pile, true)).toBe(true);
    expect(canPlayOn(card(8), pile, true)).toBe(false);
  });

  it("skips 3s when checking the effective top", () => {
    // visible top is K — 3s above are invisible
    const pile = [card(13), card(3), card(3)];
    expect(canPlayOn(card(4), pile, false)).toBe(false);
    expect(canPlayOn(card(13), pile, false)).toBe(true);
  });

  it("treats an all-3s pile as empty", () => {
    const pile = [card(3), card(3), card(3)];
    expect(canPlayOn(card(4), pile, false)).toBe(true);
  });
});

describe("fourOfAKindTop", () => {
  it("returns true when top 4 cards share a rank", () => {
    const pile = [card(4), card(7), card(7), card(7), card(7)];
    expect(fourOfAKindTop(pile)).toBe(true);
  });
  it("returns false when fewer than 4 non-3 cards exist", () => {
    expect(fourOfAKindTop([card(5), card(5), card(5)])).toBe(false);
    expect(fourOfAKindTop([card(5), card(3), card(3), card(5), card(3)])).toBe(false);
  });
  it("returns false when top 4 are not all same rank", () => {
    expect(fourOfAKindTop([card(5), card(5), card(5), card(6)])).toBe(false);
  });
  it("ignores 3s when scanning for four-of-a-kind", () => {
    const pile = [card(5), card(3), card(5), card(3), card(5), card(3), card(5)];
    expect(fourOfAKindTop(pile)).toBe(true);
  });
});

describe("createInitialState", () => {
  it("starts with one player in lobby phase", () => {
    const s = createInitialState("a", "Alice");
    expect(s.phase).toBe("lobby");
    expect(s.players).toHaveLength(1);
    expect(s.players[0]).toMatchObject({
      id: "a",
      name: "Alice",
      connected: true,
      finished: false,
    });
    expect(s.hostId).toBe("a");
  });
});

describe("dealGame", () => {
  it("gives every player 3 hand / 3 faceUp / 3 faceDown and enters swap", () => {
    const s = createInitialState("a", "A");
    s.players.push(player("b", { name: "B" }));
    const dealt = dealGame(s);
    expect(dealt.phase).toBe("swap");
    for (const p of dealt.players) {
      expect(p.hand).toHaveLength(3);
      expect(p.faceUp).toHaveLength(3);
      expect(p.faceDown).toHaveLength(3);
    }
    // 52 - (2 players * 9 cards) = 34 left in deck
    expect(dealt.deck).toHaveLength(52 - 2 * 9);
  });

  it("hands out distinct cards across all players", () => {
    const s = createInitialState("a", "A");
    s.players.push(player("b"));
    s.players.push(player("c"));
    const dealt = dealGame(s);
    const allIds: string[] = [];
    for (const p of dealt.players) {
      allIds.push(...p.hand.map((c) => c.id));
      allIds.push(...p.faceUp.map((c) => c.id));
      allIds.push(...p.faceDown.map((c) => c.id));
    }
    expect(new Set(allIds).size).toBe(allIds.length);
  });
});

describe("startPlay", () => {
  it("picks the player with the lowest non-special hand card", () => {
    const s = baseState({
      phase: "swap",
      players: [
        player("a", { hand: [card(8), card(2), card(13)] }),
        player("b", { hand: [card(4), card(10), card(11)] }),
        player("c", { hand: [card(9), card(3), card(7)] }),
      ],
    });
    const next = startPlay(s);
    expect(next.phase).toBe("playing");
    expect(next.currentPlayerId).toBe("b");
  });

  it("falls back to first player if nobody has a non-special card", () => {
    const s = baseState({
      phase: "swap",
      players: [
        player("a", { hand: [card(2), card(3), card(10)] }),
        player("b", { hand: [card(2), card(3), card(10)] }),
      ],
    });
    const next = startPlay(s);
    expect(next.currentPlayerId).toBe("a");
  });
});

describe("applySwap", () => {
  it("swaps a hand card with a face-up card", () => {
    const s = baseState({
      players: [
        player("a", {
          hand: [card(5, "♠", "5♠"), card(7, "♥", "7♥")],
          faceUp: [card(12, "♥", "Q♥"), card(8, "♦", "8♦")],
        }),
      ],
    });
    const next = applySwap(s, "a", "5♠", "Q♥");
    const p = next.players[0];
    expect(p.hand.map((c) => c.id).sort()).toEqual(["7♥", "Q♥"]);
    expect(p.faceUp.map((c) => c.id).sort()).toEqual(["5♠", "8♦"]);
  });

  it("is a no-op when card ids are unknown", () => {
    const s = baseState({
      players: [
        player("a", {
          hand: [card(5, "♠", "5♠")],
          faceUp: [card(12, "♥", "Q♥")],
        }),
      ],
    });
    const next = applySwap(s, "a", "nope", "Q♥");
    expect(next.players[0].hand.map((c) => c.id)).toEqual(["5♠"]);
    expect(next.players[0].faceUp.map((c) => c.id)).toEqual(["Q♥"]);
  });
});

describe("applyPlay — error paths", () => {
  it("rejects play when it isn't your turn", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", { hand: [card(5, "♠", "5♠")] }),
        player("b", { hand: [card(6, "♠", "6♠")] }),
      ],
    });
    expect(applyPlay(s, "b", ["6♠"]).error).toBe("Not your turn");
  });

  it("rejects empty card list", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [player("a", { hand: [card(5, "♠", "5♠")] })],
    });
    expect(applyPlay(s, "a", []).error).toBe("No cards");
  });

  it("rejects multi-card play of mixed ranks", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", {
          hand: [card(5, "♠", "5♠"), card(6, "♥", "6♥")],
        }),
      ],
    });
    expect(applyPlay(s, "a", ["5♠", "6♥"]).error).toBe("Same rank only");
  });

  it("rejects a card that can't legally play on the pile", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(13)], // K on top
      players: [player("a", { hand: [card(4, "♠", "4♠")] })],
    });
    expect(applyPlay(s, "a", ["4♠"]).error).toBe("Can't play that");
  });

  it("forbids face-up play while hand is non-empty", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", {
          hand: [card(5)],
          faceUp: [card(7, "♠", "7♠")],
        }),
      ],
    });
    expect(applyPlay(s, "a", ["7♠"]).error).toBe("Play hand first");
  });

  it("forbids face-down play while hand or face-up remain", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", {
          hand: [],
          faceUp: [card(7)],
          faceDown: [card(8, "♠", "8♠")],
        }),
      ],
    });
    expect(applyPlay(s, "a", ["8♠"]).error).toBe("Play hand and face-up first");
  });

  it("rejects unknown card ids", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [player("a", { hand: [card(5)] })],
    });
    expect(applyPlay(s, "a", ["does-not-exist"]).error).toBe("Invalid cards");
  });
});

describe("applyPlay — basics", () => {
  it("plays from hand: removes card, pushes to pile, advances turn", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", { hand: [card(5, "♠", "5♠"), card(8, "♥", "8♥")] }),
        player("b", { hand: [card(6)] }),
      ],
    });
    const { state, error } = applyPlay(s, "a", ["5♠"]);
    expect(error).toBeUndefined();
    expect(state.pile.map((c) => c.id)).toEqual(["5♠"]);
    expect(state.players[0].hand.map((c) => c.id)).toEqual(["8♥"]);
    expect(state.currentPlayerId).toBe("b");
  });

  it("draws back up to 3 from the deck after a hand play", () => {
    const s = baseState({
      currentPlayerId: "a",
      deck: [card(11, "♠", "J♠"), card(12, "♥", "Q♥"), card(13, "♦", "K♦")],
      players: [
        player("a", {
          hand: [card(5, "♠", "5♠"), card(8, "♥", "8♥"), card(9, "♦", "9♦")],
        }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["5♠"]);
    expect(state.players[0].hand).toHaveLength(3);
    expect(state.players[0].hand.map((c) => c.id)).toContain("J♠");
    expect(state.deck.map((c) => c.id)).toEqual(["Q♥", "K♦"]);
  });

  it("does not draw when the deck is empty", () => {
    const s = baseState({
      currentPlayerId: "a",
      deck: [],
      players: [
        player("a", { hand: [card(5, "♠", "5♠"), card(8)] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["5♠"]);
    expect(state.players[0].hand).toHaveLength(1);
  });

  it("plays multiple same-rank cards in one go", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", {
          hand: [card(7, "♠", "7♠"), card(7, "♥", "7♥"), card(9)],
        }),
        player("b"),
      ],
    });
    const { state, error } = applyPlay(s, "a", ["7♠", "7♥"]);
    expect(error).toBeUndefined();
    expect(state.pile).toHaveLength(2);
    expect(state.sevenActive).toBe(true);
  });
});

describe("applyPlay — special cards", () => {
  it("10 burns the pile and grants an extra turn", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(4), card(5)],
      players: [
        player("a", { hand: [card(10, "♠", "10♠"), card(4, "♥", "4♥")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["10♠"]);
    expect(state.pile).toEqual([]);
    expect(state.burnPile).toHaveLength(3);
    expect(state.currentPlayerId).toBe("a");
    expect(state.lastEvent?.type).toBe("burn");
  });

  it("2 resets the pile and clears sevenActive", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(7, "♠", "7♠")],
      sevenActive: true,
      players: [
        player("a", { hand: [card(2, "♥", "2♥"), card(4, "♣", "4♣")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["2♥"]);
    expect(state.sevenActive).toBe(false);
    expect(state.lastEvent?.type).toBe("reset");
    expect(state.currentPlayerId).toBe("b");
  });

  it("3 plays invisibly and preserves sevenActive", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(7, "♠", "7♠")],
      sevenActive: true,
      players: [
        player("a", { hand: [card(3, "♥", "3♥")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["3♥"]);
    expect(state.sevenActive).toBe(true);
    expect(state.pile).toHaveLength(2);
  });

  it("7 sets sevenActive", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", { hand: [card(7, "♠", "7♠")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["7♠"]);
    expect(state.sevenActive).toBe(true);
  });

  it("four-of-a-kind on top burns the pile", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [
        card(4),
        card(8, "♠", "8♠"),
        card(8, "♥", "8♥"),
        card(8, "♦", "8♦"),
      ],
      players: [
        player("a", { hand: [card(8, "♣", "8♣"), card(4, "♥", "4♥")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["8♣"]);
    expect(state.pile).toEqual([]);
    expect(state.currentPlayerId).toBe("a");
    expect(state.lastEvent?.type).toBe("burn");
  });

  it("four-of-a-kind detection ignores intervening 3s", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [
        card(8, "♠", "8♠"),
        card(3, "♥", "3♥"),
        card(8, "♥", "8♥"),
        card(3, "♦", "3♦"),
        card(8, "♦", "8♦"),
      ],
      players: [
        player("a", { hand: [card(8, "♣", "8♣"), card(4, "♥", "4♥")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["8♣"]);
    expect(state.pile).toEqual([]);
    expect(state.lastEvent?.type).toBe("burn");
  });

  it("normal play after a 7 clears sevenActive", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(7, "♠", "7♠")],
      sevenActive: true,
      players: [
        player("a", { hand: [card(6, "♥", "6♥")] }),
        player("b"),
      ],
    });
    const { state } = applyPlay(s, "a", ["6♥"]);
    expect(state.sevenActive).toBe(false);
  });
});

describe("applyPlay — face-up and face-down", () => {
  it("plays multiple same-rank face-up cards in one go", () => {
    const s = baseState({
      currentPlayerId: "a",
      deck: [],
      players: [
        player("a", {
          hand: [],
          faceUp: [card(7, "♠", "7s"), card(7, "♥", "7h"), card(11, "♣", "Jc")],
          faceDown: [card(4), card(5), card(6)],
        }),
        player("b"),
      ],
      pile: [card(5, "♦", "5d")],
    });
    const { state, error } = applyPlay(s, "a", ["7s", "7h"]);
    expect(error).toBeUndefined();
    expect(state.players[0].faceUp).toHaveLength(1);
    expect(state.players[0].faceUp[0].id).toBe("Jc");
    expect(state.pile.map((c) => c.id)).toEqual(["5d", "7s", "7h"]);
  });

  it("plays from face-up once the hand is empty", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", {
          hand: [],
          faceUp: [card(8, "♠", "8♠")],
          faceDown: [card(9)],
        }),
        player("b"),
      ],
    });
    const { state, error } = applyPlay(s, "a", ["8♠"]);
    expect(error).toBeUndefined();
    expect(state.players[0].faceUp).toHaveLength(0);
    expect(state.pile.map((c) => c.id)).toEqual(["8♠"]);
  });

  it("plays from face-down when legal", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(5)],
      players: [
        player("a", {
          hand: [],
          faceUp: [],
          faceDown: [card(11, "♠", "J♠")],
        }),
        player("b"),
      ],
    });
    const { state, error } = applyPlay(s, "a", ["J♠"]);
    expect(error).toBeUndefined();
    expect(state.players[0].faceDown).toEqual([]);
    expect(state.pile).toHaveLength(2);
  });

  it("on illegal face-down flip, player picks up pile + flipped card", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(13, "♠", "K♠")],
      players: [
        player("a", {
          hand: [],
          faceUp: [],
          faceDown: [card(4, "♥", "4♥")],
        }),
        player("b"),
      ],
    });
    const { state, error } = applyPlay(s, "a", ["4♥"]);
    expect(error).toBeUndefined();
    expect(state.pile).toEqual([]);
    expect(state.players[0].hand.map((c) => c.id).sort()).toEqual(["4♥", "K♠"]);
    expect(state.players[0].faceDown).toEqual([]);
    expect(state.currentPlayerId).toBe("b");
    expect(state.lastEvent?.type).toBe("pickup");
  });
});

describe("applyPlay — finishing and game over", () => {
  it("marks player finished when last card is played", () => {
    const s = baseState({
      currentPlayerId: "a",
      deck: [],
      players: [
        player("a", { hand: [card(11, "♠", "J♠")], faceUp: [], faceDown: [] }),
        player("b"),
        player("c"),
      ],
    });
    const { state } = applyPlay(s, "a", ["J♠"]);
    expect(state.players[0].finished).toBe(true);
    expect(state.lastEvent?.type).toBe("finish");
  });

  it("ends the game and names the last player standing as the shithead", () => {
    const s = baseState({
      currentPlayerId: "a",
      deck: [],
      players: [
        player("a", { hand: [card(11, "♠", "J♠")], faceUp: [], faceDown: [] }),
        player("b", { finished: true }),
        player("c", { hand: [card(4)] }),
      ],
    });
    const { state } = applyPlay(s, "a", ["J♠"]);
    expect(state.phase).toBe("over");
    expect(state.loserId).toBe("c");
  });

  it("passes the turn to the next active player when finishing with a burn", () => {
    // Regression: a player who finished their last card via a 10 (or
    // four-of-a-kind) used to keep the turn because of the burn's
    // extra-turn rule. With no cards left to play, the game deadlocked.
    const s = baseState({
      currentPlayerId: "a",
      deck: [],
      players: [
        player("a", { hand: [card(10, "♠", "10s")], faceUp: [], faceDown: [] }),
        player("b", { hand: [card(5)] }),
        player("c", { hand: [card(6)] }),
      ],
      pile: [card(7, "♥", "7h")],
    });
    const { state } = applyPlay(s, "a", ["10s"]);
    expect(state.players[0].finished).toBe(true);
    expect(state.currentPlayerId).toBe("b");
  });

  it("passes the turn when finishing with a four-of-a-kind", () => {
    const s = baseState({
      currentPlayerId: "a",
      deck: [],
      players: [
        player("a", {
          hand: [
            card(5, "♠", "5s"),
            card(5, "♥", "5h"),
            card(5, "♦", "5d"),
            card(5, "♣", "5c"),
          ],
          faceUp: [],
          faceDown: [],
        }),
        player("b", { hand: [card(8)] }),
        player("c", { hand: [card(9)] }),
      ],
      pile: [],
    });
    const { state } = applyPlay(s, "a", ["5s", "5h", "5d", "5c"]);
    expect(state.players[0].finished).toBe(true);
    expect(state.currentPlayerId).toBe("b");
  });
});

describe("applyPickup", () => {
  it("moves the pile into the player's hand and advances turn", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(5, "♠", "5♠"), card(6, "♥", "6♥")],
      sevenActive: true,
      players: [
        player("a", { hand: [card(11, "♠", "J♠")] }),
        player("b"),
      ],
    });
    const { state, error } = applyPickup(s, "a");
    expect(error).toBeUndefined();
    expect(state.pile).toEqual([]);
    expect(state.sevenActive).toBe(false);
    expect(state.players[0].hand.map((c) => c.id).sort()).toEqual([
      "5♠",
      "6♥",
      "J♠",
    ]);
    expect(state.currentPlayerId).toBe("b");
  });

  it("rejects pickup when it isn't your turn", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [card(5)],
      players: [player("a"), player("b")],
    });
    expect(applyPickup(s, "b").error).toBe("Not your turn");
  });

  it("rejects pickup when pile is empty", () => {
    const s = baseState({
      currentPlayerId: "a",
      pile: [],
      players: [player("a"), player("b")],
    });
    expect(applyPickup(s, "a").error).toBe("Nothing to pick up");
  });
});

describe("turn rotation", () => {
  it("skips finished players when advancing the turn", () => {
    const s = baseState({
      currentPlayerId: "a",
      players: [
        player("a", { hand: [card(5, "♠", "5♠"), card(6, "♣", "6♣")] }),
        player("b", { finished: true }),
        player("c", { hand: [card(6)] }),
      ],
    });
    const { state } = applyPlay(s, "a", ["5♠"]);
    expect(state.currentPlayerId).toBe("c");
  });
});
