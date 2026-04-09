import {
  type CardRank,
  type LineWin,
  type PersistedGameState,
  type SlotSymbol,
  type SpinConfig,
  type SpinResult,
  type SymbolId,
} from "./types";

export const SLOT_CONFIG: SpinConfig = {
  reels: 5,
  rows: 4,
  minBet: 10,
  maxBet: 2000,
  defaultBet: 20,
  defaultCredits: 1200,
};

const CARD_RANKS: CardRank[] = ["A", "K", "Q", "J", "10", "9", "8", "7", "6", "5", "4", "3", "2"];

const RANK_LINE_PAYOUTS: Record<CardRank, Record<3 | 4 | 5, number>> = {
  A: { 3: 8, 4: 16, 5: 32 },
  K: { 3: 7, 4: 14, 5: 28 },
  Q: { 3: 6, 4: 12, 5: 24 },
  J: { 3: 5, 4: 10, 5: 20 },
  "10": { 3: 4, 4: 8, 5: 16 },
  "9": { 3: 4, 4: 8, 5: 16 },
  "8": { 3: 3, 4: 6, 5: 12 },
  "7": { 3: 3, 4: 6, 5: 12 },
  "6": { 3: 3, 4: 6, 5: 12 },
  "5": { 3: 2, 4: 5, 5: 10 },
  "4": { 3: 2, 4: 5, 5: 10 },
  "3": { 3: 2, 4: 5, 5: 10 },
  "2": { 3: 2, 4: 5, 5: 10 },
};

const RANK_WEIGHTS: Record<CardRank, number> = {
  A: 4,
  K: 5,
  Q: 6,
  J: 7,
  "10": 9,
  "9": 11,
  "8": 13,
  "7": 15,
  "6": 17,
  "5": 19,
  "4": 21,
  "3": 23,
  "2": 25,
};

const SUITS = [
  { id: "hearts", label: "Hearts", glyph: "\u2665" },
  { id: "diamonds", label: "Diamonds", glyph: "\u2666" },
  { id: "clubs", label: "Clubs", glyph: "\u2663" },
  { id: "spades", label: "Spades", glyph: "\u2660" },
] as const;

const CARD_SYMBOLS: SlotSymbol[] = SUITS.flatMap((suit) =>
  CARD_RANKS.map((rank) => ({
    id: `${rank}_${suit.id}` as SymbolId,
    label: `${rank} of ${suit.label}`,
    glyph: `${rank}${suit.glyph}`,
    rank,
    suit: suit.id,
    weight: RANK_WEIGHTS[rank],
    linePayouts: RANK_LINE_PAYOUTS[rank],
  })),
);

export const SYMBOLS: SlotSymbol[] = [
  ...CARD_SYMBOLS,
  {
    id: "crown",
    label: "Scatter Crown",
    glyph: "\u2726",
    rank: null,
    suit: null,
    weight: 14,
  },
];

const SCATTER_MULTIPLIERS: Partial<Record<number, number>> = {
  3: 5,
  4: 15,
  5: 40,
};

const BONUS_SPINS_BY_SCATTER: Partial<Record<number, number>> = {
  3: 5,
  4: 8,
  5: 12,
};

export const PAYLINES: number[][] = [
  [0, 0, 0, 0, 0],
  [1, 1, 1, 1, 1],
  [2, 2, 2, 2, 2],
  [3, 3, 3, 3, 3],
  [0, 1, 2, 1, 0],
  [3, 2, 1, 2, 3],
  [1, 0, 0, 0, 1],
  [2, 3, 3, 3, 2],
  [0, 0, 1, 2, 3],
  [3, 3, 2, 1, 0],
  [1, 2, 3, 2, 1],
  [2, 1, 0, 1, 2],
  [0, 1, 1, 1, 0],
  [3, 2, 2, 2, 3],
  [1, 2, 2, 2, 1],
  [2, 2, 1, 0, 0],
  [1, 1, 2, 3, 3],
  [0, 1, 0, 1, 0],
  [3, 2, 3, 2, 3],
  [0, 2, 3, 2, 0],
  [3, 1, 0, 1, 3],
];

const DEFAULT_GAME_STATE: PersistedGameState = {
  credits: SLOT_CONFIG.defaultCredits,
  bet: SLOT_CONFIG.defaultBet,
  stats: {
    spins: 0,
    wins: 0,
    totalWon: 0,
    biggestWin: 0,
  },
};

const weightedSymbolPool = SYMBOLS.flatMap((symbol) =>
  Array.from({ length: symbol.weight }, () => symbol.id),
);

const byId = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));

export function getDefaultGameState(): PersistedGameState {
  return structuredClone(DEFAULT_GAME_STATE);
}

export function getSymbol(id: SymbolId): SlotSymbol {
  return byId.get(id) ?? SYMBOLS[0];
}

export function createIdleReels(random: () => number = Math.random): SymbolId[][] {
  return createReels(SLOT_CONFIG.reels, SLOT_CONFIG.rows, random);
}

export function createSpinResult({
  bet,
  random = Math.random,
}: {
  bet: number;
  random?: () => number;
}): SpinResult {
  const reels = createReels(SLOT_CONFIG.reels, SLOT_CONFIG.rows, random);

  const lineWins = PAYLINES.flatMap((line, lineIndex) => {
    const evaluated = evaluatePayline(reels, line, bet, lineIndex);
    return evaluated ? [evaluated] : [];
  });

  const scatterCount = reels.flat().filter((symbol) => symbol === "crown").length;
  const scatterMultiplier = SCATTER_MULTIPLIERS[Math.min(scatterCount, 5)] ?? 0;
  const scatterWin =
    scatterMultiplier > 0
      ? {
          symbol: "crown" as const,
          count: scatterCount,
          multiplier: scatterMultiplier,
          payout: scatterMultiplier * bet,
        }
      : null;

  const lineTotal = lineWins.reduce((sum, lineWin) => sum + lineWin.payout, 0);
  const totalPayout = lineTotal + (scatterWin?.payout ?? 0);

  return {
    reels,
    bet,
    lineWins,
    scatterWin,
    totalPayout,
  };
}

export function getBonusSpinsForScatter(scatterCount: number): number {
  const normalizedCount = Math.min(Math.max(Math.floor(scatterCount), 0), 5);
  return BONUS_SPINS_BY_SCATTER[normalizedCount] ?? 0;
}

function evaluatePayline(
  reels: SymbolId[][],
  line: number[],
  bet: number,
  lineIndex: number,
): LineWin | null {
  const firstSymbol = reels[0]?.[line[0]];
  const firstMeta = firstSymbol ? getSymbol(firstSymbol) : null;

  if (!firstMeta || firstMeta.id === "crown" || !firstMeta.rank) {
    return null;
  }

  let count = 1;

  for (let reel = 1; reel < reels.length; reel += 1) {
    const current = reels[reel]?.[line[reel]];
    const currentMeta = current ? getSymbol(current) : null;

    if (currentMeta && currentMeta.id !== "crown" && currentMeta.rank === firstMeta.rank) {
      count += 1;
      continue;
    }

    break;
  }

  if (count < 3) {
    return null;
  }

  const multiplier = firstMeta.linePayouts?.[count as 3 | 4 | 5] ?? 0;

  if (multiplier <= 0) {
    return null;
  }

  return {
    lineIndex,
    rank: firstMeta.rank,
    count,
    multiplier,
    payout: bet * multiplier,
  };
}

function createReels(reels: number, rows: number, random: () => number): SymbolId[][] {
  return Array.from({ length: reels }, () =>
    Array.from({ length: rows }, () => pickSymbol(random)),
  );
}

function pickSymbol(random: () => number): SymbolId {
  const raw = Math.floor(random() * weightedSymbolPool.length);
  const index = Math.min(Math.max(raw, 0), weightedSymbolPool.length - 1);
  return weightedSymbolPool[index] as SymbolId;
}
