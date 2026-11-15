"use client";

// Halo: make a Lottie animation. Pick a shape (or upload an SVG), turn on some moves, set how long
// one loop lasts, and download the .json. The preview plays the real file as you change things.

import { useMemo, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import LottiePreview from "./LottiePreview";
import { readSvg } from "./svg-file";
import {
  MAX_SECONDS,
  MIN_SECONDS,
  MOVES,
  START_SHAPES,
  type Pivot,
} from "@/config/halo";
import { parsePath, toSvgPath, type Bezier } from "@/lib/halo/path";
import { buildLottie, type MoveSetting } from "@/lib/halo/lottie";

type Upload = { name: string; paths: Bezier[]; skipped: string[] };

const startingMoves = (): Record<string, MoveSetting> =>
  Object.fromEntries(MOVES.map((m) => [m.id, { on: m.id === "sway", strength: 0.5 }]));

const fileName = (name: string) => `${name.replace(/[/\\?%*:|"<>]/g, "").trim() || "Halo animation"}.json`;

export default function Halo() {
  const [name, setName] = useState("Flame");
  const [shapeId, setShapeId] = useState<string>("flame"); // a START_SHAPES id, or "upload"
  const [upload, setUpload] = useState<Upload | null>(null);
  const [color, setColor] = useState("#f2a33a");
  const [moves, setMoves] = useState(startingMoves);
  const [seconds, setSeconds] = useState(2);
  const [pivot, setPivot] = useState<Pivot>("bottom");
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const paths = useMemo(() => {
    if (shapeId === "upload" && upload) return upload.paths;
    const shape = START_SHAPES.find((s) => s.id === shapeId) ?? START_SHAPES[0];
    return parsePath(shape.d).paths;
  }, [shapeId, upload]);

  const animation = useMemo(
    () => buildLottie({ name: name.trim() || "Halo animation", paths, color, moves, seconds, pivot }),
    [name, paths, color, moves, seconds, pivot],
  );

  const changeMove = (id: string, change: Partial<MoveSetting>) =>
    setMoves((all) => ({ ...all, [id]: { ...all[id], ...change } }));

  const pickFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const shape = readSvg(await file.text());
      const base = file.name.replace(/\.svg$/i, "");
      setUpload({ name: base, ...shape });
      setShapeId("upload");
      setName(base);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(animation)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName(name);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 10_000);
  };

  const sizeKb = Math.max(1, Math.round(JSON.stringify(animation).length / 1024));

  return (
    <AppShell appId="halo">
      <main className="halo">
        <section className="halo-stage" aria-label="Preview">
          <LottiePreview animation={animation} />
          <input
            className="halo-name"
            aria-label="Animation name"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
          />
          <button type="button" className="halo-action is-main" onClick={download}>
            Download .json <span>({sizeKb} KB)</span>
          </button>
        </section>

        <div className="halo-controls">
          {error && <p className="halo-error" role="alert">{error}</p>}

          <section className="halo-panel" aria-label="Shape">
            <h2>Shape</h2>
            <div className="halo-shapes">
              {START_SHAPES.map((shape) => (
                <button
                  key={shape.id}
                  type="button"
                  className={`halo-shape ${shapeId === shape.id ? "is-current" : ""}`}
                  aria-pressed={shapeId === shape.id}
                  onClick={() => {
                    setShapeId(shape.id);
                    setName(shape.name);
                  }}
                >
                  <svg viewBox="-5 -5 110 110" aria-hidden="true">
                    <path d={shape.d} />
                  </svg>
                  {shape.name}
                </button>
              ))}
              {upload && (
                <button
                  type="button"
                  className={`halo-shape ${shapeId === "upload" ? "is-current" : ""}`}
                  aria-pressed={shapeId === "upload"}
                  onClick={() => setShapeId("upload")}
                >
                  <UploadThumb paths={upload.paths} />
                  {upload.name}
                </button>
              )}
              <button type="button" className="halo-shape is-upload" onClick={() => fileInput.current?.click()}>
                <span aria-hidden="true">+</span>
                Upload SVG
              </button>
              <input
                ref={fileInput}
                type="file"
                accept=".svg,image/svg+xml"
                hidden
                onChange={(e) => {
                  void pickFile(e.target.files?.[0]);
                  e.target.value = ""; // so picking the same file again still works
                }}
              />
            </div>
            {shapeId === "upload" && upload && upload.skipped.length > 0 && (
              <p className="halo-note">Some parts of this SVG weren&apos;t copied: {upload.skipped.join(", ")}.</p>
            )}
            <label className="halo-row">
              Colour
              <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
            </label>
          </section>

          <section className="halo-panel" aria-label="Moves">
            <h2>Moves</h2>
            <p className="halo-help">Turn on as many as you like. They all play at once.</p>
            <div className="halo-moves">
              {MOVES.map((move) => {
                const setting = moves[move.id];
                return (
                  <div key={move.id} className={`halo-move ${setting.on ? "is-on" : ""}`}>
                    <label className="halo-move-name" title={move.description}>
                      <input
                        type="checkbox"
                        checked={setting.on}
                        onChange={(e) => changeMove(move.id, { on: e.target.checked })}
                      />
                      {move.name}
                    </label>
                    <input
                      type="range"
                      min={0.05}
                      max={1}
                      step={0.05}
                      value={setting.strength}
                      disabled={!setting.on}
                      aria-label={`${move.name} strength`}
                      onChange={(e) => changeMove(move.id, { strength: Number(e.target.value) })}
                    />
                    <span className="halo-move-about">{move.description}</span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="halo-panel" aria-label="Timing">
            <h2>Timing</h2>
            <label className="halo-row">
              One loop lasts
              <input
                type="range"
                min={MIN_SECONDS}
                max={MAX_SECONDS}
                step={0.5}
                value={seconds}
                onChange={(e) => setSeconds(Number(e.target.value))}
              />
              <span>{seconds} s</span>
            </label>
            <label className="halo-row">
              Turns and grows around its
              <select value={pivot} onChange={(e) => setPivot(e.target.value as Pivot)}>
                <option value="center">middle</option>
                <option value="bottom">bottom</option>
              </select>
            </label>
          </section>
        </div>
      </main>
    </AppShell>
  );
}

function UploadThumb({ paths }: { paths: Bezier[] }) {
  const d = useMemo(() => toSvgPath(paths), [paths]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of paths) for (const [x, y] of p.v) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  const pad = Math.max(maxX - minX, maxY - minY) * 0.05;
  return (
    <svg viewBox={`${minX - pad} ${minY - pad} ${maxX - minX + 2 * pad} ${maxY - minY + 2 * pad}`} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}
