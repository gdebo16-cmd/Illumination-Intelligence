# Architecture

Illumination Intelligence is Gabriel DeBoer's suite of separate products. They share a name, a visual system, and a way of being started. They do not share a process. This repository is a monorepo so the shared pieces have one home while each brand stays runnable on its own.

Lumen is the local chat app. Prism is an art-studio shell with its locked banner and no image backend yet. Umbra, Eclipse, and Halo are stubs with their locked banners in place and no product behind them. App folder names stay `lumen`, `umbra`, `prism`, `eclipse`, and `halo`.

## Why a monorepo

Lumen talks to a local chat model through Ollama. Prism will eventually talk to an image backend. Umbra, Eclipse, and Halo do not have a product definition yet. One FastAPI process for all of them would couple those futures: a generation job in Prism would share a dependency set and a failure domain with chat in Lumen.

Separate repositories would drop the shared port map, the color tokens, and the locked banner set into five places. The parts that are shared are file-shaped:

- One port per brand, and one uvicorn module, `app.main:app`.
- Color tokens in `packages/design-tokens`.
- The locked Artemis banners in `packages/design-tokens/banners/`, copied into each app as `static/banner.png`.
- The hello-page shell in `packages/shared-ui`. Lumen keeps its own chat layout.
- The license, the gitignore, and these notes.

A monorepo keeps that sharing as files. Each app still has its own `requirements.txt`, so Lumen’s Ollama client is not a dependency of Prism, and a later imaging stack in Prism is not installed for the others. There is no JavaScript workspace. The apps are Python services, and the root `Makefile` is the only cross-app tool.

## Layout

| Path | Role |
| --- | --- |
| `apps/lumen` | Lumen Intelligence. `app/main.py`, chat template, static assets, `start-hermes.bat`. |
| `apps/<other brand>` | FastAPI shell. Owns `app/main.py`, `templates/`, `static/banner.png`, and `requirements.txt`. |
| `packages/design-tokens` | `tokens.css`, `tokens.json`, and `banners/` for the locked Artemis masters. |
| `packages/shared-ui` | Shell and banner CSS for the hello pages. Not a component library. |
| `docs/` | Suite notes. Product intent lives in the app README. |

At startup each shell mounts:

- `/static` → `apps/<brand>/static`
- `/design-tokens` → `packages/design-tokens`
- `/shared-ui` → `packages/shared-ui`

Lumen mounts only `/static`. Paths are resolved from `__file__`, so `make lumen` from the repo root and `uvicorn` from `apps/lumen` serve the same files.

## Ports

Local defaults, in suite order. Treat them as a contract.

| Brand | Port | Uvicorn entrypoint |
| --- | --- | --- |
| Lumen | 8000 | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` |
| Umbra | 8001 | `uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload` |
| Prism | 8002 | `uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload` |
| Eclipse | 8003 | `uvicorn app.main:app --host 0.0.0.0 --port 8003 --reload` |
| Halo | 8004 | `uvicorn app.main:app --host 0.0.0.0 --port 8004 --reload` |

Conventions:

- The next brand takes **8005**, then the next integer. In that same change, set `PORT` in `app/main.py`, add the `Makefile` target, and update the tables in the root `README.md` and in this file.
- Bind `0.0.0.0`, so the same command works on a remote dev host. The port in the table is the local default for that brand.
- Do not take 3000 or 5173. Those read as Node dev servers. This suite is Python.
- One process per brand. Do not add a gateway until more than one real app needs it.
- `GET /health` returns `{"status":"ok","brand":"<slug>","port":<port>}` so a check can confirm the right app is bound.

From the app directory the working directory must be `apps/<brand>` so Python imports the `app` package. `make <brand>` passes `--app-dir` and is the command to use from the repo root. Both invoke the same module. Lumen’s Windows launcher `apps/lumen/start-hermes.bat` starts that same module on port 8000.

## How to add an app

1. Copy an existing stub (`apps/halo` is the smallest) to `apps/<slug>`. Use a short lowercase directory name.
2. Set `BRAND_SLUG`, `BRAND_NAME`, and `PORT` in `app/main.py`. Take the next port, from 8005 up.
3. Rewrite the hello copy in `templates/index.html`, the tint in `static/brand.css`, and the product paragraph in `README.md`. If the product is not defined, say that in one paragraph. Do not invent a product to fill the folder.
4. Add a `[data-brand="<slug>"]` block to `packages/design-tokens/tokens.css` and a matching object in `tokens.json`.
5. Add a `make <slug>` target. Include the app in the `APPS` list so `make install` and `make check` see it.
6. Add a row to the root README map and to the port table in this file.

Keep the uvicorn entrypoint as `app.main:app`. Do not invent a second module layout for one brand.

## What stays out

- Secrets. Nothing in the tree is a credential. `.env` is gitignored. Lumen talks to local Ollama and does not take a key.
- Model weights and generated files. `models/`, `outputs/`, and the weight globs in `.gitignore` cover them. Ollama keeps its own models outside this repo.
- Art that is not part of the locked set. Root `/banners/` and `/art/` are gitignored. The locked marks are already in `packages/design-tokens/banners/` and `apps/<brand>/static/banner.png`.
