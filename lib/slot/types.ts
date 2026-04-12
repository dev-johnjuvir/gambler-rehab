export type SuitId = "hearts" | "diamonds" | "clubs" | "spades";
export type CardRank = "A" | "K" | "Q" | "J" | "10";
export type CardSymbolId = `${CardRank}_${SuitId}`;
export type SymbolId = CardSymbolId | "crown";

export interface SlotSymbol {
  id: SymbolId;
  label: string;
  glyph: string;
  rank: CardRank | null;
  suit: SuitId | null;
  weight: number;
  linePayouts?: Partial<Record<3 | 4 | 5, number>>;
}

export interface WinningPosition {
  reelIndex: number;
  rowIndex: number;
}

export interface LineWin {
  symbol: CardSymbolId;
  count: number;
  multiplier: number;
  payout: number;
  positions: WinningPosition[];
}

export interface ScatterWin {
  symbol: "crown";
  count: number;
  multiplier: number;
  payout: number;
  positions: WinningPosition[];
}

export interface SpinResult {
  reels: SymbolId[][];
  bet: number;
  lineWins: LineWin[];
  scatterWin: ScatterWin | null;
  totalPayout: number;
}

export type SpinMode = "default" | "bonus";

export interface SpinConfig {
  reels: number;
  rows: number;
  minBet: number;
  maxBet: number;
  defaultBet: number;
  defaultCredits: number;
}

export interface GameStats {
  spins: number;
  wins: number;
  totalWon: number;
  biggestWin: number;
}

export interface PersistedGameState {
  credits: number;
  bet: number;
  stats: GameStats;
}

export interface AnonymousProfile {
  deviceId: string;
  alias: string;
  createdAt: string;
}

export interface LeaderboardEntry {
  deviceId: string;
  alias: string;
  bestBalance: number;
  totalWon: number;
  biggestWin: number;
  wins: number;
  spins: number;
  updatedAt: string;
}

export interface RecoveryCheckIn {
  id: string;
  createdAt: string;
  urgeLevel: number;
  mood: string;
  note: string;
}

export interface RecoveryState {
  calmMode: boolean;
  breakUntil: string | null;
  checkIns: RecoveryCheckIn[];
}
