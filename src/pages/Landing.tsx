/**
 * @file Landing page — the create/join screen at `/`.
 *
 * Two states:
 * - `choose` — name input + Create or Join buttons.
 * - `join` — name persisted, 4-character code input + Join Room button.
 *
 * Name is persisted to `localStorage` as `playerName` so returning visitors
 * skip the typing. The actual player identity (`playerId`) is generated
 * lazily on the room page, not here.
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { getPlayerName, setPlayerName } from "../lib/playerName";

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
 * Navigates to `/room/:code` once the user has a name and either created
 * a new code or typed an existing one.
 */
export default function Landing() {
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [mode, setMode] = useState<"choose" | "join">("choose");

  useEffect(() => {
    const saved = getPlayerName();
    if (saved) setName(saved);
  }, []);

  const handleCreate = () => {
    if (!name.trim()) return;
    setPlayerName(name);
    nav(`/room/${generateCode()}`);
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
              Create Room
            </button>
            <button disabled={!name.trim()} onClick={() => setMode("join")} className="w-full border border-amber-100/40 text-amber-100 px-4 py-3 rounded-sm tracking-[0.2em] text-xs uppercase disabled:opacity-30 active:scale-95 transition">
              Join with Code
            </button>
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
