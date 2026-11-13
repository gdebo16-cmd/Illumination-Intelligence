// lib/document-blocks.ts — finding <document title="…">…</document> blocks in a reply.
// Pure text handling, safe to import from both the browser and the server.
// The prompt that teaches models this format is DOCUMENT_SYSTEM_PROMPT in lib/prompts.ts.

export type Segment =
  | { type: 'text'; text: string }
  | { type: 'document'; title: string; content: string };

const DOC_RE = /<document\s+title="([^"]*)"\s*>([\s\S]*?)<\/document>/g;

/** A reply cut into plain text and document blocks, in order. */
export const splitContent = (content: string): Segment[] => {
  const segments: Segment[] = [];
  let last = 0;

  for (const match of content.matchAll(DOC_RE)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ type: 'text', text: content.slice(last, index) });
    segments.push({ type: 'document', title: match[1].trim() || 'Untitled', content: match[2].trim() });
    last = index + match[0].length;
  }
  if (last < content.length) segments.push({ type: 'text', text: content.slice(last) });

  return segments.filter((s) => s.type === 'document' || s.text.trim().length > 0);
};

/** Just the document blocks in a reply. */
export const findDocuments = (content: string): { title: string; content: string }[] =>
  splitContent(content).flatMap((s) => (s.type === 'document' && s.content ? [{ title: s.title, content: s.content }] : []));

/** True for a file name that is Markdown. */
export const isMarkdownPath = (path: string): boolean => /\.(md|markdown|mdx)$/i.test(path.trim());
