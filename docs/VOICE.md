# Voice Integration

Voice chat runs on [LiveKit Cloud](https://livekit.io) over WebRTC. It's deliberately decoupled from the game so that audio glitches don't affect gameplay and vice versa.

## Architecture at a glance

```
   ┌──────────┐    1. POST /voice-token      ┌─────────────┐
   │  Client  │ ───────────────────────────► │  PartyKit   │
   │          │                              │  (mints JWT │
   │          │ ◄─────  { token, url }  ──── │   from env) │
   │          │                              └─────────────┘
   │          │
   │          │    2. WebRTC connect with JWT
   │          │ ────────────────────────────► ┌─────────────┐
   │          │                                │   LiveKit   │
   │          │ ◄──────── audio streams ─────► │   Cloud     │
   └──────────┘                                └─────────────┘
```

Two separate connections:

- **PartyKit** for game state (WebSocket) and one HTTP request to mint a voice token.
- **LiveKit** for the actual audio — peer-to-peer WebRTC routed through LiveKit's selective forwarding unit.

The PartyKit server never sees audio data. Audio never touches our game state.

## Room naming convention

The LiveKit room name is `shithead-{ROOM_CODE}` where `ROOM_CODE` is the 4-letter code (e.g. `shithead-ABCD`).

This keeps voice rooms namespaced and aligned 1-to-1 with game rooms.

## Token flow

1. User clicks **JOIN VOICE** in `Room.tsx`. The component calls `requestVoice()`.
2. `requestVoice()` does:
   ```ts
   fetch(`https://${PARTYKIT_HOST}/parties/main/${roomCode}/voice-token`, {
     method: "POST",
     headers: { "Content-Type": "application/json" },
     body: JSON.stringify({ identity: playerId, name }),
   })
   ```
3. The PartyKit server reads `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_URL` from its env, mints a JWT with:
   - `identity` = the player's stable `playerId`
   - `name` = the display name
   - TTL = 4 hours (well past a typical session)
   - Grants: `roomJoin`, `canPublish` (mic), `canSubscribe` (listen)
   - Bound to room: `shithead-{ROOM_CODE}`
4. Server returns `{ token, url }`. Client stores both in state.
5. Client conditionally wraps the inner tree in `<LiveKitRoom>`:
   ```tsx
   <LiveKitRoom token={voiceToken} serverUrl={voiceUrl} connect audio video={false}>
     <RoomAudioRenderer />
     <StartAudioGate />
     {inner}
   </LiveKitRoom>
   ```
6. LiveKit's React SDK handles the actual WebRTC handshake. `audio` is true (microphone capture + remote audio playback); `video` is false (no camera).

## Why the LiveKit provider is conditional

`<LiveKitRoom>` is only mounted when `voiceToken && voiceUrl` are both set — i.e. after the user clicks JOIN VOICE. This matters because:

- LiveKit's hooks (`useParticipants`, `useLocalParticipant`, `useRoomContext`) **throw** if used outside the provider.
- Most players will want to play without voice initially. Mounting the provider unconditionally would create dead WebRTC infrastructure and request mic permission too early.

The codebase splits voice-aware UI into its own components:

- **`Opponent`** is voice-agnostic and always rendered.
- **`OpponentVoiceLabel`** uses `useParticipants` and is only rendered when `voiceConnected` is true (guaranteeing it's inside the provider).
- **`VoiceControls`** (mute toggle) — only rendered when `voiceConnected`.

If you add new voice-aware UI, guard it the same way.

## iOS gotchas

iOS Safari has two quirks that bite WebRTC apps:

### 1. Silent switch mutes WebRTC audio

If a user's iPhone has the physical silent switch on, remote audio plays at zero volume. The UI shows participants connected, speaking indicators light up, but no sound. This is **not** a bug we can work around in code.

**Fix:** Flip the silent switch off. Worth documenting in user-facing help text.

### 2. Audio playback requires a user gesture

iOS won't auto-play remote audio tracks until the user has tapped something *after page load*. LiveKit handles this via `useStartAudio`, which reports whether playback is unblocked.

The `StartAudioGate` component in `Room.tsx` watches `canPlayAudio` and renders a floating "Tap to Enable Audio" button when it's false. Once tapped, audio unlocks and the button unmounts.

Don't remove this gate. iOS users would otherwise see silent voice connections.

## Speaking indicators

`OpponentVoiceLabel` reads `participants` from `useParticipants()` and finds the matching participant by `identity` (which we set to the player's `playerId` when minting the token — that's why `identity` and `playerId` must match).

```ts
const speaking = participants.find((p) => p.identity === playerId)?.isSpeaking;
const inVoice = participants.some((p) => p.identity === playerId);
```

When a participant is speaking, their name pulses green. Pure UI feedback — no game-state impact.

## Mute toggle

`VoiceControls` exposes a button that calls `localParticipant.setMicrophoneEnabled(!muted)`. State is tracked locally with a `useState`. There is no server-side mute concept; mute is a client-side mic gate.

## Environment variables

Set on the PartyKit server only — never in the client bundle:

| Var | What |
|---|---|
| `LIVEKIT_API_KEY` | LiveKit API key from Settings → Keys |
| `LIVEKIT_API_SECRET` | LiveKit API secret from the same page |
| `LIVEKIT_URL` | WebSocket URL, format `wss://your-project.livekit.cloud` |

Local dev reads these from a `.env` file in the project root. Production reads them from PartyKit env (`npx partykit env add KEY`). Both methods are server-only — the client never sees the secrets.

If any are missing, the `/voice-token` endpoint returns 500 and the client shows a "Voice unavailable" alert. The game continues to work.

## Costs

LiveKit Cloud's free tier is 10,000 participant-minutes per month. A group of 4 playing 2 hours/week uses ~1,920. Plenty of headroom.

## Why LiveKit Cloud instead of self-hosting

Audio is hard. WebRTC is hard. NAT traversal, TURN servers, codec negotiation, browser quirks, mobile network handoffs — all problems that LiveKit Cloud solves for free at our scale. We could swap to self-hosted LiveKit later by changing only the `LIVEKIT_URL` (and providing TURN credentials). No client changes needed.

## What's NOT implemented

- **No persistent voice rooms.** A LiveKit room cleans itself up when the last participant leaves.
- **No recording.** LiveKit can record sessions, but we don't enable it.
- **No screen sharing.** `video: false` everywhere.
- **No spatial audio.** All participants are mixed equally — no positional pan based on seat.
- **No background mode.** Closing the tab disconnects voice. There's no service worker to keep it alive.
