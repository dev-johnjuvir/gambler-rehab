import { getDefaultGameState, SLOT_CONFIG } from "./engine";
import type {
  AnonymousProfile,
  GameStats,
  LeaderboardEntry,
  PersistedGameState,
  RecoveryCheckIn,
  RecoveryState,
} from "./types";

export const STORAGE_KEY = "scatter-rehab-v1";
export const PROFILE_STORAGE_KEY = "scatter-rehab-profile-v1";
export const LEADERBOARD_STORAGE_KEY = "scatter-rehab-leaderboard-v1";
export const RECOVERY_STORAGE_KEY = "scatter-rehab-recovery-v1";

export function sanitizePersistedState(input: unknown): PersistedGameState {
  const fallback = getDefaultGameState();

  if (!input || typeof input !== "object") {
    return fallback;
  }

  const data = input as Partial<PersistedGameState>;
  const safeCredits =
    typeof data.credits === "number" && Number.isFinite(data.credits)
      ? Math.max(0, Math.floor(data.credits))
      : fallback.credits;
  const safeBet =
    typeof data.bet === "number" && Number.isFinite(data.bet)
      ? Math.min(SLOT_CONFIG.maxBet, Math.max(SLOT_CONFIG.minBet, Math.floor(data.bet)))
      : fallback.bet;
  const safeStats = {
    spins: clampWholeNumber(data.stats?.spins, fallback.stats.spins),
    wins: clampWholeNumber(data.stats?.wins, fallback.stats.wins),
    totalWon: clampWholeNumber(data.stats?.totalWon, fallback.stats.totalWon),
    biggestWin: clampWholeNumber(data.stats?.biggestWin, fallback.stats.biggestWin),
  };

  return {
    credits: safeCredits,
    bet: safeBet,
    stats: safeStats,
  };
}

export function createAnonymousProfile(): AnonymousProfile {
  const suffix = createId().slice(-6).toUpperCase();

  return {
    deviceId: createId(),
    alias: `Guest-${suffix}`,
    createdAt: new Date().toISOString(),
  };
}

export function sanitizeAnonymousProfile(input: unknown): AnonymousProfile {
  if (!input || typeof input !== "object") {
    return createAnonymousProfile();
  }

  const data = input as Partial<AnonymousProfile>;

  if (
    typeof data.deviceId !== "string" ||
    !data.deviceId ||
    typeof data.alias !== "string" ||
    !data.alias ||
    typeof data.createdAt !== "string" ||
    !data.createdAt
  ) {
    return createAnonymousProfile();
  }

  return {
    deviceId: data.deviceId,
    alias: data.alias,
    createdAt: data.createdAt,
  };
}

export function createLeaderboardEntry({
  profile,
  credits,
  stats,
}: {
  profile: AnonymousProfile;
  credits: number;
  stats: GameStats;
}): LeaderboardEntry {
  return {
    deviceId: profile.deviceId,
    alias: profile.alias,
    bestBalance: Math.max(0, Math.floor(credits)),
    totalWon: Math.max(0, Math.floor(stats.totalWon)),
    biggestWin: Math.max(0, Math.floor(stats.biggestWin)),
    wins: Math.max(0, Math.floor(stats.wins)),
    spins: Math.max(0, Math.floor(stats.spins)),
    updatedAt: new Date().toISOString(),
  };
}

export function sanitizeLeaderboard(input: unknown): LeaderboardEntry[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry): entry is LeaderboardEntry => Boolean(entry && typeof entry === "object"))
    .map((entry) => {
      const data = entry as Partial<LeaderboardEntry>;

      return {
        deviceId: typeof data.deviceId === "string" ? data.deviceId : createId(),
        alias: typeof data.alias === "string" ? data.alias : "Guest-Local",
        bestBalance: clampWholeNumber(data.bestBalance, 0),
        totalWon: clampWholeNumber(data.totalWon, 0),
        biggestWin: clampWholeNumber(data.biggestWin, 0),
        wins: clampWholeNumber(data.wins, 0),
        spins: clampWholeNumber(data.spins, 0),
        updatedAt:
          typeof data.updatedAt === "string" && data.updatedAt ? data.updatedAt : new Date().toISOString(),
      };
    })
    .sort(compareLeaderboardEntries)
    .slice(0, 10);
}

export function upsertLeaderboard(
  entries: LeaderboardEntry[],
  nextEntry: LeaderboardEntry,
): LeaderboardEntry[] {
  const withoutCurrentDevice = entries.filter((entry) => entry.deviceId !== nextEntry.deviceId);
  const previousEntry = entries.find((entry) => entry.deviceId === nextEntry.deviceId);

  const mergedEntry: LeaderboardEntry = previousEntry
    ? {
        ...nextEntry,
        bestBalance: Math.max(previousEntry.bestBalance, nextEntry.bestBalance),
        totalWon: Math.max(previousEntry.totalWon, nextEntry.totalWon),
        biggestWin: Math.max(previousEntry.biggestWin, nextEntry.biggestWin),
        wins: Math.max(previousEntry.wins, nextEntry.wins),
        spins: Math.max(previousEntry.spins, nextEntry.spins),
      }
    : nextEntry;

  return [...withoutCurrentDevice, mergedEntry].sort(compareLeaderboardEntries).slice(0, 10);
}

export function getDefaultRecoveryState(): RecoveryState {
  return {
    calmMode: true,
    breakUntil: null,
    checkIns: [],
  };
}

export function sanitizeRecoveryState(input: unknown): RecoveryState {
  const fallback = getDefaultRecoveryState();

  if (!input || typeof input !== "object") {
    return fallback;
  }

  const data = input as Partial<RecoveryState>;

  return {
    calmMode: typeof data.calmMode === "boolean" ? data.calmMode : fallback.calmMode,
    breakUntil:
      typeof data.breakUntil === "string" && data.breakUntil.length > 0 ? data.breakUntil : null,
    checkIns: sanitizeRecoveryCheckIns(data.checkIns),
  };
}

export function createRecoveryCheckIn({
  urgeLevel,
  mood,
  note,
}: {
  urgeLevel: number;
  mood: string;
  note: string;
}): RecoveryCheckIn {
  return {
    id: createId(),
    createdAt: new Date().toISOString(),
    urgeLevel: Math.min(5, Math.max(1, Math.floor(urgeLevel))),
    mood: mood.trim() || "Unspecified",
    note: note.trim(),
  };
}

function sanitizeRecoveryCheckIns(input: unknown): RecoveryCheckIn[] {
  if (!Array.isArray(input)) {
    return [];
  }

  return input
    .filter((entry): entry is RecoveryCheckIn => Boolean(entry && typeof entry === "object"))
    .map((entry) => {
      const data = entry as Partial<RecoveryCheckIn>;

      return {
        id: typeof data.id === "string" && data.id ? data.id : createId(),
        createdAt:
          typeof data.createdAt === "string" && data.createdAt ? data.createdAt : new Date().toISOString(),
        urgeLevel:
          typeof data.urgeLevel === "number" && Number.isFinite(data.urgeLevel)
            ? Math.min(5, Math.max(1, Math.floor(data.urgeLevel)))
            : 1,
        mood: typeof data.mood === "string" && data.mood ? data.mood : "Unspecified",
        note: typeof data.note === "string" ? data.note : "",
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 20);
}

function compareLeaderboardEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  return (
    b.bestBalance - a.bestBalance ||
    b.totalWon - a.totalWon ||
    b.biggestWin - a.biggestWin ||
    b.wins - a.wins ||
    b.spins - a.spins ||
    b.updatedAt.localeCompare(a.updatedAt)
  );
}

function createId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `guest-${Math.random().toString(36).slice(2, 10)}`;
}

function clampWholeNumber(value: unknown, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.floor(value));
}
