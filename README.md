# The Parlor — Shithead Card Game with Voice

A web app where you create a room, share a 4-letter code, and play **Shithead** with up to 3 friends with **live voice chat baked in**. No app store, no accounts, no signup. Open the link, type a name, deal cards.

> Shithead (a.k.a. Karma, Palace, Shed) is a shedding-type card game popular in pubs and student houses. The goal is simple: get rid of all your cards. Last one holding cards is the Shithead.

---

## Table of contents

- [Features](#features)
- [Tech stack](#tech-stack)
- [Project structure](#project-structure)
- [Quick start (local development)](#quick-start-local-development)
- [Environment variables](#environment-variables)
- [Deploy to production](#deploy-to-production)
- [Game rules](#game-rules)
- [How it works](#how-it-works)
- [Testing](#testing)
- [Continuous integration](#continuous-integration)
- [Costs](#costs)
- [Contributing](#contributing)
- [Troubleshooting](#troubleshooting)
- [Further reading](#further-reading)

---

## Features

- **Real-time multiplayer** — server-authoritative game state over WebSockets.
- **Live voice chat** — drop-in voice over LiveKit, runs in parallel to the game.
- **No accounts** — identity is a `playerId` in localStorage. Drop your wifi, refresh, and you're back in your seat.
- **No app required** — works on any modern browser, mobile-first design.
- **Reconnect-friendly** — disconnections keep your seat and your cards.
- **House rules included** — 2 / 3 / 7 / 10 specials, four-of-a-kind burn, multi-card play.

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS + Framer Motion + react-router-dom |
| Real-time backend | [PartyKit](https://partykit.io) (Cloudflare Workers under the hood) |
| Voice | [LiveKit Cloud](https://livekit.io) — WebRTC, free tier |
| Frontend host | [Render](https://render.com) (static site) |
| Backend host | PartyKit Cloud |
| Tests | [Vitest](https://vitest.dev) |
| CI | GitHub Actions |

Two services to deploy, both with generous free tiers. No serverless functions, no Next.js, no database.

## Project structure

```
src/
  pages/
    Landing.tsx         # Create / join screen
    Room.tsx            # Lobby + active game + voice integration
  lib/
    game.ts             # Pure game engine — shared with the server
    game.test.ts        # 52-case Vitest suite
  main.tsx              # React + Router entry point
  index.css             # Tailwind base
party/
  server.ts             # PartyKit server: WebSocket gameplay + HTTP voice-token endpoint
public/
  _redirects            # SPA rewrite for Render
docs/
  ARCHITECTURE.md       # System overview
  GAME_RULES.md         # Engine rules + special card semantics
  PROTOCOL.md           # Client ↔ server message contract
  VOICE.md              # LiveKit integration details
  TESTING.md            # How to run and add tests
.github/workflows/
  ci.yml                # Type check + test + build on push/PR
partykit.json           # PartyKit deployment config
vite.config.ts          # Vite + dev server config
vitest.config.ts        # Vitest config
```

## Quick start (local development)

### Prerequisites

- **Node.js 18+** (we use Node 20 in CI; 18 is the minimum for Vite 5)
- **npm** (ships with Node)
- A free **LiveKit Cloud** account (only needed if you want voice; the game works without it)

### Steps

```bash
# 1. Clone and install
git clone https://github.com/YOU/shithead-app.git
cd shithead-app
npm install

# 2. (Optional) Set up LiveKit voice
#    a) Sign up at https://cloud.livekit.io
#    b) Create a project, then go to Settings → Keys
#    c) Copy API Key, API Secret, and the WebSocket URL (wss://...)
#    d) PartyKit reads .env in local dev:
cat > .env <<EOF
LIVEKIT_API_KEY=your_key_here
LIVEKIT_API_SECRET=your_secret_here
LIVEKIT_URL=wss://your-project.livekit.cloud
EOF

# 3. In two terminals:
npm run dev:party       # PartyKit on 127.0.0.1:1999
npm run dev             # Vite on http://localhost:3000

# 4. Open http://localhost:3000 in two browser windows.
#    Create a room in one, copy the 4-letter code, join with it in the other.
#    Hit "JOIN VOICE" in each — grant mic permission — start talking.
```

### Available scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on port 3000 (frontend) |
| `npm run dev:party` | PartyKit local server on port 1999 (backend) |
| `npm test` | Run Vitest once (CI mode) |
| `npm run test:watch` | Run Vitest in watch mode |
| `npm run typecheck` | Type-check the project (`tsc -b`) |
| `npm run build` | Production build (`tsc -b && vite build` → `dist/`) |
| `npm run preview` | Serve the production build locally |
| `npm run deploy:party` | Deploy the PartyKit server |

## Environment variables

### Frontend (`.env`, exposed to the browser — must start with `VITE_`)

| Var | Purpose | Example |
|---|---|---|
| `VITE_PARTYKIT_HOST` | The PartyKit host the client connects to. **No protocol, no trailing slash.** | `shithead-party.yourname.partykit.dev` |

If unset, the client falls back to `127.0.0.1:1999` for local dev.

### Backend (PartyKit env, server-only — set via `npx partykit env add`)

| Var | Purpose | Example |
|---|---|---|
| `LIVEKIT_API_KEY` | LiveKit API key for minting voice tokens | `APIxxxxxxx` |
| `LIVEKIT_API_SECRET` | LiveKit API secret | `xxxx...` |
| `LIVEKIT_URL` | LiveKit WebSocket URL | `wss://your-project.livekit.cloud` |

If any are missing, the voice endpoint returns 500 but gameplay continues to work — voice is optional.

> ⚠️ **Use `npx partykit env add KEY`, not `partykit secret put`.** The `secret put` command does not exist in PartyKit.

## Deploy to production

Two independent deploys. The frontend can auto-deploy on every push; the backend is currently manual.

### 1. PartyKit backend

```bash
# One-time setup
npx partykit login                          # opens browser, sign in with GitHub

# Set secrets (once)
npx partykit env add LIVEKIT_API_KEY        # paste when prompted
npx partykit env add LIVEKIT_API_SECRET
npx partykit env add LIVEKIT_URL

# Deploy
npm run deploy:party
# → outputs: ✓ Deployed shithead-party to https://shithead-party.YOURNAME.partykit.dev
```

Copy the host (e.g. `shithead-party.yourname.partykit.dev`) — you need it for the frontend.

**Redeploy whenever you change `party/server.ts` or `src/lib/game.ts`** (the engine is shared with the server). See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#when-to-redeploy-partykit) for the full list.

### 2. Frontend on Render

1. Push the repo to GitHub.
2. On Render: **New → Static Site**, connect the GitHub repo.
3. Build command: `npm run build`.
4. Publish directory: `dist`.
5. Add an environment variable: `VITE_PARTYKIT_HOST` = `shithead-party.yourname.partykit.dev` (no `https://`, no trailing slash).
6. Add a **rewrite rule** in the Render dashboard: source `/*` → destination `/index.html` → action **Rewrite**. (The repo also ships a `public/_redirects` file as a fallback.) This is required for SPA routing — without it, `/room/ABCD` returns 404 on hard refresh.
7. Deploy.

Subsequent pushes to `main` auto-deploy.

### Custom domain (optional)

Both Render and most registrars (~$12/year) make this trivial. Add the domain in the Render dashboard and point your DNS at the provided CNAME.

## Game rules

### Goal

Get rid of all your cards. Last one holding cards is the **Shithead** 💩.

### Setup

Each player gets 9 cards:
- **3 face-down** (blind — nobody sees them until played)
- **3 face-up** (placed on top of the face-down, visible to everyone)
- **3 in hand** (only you see them)

Before play starts, you may **swap** any of your hand cards with any of your face-up cards.

### Turn

Play a card of rank **equal to or higher than** the top of the pile. Draw back up to 3 cards from the deck if it's not empty. Can't play? **Pick up** the whole pile.

You can play **multiple same-rank cards** at once (e.g. all your 6s).

### Special cards

| Card | Effect |
|---|---|
| **2** | Reset. Plays on anything. Next player can play anything. |
| **3** | Invisible. Plays on anything. The next player reacts to whatever's underneath. |
| **7** | Restrictor. Next player must play a 7 or lower. |
| **10** | Burn. The entire pile goes to the burn pile. You go again. |
| **Four of a kind on top** | Burn. The entire pile goes to the burn pile. You go again. (3s are skipped when checking.) |

### Endgame

When your hand is empty, play your face-up cards. When those are gone, blindly tap a face-down card. If the flipped card can't legally play, you pick up the pile **plus** that card.

For full rule semantics see [docs/GAME_RULES.md](docs/GAME_RULES.md).

## How it works

- **Room codes** — 4 characters from a no-confusable alphabet (no 0/O, 1/I/L). Generated client-side; the server creates a room on first connection and persists state to PartyKit room storage.
- **Game state** — lives only on PartyKit. Clients send actions (play / pickup / swap) via WebSocket and receive personalized state snapshots — your own hand visible, opponents' hands and face-down cards masked as placeholders. There is no way to cheat by inspecting client state.
- **Voice tokens** — clients `POST` to `https://{partykit-host}/parties/main/{ROOM_CODE}/voice-token` with their identity. The same PartyKit server mints a LiveKit JWT using server-side secrets that are never exposed to the client.
- **Voice itself** — runs in a parallel LiveKit room named `shithead-{CODE}`. Game state and voice are entirely separate channels; voice glitches don't affect gameplay and vice versa.
- **Reconnect** — `playerId` is in localStorage. Refresh the page or lose wifi and you're restored to your seat with state intact.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and [docs/PROTOCOL.md](docs/PROTOCOL.md) for the full picture.

## Testing

The pure game engine in `src/lib/game.ts` has a comprehensive Vitest suite — 52 cases covering every special card, the swap / play / pickup actions, the face-up and face-down play paths, the four-of-a-kind detection (including with intervening 3s), turn rotation, and game-over conditions.

```bash
npm test               # run once
npm run test:watch     # watch mode for active development
```

See [docs/TESTING.md](docs/TESTING.md) for the testing conventions and how to add new cases.

## Continuous integration

Every push to `main` and every pull request runs through `.github/workflows/ci.yml`:

1. `npm ci` — clean install from `package-lock.json`
2. `npm run typecheck` — `tsc -b` strict mode
3. `npm test` — full Vitest run
4. `npm run build` — `tsc -b && vite build`

GitHub blocks merging a PR with a red check if you turn on branch protection (Settings → Branches → Branch protection rules).

CI does **not** auto-deploy. Render handles its own auto-deploy on push to `main`. PartyKit deploys are currently manual.

## Costs

Real numbers, for a group of 4 playing 2 hours/week:

| Service | Cost |
|---|---|
| Render (static site) | $0 (hobby tier) |
| PartyKit Cloud | $0 (free tier covers this easily) |
| LiveKit Cloud | $0 (10k participant-min/month free; you'd use ~1,920) |
| **Total** | **$0/month** |

## Contributing

PRs welcome. A few notes:

- **Engine changes belong in `src/lib/game.ts`** and must come with tests in `src/lib/game.test.ts`. The engine is imported by both client and server — if you change it, redeploy PartyKit (see [How it works](#how-it-works)).
- **Keep the engine pure.** No I/O, no React, no PartyKit imports. Every function should be a pure transform over `GameState`.
- **UI changes** go in `src/pages/Room.tsx` (the bulk of the UI) or `src/pages/Landing.tsx`. The styling is Tailwind utility classes inline; there is no separate CSS file beyond `index.css`.
- **Coding style** — Prettier-ish, no enforced linter yet. Match the surrounding code.
- **Commit messages** — short imperative ("Fix four-of-a-kind detection through 3s"). The recent log is your reference.

Before opening a PR:
```bash
npm run typecheck && npm test && npm run build
```

All three must pass. CI will run the same three on your PR anyway.

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Voice indicators light up but no audio (iOS) | iPhone silent switch is enabled | Flip the physical silent switch off |
| "Tap to Enable Audio" button appears | iOS requires a user gesture before audio playback | Tap it |
| Voice unavailable / 500 from token endpoint | Missing PartyKit env vars | `npx partykit env list`; add any that are missing with `env add` |
| Hard refresh on `/room/ABCD` 404s | Missing SPA rewrite on Render | Configure the Render dashboard rewrite OR ship `public/_redirects` |
| Engine change works locally but not for friends | Forgot to redeploy PartyKit | `npm run deploy:party` |
| Build fails with TypeScript errors that don't appear in dev | `tsc -b` is stricter than Vite's transpile-only dev mode | Run `npm run typecheck` locally before pushing |
| Vite env var `import.meta.env.MY_VAR` is undefined in the browser | Vite only exposes vars prefixed with `VITE_` | Rename to `VITE_MY_VAR` |

## Further reading

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — system overview, when to redeploy which service
- [docs/GAME_RULES.md](docs/GAME_RULES.md) — every house rule with examples
- [docs/PROTOCOL.md](docs/PROTOCOL.md) — full client ↔ server message contract
- [docs/VOICE.md](docs/VOICE.md) — LiveKit token flow, why voice is decoupled from gameplay
- [docs/TESTING.md](docs/TESTING.md) — test setup, conventions, adding cases

## License

No license declared yet. If you want to use this commercially, open an issue and we can talk.
