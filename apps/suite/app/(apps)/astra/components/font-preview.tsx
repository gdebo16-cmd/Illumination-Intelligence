"use client";

// "Try it out": type something and see it written in your font.
//
// Each character takes up only as much room as its ink, plus a little space on each side (inkSpan
// in config/astra-geometry.ts), so an I is narrow and a W is wide. With kerning on, pairs whose
// shapes leave a gap (like "AV" or "To") are tucked closer, exactly as the downloaded font does.
// A lowercase letter that isn't made yet borrows its capital. Anything else not made yet shows as a
// faint stand-in, and is listed below so you can click it to go make it.

import { useMemo, useState } from "react";
import { GlyphArt } from "./glyph-pad";
import { BASELINE, CAP_LINE, MISSING_WIDTH, SIDE_SPACE, SPACE_WIDTH, fallbackFor, isCharacter, type Glyph, type Glyphs } from "@/config/astra";
import { inkSpan, kernBetween, profilesOf, type Profile } from "@/config/astra-geometry";

const SAMPLE = "The quick brown fox jumps\nover the lazy dog! AVATAR, Today 2026";
const LINE_TOP = CAP_LINE - 120; // a little room above the capitals…
const LINE_HEIGHT = BASELINE + 200 - LINE_TOP; // …and below the baseline, for tails like g and y
const STAND_IN_SIZE = (BASELINE - CAP_LINE) / 0.7; // makes a stand-in capital as tall as a drawn one

type Placed =
  | { made: true; glyph: Glyph; x: number }
  | { made: false; char: string; x: number };

/** Work out where each character of one line goes, left to right. */
function layOut(line: string, glyphs: Glyphs, penWidth: number, profiles: Map<string, Profile> | null) {
  const placed: Placed[] = [];
  let x = 0;
  let before: string | null = null; // the character just placed, for kerning
  for (const char of line) {
    if (char === " ") {
      x += SPACE_WIDTH;
      before = null;
      continue;
    }
    const fallback = fallbackFor(char);
    const key = glyphs[char] ? char : fallback && glyphs[fallback] ? fallback : null;
    const span = key ? inkSpan(glyphs[key], penWidth) : null;
    if (key && span) {
      const a = before && profiles?.get(before);
      const b = profiles?.get(key);
      if (a && b) x += kernBetween(a, b);
      // Slide it so its leftmost ink lands SIDE_SPACE after the end of the character before.
      placed.push({ made: true, glyph: glyphs[key], x: x + SIDE_SPACE - span.left });
      x += SIDE_SPACE + (span.right - span.left) + SIDE_SPACE;
      before = key;
    } else {
      placed.push({ made: false, char, x: x + MISSING_WIDTH / 2 });
      x += MISSING_WIDTH;
      before = null;
    }
  }
  return { placed, width: Math.max(0, x) };
}

type Props = { glyphs: Glyphs; penWidth: number; onMake: (char: string) => void };

export default function FontPreview({ glyphs, penWidth, onMake }: Props) {
  const [text, setText] = useState(SAMPLE);
  const [size, setSize] = useState(64); // how tall one line is on screen, in pixels
  const [kerning, setKerning] = useState(true);

  // Measuring every character's shape takes a moment, so only redo it when the font changes.
  const profiles = useMemo(() => profilesOf(glyphs, penWidth), [glyphs, penWidth]);
  const lines = text.split("\n").map((line) => layOut(line, glyphs, penWidth, kerning ? profiles : null));
  const width = Math.max(1, ...lines.map((line) => line.width));
  const toMake = [...new Set(text)]
    .filter((char) => isCharacter(char) && !glyphs[char] && !(fallbackFor(char) && glyphs[fallbackFor(char)!]))
    .sort();

  return (
    <section className="astra-preview" aria-label="Try out your font">
      <h2>Try it out</h2>
      <textarea
        aria-label="Text to show in your font"
        value={text}
        rows={2}
        maxLength={500}
        spellCheck={false}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="astra-preview-controls">
        <label className="astra-preview-size">
          Size
          <input type="range" min={24} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} />
        </label>
        <label className="astra-preview-kerning">
          <input type="checkbox" checked={kerning} onChange={(e) => setKerning(e.target.checked)} />
          Kerning (tuck pairs like AV closer)
        </label>
      </div>
      <div className="astra-preview-output">
        <svg
          viewBox={`0 ${LINE_TOP} ${width} ${lines.length * LINE_HEIGHT}`}
          width={(width / LINE_HEIGHT) * size}
          height={lines.length * size}
          role="img"
          aria-label={text}
        >
          {lines.map((line, row) => (
            <g key={row} transform={`translate(0 ${row * LINE_HEIGHT})`}>
              {line.placed.map((item, i) =>
                item.made ? (
                  <g key={i} transform={`translate(${item.x} 0)`}>
                    <GlyphArt glyph={item.glyph} penWidth={penWidth} />
                  </g>
                ) : (
                  <text
                    key={i}
                    className="astra-preview-missing"
                    x={item.x}
                    y={BASELINE}
                    textAnchor="middle"
                    fontSize={STAND_IN_SIZE}
                  >
                    {item.char}
                  </text>
                ),
              )}
            </g>
          ))}
        </svg>
      </div>
      {toMake.length > 0 && (
        <p className="astra-preview-todo">
          Faded characters aren’t made yet:
          {toMake.map((char) => (
            <button key={char} type="button" onClick={() => onMake(char)} aria-label={`Make the character ${char}`}>
              {char}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}
