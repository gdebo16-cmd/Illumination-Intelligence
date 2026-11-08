# Prism

Prism is the image generator and art studio in Illumination Intelligence. The planned shape is a FastAPI interface with a local generation backend behind it — ComfyUI or Diffusers, not chosen yet. This shell does not load a model, call a GPU, or write images. It serves the studio hello page and the locked Artemis banner.

Default port: **8002**. Prismatic colors (violet, cyan, magenta, amber) come from `packages/design-tokens`. The banner file the page shows is `static/banner.png`. The master copy is `packages/design-tokens/banners/prism.png`.

## Run

From the repo root:

```bash
make prism
```

Uvicorn entrypoint, from `apps/prism`, with the suite virtualenv active:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload
```

`make prism` runs that module with `--app-dir apps/prism`. Open `http://127.0.0.1:8002`. `GET /health` reports `{"status":"ok","brand":"prism","port":8002}`.

Generated files belong in `outputs/`, which is gitignored, once a backend exists. They do not belong in this shell.
