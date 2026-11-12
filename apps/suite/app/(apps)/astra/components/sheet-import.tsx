"use client";

// Upload a whole alphabet at once: one picture with the letters written in rows.
//
//   1. Choose: say which letters are on the sheet (A to Z unless you change it), and pick the picture.
//   2. Review: every letter found is shown with the letter Astra thinks it is, in reading order.
//      Change any that are wrong, or skip them, then save them all in one go.
// Letters you'd already made are replaced by the ones from the sheet (they're marked first).

import { useRef, useState, type DragEvent } from "react";
import { GlyphArt } from "./glyph-pad";
import { traceSheet } from "./trace";
import { BASELINE, CAP_LINE, GLYPH_SIZE, LETTERS, isLetter, type Glyphs, type Shape } from "@/config/astra";

export type SheetLetter = { letter: string; shapes: Shape[] };

type Props = {
  /** The letters the font already has, to warn before replacing them. */
  glyphs: Glyphs;
  /** Save the chosen letters. Resolves to an error message, or null if it all worked. */
  onSave: (letters: SheetLetter[]) => Promise<string | null>;
  onClose: () => void;
};

export default function SheetImport({ glyphs, onSave, onClose }: Props) {
  const [order, setOrder] = useState(LETTERS.join(""));
  const [found, setFound] = useState<Shape[][] | null>(null); // the traced letters, in reading order
  const [picks, setPicks] = useState<string[]>([]); // which letter each one is ("" = skip it)
  const [busy, setBusy] = useState<"tracing" | "saving" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const orderLetters = [...order.toUpperCase()].filter(isLetter);

  const tracePicture = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.type.startsWith("image/")) return setProblem("That isn't a picture. Try a PNG or JPG.");
    setProblem(null);
    setBusy("tracing");
    try {
      const letters = await traceSheet(file);
      setFound(letters);
      setPicks(letters.map((_, i) => orderLetters[i] ?? ""));
      setNote(
        letters.length === orderLetters.length
          ? null
          : `Found ${letters.length} letters, but the list has ${orderLetters.length}. Check the matches below.`,
      );
    } catch (err) {
      setProblem((err as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const dropped = (e: DragEvent) => {
    e.preventDefault();
    tracePicture(e.dataTransfer.files[0]);
  };

  // Two pictures set to the same letter can't both be saved.
  const counts = new Map<string, number>();
  for (const pick of picks) if (pick) counts.set(pick, (counts.get(pick) ?? 0) + 1);
  const doubled = [...counts].filter(([, n]) => n > 1).map(([letter]) => letter);
  const chosen = found ? found.map((shapes, i) => ({ letter: picks[i], shapes })).filter((l) => l.letter) : [];
  const replacing = chosen.filter((l) => glyphs[l.letter]).map((l) => l.letter);

  const save = async () => {
    setBusy("saving");
    setProblem(null);
    const failed = await onSave(chosen);
    setBusy(null);
    if (failed) setProblem(failed);
    else onClose();
  };

  return (
    <div className="astra-pad-backdrop">
      <div className="astra-pad astra-sheet" role="dialog" aria-modal="true" aria-label="Upload an alphabet sheet">
        <h2>Upload an alphabet sheet</h2>

        {!found ? (
          <>
            <ul className="astra-sheet-tips">
              <li>Write the letters in rows, left to right, with a clear gap between each one.</li>
              <li>A dark pen on plain white paper works best. No boxes, lines or other writing.</li>
              <li>Take the photo straight on, in good light, with the page filling most of it.</li>
            </ul>
            <label className="astra-sheet-order">
              Letters on the sheet, in the order you wrote them
              <input
                value={order}
                maxLength={60}
                spellCheck={false}
                onChange={(e) => setOrder(e.target.value)}
              />
            </label>
            <div
              className={`astra-sheet-drop ${busy === "tracing" ? "is-busy" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={dropped}
            >
              {busy === "tracing" ? (
                "Finding the letters…"
              ) : (
                <span>
                  Drop the picture here, or{" "}
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={orderLetters.length === 0}>
                    choose a picture
                  </button>
                </span>
              )}
            </div>
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                tracePicture(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </>
        ) : (
          <>
            <p className="astra-sheet-help">
              Here’s what Astra found, in reading order. Fix any letter that’s wrong, or pick “Skip”.
            </p>
            {note && <p className="astra-sheet-note">{note}</p>}
            <div className="astra-sheet-grid">
              {found.map((shapes, i) => {
                const pick = picks[i];
                const isDoubled = pick !== "" && doubled.includes(pick);
                return (
                  <div
                    key={i}
                    className={`astra-sheet-tile ${pick ? "" : "is-skipped"} ${isDoubled ? "is-doubled" : ""}`}
                  >
                    <svg viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
                      <line className="astra-pad-guide" x1={0} x2={GLYPH_SIZE} y1={CAP_LINE} y2={CAP_LINE} />
                      <line className="astra-pad-guide" x1={0} x2={GLYPH_SIZE} y1={BASELINE} y2={BASELINE} />
                      <GlyphArt glyph={{ strokes: [], shapes }} />
                    </svg>
                    <select
                      aria-label={`Letter ${i + 1} is`}
                      value={pick}
                      onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))}
                    >
                      <option value="">Skip</option>
                      {LETTERS.map((letter) => (
                        <option key={letter} value={letter}>
                          {letter}
                          {glyphs[letter] ? " (replace)" : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {doubled.length > 0 && (
              <p className="astra-pad-problem">More than one picture is set to {doubled.join(", ")}. Change or skip the extras.</p>
            )}
            {replacing.length > 0 && doubled.length === 0 && (
              <p className="astra-sheet-note">These letters you already made will be replaced: {replacing.join(", ")}.</p>
            )}
          </>
        )}

        {problem && <p className="astra-pad-problem" role="alert">{problem}</p>}

        <div className="astra-pad-buttons">
          {found && (
            <button type="button" onClick={() => { setFound(null); setNote(null); setProblem(null); }} disabled={busy !== null}>
              Start over
            </button>
          )}
          <span className="astra-pad-spacer" />
          <button type="button" onClick={onClose} disabled={busy === "saving"}>
            Cancel
          </button>
          {found && (
            <button
              type="button"
              className="astra-pad-save"
              onClick={save}
              disabled={busy !== null || chosen.length === 0 || doubled.length > 0}
            >
              {busy === "saving" ? "Saving…" : `Save ${chosen.length} letter${chosen.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
