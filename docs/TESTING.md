# Testing

This project uses [Vitest](https://vitest.dev) for unit tests. The current suite focuses entirely on the pure game engine in [`src/lib/game.ts`](../src/lib/game.ts) — that's where the most complex logic lives and where bugs hurt the most (state divergence between client and server).

## Running tests

```bash
npm test               # one-shot run, CI-style. Exits 0/1.
npm run test:watch     # watch mode — reruns on file change.
```

CI (`.github/workflows/ci.yml`) runs `npm test` on every push and PR to `main`.

## Test setup

- **Framework**: Vitest 3.x.
- **Config**: `vitest.config.ts` at the project root.
- **Environment**: `node`. The game engine has no DOM dependencies, so we skip jsdom/happy-dom — faster startup.
- **Includes**: `src/**/*.{test,spec}.ts` and `party/**/*.{test,spec}.ts`. Test files sit next to the code they test.
- **No globals**. `describe`, `it`, `expect` are imported explicitly from `"vitest"`. Keeps the file dependencies obvious.

## What's covered

The current 52-case suite (`src/lib/game.test.ts`) covers:

| Area | Cases |
|---|---|
| `buildDeck` | 52 cards, 4×13 distribution, unique ids |
| `rankLabel`, `isRed` | Face card mapping, suit color |
| `canPlayOn` | Empty pile, 2/3/10 always-play, normal ≥top, top-2 reset, sevenActive ≤7, 3-skipping effective top, all-3s pile |
| `fourOfAKindTop` | Four same-rank on top, fewer than 4 visible, mixed top, 3-skipping detection |
| `createInitialState`, `dealGame`, `startPlay` | Phase transitions, deal distribution, starter selection (incl. fallback) |
| `applySwap` | Happy path, unknown-id no-op |
| `applyPlay` errors | Not your turn, no cards, mixed ranks, illegal play, ordering (hand→faceUp→faceDown), unknown ids |
| `applyPlay` basics | Hand → pile, draw up to 3, no draw on empty deck, multi-card same rank |
| `applyPlay` specials | 10 burn, 2 reset, 3 invisible (preserves sevenActive), 7 sets sevenActive, four-of-a-kind burn, four-of-a-kind through 3s, post-7 clearing |
| `applyPlay` face-up / face-down | Face-up play after hand empty, legal face-down flip, illegal face-down → pickup pile + card |
| `applyPlay` finish / game over | Player finishes when last card played, game ends with last unfinished as Shithead |
| `applyPickup` | Happy path, not your turn, empty pile |
| Turn rotation | Skips finished players |

## Test conventions

### Helpers at the top of the test file

```ts
const card = (r, s = "♠", id?) => ({ r, s, id: id ?? `${r}${s}-${rand}` });
const player = (id, overrides = {}) => ({ id, name: id.toUpperCase(), hand: [], faceUp: [], faceDown: [], finished: false, connected: true, ...overrides });
const baseState = (overrides = {}) => ({ /* full GameState defaults */, ...overrides });
```

These let each test build a minimal state without rewriting the same scaffolding. Specify only what matters for the case.

### One concept per test

Each `it(...)` block tests one engine behavior. If you find yourself making two assertions about unrelated things in one test, split it.

### Stable ids when assertions need them

When a test asserts on specific cards by id (e.g. `expect(state.pile.map(c => c.id)).toEqual(["5♠"])`), pass an explicit id to the `card` helper: `card(5, "♠", "5♠")`. The default helper id is random-suffixed and unstable across runs.

### Don't drain a player's last card unintentionally

When the player playing in a test would end up with zero cards in every zone, the engine marks them `finished` and may trigger game-over. That changes `lastEvent.type` to `"gameover"`, which can break tests that assert on a specific event type.

**Fix**: give the player a throwaway second card in `hand` so they don't auto-finish. This is the same gotcha that broke 5 tests on the first run of this suite.

## Adding a test

1. Identify the behavior you want to lock down. Read the relevant section in [GAME_RULES.md](GAME_RULES.md) to make sure you understand the spec.
2. Find or create a `describe` block in `src/lib/game.test.ts` that groups the behavior (e.g. "applyPlay — special cards").
3. Use the `card`, `player`, `baseState` helpers to build the minimal state.
4. Call the engine function and assert on the returned state.
5. Run `npm run test:watch` while iterating.
6. Run `npm test` once before committing to confirm no flakiness.

### Example

```ts
it("8 plays on a 4 in normal play", () => {
  const s = baseState({
    currentPlayerId: "a",
    pile: [card(4)],
    players: [
      player("a", { hand: [card(8, "♠", "8♠"), card(9, "♥", "9♥")] }),
      player("b"),
    ],
  });
  const { state, error } = applyPlay(s, "a", ["8♠"]);
  expect(error).toBeUndefined();
  expect(state.pile.map((c) => c.id)).toEqual(["4♠", "8♠"]);  // top is "8♠"
  expect(state.currentPlayerId).toBe("b");
});
```

(Note the `card(4)` produces a card with a random-suffix id, which is why the pile assertion in this example wouldn't actually work as written — use `card(4, "♠", "4♠")` if you need a stable id.)

## What's not covered (yet)

Worth adding when motivated:

- **`party/server.ts`** — message handling, view masking, reconnect logic. Would need a PartyKit test harness or extracting the message router into a pure function.
- **UI components** — none of the React components have render tests. Snapshot tests in particular would help catch accidental UI regressions in `Room.tsx`.
- **Integration tests** — multi-client gameplay scenarios using a real PartyKit dev server. Possible with Playwright or similar.

The engine has the most logic-per-line and the most leverage. Component tests can come later.

## Debugging a failing test

Vitest gives you good output by default. Some tactics that help:

- **Narrow with `.only`**: `it.only("...", ...)` runs just that case.
- **Snapshot the state**: temporarily `console.log(JSON.stringify(state, null, 2))` to see what the engine returned.
- **Check `lastEvent.type`** when an assertion about `state` doesn't add up — often the play accidentally triggered game-over.
- **Watch mode**: `npm run test:watch` reruns instantly on save.

## Why no mocks?

The engine is pure. There's nothing to mock — no I/O, no randomness (except `buildDeck`'s shuffle, which we don't assert order on), no time. Every input fully determines the output.

This is the single biggest payoff of keeping `src/lib/game.ts` pure. If you find yourself wanting to mock something to test engine code, that's a smell — the engine probably grew an impure dependency that should be lifted out.
