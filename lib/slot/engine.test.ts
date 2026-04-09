import { describe, expect, it } from "vitest";
import { createSpinResult, getBonusSpinsForScatter, SLOT_CONFIG } from "./engine";

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

  it("awards line wins when matching rank lands across reels", () => {
    const result = createSpinResult({
      bet: 10,
      random: () => 0,
    });

    expect(result.lineWins.length).toBeGreaterThan(0);
    expect(result.totalPayout).toBeGreaterThan(0);
    result.lineWins.forEach((lineWin) => {
      expect(lineWin.rank).toBe("A");
    });
  });

  it("maps scatter count to bonus spins", () => {
    expect(getBonusSpinsForScatter(0)).toBe(0);
    expect(getBonusSpinsForScatter(2)).toBe(0);
    expect(getBonusSpinsForScatter(3)).toBe(5);
    expect(getBonusSpinsForScatter(4)).toBe(8);
    expect(getBonusSpinsForScatter(5)).toBe(12);
    expect(getBonusSpinsForScatter(999)).toBe(12);
  });
});
