import { describe, expect, it } from "vitest";
import { SLOT_CONFIG } from "./engine";
import {
  createLeaderboardEntry,
  createRecoveryCheckIn,
  getDefaultRecoveryState,
  sanitizeRecoveryState,
  sanitizeAnonymousProfile,
  sanitizePersistedState,
  upsertLeaderboard,
} from "./state";

describe("state sanitizer", () => {
  it("clamps and normalizes invalid values", () => {
    const state = sanitizePersistedState({
      credits: -500,
      bet: SLOT_CONFIG.maxBet + 999,
      stats: {
        spins: -1,
        wins: 8.9,
        totalWon: Number.NaN,
        biggestWin: 251.3,
      },
    });

    expect(state.credits).toBe(0);
    expect(state.bet).toBe(SLOT_CONFIG.maxBet);
    expect(state.stats.spins).toBe(0);
    expect(state.stats.wins).toBe(8);
    expect(state.stats.totalWon).toBe(0);
    expect(state.stats.biggestWin).toBe(251);
  });

  it("falls back when payload is not an object", () => {
    const state = sanitizePersistedState(null);

    expect(state.credits).toBe(SLOT_CONFIG.defaultCredits);
    expect(state.bet).toBe(SLOT_CONFIG.defaultBet);
  });

  it("creates a valid anonymous profile when input is invalid", () => {
    const profile = sanitizeAnonymousProfile(null);

    expect(profile.deviceId.length).toBeGreaterThan(0);
    expect(profile.alias.startsWith("Guest-")).toBe(true);
    expect(profile.createdAt.length).toBeGreaterThan(0);
  });

  it("upserts leaderboard entries by device and preserves best values", () => {
    const profile = sanitizeAnonymousProfile({
      deviceId: "device-1",
      alias: "Guest-123456",
      createdAt: new Date().toISOString(),
    });

    const first = createLeaderboardEntry({
      profile,
      credits: 500,
      stats: { spins: 10, wins: 3, totalWon: 200, biggestWin: 80 },
    });
    const second = createLeaderboardEntry({
      profile,
      credits: 750,
      stats: { spins: 15, wins: 5, totalWon: 300, biggestWin: 110 },
    });

    const leaderboard = upsertLeaderboard(upsertLeaderboard([], first), second);

    expect(leaderboard).toHaveLength(1);
    expect(leaderboard[0]?.bestBalance).toBe(750);
    expect(leaderboard[0]?.totalWon).toBe(300);
    expect(leaderboard[0]?.biggestWin).toBe(110);
  });

  it("sanitizes recovery state and keeps calm mode defaults", () => {
    const recovery = sanitizeRecoveryState({
      calmMode: false,
      breakUntil: "2026-04-09T00:00:00.000Z",
      checkIns: [{ id: "1", createdAt: "2026-04-09T00:00:00.000Z", urgeLevel: 7, mood: "Anxious", note: "Need a break" }],
    });

    expect(recovery.calmMode).toBe(false);
    expect(recovery.breakUntil).toBe("2026-04-09T00:00:00.000Z");
    expect(recovery.checkIns[0]?.urgeLevel).toBe(5);
  });

  it("creates normalized recovery check-ins", () => {
    const checkIn = createRecoveryCheckIn({ urgeLevel: 9, mood: "  tense ", note: "  pause now  " });
    const fallback = getDefaultRecoveryState();

    expect(checkIn.urgeLevel).toBe(5);
    expect(checkIn.mood).toBe("tense");
    expect(checkIn.note).toBe("pause now");
    expect(fallback.calmMode).toBe(true);
  });
});
