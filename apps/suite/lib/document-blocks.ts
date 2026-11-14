// lib/document-blocks.ts — finding artifacts in a reply. Pure text handling, safe to import from
// both the browser and the server. The prompt that teaches models these formats is
// DOCUMENT_SYSTEM_PROMPT in lib/prompts.ts.
//
// An artifact is one of:
//   <document title="…">Markdown</document>                          a document (the original format)
//   <artifact type="markdown|html|svg|code" title="…" language="…">…</artifact>
// and, because small local models often ignore those tags, a whole document or page in a fenced
// code block: ```markdown with a heading (400+ characters), a full ```html page, or an ```svg image.

export type ArtifactFormat = 'markdown' | 'html' | 'svg' | 'code';

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'document'; title: string; content: string; format: ArtifactFormat; language?: string };

export type DocumentSegment = Extract<Segment, { type: 'document' }>;

const FORMATS: ArtifactFormat[] = ['markdown', 'html', 'svg', 'code'];
const TAG_RE = /<(document|artifact)\b([^>]*)>([\s\S]*?)<\/\1>/g;
const ATTR_RE = /([\w-]+)\s*=\s*"([^"]*)"/g;

function readAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const m of raw.matchAll(ATTR_RE)) attrs[m[1].toLowerCase()] = m[2].trim();
  return attrs;
}

/** What a model may call a format, mapped to ours. */
function toFormat(type: string | undefined, language: string | undefined): { format: ArtifactFormat; language?: string } {
  const t = (type ?? '').toLowerCase().replace(/^text\/|^image\//, '');
  if (!t || t === 'document' || t === 'md' || t === 'markdown') return { format: 'markdown' };
  if (t === 'html' || t === 'page' || t === 'webpage' || t === 'web') return { format: 'html' };
  if (t === 'svg' || t === 'svg+xml' || t === 'image') return { format: 'svg' };
  if (FORMATS.includes(t as ArtifactFormat)) return { format: t as ArtifactFormat, language };
  // type="python" and the like: code in that language.
  return { format: 'code', language: language || t };
}

/** A tag's inside, without a code fence a model wrapped around it. */
function unwrap(body: string): string {
  const text = body.trim();
  const fenced = /^(`{3,}|~{3,})[\w+-]*[ \t]*\n([\s\S]*?)\n\1[ \t]*$/.exec(text);
  return fenced ? fenced[2].trim() : text;
}

// ---------------------------------------------------------------- fenced fallbacks
const MIN_FENCED_DOC_CHARS = 400;
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w+-]*)[ \t]*$/;

/** The first heading's words, without Markdown marks, as the document's title. */
function headingTitle(markdown: string): string | null {
  const heading = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(markdown);
  if (!heading) return null;
  const title = heading[1].replace(/[*_`~[\]]/g, '').replace(/\(([^)]*)\)/g, '').trim();
  return title || null;
}

/** A web page's <title>, or its first heading. */
function htmlTitle(html: string): string | null {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html) ?? /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  const title = m?.[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  return title || null;
}

/** Is this fenced block an artifact? If so, which kind, and what is it called. */
function fencedArtifact(language: string, body: string): Omit<DocumentSegment, 'type' | 'content'> | null {
  const lang = language.toLowerCase();
  if (lang === 'markdown' || lang === 'md') {
    const title = headingTitle(body);
    return title && body.length >= MIN_FENCED_DOC_CHARS ? { title, format: 'markdown' } : null;
  }
  if (lang === 'html' || lang === 'htm') {
    // Only a whole page counts; a snippet of tags stays a code block.
    if (/^\s*<svg[\s>]/i.test(body)) return { title: 'Image', format: 'svg' };
    if (!/<!doctype html|<html[\s>]|<body[\s>]/i.test(body)) return null;
    return { title: htmlTitle(body) ?? 'Web page', format: 'html' };
  }
  if ((lang === 'svg' || lang === 'xml') && /<svg[\s>]/i.test(body) && /<\/svg>\s*$/i.test(body)) {
    const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(body)?.[1].trim();
    return { title: title || 'Image', format: 'svg' };
  }
  return null;
}

/** Split plain text further at fenced blocks that hold a whole document, page or image. */
function splitFenced(text: string): Segment[] {
  const lines = text.split('\n');
  const out: Segment[] = [];
  let plain: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_LINE.exec(lines[i]);
    if (!open) {
      plain.push(lines[i++]);
      continue;
    }
    if (!open[2]) {
      // A plain code block: keep it whole, so nothing inside it is mistaken for an artifact.
      let end = i + 1;
      while (end < lines.length) {
        const f = FENCE_LINE.exec(lines[end]);
        if (f && !f[2] && f[1][0] === open[1][0] && f[1].length >= open[1].length) break;
        end++;
      }
      plain.push(...lines.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    // Find the closing fence. A Markdown document may hold its own code blocks (```js … ```): a fence
    // with a language opens one of those, and the next bare fence closes it, not the document.
    const fence = open[1];
    const nests = /^(markdown|md)$/i.test(open[2]);
    let inner = false;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const f = FENCE_LINE.exec(lines[j]);
      if (!f || f[1][0] !== fence[0]) continue;
      if (inner) {
        if (!f[2]) inner = false;
      } else if (f[2] && nests) {
        inner = true;
      } else if (!f[2] && f[1].length >= fence.length) {
        close = j;
        break;
      }
    }
    const body = close >= 0 ? lines.slice(i + 1, close).join('\n').trim() : '';
    const found = close >= 0 ? fencedArtifact(open[2], body) : null;
    if (!found) {
      // Not an artifact: keep the whole code block as text, untouched.
      const end = close >= 0 ? close : i;
      plain.push(...lines.slice(i, end + 1));
      i = end + 1;
      continue;
    }
    if (plain.join('\n').trim()) out.push({ type: 'text', text: plain.join('\n') });
    plain = [];
    out.push({ type: 'document', content: body, ...found });
    i = close + 1;
  }
  if (plain.join('\n').trim()) out.push({ type: 'text', text: plain.join('\n') });
  return out;
}

// ---------------------------------------------------------------- the whole reply
/** A reply cut into plain text and artifacts, in order. */
export const splitContent = (content: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;
  const addText = (text: string) => segments.push(...splitFenced(text));

  for (const match of content.matchAll(TAG_RE)) {
    const index = match.index ?? 0;
    if (index > last) addText(content.slice(last, index));
    const attrs = readAttrs(match[2]);
    const { format, language } = toFormat(match[1] === 'document' ? attrs.type : (attrs.type ?? 'markdown'), attrs.language);
    const body = format === 'markdown' ? match[3].trim() : unwrap(match[3]);
    segments.push({ type: 'document', title: attrs.title || 'Untitled', content: body, format, ...(language ? { language } : {}) });
    last = index + match[0].length;
  }
  if (last < content.length) addText(content.slice(last));

  return segments.filter((s) => s.type === 'document' || s.text.trim().length > 0);
};

/** A quick check before the full parse: could this reply hold an artifact at all? */
export const mayHoldDocument = (content: string): boolean =>
  /<(document|artifact)\b/.test(content) || /^[ \t]*(`{3,}|~{3,})[ \t]*(markdown|md|html|htm|svg|xml)[ \t]*$/im.test(content);

/** Just the artifacts in a reply. */
export const findDocuments = (content: string): Omit<DocumentSegment, 'type'>[] =>
  splitContent(content).flatMap((s) => (s.type === 'document' && s.content ? [{ title: s.title, content: s.content, format: s.format, ...(s.language ? { language: s.language } : {}) }] : []));

/** The artifact format for a file name, or null for files that aren't kept as artifacts. */
export function formatForPath(path: string): { format: ArtifactFormat } | null {
  const p = path.trim().toLowerCase();
  if (/\.(md|markdown|mdx)$/.test(p)) return { format: 'markdown' };
  if (/\.html?$/.test(p)) return { format: 'html' };
  if (/\.svg$/.test(p)) return { format: 'svg' };
  return null;
}

/** True for a file name that is Markdown. */
export const isMarkdownPath = (path: string): boolean => formatForPath(path)?.format === 'markdown';

// ---------------------------------------------------------------- labels and file names
const LANGUAGE_NAMES: Record<string, string> = {
  js: 'JavaScript', javascript: 'JavaScript', jsx: 'JSX', ts: 'TypeScript', typescript: 'TypeScript', tsx: 'TSX',
  py: 'Python', python: 'Python', rb: 'Ruby', go: 'Go', rs: 'Rust', rust: 'Rust', java: 'Java', kt: 'Kotlin',
  swift: 'Swift', c: 'C', cpp: 'C++', 'c++': 'C++', cs: 'C#', csharp: 'C#', php: 'PHP', sh: 'Shell', bash: 'Bash',
  sql: 'SQL', json: 'JSON', yaml: 'YAML', yml: 'YAML', css: 'CSS', scss: 'SCSS', html: 'HTML', xml: 'XML', lua: 'Lua',
};
const EXTENSIONS: Record<string, string> = {
  javascript: 'js', typescript: 'ts', python: 'py', ruby: 'rb', rust: 'rs', kotlin: 'kt', csharp: 'cs', 'c++': 'cpp',
  bash: 'sh', shell: 'sh', yaml: 'yml', markdown: 'md',
};

/** "Document · MD", "Web page · HTML", "Image · SVG", "Code · Python". */
export function formatLabel(format: ArtifactFormat, language?: string): string {
  if (format === 'markdown') return 'Document · MD';
  if (format === 'html') return 'Web page · HTML';
  if (format === 'svg') return 'Image · SVG';
  const lang = (language ?? '').toLowerCase();
  return `Code · ${LANGUAGE_NAMES[lang] ?? (lang ? lang.toUpperCase() : 'Text')}`;
}

/** The file extension to download an artifact as. */
export function formatExtension(format: ArtifactFormat, language?: string): string {
  if (format === 'markdown') return 'md';
  if (format === 'html') return 'html';
  if (format === 'svg') return 'svg';
  const lang = (language ?? '').toLowerCase().replace(/[^\w+#-]/g, '');
  return EXTENSIONS[lang] ?? (lang || 'txt');
}
