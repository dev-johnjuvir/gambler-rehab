"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import { createIdleReels, createSpinResult, getSymbol, SLOT_CONFIG } from "@/lib/slot/engine";
import { sanitizePersistedState } from "@/lib/slot/state";
import type { PersistedGameState, SpinResult, SymbolId } from "@/lib/slot/types";
import styles from "./page.module.scss";

const SPIN_DURATION_MS = 2400;
const FIRST_REEL_STOP_MS = 900;
const REEL_STOP_GAP_MS = 260;
const WIN_BREAK_MS = 2 * 60 * 1000;
const FULL_MODE_STORAGE_KEY = "scatter-rehab/full-gambling-state/v1";
const STARTING_CREDITS = 500;

const BROKE_MESSAGES = [
  "₱500 could have paid for 3 days of groceries for your family.",
  "₱500 is a week of school lunches for your child.",
  "₱500 could have covered your electricity bill this month.",
  "₱500 would have filled your gas tank and gotten you to work all week.",
  "₱500 is a full week of rice for a family of four.",
  "₱500 could have been medicine for someone you love.",
  "₱500 could have been a birthday gift that someone will actually remember.",
];

function createSeededRandom(seed: number): () => number {
  let value = seed;

  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

function formatPeso(value: number): string {
  return new Intl.NumberFormat("en-PH", {
    style: "currency",
    currency: "PHP",
    maximumFractionDigits: 0,
  }).format(value);
}

export default function FullGamblingPage() {
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reelStopTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const [credits, setCredits] = useState(500);
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
  const [statusMessage, setStatusMessage] = useState("Play responsibly.");

  const [clockNow, setClockNow] = useState(0);
  const [breakUntil, setBreakUntil] = useState<number | null>(null);
  const [showWinModal, setShowWinModal] = useState(false);
  const [lastWinAmount, setLastWinAmount] = useState(0);
  const [showBrokeModal, setShowBrokeModal] = useState(false);
  const [brokeMessageIndex, setBrokeMessageIndex] = useState(0);

  const idleReels = useMemo(() => createIdleReels(createSeededRandom(20260409)), []);
  const displayedReels = rollingReels ?? lastSpin?.reels ?? idleReels;
  const isBreakActive = breakUntil !== null && breakUntil > clockNow;
  const breakSecondsRemaining = breakUntil ? Math.max(0, Math.ceil((breakUntil - clockNow) / 1000)) : 0;
  const canSpin = !spinning && !isBreakActive && credits >= bet;

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

  const mealCount = Math.max(1, Math.floor(lastWinAmount / 150));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const stored = window.localStorage.getItem(FULL_MODE_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const loaded = sanitizePersistedState(parsed);
        queueMicrotask(() => {
          setCredits(loaded.credits);
          setBet(loaded.bet);
          setStats(loaded.stats);
          setHydrated(true);
        });
        return;
      } catch {
        window.localStorage.removeItem(FULL_MODE_STORAGE_KEY);
      }
    }

    queueMicrotask(() => {
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

    window.localStorage.setItem(FULL_MODE_STORAGE_KEY, JSON.stringify(payload));
  }, [bet, credits, hydrated, stats]);

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
      reelStopTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (breakUntil && !isBreakActive) {
      queueMicrotask(() => {
        setBreakUntil(null);
        setStatusMessage("Break complete. Decide carefully before spinning again.");
      });
    }
  }, [breakUntil, isBreakActive]);

  const clearReelStopTimers = () => {
    reelStopTimersRef.current.forEach((timer) => clearTimeout(timer));
    reelStopTimersRef.current = [];
  };

  const runSpin = useCallback(() => {
    if (spinning) {
      return;
    }

    if (isBreakActive) {
      setStatusMessage("Betting break active. Walk away with your win.");
      return;
    }

    if (credits < bet) {
      setStatusMessage("Insufficient balance.");
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
    setStatusMessage("Spinning...");

    setCredits((current) => Math.max(0, current - bet));
    setStats((current) => ({ ...current, spins: current.spins + 1 }));

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
      setLastSpin(resolved);

      if (resolved.totalPayout > 0) {
        setCredits((current) => current + resolved.totalPayout);
        setStats((current) => ({
          spins: current.spins,
          wins: current.wins + 1,
          totalWon: current.totalWon + resolved.totalPayout,
          biggestWin: Math.max(current.biggestWin, resolved.totalPayout),
        }));

        const nextBreakUntil = Date.now() + WIN_BREAK_MS;
        setBreakUntil(nextBreakUntil);
        setLastWinAmount(resolved.totalPayout);
        setShowWinModal(true);
        setStatusMessage("You won. Betting is paused for 2 minutes.");
        return;
      }

      setStatusMessage("No payout. Try again.");
    }, SPIN_DURATION_MS);
  }, [bet, credits, isBreakActive, spinning]);

  useEffect(() => {
    if (!hydrated || spinning || showBrokeModal || showWinModal) {
      return;
    }

    if (credits === 0) {
      queueMicrotask(() => {
        setBrokeMessageIndex(Math.floor(Math.random() * BROKE_MESSAGES.length));
        setShowBrokeModal(true);
        setStatusMessage("Balance is zero.");
      });
    }
  }, [credits, hydrated, showBrokeModal, showWinModal, spinning]);

  const handleBetChange = (nextBet: number) => {
    const clamped = Math.min(SLOT_CONFIG.maxBet, Math.max(SLOT_CONFIG.minBet, nextBet));
    setBet(clamped);
  };

  const handleReset = () => {
    setCredits(STARTING_CREDITS);
    setStats({ spins: 0, wins: 0, totalWon: 0, biggestWin: 0 });
    setLastSpin(null);
    setShowBrokeModal(false);
    setStatusMessage("Fresh ₱500. Think before you spin.");
  };

  return (
    <main className={styles.screen}>
      <section className={styles.machine} aria-live="polite">
        <div className={styles.casinoSign} aria-hidden="true">
          <div className={styles.casinoSign__marquee}>
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className={styles.casinoSign__dot} style={{ animationDelay: `${(i % 6) * 0.17}s` }} />
            ))}
          </div>
          <div className={styles.casinoSign__title}>
            {"SCATTER".split("").map((char, i) => (
              <span key={i} className={styles[`casinoSign__letter--${i + 1}`]} style={{ animationDelay: `${i * 0.22}s` }}>
                {char}
              </span>
            ))}
          </div>
          <div className={styles.casinoSign__suits}>
            {(["♠", "♥", "♦", "♣"] as const).map((suit, i) => (
              <span key={suit} className={styles.casinoSign__suit} style={{ animationDelay: `${i * 0.35}s` }}>
                {suit}
              </span>
            ))}
          </div>
          <div className={styles.casinoSign__marquee}>
            {Array.from({ length: 24 }, (_, i) => (
              <span key={i} className={styles.casinoSign__dot} style={{ animationDelay: `${(i % 6) * 0.17}s` }} />
            ))}
          </div>
        </div>

        <div className={styles.machine__reels}>
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
                      animationDelay: `${reelIndex * 100}ms`,
                      animationDuration: `${760 + reelIndex * 120}ms`,
                    }}
                  >
                    {symbolsForTrack.map((symbol, rowIndex) => {
                      const symbolMeta = getSymbol(symbol);
                      const normalizedRowIndex = rowIndex % SLOT_CONFIG.rows;
                      const isWinningCell = !spinning && winningCells.has(`${reelIndex}:${normalizedRowIndex}`);

                      return (
                        <div
                          key={`cell-${reelIndex}-${rowIndex}`}
                          className={clsx(styles.reel__cell, isWinningCell && styles["reel__cell--win"])}
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

        <div className={styles.controls}>
          <div className={styles.controls__money}>
            <p>Balance: {formatPeso(credits)}</p>
            <p>Bet: {formatPeso(bet)}</p>
            <p>Last win: {formatPeso(lastSpin?.totalPayout ?? 0)}</p>
          </div>

          <div className={styles.controls__bets}>
            <button onClick={() => handleBetChange(bet - 10)} disabled={spinning || isBreakActive}>
              - PHP 10
            </button>
            <button onClick={() => handleBetChange(bet - 50)} disabled={spinning || isBreakActive}>
              - PHP 50
            </button>
            <button onClick={() => handleBetChange(bet + 50)} disabled={spinning || isBreakActive}>
              + PHP 50
            </button>
            <button onClick={() => handleBetChange(bet + 10)} disabled={spinning || isBreakActive}>
              + PHP 10
            </button>
          </div>

          <button
            className={styles.controls__withdraw}
            onClick={() => setStatusMessage("WALANG PUMAPALDO SA SUGAL, BRO. TIGIL MO NA YAN.")}
          >
            Withdraw
          </button>

          <button className={styles.controls__spin} onClick={runSpin} disabled={!canSpin}>
            {isBreakActive ? `Break ${breakSecondsRemaining}s` : spinning ? "Spinning" : "Spin"}
          </button>

          <p className={styles.controls__status}>{statusMessage}</p>
        </div>
      </section>

      {showWinModal && (
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Win reminder">
          <div className={styles.modal__card}>
            <h2>Walk away with this win.</h2>
            <p>You just won {formatPeso(lastWinAmount)}.</p>
            <p>
              About PHP 150 can feed a family of 3 for one meal. Your win can cover about {mealCount}{" "}
              meal{mealCount > 1 ? "s" : ""}.
            </p>n 
            <p>Betting is locked for 2 minutes. Take the break and keep your winnings safe.</p>
            <button onClick={() => setShowWinModal(false)}>I understand</button>
          </div>
        </div>
      )}

      {showBrokeModal && (
        <div className={styles.modal} role="dialog" aria-modal="true" aria-label="Balance is zero">
          <div className={`${styles.modal__card} ${styles["modal__card--broke"]}`}>
            <h2>You&apos;re out of money.</h2>
            <p className={styles.modal__brokeMessage}>
              {BROKE_MESSAGES[brokeMessageIndex]}
            </p>
            <p>You played {stats.spins} spin{stats.spins !== 1 ? "s" : ""} and started with {formatPeso(STARTING_CREDITS)}.</p>
            <p className={styles.modal__brokeQuestion}>Was it worth it?</p>
            <div className={styles.modal__brokeActions}>
              <button onClick={handleReset} className={styles["modal__button--secondary"]}>
                Try again with ₱500
              </button>
              <Link href="/" className={styles.modal__exitLink}>
                Leave the casino
              </Link>
            </div>
          </div>
        </div>
      )}

      {!hydrated && <p className={styles.loading}>Loading...</p>}
    </main>
  );
}
