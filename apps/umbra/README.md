# Umbra

Umbra is a sibling brand in Illumination Intelligence. Its product is not defined, so this directory holds the shared shell: a FastAPI hello page and the locked maroon banner. Do not grow a feature here until a product paragraph replaces this one.

Default port: **8001**. The page shows `static/banner.png`. The master is `packages/design-tokens/banners/umbra.png`.

## Run

From the repo root:

```bash
make umbra
```

Uvicorn entrypoint, from `apps/umbra`, with the suite virtualenv active:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

`make umbra` runs that module with `--app-dir apps/umbra`. `GET /health` reports `{"status":"ok","brand":"umbra","port":8001}`.
