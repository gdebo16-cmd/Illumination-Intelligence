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
  /** Checks that ran and found nothing. */
  clean: string[];
  lessons: Lesson[];
  /** Instructions for a coding agent to make the fixes. */
  prompt: string;
}
