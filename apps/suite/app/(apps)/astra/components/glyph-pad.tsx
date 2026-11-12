"use client";

// The drawing pad: a big square where you make one letter, two ways:
//   • draw it with the mouse, a pen or a finger (pen strokes), or
//   • upload a picture of it, which is traced into filled shapes (see trace.ts).
// You can mix them: upload a picture, then touch it up with the pen.
// Everything is kept as points on the GLYPH_SIZE grid (see config/astra.ts), not as a picture,
// so it stays sharp at any size and can become a real font later.

import { useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent } from "react";
import {
  BASELINE,
  CAP_LINE,
  EMPTY_GLYPH,
  GLYPH_SIZE,
  PEN_WIDTH,
  isEmptyGlyph,
  type Glyph,
  type Point,
} from "@/config/astra";
import { traceImage } from "./trace";

/** Draws a letter inside an <svg>. Used by the pad, and by the small previews in the letter grid. */
export function GlyphArt({ glyph }: { glyph: Glyph }) {
  // All the traced shapes go in one path, so a hole (drawn the other way around) cuts out of its letter.
  const shapes = glyph.shapes.map((shape) => `M${shape.map(([x, y]) => `${x} ${y}`).join("L")}Z`).join("");
  return (
    <>
      {shapes && <path d={shapes} fill="currentColor" fillRule="nonzero" />}
      <g fill="none" stroke="currentColor" strokeWidth={PEN_WIDTH} strokeLinecap="round" strokeLinejoin="round">
        {glyph.strokes.map((stroke, i) => {
          // A single tap is just one point; repeat it so it still shows up as a dot.
          const points = stroke.length === 1 ? [stroke[0], stroke[0]] : stroke;
          return <polyline key={i} points={points.map(([x, y]) => `${x},${y}`).join(" ")} />;
        })}
      </g>
    </>
  );
}

type Props = {
  letter: string;
  /** What's already made for this letter (empty if nothing yet). */
  initial: Glyph;
  /** True while the page is saving, so the buttons can wait. */
  saving: boolean;
  onSave: (glyph: Glyph) => void;
  onCancel: () => void;
};

export default function GlyphPad({ letter, initial, saving, onSave, onCancel }: Props) {
  const [glyph, setGlyph] = useState<Glyph>(initial);
  const [history, setHistory] = useState<Glyph[]>([]); // earlier versions, for Undo
  const [tracing, setTracing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const drawing = useRef(false); // is the pen down right now?
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = saving || tracing;

  // Every change (except the pen moving mid-stroke) remembers the version before it, so Undo can go back.
  const change = (next: Glyph) => {
    setHistory((earlier) => [...earlier, glyph]);
    setGlyph(next);
  };

  const undo = () => {
    if (history.length === 0) return;
    setGlyph(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  };

  // ── Drawing with the pen ──

  // Turn where the pointer is on screen into a point on the 1000 × 1000 grid.
  const pointFrom = (e: PointerEvent<SVGSVGElement>): Point => {
    const box = e.currentTarget.getBoundingClientRect();
    const inGrid = (fraction: number) => Math.round(Math.min(GLYPH_SIZE, Math.max(0, fraction * GLYPH_SIZE)));
    return [inGrid((e.clientX - box.left) / box.width), inGrid((e.clientY - box.top) / box.height)];
  };

  // Pen down: start a new stroke with one point.
  const penDown = (e: PointerEvent<SVGSVGElement>) => {
    if (busy) return;
    e.currentTarget.setPointerCapture(e.pointerId); // keep following the pen even if it leaves the square
    drawing.current = true;
    change({ ...glyph, strokes: [...glyph.strokes, [pointFrom(e)]] });
  };

  // Pen moving: add a point to the stroke being drawn.
  const penMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drawing.current) return;
    const point = pointFrom(e);
    setGlyph((now) => {
      const current = now.strokes[now.strokes.length - 1];
      const [lastX, lastY] = current[current.length - 1];
      if (Math.hypot(point[0] - lastX, point[1] - lastY) < 4) return now; // barely moved: skip it
      return { ...now, strokes: [...now.strokes.slice(0, -1), [...current, point]] };
    });
  };

  // Pen up: the stroke is finished.
  const penUp = () => {
    drawing.current = false;
  };

  // ── Uploading a picture ──

  // Trace the picture into shapes. They replace any shapes from an earlier picture; pen strokes stay.
  const tracePicture = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.type.startsWith("image/")) return setProblem("That isn't a picture. Try a PNG or JPG.");
    setProblem(null);
    setTracing(true);
    try {
      const shapes = await traceImage(file);
      change({ ...glyph, shapes });
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setTracing(false);
    }
  };

  const pictureChosen = (e: ChangeEvent<HTMLInputElement>) => {
    tracePicture(e.target.files?.[0]);
    e.target.value = ""; // so choosing the same file again still counts
  };

  const pictureDropped = (e: DragEvent<SVGSVGElement>) => {
    e.preventDefault();
    tracePicture(e.dataTransfer.files[0]);
  };

  return (
    <div className="astra-pad-backdrop">
      <div className="astra-pad" role="dialog" aria-modal="true" aria-label={`Make the letter ${letter}`}>
        <h2>Draw {letter}, or upload a picture of it</h2>
        <svg
          className={`astra-pad-canvas ${tracing ? "is-tracing" : ""}`}
          viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`}
          onPointerDown={penDown}
          onPointerMove={penMove}
          onPointerUp={penUp}
          onPointerCancel={penUp}
          onDragOver={(e) => e.preventDefault()}
          onDrop={pictureDropped}
        >
          {/* A faint letter to trace over, sized so capitals reach from the cap line to the baseline. */}
          <text
            className="astra-pad-ghost"
            x={GLYPH_SIZE / 2}
            y={BASELINE}
            textAnchor="middle"
            fontSize={(BASELINE - CAP_LINE) / 0.7}
          >
            {letter}
          </text>
          <line className="astra-pad-guide" x1={0} x2={GLYPH_SIZE} y1={CAP_LINE} y2={CAP_LINE} />
          <line className="astra-pad-guide" x1={0} x2={GLYPH_SIZE} y1={BASELINE} y2={BASELINE} />
          <GlyphArt glyph={glyph} />
        </svg>
        {problem && <p className="astra-pad-problem" role="alert">{problem}</p>}
        <input ref={fileInput} type="file" accept="image/*" hidden onChange={pictureChosen} />
        <div className="astra-pad-buttons">
          <button type="button" onClick={undo} disabled={history.length === 0 || busy}>
            Undo
          </button>
          <button type="button" onClick={() => change(EMPTY_GLYPH)} disabled={isEmptyGlyph(glyph) || busy}>
            Clear
          </button>
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            {tracing ? "Tracing…" : "Upload picture"}
          </button>
          <span className="astra-pad-spacer" />
          <button type="button" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="astra-pad-save" onClick={() => onSave(glyph)} disabled={busy}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
