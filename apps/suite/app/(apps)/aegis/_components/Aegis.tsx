'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import AppHeader from '@/components/AppHeader';
import { suggestionsForPrompt } from '@/lib/aegis/report';
import type { Finding, ScanReport, Severity, WrittenSuggestion } from '@/lib/aegis/types';
import Suggestions from './Suggestions';

// Aegis: enter a repo, press Scan, and read what it found. The scan itself is lib/aegis/scan.ts.

const RECENT_KEY = 'aegis-recent';
const SEVERITY_NAME: Record<Severity, string> = { high: 'High', medium: 'Medium', low: 'Low' };

function readRecent(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(list) ? list.filter((x) => typeof x === 'string').slice(0, 5) : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // private browsing: the list just isn't remembered
  }
}

/** Text with `backticks` shown as code. */
function Ticks({ text }: { text: string }) {
  const parts = text.split(/`([^`]+)`/);
  return <>{parts.map((p, i) => (i % 2 ? <code key={i}>{p}</code> : p))}</>;
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard API needs https or localhost; fall back to the old way.
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  }
}

const Section = ({ title, note, children }: { title: string; note?: string; children: ReactNode }) => (
  <section className="aegis-section">
    <h2>{title}</h2>
    {note && <p className="aegis-note">{note}</p>}
    {children}
  </section>
);

function FindingCard({ finding, n }: { finding: Finding; n: number }) {
  return (
    <article className={`aegis-finding sev-${finding.severity}`}>
      <div className="aegis-finding-head">
        <span className="aegis-num">{n}</span>
        <span className={`aegis-sev sev-${finding.severity}`}>{SEVERITY_NAME[finding.severity]}</span>
        <h3><Ticks text={finding.title} /></h3>
      </div>
      <p><strong>Why it matters.</strong> <Ticks text={finding.why} /></p>
      <ul className="aegis-evidence">
        {finding.evidence.map((e, i) => <li key={i}><Ticks text={e} /></li>)}
      </ul>
      <p><strong>Fix.</strong> <Ticks text={finding.fix} /></p>
    </article>
  );
}

export default function Aegis() {
  const [repo, setRepo] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ScanReport | null>(null);
  const [copied, setCopied] = useState(false);
  const [written, setWritten] = useState<WrittenSuggestion[]>([]);
  const reportRef = useRef<HTMLDivElement>(null);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists in the browser
  useEffect(() => setRecent(readRecent()), []);

  useEffect(() => {
    if (!scanning) return;
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 500);
    return () => clearInterval(timer);
  }, [scanning]);

  const scan = async (target = repo) => {
    const value = target.trim();
    if (!value || scanning) return;
    setRepo(value);
    setScanning(true);
    setElapsed(0);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch('/api/aegis/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repo: value }),
      });
      const data = await res.json().catch(() => ({ error: 'The server sent back something unexpected.' }));
      if (!res.ok || data.error) throw new Error(data.error ?? `The scan failed (${res.status}).`);
      setReport(data as ScanReport);
      const next = [value, ...recent.filter((r) => r !== value)].slice(0, 5);
      setRecent(next);
      saveRecent(next);
      requestAnimationFrame(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setScanning(false);
    }
  };

  // The agent prompt: the findings, then each suggestion as it's written, then what to report.
  const prompt = report
    ? [report.prompt, suggestionsForPrompt(written, report.findings.length + 1), report.promptClosing].filter(Boolean).join('\n\n')
    : '';

  const copyPrompt = async () => {
    if (report && (await copyText(prompt))) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const counts = report
    ? (['high', 'medium', 'low'] as const).map((s) => [s, report.findings.filter((f) => f.severity === s).length] as const)
    : [];

  return (
    <div className="site-container">
      <div className="content-area">
        <AppHeader appId="aegis" />
        <main className="aegis">
          <div className="aegis-intro">
            <h1>Repo scan</h1>
            <p>Finds over-engineering, redundant layers and messy organization, explains why each one matters, and writes a prompt you can hand to a coding agent to fix them.</p>
          </div>

          <form
            className="aegis-form"
            onSubmit={(e) => {
              e.preventDefault();
              scan();
            }}
          >
            <input
              className="aegis-input"
              value={repo}
              onChange={(e) => setRepo(e.target.value)}
              placeholder="C:\code\my-app, https://github.com/owner/repo, or owner/repo"
              aria-label="Repo to scan"
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              disabled={scanning}
            />
            <button className="aegis-button" type="submit" disabled={scanning || !repo.trim()}>
              {scanning ? 'Scanning…' : 'Scan'}
            </button>
          </form>
          <p className="aegis-hint">
            A folder on the computer running the suite is read in place and never changed. A link is copied in for the scan, then deleted.
          </p>
          {recent.length > 0 && !scanning && (
            <div className="aegis-recent">
              {recent.map((r) => (
                <button key={r} type="button" onClick={() => scan(r)} title={`Scan ${r} again`}>{r}</button>
              ))}
            </div>
          )}

          {scanning && (
            <p className="aegis-status" role="status">
              <span className="aegis-spinner" aria-hidden /> Scanning{elapsed >= 2 ? ` · ${elapsed}s` : ''}
              {elapsed >= 5 && ' (copying a repo from a link can take a minute)'}
            </p>
          )}
          {error && <p className="aegis-error" role="alert">{error}</p>}

          {report && !scanning && (
            <div className="aegis-report" ref={reportRef}>
              <section className="aegis-summary">
                <div>
                  <h2>{report.repo}</h2>
                  <p className="aegis-note">
                    {report.stats.files.toLocaleString()} files · {report.stats.codeFiles.toLocaleString()} code files · {report.stats.codeLines.toLocaleString()} lines of code · {report.seconds}s
                  </p>
                  {report.truncated && <p className="aegis-note">This repo is very large, so only its first 20,000 files were scanned.</p>}
                </div>
                <div className="aegis-counts">
                  {counts.map(([s, n]) => (
                    <span key={s} className={`aegis-count sev-${s}`}><b>{n}</b> {SEVERITY_NAME[s]}</span>
                  ))}
                </div>
              </section>

              <Section
                title="Findings"
                note={report.findings.length ? 'Most important first. The scan works from patterns, so check each one before acting on it.' : undefined}
              >
                {report.findings.length
                  ? report.findings.map((f, i) => <FindingCard key={i} finding={f} n={i + 1} />)
                  : <p>Nothing stood out. Nice work.</p>}
              </Section>

              <Section
                title="Suggestions"
                note="Code that does the same job in several places and could live in one. A local model reads the code and writes each one up; they're added to the AI Prompt as they finish."
              >
                <Suggestions candidates={report.suggestions} onWritten={setWritten} />
              </Section>

              {report.clean.length > 0 && (
                <Section title="Came back clean">
                  <ul className="aegis-clean">
                    {report.clean.map((c) => <li key={c}>{c}</li>)}
                  </ul>
                </Section>
              )}

              <Section title="Learning opportunities" note="The idea behind each kind of problem, so it doesn't come back.">
                <div className="aegis-lessons">
                  {report.lessons.map((l) => (
                    <article key={l.title} className="aegis-lesson">
                      <h3>{l.title}</h3>
                      <p><Ticks text={l.body} /></p>
                    </article>
                  ))}
                </div>
              </Section>

              <Section title="AI Prompt" note="Give this to a coding agent (Claude Code, Cursor, an Umbra Flicker) in the repo to make the fixes.">
                <div className="aegis-prompt">
                  <button type="button" className="aegis-button aegis-copy" onClick={copyPrompt}>
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <pre>{prompt}</pre>
                </div>
              </Section>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
