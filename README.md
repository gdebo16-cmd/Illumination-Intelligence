# Illumination Intelligence

Gabriel DeBoer's suite of local AI apps: Lumen, Prism, Umbra, Astra, Eclipse, and Halo. They all live in one Next.js app, `apps/suite`, with one route per product. A nine-dot launcher in the top-right of every app switches between them.

Lumen is the working app: local chat through Ollama. The others are "coming soon" pages until they're built.

## Run

Needs Node 22.5 or newer (the database uses the built-in `node:sqlite`). Chat needs Ollama running on this machine.

```bash
npm run install:suite
npm run dev
```

Open `http://localhost:3000`. You'll pick a profile, then land on Lumen.

## Layout

```
apps/suite/                    the Next.js app
  app/
    layout.tsx                 root layout (html, globals.css)
    page.tsx                   redirects to /lumen
    select-user/               profile picker
    (apps)/                    every product; layout.tsx requires a profile
      lumen/                   page.tsx, layout.tsx (chat state), _components/
      prism/ umbra/ astra/ eclipse/ halo/
    api/
      lumen/                   chat, conversations
      users/select/            set or clear the profile cookie
  components/                  shared across apps: AppLauncher, ComingSoon, MessageContent, CodeBlock
  config/
    apps.ts                    the list of apps the launcher shows
    models.ts                  Ollama models per page type
  hooks/                       shared React hooks
  lib/                         server code: db, users, memory, prompts, GPU queue
  public/brand/                the locked Artemis banners
  data/                        SQLite databases (not in git)
services/                      backends that aren't part of the Next app
  prism/workflows/             ComfyUI workflows for Prism
```

## Adding an app

1. Add an entry to `apps/suite/config/apps.ts`.
2. Create `apps/suite/app/(apps)/<id>/page.tsx`. Start with `<ComingSoon appId="<id>" />`.
3. Put its banner in `apps/suite/public/brand/<id>.png`.

App-only components go in that app's `_components/` folder; anything two apps use goes in `apps/suite/components/`. API routes go under `app/api/<id>/`.

Heavy backends (image generation for Prism, for example) go in `services/<name>/` as their own process. The Next app calls them over HTTP.

## Data and secrets

SQLite files live in `apps/suite/data/` and are gitignored. `.env` files are gitignored. Model weights stay in Ollama's and ComfyUI's own folders.

## License

MIT. See [LICENSE](LICENSE).
