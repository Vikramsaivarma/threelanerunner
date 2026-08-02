import { useEffect, useRef, useState, useCallback } from "react";
import RunnerGame, { type GameCallbacks } from "@/game/RunnerGame";

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<RunnerGame | null>(null);
  const [score, setScore] = useState(0);
  const [highScore, setHighScore] = useState(0);
  const [gameOver, setGameOver] = useState(false);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const stored = Number(localStorage.getItem("runner-high-score") || "0");
    setHighScore(stored);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const callbacks: GameCallbacks = {
      onScore: (s) => setScore(s),
      onGameOver: (finalScore) => {
        setGameOver(true);
        setScore(finalScore);
        setHighScore((prev) => {
          if (finalScore > prev) {
            localStorage.setItem("runner-high-score", String(finalScore));
            return finalScore;
          }
          return prev;
        });
      },
      onRestart: () => {
        setGameOver(false);
        setScore(0);
      },
      onStart: () => setStarted(true),
    };
    const game = new RunnerGame(canvas, callbacks);
    gameRef.current = game;
    game.init();
    return () => game.destroy();
  }, []);

  const handleStart = useCallback(() => {
    gameRef.current?.start();
  }, []);

  return (
    <div className="relative w-full h-screen overflow-hidden bg-black font-sans select-none">
      {/* 3D canvas fills the screen */}
      <div ref={containerRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="w-full h-full block touch-none" />
      </div>

      {/* Title */}
      <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
        <span className="text-xl sm:text-2xl font-extrabold tracking-tight text-white drop-shadow-lg">
          LANE<span className="text-cyan-400">RUNNER</span>
        </span>
      </div>

      {/* Score panel top-right */}
      <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-1.5">
        <div className="bg-black/45 backdrop-blur-md border border-white/15 rounded-xl px-3.5 py-2 text-right shadow-lg">
          <div className="text-[10px] uppercase tracking-widest text-amber-300/90 font-semibold">
            High Score
          </div>
          <div className="text-2xl font-bold text-amber-300 tabular-nums leading-none">
            {highScore}
          </div>
        </div>
        <div className="bg-black/45 backdrop-blur-md border border-white/15 rounded-xl px-3.5 py-2 text-right shadow-lg">
          <div className="text-[10px] uppercase tracking-widest text-cyan-300/90 font-semibold">
            Score
          </div>
          <div className="text-2xl font-bold text-white tabular-nums leading-none">
            {score}
          </div>
        </div>
      </div>

      {/* Start overlay */}
      {!started && !gameOver && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/45 backdrop-blur-sm">
          <div className="text-center px-6">
            <h2 className="text-3xl sm:text-4xl font-extrabold text-white mb-3 drop-shadow-lg">
              Ready to Run?
            </h2>
            <p className="text-sm sm:text-base text-white/80 max-w-md">
              Sprint down the street and dodge the obstacles rushing toward
              you. Switch lanes, jump over crates, slide under barriers, and
              your auto-firing laser gun blasts the enemy drones.
            </p>
          </div>
          <button
            onClick={handleStart}
            className="px-8 py-3 rounded-full bg-cyan-400 text-black font-bold text-base hover:bg-cyan-300 active:scale-95 transition shadow-xl shadow-cyan-400/40"
          >
            Start Game
          </button>
          <div className="flex flex-col items-center gap-1 text-xs text-white/60">
            <p>
              <span className="text-white/80">&larr; &rarr;</span> or{" "}
              <span className="text-white/80">A / D</span> to switch lanes
            </p>
            <p>
              <span className="text-white/80">&uarr;</span> or{" "}
              <span className="text-white/80">W</span> to jump &middot;{" "}
              <span className="text-white/80">&darr;</span> or{" "}
              <span className="text-white/80">S</span> to slide
            </p>
            <p>Swipe on mobile &middot; Laser fires automatically</p>
          </div>
        </div>
      )}

      {/* Game over overlay */}
      {gameOver && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-5 bg-black/55 backdrop-blur-sm">
          <div className="text-center px-6">
            <h2 className="text-4xl font-extrabold text-red-400 mb-2 drop-shadow-lg">
              Crashed!
            </h2>
            <p className="text-base text-white/85">
              Score: <span className="font-bold text-white">{score}</span>
            </p>
            <p className="text-sm text-white/60">
              Best: {highScore}
              {score >= highScore && score > 0 && (
                <span className="ml-2 text-amber-300 font-semibold">
                  New Record!
                </span>
              )}
            </p>
          </div>
          <button
            onClick={handleStart}
            className="px-8 py-3 rounded-full bg-cyan-400 text-black font-bold text-base hover:bg-cyan-300 active:scale-95 transition shadow-xl shadow-cyan-400/40"
          >
            Run Again
          </button>
          <p className="text-xs text-white/60">Press Space to restart</p>
        </div>
      )}

      {/* Controls hint */}
      {started && !gameOver && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
          <p className="text-xs text-white/50 text-center">
            <span className="text-white/80">&larr; &rarr;</span> lanes{" "}
            <span className="text-white/80 mx-1">|</span>{" "}
            <span className="text-white/80">&uarr;</span> jump{" "}
            <span className="text-white/80 mx-1">|</span>{" "}
            <span className="text-white/80">&darr;</span> slide{" "}
            <span className="text-white/80 mx-1">|</span> laser auto-fires
          </p>
        </div>
      )}
    </div>
  );
}
