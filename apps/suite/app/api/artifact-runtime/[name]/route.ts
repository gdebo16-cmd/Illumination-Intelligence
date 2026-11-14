// GET /api/artifact-runtime/<name> — the browser scripts that diagrams and React artifacts run
// with, inside their sandboxed frame (components/documents.tsx). Only the files below can be
// fetched. No profile is needed: the frame is sandboxed, so it never sends the app's cookies,
// and these are the same public libraries anyone can download.

import fs from 'node:fs/promises';
import path from 'node:path';

const FILES: Record<string, string> = {
  'mermaid.js': 'node_modules/mermaid/dist/mermaid.min.js',
  'babel.js': 'node_modules/@babel/standalone/babel.min.js',
  'tailwind.js': 'node_modules/@tailwindcss/browser/dist/index.global.js',
  // React 19 ships no browser build, so React artifacts use React 18's (vendor/artifact-runtime/README.md).
  'react.js': 'vendor/artifact-runtime/react.production.min.js',
  'react-dom.js': 'vendor/artifact-runtime/react-dom.production.min.js',
};

// Read each file once; together they are about 7 MB.
const cache = new Map<string, Buffer>();

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const file = Object.hasOwn(FILES, name) ? FILES[name] : null;
  if (!file) return new Response('Not found', { status: 404 });
  try {
    let body = cache.get(name);
    if (!body) {
      body = await fs.readFile(path.join(process.cwd(), file));
      cache.set(name, body);
    }
    return new Response(new Uint8Array(body), {
      headers: {
        'Content-Type': 'text/javascript; charset=utf-8',
        // A day, so phones don't download megabytes of script on every diagram.
        'Cache-Control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    console.error('Artifact runtime file missing:', name, err);
    return new Response('Missing: run npm run install:suite', { status: 500 });
  }
}
