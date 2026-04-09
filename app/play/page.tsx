"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { createIdleReels, createSpinResult, getSymbol, SLOT_CONFIG } from "@/lib/slot/engine";
import { sanitizePersistedState } from "@/lib/slot/state";
import type { PersistedGameState, SpinResult, SymbolId } from "@/lib/slot/types";
import styles from "../full-gambling/page.module.scss";

const SPIN_DURATION_MS = 2400;
const FIRST_REEL_STOP_MS = 900;
const REEL_STOP_GAP_MS = 260;
const PLAY_STORAGE_KEY = "scatter-rehab/play-state/v1";
const STARTING_CREDITS = 500;

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

export default function PlayPage() {
  const spinTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reelStopTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const [hydrated, setHydrated] = useState(false);
  const [credits, setCredits] = useState(STARTING_CREDITS);
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
  const [statusMessage, setStatusMessage] = useState("Play freely. No limits.");

  const idleReels = useMemo(() => createIdleReels(createSeededRandom(20260409)), []);
  const displayedReels = rollingReels ?? lastSpin?.reels ?? idleReels;
  const canSpin = !spinning && credits >= bet;

  const winningCells = useMemo(() => {
    if (!lastSpin) return new Set<string>();
    const positions = [
      ...lastSpin.lineWins.flatMap((w) => w.positions),
      ...(lastSpin.scatterWin?.positions ?? []),
    ];
    return new Set(positions.map(({ reelIndex, rowIndex }) => `${reelIndex}:${rowIndex}`));
  }, [lastSpin]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(PLAY_STORAGE_KEY);
    if (stored) {
      try {
        const loaded = sanitizePersistedState(JSON.parse(stored));
        queueMicrotask(() => {
          setCredits(loaded.credits);
          setBet(loaded.bet);
          setStats(loaded.stats);
          setHydrated(true);
        });
        return;
      } catch {
        window.localStorage.removeItem(PLAY_STORAGE_KEY);
      }
    }
    queueMicrotask(() => setHydrated(true));
  }, []);

  useEffect(() => {
    if (!hydrated || typeof window === "undefined") return;
    window.localStorage.setItem(PLAY_STORAGE_KEY, JSON.stringify({ credits, bet, stats }));
  }, [bet, credits, hydrated, stats]);

  useEffect(() => {
    return () => {
      if (spinTimeoutRef.current) clearTimeout(spinTimeoutRef.current);
      reelStopTimersRef.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  useEffect(() => {
    if (!hydrated || spinning || credits > 0) return;
    queueMicrotask(() => {
      setCredits(STARTING_CREDITS);
      setStats({ spins: 0, wins: 0, totalWon: 0, biggestWin: 0 });
      setLastSpin(null);
      setStatusMessage("Reloaded ₱500. Keep spinning!");
    });
  }, [credits, hydrated, spinning]);

  const clearReelStopTimers = () => {
    reelStopTimersRef.current.forEach((t) => clearTimeout(t));
    reelStopTimersRef.current = [];
  };

  const runSpin = useCallback(() => {
    if (spinning || credits < bet) return;

    const preview = createSpinResult({ bet });
    const resolved = createSpinResult({ bet });

    clearReelStopTimers();

    setSpinning(true);
    setRollingReels(preview.reels);
    setPendingResult(resolved);
    setReelStopCount(0);
    setLastSpin(null);
    setStatusMessage("Spinning...");

    setCredits((c) => Math.max(0, c - bet));
    setStats((s) => ({ ...s, spins: s.spins + 1 }));

    reelStopTimersRef.current = Array.from({ length: SLOT_CONFIG.reels }, (_, i) =>
      setTimeout(() => setReelStopCount(i + 1), FIRST_REEL_STOP_MS + i * REEL_STOP_GAP_MS),
    );

    spinTimeoutRef.current = setTimeout(() => {
      setSpinning(false);
      clearReelStopTimers();
      setReelStopCount(SLOT_CONFIG.reels);
      setRollingReels(null);
      setPendingResult(null);
      setLastSpin(resolved);

      if (resolved.totalPayout > 0) {
        setCredits((c) => c + resolved.totalPayout);
        setStats((s) => ({
          ...s,
          wins: s.wins + 1,
          totalWon: s.totalWon + resolved.totalPayout,
          biggestWin: Math.max(s.biggestWin, resolved.totalPayout),
        }));
        setStatusMessage(`Won ${formatPeso(resolved.totalPayout)}!`);
        return;
      }

      setStatusMessage("No payout. Keep spinning!");
    }, SPIN_DURATION_MS);
  }, [bet, credits, spinning]);

  const handleBetChange = (nextBet: number) => {
    const clamped = Math.min(SLOT_CONFIG.maxBet, Math.max(SLOT_CONFIG.minBet, nextBet));
    setBet(clamped);
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
            <button onClick={() => handleBetChange(bet - 10)} disabled={spinning}>
              - PHP 10
            </button>
            <button onClick={() => handleBetChange(bet - 50)} disabled={spinning}>
              - PHP 50
            </button>
            <button onClick={() => handleBetChange(bet + 50)} disabled={spinning}>
              + PHP 50
            </button>
            <button onClick={() => handleBetChange(bet + 10)} disabled={spinning}>
              + PHP 10
            </button>
          </div>

          <button className={styles.controls__spin} onClick={runSpin} disabled={!canSpin}>
            {spinning ? "Spinning..." : "Spin"}
          </button>

          <p className={styles.controls__status}>{statusMessage}</p>
        </div>
      </section>

      {!hydrated && <p className={styles.loading}>Loading...</p>}
    </main>
  );
}
