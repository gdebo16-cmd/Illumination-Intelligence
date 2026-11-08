# Illumination Intelligence

Monorepo for Gabriel DeBoer's Illumination Intelligence suite. Lumen is the local chat app. Prism, Umbra, Eclipse, and Halo are branded shells. Folder names stay `lumen`, `umbra`, `prism`, `eclipse`, and `halo`.

Python 3.11 or newer. Development here uses 3.12. There is no Node workspace. Each app is a separate process with its own `requirements.txt`. The root `Makefile` is how you start one.

## Run one app

From the repo root:

```bash
make install
make lumen
```

Lumen listens on port **8000**. Open `http://127.0.0.1:8000`. Chat needs Ollama running on the machine. The page, the locked banner, and `POST /clear` work without it. `POST /chat` returns an Ollama error until the daemon is up. No API key is used.

Prism, the art-studio shell:

```bash
make prism
```

Prism listens on port **8002** and shows the locked Prism banner. It does not generate images.

`make install` creates `.venv` at the repo root and installs every app's `requirements.txt`. Later `make` targets reuse that environment.

The same entrypoint, with the virtualenv active and the shell in the app directory:

```bash
source .venv/bin/activate
cd apps/lumen
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

Every brand uses the module `app.main:app`. `make lumen` passes `--app-dir apps/lumen`, so you can stay at the repo root.

| App | Port | From the repo root | Uvicorn, from `apps/<name>` |
| --- | --- | --- | --- |
| Lumen | 8000 | `make lumen` | `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload` |
| Umbra | 8001 | `make umbra` | `uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload` |
| Prism | 8002 | `make prism` | `uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload` |
| Eclipse | 8003 | `make eclipse` | `uvicorn app.main:app --host 0.0.0.0 --port 8003 --reload` |
| Halo | 8004 | `make halo` | `uvicorn app.main:app --host 0.0.0.0 --port 8004 --reload` |

`make check` imports each app and confirms it loads. One brand at a time for the servers: they are separate products and bind different ports.

## Map

```
apps/lumen/      Lumen Intelligence — local chat via Ollama
apps/umbra/      sibling stub, product not defined, locked banner
apps/prism/      art studio shell, locked banner, no generator yet
apps/eclipse/    sibling stub, product not defined, locked banner
apps/halo/       sibling stub, product not defined, locked banner
packages/design-tokens/   colors, plus banners/ for the locked Artemis set
packages/shared-ui/       hello-page shell used by the stubs
docs/architecture.md      why this is a monorepo, ports, how to add an app
```

Read `docs/architecture.md` before adding a sixth app. The short version: copy a stub, take port 8005 or the next free integer, add the brand tokens, and record the port in the Makefile, the app, and this table.

## Art and weights

The Artemis banner set is locked and committed. Each app shows `apps/<brand>/static/banner.png`. The masters and the contact sheet are in `packages/design-tokens/banners/`. A new drop that is not part of this lock stays out: `/banners/` and `/art/` at the repo root are gitignored.

`models/` and `outputs/` are gitignored. Local weights and generated files do not belong in git. No secrets are stored here. `.env` is gitignored, and this repo does not ship an env file.

## License

MIT. See [LICENSE](LICENSE).
