"use client";

import { useEffect, useRef, useState } from "react";
import AppShell from "@/components/AppShell";
import useSidebar from "@/hooks/use-sidebar";
import GlyphPad, { GlyphArt } from "./GlyphPad";
import FontPreview from "./FontPreview";
import SheetImport, { type SheetLetter } from "./SheetImport";
import AiAlphabet from "./AiAlphabet";
import {
  CHARACTER_GROUPS,
  EMPTY_GLYPH,
  GLYPH_SIZE,
  MAX_PEN_WIDTH,
  MIN_PEN_WIDTH,
  type Glyph,
  type Glyphs,
} from "@/config/astra";

// What a font looks like when it comes back from /api/astra/fonts (see lib/astra/fonts.ts).
type Font = {
  id: string;
  name: string;
  glyphs: Glyphs;
  penWidth: number;
  createdAt: string;
  updatedAt: string;
};

const JSON_HEADERS = { "Content-Type": "application/json" };
/** The address for saving one character: its number, so characters like / ? # are safe in a web address. */
const glyphUrl = (fontId: string, char: string) => `/api/astra/fonts/${fontId}/glyphs/${char.codePointAt(0)}`;

const Astra = () => {
  const panel = useSidebar();
  const [fonts, setFonts] = useState<Font[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(""); // what's typed in the name box right now
  const [loaded, setLoaded] = useState(false); // has the saved list arrived yet?
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null); // the character open in the drawing pad
  const [savingGlyph, setSavingGlyph] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false); // the sheet upload
  const [aiOpen, setAiOpen] = useState(false); // making characters with AI
  const penTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    setFonts((all) => all.map((font) => (font.id === renamed.id ? { ...renamed, penWidth: font.penWidth } : font)));
    setNameDraft(renamed.name);
  };

  // Save the character made in the pad. The pad stays open if saving fails, so the drawing isn't lost.
  const saveGlyph = async (letter: string, glyph: Glyph) => {
    if (!selected) return;
    setError(null);
    setSavingGlyph(true);
    const res = await fetch(glyphUrl(selected.id, letter), {
      method: "PUT",
      headers: JSON_HEADERS,
      body: JSON.stringify(glyph),
    }).catch(() => null);
    setSavingGlyph(false);
    if (!res?.ok) return setError(`Couldn't save ${letter}.`);
    const updated: Font = await res.json();
    // Keep the pen thickness shown here: a change to it may still be on its way to the server.
    setFonts((all) => all.map((font) => (font.id === updated.id ? { ...updated, penWidth: font.penWidth } : font)));
    setEditing(null);
  };

  // Save characters from a sheet or from AI, one at a time. Each replaces that whole character.
  // Gives an error message if one fails (the ones before it are already saved), or null.
  const saveSheet = async (letters: SheetLetter[]): Promise<string | null> => {
    if (!selected) return "No font is open.";
    let latest: Font | null = null;
    let failed: string | null = null;
    for (const { letter, shapes } of letters) {
      const res = await fetch(glyphUrl(selected.id, letter), {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({ strokes: [], shapes }),
      }).catch(() => null);
      if (!res?.ok) {
        failed = `Couldn't save ${letter}. The ones before it were saved.`;
        break;
      }
      latest = await res.json();
    }
    const saved = latest;
    if (saved) setFonts((all) => all.map((font) => (font.id === saved.id ? { ...saved, penWidth: font.penWidth } : font)));
    return failed;
  };

  // The pen thickness slider: show the change straight away, save it once you stop moving it.
  const changePen = (penWidth: number) => {
    if (!selected) return;
    const id = selected.id;
    setFonts((all) => all.map((font) => (font.id === id ? { ...font, penWidth } : font)));
    if (penTimer.current) clearTimeout(penTimer.current);
    penTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/astra/fonts/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: JSON.stringify({ penWidth }),
      }).catch(() => null);
      if (!res?.ok) setError("Couldn't save the pen thickness.");
    }, 400);
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

  const fontList = (
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
              onClick={() => {
                selectFont(font);
                panel.closeOnPhone();
              }}
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
  );

  return (
    <AppShell
      appId="astra"
      sidebar={{ panel, title: "Fonts", label: "font list", className: "astra-sidebar", content: fontList }}
    >
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
                Upload a sheet
              </button>
              <button type="button" className="astra-action" onClick={() => setAiOpen(true)}>
                Make with AI
              </button>
              {Object.keys(selected.glyphs).length > 0 ? (
                <DownloadFontButton fontId={selected.id} name={selected.name} updatedAt={selected.updatedAt} />
              ) : (
                <span className="astra-action is-disabled" title="Make at least one character first">
                  Download font (.ttf)
                </span>
              )}
              <label className="astra-pen" title="How thick drawn pen strokes are, in every character of this font">
                Pen thickness
                <input
                  type="range"
                  min={MIN_PEN_WIDTH}
                  max={MAX_PEN_WIDTH}
                  step={5}
                  value={selected.penWidth}
                  onChange={(e) => changePen(Number(e.target.value))}
                />
                <svg viewBox="0 0 200 40" aria-hidden="true">
                  <line x1={20} y1={20} x2={180} y2={20} stroke="currentColor" strokeLinecap="round" strokeWidth={selected.penWidth / 5} />
                </svg>
              </label>
            </div>
            {CHARACTER_GROUPS.map((group) => (
              <section key={group.id} className="astra-group" aria-label={group.name}>
                <h2>
                  {group.name}
                  <span>
                    {group.characters.filter((char) => selected.glyphs[char]).length} of {group.characters.length}
                  </span>
                </h2>
                <div className="astra-glyph-grid">
                  {group.characters.map((char) => {
                    const glyph = selected.glyphs[char];
                    return (
                      <button
                        key={char}
                        type="button"
                        className={`astra-glyph-slot ${glyph ? "is-drawn" : ""}`}
                        aria-label={glyph ? `Redo ${char}` : `Make ${char}`}
                        onClick={() => setEditing(char)}
                      >
                        {glyph ? (
                          <svg className="astra-glyph-art" viewBox={`0 0 ${GLYPH_SIZE} ${GLYPH_SIZE}`} aria-hidden="true">
                            <GlyphArt glyph={glyph} penWidth={selected.penWidth} />
                          </svg>
                        ) : (
                          char
                        )}
                        {glyph && <span className="astra-glyph-label">{char}</span>}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
            <FontPreview glyphs={selected.glyphs} penWidth={selected.penWidth} onMake={setEditing} />
            {sheetOpen && (
              <SheetImport
                key={selected.id}
                glyphs={selected.glyphs}
                onSave={saveSheet}
                onClose={() => setSheetOpen(false)}
              />
            )}
            {aiOpen && (
              <AiAlphabet
                key={selected.id}
                glyphs={selected.glyphs}
                onSave={saveSheet}
                onClose={() => setAiOpen(false)}
              />
            )}
            {editing && (
              <GlyphPad
                key={`${selected.id}-${editing}`}
                letter={editing}
                initial={selected.glyphs[editing] ?? EMPTY_GLYPH}
                penWidth={selected.penWidth}
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
    </AppShell>
  );
};

export default Astra;

// "Download font" on a phone opens the share sheet, so closing it leaves you in Astra.
// (A plain download link in the Home Screen app opens a full-screen viewer with no way back.)
// On a computer it downloads the .ttf file like before. The file is fetched as soon as the
// button is shown, so the share sheet can open right on the tap. updatedAt is in the
// dependencies so a newly drawn character is in the file you get.
function shareableFile(blob: Blob, fileName: string): { file: File; canShare: boolean } {
  const asFont = new File([blob], fileName, { type: blob.type || "font/ttf" });
  const asBytes = new File([blob], fileName, { type: "application/octet-stream" });
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [asFont] })) {
    return { file: asFont, canShare: true };
  }
  if (typeof navigator.canShare === "function" && navigator.canShare({ files: [asBytes] })) {
    return { file: asBytes, canShare: true };
  }
  return { file: asFont, canShare: false };
}

function DownloadFontButton({
  fontId,
  name,
  updatedAt,
}: {
  fontId: string;
  name: string;
  updatedAt: string;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [canShare, setCanShare] = useState(false);
  const [saving, setSaving] = useState(false);
  const url = `/api/astra/fonts/${fontId}/download`;
  const fileName = `${name.replace(/[/\\?%*:|"<>]/g, "").trim() || "Astra font"}.ttf`;

  const requestKey = `${url}|${fileName}|${updatedAt}`;
  const [activeKey, setActiveKey] = useState(requestKey);
  if (activeKey !== requestKey) {
    setActiveKey(requestKey);
    setFile(null);
    setCanShare(false);
  }

  useEffect(() => {
    let live = true;
    fetch(url, { cache: "no-store" })
      .then((res) => (res.ok ? res.blob() : Promise.reject(new Error(String(res.status)))))
      .then((blob) => {
        if (!live) return;
        const ready = shareableFile(blob, fileName);
        setFile(ready.file);
        setCanShare(ready.canShare);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [url, fileName, updatedAt]);

  const download = (href: string) => {
    const a = document.createElement("a");
    a.href = href;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const save = async () => {
    setSaving(true);
    try {
      let ready = file;
      let share = canShare;
      if (!ready) {
        const res = await fetch(url, { cache: "no-store" });
        if (!res.ok) return;
        const got = shareableFile(await res.blob(), fileName);
        ready = got.file;
        share = got.canShare;
        setFile(got.file);
        setCanShare(got.canShare);
      }
      if (ready && share) {
        try {
          await navigator.share({ files: [ready] });
        } catch (err) {
          // Closing the share sheet isn't an error.
          if ((err as Error).name !== "AbortError") {
            const href = URL.createObjectURL(ready);
            download(href);
            setTimeout(() => URL.revokeObjectURL(href), 10_000);
          }
        }
        return;
      }
      if (ready) {
        const href = URL.createObjectURL(ready);
        download(href);
        setTimeout(() => URL.revokeObjectURL(href), 10_000);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <button type="button" className="astra-action" onClick={() => void save()} disabled={saving}>
      {canShare ? "Share font (.ttf)" : "Download font (.ttf)"}
    </button>
  );
}
