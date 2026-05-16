# Shithead — Multiplayer Card Game with Voice

A web app where you create a room, share a 4-letter code, and play with up to 3 friends with **live voice chat baked in**. No App Store. No accounts. Open the link, type a name, deal cards.

## Architecture (deliberately minimal)

- **Frontend**: Vite + React + Tailwind, deployed as static files on Render
- **Backend**: PartyKit handles BOTH game state (WebSocket) AND voice token minting (HTTP) in a single server
- **Voice**: LiveKit Cloud for the actual WebRTC audio stream
  Two services to deploy. That's it. No serverless functions, no Next.js machinery, no DB.

## Local development

```bash
# 1. Install
npm install

# 2. Set up LiveKit (free)
#    a) Sign up at https://cloud.livekit.io
#    b) Create a project, then go to Settings → Keys
#    c) Copy API Key, API Secret, and the WebSocket URL (wss://...)
#    d) For LOCAL dev, put them in a .env file in the project root that Partykit reads:
echo "LIVEKIT_API_KEY=your_key" > .env
echo "LIVEKIT_API_SECRET=your_secret" >> .env
echo "LIVEKIT_URL=wss://your-project.livekit.cloud" >> .env

# 3. Run two terminals:
npm run dev:party       # PartyKit on 127.0.0.1:1999
npm run dev             # Vite on http://localhost:3000

# 4. Open http://localhost:3000 in two browser windows.
#    Create a room in one, join with the code in the other.
#    Hit "Join Voice Chat" in each — grant mic permission — start talking.
```

## Deploy to production

### Step 1: Push to GitHub

```bash
git init && git add . && git commit -m "Initial"
# Create a repo on github.com, then:
git remote add origin https://github.com/YOU/shithead-app.git
git push -u origin main
```

### Step 2: Deploy PartyKit (the backend)

```bash
npx partykit login    # opens browser, sign in with GitHub
```

Set your LiveKit secrets as PartyKit secrets (these never go in the client bundle):

```bash
npx partykit secret put LIVEKIT_API_KEY
# paste your key when prompted
npx partykit secret put LIVEKIT_API_SECRET
# paste your secret
npx partykit secret put LIVEKIT_URL
# paste wss://your-project.livekit.cloud
```

Now deploy:

```bash
npm run deploy:party
```

You'll see output like:

```
✓ Deployed shithead-party to https://shithead-party.YOURNAME.partykit.dev
```

**Copy the host** (e.g. `shithead-party.YOURNAME.partykit.dev`) — you need it next.

### Step 3: Deploy the frontend to Vercel

1. Go to **https://vercel.com/new**
2. Import your GitHub repo
3. Vercel auto-detects Vite. Before clicking Deploy, expand **Environment Variables** and add:
   - `VITE_PARTYKIT_HOST` = `shithead-party.YOURNAME.partykit.dev` (no `https://`, no trailing slash)
4. Click Deploy

You'll get a URL like `https://shithead-app.vercel.app`. Send it to your friends.

### Optional: custom domain

Vercel → Project Settings → Domains. Costs ~$12/year via any registrar.

## How it works

- **Room codes**: 4 chars from a no-confusable alphabet. Generated client-side; PartyKit creates a "room" on first connection and persists state to room storage.
- **Game state**: lives only on PartyKit. Clients send actions (play / pickup / swap) via WebSocket and receive personalized state snapshots — your hand visible, opponents' hands masked. No way to cheat.
- **Voice tokens**: clients POST to `https://{partykit-host}/parties/main/{ROOM_CODE}/voice-token` with their identity. The same Partykit server mints a LiveKit access token using the secrets stored on the server (never exposed to the client).
- **Voice itself**: runs as a parallel LiveKit room named `shithead-{CODE}`. Game state and voice are completely separate channels — voice glitches don't affect gameplay and vice versa.
- **Reconnect**: `playerId` is in localStorage. Drop wifi, refresh — server restores you to your seat with state intact.

## Costs (real numbers, for 4 friends playing 2hr/week)

- **Vercel**: $0 (hobby tier)
- **PartyKit**: $0 (free tier covers this easily)
- **LiveKit**: $0 (10k participant-min/month free; you'd use ~1,920)

## Project layout

```
src/
  pages/Landing.tsx       # Create / join screen
  pages/Room.tsx          # Lobby + game + voice
  lib/game.ts             # Pure game engine (also imported by server)
  main.tsx                # React + Router entry
party/
  server.ts               # PartyKit server: WebSocket gameplay + HTTP token endpoint
```

## House rules in this build

- 2 = reset (any card plays next)
- 10 = burns the pile
- 7 = next player must play ≤ 7
- Four of a kind on top burns the pile
- Multi-card play allowed for same rank

To change rules, edit `src/lib/game.ts`.
