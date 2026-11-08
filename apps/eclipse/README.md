# Eclipse

Eclipse is a sibling brand in Illumination Intelligence. Its product is not defined, so this directory holds the shared shell: a FastAPI hello page and the locked red banner. Do not grow a feature here until a product paragraph replaces this one.

Default port: **8003**. The page shows `static/banner.png`. The master is `packages/design-tokens/banners/eclipse.png`.

## Run

From the repo root:

```bash
make eclipse
```

Uvicorn entrypoint, from `apps/eclipse`, with the suite virtualenv active:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8003 --reload
```

`make eclipse` runs that module with `--app-dir apps/eclipse`. `GET /health` reports `{"status":"ok","brand":"eclipse","port":8003}`.
