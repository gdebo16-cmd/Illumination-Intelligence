# Illumination Intelligence

Gabriel DeBoer's suite of local AI apps: Lumen, Prism, Umbra, Astra, Eclipse, and Halo. They all live in one Next.js app, `apps/suite`, with one route per product. A nine-dot launcher in the top-right of every app switches between them.

Working apps:

- **Lumen**: local chat through Ollama. With a model that can see images, an add-photo button appears in the message box.
- **Prism**: image studio. Makes pictures with ComfyUI (FLUX.2 Klein 4B), with art styles and shapes. ComfyUI must be running (`run_nvidia_gpu.bat`).
- **Umbra**: agent bots. Create bots with a flame avatar, a personality, a purpose and a local model, then chat with them. (Stage 1 of 4: tools, background tasks and teams come next.)

Photos in chat (Lumen and a Flicker's chat in Umbra): the add-photo button only shows for models listed in `VISION_MODELS` in `apps/suite/config/models.ts`. Add a model's id there when you install one that can see images.

Astra, Eclipse and Halo are "coming soon" pages until they're built.

Lumen, Prism and Umbra share one graphics card; `lib/queue.ts` unloads one engine's model before the other runs.

To remake generated art: `node scripts/make-icons.mjs` (home-screen icons) and `scripts/make-flame-sprites.py` (Umbra's flames; run it with ComfyUI's Python, see the file).

## Run

Needs Node 22.5 or newer (the database uses the built-in `node:sqlite`). Chat needs Ollama running on this machine.

First time only:

```bash
npm run install:suite
```

There are two ways to run it, on different ports so both can run at once:

| Mode | Command | Port | Use it for |
| --- | --- | --- | --- |
| Production | `npm run prod` | 3000 | Everyday use, on this PC and on your phone. Fast and stable. |
| Development | `npm run dev` | 3001 | Working on the code. Changes show up instantly. |

`npm run prod` builds the app, then starts it. After changing code, stop it (Ctrl+C) and run it again so the phone gets the new version. `npm run start` restarts the last build without rebuilding.

Open `http://localhost:3000` (production) or `http://localhost:3001` (development). You'll pick a profile, then land on Lumen.

## Phone access (Tailscale)

The production app is shared privately through Tailscale at **https://illumination.shrimp-bitterling.ts.net**. Only devices signed in to the same Tailscale account can open it. Tailscale Serve forwards that address to port 3000 and stays on across restarts; the app itself has to be running (`npm run prod`).

To stop sharing: `tailscale serve --https=443 off`. ComfyUI and Ollama are never shared; only the suite's pages are.

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
