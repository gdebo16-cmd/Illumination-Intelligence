"use client";

import { useEffect, useState } from "react";
import Sidebar from "@/components/Sidebar";
import AppHeader from "@/components/AppHeader";
import SidebarToggle from "@/components/SidebarToggle";
import GlyphPad, { GlyphArt } from "./glyph-pad";
import FontPreview from "./font-preview";
import SheetImport, { type SheetLetter } from "./sheet-import";
import { EMPTY_GLYPH, GLYPH_SIZE, LETTERS, type Glyph, type Glyphs } from "@/config/astra";

// What a font looks like when it comes back from /api/astra/fonts (see lib/astra/fonts.ts).
type Font = {
  id: string;
  name: string;
  glyphs: Glyphs;
  createdAt: string;
  updatedAt: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };

const Astra = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [fonts, setFonts] = useState<Font[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(""); // what's typed in the name box right now
  const [loaded, setLoaded] = useState(false); // has the saved list arrived yet?
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // the letter open in the drawing pad
  const [savingGlyph, setSavingGlyph] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // the alphabet sheet upload

  const selected = fonts.find((font) => font.id === selectedId);

  // Pick a font, and put its name in the name box.
  const selectFont = (font: Font | undefined) => {
    setSelectedId(font?.id ?? null);
    setNameDraft(font?.name ?? "");
  };

  // When the page opens, ask for your saved fonts and open the most recent one.
  useEffect(() => {
    fetch("/api/astra/fonts", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : Promise.reject(res)))
      .then((saved: Font[]) => {
        setFonts(saved);
        setSelectedId(saved[0]?.id ?? null);
        setNameDraft(saved[0]?.name ?? "");
      })
      .catch(() => setError("Couldn't load your fonts."))
      .finally(() => setLoaded(true));
  }, []);

  const addFont = async () => {
    setError(null);
    const res = await fetch("/api/astra/fonts", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name: "Untitled" }),
    }).catch(() => null);
    if (!res?.ok) return setError("Couldn't make a new font.");
    const font: Font = await res.json();
    setFonts([font, ...fonts]); // newest goes at the top
    selectFont(font);
  };

  // Runs when you leave the name box (or press Enter in it).
  const saveName = async () => {
    if (!selected) return;
    const name = nameDraft.trim();
    if (!name || name === selected.name) return setNameDraft(selected.name); // blank or unchanged: put it back
    setError(null);
    const res = await fetch(`/api/astra/fonts/${selected.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ name }),
    }).catch(() => null);
    if (!res?.ok) {
      setNameDraft(selected.name);
      return setError("Couldn't rename the font.");
    }
    const renamed: Font = await res.json();
    setFonts(fonts.map((font) => (font.id === renamed.id ? renamed : font)));
    setNameDraft(renamed.name);
  };

  // Save the letter made in the pad. The pad stays open if saving fails, so the drawing isn't lost.
  const saveGlyph = async (letter: string, glyph: Glyph) => {
    if (!selected) return;
    setError(null);
    setSavingGlyph(true);
    const res = await fetch(`/api/astra/fonts/${selected.id}/glyphs/${letter}`, {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(glyph),
    }).catch(() => null);
    setSavingGlyph(false);
    if (!res?.ok) return setError(`Couldn't save the letter ${letter}.`);
    const updated: Font = await res.json();
    setFonts(fonts.map((font) => (font.id === updated.id ? updated : font)));
    setEditing(null);
  };

  // Save the letters from an alphabet sheet, one at a time. Each replaces that whole letter.
  // Gives an error message if one fails (the ones before it are already saved), or null.
  const saveSheet = async (letters: SheetLetter[]): Promise<string | null> => {
    if (!selected) return "No font is open.";
    let latest: Font | null = null;
    let failed: string | null = null;
    for (const { letter, shapes } of letters) {
      const res = await fetch(`/api/astra/fonts/${selected.id}/glyphs/${letter}`, {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ strokes: [], shapes }),
      }).catch(() => null);
      if (!res?.ok) {
        failed = `Couldn't save the letter ${letter}. The letters before it were saved.`;
        break;
      }
      latest = await res.json();
    }
    const saved = latest;
    if (saved) setFonts((all) => all.map((font) => (font.id === saved.id ? saved : font)));
    return failed;
  };

  const removeFont = async (font: Font) => {
    if (!window.confirm(`Delete "${font.name}"? This can't be undone.`)) return;
    setError(null);
    const res = await fetch(`/api/astra/fonts/${font.id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return setError("Couldn't delete the font.");
    const rest = fonts.filter((f) => f.id !== font.id);
    setFonts(rest);
    if (font.id === selectedId) selectFont(rest[0]); // deleted the open one: open the next
  };

  return (
    <div className={`site-container ${sidebarOpen ? "sidebar-open" : ""}`}>
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} title="Fonts" className="astra-sidebar">
        <div className="astra-sidebar-content">
          <button type="button" className="new-chat-button" onClick={addFont}>
            + New font
          </button>
          <span className="sidebar-separator">Your fonts</span>
          <div className="chat-list">
            {fonts.map((font) => (
              <div key={font.id} className={`chat-row ${font.id === selectedId ? "is-current" : ""}`}>
                <button
                  type="button"
                  className="chat-button"
                  aria-current={font.id === selectedId}
                  onClick={() => selectFont(font)}
                >
                  {font.name}
                </button>
                <button
                  type="button"
                  className="chat-delete"
                  aria-label={`Delete font: ${font.name}`}
                  title="Delete font"
                  onClick={() => removeFont(font)}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </Sidebar>
      <div className="content-area">
        <AppHeader
          appId="astra"
          left={<SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen(!sidebarOpen)} label="font list" />}
        />
        <main className="astra">
          {error && <p className="astra-error" role="alert">{error}</p>}
          {selected ? (
            <>
              <input
                className="astra-name"
                aria-label="Font name"
                value={nameDraft}
                maxLength={60}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={saveName}
                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              />
              <div className="astra-actions">
                <button type="button" className="astra-action" onClick={() => setSheetOpen(true)}>
                  Upload alphabet sheet
                </button>
                {Object.keys(selected.glyphs).length > 0 ? (
                  <a className="astra-action" href={`/api/astra/fonts/${selected.id}/download`} download>
                    Download font (.ttf)
                  </a>
                ) : (
                  <span className="astra-action is-disabled" title="Make at least one letter first">
                    Download font (.ttf)
                  </span>
                )}
              </div>
              <div className="astra-glyph-grid">
                {LETTERS.map((letter) => {
                  const glyph = selected.glyphs[letter];
                  return (
                    <button
                      key={letter}
                      type="button"
                      className={`astra-glyph-slot ${glyph ? "is-drawn" : ""}`}
                      aria-label={glyph ? `Redo ${letter}` : `Make ${letter}`}
                      onClick={() => setEditing(letter)}
                    >
                      {glyph ? (
                        <svg className="astra-glyph-art" viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
                          <GlyphArt glyph={glyph} />
                        </svg>
                      ) : (
                        letter
                      )}
                      {glyph && <span className="astra-glyph-label">{letter}</span>}
                    </button>
                  );
                })}
              </div>
              <FontPreview glyphs={selected.glyphs} onMake={setEditing} />
              {sheetOpen && (
                <SheetImport
                  key={selected.id}
                  glyphs={selected.glyphs}
                  onSave={saveSheet}
                  onClose={() => setSheetOpen(false)}
                />
              )}
              {editing && (
                <GlyphPad
                  key={`${selected.id}-${editing}`}
                  letter={editing}
                  initial={selected.glyphs[editing] ?? EMPTY_GLYPH}
                  saving={savingGlyph}
                  onSave={(glyph) => saveGlyph(editing, glyph)}
                  onCancel={() => setEditing(null)}
                />
              )}
            </>
          ) : (
            loaded && <p className="astra-empty">Create a font to get started.</p>
          )}
        </main>
      </div>
    </div>
  );
};

export default Astra;