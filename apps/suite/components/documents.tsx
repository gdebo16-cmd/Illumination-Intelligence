'use client';

// Artifacts, shared by Lumen and Umbra, laid out like a chat assistant's artifacts:
//   - ReplyContent: a reply with each artifact shown as a card: a tall colored tile (one color
//     per kind) with the Eclipse Solid symbol, the title, and a "Kind · EXT · size" line.
//   - DocumentPanel: the artifact beside the chat (full screen on a phone). Documents show formatted,
//     web pages, diagrams and React components run in a sandboxed frame, images show as pictures,
//     code is highlighted. It has
//     Preview / Code views, version arrows when it was revised in the chat, Copy, and Download.
//   - documentVersions: every version of each artifact in a chat, oldest first.
//   - useArtifacts: the profile's saved artifacts for one app (lib/artifacts.ts), and opening one.

import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageContent } from '@/components/MessageContent';
import { contentByteSize, formatCardMeta, formatExtension, formatLabel, splitContent, type ArtifactFormat } from '@/lib/document-blocks';

export { splitContent, type ArtifactFormat };

/** What the artifacts API sends back for a list (mirrors lib/artifacts.ts, which is server-only). */
export interface ArtifactSummary {
  id: string;
  app: 'lumen' | 'umbra';
  /** 'document': a block in a reply. 'file': a file a Flicker wrote in Refract. */
  kind: 'document' | 'file';
  /** markdown (a document), html (a web page), svg (an image) or code. */
  format: ArtifactFormat;
  /** For code: its language. */
  language: string;
  sourceKind: 'chat' | 'bot' | 'team';
  sourceId: string;
  sourceName: string;
  title: string;
  size: number;
  createdAt: string;
  updatedAt: string;
}

/** An artifact open in the side panel. */
export interface OpenDocument {
  title: string;
  content: string;
  /** What it is; Markdown when not given. */
  format?: ArtifactFormat;
  language?: string;
  /** The file name to download as; made from the title when not given. */
  fileName?: string;
  /** Every version of this artifact in the chat, oldest first (content is one of them). */
  versions?: string[];
  /** A short line under the title, e.g. "Document · MD · from Corn". */
  subtitle?: string;
}

/** The download name for an artifact: a Refract file keeps its own name. */
const artifactFileName = (a: Pick<ArtifactSummary, 'kind' | 'title'>): string | undefined =>
  a.kind === 'file' ? a.title.split('/').pop() : undefined;

/** Every version of each artifact in a chat's replies, by title, oldest first. */
export function documentVersions(replies: string[]): Map<string, string[]> {
  const versions = new Map<string, string[]>();
  for (const reply of replies) {
    if (!reply) continue;
    for (const seg of splitContent(reply)) {
      if (seg.type !== 'document') continue;
      const list = versions.get(seg.title) ?? [];
      if (list[list.length - 1] !== seg.content) list.push(seg.content);
      versions.set(seg.title, list);
    }
  }
  return versions;
}

/** An SVG as a picture address. As an <img>, any script inside it never runs. */
const svgSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

// ---------------------------------------------------------------- icons (small places)
/** Eclipse Solid kind for an artifact format. */
const ICON_KIND: Record<ArtifactFormat, 'document' | 'code' | 'web' | 'image' | 'diagram' | 'component'> = {
  markdown: 'document',
  html: 'web',
  svg: 'image',
  mermaid: 'diagram',
  react: 'component',
  code: 'code',
};

const ICON_PATH_24: Record<string, string> = {
  document: 'M6.61 2.03 6.22 2.1 5.85 2.23 5.5 2.4 5.17 2.62 4.88 2.88 4.62 3.17 4.4 3.5 4.23 3.85 4.1 4.22 4.03 4.61 4 5 4 19 4.03 19.39 4.1 19.78 4.23 20.15 4.4 20.5 4.62 20.83 4.88 21.12 5.17 21.38 5.5 21.6 5.85 21.77 6.22 21.9 6.61 21.97 7 22 17 22 17.39 21.97 17.78 21.9 18.15 21.77 18.5 21.6 18.83 21.38 19.12 21.12 19.38 20.83 19.6 20.5 19.77 20.15 19.9 19.78 19.97 19.39 20 19 20 7.38 19.44 7.48 19 7.5 18.56 7.48 18.12 7.41 17.69 7.31 17.28 7.16 16.88 6.97 16.5 6.74 16.15 6.48 15.82 6.18 15.52 5.85 15.26 5.5 15.03 5.12 14.84 4.72 14.69 4.31 14.59 3.88 14.52 3.44 14.5 3 14.52 2.56 14.62 2 7 2ZM16.13 11.99 7.87 11.99 7.74 11.97 7.5 11.87 7.29 11.71 7.21 11.61 7.08 11.38 7.03 11.26 7 11 7.01 10.87 7.08 10.62 7.21 10.39 7.29 10.29 7.39 10.21 7.62 10.08 7.87 10.01 16.13 10.01 16.38 10.08 16.5 10.13 16.71 10.29 16.79 10.39 16.92 10.62 16.97 10.74 16.99 10.87 16.99 11.13 16.92 11.38 16.79 11.61 16.71 11.71 16.5 11.87 16.38 11.92ZM16.13 15.99 7.87 15.99 7.74 15.97 7.5 15.87 7.29 15.71 7.21 15.61 7.08 15.38 7.03 15.26 7 15 7.01 14.87 7.08 14.62 7.21 14.39 7.29 14.29 7.39 14.21 7.62 14.08 7.87 14.01 16.13 14.01 16.38 14.08 16.5 14.13 16.71 14.29 16.79 14.39 16.92 14.62 16.97 14.74 17 15 16.97 15.26 16.92 15.38 16.79 15.61 16.61 15.79 16.5 15.87 16.38 15.92ZM11.13 19.99 8 20 7.74 19.97 7.62 19.92 7.39 19.79 7.21 19.61 7.13 19.5 7.03 19.26 7.01 19.13 7.01 18.87 7.03 18.74 7.13 18.5 7.29 18.29 7.5 18.13 7.62 18.08 7.87 18.01 11 18 11.26 18.03 11.38 18.08 11.61 18.21 11.79 18.39 11.87 18.5 11.97 18.74 11.99 18.87 11.99 19.13 11.92 19.38 11.87 19.5 11.71 19.71 11.61 19.79 11.38 19.92Z',
  code: 'M4.61 4.03 4.22 4.1 3.85 4.23 3.5 4.4 3.17 4.62 2.88 4.88 2.62 5.17 2.4 5.5 2.23 5.85 2.1 6.22 2.03 6.61 2 7 2 17 2.03 17.39 2.1 17.78 2.23 18.15 2.4 18.5 2.62 18.83 2.88 19.12 3.17 19.38 3.5 19.6 3.85 19.77 4.22 19.9 4.61 19.97 5 20 19 20 19.39 19.97 19.78 19.9 20.15 19.77 20.5 19.6 20.83 19.38 21.12 19.12 21.38 18.83 21.6 18.5 21.77 18.15 21.9 17.78 21.97 17.39 22 17 22 8.74 21.81 8.81 21.38 8.91 20.94 8.98 20.5 9 20.06 8.98 19.62 8.91 19.19 8.81 18.78 8.66 18.38 8.47 18 8.24 17.65 7.98 17.32 7.68 17.02 7.35 16.76 7 16.53 6.62 16.34 6.22 16.19 5.81 16.09 5.38 16.02 4.94 16 4.5 16.03 4 5 4ZM5.79 9.71 5.63 9.5 5.58 9.38 5.51 9.13 5.5 9 5.53 8.74 5.63 8.5 5.71 8.39 5.79 8.29 6 8.13 6.24 8.03 6.37 8.01 6.63 8.01 6.88 8.08 7 8.13 7.21 8.29 10.21 11.29 10.37 11.5 10.42 11.62 10.49 11.87 10.49 12.13 10.47 12.26 10.37 12.5 10.21 12.71 7.21 15.71 7 15.87 6.76 15.97 6.63 15.99 6.37 15.99 6.12 15.92 5.89 15.79 5.71 15.61 5.58 15.38 5.51 15.13 5.51 14.87 5.58 14.62 5.63 14.5 5.79 14.29 8.09 12ZM13 17 12.74 16.97 12.62 16.92 12.39 16.79 12.21 16.61 12.13 16.5 12.03 16.26 12.01 16.13 12.01 15.87 12.03 15.74 12.13 15.5 12.29 15.29 12.39 15.21 12.62 15.08 12.74 15.03 13 15 17.13 15.01 17.38 15.08 17.5 15.13 17.71 15.29 17.87 15.5 17.97 15.74 17.99 15.87 17.99 16.13 17.97 16.26 17.87 16.5 17.79 16.61 17.61 16.79 17.38 16.92 17.26 16.97 17 17Z',
  web: 'M4.61 4.03 4.22 4.1 3.85 4.23 3.5 4.4 3.17 4.62 2.88 4.88 2.62 5.17 2.4 5.5 2.23 5.85 2.1 6.22 2.03 6.61 2 7 2 17 2.03 17.39 2.1 17.78 2.23 18.15 2.4 18.5 2.62 18.83 2.88 19.12 3.17 19.38 3.5 19.6 3.85 19.77 4.22 19.9 4.61 19.97 5 20 19 20 19.39 19.97 19.78 19.9 20.15 19.77 20.5 19.6 20.83 19.38 21.12 19.12 21.38 18.83 21.6 18.5 21.77 18.15 21.9 17.78 21.97 17.39 22 17 22 8.74 21.81 8.81 21.38 8.91 20.94 8.98 20.5 9 20.06 8.98 19.62 8.91 19.19 8.81 18.78 8.66 18.38 8.47 18 8.24 17.65 7.98 17.32 7.68 17.02 7.35 16.76 7 16.53 6.62 16.34 6.22 16.19 5.81 16.09 5.38 16.02 4.94 16 4.5 16.03 4 5 4ZM7 8 6.98 8.2 6.92 8.38 6.83 8.56 6.71 8.71 6.56 8.83 6.38 8.92 6.2 8.98 6 9 5.8 8.98 5.62 8.92 5.44 8.83 5.29 8.71 5.17 8.56 5.08 8.38 5.02 8.2 5 8 5.02 7.8 5.08 7.62 5.17 7.44 5.29 7.29 5.44 7.17 5.62 7.08 5.8 7.02 6 7 6.2 7.02 6.38 7.08 6.56 7.17 6.71 7.29 6.83 7.44 6.92 7.62 6.98 7.8ZM10 7.9 10 8.1 9.96 8.29 9.88 8.47 9.77 8.63 9.63 8.77 9.47 8.88 9.29 8.96 9.1 9 8.9 9 8.71 8.96 8.53 8.88 8.37 8.77 8.23 8.63 8.12 8.47 8.04 8.29 8 8.1 8 7.9 8.04 7.71 8.12 7.53 8.23 7.37 8.37 7.23 8.53 7.12 8.71 7.04 8.9 7 9.1 7 9.29 7.04 9.47 7.12 9.63 7.23 9.77 7.37 9.88 7.53 9.96 7.71ZM13 7.9 13 8.1 12.96 8.29 12.88 8.47 12.77 8.63 12.63 8.77 12.47 8.88 12.29 8.96 12.1 9 11.9 9 11.71 8.96 11.53 8.88 11.37 8.77 11.23 8.63 11.12 8.47 11.04 8.29 11 8.1 11 7.9 11.04 7.71 11.12 7.53 11.23 7.37 11.37 7.23 11.53 7.12 11.71 7.04 11.9 7 12.1 7 12.29 7.04 12.47 7.12 12.63 7.23 12.77 7.37 12.88 7.53 12.96 7.71ZM18.13 12.99 14 13 13.74 12.97 13.5 12.87 13.39 12.79 13.29 12.71 13.13 12.5 13.08 12.38 13.01 12.13 13.01 11.87 13.03 11.74 13.13 11.5 13.29 11.29 13.39 11.21 13.62 11.08 13.87 11.01 18 11 18.26 11.03 18.5 11.13 18.71 11.29 18.79 11.39 18.92 11.62 18.97 11.74 18.99 11.87 18.99 12.13 18.92 12.38 18.79 12.61 18.71 12.71 18.5 12.87 18.38 12.92ZM5.87 11.01 10.13 11.01 10.38 11.08 10.5 11.13 10.71 11.29 10.79 11.39 10.87 11.5 10.97 11.74 11 12 11 16 10.97 16.26 10.87 16.5 10.79 16.61 10.61 16.79 10.38 16.92 10.26 16.97 10 17 6 17 5.74 16.97 5.62 16.92 5.39 16.79 5.21 16.61 5.08 16.38 5.01 16.13 5 16 5.01 11.87 5.08 11.62 5.21 11.39 5.29 11.29 5.5 11.13 5.62 11.08ZM16.13 16.99 14 17 13.74 16.97 13.62 16.92 13.39 16.79 13.29 16.71 13.13 16.5 13.08 16.38 13.01 16.13 13 16 13.01 15.87 13.08 15.62 13.21 15.39 13.39 15.21 13.62 15.08 13.87 15.01 16 15 16.13 15.01 16.38 15.08 16.5 15.13 16.71 15.29 16.87 15.5 16.97 15.74 16.99 15.87 16.99 16.13 16.92 16.38 16.79 16.61 16.71 16.71 16.61 16.79 16.38 16.92Z',
  image: 'M4.61 4.03 4.22 4.1 3.85 4.23 3.5 4.4 3.17 4.62 2.88 4.88 2.62 5.17 2.4 5.5 2.23 5.85 2.1 6.22 2.03 6.61 2 7 2 17 2.03 17.39 2.1 17.78 2.23 18.15 2.4 18.5 2.62 18.83 2.88 19.12 3.17 19.38 3.5 19.6 3.85 19.77 4.22 19.9 4.61 19.97 5 20 19 20 19.39 19.97 19.78 19.9 20.15 19.77 20.5 19.6 20.83 19.38 21.12 19.12 21.38 18.83 21.6 18.5 21.77 18.15 21.9 17.78 21.97 17.39 22 17 22 8.74 21.81 8.81 21.38 8.91 20.94 8.98 20.5 9 20.06 8.98 19.62 8.91 19.19 8.81 18.78 8.66 18.38 8.47 18 8.24 17.65 7.98 17.32 7.68 17.02 7.35 16.76 7 16.53 6.62 16.34 6.22 16.19 5.81 16.09 5.38 16.02 4.94 16 4.5 16.03 4 5 4ZM9.99 9.2 9.91 9.58 9.76 9.94 9.55 10.27 9.27 10.55 8.94 10.76 8.58 10.91 8.2 10.99 7.8 10.99 7.42 10.91 7.06 10.76 6.73 10.55 6.45 10.27 6.24 9.94 6.09 9.58 6.01 9.2 6.01 8.8 6.09 8.42 6.24 8.06 6.45 7.73 6.73 7.45 7.06 7.24 7.42 7.09 7.8 7.01 8.2 7.01 8.58 7.09 8.94 7.24 9.27 7.45 9.55 7.73 9.76 8.06 9.91 8.42 9.99 8.8ZM19.5 17 4.5 17 4.5 17 4.52 16.85 4.62 16.68 9.62 10.68 9.77 10.56 9.86 10.52 10 10.5 10.19 10.54 10.35 10.65 13.5 13.79 15.18 12.11 15.31 12.04 15.46 12 15.65 12.02 15.79 12.09 15.89 12.19 19.39 16.69 19.47 16.82Z',
  diagram: 'M3.74 2.02 3.48 2.07 3.23 2.15 3 2.27 2.78 2.41 2.59 2.59 2.41 2.78 2.27 3 2.15 3.23 2.07 3.48 2.02 3.74 2 4 2 8 2.02 8.26 2.07 8.52 2.15 8.77 2.27 9 2.41 9.22 2.59 9.41 2.78 9.59 3 9.73 3.23 9.85 3.48 9.93 3.74 9.98 4 10 5 10 5 14 11 14 11 16 10 16 9.74 16.02 9.48 16.07 9.23 16.15 9 16.27 8.78 16.41 8.59 16.59 8.41 16.78 8.27 17 8.15 17.23 8.07 17.48 8.02 17.74 8 18 8 20 8.02 20.26 8.07 20.52 8.15 20.77 8.27 21 8.41 21.22 8.59 21.41 8.78 21.59 9 21.73 9.23 21.85 9.48 21.93 9.74 21.98 10 22 14 22 14.26 21.98 14.52 21.93 14.77 21.85 15 21.73 15.22 21.59 15.41 21.41 15.59 21.22 15.73 21 15.85 20.77 15.93 20.52 15.98 20.26 16 20 16 18 15.98 17.74 15.93 17.48 15.85 17.23 15.73 17 15.59 16.78 15.41 16.59 15.22 16.41 15 16.27 14.77 16.15 14.52 16.07 14.26 16.02 14 16 13 16 13 14 19 14 19 10 20 10 20.26 9.98 20.52 9.93 20.77 9.85 21 9.73 21.22 9.59 21.41 9.41 21.59 9.22 21.73 9 21.85 8.77 21.93 8.52 21.98 8.26 22 8 22 6.35 21.68 6.43 21.34 6.48 21 6.5 20.66 6.48 20.32 6.43 19.98 6.35 19.66 6.23 19.35 6.09 19.06 5.91 18.78 5.71 18.53 5.47 18.29 5.22 18.09 4.94 17.91 4.65 17.77 4.34 17.65 4.02 17.57 3.68 17.52 3.34 17.5 3 17.52 2.66 17.57 2.32 17.65 2 16 2 15.74 2.02 15.48 2.07 15.23 2.15 15 2.27 14.78 2.41 14.59 2.59 14.41 2.78 14.27 3 14.15 3.23 14.07 3.48 14.02 3.74 14 4 14 8 14.02 8.26 14.07 8.52 14.15 8.77 14.27 9 14.41 9.22 14.59 9.41 14.78 9.59 15 9.73 15.23 9.85 15.48 9.93 15.74 9.98 16 10 17 10 17 12 7 12 7 10 8 10 8.26 9.98 8.52 9.93 8.77 9.85 9 9.73 9.22 9.59 9.41 9.41 9.59 9.22 9.73 9 9.85 8.77 9.93 8.52 9.98 8.26 10 8 10 4 9.98 3.74 9.93 3.48 9.85 3.23 9.73 3 9.59 2.78 9.41 2.59 9.22 2.41 9 2.27 8.77 2.15 8.52 2.07 8.26 2.02 8 2 4 2Z',
  component: 'M3.85 3.23 3.5 3.4 3.17 3.62 2.88 3.88 2.62 4.17 2.4 4.5 2.23 4.85 2.1 5.22 2.03 5.61 2 6 2 13 2.03 13.39 2.1 13.78 2.23 14.15 2.4 14.5 2.62 14.83 2.88 15.12 3.17 15.38 3.5 15.6 3.85 15.77 4.22 15.9 4.61 15.97 5 16 11.04 16 10.02 13.26 9.95 13.02 9.91 12.77 9.9 12.51 9.91 12.26 9.99 11.82 10.09 11.52 10.3 11.12 10.48 10.86 10.79 10.54 11.04 10.35 11.43 10.13 11.72 10.02 12.16 9.92 12.42 9.9 12.73 9.91 13.17 9.99 17 11.26 17 7.96 16.5 8 16.11 7.98 15.72 7.92 15.34 7.83 14.97 7.7 14.61 7.53 14.28 7.33 13.96 7.09 13.67 6.83 13.41 6.54 13.17 6.22 12.97 5.89 12.8 5.53 12.67 5.16 12.58 4.78 12.52 4.39 12.5 4 12.52 3.61 12.58 3.22 12.63 3 5 3 4.61 3.03 4.22 3.1ZM5.74 8.97 5.5 8.87 5.29 8.71 5.21 8.61 5.08 8.38 5.03 8.26 5 8 5.03 7.74 5.08 7.62 5.21 7.39 5.39 7.21 5.5 7.13 5.74 7.03 6 7 9.13 7.01 9.38 7.08 9.61 7.21 9.71 7.29 9.87 7.5 9.97 7.74 9.99 7.87 9.99 8.13 9.97 8.26 9.87 8.5 9.71 8.71 9.61 8.79 9.5 8.87 9.26 8.97 9 9 6 9ZM15.24 21.51 15.32 21.67 15.45 21.79 15.61 21.87 15.72 21.9 15.9 21.89 16.07 21.84 16.21 21.73 16.29 21.64 16.35 21.54 18.05 17.66 21.79 16.02 21.89 15.96 21.97 15.88 22.06 15.73 22.09 15.62 22.1 15.5 22.08 15.33 22 15.17 21.93 15.08 21.84 15.01 21.69 14.93 12.69 11.93 12.52 11.9 12.34 11.92 12.23 11.96 12.13 12.02 12.05 12.11 11.98 12.2 11.93 12.31 11.91 12.42 11.9 12.54 11.92 12.65Z',
};

const ICON_PATH_16: Record<string, string> = {
  document: 'M3.74 1.02 3.48 1.07 3.23 1.15 3 1.27 2.78 1.41 2.59 1.59 2.41 1.78 2.27 2 2.15 2.23 2.07 2.48 2.02 2.74 2 3 2 13 2.02 13.26 2.07 13.52 2.15 13.77 2.27 14 2.41 14.22 2.59 14.41 2.78 14.59 3 14.73 3.23 14.85 3.48 14.93 3.74 14.98 4 15 12 15 12.26 14.98 12.52 14.93 12.77 14.85 13 14.73 13.22 14.59 13.41 14.41 13.59 14.22 13.73 14 13.85 13.77 13.93 13.52 13.98 13.26 14 13 14 4.7 13.69 4.68 13.38 4.64 13.07 4.56 12.78 4.46 12.49 4.32 12.22 4.16 11.97 3.97 11.74 3.76 11.53 3.53 11.34 3.28 11.18 3.01 11.04 2.72 10.94 2.43 10.86 2.12 10.82 1.81 10.8 1.5 10.82 1.19 10.84 1 4 1ZM11 6 11 7 5 7 5 6ZM5 9 11 9 11 10 5 10ZM5 12 9 12 9 13 5 13Z',
  code: 'M2.74 2.02 2.48 2.07 2.23 2.15 2 2.27 1.78 2.41 1.59 2.59 1.41 2.78 1.27 3 1.15 3.23 1.07 3.48 1.02 3.74 1 4 1 12 1.02 12.26 1.07 12.52 1.15 12.77 1.27 13 1.41 13.22 1.59 13.41 1.78 13.59 2 13.73 2.23 13.85 2.48 13.93 2.74 13.98 3 14 13 14 13.26 13.98 13.52 13.93 13.77 13.85 14 13.73 14.22 13.59 14.41 13.41 14.59 13.22 14.73 13 14.85 12.77 14.93 12.52 14.98 12.26 15 12 15 5.82 14.59 5.94 14.29 5.99 14 6 13.71 5.99 13.41 5.94 13.13 5.87 12.85 5.77 12.59 5.65 12.33 5.49 12.1 5.32 11.88 5.12 11.68 4.9 11.51 4.67 11.35 4.41 11.23 4.15 11.13 3.87 11.06 3.59 11.01 3.29 11 3 11.01 2.71 11.06 2.41 11.18 2 3 2ZM3.44 5.5 3.33 5.34 3.27 5.16 3.25 5.06 3.25 4.96 3.29 4.77 3.37 4.59 3.43 4.51 3.58 4.38 3.75 4.29 3.94 4.25 4.04 4.25 4.14 4.26 4.32 4.32 4.41 4.37 4.56 4.5 6.81 7 6.87 7.08 6.96 7.25 7 7.45 6.99 7.65 6.96 7.75 6.92 7.84 6.81 8 4.56 10.5 4.41 10.63 4.32 10.68 4.14 10.74 3.94 10.75 3.75 10.71 3.58 10.62 3.43 10.49 3.32 10.32 3.26 10.14 3.25 9.94 3.29 9.75 3.38 9.58 3.44 9.5 5.24 7.5ZM12 11.5 8 11.5 8 10 12 10Z',
  web: 'M2.74 2.02 2.48 2.07 2.23 2.15 2 2.27 1.78 2.41 1.59 2.59 1.41 2.78 1.27 3 1.15 3.23 1.07 3.48 1.02 3.74 1 4 1 12 1.02 12.26 1.07 12.52 1.15 12.77 1.27 13 1.41 13.22 1.59 13.41 1.78 13.59 2 13.73 2.23 13.85 2.48 13.93 2.74 13.98 3 14 13 14 13.26 13.98 13.52 13.93 13.77 13.85 14 13.73 14.22 13.59 14.41 13.41 14.59 13.22 14.73 13 14.85 12.77 14.93 12.52 14.98 12.26 15 12 15 5.82 14.59 5.94 14.29 5.99 14 6 13.71 5.99 13.41 5.94 13.13 5.87 12.85 5.77 12.59 5.65 12.33 5.49 12.1 5.32 11.88 5.12 11.68 4.9 11.51 4.67 11.35 4.41 11.23 4.15 11.13 3.87 11.06 3.59 11.01 3.29 11 3 11.01 2.71 11.06 2.41 11.18 2 3 2ZM4 5 4 6 3 6 3 5ZM6 5 6 6 5 6 5 5ZM13 8 13 9 8 9 8 8ZM3 8 7 8 7 12 3 12ZM8 11 11 11 11 12 8 12Z',
  image: 'M2.74 2.02 2.48 2.07 2.23 2.15 2 2.27 1.78 2.41 1.59 2.59 1.41 2.78 1.27 3 1.15 3.23 1.07 3.48 1.02 3.74 1 4 1 12 1.02 12.26 1.07 12.52 1.15 12.77 1.27 13 1.41 13.22 1.59 13.41 1.78 13.59 2 13.73 2.23 13.85 2.48 13.93 2.74 13.98 3 14 13 14 13.26 13.98 13.52 13.93 13.77 13.85 14 13.73 14.22 13.59 14.41 13.41 14.59 13.22 14.73 13 14.85 12.77 14.93 12.52 14.98 12.26 15 12 15 5.82 14.59 5.94 14.29 5.99 14 6 13.71 5.99 13.41 5.94 13.13 5.87 12.85 5.77 12.59 5.65 12.33 5.49 12.1 5.32 11.88 5.12 11.68 4.9 11.51 4.67 11.35 4.41 11.23 4.15 11.13 3.87 11.06 3.59 11.01 3.29 11 3 11.01 2.71 11.06 2.41 11.18 2 3 2ZM5.13 4.01 5.38 4.08 5.5 4.13 5.71 4.29 5.87 4.5 5.97 4.74 6 5 6 6 5.97 6.26 5.87 6.5 5.71 6.71 5.5 6.87 5.38 6.92 5.13 6.99 3.87 6.99 3.74 6.97 3.5 6.87 3.29 6.71 3.21 6.61 3.08 6.38 3.01 6.13 3.01 4.87 3.08 4.62 3.13 4.5 3.29 4.29 3.39 4.21 3.62 4.08 3.74 4.03 4 4ZM14 12 3 12 7 7 9.5 9.5 11 8Z',
  diagram: 'M2.5 1 2.3 1.01 2.11 1.05 1.93 1.11 1.75 1.2 1.59 1.31 1.44 1.44 1.31 1.59 1.2 1.75 1.11 1.93 1.05 2.11 1.01 2.3 1 2.5 1 5.5 1.01 5.7 1.05 5.89 1.11 6.07 1.2 6.25 1.31 6.41 1.44 6.56 1.59 6.69 1.75 6.8 1.93 6.89 2.11 6.95 2.3 6.99 2.5 7 3 7 3 13 8 13 8.01 13.7 8.05 13.89 8.11 14.07 8.2 14.25 8.31 14.41 8.44 14.56 8.59 14.69 8.75 14.8 8.93 14.89 9.11 14.95 9.3 14.99 9.5 15 13.5 15 13.7 14.99 13.89 14.95 14.07 14.89 14.25 14.8 14.41 14.69 14.56 14.56 14.69 14.41 14.8 14.25 14.89 14.07 14.95 13.89 14.99 13.7 15 13.5 15 11.2 14.69 11.18 14.38 11.14 14.07 11.06 13.78 10.96 13.49 10.82 13.22 10.66 12.97 10.47 12.74 10.26 12.53 10.03 12.34 9.78 12.18 9.51 12.04 9.22 11.94 8.93 11.86 8.62 11.82 8.31 11.8 8 9.5 8 9.3 8.01 9.11 8.05 8.93 8.11 8.75 8.2 8.59 8.31 8.44 8.44 8.31 8.59 8.2 8.75 8.11 8.93 8.05 9.11 8.01 9.3 8 9.5 8 11 5 11 5 7 5.7 6.99 5.89 6.95 6.07 6.89 6.25 6.8 6.41 6.69 6.56 6.56 6.69 6.41 6.8 6.25 6.89 6.07 6.95 5.89 6.99 5.7 7 5.5 7 2.5 6.99 2.3 6.95 2.11 6.89 1.93 6.8 1.75 6.69 1.59 6.56 1.44 6.41 1.31 6.25 1.2 6.07 1.11 5.89 1.05 5.7 1.01 5.5 1Z',
  component: 'M2.48 1.07 2.23 1.15 2 1.27 1.78 1.41 1.59 1.59 1.41 1.78 1.27 2 1.15 2.23 1.07 2.48 1.02 2.74 1 3 1 9 1.02 9.26 1.07 9.52 1.15 9.77 1.27 10 1.41 10.22 1.59 10.41 1.78 10.59 2 10.73 2.23 10.85 2.48 10.93 2.74 10.98 3 11 6.94 11 6.06 7.49 6.02 7.29 6 6.9 6.02 6.7 6.12 6.31 6.2 6.13 6.4 5.79 6.53 5.64 6.83 5.38 6.99 5.27 7.35 5.11 7.74 5.02 7.94 5 8.33 5.03 8.71 5.13 12 6.76 12 4.2 11.69 4.18 11.38 4.14 11.07 4.06 10.78 3.96 10.49 3.82 10.22 3.66 9.97 3.47 9.74 3.26 9.53 3.03 9.34 2.78 9.18 2.51 9.04 2.22 8.94 1.93 8.86 1.62 8.82 1.31 8.8 1 3 1 2.74 1.02ZM10 15 11.5 11.5 15 10.5 8 7Z',
};

/** The artifact symbol for small places (lists, buttons), one per kind. Use size 16 for the 16px variant; 24 and up uses the master. */
export const ArtifactIcon = ({ format = 'markdown', size = 18 }: { format?: ArtifactFormat; size?: number }) => {
  const kind = ICON_KIND[format] ?? 'document';
  const small = size === 16;
  const d = (small ? ICON_PATH_16 : ICON_PATH_24)[kind];
  const box = small ? 16 : 24;
  return (
    <svg className="document-icon" viewBox={`0 0 ${box} ${box}`} width={size} height={size} aria-hidden="true" fill="currentColor">
      <path fillRule="evenodd" d={d} />
    </svg>
  );
};

/** The document symbol (kept for places that only ever show documents). */
export const DocumentIcon = ({ size = 18 }: { size?: number }) => <ArtifactIcon format="markdown" size={size} />;

// ---------------------------------------------------------------- thumbnails (cards)
/** The card's colored tile, with the kind's Eclipse Solid symbol. */
export const ArtifactThumb = ({ format = 'markdown' }: { format?: ArtifactFormat; content?: string }) => (
  <span className="document-thumb" aria-hidden="true">
    <span className="document-thumb-icon" />
  </span>
);

/** The document tile (kept for places that only ever show documents). */
export const DocumentThumb = (_props: { content?: string }) => <ArtifactThumb format="markdown" />;

const Chevron = ({ dir }: { dir: 'left' | 'right' | 'down' }) => (
  <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d={dir === 'left' ? 'M15 6l-6 6 6 6' : dir === 'right' ? 'M9 6l6 6-6 6' : 'M6 9l6 6 6-6'} />
  </svg>
);
const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

// ---------------------------------------------------------------- reply with artifact cards
interface DocumentCardProps {
  title: string;
  /** The artifact's text, used to show its size on the card when size isn't given. */
  content?: string;
  /** Known size in bytes, e.g. from a saved artifact list. */
  size?: number;
  format?: ArtifactFormat;
  language?: string;
  /** Which version this is, when it was revised in the chat. */
  version?: number;
  /** This artifact is the one open in the panel. */
  active?: boolean;
  onOpen: () => void;
}

export const DocumentCard = ({ title, content, size, format = 'markdown', language, active, onOpen }: DocumentCardProps) => {
  const bytes = size ?? (content != null ? contentByteSize(content) : undefined);
  const meta = formatCardMeta(format, language, bytes);
  return (
    <button type="button" className={`document-card is-${format}${active ? ' is-active' : ''}`} onClick={onOpen} aria-pressed={active}>
      <ArtifactThumb format={format} />
      <span className="document-card-text">
        <span className="document-card-title">{title}</span>
        <span className="document-card-subtitle">{meta}</span>
      </span>
    </button>
  );
};

interface ReplyContentProps {
  content: string;
  onOpen: (doc: OpenDocument) => void;
  /** documentVersions() of the whole chat, to label revisions and let the panel step through them. */
  versions?: Map<string, string[]>;
  /** The artifact open in the panel right now, to highlight its card. */
  open?: OpenDocument | null;
}

/** A reply in Markdown, with each artifact shown as a card that opens it beside the chat. */
export const ReplyContent = ({ content, onOpen, versions, open }: ReplyContentProps) => (
  <>
    {splitContent(content).map((seg, i) => {
      if (seg.type === 'text') return <MessageContent key={i} content={seg.text} />;
      const list = versions?.get(seg.title) ?? [seg.content];
      const at = list.indexOf(seg.content);
      return (
        <DocumentCard
          key={i}
          title={seg.title}
          content={seg.content}
          format={seg.format}
          language={seg.language}
          version={list.length > 1 && at >= 0 ? at + 1 : undefined}
          active={open?.title === seg.title && open.content === seg.content}
          onOpen={() => onOpen({ title: seg.title, content: seg.content, format: seg.format, language: seg.language, versions: list })}
        />
      );
    })}
  </>
);

// ---------------------------------------------------------------- side panel
interface DocumentPanelProps extends OpenDocument {
  onClose: () => void;
}

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

/** Code wrapped in a fence long enough that nothing inside can close it early. */
function fenced(code: string, language: string): string {
  const longest = Math.max(2, ...[...code.matchAll(/`+/g)].map((m) => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${code}\n${fence}`;
}

const MIME: Record<ArtifactFormat, string> = {
  markdown: 'text/markdown',
  html: 'text/html',
  svg: 'image/svg+xml',
  mermaid: 'text/plain',
  react: 'text/javascript',
  code: 'text/plain',
};

const DOWNLOAD_NAME: Record<ArtifactFormat, string> = {
  markdown: 'Markdown',
  html: 'HTML file',
  svg: 'SVG image',
  mermaid: 'Mermaid file',
  react: 'React component',
  code: 'File',
};

// ---------------------------------------------------------------- pages for the sandboxed frame
// Diagrams and React components run in the same sandboxed frame as web pages. These build the page
// for the frame: it loads its library from this app (app/api/artifact-runtime), then draws the
// artifact. Their text goes in as a JSON string, with "<" escaped so it can't end the script early.
const embed = (text: string) => JSON.stringify(text).replace(/</g, '\\u003c');
const RUNTIME = '/api/artifact-runtime';
const FRAME_HEAD = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">`;
const FRAME_ERROR_STYLE = `.artifact-error{margin:16px;padding:12px 14px;border-radius:10px;background:#fff1f1;color:#9b1c1c;font:13px/1.5 ui-monospace,Menlo,Consolas,monospace;white-space:pre-wrap}`;
const FRAME_SHOW_ERROR = `function showError(title, err) {
  var box = document.createElement('div');
  box.className = 'artifact-error';
  box.textContent = title + '\\n\\n' + ((err && err.message) || String(err));
  document.body.replaceChildren(box);
}`;

function mermaidPage(code: string): string {
  return `${FRAME_HEAD}<style>html,body{margin:0;background:#fff;font-family:system-ui,sans-serif}
#diagram{display:flex;justify-content:center;padding:24px}#diagram svg{max-width:100%;height:auto}${FRAME_ERROR_STYLE}</style>
</head><body><div id="diagram"></div>
<script src="${RUNTIME}/mermaid.js"></script>
<script>${FRAME_SHOW_ERROR}
try {
  mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'default' });
  mermaid.render('artifact-diagram', ${embed(code)})
    .then(function (out) { document.getElementById('diagram').innerHTML = out.svg; })
    .catch(function (err) { showError('This diagram has a mistake in it:', err); });
} catch (err) { showError('The diagram could not be drawn:', err); }
</script></body></html>`;
}

function reactPage(code: string): string {
  return `${FRAME_HEAD}<style>html,body{margin:0}${FRAME_ERROR_STYLE}</style>
<script src="${RUNTIME}/tailwind.js"></script>
</head><body><div id="root"></div>
<script src="${RUNTIME}/react.js"></script>
<script src="${RUNTIME}/react-dom.js"></script>
<script src="${RUNTIME}/babel.js"></script>
<script>${FRAME_SHOW_ERROR}
window.addEventListener('error', function (e) { showError('The component stopped with an error:', e.error || e.message); });
try {
  var compiled = Babel.transform(${embed(code)}, {
    filename: 'artifact.tsx',
    presets: [['env', { modules: 'commonjs' }], 'react', ['typescript', { isTSX: true, allExtensions: true }]],
  }).code;
  var libraries = { 'react': React, 'react-dom': ReactDOM, 'react-dom/client': ReactDOM };
  var require = function (name) {
    if (Object.prototype.hasOwnProperty.call(libraries, name)) return libraries[name];
    throw new Error('"' + name + '" isn\\'t available here. Components can use React (with its hooks) and Tailwind classes.');
  };
  var module = { exports: {} };
  new Function('require', 'module', 'exports', 'React', compiled)(require, module, module.exports, React);
  var App = module.exports.default || module.exports.App ||
    Object.keys(module.exports).map(function (k) { return module.exports[k]; }).filter(function (v) { return typeof v === 'function'; })[0];
  if (!App) throw new Error('The component needs "export default", e.g. export default function App() { … }');
  ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(App));
} catch (err) { showError('The component could not run:', err); }
</script></body></html>`;
}

/** Which language to highlight in the Code view. */
const SOURCE_LANGUAGE: Partial<Record<ArtifactFormat, string>> = { html: 'html', svg: 'xml', mermaid: 'mermaid', react: 'jsx' };

/** The artifact beside the chat. A new artifact (or another version from the chat) starts fresh. */
export const DocumentPanel = (props: DocumentPanelProps) => <Panel key={`${props.title}\n${props.content}`} {...props} />;

const Panel = ({ title, content, format = 'markdown', language, fileName, versions, subtitle, onClose }: DocumentPanelProps) => {
  const list = versions?.length ? versions : [content];
  const [index, setIndex] = useState(() => Math.max(0, list.indexOf(content)));
  // Code files have only the code view.
  const [view, setView] = useState<'preview' | 'source'>(format === 'code' ? 'source' : 'preview');
  const [copied, setCopied] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const shown = list[index] ?? content;
  const ext = formatExtension(format, language);

  // Escape closes the menu, or else the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (menuOpen) setMenuOpen(false);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, menuOpen]);

  // A tap outside the Download menu closes it.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [menuOpen]);

  const handleCopy = async () => {
    try {
      await copyText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (err) {
      console.error('Copy failed', err);
    }
  };

  const downloadFile = () => {
    setMenuOpen(false);
    const blob = new Blob([shown], { type: `${MIME[format]};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const base = title.replace(/\.[\w]+$/, '').replace(/[^\w\- ]+/g, '').trim() || 'artifact';
    a.download = fileName || `${base}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const printPdf = () => {
    setMenuOpen(false);
    setView('preview');
    // Let the preview render before the print dialog takes its picture.
    setTimeout(() => window.print(), 50);
  };

  const meta = [list.length > 1 ? `Version ${index + 1} of ${list.length}` : null, subtitle ?? formatLabel(format, language)]
    .filter(Boolean)
    .join(' · ');

  let body: React.ReactNode;
  if (view === 'source') {
    body =
      format === 'markdown' ? (
        <pre className="document-source"><code>{shown}</code></pre>
      ) : (
        <div className="document-code">
          <MessageContent content={fenced(shown, SOURCE_LANGUAGE[format] ?? language ?? '')} />
        </div>
      );
  } else if (format === 'html') {
    // The page runs in a sandbox: its scripts work, but it can't reach this app, its cookies or its data.
    body = <iframe className="document-frame" title={title} sandbox="allow-scripts allow-modals allow-forms" srcDoc={shown} />;
  } else if (format === 'mermaid' || format === 'react') {
    // Same sandbox as a web page: it draws the diagram or runs the component, and nothing more.
    body = (
      <iframe
        className={`document-frame is-${format}`}
        title={title}
        sandbox="allow-scripts allow-modals allow-forms"
        srcDoc={format === 'mermaid' ? mermaidPage(shown) : reactPage(shown)}
      />
    );
  } else if (format === 'svg') {
    body = (
      <div className="document-image">
        {/* eslint-disable-next-line @next/next/no-img-element -- a data: picture, not a file Next can optimise */}
        <img src={svgSrc(shown)} alt={title} />
      </div>
    );
  } else {
    body = (
      <article className="document-page">
        <MessageContent content={shown} />
      </article>
    );
  }

  return (
    <aside className={`document-panel is-${format}`} aria-label={`${formatLabel(format, language).split(' · ')[0]}: ${title}`}>
      <div className="document-panel-header">
        <button type="button" className="document-icon-button document-panel-close" onClick={onClose} aria-label="Close" title="Close">
          <CloseIcon />
        </button>
        <span className="document-panel-icon"><ArtifactIcon format={format} size={18} /></span>
        <div className="document-panel-heading">
          <h2 className="document-panel-title">{title}</h2>
          <span className="document-panel-meta">{meta}</span>
        </div>
        {list.length > 1 && (
          <div className="document-versions" role="group" aria-label="Versions">
            <button type="button" className="document-icon-button" onClick={() => setIndex((i) => i - 1)} disabled={index === 0} aria-label="Previous version" title="Previous version">
              <Chevron dir="left" />
            </button>
            <button type="button" className="document-icon-button" onClick={() => setIndex((i) => i + 1)} disabled={index === list.length - 1} aria-label="Next version" title="Next version">
              <Chevron dir="right" />
            </button>
          </div>
        )}
      </div>

      <div className="document-panel-toolbar">
        {format === 'code' ? (
          <span className="document-panel-language">{formatLabel(format, language).split(' · ')[1]}</span>
        ) : (
          <div className="document-toggle" role="tablist" aria-label="View">
            <button type="button" role="tab" aria-selected={view === 'preview'} onClick={() => setView('preview')}>Preview</button>
            <button type="button" role="tab" aria-selected={view === 'source'} onClick={() => setView('source')}>
              {format === 'markdown' ? 'Markdown' : 'Code'}
            </button>
          </div>
        )}
        <div className="document-panel-actions">
          <button type="button" className="document-action" onClick={handleCopy}>{copied ? 'Copied' : 'Copy'}</button>
          <div className="document-menu" ref={menuRef}>
            <button type="button" className="document-action" onClick={() => setMenuOpen((o) => !o)} aria-haspopup="menu" aria-expanded={menuOpen}>
              Download <Chevron dir="down" />
            </button>
            {menuOpen && (
              <div className="document-menu-list" role="menu">
                <button type="button" role="menuitem" onClick={downloadFile}>
                  {format === 'code' ? `${formatLabel(format, language).split(' · ')[1]} file` : DOWNLOAD_NAME[format]} (.{ext})
                </button>
                {format === 'markdown' && <button type="button" role="menuitem" onClick={printPdf}>PDF (print)</button>}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="document-panel-body">{body}</div>
    </aside>
  );
};

// ---------------------------------------------------------------- saved artifacts
/**
 * The profile's artifacts in one app (optionally only one chat's, Flicker's or team's), newest
 * first. `open` loads one's full text for the DocumentPanel.
 */
async function fetchArtifacts(app: 'lumen' | 'umbra', source?: string): Promise<ArtifactSummary[]> {
  const query = new URLSearchParams({ app });
  if (source) query.set('source', source);
  const res = await fetch(`/api/artifacts?${query}`, { cache: 'no-store' });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not load artifacts.');
  return res.json();
}

export function useArtifacts(app: 'lumen' | 'umbra', source?: string) {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[] | null>(null);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    try {
      setArtifacts(await fetchArtifacts(app, source));
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }, [app, source]);

  useEffect(() => {
    let cancelled = false;
    fetchArtifacts(app, source)
      .then((list) => {
        if (!cancelled) setArtifacts(list);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [app, source]);

  const open = useCallback(async (artifact: ArtifactSummary): Promise<OpenDocument | null> => {
    try {
      const res = await fetch(`/api/artifacts/${artifact.id}`, { cache: 'no-store' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Could not open that artifact.');
      const full = (await res.json()) as ArtifactSummary & { content: string };
      return {
        title: full.title,
        content: full.content,
        format: full.format,
        language: full.language || undefined,
        fileName: artifactFileName(full),
        subtitle: `${full.kind === 'file' ? `Refract file · ${formatLabel(full.format, full.language).split(' · ')[1]}` : formatLabel(full.format, full.language)} · from ${full.sourceName}`,
      };
    } catch (err) {
      setError((err as Error).message);
      return null;
    }
  }, []);

  const remove = useCallback(async (artifact: ArtifactSummary) => {
    const res = await fetch(`/api/artifacts/${artifact.id}`, { method: 'DELETE' }).catch(() => null);
    // 404 means it is already gone, so drop it from the list either way.
    if (res && (res.ok || res.status === 404)) setArtifacts((list) => list?.filter((a) => a.id !== artifact.id) ?? null);
  }, []);

  return { artifacts, error, refresh, open, remove };
}
