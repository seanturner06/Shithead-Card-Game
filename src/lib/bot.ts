/**
 * @file Single-player bot AI for the Shithead engine.
 *
 * Pure decision logic. Doesn't touch React, doesn't mutate state — it reads a
 * {@link GameState} and returns the action the bot wants to take. The caller
 * runs that action through `applyPlay` / `applyPickup` from `game.ts`, which
 * stays the single source of legality truth.
 *
 * Two entry points:
 * - {@link botAct} — returns the bot's chosen play or pickup for the current
 *   turn.
 * - {@link botSwap} — returns the state after the bot has greedily improved
 *   its face-up row during the swap phase.
 *
 * The bot only reads its own visible cards (`player.hand`, `player.faceUp`,
 * `player.faceDown` length) plus public state (`pile`, `sevenActive`). It
 * never peeks at the deck or other players' hidden cards.
 */

import { type Card, type GameState, applySwap, canPlayOn } from "./game";

/** The action the bot has chosen this turn. Consumed by Solo.tsx. */
export type BotAction =
  | { type: "play"; cardIds: string[] }
  | { type: "pickup" };

/**
 * The "always plays" ranks. Same set the engine uses internally — these
 * bypass the normal ≥-top rule, so they're powerful tools the bot tries to
 * save until forced.
 */
const isSpecial = (r: number) => r === 2 || r === 3 || r === 10;

/**
 * Decide the bot's play for the current turn.
 *
 * Strategy (one difficulty level for v1):
 *
 * 1. Pick the zone — hand first, then face-up, then blind face-down (forced
 *    by the engine in that order).
 * 2. If no legal cards in the active zone, pick up the pile.
 * 3. Otherwise pick the lowest non-special legal card. This dumps cards
 *    quickly and saves the powerful 2s/10s/3s for when they're needed.
 * 4. When forced into specials (only specials are legal), prefer
 *    3 (invisible, cheapest) > 10 (burn, keeps the turn) > 2 (reset, gives
 *    opponent free play). 7 is treated as a normal card — its forcing
 *    side-effect is good, not bad, so no reason to save it.
 * 5. Play *all* cards of the chosen rank from the zone. Dumps inventory and
 *    naturally triggers 4-of-a-kind burns.
 *
 * In the face-down phase (hand and face-up both empty), picks a random
 * face-down card. Illegal flips trigger a forced pickup in the engine, so
 * the bot doesn't try to be clever — there's nothing to be clever about,
 * the cards are hidden.
 */
export function botAct(state: GameState, playerId: string): BotAction {
  const player = state.players.find((p) => p.id === playerId);
  if (!player) return { type: "pickup" };

  // Face-down phase: blind pick. The engine handles illegality by forcing
  // a pickup of the pile + the flipped card.
  if (player.hand.length === 0 && player.faceUp.length === 0) {
    if (player.faceDown.length === 0) return { type: "pickup" };
    const random = player.faceDown[Math.floor(Math.random() * player.faceDown.length)];
    return { type: "play", cardIds: [random.id] };
  }

  // Hand has priority over face-up — the engine enforces this anyway by
  // rejecting face-up plays while the hand is non-empty.
  const zone: Card[] = player.hand.length > 0 ? player.hand : player.faceUp;

  const legal = zone.filter((c) => canPlayOn(c, state.pile, state.sevenActive));
  if (legal.length === 0) return { type: "pickup" };

  const choice = pickCard(legal);
  const cardIds = zone.filter((c) => c.r === choice.r).map((c) => c.id);
  return { type: "play", cardIds };
}

/**
 * Choose the single best card from a set of legal options.
 *
 * Non-specials win, lowest rank first. When only specials are legal,
 * prefer 3 > 10 > 2 (cheapest impact first). The chosen card's rank is
 * used by the caller to grab every matching-rank card from the zone.
 */
function pickCard(legal: Card[]): Card {
  const nonSpecials = legal.filter((c) => !isSpecial(c.r)).sort((a, b) => a.r - b.r);
  if (nonSpecials.length > 0) return nonSpecials[0];

  const threes = legal.filter((c) => c.r === 3);
  if (threes.length > 0) return threes[0];
  const tens = legal.filter((c) => c.r === 10);
  if (tens.length > 0) return tens[0];
  return legal[0]; // must be a 2 at this point
}

/**
 * Score a card by how much we want it face-up.
 *
 * - Specials (2/3/10) score -1 — we'd rather have them in hand where they
 *   can rescue us. Putting them face-up wastes the rescue option until
 *   the endgame.
 * - Non-specials score their numeric rank. Higher cards (K, Q, J) face-up
 *   means a strong endgame: opponents can't easily play over them.
 */
function faceUpScore(r: number): number {
  return isSpecial(r) ? -1 : r;
}

/**
 * Greedy face-up optimization during the swap phase.
 *
 * Repeatedly picks the (hand-card, face-up-card) swap with the largest
 * positive score gain and applies it, until no positive swap remains.
 * Capped at 10 iterations as a safety net (in practice it converges in
 * 2-3).
 *
 * Result: specials end up in the hand, the highest non-specials end up
 * face-up. Approximates how a careful human plays the swap phase.
 */
export function botSwap(state: GameState, playerId: string): GameState {
  let s = state;
  for (let iter = 0; iter < 10; iter++) {
    const player = s.players.find((p) => p.id === playerId);
    if (!player) break;

    let bestGain = 0;
    let bestSwap: { handId: string; faceUpId: string } | null = null;
    for (const fu of player.faceUp) {
      const fuScore = faceUpScore(fu.r);
      for (const h of player.hand) {
        const hScore = faceUpScore(h.r);
        const gain = hScore - fuScore;
        if (gain > bestGain) {
          bestGain = gain;
          bestSwap = { handId: h.id, faceUpId: fu.id };
        }
      }
    }
    if (!bestSwap) break;
    s = applySwap(s, playerId, bestSwap.handId, bestSwap.faceUpId);
  }
  return s;
}
