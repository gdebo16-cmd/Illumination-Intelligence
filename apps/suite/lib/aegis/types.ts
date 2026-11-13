// What an Aegis scan sends back to the page. Shared by the scanner (lib/aegis/scan.ts) and the
// page (app/(apps)/aegis), so it has no server-only imports.

export type Severity = 'high' | 'medium' | 'low';

export interface Finding {
  /** Which check found it, e.g. "duplicate-files". Learning opportunities are keyed by this. */
  kind: string;
  severity: Severity;
  title: string;
  /** Why it's a problem, in a sentence or two. */
  why: string;
  /** What the scan saw: paths, line numbers, counts. */
  evidence: string[];
  /** What to do about it. */
  fix: string;
}

export interface Lesson {
  title: string;
  body: string;
}

export interface ScanReport {
  repo: string;
  /** "folder" for a path on this computer, "git" for a link that was copied in to scan. */
  source: 'folder' | 'git';
  scannedAt: string;
  seconds: number;
  stats: { files: number; codeFiles: number; codeLines: number };
  /** True when the repo had more files than a scan reads, so only the first part was checked. */
  truncated: boolean;
  findings: Finding[];
  /** Code that does the same job in several files and could be unified (see SuggestionCandidate). */
  suggestions: SuggestionCandidate[];
  /** Checks that ran and found nothing. */
  clean: string[];
  lessons: Lesson[];
  /** Instructions for a coding agent to make the fixes. The page adds the written suggestions
   *  between `prompt` and `promptClosing` as they arrive. */
  prompt: string;
  promptClosing: string;
}

/**
 * Something the scan found that could be unified: code that does the same job in several files.
 * The scan finds it and gathers the code; a model then writes it up as a WrittenSuggestion.
 */
export interface SuggestionCandidate {
  id: string;
  /** "layout": several pages build the same frame. "lookalike": the same steps with different names. */
  kind: 'layout' | 'lookalike';
  title: string;
  files: string[];
  /** A plain description from the scan alone, shown when no model can write one. */
  summary: string;
  /** What each file does, one line each. */
  evidence: string[];
  /** Pieces that are already shared (components, hooks), with where they live. */
  shared: { name: string; path: string }[];
  /** The code the model reads: the relevant part of each file, and of each shared piece. */
  excerpts: { path: string; code: string }[];
}

export interface WrittenSuggestion {
  title: string;
  summary: string;
  alreadyShared: string[];
  repeated: { file: string; what: string }[];
  plan: string[];
  sketch: string;
  payoff: string;
  /** The model that wrote it, or "scan" for the plain version. */
  by: string;
}
