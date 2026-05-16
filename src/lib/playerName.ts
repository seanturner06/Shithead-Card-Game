/**
 * @file Persistence helpers for the player's display name.
 *
 * Stored in `localStorage` under the key `playerName` as a JSON blob
 * `{ name, ts }`. The timestamp lets us expire stale names after
 * {@link EXPIRY_MS}, so a shared device doesn't show a stranger's name
 * in the field days later.
 *
 * Note: `playerId` (the stable seat identifier) is intentionally **not**
 * subject to expiry. It needs to persist indefinitely so a player who
 * reconnects to an in-progress room is recognized as the same person.
 * Only the human-readable name is privacy-sensitive.
 */

const KEY = "playerName";

/** 24 hours, in milliseconds. */
export const EXPIRY_MS = 24 * 60 * 60 * 1000;

type Stored = { name: string; ts: number };

/**
 * Read the stored player name, or `null` if there isn't one or the stored
 * value has expired.
 *
 * Side effect: an expired or malformed value is removed from storage on read
 * so subsequent calls return `null` immediately.
 *
 * @param now Optional override for the current time, in ms since epoch.
 *            Tests pass this in to avoid mocking `Date.now()`.
 */
export function getPlayerName(now: number = Date.now()): string | null {
  const raw = localStorage.getItem(KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as Stored;
    if (typeof parsed.name !== "string" || typeof parsed.ts !== "number") {
      localStorage.removeItem(KEY);
      return null;
    }
    if (now - parsed.ts > EXPIRY_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return parsed.name;
  } catch {
    // Legacy plain-string value (pre-expiry) or otherwise unparseable.
    // Treat as stale and clear.
    localStorage.removeItem(KEY);
    return null;
  }
}

/**
 * Persist the player name with a fresh timestamp. The expiry clock restarts
 * on every call — actively-used names won't expire mid-session.
 */
export function setPlayerName(name: string, now: number = Date.now()): void {
  const value: Stored = { name, ts: now };
  localStorage.setItem(KEY, JSON.stringify(value));
}

/** Remove the stored player name. */
export function clearPlayerName(): void {
  localStorage.removeItem(KEY);
}
