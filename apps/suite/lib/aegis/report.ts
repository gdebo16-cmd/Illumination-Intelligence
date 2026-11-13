// lib/aegis/report.ts — the parts of a scan report written from the findings: the learning
// opportunities (the idea behind each kind of problem, so it doesn't come back) and the prompt
// you hand to a coding agent to make the fixes.

import type { RepoFile } from './files';
import type { Finding, Lesson } from './types';

const LESSONS: Record<string, Lesson> = {
  'duplicate-files': {
    title: 'One source of truth',
    body: "Whenever the same thing lives in two places, one of them will eventually be wrong. Before copying a file, ask whether the second place can point at the first instead: an import, a shared folder, or a build step that copies it for you.",
  },
  'unused-folders': {
    title: 'Git is your archive',
    body: "Keeping an old version \"just in case\" feels safe, but git already keeps every version you ever committed. Folders of old experiments make the project look bigger than it is, and everyone (people and agents) has to work out whether they matter. Delete them, and recover them from history if you ever need to.",
  },
  'not-a-package': {
    title: 'A folder\'s address is a promise',
    body: "Where a folder sits tells people what it is. packages/ says \"installable and shared\", lib/ says \"code the app calls\". When the address and the contents disagree, people make wrong assumptions. Put files where their location tells the truth about them.",
  },
  'unused-assets': {
    title: 'Make references searchable',
    body: "Files you can't search for are files nobody dares delete. Paths built from variables (`/icons/${name}.png`) are handy but hide which files are used. Where you can, list the real names in one place (a config file or a map) so a search for the name finds both the file and its user.",
  },
  'stale-docs': {
    title: 'Docs change with the code',
    body: "A doc that's wrong is worse than no doc, because people trust it. The fix is a habit: when a change moves or renames files, update the docs that mention them in the same commit. Shorter docs that point at code stay true longer than long ones that describe it.",
  },
  'css-overrides': {
    title: 'Edit the rule, don\'t add a new one',
    body: "In CSS the later rule wins, so it's tempting to fix a style by adding an override at the bottom. Each one works on its own, but together they make the file impossible to reason about. Find the original rule and change it. Splitting styles by feature keeps each rule's home obvious.",
  },
  'large-files': {
    title: 'One reason to change',
    body: "A good file has one job, so it only changes when that job changes. Long files usually mix several jobs: data loading, display, helpers. Splitting along those lines makes each part easier to read, test and hand to a coding agent, which works best on small, focused files.",
  },
  'repeated-code': {
    title: 'The rule of three',
    body: "Writing something twice is fine. Writing it a third time is the moment to make a helper. Before that you don't yet know what the common shape is; after it, every copy is another place for a bug fix to be missed.",
  },
  'naming': {
    title: 'Names are the map',
    body: "Most of the time spent in code is spent finding things, and names are how we find them. One convention per kind of thing (one way to name folders, one way to name component files) means nobody has to remember exceptions. Two files whose names differ by one letter should say how they differ.",
  },
  'dumping-ground': {
    title: 'Organize by feature, not by kind',
    body: '"utils", "helpers" and "common" sort code by what it is rather than what it\'s for, so they end up holding everything. Keeping code next to the feature that uses it means deleting or changing a feature touches one folder.',
  },
  'scattered-schema': {
    title: 'Keep the data model in one place',
    body: "The database is the part of an app that's hardest to change later, so it deserves one place where you can see all of it. When tables are created in whichever file first needed them, changes to the data model get made without the full picture.",
  },
  'import-cycles': {
    title: 'Dependencies point one way',
    body: "Healthy code has layers: pages use features, features use shared helpers, and helpers don't reach back up. When two files import each other, they've become one module split across two files. The usual fix is to pull out what they share into a third file both can use.",
  },
  'orphan-files': {
    title: 'Dead code isn\'t free',
    body: "Unused code still shows up in searches, still gets updated when its neighbours change, and still confuses whoever finds it. If nothing uses it, delete it. Git remembers it if you ever need it back.",
  },
  'unused-exports': {
    title: 'Keep the surface small',
    body: "Everything a module exports is something other code might rely on, so it becomes harder to change. Export only what other files actually use. Smaller surfaces are easier to understand and safer to refactor.",
  },
  'pass-through': {
    title: 'Every layer has to earn its place',
    body: "A wrapper that only passes things along adds a second place to look, without adding behavior. Layers are worth it when they hide a decision (which database, which API) or enforce a rule. If a layer doesn't do either, remove it and import the real thing directly.",
  },
};

const ALL_CLEAR: Lesson = {
  title: 'Keep it this way',
  body: "Nothing stood out. The habits that keep a repo like this tidy are small: delete instead of archiving, edit rules instead of overriding them, and update docs in the same change as the code.",
};

export function lessonsFor(findings: Finding[]): Lesson[] {
  const kinds = [...new Set(findings.map((f) => f.kind))];
  const lessons = kinds.map((k) => LESSONS[k]).filter(Boolean);
  return lessons.length ? lessons : [ALL_CLEAR];
}

/** The project's own lint, type-check, test and build commands, from its package.json files. */
function verifyCommands(files: RepoFile[]): string[] {
  const commands: string[] = [];
  const manifests = files.filter((f) => f.path.endsWith('package.json') && f.text && !f.path.includes('/node_modules/'));
  manifests.sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const m of manifests.slice(0, 3)) {
    try {
      const scripts = JSON.parse(m.text!).scripts ?? {};
      const dir = m.path.includes('/') ? m.path.slice(0, m.path.lastIndexOf('/')) : '';
      for (const name of ['lint', 'typecheck', 'type-check', 'test', 'build']) {
        if (scripts[name]) commands.push(`npm run ${name}${dir ? ` --prefix ${dir}` : ''}`);
      }
      if (commands.length) break;
    } catch {
      // not valid JSON; skip it
    }
  }
  if (files.some((f) => f.path === 'pyproject.toml' || f.path === 'pytest.ini')) commands.push('pytest');
  if (files.some((f) => f.path === 'Cargo.toml')) commands.push('cargo build', 'cargo test');
  if (files.some((f) => f.path === 'go.mod')) commands.push('go build ./...', 'go test ./...');
  return commands;
}

const SEVERITY_LABEL = { high: 'High', medium: 'Medium', low: 'Low' } as const;

export function buildPrompt(repo: string, findings: Finding[], files: RepoFile[]): string {
  if (!findings.length) {
    return `An automated scan of the repository "${repo}" found no over-engineering, redundant layers or organization problems. No changes are needed.`;
  }
  const commands = verifyCommands(files);
  const lines: string[] = [
    `You are cleaning up the repository "${repo}". An automated scan (Aegis) found the issues below: over-engineering, redundant layers and poor organization. Fix them without changing what the software does.`,
    '',
    'How to work:',
    '1. Work through the findings in order. They are sorted from most to least important.',
    '2. Before changing anything, check the finding is real. The scan uses patterns, not a full understanding of the code, so search for references (including paths built from variables, tool configs and docs). If a finding is wrong or the code has a good reason to be that way, skip it and say why.',
    '3. Keep behavior exactly the same. No new features, no reformatting of untouched code, no dependency changes.',
    commands.length
      ? `4. After each finding, run the project's checks and fix anything you broke: ${commands.map((c) => `\`${c}\``).join(', ')}.`
      : "4. After each finding, run the project's build and tests (if it has any) and fix anything you broke.",
    '5. Make one commit per finding, with a message that says what changed and why.',
    '6. Only delete files the findings name, and only after confirming nothing uses them.',
    '',
    'Findings:',
  ];
  findings.forEach((f, i) => {
    lines.push('', `${i + 1}. [${SEVERITY_LABEL[f.severity]}] ${f.title}`);
    lines.push(`   Why it matters: ${f.why}`);
    lines.push('   Evidence:');
    for (const e of f.evidence) lines.push(`   - ${e}`);
    lines.push(`   Fix: ${f.fix}`);
  });
  lines.push(
    '',
    'When you are done, report: what you changed for each finding, which findings you skipped and why, and the result of the checks.',
  );
  return lines.join('\n');
}
