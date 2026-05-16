import { describe, it, expect } from "vitest";
import { botAct, botSwap } from "./bot";
import { applyPlay, canPlayOn, type Card, type GameState, type Player, type Suit } from "./game";

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
  currentPlayerId: "bot",
  sevenActive: false,
  phase: "playing",
  message: "",
  loserId: null,
  lastEvent: null,
  hostId: "bot",
  ...overrides,
});

describe("botAct — legality", () => {
  it("never picks an illegal card", () => {
    // Pile top 9. Hand has 4, 5, 6 (all illegal) plus a single legal Q.
    // Bot must choose Q.
    const c4 = card(4);
    const c5 = card(5);
    const c6 = card(6);
    const cQ = card(12);
    const top = card(9);
    const state = baseState({
      players: [player("bot", { hand: [c4, c5, c6, cQ] })],
      pile: [top],
    });
    const action = botAct(state, "bot");
    expect(action.type).toBe("play");
    if (action.type === "play") {
      expect(action.cardIds).toEqual([cQ.id]);
    }
  });

  it("picks up when no legal play exists", () => {
    const state = baseState({
      players: [player("bot", { hand: [card(4), card(5), card(6)] })],
      pile: [card(13)],
    });
    expect(botAct(state, "bot")).toEqual({ type: "pickup" });
  });

  it("plays a special when nothing else is legal", () => {
    // Pile top K, bot has only a 2 and a 9 — 9 is illegal, 2 always legal.
    const c9 = card(9);
    const c2 = card(2);
    const state = baseState({
      players: [player("bot", { hand: [c9, c2] })],
      pile: [card(13)],
    });
    const action = botAct(state, "bot");
    expect(action.type).toBe("play");
    if (action.type === "play") expect(action.cardIds).toEqual([c2.id]);
  });
});

describe("botAct — strategy", () => {
  it("plays the lowest non-special when many are legal", () => {
    // Pile empty, hand has 4, 7, K, 2 (special). All legal. Should play 4.
    const c4 = card(4);
    const c7 = card(7);
    const cK = card(13);
    const c2 = card(2);
    const state = baseState({
      players: [player("bot", { hand: [c4, c7, cK, c2] })],
      pile: [],
    });
    const action = botAct(state, "bot");
    expect(action.type).toBe("play");
    if (action.type === "play") expect(action.cardIds).toEqual([c4.id]);
  });

  it("saves 2s and 10s when non-specials are available", () => {
    // Pile top is 5. Hand has 6 (legal), 2 (special, always legal), 10 (special, always legal).
    // Should prefer the 6, not burn a 10 or 2.
    const c6 = card(6);
    const c2 = card(2);
    const c10 = card(10);
    const state = baseState({
      players: [player("bot", { hand: [c6, c2, c10] })],
      pile: [card(5)],
    });
    const action = botAct(state, "bot");
    expect(action.type).toBe("play");
    if (action.type === "play") expect(action.cardIds).toEqual([c6.id]);
  });

  it("prefers 3 over 10 over 2 when only specials are legal", () => {
    // Pile top K. Hand has 3, 10, 2 — all specials, all legal. Prefer 3.
    const c3 = card(3);
    const c10 = card(10);
    const c2 = card(2);
    const state = baseState({
      players: [player("bot", { hand: [c3, c10, c2] })],
      pile: [card(13)],
    });
    const action = botAct(state, "bot");
    if (action.type === "play") expect(action.cardIds).toEqual([c3.id]);

    // Remove the 3 — now should prefer 10.
    const noThree = baseState({
      players: [player("bot", { hand: [c10, c2] })],
      pile: [card(13)],
    });
    const action2 = botAct(noThree, "bot");
    if (action2.type === "play") expect(action2.cardIds).toEqual([c10.id]);
  });

  it("plays all matching-rank cards together (sets up 4-of-a-kind)", () => {
    // Three 5s in hand; pile top 4. Bot should play all three 5s.
    const c5a = card(5, "♠", "5s");
    const c5b = card(5, "♥", "5h");
    const c5c = card(5, "♣", "5c");
    const cJ = card(11);
    const state = baseState({
      players: [player("bot", { hand: [c5a, c5b, c5c, cJ] })],
      pile: [card(4)],
    });
    const action = botAct(state, "bot");
    if (action.type === "play") {
      expect(action.cardIds).toHaveLength(3);
      expect(new Set(action.cardIds)).toEqual(new Set([c5a.id, c5b.id, c5c.id]));
    }
  });

  it("respects sevenActive (must play ≤7)", () => {
    // 7 is active. Hand: 4 (legal), K (illegal), Q (illegal).
    const c4 = card(4);
    const cK = card(13);
    const cQ = card(12);
    const state = baseState({
      players: [player("bot", { hand: [c4, cK, cQ] })],
      pile: [card(7)],
      sevenActive: true,
    });
    const action = botAct(state, "bot");
    if (action.type === "play") expect(action.cardIds).toEqual([c4.id]);
  });
});

describe("botAct — zone transitions", () => {
  it("plays from face-up when hand is empty", () => {
    const fu5 = card(5);
    const fuJ = card(11);
    const state = baseState({
      players: [player("bot", { hand: [], faceUp: [fu5, fuJ], faceDown: [card(7), card(8), card(9)] })],
      pile: [],
    });
    const action = botAct(state, "bot");
    if (action.type === "play") expect(action.cardIds).toEqual([fu5.id]);
  });

  it("blind-flips a random face-down when hand and face-up are empty", () => {
    const fd1 = card(7, "♠", "fd1");
    const fd2 = card(8, "♥", "fd2");
    const fd3 = card(9, "♣", "fd3");
    const state = baseState({
      players: [player("bot", { hand: [], faceUp: [], faceDown: [fd1, fd2, fd3] })],
      pile: [card(5)],
    });
    const action = botAct(state, "bot");
    expect(action.type).toBe("play");
    if (action.type === "play") {
      expect(action.cardIds).toHaveLength(1);
      expect([fd1.id, fd2.id, fd3.id]).toContain(action.cardIds[0]);
    }
  });
});

describe("botAct — engine compatibility", () => {
  it("every produced play is accepted by applyPlay", () => {
    // Property-style smoke check: across many random pile + hand combos, the
    // bot's chosen play should always either succeed via applyPlay or be a
    // pickup. Regression guard against legality drift.
    for (let i = 0; i < 50; i++) {
      const hand = Array.from({ length: 3 + Math.floor(Math.random() * 4) }, () =>
        card(2 + Math.floor(Math.random() * 13)),
      );
      const pile = Math.random() > 0.3 ? [card(2 + Math.floor(Math.random() * 13))] : [];
      const state = baseState({
        players: [player("bot", { hand })],
        pile,
        sevenActive: pile[0]?.r === 7,
      });
      const action = botAct(state, "bot");
      if (action.type === "play") {
        // The cards should all share a rank
        const ids = new Set(action.cardIds);
        const cards = hand.filter((c) => ids.has(c.id));
        expect(cards.every((c) => c.r === cards[0].r)).toBe(true);
        // Each is legal individually
        for (const c of cards) {
          expect(canPlayOn(c, pile, state.sevenActive)).toBe(true);
        }
        // applyPlay accepts it
        const result = applyPlay(state, "bot", action.cardIds);
        expect(result.error).toBeUndefined();
      }
    }
  });
});

describe("botSwap", () => {
  it("moves high non-specials to face-up", () => {
    const handK = card(13, "♠", "K");
    const hand5 = card(5, "♥", "5");
    const hand6 = card(6, "♣", "6");
    const fu3 = card(3, "♠", "3"); // special, score -1
    const fu4 = card(4, "♥", "4");
    const fu7 = card(7, "♣", "7");
    const state = baseState({
      phase: "swap",
      players: [player("bot", { hand: [handK, hand5, hand6], faceUp: [fu3, fu4, fu7] })],
    });

    const after = botSwap(state, "bot");
    const p = after.players.find((p) => p.id === "bot")!;
    const fuRanks = p.faceUp.map((c) => c.r).sort((a, b) => a - b);
    const handRanks = p.hand.map((c) => c.r).sort((a, b) => a - b);

    // The 3 (special) should end up in the hand. The K (highest non-special)
    // should be face-up.
    expect(handRanks).toContain(3);
    expect(fuRanks).toContain(13);
    // No special should remain face-up while a higher non-special is in hand.
    const hasSpecialFaceUp = p.faceUp.some((c) => c.r === 2 || c.r === 3 || c.r === 10);
    if (hasSpecialFaceUp) {
      const maxHandNonSpecial = Math.max(
        ...p.hand.filter((c) => c.r !== 2 && c.r !== 3 && c.r !== 10).map((c) => c.r),
        0,
      );
      const minFaceUpSpecial = Math.min(
        ...p.faceUp.filter((c) => c.r === 2 || c.r === 3 || c.r === 10).map((c) => 0), // specials score -1
        Infinity,
      );
      expect(maxHandNonSpecial).toBeLessThanOrEqual(minFaceUpSpecial);
    }
  });

  it("is a no-op when face-up is already optimal", () => {
    // Hand has only specials and low cards; face-up already has the highest.
    const hand2 = card(2);
    const hand3 = card(3);
    const fuK = card(13);
    const fuQ = card(12);
    const fuJ = card(11);
    const state = baseState({
      phase: "swap",
      players: [player("bot", { hand: [hand2, hand3], faceUp: [fuK, fuQ, fuJ] })],
    });
    const after = botSwap(state, "bot");
    const p = after.players.find((p) => p.id === "bot")!;
    expect(p.faceUp.map((c) => c.r).sort()).toEqual([11, 12, 13]);
    expect(p.hand.map((c) => c.r).sort()).toEqual([2, 3]);
  });

  it("never loses or duplicates cards", () => {
    const state = baseState({
      phase: "swap",
      players: [player("bot", { hand: [card(5), card(13), card(2)], faceUp: [card(3), card(7), card(11)] })],
    });
    const after = botSwap(state, "bot");
    const p = after.players.find((p) => p.id === "bot")!;
    const allIds = [...p.hand, ...p.faceUp].map((c) => c.id);
    expect(allIds).toHaveLength(6);
    expect(new Set(allIds).size).toBe(6); // no duplicates
  });
});
