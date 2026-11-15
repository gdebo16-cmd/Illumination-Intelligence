"use client";

// Halo's Templates mode: pick a ready-made animation (lib/halo/templates.ts) and change its settings.
// Each template lists its own settings, so this one screen draws the right controls for any of them.

import { TEMPLATES, type Template, type TemplateValues } from "@/lib/halo/templates";

interface Props {
  template: Template;
  values: TemplateValues;
  onPick: (t: Template) => void;
  onChange: (id: string, value: string | number | boolean) => void;
}

export default function TemplateControls({ template, values, onPick, onChange }: Props) {
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
        {template.settings.map((s) => {
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
    </>
  );
}
