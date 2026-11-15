"use client";

// Halo's Templates mode: pick a ready-made animation (lib/halo/templates.ts) and change its settings.
// Each template lists its own settings and parts, so this one screen draws the right controls for
// any of them, including the Layers panel (the same options for every part).

import {
  DEFAULT_LAYER,
  partsOf,
  settingShown,
  TEMPLATES,
  type LayerOptions,
  type Template,
  type TemplateLayers,
  type TemplateValues,
} from "@/lib/halo/templates";

interface Props {
  template: Template;
  values: TemplateValues;
  layers: TemplateLayers;
  onPick: (t: Template) => void;
  onChange: (id: string, value: string | number | boolean) => void;
  onLayerChange: (partId: string, change: Partial<LayerOptions>) => void;
}

export default function TemplateControls({ template, values, layers, onPick, onChange, onLayerChange }: Props) {
  return (
    <>
      <section className="halo-panel" aria-label="Template">
        <h2>Template</h2>
        <div className="halo-templates">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              type="button"
              className={`halo-template ${t.id === template.id ? "is-current" : ""}`}
              aria-pressed={t.id === template.id}
              onClick={() => onPick(t)}
            >
              <strong>{t.name}</strong>
              <span>{t.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="halo-panel" aria-label="Settings">
        <h2>Settings</h2>
        {template.settings.filter((s) => settingShown(template, s, values)).map((s) => {
          const value = values[s.id] ?? s.default;
          if (s.kind === "color")
            return (
              <label key={s.id} className="halo-row">
                {s.label}
                <input type="color" value={String(value)} onChange={(e) => onChange(s.id, e.target.value)} />
              </label>
            );
          if (s.kind === "toggle")
            return (
              <label key={s.id} className="halo-row">
                <input type="checkbox" checked={Boolean(value)} onChange={(e) => onChange(s.id, e.target.checked)} />
                {s.label}
              </label>
            );
          if (s.kind === "choice")
            return (
              <label key={s.id} className="halo-row">
                {s.label}
                <select value={String(value)} onChange={(e) => onChange(s.id, e.target.value)}>
                  {s.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
            );
          return (
            <label key={s.id} className="halo-row">
              {s.label}
              <input
                type="range"
                min={s.min}
                max={s.max}
                step={s.step}
                value={Number(value)}
                onChange={(e) => onChange(s.id, Number(e.target.value))}
              />
              <span>
                {Number(value)}
                {s.unit ? ` ${s.unit}` : ""}
              </span>
            </label>
          );
        })}
        <p className="halo-note">{template.howToUse}</p>
      </section>

      <section className="halo-panel" aria-label="Layers">
        <h2>Layers</h2>
        <p className="halo-help">Each part of the template, top to bottom. Untick one to hide it.</p>
        {partsOf(template, values).map((p) => {
          const o = { ...DEFAULT_LAYER, ...layers[p.id] };
          return (
            <div key={p.id} className={`halo-layer ${o.visible ? "" : "is-hidden"}`}>
              <label className="halo-layer-name">
                <input type="checkbox" checked={o.visible} onChange={(e) => onLayerChange(p.id, { visible: e.target.checked })} />
                {p.name}
              </label>
              {o.visible && (
                <div className="halo-layer-options">
                  <label>
                    Solid
                    <input
                      type="range"
                      min={0}
                      max={100}
                      step={5}
                      value={o.opacity}
                      aria-label={`${p.name}: how solid`}
                      onChange={(e) => onLayerChange(p.id, { opacity: Number(e.target.value) })}
                    />
                    <span>{o.opacity}%</span>
                  </label>
                  {p.canShade && (
                    <label>
                      <input
                        type="checkbox"
                        checked={o.shade !== null}
                        onChange={(e) => onLayerChange(p.id, { shade: e.target.checked ? "#000000" : null })}
                      />
                      Shading to
                      <input
                        type="color"
                        value={o.shade ?? "#000000"}
                        disabled={o.shade === null}
                        aria-label={`${p.name}: shading colour`}
                        onChange={(e) => onLayerChange(p.id, { shade: e.target.value })}
                      />
                    </label>
                  )}
                  {p.canOutline && (
                    <label>
                      <input
                        type="checkbox"
                        checked={o.outline !== null}
                        onChange={(e) => onLayerChange(p.id, { outline: e.target.checked ? { color: "#000000", width: 4 } : null })}
                      />
                      Outline
                      <input
                        type="color"
                        value={o.outline?.color ?? "#000000"}
                        disabled={!o.outline}
                        aria-label={`${p.name}: outline colour`}
                        onChange={(e) => o.outline && onLayerChange(p.id, { outline: { ...o.outline, color: e.target.value } })}
                      />
                      <input
                        type="range"
                        min={1}
                        max={16}
                        step={1}
                        value={o.outline?.width ?? 4}
                        disabled={!o.outline}
                        aria-label={`${p.name}: outline thickness`}
                        onChange={(e) => o.outline && onLayerChange(p.id, { outline: { ...o.outline, width: Number(e.target.value) } })}
                      />
                    </label>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </>
  );
}
