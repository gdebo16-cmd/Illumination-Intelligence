"""Eclipse stub.

Uvicorn entrypoint, from apps/eclipse:

    uvicorn app.main:app --host 0.0.0.0 --port 8003 --reload

From the repo root, `make eclipse` runs the same module.
"""

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

BRAND_SLUG = "eclipse"
BRAND_NAME = "Eclipse"
PORT = 8003

APP_ROOT = Path(__file__).resolve().parents[1]
SUITE_ROOT = APP_ROOT.parents[1]

app = FastAPI(
    title=BRAND_NAME,
    summary="Illumination Intelligence stub. Product not defined.",
    version="0.0.0",
)

app.mount("/static", StaticFiles(directory=APP_ROOT / "static"), name="static")
app.mount(
    "/design-tokens",
    StaticFiles(directory=SUITE_ROOT / "packages" / "design-tokens"),
    name="design-tokens",
)
app.mount(
    "/shared-ui",
    StaticFiles(directory=SUITE_ROOT / "packages" / "shared-ui"),
    name="shared-ui",
)

templates = Jinja2Templates(directory=APP_ROOT / "templates")


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "brand": BRAND_SLUG, "port": PORT}


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(
        request=request,
        name="index.html",
        context={
            "brand_slug": BRAND_SLUG,
            "brand_name": BRAND_NAME,
            "port": PORT,
        },
    )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT)
