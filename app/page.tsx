"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  createIdleReels,
  createSpinResult,
  getBonusSpinsForScatter,
  getSymbol,
  SLOT_CONFIG,
} from "@/lib/slot/engine";
import {
  createAnonymousProfile,
  createLeaderboardEntry,
  createRecoveryCheckIn,
  getDefaultRecoveryState,
  LEADERBOARD_STORAGE_KEY,
  PROFILE_STORAGE_KEY,
  RECOVERY_STORAGE_KEY,
  sanitizeAnonymousProfile,
  sanitizeLeaderboard,
  sanitizePersistedState,
  sanitizeRecoveryState,
  STORAGE_KEY,
  upsertLeaderboard,
} from "@/lib/slot/state";
import type {
  AnonymousProfile,
  LeaderboardEntry,
  PersistedGameState,
  RecoveryState,
  SpinResult,
  SymbolId,
} from "@/lib/slot/types";
import type { BeforeInstallPromptEvent } from "@/types/pwa";
import styles from "./page.module.scss";

const SPIN_DURATION_MS = 2550;
const BONUS_SPIN_GAP_MS = 800;
const FIRST_REEL_STOP_MS = 980;
const REEL_STOP_GAP_MS = 320;
const ADMIN_PIN = "7777";
const CREDIT_INCREMENTS = [50, 200, 1000];
const MULTIPLIERS = [1, 2, 3, 5];
const BONUS_TIERS = [1, 2, 3, 5];
const SESSION_BREAK_AFTER_SPINS = 25;
const SESSION_BREAK_AFTER_MINUTES = 12;
const FORCED_BREAK_MS = 2 * 60 * 1000;
const HIGH_URGE_THRESHOLD = 4;

function createSeededRandom(seed: number): () => number {
  let value = seed;

  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

export default function Home() {
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bonusTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reelStopTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [credits, setCredits] = useState(SLOT_CONFIG.defaultCredits);
  const [bet, setBet] = useState(SLOT_CONFIG.defaultBet);
  const [stats, setStats] = useState<PersistedGameState["stats"]>({
    spins: 0,
    wins: 0,
    totalWon: 0,
    biggestWin: 0,
  });
  const [spinning, setSpinning] = useState(false);
  const [rollingReels, setRollingReels] = useState<SymbolId[][] | null>(null);
  const [pendingResult, setPendingResult] = useState<SpinResult | null>(null);
  const [reelStopCount, setReelStopCount] = useState(0);
  const [lastSpin, setLastSpin] = useState<SpinResult | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    "Spin for entertainment only. No real money is involved.",
  );
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminUnlocked, setAdminUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallReady, setIsInstallReady] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [bonusSpinsRemaining, setBonusSpinsRemaining] = useState(0);
  const [bonusRoundWinTotal, setBonusRoundWinTotal] = useState(0);
  const [bonusTierIndex, setBonusTierIndex] = useState(0);
  const [bonusWinStreak, setBonusWinStreak] = useState(0);
  const [profile, setProfile] = useState<AnonymousProfile | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [recovery, setRecovery] = useState<RecoveryState>(getDefaultRecoveryState());
  const [sessionStartedAt, setSessionStartedAt] = useState(0);
  const [sessionStartingCredits, setSessionStartingCredits] = useState(SLOT_CONFIG.defaultCredits);
  const [sessionSpinCount, setSessionSpinCount] = useState(0);
  const [nonWinningSpinStreak, setNonWinningSpinStreak] = useState(0);
  const [clockNow, setClockNow] = useState(0);
  const [urgeLevelInput, setUrgeLevelInput] = useState(3);
  const [moodInput, setMoodInput] = useState("steady");
  const [noteInput, setNoteInput] = useState("");

  const idleReels = useMemo(() => createIdleReels(createSeededRandom(20260409)), []);
  const displayedReels = rollingReels ?? lastSpin?.reels ?? idleReels;
  const isBonusRoundActive = bonusSpinsRemaining > 0;
  const breakEndsAt = recovery.breakUntil ? new Date(recovery.breakUntil).getTime() : null;
  const isBreakActive = breakEndsAt !== null && breakEndsAt > clockNow;
  const canSpin = !spinning && !isBonusRoundActive && !isBreakActive && credits >= bet;
  const currentBonusMultiplier = BONUS_TIERS[bonusTierIndex] ?? 1;
  const effectiveSpinDuration = recovery.calmMode ? SPIN_DURATION_MS + 650 : SPIN_DURATION_MS;
  const sessionElapsedMinutes = Math.floor((clockNow - sessionStartedAt) / 60000);
  const sessionNetChange = credits - sessionStartingCredits;
  const breakSecondsRemaining = breakEndsAt ? Math.max(0, Math.ceil((breakEndsAt - clockNow) / 1000)) : 0;
  const winningCells = useMemo(() => {
    if (!lastSpin) {
      return new Set<string>();
    }

    const positions = [
      ...lastSpin.lineWins.flatMap((lineWin) => lineWin.positions),
      ...(lastSpin.scatterWin?.positions ?? []),
    ];

    return new Set(positions.map(({ reelIndex, rowIndex }) => `${reelIndex}:${rowIndex}`));
  }, [lastSpin]);
  const leaderboardView = useMemo(() => {
    if (!profile) {
      return leaderboard;
    }

    return upsertLeaderboard(
      leaderboard,
      createLeaderboardEntry({
        profile,
        credits,
        stats,
      }),
    );
  }, [credits, leaderboard, profile, stats]);
  const riskSignals = useMemo(() => {
    const signals: string[] = [];

    if (nonWinningSpinStreak >= 6) {
      signals.push(`You have ${nonWinningSpinStreak} non-winning spins in a row.`);
    }

    if (sessionSpinCount >= 15) {
      signals.push(`You have played ${sessionSpinCount} spins in this session.`);
    }

    if (sessionNetChange <= -300) {
      signals.push(`You are down ${Math.abs(sessionNetChange)} credits this session.`);
    }

    if ((recovery.checkIns[0]?.urgeLevel ?? 0) >= HIGH_URGE_THRESHOLD) {
      signals.push("Your latest urge check-in is high. Consider pausing now.");
    }

    return signals;
  }, [nonWinningSpinStreak, recovery.checkIns, sessionNetChange, sessionSpinCount]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let loadedState: PersistedGameState | null = null;
    let loadedProfile: AnonymousProfile | null = null;
    let loadedLeaderboard: LeaderboardEntry[] = [];
    let loadedRecovery = getDefaultRecoveryState();
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const storedProfile = window.localStorage.getItem(PROFILE_STORAGE_KEY);
    const storedLeaderboard = window.localStorage.getItem(LEADERBOARD_STORAGE_KEY);
    const storedRecovery = window.localStorage.getItem(RECOVERY_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        loadedState = sanitizePersistedState(parsed);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      }
    }

    if (storedProfile) {
      try {
        loadedProfile = sanitizeAnonymousProfile(JSON.parse(storedProfile));
      } catch {
        loadedProfile = createAnonymousProfile();
        window.localStorage.removeItem(PROFILE_STORAGE_KEY);
      }
    } else {
      loadedProfile = createAnonymousProfile();
    }

    if (storedLeaderboard) {
      try {
        loadedLeaderboard = sanitizeLeaderboard(JSON.parse(storedLeaderboard));
      } catch {
        window.localStorage.removeItem(LEADERBOARD_STORAGE_KEY);
      }
    }

    if (storedRecovery) {
      try {
        loadedRecovery = sanitizeRecoveryState(JSON.parse(storedRecovery));
      } catch {
        window.localStorage.removeItem(RECOVERY_STORAGE_KEY);
      }
    }

    queueMicrotask(() => {
      if (loadedState) {
        setCredits(loadedState.credits);
        setBet(loadedState.bet);
        setStats(loadedState.stats);
        setSessionStartingCredits(loadedState.credits);
      }
      if (loadedProfile) {
        setProfile(loadedProfile);
      }
      setLeaderboard(loadedLeaderboard);
      setRecovery(loadedRecovery);
      setSessionStartedAt(Date.now());
      setHydrated(true);
    });
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") {
      return;
    }

    const payload: PersistedGameState = {
      credits,
      bet,
      stats,
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [bet, credits, hydrated, stats]);

  useEffect(() => {
    if (!hydrated || !profile || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profile));
    window.localStorage.setItem(LEADERBOARD_STORAGE_KEY, JSON.stringify(leaderboardView));
  }, [hydrated, leaderboardView, profile]);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(RECOVERY_STORAGE_KEY, JSON.stringify(recovery));
  }, [hydrated, recovery]);

  useEffect(() => {
    const onBeforeInstallPrompt = (event: Event) => {
      const typedEvent = event as BeforeInstallPromptEvent;
      typedEvent.preventDefault();
      setInstallPrompt(typedEvent);
      setIsInstallReady(true);
    };

    const onAppInstalled = () => {
      setInstallPrompt(null);
      setIsInstallReady(false);
      setStatusMessage("App installed. You can now play offline after loading once.");
    };

    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);

    queueMicrotask(() => {
      setIsOnline(window.navigator.onLine);
    });

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      setClockNow(Date.now());
    });

    const timerId = setInterval(() => {
      setClockNow(Date.now());
    }, 1000);

    return () => {
      clearInterval(timerId);
      if (spinTimeoutRef.current) {
        clearTimeout(spinTimeoutRef.current);
      }
      if (bonusTimeoutRef.current) {
        clearTimeout(bonusTimeoutRef.current);
      }
      reelStopTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    };
  }, []);

  useEffect(() => {
    if (!recovery.breakUntil) {
      return;
    }

    if (!isBreakActive) {
      queueMicrotask(() => {
        setRecovery((current) => ({
          ...current,
          breakUntil: null,
        }));
        setStatusMessage("Forced break finished. Take a breath before deciding to continue.");
      });
    }
  }, [isBreakActive, recovery.breakUntil]);

  useEffect(() => {
    if (spinning || isBonusRoundActive || isBreakActive) {
      return;
    }

    if (
      sessionSpinCount >= SESSION_BREAK_AFTER_SPINS ||
      sessionElapsedMinutes >= SESSION_BREAK_AFTER_MINUTES
    ) {
      const breakUntil = new Date(Date.now() + FORCED_BREAK_MS).toISOString();
      queueMicrotask(() => {
        setRecovery((current) => ({
          ...current,
          breakUntil,
        }));
        setSessionSpinCount(0);
        setNonWinningSpinStreak(0);
        setSessionStartedAt(Date.now());
        setSessionStartingCredits(credits);
        setStatusMessage("Forced break started. Step away for two minutes before playing again.");
      });
    }
  }, [credits, isBonusRoundActive, isBreakActive, sessionElapsedMinutes, sessionSpinCount, spinning]);

  const clearReelStopTimers = () => {
    reelStopTimersRef.current.forEach((timerId) => clearTimeout(timerId));
    reelStopTimersRef.current = [];
  };

  const runSpin = useCallback((isBonusSpin: boolean) => {
    if (spinning) {
      return;
    }

    if (!isBonusSpin && isBreakActive) {
      setStatusMessage("Forced break active. Wait for the cooldown before spinning again.");
      return;
    }

    if (!isBonusSpin && credits < bet) {
      setStatusMessage("Not enough credits. Open Admin to add local demo credits.");
      return;
    }

    const preview = createSpinResult({ bet });
    const resolved = createSpinResult({ bet });

    clearReelStopTimers();

    setSpinning(true);
    setRollingReels(preview.reels);
    setPendingResult(resolved);
    setReelStopCount(0);
    setLastSpin(null);
    setStatusMessage(isBonusSpin ? "Bonus spin in progress..." : "Spinning...");

    if (!isBonusSpin) {
      setCredits((current) => Math.max(0, current - bet));
      setStats((current) => ({ ...current, spins: current.spins + 1 }));
      setSessionSpinCount((current) => current + 1);
    }

    reelStopTimersRef.current = Array.from({ length: SLOT_CONFIG.reels }, (_, reelIndex) =>
      setTimeout(() => {
        setReelStopCount(reelIndex + 1);
      }, FIRST_REEL_STOP_MS + reelIndex * REEL_STOP_GAP_MS),
    );

    spinTimeoutRef.current = setTimeout(() => {
      setSpinning(false);
      clearReelStopTimers();
      setReelStopCount(SLOT_CONFIG.reels);
      setRollingReels(null);
      setPendingResult(null);

      const currentBonusTier = BONUS_TIERS[bonusTierIndex] ?? 1;
      const effectivePayout = isBonusSpin ? resolved.totalPayout * currentBonusTier : resolved.totalPayout;
      const displayResult =
        isBonusSpin && currentBonusTier > 1
          ? {
              ...resolved,
              totalPayout: effectivePayout,
            }
          : resolved;
      setLastSpin(displayResult);

      const awardedBonusSpins = resolved.scatterWin
        ? getBonusSpinsForScatter(resolved.scatterWin.count)
        : 0;

      if (effectivePayout > 0) {
        setCredits((current) => current + effectivePayout);
        setNonWinningSpinStreak(0);
        setStats((current) => ({
          spins: current.spins,
          wins: current.wins + 1,
          totalWon: current.totalWon + effectivePayout,
          biggestWin: Math.max(current.biggestWin, effectivePayout),
        }));
      } else {
        setNonWinningSpinStreak((current) => current + 1);
      }

      if (isBonusSpin) {
        if (effectivePayout > 0) {
          setBonusRoundWinTotal((current) => current + effectivePayout);
          setBonusWinStreak((current) => current + 1);
          setBonusTierIndex((current) => Math.min(current + 1, BONUS_TIERS.length - 1));
        } else {
          setBonusWinStreak(0);
          setBonusTierIndex(0);
        }

        setBonusSpinsRemaining((current) => {
          return Math.max(current - 1, 0) + awardedBonusSpins;
        });

        if (awardedBonusSpins > 0) {
          setStatusMessage(`Bonus retrigger! +${awardedBonusSpins} extra free spins.`);
        } else if (effectivePayout > 0) {
          setStatusMessage(`Bonus win! +${effectivePayout} credits at x${currentBonusTier}.`);
        } else {
          setStatusMessage("Bonus spin complete. Tier reset to x1.");
        }

        if (bonusSpinsRemaining <= 1 && awardedBonusSpins === 0) {
          setStatusMessage("Bonus round completed.");
        }

        return;
      }

      if (awardedBonusSpins > 0) {
        setBonusSpinsRemaining(awardedBonusSpins);
        setBonusRoundWinTotal(0);
        setBonusTierIndex(0);
        setBonusWinStreak(0);
        setStatusMessage(`Scatter Crown Bonus! ${awardedBonusSpins} free spins awarded.`);
        return;
      }

      if (effectivePayout > 0) {
        setStatusMessage(`Win! +${effectivePayout} credits.`);
      } else {
        setStatusMessage("No payout this round. Adjust your bet and spin again.");
      }
    }, effectiveSpinDuration);
  }, [bet, bonusSpinsRemaining, bonusTierIndex, credits, effectiveSpinDuration, isBreakActive, spinning]);

  useEffect(() => {
    if (!isBonusRoundActive || spinning) {
      return;
    }

    bonusTimeoutRef.current = setTimeout(() => {
      runSpin(true);
    }, BONUS_SPIN_GAP_MS);

    return () => {
      if (bonusTimeoutRef.current) {
        clearTimeout(bonusTimeoutRef.current);
      }
    };
  }, [isBonusRoundActive, spinning, runSpin]);

  const handleSpin = () => {
    if (isBreakActive) {
      setStatusMessage("Forced break active. Use the pause to check in with yourself.");
      return;
    }

    if (isBonusRoundActive) {
      setStatusMessage("Bonus mode is auto-spinning until all free spins are used.");
      return;
    }

    runSpin(false);
  };

  const handleBetChange = (nextBet: number) => {
    const clamped = Math.min(SLOT_CONFIG.maxBet, Math.max(SLOT_CONFIG.minBet, nextBet));
    setBet(clamped);
  };

  const handleInstall = async () => {
    if (!installPrompt) {
      return;
    }

    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;

    setStatusMessage(
      choice.outcome === "accepted"
        ? "Install accepted. Enjoy your offline training mode."
        : "Install dismissed. You can keep playing in the browser.",
    );
  };

  const unlockAdmin = () => {
    if (pinInput === ADMIN_PIN) {
      setAdminUnlocked(true);
      setPinInput("");
      setStatusMessage("Admin unlocked. Credits are local-only and for demo play.");
      return;
    }

    setStatusMessage("Invalid admin pin.");
  };

  const addCredits = (amount: number) => {
    if (!adminUnlocked) {
      return;
    }

    setCredits((current) => current + amount);
    setStatusMessage(`Admin added ${amount} local demo credits.`);
  };

  const handleRecoveryCheckIn = () => {
    const checkIn = createRecoveryCheckIn({
      urgeLevel: urgeLevelInput,
      mood: moodInput,
      note: noteInput,
    });

    setRecovery((current) => ({
      ...current,
      checkIns: [checkIn, ...current.checkIns].slice(0, 20),
    }));
    setNoteInput("");

    if (checkIn.urgeLevel >= HIGH_URGE_THRESHOLD) {
      setStatusMessage("High urge recorded. Pause and use the support links before continuing.");
      return;
    }

    setStatusMessage("Check-in saved.");
  };

  const toggleCalmMode = () => {
    setRecovery((current) => ({
      ...current,
      calmMode: !current.calmMode,
    }));
    setStatusMessage(
      recovery.calmMode
        ? "Calm mode disabled. Visual intensity is back to default."
        : "Calm mode enabled. Keep sessions slower and quieter.",
    );
  };

  return (
    <main className={clsx(styles.game, recovery.calmMode && styles["game--calm"])}>
      <section className={styles.game__hero}>
        <p className={styles.game__kicker}>Scatter Rehab</p>
        <h1 className={styles.game__title}>Scatter Card Suite</h1>
        <p className={styles.game__subtitle}>
          A no-real-money slot sandbox built for controlled play. Credits are local-only and
          never represent cash value.
        </p>
      </section>

      <section className={styles.machine}>
        <div className={styles.machine__topBar}>
          <button className={styles.machine__topButton} type="button">
            Buy Bonus
          </button>
          <div className={styles.machine__multiplierBar}>
            {MULTIPLIERS.map((multiplier) => (
              <span
                key={multiplier}
                className={clsx(
                  styles.machine__multiplierPill,
                  isBonusRoundActive &&
                    multiplier === currentBonusMultiplier &&
                    styles["machine__multiplierPill--active"],
                )}
                aria-current={
                  isBonusRoundActive && multiplier === currentBonusMultiplier ? "true" : undefined
                }
              >
                x{multiplier}
              </span>
            ))}
          </div>
        </div>

        <div className={styles.machine__frame} aria-live="polite">
          <div className={styles.board__reels}>
            {displayedReels.map((reel, reelIndex) => {
              const isStopped = spinning && reelIndex < reelStopCount;
              const reelSymbols = isStopped && pendingResult ? pendingResult.reels[reelIndex] : reel;
              const symbolsForTrack = spinning && !isStopped ? [...reelSymbols, ...reelSymbols] : reelSymbols;

              return (
                <div key={`reel-${reelIndex}`} className={styles.reel}>
                  <div className={styles.reel__window}>
                    <div
                      className={clsx(
                        styles.reel__track,
                        spinning && !isStopped && styles["reel__track--spinning"],
                      )}
                      style={{
                        animationDelay: `${reelIndex * 120}ms`,
                        animationDuration: `${(recovery.calmMode ? 980 : 760) + reelIndex * 140}ms`,
                      }}
                    >
                      {symbolsForTrack.map((symbol, rowIndex) => {
                        const symbolMeta = getSymbol(symbol);
                        const normalizedRowIndex = rowIndex % SLOT_CONFIG.rows;
                        const isWinningCell = !spinning && winningCells.has(`${reelIndex}:${normalizedRowIndex}`);

                        return (
                          <div
                            key={`cell-${reelIndex}-${rowIndex}`}
                            className={clsx(
                              styles.reel__cell,
                              isWinningCell && styles["reel__cell--win"],
                            )}
                            data-symbol={symbol}
                            data-suit={symbolMeta.suit ?? "none"}
                          >
                            <span className={styles.reel__glyph}>{symbolMeta.glyph}</span>
                            <span className={styles.reel__name}>{symbolMeta.label}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {lastSpin && (
            <aside className={styles.board__wins}>
              <h2 className={styles.board__winsTitle}>Round Summary</h2>
              {lastSpin.lineWins.length > 0 ? (
                <ul className={styles.board__winList}>
                  {lastSpin.lineWins.map((lineWin) => (
                    <li key={`line-${lineWin.symbol}`}>
                      {getSymbol(lineWin.symbol).label}: on {lineWin.count} reels ({lineWin.multiplier}x)
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={styles.board__winsEmpty}>No line wins this round.</p>
              )}
              {lastSpin.scatterWin && (
                <p className={styles.board__scatter}>
                  Scatter Crown: {lastSpin.scatterWin.count} symbols ({lastSpin.scatterWin.multiplier}x)
                </p>
              )}
            </aside>
          )}
        </div>

        <div className={styles.machine__meterRow}>
          <div className={styles.game__statBlock}>
            <span className={styles.game__statLabel}>Bet</span>
            <strong className={styles.game__statValue}>{bet}</strong>
          </div>
          <div className={styles.game__statBlock}>
            <span className={styles.game__statLabel}>Balance</span>
            <strong className={styles.game__statValue}>{credits}</strong>
          </div>
          <div className={styles.game__statBlock}>
            <span className={styles.game__statLabel}>Last Win</span>
            <strong className={styles.game__statValue}>{lastSpin?.totalPayout ?? 0}</strong>
          </div>
        </div>

        <div className={styles.game__netBadge} data-online={isOnline}>
          {isOnline ? "Online" : "Offline"}
        </div>
      </section>

      <section className={styles.controls}>
        <div className={styles.controls__primary}>
          <div className={styles.controls__betGroup}>
            <button
              className={styles.controls__button}
              onClick={() => handleBetChange(bet - 10)}
              disabled={spinning}
            >
              -10
            </button>
            <button
              className={styles.controls__button}
              onClick={() => handleBetChange(bet + 10)}
              disabled={spinning}
            >
              +10
            </button>
          </div>

          <button className={styles.controls__spin} onClick={handleSpin} disabled={!canSpin}>
            {isBreakActive
              ? `Break ${breakSecondsRemaining}s`
              : spinning
                ? "Spinning"
                : isBonusRoundActive
                  ? "Bonus Auto Running"
                  : "Spin"}
          </button>
        </div>

        <div className={styles.controls__meta}>
          <p>Spins: {stats.spins}</p>
          <p>Wins: {stats.wins}</p>
          <p>Total Won: {stats.totalWon}</p>
          <p>Biggest Win: {stats.biggestWin}</p>
        </div>

        {(isBonusRoundActive || bonusRoundWinTotal > 0) && (
          <div className={styles.controls__bonusBox}>
            <p>Bonus Spins Left: {bonusSpinsRemaining}</p>
            <p>Bonus Round Win: {bonusRoundWinTotal}</p>
            <p>Bonus Tier: x{BONUS_TIERS[bonusTierIndex]}</p>
            <p>Win Streak: {bonusWinStreak}</p>
          </div>
        )}
      </section>

      <section className={styles.utility}>
        <p className={styles.utility__status}>{statusMessage}</p>

        <div className={styles.utility__recoveryPanel}>
          <div className={styles.utility__recoveryHeader}>
            <h2 className={styles.utility__leaderboardTitle}>Recovery Tools</h2>
            <button className={styles.utility__actionButton} onClick={toggleCalmMode}>
              {recovery.calmMode ? "Calm Mode On" : "Calm Mode Off"}
            </button>
          </div>
          <div className={styles.utility__sessionGrid}>
            <p>Session Minutes: {sessionElapsedMinutes}</p>
            <p>Session Spins: {sessionSpinCount}</p>
            <p>Session Change: {sessionNetChange}</p>
            <p>Break: {isBreakActive ? `${breakSecondsRemaining}s` : "Ready"}</p>
          </div>
          {riskSignals.length > 0 && (
            <div className={styles.utility__warnings}>
              {riskSignals.map((signal) => (
                <p key={signal} className={styles.utility__warning}>
                  {signal}
                </p>
              ))}
            </div>
          )}
          <div className={styles.utility__checkIn}>
            <label>
              Urge Level (1-5)
              <input
                type="range"
                min="1"
                max="5"
                value={urgeLevelInput}
                onChange={(event) => setUrgeLevelInput(Number(event.target.value))}
              />
            </label>
            <label>
              Mood
              <input value={moodInput} onChange={(event) => setMoodInput(event.target.value)} />
            </label>
            <label>
              Note
              <textarea value={noteInput} onChange={(event) => setNoteInput(event.target.value)} rows={3} />
            </label>
            <button className={styles.utility__actionButton} onClick={handleRecoveryCheckIn}>
              Save Check-In
            </button>
            {recovery.checkIns.length > 0 && (
              <div className={styles.utility__checkInList}>
                {recovery.checkIns.slice(0, 3).map((entry) => (
                  <p key={entry.id}>
                    {entry.mood} | urge {entry.urgeLevel} | {entry.note || "No note"}
                  </p>
                ))}
              </div>
            )}
          </div>
          <div className={styles.utility__resources}>
            <a href="https://www.ncpgambling.org/help-treatment/" target="_blank" rel="noreferrer">
              National Council on Problem Gambling
            </a>
            <a href="https://www.gamblersanonymous.org/ga/" target="_blank" rel="noreferrer">
              Gamblers Anonymous
            </a>
            <a href="https://988lifeline.org/" target="_blank" rel="noreferrer">
              988 Lifeline
            </a>
          </div>
        </div>

        {profile && (
          <div className={styles.utility__identity}>
            <p>Anonymous Player: {profile.alias}</p>
            <p>Device ID: {profile.deviceId.slice(0, 8)}</p>
          </div>
        )}

        <div className={styles.utility__leaderboard}>
          <h2 className={styles.utility__leaderboardTitle}>Local Leaderboard</h2>
          <p className={styles.utility__leaderboardNote}>
            Anonymous and stored on this device. Shared cross-device boards need a backend.
          </p>
          <ol className={styles.utility__leaderboardList}>
            {leaderboardView.map((entry, index) => (
              <li key={entry.deviceId} className={styles.utility__leaderboardItem}>
                <span>
                  {index + 1}. {entry.alias}
                </span>
                <span>Balance {entry.bestBalance}</span>
                <span>Total Won {entry.totalWon}</span>
              </li>
            ))}
          </ol>
        </div>

        <div className={styles.utility__actions}>
          <button className={styles.utility__actionButton} onClick={() => setAdminOpen((open) => !open)}>
            {adminOpen ? "Hide Admin" : "Admin"}
          </button>
          <button
            className={styles.utility__actionButton}
            onClick={handleInstall}
            disabled={!isInstallReady}
          >
            Install App
          </button>
        </div>

        {adminOpen && (
          <div className={styles.admin}>
            {!adminUnlocked ? (
              <div className={styles.admin__lock}>
                <label htmlFor="admin-pin">Admin PIN</label>
                <input
                  id="admin-pin"
                  type="password"
                  value={pinInput}
                  onChange={(event) => setPinInput(event.target.value)}
                />
                <button className={styles.utility__actionButton} onClick={unlockAdmin}>
                  Unlock
                </button>
              </div>
            ) : (
              <div className={styles.admin__credits}>
                <p>Inject local demo credits:</p>
                <div className={styles.admin__creditButtons}>
                  {CREDIT_INCREMENTS.map((amount) => (
                    <button
                      key={amount}
                      className={styles.utility__actionButton}
                      onClick={() => addCredits(amount)}
                    >
                      +{amount}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>
      {!hydrated && <p className={styles.game__hydrating}>Loading local game state...</p>}
    </main>
  );
}
