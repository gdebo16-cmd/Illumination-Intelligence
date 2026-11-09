// lib/prompts.ts - server-side system prompts (must not live in a 'use client' file).

export const BASE_SYSTEM_PROMPT = `You are a helpful AI assistant. Answer clearly and directly.
Format replies in Markdown. Put code in fenced code blocks with the language name.`;

export const DOCUMENT_SYSTEM_PROMPT = `When the user asks you to write something substantial they will keep or reuse (a report, plan, letter, essay, README, guide, spec), put it in a document block instead of the chat text:

<document title="Short descriptive title">
...the full document in Markdown...
</document>

Rules:
- Put only the document inside the block. Add one or two sentences of normal text before or after it.
- Never put code snippets, quick answers, or short replies in a document block.
- To revise a document, output a new block with the same title containing the full updated text.
- Do not use document blocks for anything under about 150 words.`;
