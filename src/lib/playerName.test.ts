import { describe, it, expect, beforeEach, vi } from "vitest";
import { getPlayerName, setPlayerName, clearPlayerName, EXPIRY_MS } from "./playerName";

// The test environment is `node`, which has no localStorage. Stub a minimal
// in-memory implementation before each test so the module under test can
// read and write to it normally.
beforeEach(() => {
  const store: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = v;
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    key: () => null,
    length: 0,
  });
});

describe("playerName persistence", () => {
  it("returns null when nothing is stored", () => {
    expect(getPlayerName()).toBeNull();
  });

  it("round-trips a name within the expiry window", () => {
    const now = 1_700_000_000_000;
    setPlayerName("Sean", now);
    expect(getPlayerName(now)).toBe("Sean");
    expect(getPlayerName(now + 1000)).toBe("Sean");
  });

  it("returns the name just before the 24h boundary", () => {
    const now = 1_700_000_000_000;
    setPlayerName("Sean", now);
    expect(getPlayerName(now + EXPIRY_MS - 1)).toBe("Sean");
  });

  it("returns null once 24h have elapsed", () => {
    const now = 1_700_000_000_000;
    setPlayerName("Sean", now);
    expect(getPlayerName(now + EXPIRY_MS + 1)).toBeNull();
  });

  it("clears the stored value on expiry so subsequent reads are also null", () => {
    const now = 1_700_000_000_000;
    setPlayerName("Sean", now);
    getPlayerName(now + EXPIRY_MS + 1); // expires + clears
    expect(localStorage.getItem("playerName")).toBeNull();
    expect(getPlayerName(now + EXPIRY_MS + 1)).toBeNull();
  });

  it("treats a legacy plain-string value as stale and clears it", () => {
    // Pre-expiry versions stored the name as a bare string. JSON.parse of a
    // non-quoted string throws, which the helper interprets as legacy.
    localStorage.setItem("playerName", "Sean");
    expect(getPlayerName()).toBeNull();
    expect(localStorage.getItem("playerName")).toBeNull();
  });

  it("treats malformed JSON as stale and clears it", () => {
    localStorage.setItem("playerName", "{not valid json");
    expect(getPlayerName()).toBeNull();
    expect(localStorage.getItem("playerName")).toBeNull();
  });

  it("treats wrong-shape JSON as stale and clears it", () => {
    localStorage.setItem("playerName", JSON.stringify({ name: 42, ts: "bad" }));
    expect(getPlayerName()).toBeNull();
    expect(localStorage.getItem("playerName")).toBeNull();
  });

  it("refreshes the timestamp on every setPlayerName call", () => {
    const t0 = 1_700_000_000_000;
    setPlayerName("Sean", t0);

    // 23 hours later — still valid.
    expect(getPlayerName(t0 + 23 * 60 * 60 * 1000)).toBe("Sean");

    // Re-set at hour 23 — clock restarts.
    setPlayerName("Sean", t0 + 23 * 60 * 60 * 1000);

    // 23 hours after the refresh (46h after the original) — still valid.
    expect(getPlayerName(t0 + 46 * 60 * 60 * 1000)).toBe("Sean");
  });

  it("clearPlayerName removes the stored value", () => {
    setPlayerName("Sean");
    clearPlayerName();
    expect(getPlayerName()).toBeNull();
    expect(localStorage.getItem("playerName")).toBeNull();
  });
});
