# Halo

Halo is a sibling brand in Illumination Intelligence. Its product is not defined, so this directory holds the shared shell: a FastAPI hello page and the locked gold banner. Do not grow a feature here until a product paragraph replaces this one.

Default port: **8004**. The page shows `static/banner.png`. The master is `packages/design-tokens/banners/halo.png`.

## Run

From the repo root:

```bash
make halo
```

Uvicorn entrypoint, from `apps/halo`, with the suite virtualenv active:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8004 --reload
```

`make halo` runs that module with `--app-dir apps/halo`. `GET /health` reports `{"status":"ok","brand":"halo","port":8004}`.
