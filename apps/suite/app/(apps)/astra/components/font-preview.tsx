"use client";

// "Try it out": type something and see it written in your font.
//
// Each letter takes up only as much room as its ink, plus a little space on each side (see inkSpan
// in config/astra.ts), so an I is narrow and a W is wide — the same spacing a font file will use.
// Letters that haven't been made yet show as faint stand-ins, and are listed below so you can
// click one to go make it. The font only has capitals so far, so lowercase is shown as capitals.

import { useState } from "react";
import { GlyphArt } from "./glyph-pad";
import {
  BASELINE,
  CAP_LINE,
  MISSING_WIDTH,
  SIDE_SPACE,
  SPACE_WIDTH,
  inkSpan,
  isLetter,
  type Glyph,
  type Glyphs,
} from "@/config/astra";

const SAMPLE = "THE QUICK BROWN FOX\nJUMPS OVER THE LAZY DOG"; // uses every letter
const LINE_TOP = CAP_LINE - 120; // a little room above the capitals…
const LINE_HEIGHT = BASELINE + 120 - LINE_TOP; // …and below the baseline
const STAND_IN_SIZE = (BASELINE - CAP_LINE) / 0.7; // makes a stand-in capital as tall as a drawn one

type Placed =
  | { made: true; glyph: Glyph; x: number }
  | { made: false; char: string; x: number };

/** Work out where each letter of one line goes, left to right. */
function layOut(line: string, glyphs: Glyphs): { placed: Placed[]; width: number } {
  const placed: Placed[] = [];
  let x = 0;
  for (const char of line) {
    if (char === " ") {
      x += SPACE_WIDTH;
      continue;
    }
    const letter = char.toUpperCase();
    const glyph = glyphs[letter];
    const span = glyph ? inkSpan(glyph) : null;
    if (glyph && span) {
      // Slide the letter so its leftmost ink lands SIDE_SPACE after the end of the previous letter.
      placed.push({ made: true, glyph, x: x + SIDE_SPACE - span.left });
      x += SIDE_SPACE + (span.right - span.left) + SIDE_SPACE;
    } else {
      placed.push({ made: false, char: letter, x: x + MISSING_WIDTH / 2 });
      x += MISSING_WIDTH;
    }
  }
  return { placed, width: x };
}

export default function FontPreview({ glyphs, onMake }: { glyphs: Glyphs; onMake: (letter: string) => void }) {
  const [text, setText] = useState(SAMPLE);
  const [size, setSize] = useState(64); // how tall one line is on screen, in pixels

  const lines = text.split("\n").map((line) => layOut(line, glyphs));
  const width = Math.max(1, ...lines.map((line) => line.width));
  const toMake = [...new Set(text.toUpperCase())].filter((char) => isLetter(char) && !glyphs[char]).sort();

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
      <label className="astra-preview-size">
        Size
        <input type="range" min={24} max={160} value={size} onChange={(e) => setSize(Number(e.target.value))} />
      </label>
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
                    <GlyphArt glyph={item.glyph} />
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
          Faded letters aren’t made yet:
          {toMake.map((letter) => (
            <button key={letter} type="button" onClick={() => onMake(letter)} aria-label={`Make the letter ${letter}`}>
              {letter}
            </button>
          ))}
        </p>
      )}
    </section>
  );
}
