"""Lumen Intelligence.

Local chat for the Illumination Intelligence suite. The model runs through
Ollama on this machine.

Uvicorn entrypoint, from apps/lumen:

    uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload

From the repo root, `make lumen` runs the same module. On Windows,
`start-hermes.bat` starts Ollama if needed and then this module.
"""

from pathlib import Path

import ollama
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

BRAND_SLUG = "lumen"
BRAND_NAME = "Lumen"
PORT = 8000

APP_ROOT = Path(__file__).resolve().parents[1]

app = FastAPI(
    title=BRAND_NAME,
    summary="Lumen Intelligence. Local chat in the Illumination Intelligence suite.",
    version="0.0.0",
)

engine = create_engine('sqlite:///lumen.sqlite3')
Session = sessionmaker(bind=engine)

@app.get('/api/get_messages')
def get_messages():
    session = Session()
    messages = session.query(Message).filter(Message.thread_id.notin_(session.query(Thread.id).filter(Thread.archived_at.isnot(None)))).all()
    return messages

@app.post('/api/create_message')
def create_message(message_text: str):
    # Create a new message with the given text
    message = Message(text=message_text)
    db.session.add(message)
    db.session.commit()
    return {'message': message.id}

app.mount("/static", StaticFiles(directory=APP_ROOT / "static"), name="static")
templates = Jinja2Templates(directory=APP_ROOT / "templates")

# Global conversation history array
chat_history = []
# Safety threshold: roughly 12,000 characters is a safe threshold before context shifts block VRAM
VRAM_WARNING_THRESHOLD = 12000


class ChatRequest(BaseModel):
    message: str
    model: str


@app.get("/health")
async def health() -> dict[str, object]:
    return {"status": "ok", "brand": BRAND_SLUG, "port": PORT}


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


@app.post("/chat")
async def chat(payload: ChatRequest):
    global chat_history
    try:
        # Append the new user message to local memory
        chat_history.append({"role": "user", "content": payload.message})

        # Calculate approximate character length of current conversation session
        current_context_size = sum(len(msg["content"]) for msg in chat_history)
        vram_warning = current_context_size > VRAM_WARNING_THRESHOLD

        client = ollama.AsyncClient()
        # Feed the entire history so the bot maintains context memory
        response = await client.chat(model=payload.model, messages=chat_history)

        bot_reply = response["message"]["content"]
        # Append bot reply to memory
        chat_history.append({"role": "assistant", "content": bot_reply})

        return {
            "response": bot_reply,
            "vram_warning": vram_warning,
            "context_size": current_context_size,
        }

    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Ollama Error: {str(e)}"
        )


# New Endpoint: Wipes out the current array memory
@app.post("/clear")
def clear_history():
    global chat_history
    chat_history.clear()
    return {"status": "success", "message": "Chat memory cleared"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=PORT, reload=True)
