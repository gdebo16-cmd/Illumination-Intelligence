"""Prism stub.

Uvicorn entrypoint, from apps/prism:

    uvicorn app.main:app --host 0.0.0.0 --port 8002 --reload

From the repo root, `make prism` runs the same module.
"""
import asyncio
import json
from urllib.request import Request as URLRequest, urlopen

from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from urllib.parse import urlencode
from fastapi.responses import Response

BRAND_SLUG = "prism"
BRAND_NAME = "Prism"
PORT = 8002

APP_ROOT = Path(__file__).resolve().parents[1]
SUITE_ROOT = APP_ROOT.parents[1]

WORKFLOW_PATH = APP_ROOT / "klein-workflow.json"


def load_workflow(prompt: str) -> dict:
    with WORKFLOW_PATH.open(encoding="utf-8") as file:
        workflow = json.load(file)

    workflow["4"]["inputs"]["text"] = prompt
    return workflow

app = FastAPI(
    title=BRAND_NAME,
    summary="Art studio shell for Illumination Intelligence. No image backend yet.",
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

class GenerateRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)

@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "brand": BRAND_SLUG, "port": PORT}

@app.get("/engine/health")
async def engine_health():
    def check_engine():
        with urlopen(
            "http://127.0.0.1:8188/system_stats", timeout=5
        ) as response:
            return json.load(response)

    try:
        stats = await asyncio.to_thread(check_engine)
        return {"connected": True, "devices": stats.get("devices", [])}
    except Exception:
        return {"connected": False, "message": "Cannot reach ComfyUI."}


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


@app.post("/generate")
async def generate(body: GenerateRequest):
    workflow = load_workflow(body.prompt)

    def submit():
        payload = json.dumps({"prompt": workflow}).encode("utf-8")
        request = URLRequest(
            "http://127.0.0.1:8188/prompt",
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urlopen(request, timeout=15) as response:
            return json.load(response)

    result = await asyncio.to_thread(submit)
    return {"prompt_id": result["prompt_id"]}

@app.get("/generation/{prompt_id}")
async def generation_status(prompt_id: str):
    def check():
        with urlopen(
            f"http://127.0.0.1:8188/history/{prompt_id}",
            timeout=10,
        ) as response:
            return json.load(response)

    history = await asyncio.to_thread(check)
    job = history.get(prompt_id)
    if not job:
        return {"status": "pending"}

    images = job.get("outputs", {}).get("13", {}).get("images", [])
    if images:
        return {"status": "completed", "images": images}

    return {"status": job.get("status", {})}

@app.get("/generation-image")
async def generation_image(
    filename: str,
    subfolder: str = "",
    type: str = "output",
):
    def fetch_image():
        query = urlencode({
            "filename": filename,
            "subfolder": subfolder,
            "type": type,
        })
        with urlopen(
            f"http://127.0.0.1:8188/view?{query}", timeout=30
        ) as response:
            return (
                response.read(),
                response.headers.get_content_type(),
            )

    content, media_type = await asyncio.to_thread(fetch_image)
    return Response(content=content, media_type=media_type)

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, reload=True)
