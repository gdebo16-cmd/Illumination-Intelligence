"use client";

// Make characters with AI: describe a style, and Prism's painter draws each character one at a time
// (POST /api/astra/ai-character). Each picture is traced into shapes right away (trace.ts), just like
// an uploaded picture. Then you review them: keep the good ones, redo any that came out wrong, and
// save the keepers to the font.
//
// Needs ComfyUI running, like Prism. Each character takes a few seconds on the graphics card.

import { useRef, useState } from "react";
import { GlyphArt, GuideLines } from "./GlyphPad";
import { traceImage } from "./trace";
import { CHARACTER_GROUPS, GLYPH_SIZE, type Glyphs, type Shape } from "@/config/astra";
import type { SheetLetter } from "./SheetImport";

type Result = {
  char: string;
  status: "waiting" | "drawing" | "done" | "failed";
  shapes: Shape[];
  error?: string;
  keep: boolean;
};

type Props = {
  glyphs: Glyphs;
  onSave: (letters: SheetLetter[]) => Promise<string | null>;
  onClose: () => void;
};

const STYLE_IDEAS = ["chunky bubble letters", "elegant brush calligraphy", "medieval blackletter", "neon tube sign", "hand-carved wood type"];

/** Ask for one character and trace it. Throws a plain-English error if it didn't work. */
async function drawCharacter(char: string, style: string): Promise<Shape[]> {
  const res = await fetch("/api/astra/ai-character", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ char, style, seed: Math.floor(Math.random() * 2 ** 32) }),
  }).catch(() => null);
  if (!res) throw new Error("Couldn't reach the server.");
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? "The painter couldn't draw it.");
  const picture = new File([await res.blob()], `${char}.png`, { type: "image/png" });
  return traceImage(picture, char);
}

export default function AiAlphabet({ glyphs, onSave, onClose }: Props) {
  const [style, setStyle] = useState("");
  const [groups, setGroups] = useState<string[]>([CHARACTER_GROUPS[0].id]);
  const [results, setResults] = useState<Result[] | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const stop = useRef(false);

  const chars = CHARACTER_GROUPS.filter((g) => groups.includes(g.id)).flatMap((g) => g.characters);
  const update = (char: string, change: Partial<Result>) =>
    setResults((all) => all?.map((r) => (r.char === char ? { ...r, ...change } : r)) ?? null);

  // Draw the characters one after another. Stops early if you press Stop, or if ComfyUI isn't there.
  const drawAll = async (list: string[]) => {
    setRunning(true);
    setProblem(null);
    stop.current = false;
    for (const char of list) {
      if (stop.current) break;
      update(char, { status: "drawing", error: undefined });
      try {
        const shapes = await drawCharacter(char, style.trim());
        update(char, { status: "done", shapes, keep: true });
      } catch (err) {
        const message = (err as Error).message;
        update(char, { status: "failed", error: message, keep: false });
        if (/isn’t running|couldn't reach/i.test(message)) {
          setProblem(message);
          break;
        }
      }
    }
    setRunning(false);
  };

  const start = () => {
    setResults(chars.map((char) => ({ char, status: "waiting", shapes: [], keep: false })));
    void drawAll(chars);
  };

  const redo = (char: string) => {
    update(char, { status: "waiting", shapes: [], keep: false });
    void drawAll([char]);
  };

  const keepers = (results ?? []).filter((r) => r.keep && r.status === "done" && r.shapes.length > 0);
  const finished = (results ?? []).filter((r) => r.status === "done" || r.status === "failed").length;
  const replacing = keepers.filter((r) => glyphs[r.char]).map((r) => r.char);

  const save = async () => {
    setSaving(true);
    setProblem(null);
    const failed = await onSave(keepers.map((r) => ({ letter: r.char, shapes: r.shapes })));
    setSaving(false);
    if (failed) setProblem(failed);
    else onClose();
  };

  return (
    <div className="astra-pad-backdrop">
      <div className="astra-pad astra-sheet" role="dialog" aria-modal="true" aria-label="Make characters with AI">
        <h2>Make characters with AI</h2>

        {!results ? (
          <>
            <label className="astra-sheet-order">
              Describe the style
              <input
                value={style}
                maxLength={300}
                placeholder="e.g. chunky bubble letters with soft rounded corners"
                onChange={(e) => setStyle(e.target.value)}
              />
            </label>
            <div className="astra-sheet-presets" aria-label="Style ideas">
              {STYLE_IDEAS.map((idea) => (
                <button key={idea} type="button" onClick={() => setStyle(idea)}>
                  {idea}
                </button>
              ))}
            </div>
            <fieldset className="astra-ai-groups">
              <legend>Which characters?</legend>
              {CHARACTER_GROUPS.map((group) => (
                <label key={group.id}>
                  <input
                    type="checkbox"
                    checked={groups.includes(group.id)}
                    onChange={(e) =>
                      setGroups(e.target.checked ? [...groups, group.id] : groups.filter((id) => id !== group.id))
                    }
                  />
                  {group.name} ({group.characters.length})
                </label>
              ))}
            </fieldset>
            <p className="astra-sheet-help">
              Prism draws each character separately, which takes a few seconds each on the graphics card
              (about {Math.max(1, Math.round((chars.length * 5) / 60))} min for {chars.length}). ComfyUI needs to be running.
              AI sometimes draws the wrong shape, so you’ll get to check each one before anything is saved.
            </p>
          </>
        ) : (
          <>
            <p className="astra-sheet-help">
              {running
                ? `Drawing… ${finished} of ${results.length} done. You can stop at any time and keep what's finished.`
                : "Untick any you don't want, or redo them for a new try. Then save the rest."}
            </p>
            <div className="astra-sheet-grid astra-ai-grid">
              {results.map((r) => (
                <div key={r.char} className={`astra-sheet-tile astra-ai-tile is-${r.status} ${r.keep ? "" : "is-skipped"}`}>
                  <svg viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
                    <GuideLines />
                    {r.status === "done" && <GlyphArt glyph={{ strokes: [], shapes: r.shapes }} />}
                  </svg>
                  <span className="astra-ai-status">
                    {r.char}
                    {r.status === "drawing" && " · drawing…"}
                    {r.status === "waiting" && " · waiting"}
                    {r.status === "failed" && " · didn't work"}
                    {r.status === "done" && glyphs[r.char] && " · replaces"}
                  </span>
                  {r.status === "failed" && r.error && <span className="astra-ai-error">{r.error}</span>}
                  <div className="astra-ai-tile-buttons">
                    <label>
                      <input
                        type="checkbox"
                        checked={r.keep}
                        disabled={r.status !== "done"}
                        onChange={(e) => update(r.char, { keep: e.target.checked })}
                      />
                      Keep
                    </label>
                    <button type="button" onClick={() => redo(r.char)} disabled={running} aria-label={`Draw ${r.char} again`}>
                      Redo
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {replacing.length > 0 && !running && (
              <p className="astra-sheet-note">These characters you already made will be replaced: {replacing.join(" ")}</p>
            )}
          </>
        )}

        {problem && <p className="astra-pad-problem" role="alert">{problem}</p>}

        <div className="astra-pad-buttons">
          {running && (
            <button type="button" onClick={() => (stop.current = true)}>
              Stop
            </button>
          )}
          <span className="astra-pad-spacer" />
          <button
            type="button"
            onClick={() => {
              stop.current = true; // don't keep drawing after the window is closed
              onClose();
            }}
            disabled={saving}
          >
            {results ? "Close" : "Cancel"}
          </button>
          {!results ? (
            <button type="button" className="astra-pad-save" onClick={start} disabled={!style.trim() || chars.length === 0}>
              Draw {chars.length} characters
            </button>
          ) : (
            <button type="button" className="astra-pad-save" onClick={save} disabled={running || saving || keepers.length === 0}>
              {saving ? "Saving…" : `Save ${keepers.length} character${keepers.length === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
