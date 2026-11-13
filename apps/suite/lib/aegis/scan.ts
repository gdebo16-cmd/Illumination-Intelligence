// lib/aegis/scan.ts — Aegis's scan, start to finish: open the repo, list its files, run every
// check, and write the report.

import 'server-only';
import { checkCss, checkDumpingGrounds, checkDuplicateFiles, checkLargeFiles, checkMissingRoutes, checkNaming, checkRepeatedCode, checkSchema, checkStaleDocs, checkUnusedAssets } from './checks';
import { CODE_EXTS, listFiles, type RepoFile } from './files';
import { buildGraph, checkCycles, checkOrphans, checkPassThrough, checkUnusedExports, type ImportGraph } from './imports';
import { openRepo } from './repo';
import { buildPrompt, lessonsFor } from './report';
import { findSuggestions } from './suggest';
import type { Finding, ScanReport } from './types';

/** Every check, with the line shown under "came back clean" when it finds nothing. */
const CHECKS: { clean: string; run: (files: RepoFile[], graph: ImportGraph) => Finding[] }[] = [
  { clean: 'No byte-identical copies of files', run: checkDuplicateFiles },
  { clean: 'No unused folders, pictures, videos or fonts', run: checkUnusedAssets },
  { clean: 'Every file path in the docs exists', run: checkStaleDocs },
  { clean: 'No stylesheets overriding themselves', run: checkCss },
  { clean: 'No code files over 600 lines', run: checkLargeFiles },
  { clean: 'No snippets pasted into many files', run: checkRepeatedCode },
  { clean: 'No files that import each other in a loop', run: (_f, g) => checkCycles(g) },
  { clean: 'Every code file is imported or is an entry point', run: (f, g) => checkOrphans(g, f) },
  { clean: 'No exports that nothing uses', run: (f, g) => checkUnusedExports(g, f) },
  { clean: 'Every API address the code calls has a route', run: checkMissingRoutes },
  { clean: 'No modules passing another module\'s names through', run: (_f, g) => checkPassThrough(g) },
  { clean: 'Names are consistent', run: checkNaming },
  { clean: 'No overgrown catch-all folders', run: checkDumpingGrounds },
  { clean: 'Database tables are defined in one place', run: checkSchema },
];

const RANK = { high: 0, medium: 1, low: 2 } as const;

export async function scanRepo(input: unknown): Promise<ScanReport> {
  const started = Date.now();
  const repo = await openRepo(input);
  try {
    const { files, truncated } = await listFiles(repo.dir);
    const graph = buildGraph(files);
    const findings: Finding[] = [];
    const clean: string[] = [];
    for (const check of CHECKS) {
      let found: Finding[];
      try {
        found = check.run(files, graph);
      } catch (err) {
        // One broken check shouldn't sink the whole scan.
        console.error(`Aegis: the "${check.clean}" check failed:`, err);
        continue;
      }
      if (found.length) findings.push(...found);
      else clean.push(check.clean);
    }
    findings.sort((a, b) => RANK[a.severity] - RANK[b.severity]);
    const suggestions = findSuggestions(files, graph);
    const prompt = buildPrompt(repo.name, findings, files, suggestions.length > 0);

    const code = files.filter((f) => CODE_EXTS.has(f.ext) && f.text !== undefined);
    return {
      repo: repo.name,
      source: repo.source,
      scannedAt: new Date().toISOString(),
      seconds: Math.round((Date.now() - started) / 100) / 10,
      stats: {
        files: files.length,
        codeFiles: code.length,
        codeLines: code.reduce((n, f) => n + f.text!.split('\n').length, 0),
      },
      truncated,
      findings,
      suggestions,
      clean,
      lessons: lessonsFor(findings, suggestions.length > 0),
      prompt: prompt.body,
      promptClosing: prompt.closing,
    };
  } finally {
    await repo.close();
  }
}
