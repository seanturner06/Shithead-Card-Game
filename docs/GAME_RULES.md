# Game Rules

This document is the authoritative reference for the Shithead variant implemented in this project. The implementation lives in [`src/lib/game.ts`](../src/lib/game.ts); the tests in `src/lib/game.test.ts` verify everything below.

## The goal

Get rid of all your cards. The last player still holding cards is the **Shithead**.

## Setup

- 52-card deck, no jokers. Shuffled once per game.
- 2 to 4 players. The first joiner of a fresh room is the **host**; only the host can deal or start a new game.
- Each player receives **9 cards** in three rows of 3:
  - **Face-down** (`faceDown`) — placed on the table, hidden from everyone including the owner.
  - **Face-up** (`faceUp`) — placed on top of the face-down cards, visible to all players.
  - **Hand** (`hand`) — held by the player, visible only to them.
- The remaining 25 (4P), 34 (2P/3P) cards form the **deck**, drawn from after every play.

## Phases

The game state machine has four phases (`GameState.phase`):

1. **`lobby`** — players are joining. Host can start the deal once there are at least 2 players.
2. **`swap`** — cards have been dealt, but play hasn't started. Each player may freely swap any of their hand cards with any of their face-up cards. When everyone hits "Ready", the game enters playing.
3. **`playing`** — normal play. `currentPlayerId` tracks whose turn it is.
4. **`over`** — only one player has cards left. `loserId` identifies the Shithead.

## Turn order and the starter

The first player to act is whoever holds the **lowest non-special card** in hand. Special ranks (2, 3, 10) are skipped when picking the starter, because a 2 or 10 would be wasted as an opener.

After that, play proceeds clockwise (seat order). Finished players are skipped.

## A normal play

On your turn, you must do one of:

- **Play one or more same-rank cards** that beat (or match) the top of the pile.
- **Pick up the pile** (forfeit, but unavoidable if you can't play).

After playing from your hand, you **draw back up to 3 cards** from the deck (if the deck has any). Drawing only happens for hand plays, not face-up or face-down.

### What "beats the top" means

The legality check is `canPlayOn(card, pile, sevenActive)`. In priority order:

1. **2, 3, 10 always play.** Regardless of what's on the pile or whether 7 is active.
2. **Effective top is empty** — the pile is empty, *or* every card on top is a 3 (3s are invisible, see below). Anything plays.
3. **Top is a 2.** The 2 is a reset; anything plays.
4. **`sevenActive` is true.** Only cards of rank ≤ 7 can play.
5. Otherwise — your card's rank must be **≥** the effective top.

The "effective top" walks back from the top of the pile and returns the first non-3 card. This is how the invisible-3 rule is implemented.

### Multi-card plays

You can play multiple cards in one turn **if they're all the same rank**. Useful for unloading pairs and triples in one go.

## Special cards

### 2 — reset

- Plays on anything.
- Clears `sevenActive`.
- Next player plays on a fresh effective top (the 2). Since `canPlayOn` special-cases a 2 on top, the next player can effectively play anything.

### 3 — invisible

- Plays on anything.
- **Preserves `sevenActive`** — uniquely among specials, a 3 doesn't change the pile's effective state.
- Sits on the pile, but the next player reacts to whatever's underneath. From the engine's perspective, `effectiveTop` skips past it.
- A pile of all 3s is treated as empty.

### 7 — restrictor

- Sets `sevenActive: true`.
- The next player must play a card of rank ≤ 7 (or pick up). 2, 3, and 10 still bypass this — they always play.
- `sevenActive` clears on the next non-3 play (whether that's a valid ≤7 card, a 2, or a 10) or on a pickup.

### 10 — burn

- Plays on anything.
- The entire pile moves to the `burnPile` (which never returns to play). The visible pile becomes empty.
- The player goes **again** (`extraTurn: true`).
- Clears `sevenActive`.

### Four of a kind on top — burn

- After any play, the server checks the new pile top. If the top 4 non-3 cards all share a rank, the pile is burned (same as a 10).
- The player goes again.
- 3s are skipped when counting — `8, 3, 8, 3, 8, 8` counts as four 8s and burns.
- The four cards do **not** need to be from the same player or same turn; long-tail four-of-a-kinds across multiple turns are caught.

## The endgame for one player

When your **hand** is empty:
- You play directly from your **face-up** cards (still subject to legality). Tap to play.
- When your face-up cards are also gone, you play from your **face-down** cards. You can't see them — you tap one blindly.

### Face-down flips

Flipping a face-down is special:
- If the flipped card legally plays, it plays normally and goes onto the pile.
- If it **doesn't** legally play, **you pick up the entire pile *plus* the flipped card**. The card is no longer face-down — it's now in your hand. The turn passes.
- This is not an error condition — it's a normal game outcome.

## Picking up

Use the **Pick Up** button on your turn to take the whole pile into your hand. Always clears `sevenActive`. Turn passes.

Restrictions:
- Only legal on your turn during the `playing` phase.
- Pile must be non-empty.
- Not usable during the face-down phase (you flip blind instead — there's no choice).

## When the game ends

After every play, the engine checks: is there exactly **one player not finished**? If yes, the game enters the `over` phase and that lone unfinished player is the **Shithead** (`loserId`).

"Finished" means: hand, face-up, and face-down are all empty. A player becomes finished the instant they play their last card.

## What's NOT implemented (deliberately)

Some variants include rules we left out for simplicity:

- **No "play on equal" reset rule.** Some variants make matching the top rank a reset (anything plays next). We don't — matching is just a normal play.
- **No 8 = skip.** Some variants use 8 to skip the next player. We don't; 8 is a normal card.
- **No "transparent" cards beyond 3.** Some variants make 9s see-through. Just 3.
- **No mandatory burn on JJJJ etc. across turns.** Wait — we *do* implement this. The four-of-a-kind check runs after every play and catches accumulated quads.
- **No swap during play.** You can only swap hand ↔ face-up during the `swap` phase.

## Engine API surface

All exported by `src/lib/game.ts`:

| Function | Purpose |
|---|---|
| `buildDeck()` | 52-card shuffled deck. |
| `canPlayOn(card, pile, sevenActive)` | Legality predicate. |
| `fourOfAKindTop(pile)` | Four-of-a-kind burn check (with 3-skipping). |
| `rankLabel(r)` | "J" / "Q" / "K" / "A" / numeric. |
| `isRed(s)` | Hearts and diamonds → true. |
| `createInitialState(hostId, hostName)` | Brand-new lobby state with one player. |
| `dealGame(state)` | Phase `lobby` → `swap`. Deals 3/3/3 to each player. |
| `startPlay(state)` | Phase `swap` → `playing`. Picks the starter. |
| `applySwap(state, playerId, handCardId, faceUpCardId)` | Swap one hand card with one face-up card. |
| `applyPlay(state, playerId, cardIds)` | Main action. Returns `{ state, error? }`. |
| `applyPickup(state, playerId)` | Pickup action. Returns `{ state, error? }`. |

Every function is pure and side-effect-free. The exported types `Card`, `Player`, `GameState`, `Suit` describe the state shape.

## Testing the rules

See [TESTING.md](TESTING.md) for how the rules are verified. Every special-card behavior, the four-of-a-kind detection (including with intervening 3s), the face-down pickup path, the turn rotation around finished players, and the game-over condition all have dedicated tests in `src/lib/game.test.ts`.
