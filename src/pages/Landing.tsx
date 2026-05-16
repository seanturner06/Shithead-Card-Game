/**
 * @file Landing page — the entry screen at `/`.
 *
 * Three states:
 * - `choose` — name input + three options (Play with Friends, Play vs Computer,
 *   Join with Code).
 * - `join` — name persisted, 4-character code input + Join Room button.
 *
 * Name is persisted to `localStorage` as `playerName` so returning visitors
 * skip the typing. The actual player identity (`playerId`) is generated
 * lazily on the room page, not here.
 */

import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getPlayerName, setPlayerName } from "../lib/playerName";

/**
 * Detect whether the page is currently running as an installed PWA (standalone
 * mode). Used to hide the install hint once the user has already installed.
 *
 * Two checks because the standards aren't aligned: Chrome / modern browsers
 * expose `display-mode: standalone` via media query, but iOS Safari uses the
 * non-standard `navigator.standalone` boolean instead.
 */
const isStandalone = (): boolean => {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
};

/** Which install instruction to show, or `null` to hide the hint entirely. */
const detectInstallPlatform = (): "ios" | "android" | null => {
  if (typeof navigator === "undefined") return null;
  if (isStandalone()) return null;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return null;
};

/**
 * Generate a 4-character room code from a no-confusable alphabet.
 *
 * The alphabet omits ambiguous glyphs (0/O, 1/I/L) so codes read cleanly
 * when shouted across a room or typed on a phone.
 */
const generateCode = () => {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 4; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
};

/**
 * Landing page component. Mounted at `/`.
 *
 * Navigates to `/room/:code` for multiplayer or `/solo` for vs-computer once
 * the user has a name.
 */
export default function Landing() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"choose" | "join">("choose");
  // Resolved once on mount — platform doesn't change during a session, so a
  // single read avoids re-running the UA sniff on every render.
  const installPlatform = useMemo(() => detectInstallPlatform(), []);

  useEffect(() => {
    const saved = getPlayerName();
    if (saved) setName(saved);
  }, []);

  const handleCreate = () => {
    if (!name.trim()) return;
    setPlayerName(name);
    nav(`/room/${generateCode()}`);
  };

  const handleSolo = () => {
    if (!name.trim()) return;
    setPlayerName(name);
    nav("/solo");
  };

  const handleJoin = () => {
    if (!name.trim() || code.length !== 4) return;
    setPlayerName(name);
    nav(`/room/${code.toUpperCase()}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4 relative overflow-hidden" style={{ background: "radial-gradient(ellipse at 50% 30%, #1a3a2e 0%, #0d1f18 50%, #050a08 100%)" }}>
      <div className="pointer-events-none fixed inset-0" style={{ background: "radial-gradient(ellipse at 50% 0%, rgba(255, 200, 100, 0.12) 0%, transparent 50%)" }} />

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative z-10 w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="text-amber-100/60 text-xs tracking-[0.4em] uppercase mb-2">The Parlor</div>
          <h1 className="text-amber-100 text-5xl italic" style={{ textShadow: "0 0 40px rgba(255, 200, 100, 0.3)" }}>Shithead</h1>
          <div className="text-amber-100/40 text-xs tracking-widest mt-2">don't be the last one holding cards</div>
        </div>

        {mode === "choose" ? (
          <div className="space-y-3">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 16))}
              placeholder="Your name"
              className="w-full bg-stone-900/60 border border-amber-100/20 text-amber-50 px-4 py-3 rounded-sm focus:outline-none focus:border-amber-200/60 placeholder:text-amber-100/30"
            />
            <button disabled={!name.trim()} onClick={handleCreate} className="w-full bg-amber-100 text-stone-900 px-4 py-3 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition">
              Play with Friends
            </button>
            <button disabled={!name.trim()} onClick={handleSolo} className="w-full border border-amber-100/40 text-amber-100 px-4 py-3 rounded-sm tracking-[0.2em] text-xs uppercase disabled:opacity-30 active:scale-95 transition">
              Play vs Computer
            </button>
            <button disabled={!name.trim()} onClick={() => setMode("join")} className="w-full text-amber-100/60 hover:text-amber-100 px-4 py-2 rounded-sm tracking-[0.2em] text-xs uppercase disabled:opacity-30 transition">
              Have a code? Join Room
            </button>
            {installPlatform && (
              <div className="pt-6 text-center text-amber-100/40 text-[10px] tracking-[0.25em] uppercase leading-relaxed">
                {installPlatform === "ios" ? (
                  <>
                    Tap <span className="text-amber-100/70 not-italic">⬆︎</span> Share <span className="text-amber-100/70">→</span> "Add to Home Screen"
                    <div className="text-[9px] tracking-widest text-amber-100/30 mt-1 normal-case">opens like an app</div>
                  </>
                ) : (
                  <>
                    Open menu <span className="text-amber-100/70 not-italic">⋮</span> <span className="text-amber-100/70">→</span> "Install app"
                    <div className="text-[9px] tracking-widest text-amber-100/30 mt-1 normal-case">opens like an app</div>
                  </>
                )}
              </div>
            )}
          </div>
        ) : (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
            <input
              type="text"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4))}
              placeholder="CODE"
              className="w-full bg-stone-900/60 border border-amber-100/20 text-amber-50 px-4 py-3 rounded-sm focus:outline-none focus:border-amber-200/60 placeholder:text-amber-100/30 text-center tracking-[0.5em] text-2xl"
              autoFocus
            />
            <button disabled={code.length !== 4} onClick={handleJoin} className="w-full bg-amber-100 text-stone-900 px-4 py-3 rounded-sm tracking-[0.2em] text-xs uppercase font-semibold disabled:opacity-30 active:scale-95 transition">
              Join Room
            </button>
            <button onClick={() => setMode("choose")} className="w-full text-amber-100/60 text-xs tracking-widest uppercase py-2">← Back</button>
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}
