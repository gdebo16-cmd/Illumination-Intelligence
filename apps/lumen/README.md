# Lumen

Lumen Intelligence is the local chat app in Illumination Intelligence: a conversation with a model that runs on this machine through Ollama. This directory is that app. `app/main.py` serves the chat page, keeps the session in memory, and posts each turn to Ollama. Static files, the VRAM warning, and the mobile keyboard fit live under `static/` and `templates/`.

The locked Artemis banner is `static/banner.png`. The home-screen icon is `static/apple-touch-icon.png`.

Default port: **8000**.

## Run

Ollama needs to be running on this machine before a message can be answered. Model weights stay in Ollama’s own store. They are not committed here. There is no `.env` and no API key in this app; the client uses the local Ollama default.

From the repo root:

```bash
make lumen
```

Uvicorn entrypoint, from `apps/lumen`, with the suite virtualenv active:

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

`make lumen` runs that module with `--app-dir apps/lumen`. `GET /health` reports `{"status":"ok","brand":"lumen","port":8000}`. `POST /chat` takes `{"message","model"}`. `POST /clear` wipes the in-memory history.

On Windows, `start-hermes.bat` in this directory starts Ollama if it is not already up, then starts `app.main:app` on port 8000. Pass `/nobrowser` to skip opening the browser.
