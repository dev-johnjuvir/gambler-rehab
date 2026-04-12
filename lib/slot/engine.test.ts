import { describe, expect, it } from "vitest";
import { BONUS_SPIN_COUNT, createSpinResult, getBonusSpinsForScatter, SLOT_CONFIG } from "./engine";

describe("slot engine", () => {
  it("builds reels using configured dimensions", () => {
    const result = createSpinResult({
      bet: 10,
      random: () => 0.3,
    });

    expect(result.reels).toHaveLength(SLOT_CONFIG.reels);
    result.reels.forEach((reel) => {
      expect(reel).toHaveLength(SLOT_CONFIG.rows);
    });
  });

  it("awards scatter payout when crowns hit 3+", () => {
    const result = createSpinResult({
      bet: 10,
      random: () => 0.999,
    });

    expect(result.scatterWin?.multiplier).toBe(40);
    expect(result.scatterWin?.payout).toBe(400);
    expect(result.totalPayout).toBeGreaterThanOrEqual(400);
  });

  it("awards exact-card wins when the same card lands on consecutive reels", () => {
    const result = createSpinResult({
      bet: 10,
      random: () => 0,
    });

    expect(result.lineWins.length).toBeGreaterThan(0);
    expect(result.totalPayout).toBeGreaterThan(0);
    result.lineWins.forEach((lineWin) => {
      expect(lineWin.symbol).toBe("A_hearts");
      expect(lineWin.count).toBe(5);
      expect(lineWin.positions.length).toBeGreaterThan(0);
    });
  });

  it("maps scatter count to bonus spins", () => {
    expect(getBonusSpinsForScatter(0)).toBe(0);
    expect(getBonusSpinsForScatter(2)).toBe(0);
    expect(getBonusSpinsForScatter(3)).toBe(BONUS_SPIN_COUNT);
    expect(getBonusSpinsForScatter(4)).toBe(BONUS_SPIN_COUNT);
    expect(getBonusSpinsForScatter(5)).toBe(BONUS_SPIN_COUNT);
    expect(getBonusSpinsForScatter(999)).toBe(BONUS_SPIN_COUNT);
  });

  it("uses a slightly better symbol mix during bonus spins", () => {
    const defaultSpin = createSpinResult({
      bet: 10,
      mode: "default",
      random: () => 0.032,
    });
    const bonusSpin = createSpinResult({
      bet: 10,
      mode: "bonus",
      random: () => 0.032,
    });

    expect(defaultSpin.lineWins[0]?.symbol).toBe("K_hearts");
    expect(bonusSpin.lineWins[0]?.symbol).toBe("A_hearts");
    expect(bonusSpin.totalPayout).toBeGreaterThan(defaultSpin.totalPayout);
  });
});
