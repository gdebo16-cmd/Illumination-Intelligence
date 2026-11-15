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
import { buildLottie, MAX_INNER_LAYERS, type InnerLayer, type MoveSetting } from "@/lib/halo/lottie";
import type { DescribedAnimation, DescribedShape } from "@/lib/halo/describe";
import {
  defaultValues,
  TEMPLATES,
  type LayerOptions,
  type Template,
  type TemplateLayers,
  type TemplateValues,
} from "@/lib/halo/templates";

const NO_LAYERS: TemplateLayers = {}; // one shared empty object, so the preview doesn't restart for nothing
import TemplateControls from "./TemplateControls";

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
  const [shade, setShade] = useState<string | null>(null); // the second colour for shading, or none
  const [outline, setOutline] = useState<{ color: string; width: number } | null>(null);
  const [inner, setInner] = useState<InnerLayer[]>([]);
  // Templates mode: which one, and each template's settings (kept, so switching back keeps your changes).
  const [mode, setMode] = useState<"shape" | "template">("shape");
  const [template, setTemplate] = useState<Template>(TEMPLATES[0]);
  const [templateValues, setTemplateValues] = useState<Record<string, TemplateValues>>({});
  const [templateLayers, setTemplateLayers] = useState<Record<string, TemplateLayers>>({});
  const currentLayers = templateLayers[template.id] ?? NO_LAYERS;
  // useMemo so the defaults are the same object each time; a new one would restart the preview.
  const currentValues = useMemo(() => templateValues[template.id] ?? defaultValues(template), [templateValues, template]);
  const [error, setError] = useState<string | null>(null);
  const [description, setDescription] = useState("");
  const [describing, setDescribing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const paths = useMemo(() => {
    if (shapeId === "upload" && upload) return upload.paths;
    const shape = START_SHAPES.find((s) => s.id === shapeId) ?? START_SHAPES[0];
    return parsePath(shape.d).paths;
  }, [shapeId, upload]);

  const animation = useMemo(
    () =>
      mode === "template"
        ? template.build(currentValues, name.trim() || template.name, currentLayers)
        : buildLottie({ name: name.trim() || "Halo animation", paths, color, moves, seconds, pivot, shade, outline, inner }),
    [mode, template, currentValues, currentLayers, name, paths, color, moves, seconds, pivot, shade, outline, inner],
  );

  const pickMode = (next: "shape" | "template") => {
    if (next === mode) return;
    setMode(next);
    setError(null);
    setName(next === "template" ? template.name : (START_SHAPES.find((s) => s.id === shapeId)?.name ?? upload?.name ?? "Halo animation"));
  };
  const pickTemplate = (t: Template) => {
    setTemplate(t);
    setName(t.name);
  };
  const changeLayer = (partId: string, change: Partial<LayerOptions>) =>
    setTemplateLayers((all) => {
      const mine = all[template.id] ?? {};
      return { ...all, [template.id]: { ...mine, [partId]: { ...mine[partId], ...change } as LayerOptions } };
    });
  const changeTemplateValue = (id: string, value: string | number | boolean) =>
    setTemplateValues((all) => ({ ...all, [template.id]: { ...(all[template.id] ?? defaultValues(template)), [id]: value } }));

  const changeMove = (id: string, change: Partial<MoveSetting>) =>
    setMoves((all) => ({ ...all, [id]: { ...all[id], ...change } }));

  const changeInner = (n: number, change: Partial<InnerLayer>) =>
    setInner((all) => all.map((layer, k) => (k === n ? { ...layer, ...change } : layer)));
  // Each new layer is smaller and lighter than the one before, so the default already looks layered.
  const addInner = () =>
    setInner((all) =>
      all.length >= MAX_INNER_LAYERS
        ? all
        : [...all, { color: ["#ffd04a", "#fff3b0", "#ffffff"][all.length], size: [0.65, 0.4, 0.2][all.length], lively: 0.4 }],
    );

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

  // Describe it: the local model picks a shape or a template from the same menus as the controls,
  // then we set them (and switch to the right mode).
  const describe = async () => {
    const text = description.trim();
    if (!text || describing) return;
    setDescribing(true);
    setError(null);
    try {
      const res = await fetch("/api/halo/describe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: text }),
      });
      const data = (await res.json().catch(() => ({}))) as Partial<DescribedAnimation> & { error?: string };
      if (!res.ok || !data.kind) throw new Error(data.error ?? "Something went wrong. Try again.");
      if (data.kind === "template") {
        const picked = TEMPLATES.find((t) => t.id === data.template);
        if (!picked || !data.values) throw new Error("Something went wrong. Try again.");
        setTemplate(picked);
        setTemplateValues((all) => ({ ...all, [picked.id]: data.values! }));
        setMode("template");
        setName(data.name ?? picked.name);
        return;
      }
      const shapeAnswer = data as Partial<DescribedShape>;
      const picked = new Map((shapeAnswer.moves ?? []).map((m) => [m.id, m.strength]));
      setMoves(
        Object.fromEntries(
          MOVES.map((m) => [m.id, { on: picked.has(m.id), strength: picked.get(m.id) ?? 0.5 }]),
        ),
      );
      setMode("shape");
      if (shapeAnswer.shape) setShapeId(shapeAnswer.shape);
      if (shapeAnswer.name) setName(shapeAnswer.name);
      if (shapeAnswer.color) setColor(shapeAnswer.color);
      if (shapeAnswer.seconds) setSeconds(shapeAnswer.seconds);
      if (shapeAnswer.pivot) setPivot(shapeAnswer.pivot);
      setShade(shapeAnswer.shade ?? null);
      setOutline(shapeAnswer.outline ? { color: shapeAnswer.outline, width: outline?.width ?? 6 } : null);
      setInner(shapeAnswer.inner ?? []);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDescribing(false);
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
          <section className="halo-panel" aria-label="Describe it">
            <h2>Describe it</h2>
            <p className="halo-help">Say what you want, and AI picks a shape or a template and sets it up for you. You can change it after.</p>
            <form
              className="halo-describe"
              onSubmit={(e) => {
                e.preventDefault();
                void describe();
              }}
            >
              <textarea
                aria-label="Describe the animation"
                placeholder="A candle flame that flickers, or a green toggle switch"
                rows={2}
                maxLength={400}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void describe();
                  }
                }}
              />
              <button type="submit" className="halo-action" disabled={describing || !description.trim()}>
                {describing ? "Thinking…" : "Set it up"}
              </button>
            </form>
          </section>

          <div className="halo-modes" role="group" aria-label="What to make">
            <button type="button" aria-pressed={mode === "shape"} className={mode === "shape" ? "is-current" : ""} onClick={() => pickMode("shape")}>
              From a shape
            </button>
            <button type="button" aria-pressed={mode === "template"} className={mode === "template" ? "is-current" : ""} onClick={() => pickMode("template")}>
              Templates
            </button>
          </div>

          {error && <p className="halo-error" role="alert">{error}</p>}

          {mode === "template" && (
            <TemplateControls
              template={template}
              values={currentValues}
              layers={currentLayers}
              onPick={pickTemplate}
              onChange={changeTemplateValue}
              onLayerChange={changeLayer}
            />
          )}

          {mode === "shape" && (<>

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

          <section className="halo-panel" aria-label="Detail">
            <h2>Detail</h2>
            <label className="halo-row">
              <input type="checkbox" checked={shade !== null} onChange={(e) => setShade(e.target.checked ? "#c2410c" : null)} />
              Shading: fades from the colour above at the top to
              <input type="color" value={shade ?? "#c2410c"} disabled={shade === null} onChange={(e) => setShade(e.target.value)} />
              at the bottom
            </label>
            <label className="halo-row">
              <input
                type="checkbox"
                checked={outline !== null}
                onChange={(e) => setOutline(e.target.checked ? { color: "#5a1d05", width: 6 } : null)}
              />
              Outline
              <input
                type="color"
                value={outline?.color ?? "#5a1d05"}
                disabled={!outline}
                onChange={(e) => outline && setOutline({ ...outline, color: e.target.value })}
              />
              <input
                type="range"
                min={2}
                max={20}
                step={1}
                value={outline?.width ?? 6}
                disabled={!outline}
                aria-label="Outline thickness"
                onChange={(e) => outline && setOutline({ ...outline, width: Number(e.target.value) })}
              />
            </label>

            <h3 className="halo-subhead">Inner layers</h3>
            <p className="halo-help">Smaller copies on top, like the yellow inside a flame. Lively ones move more than the outside.</p>
            {inner.map((layer, n) => (
              <div key={n} className="halo-inner">
                <input
                  type="color"
                  value={layer.color}
                  aria-label={`Inner layer ${n + 1} colour`}
                  onChange={(e) => changeInner(n, { color: e.target.value })}
                />
                <label>
                  Size
                  <input
                    type="range"
                    min={0.2}
                    max={0.9}
                    step={0.05}
                    value={layer.size}
                    onChange={(e) => changeInner(n, { size: Number(e.target.value) })}
                  />
                </label>
                <label>
                  Lively
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={layer.lively}
                    onChange={(e) => changeInner(n, { lively: Number(e.target.value) })}
                  />
                </label>
                <button
                  type="button"
                  className="halo-remove"
                  aria-label={`Remove inner layer ${n + 1}`}
                  onClick={() => setInner((all) => all.filter((_, k) => k !== n))}
                >
                  ×
                </button>
              </div>
            ))}
            {inner.length < MAX_INNER_LAYERS && (
              <button type="button" className="halo-action" onClick={addInner}>
                + Add inner layer
              </button>
            )}
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
          </>)}
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
