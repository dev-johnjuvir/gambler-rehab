"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import clsx from "clsx";
import {
  BONUS_SPIN_COUNT,
  createIdleReels,
  createSpinResult,
  getBonusSpinsForScatter,
  getSymbol,
  SLOT_CONFIG,
} from "@/lib/slot/engine";
import { sanitizePersistedState } from "@/lib/slot/state";
import type { PersistedGameState, SpinResult, SymbolId } from "@/lib/slot/types";
import styles from "../full-gambling/page.module.scss";

const SPIN_DURATION_MS = 2400;
const FIRST_REEL_STOP_MS = 900;
const REEL_STOP_GAP_MS = 260;
const PLAY_STORAGE_KEY = "scatter-rehab/play-state/v1";
const STARTING_CREDITS = 500;

type BrowserAudioContext = typeof AudioContext;

function createNoiseBuffer(audioContext: AudioContext, durationSeconds: number): AudioBuffer {
  const frameCount = Math.max(1, Math.floor(audioContext.sampleRate * durationSeconds));
  const buffer = audioContext.createBuffer(1, frameCount, audioContext.sampleRate);
  const channelData = buffer.getChannelData(0);

  for (let i = 0; i < frameCount; i += 1) {
    channelData[i] = Math.random() * 2 - 1;
  }

  return buffer;
}

function playKaChingSound(audioContext: AudioContext): void {
  const now = audioContext.currentTime + 0.01;
  const master = audioContext.createGain();
  master.connect(audioContext.destination);
  master.gain.setValueAtTime(0.0001, now);
  master.gain.exponentialRampToValueAtTime(0.22, now + 0.02);
  master.gain.exponentialRampToValueAtTime(0.0001, now + 0.62);

  const coinTone = audioContext.createOscillator();
  coinTone.type = "triangle";
  coinTone.frequency.setValueAtTime(880, now);
  coinTone.frequency.exponentialRampToValueAtTime(1480, now + 0.08);
  coinTone.frequency.exponentialRampToValueAtTime(1960, now + 0.2);

  const sparkleTone = audioContext.createOscillator();
  sparkleTone.type = "sine";
  sparkleTone.frequency.setValueAtTime(1320, now + 0.03);
  sparkleTone.frequency.exponentialRampToValueAtTime(2640, now + 0.18);

  const toneGain = audioContext.createGain();
  toneGain.gain.setValueAtTime(0.0001, now);
  toneGain.gain.exponentialRampToValueAtTime(0.28, now + 0.02);
  toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

  coinTone.connect(toneGain);
  sparkleTone.connect(toneGain);
  toneGain.connect(master);

  const noise = audioContext.createBufferSource();
  noise.buffer = createNoiseBuffer(audioContext, 0.08);

  const noiseFilter = audioContext.createBiquadFilter();
  noiseFilter.type = "bandpass";
  noiseFilter.frequency.setValueAtTime(2400, now);
  noiseFilter.Q.setValueAtTime(0.9, now);

  const noiseGain = audioContext.createGain();
  noiseGain.gain.setValueAtTime(0.1, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);

  noise.connect(noiseFilter);
  noiseFilter.connect(noiseGain);
  noiseGain.connect(master);

  coinTone.start(now);
  sparkleTone.start(now + 0.03);
  noise.start(now);

  coinTone.stop(now + 0.25);
  sparkleTone.stop(now + 0.25);
  noise.stop(now + 0.08);
}

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
  const audioContextRef = useRef<AudioContext | null>(null);
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
  const [autoSpinActive, setAutoSpinActive] = useState(false);
  const [freeSpins, setFreeSpins] = useState(0);
  const [bonusAutoSpinsRemaining, setBonusAutoSpinsRemaining] = useState(0);
  const [rollingReels, setRollingReels] = useState<SymbolId[][] | null>(null);
  const [pendingResult, setPendingResult] = useState<SpinResult | null>(null);
  const [reelStopCount, setReelStopCount] = useState(0);
  const [lastSpin, setLastSpin] = useState<SpinResult | null>(null);
  const [statusMessage, setStatusMessage] = useState("Play freely. No limits.");

  const idleReels = useMemo(() => createIdleReels(createSeededRandom(20260409)), []);
  const displayedReels = rollingReels ?? lastSpin?.reels ?? idleReels;
  const canSpin = !spinning && (freeSpins > 0 || credits >= bet);
  const autoSpinRunning = autoSpinActive || bonusAutoSpinsRemaining > 0;

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
      const audioContext = audioContextRef.current;
      if (audioContext && audioContext.state !== "closed") {
        void audioContext.close();
      }
    };
  }, []);

  useEffect(() => {
    if (!hydrated || spinning || credits > 0 || freeSpins > 0) return;
    queueMicrotask(() => {
      setCredits(STARTING_CREDITS);
      setStats({ spins: 0, wins: 0, totalWon: 0, biggestWin: 0 });
      setLastSpin(null);
      setAutoSpinActive(false);
      setBonusAutoSpinsRemaining(0);
      setStatusMessage("Reloaded ₱500. Keep spinning!");
    });
  }, [credits, freeSpins, hydrated, spinning]);

  const clearReelStopTimers = () => {
    reelStopTimersRef.current.forEach((t) => clearTimeout(t));
    reelStopTimersRef.current = [];
  };

  const playWinSound = useCallback(() => {
    if (typeof window === "undefined") return;

    const BrowserAudioContextCtor = (
      window.AudioContext ??
      (window as Window & { webkitAudioContext?: BrowserAudioContext }).webkitAudioContext
    );

    if (!BrowserAudioContextCtor) return;

    const audioContext = audioContextRef.current ?? new BrowserAudioContextCtor();
    audioContextRef.current = audioContext;

    if (audioContext.state === "suspended") {
      void audioContext.resume().then(() => {
        playKaChingSound(audioContext);
      });
      return;
    }

    playKaChingSound(audioContext);
  }, []);

  const runSpin = useCallback(() => {
    if (spinning) return;

    const usingFreeSpin = freeSpins > 0;
    if (!usingFreeSpin && credits < bet) return;

    const spinMode = usingFreeSpin ? "bonus" : "default";
    const preview = createSpinResult({ bet, mode: spinMode });
    const resolved = createSpinResult({ bet, mode: spinMode });

    clearReelStopTimers();

    setSpinning(true);
    setRollingReels(preview.reels);
    setPendingResult(resolved);
    setReelStopCount(0);
    setLastSpin(null);
    setStatusMessage(usingFreeSpin ? "Spinning a bonus spin..." : "Spinning...");

    if (usingFreeSpin) {
      setFreeSpins((count) => Math.max(0, count - 1));
      setBonusAutoSpinsRemaining((count) => Math.max(0, count - 1));
    } else {
      setCredits((c) => Math.max(0, c - bet));
    }

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

      const scatterCount = resolved.scatterWin?.count ?? 0;
      const bonusSpinsAwarded = getBonusSpinsForScatter(scatterCount);
      const nextCredits = Math.max(0, (usingFreeSpin ? credits : credits - bet) + resolved.totalPayout);
      const nextFreeSpins = Math.max(0, freeSpins - (usingFreeSpin ? 1 : 0)) + bonusSpinsAwarded;
      const shouldStopAuto = autoSpinActive && nextFreeSpins <= 0 && nextCredits < bet;

      if (bonusSpinsAwarded > 0) {
        setFreeSpins((count) => count + bonusSpinsAwarded);
        setBonusAutoSpinsRemaining((count) => count + bonusSpinsAwarded);
      }

      if (resolved.totalPayout > 0) {
        playWinSound();
        setCredits((c) => c + resolved.totalPayout);
        setStats((s) => ({
          ...s,
          wins: s.wins + 1,
          totalWon: s.totalWon + resolved.totalPayout,
          biggestWin: Math.max(s.biggestWin, resolved.totalPayout),
        }));

        if (resolved.scatterWin && bonusSpinsAwarded > 0) {
          setStatusMessage(
            shouldStopAuto
              ? `Won ${formatPeso(resolved.totalPayout)} (x${resolved.scatterWin.multiplier} scatter)! ${BONUS_SPIN_COUNT} bonus auto spins activated. Auto spin stopped: not enough credits.`
              : `Won ${formatPeso(resolved.totalPayout)} (x${resolved.scatterWin.multiplier} scatter)! ${BONUS_SPIN_COUNT} bonus auto spins activated.`,
          );
          if (shouldStopAuto) {
            setAutoSpinActive(false);
          }
          return;
        }

        if (resolved.scatterWin) {
          setStatusMessage(
            shouldStopAuto
              ? `Won ${formatPeso(resolved.totalPayout)} (x${resolved.scatterWin.multiplier} scatter)! Auto spin stopped: not enough credits.`
              : `Won ${formatPeso(resolved.totalPayout)} (x${resolved.scatterWin.multiplier} scatter)!`,
          );
          if (shouldStopAuto) {
            setAutoSpinActive(false);
          }
          return;
        }

        setStatusMessage(
          shouldStopAuto
            ? `Won ${formatPeso(resolved.totalPayout)}! Auto spin stopped: not enough credits.`
            : `Won ${formatPeso(resolved.totalPayout)}!`,
        );
        if (shouldStopAuto) {
          setAutoSpinActive(false);
        }
        return;
      }

      if (bonusSpinsAwarded > 0) {
        setStatusMessage(
          shouldStopAuto
            ? `${BONUS_SPIN_COUNT} bonus auto spins activated from scatter. Auto spin stopped: not enough credits.`
            : `${BONUS_SPIN_COUNT} bonus auto spins activated from scatter.`,
        );
        if (shouldStopAuto) {
          setAutoSpinActive(false);
        }
        return;
      }

      setStatusMessage(
        shouldStopAuto
          ? "No payout. Auto spin stopped: not enough credits."
          : "No payout. Keep spinning!",
      );
      if (shouldStopAuto) {
        setAutoSpinActive(false);
      }
    }, SPIN_DURATION_MS);
  }, [autoSpinActive, bet, credits, freeSpins, playWinSound, spinning]);

  useEffect(() => {
    if (!autoSpinRunning || spinning || !canSpin) return;

    const timer = setTimeout(() => {
      runSpin();
    }, 250);

    return () => clearTimeout(timer);
  }, [autoSpinRunning, canSpin, runSpin, spinning]);

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
            <p>Bonus spins: {freeSpins}</p>
            <p>
              Last scatter multiplier: x
              {lastSpin?.scatterWin?.multiplier ?? 0}
            </p>
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

          {!autoSpinRunning ? (
            <button
              className={styles.controls__spin}
              onClick={() => {
                if (!spinning && (freeSpins > 0 || credits >= bet)) {
                  setAutoSpinActive(true);
                  setStatusMessage("Auto spin started.");
                }
              }}
              disabled={!canSpin}
            >
              Auto Spin
            </button>
          ) : (
            <button
              className={styles.controls__withdraw}
              onClick={() => {
                setAutoSpinActive(false);
                setBonusAutoSpinsRemaining(0);
                setStatusMessage(
                  freeSpins > 0 ? "Auto spin stopped. Bonus spins are still available." : "Auto spin stopped.",
                );
              }}
            >
              Stop Auto Spin
            </button>
          )}

          <p className={styles.controls__status}>{statusMessage}</p>
        </div>
      </section>

      {!hydrated && <p className={styles.loading}>Loading...</p>}
    </main>
  );
}
