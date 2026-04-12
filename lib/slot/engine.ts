import {
  type CardRank,
  type CardSymbolId,
  type LineWin,
  type PersistedGameState,
  type SpinMode,
  type SlotSymbol,
  type SpinConfig,
  type SpinResult,
  type SymbolId,
  type WinningPosition,
} from "./types";

export const SLOT_CONFIG: SpinConfig = {
  reels: 5,
  rows: 4,
  minBet: 10,
  maxBet: 2000,
  defaultBet: 20,
  defaultCredits: 500,
};

const CARD_RANKS: CardRank[] = ["A", "K", "Q", "J", "10"];

const RANK_LINE_PAYOUTS: Record<CardRank, Record<3 | 4 | 5, number>> = {
  A: { 3: 8, 4: 16, 5: 32 },
  K: { 3: 7, 4: 14, 5: 28 },
  Q: { 3: 6, 4: 12, 5: 24 },
  J: { 3: 5, 4: 10, 5: 20 },
  "10": { 3: 4, 4: 8, 5: 16 },
};

const RANK_WEIGHTS: Record<CardRank, number> = {
  A: 4,
  K: 5,
  Q: 6,
  J: 7,
  "10": 9,
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
    weight: 5,
  },
];

const SCATTER_MULTIPLIERS: Partial<Record<number, number>> = {
  3: 5,
  4: 15,
  5: 40,
};

export const BONUS_SPIN_COUNT = 10;
const BONUS_TRIGGER_SCATTER_COUNT = 3;

const BONUS_WEIGHT_BY_SYMBOL: Partial<Record<SymbolId, number>> = {
  A_hearts: 5,
  A_diamonds: 5,
  A_clubs: 5,
  A_spades: 5,
  K_hearts: 6,
  K_diamonds: 6,
  K_clubs: 6,
  K_spades: 6,
  Q_hearts: 7,
  Q_diamonds: 7,
  Q_clubs: 7,
  Q_spades: 7,
  "10_hearts": 8,
  "10_diamonds": 8,
  "10_clubs": 8,
  "10_spades": 8,
  crown: 6,
};

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

const DEFAULT_WEIGHTED_SYMBOL_POOL = createWeightedSymbolPool("default");
const BONUS_WEIGHTED_SYMBOL_POOL = createWeightedSymbolPool("bonus");

const byId = new Map(SYMBOLS.map((symbol) => [symbol.id, symbol]));

export function getDefaultGameState(): PersistedGameState {
  return structuredClone(DEFAULT_GAME_STATE);
}

export function getSymbol(id: SymbolId): SlotSymbol {
  return byId.get(id) ?? SYMBOLS[0];
}

export function createIdleReels(random: () => number = Math.random): SymbolId[][] {
  return createReels(SLOT_CONFIG.reels, SLOT_CONFIG.rows, random, "default");
}

export function createSpinResult({
  bet,
  mode = "default",
  random = Math.random,
}: {
  bet: number;
  mode?: SpinMode;
  random?: () => number;
}): SpinResult {
  const reels = createReels(SLOT_CONFIG.reels, SLOT_CONFIG.rows, random, mode);
  const lineWins = evaluateExactCardWins(reels, bet);

  const scatterPositions = getMatchingPositions(reels, "crown");
  const scatterCount = scatterPositions.length;
  const scatterMultiplier = SCATTER_MULTIPLIERS[Math.min(scatterCount, 5)] ?? 0;
  const scatterWin =
    scatterMultiplier > 0
      ? {
          symbol: "crown" as const,
          count: scatterCount,
          multiplier: scatterMultiplier,
          payout: scatterMultiplier * bet,
          positions: scatterPositions,
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
  return normalizedCount >= BONUS_TRIGGER_SCATTER_COUNT ? BONUS_SPIN_COUNT : 0;
}

function evaluateExactCardWins(reels: SymbolId[][], bet: number): LineWin[] {
  return CARD_SYMBOLS.flatMap((symbol) => {
    const reelMatches: WinningPosition[] = [];
    let consecutiveReels = 0;

    for (let reelIndex = 0; reelIndex < reels.length; reelIndex += 1) {
      const rowMatches = reels[reelIndex]
        ?.map((currentSymbol, rowIndex) =>
          currentSymbol === symbol.id ? { reelIndex, rowIndex } : null,
        )
        .filter((position): position is WinningPosition => position !== null);

      if (!rowMatches || rowMatches.length === 0) {
        break;
      }

      consecutiveReels += 1;
      reelMatches.push(...rowMatches);
    }

    if (consecutiveReels < 3) {
      return [];
    }

    const multiplier = symbol.linePayouts?.[consecutiveReels as 3 | 4 | 5] ?? 0;

    if (multiplier <= 0) {
      return [];
    }

    return [
      {
        symbol: symbol.id as CardSymbolId,
        count: consecutiveReels,
        multiplier,
        payout: bet * multiplier,
        positions: reelMatches,
      },
    ];
  });
}

function getMatchingPositions(reels: SymbolId[][], symbolId: SymbolId): WinningPosition[] {
  return reels.flatMap((reel, reelIndex) =>
    reel.flatMap((symbol, rowIndex) => (symbol === symbolId ? [{ reelIndex, rowIndex }] : [])),
  );
}

function createReels(reels: number, rows: number, random: () => number, mode: SpinMode): SymbolId[][] {
  return Array.from({ length: reels }, () =>
    Array.from({ length: rows }, () => pickSymbol(random, mode)),
  );
}

function createWeightedSymbolPool(mode: SpinMode): SymbolId[] {
  return SYMBOLS.flatMap((symbol) => {
    const weight = mode === "bonus" ? (BONUS_WEIGHT_BY_SYMBOL[symbol.id] ?? symbol.weight) : symbol.weight;
    return Array.from({ length: weight }, () => symbol.id);
  });
}

function pickSymbol(random: () => number, mode: SpinMode): SymbolId {
  const weightedSymbolPool = mode === "bonus" ? BONUS_WEIGHTED_SYMBOL_POOL : DEFAULT_WEIGHTED_SYMBOL_POOL;
  const raw = Math.floor(random() * weightedSymbolPool.length);
  const index = Math.min(Math.max(raw, 0), weightedSymbolPool.length - 1);
  return weightedSymbolPool[index] as SymbolId;
}
