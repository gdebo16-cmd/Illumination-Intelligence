// lib/document-blocks.ts — finding documents in a reply: <document title="…">…</document> blocks,
// and whole Markdown documents a model put in a ```markdown code block instead.
// Pure text handling, safe to import from both the browser and the server.
// The prompt that teaches models this format is DOCUMENT_SYSTEM_PROMPT in lib/prompts.ts.

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'document'; title: string; content: string };

const DOC_RE = /<document\s+title="([^"]*)"\s*>([\s\S]*?)<\/document>/g;

// Small local models often ignore the <document> format and put a whole Markdown document in a
// ```markdown code block instead. Treat that as a document too, when it is clearly one: long
// enough and with a heading. A short ```markdown example (showing syntax) stays a code block.
const MIN_FENCED_DOC_CHARS = 400;
const FENCE_LINE = /^[ \t]*(`{3,}|~{3,})[ \t]*([\w+-]*)[ \t]*$/;

/** The first heading's words, without Markdown marks, as the document's title. */
function headingTitle(markdown: string): string | null {
  const heading = /^[ \t]*#{1,6}[ \t]+(.+?)[ \t#]*$/m.exec(markdown);
  if (!heading) return null;
  const title = heading[1].replace(/[*_`~[\]]/g, '').replace(/\(([^)]*)\)/g, '').trim();
  return title || null;
}

/** Split plain text further at ```markdown blocks that hold a whole document. */
function splitFencedDocuments(text: string): Segment[] {
  const lines = text.split('\n');
  const out: Segment[] = [];
  let plain: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const open = FENCE_LINE.exec(lines[i]);
    if (!open || !/^(markdown|md)$/i.test(open[2])) {
      plain.push(lines[i++]);
      continue;
    }
    // Find the closing fence. The document may hold its own code blocks (```js … ```): a fence
    // with a language opens one of those, and the next bare fence closes it, not the document.
    const fence = open[1];
    let inner = false;
    let close = -1;
    for (let j = i + 1; j < lines.length; j++) {
      const f = FENCE_LINE.exec(lines[j]);
      if (!f || f[1][0] !== fence[0]) continue;
      if (inner) {
        if (!f[2]) inner = false;
      } else if (f[2]) {
        inner = true;
      } else if (f[1].length >= fence.length) {
        close = j;
        break;
      }
    }
    const body = close >= 0 ? lines.slice(i + 1, close).join('\n').trim() : '';
    const title = headingTitle(body);
    if (close < 0 || body.length < MIN_FENCED_DOC_CHARS || !title) {
      plain.push(lines[i++]); // not a document: leave the code block as it is
      continue;
    }
    if (plain.join('\n').trim()) out.push({ type: 'text', text: plain.join('\n') });
    plain = [];
    out.push({ type: 'document', title, content: body });
    i = close + 1;
  }
  if (plain.join('\n').trim()) out.push({ type: 'text', text: plain.join('\n') });
  return out;
}

/** A reply cut into plain text and document blocks, in order. */
export const splitContent = (content: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;
  const addText = (text: string) => segments.push(...splitFencedDocuments(text));

  for (const match of content.matchAll(DOC_RE)) {
    const index = match.index ?? 0;
    if (index > last) addText(content.slice(last, index));
    segments.push({ type: 'document', title: match[1].trim() || 'Untitled', content: match[2].trim() });
    last = index + match[0].length;
  }
  if (last < content.length) addText(content.slice(last));

  return segments.filter((s) => s.type === 'document' || s.text.trim().length > 0);
};

/** A quick check before the full parse: could this reply hold a document at all? */
export const mayHoldDocument = (content: string): boolean =>
  content.includes('<document') || /^[ \t]*(`{3,}|~{3,})[ \t]*(markdown|md)[ \t]*$/im.test(content);

/** Just the document blocks in a reply. */
export const findDocuments = (content: string): { title: string; content: string }[] =>
  splitContent(content).flatMap((s) => (s.type === 'document' && s.content ? [{ title: s.title, content: s.content }] : []));

/** True for a file name that is Markdown. */
export const isMarkdownPath = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path.trim());
