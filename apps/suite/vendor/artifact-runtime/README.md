# Artifact runtime: React 18 browser builds

React artifacts (components/documents.tsx) run in a sandboxed frame. The frame needs React as a
plain browser script, and React 19 (what the app itself uses) no longer ships one, so these two
files are React 18.3.1's own UMD builds, copied unchanged from the npm packages:

- `react.production.min.js` from react@18.3.1 (umd/)
- `react-dom.production.min.js` from react-dom@18.3.1 (umd/)

`lucide.min.js` is lucide@1.73.0's own browser build (dist/umd/), copied unchanged. lucide-react
has no browser build, so components/documents.tsx turns these icons into React components for
components that import "lucide-react". ISC licensed: see LICENSE-lucide.

They are served by `app/api/artifact-runtime/[name]/route.ts`, with the Mermaid, Babel and
Tailwind browser scripts from node_modules. MIT licensed: see LICENSE-react.
