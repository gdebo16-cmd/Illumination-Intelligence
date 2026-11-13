"use client";

// Upload many characters at once: one picture with them written in rows.
//
//   1. Choose: say which characters are on the sheet, in order (A to Z unless you change it),
//      and pick the picture.
//   2. Review: every character found is shown with the one Astra thinks it is, in reading order.
//      Change any that are wrong, or skip them, then save them all in one go.
// Characters you'd already made are replaced by the ones from the sheet (they're marked first).

import { useMemo, useRef, useState, type DragEvent } from "react";
import { GlyphArt, GuideLines } from "./GlyphPad";
import { placeSheet, traceSheet, type SheetPiece } from "./trace";
import { CHARACTER_GROUPS, GLYPH_SIZE, isCharacter, type Glyphs, type Shape } from "@/config/astra";

export type SheetLetter = { letter: string; shapes: Shape[] };

type Props = {
  /** The characters the font already has, to warn before replacing them. */
  glyphs: Glyphs;
  /** Save the chosen characters. Resolves to an error message, or null if it all worked. */
  onSave: (letters: SheetLetter[]) => Promise<string | null>;
  onClose: () => void;
};

/** Quick picks for "what's on the sheet". */
const PRESETS = [
  ...CHARACTER_GROUPS.map((group) => ({ name: group.name, order: group.characters.join("") })),
  { name: "Everything", order: CHARACTER_GROUPS.flatMap((group) => group.characters).join("") },
];

export default function SheetImport({ glyphs, onSave, onClose }: Props) {
  const [order, setOrder] = useState(PRESETS[0].order);
  const [found, setFound] = useState<SheetPiece[] | null>(null); // the traced characters, in reading order
  const [picks, setPicks] = useState<string[]>([]); // which character each one is ("" = skip it)
  const [busy, setBusy] = useState<"tracing" | "saving" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const orderCharacters = [...order].filter(isCharacter); // spaces between them are fine
  // Where each one lands depends on what it is (an "a" sits lower than an "A"), so place them again
  // whenever a match changes.
  const placed = useMemo(() => (found ? placeSheet(found, picks) : []), [found, picks]);

  const tracePicture = async (file: File | undefined) => {
    if (!file || busy) return;
    if (!file.type.startsWith("image/")) return setProblem("That isn't a picture. Try a PNG or JPG.");
    setProblem(null);
    setBusy("tracing");
    try {
      const pieces = await traceSheet(file);
      setFound(pieces);
      setPicks(pieces.map((_, i) => orderCharacters[i] ?? ""));
      setNote(
        pieces.length === orderCharacters.length
          ? null
          : `Found ${pieces.length} characters, but the list has ${orderCharacters.length}. Check the matches below.`,
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

  // Two pictures set to the same character can't both be saved.
  const counts = new Map<string, number>();
  for (const pick of picks) if (pick) counts.set(pick, (counts.get(pick) ?? 0) + 1);
  const doubled = [...counts].filter(([, n]) => n > 1).map(([char]) => char);
  const chosen = placed.map((shapes, i) => ({ letter: picks[i], shapes })).filter((l) => l.letter && l.shapes.length);
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
      <div className="astra-pad astra-sheet" role="dialog" aria-modal="true" aria-label="Upload a sheet of characters">
        <h2>Upload a sheet of characters</h2>

        {!found ? (
          <>
            <ul className="astra-sheet-tips">
              <li>Write the characters in rows, left to right, with a clear gap between each one.</li>
              <li>Keep each row to one kind (capitals, lowercase, numbers or punctuation) and one size.</li>
              <li>A dark pen on plain white paper works best. No boxes, lines or other writing.</li>
              <li>Take the photo straight on, in good light, with the page filling most of it.</li>
            </ul>
            <label className="astra-sheet-order">
              Characters on the sheet, in the order you wrote them
              <input value={order} maxLength={200} spellCheck={false} onChange={(e) => setOrder(e.target.value)} />
            </label>
            <div className="astra-sheet-presets">
              {PRESETS.map((preset) => (
                <button key={preset.name} type="button" onClick={() => setOrder(preset.order)}>
                  {preset.name}
                </button>
              ))}
            </div>
            <div
              className={`astra-sheet-drop ${busy === "tracing" ? "is-busy" : ""}`}
              onDragOver={(e) => e.preventDefault()}
              onDrop={dropped}
            >
              {busy === "tracing" ? (
                "Finding the characters…"
              ) : (
                <span>
                  Drop the picture here, or{" "}
                  <button type="button" onClick={() => fileInput.current?.click()} disabled={orderCharacters.length === 0}>
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
              Here’s what Astra found, in reading order. Fix any that are wrong, or pick “Skip”.
            </p>
            {note && <p className="astra-sheet-note">{note}</p>}
            <div className="astra-sheet-grid">
              {placed.map((shapes, i) => {
                const pick = picks[i];
                const isDoubled = pick !== "" && doubled.includes(pick);
                return (
                  <div
                    key={i}
                    className={`astra-sheet-tile ${pick ? "" : "is-skipped"} ${isDoubled ? "is-doubled" : ""}`}
                  >
                    <svg viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
                      <GuideLines />
                      <GlyphArt glyph={{ strokes: [], shapes }} />
                    </svg>
                    <select
                      aria-label={`Character ${i + 1} is`}
                      value={pick}
                      onChange={(e) => setPicks(picks.map((p, j) => (j === i ? e.target.value : p)))}
                    >
                      <option value="">Skip</option>
                      {CHARACTER_GROUPS.map((group) => (
                        <optgroup key={group.id} label={group.name}>
                          {group.characters.map((char) => (
                            <option key={char} value={char}>
                              {char}
                              {glyphs[char] ? " (replace)" : ""}
                            </option>
                          ))}
                        </optgroup>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            {doubled.length > 0 && (
              <p className="astra-pad-problem">More than one picture is set to {doubled.join(" ")}. Change or skip the extras.</p>
            )}
            {replacing.length > 0 && doubled.length === 0 && (
              <p className="astra-sheet-note">These characters you already made will be replaced: {replacing.join(" ")}</p>
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
              {busy === "saving" ? "Saving…" : `Save ${chosen.length} character${chosen.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
