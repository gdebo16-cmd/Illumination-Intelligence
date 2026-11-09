# Illumination Intelligence — start one brand from the repo root.
# Ports are a contract. See docs/architecture.md before adding another app.

PYTHON ?= python3
HOST ?= 0.0.0.0
VENV := .venv
BIN := $(VENV)/bin
APPS := lumen umbra prism eclipse halo
REQS := $(foreach app,$(APPS),apps/$(app)/requirements.txt)

.PHONY: help install check lumen umbra prism eclipse halo

help:
	@printf '%s\n' \
		'Illumination Intelligence' \
		'' \
		'  make install     create .venv and install each app requirements.txt' \
		'  make check       import every FastAPI app' \
		'  make lumen       port 8000    uvicorn app.main:app' \
		'  make umbra       port 8001    uvicorn app.main:app' \
		'  make prism       port 8002    uvicorn app.main:app' \
		'  make eclipse     port 8003    uvicorn app.main:app' \
		'  make halo        port 8004    uvicorn app.main:app' \
		'' \
		'Bind address defaults to 0.0.0.0. Override with: HOST=127.0.0.1 make prism'

$(BIN)/python:
	$(PYTHON) -m venv $(VENV)
	$(BIN)/python -m pip install --upgrade pip

$(VENV)/.installed: $(BIN)/python $(REQS)
	@for app in $(APPS); do \
		$(BIN)/python -m pip install -r apps/$$app/requirements.txt; \
	done
	@touch $(VENV)/.installed

install: $(VENV)/.installed

check: $(VENV)/.installed
	@for app in $(APPS); do \
		( cd apps/$$app && ../../$(BIN)/python -c "from app.main import PORT, app; assert app.title and PORT" ); \
		echo "ok $$app"; \
	done

lumen: $(VENV)/.installed
	$(BIN)/uvicorn app.main:app --app-dir apps/lumen --host $(HOST) --port 8000 --reload

umbra: $(VENV)/.installed
	$(BIN)/uvicorn app.main:app --app-dir apps/umbra --host $(HOST) --port 8001 --reload

prism: $(VENV)/.installed
	$(BIN)/uvicorn app.main:app --app-dir apps/prism --host $(HOST) --port 8002 --reload

eclipse: $(VENV)/.installed
	$(BIN)/uvicorn app.main:app --app-dir apps/eclipse --host $(HOST) --port 8003 --reload

halo: $(VENV)/.installed
	$(BIN)/uvicorn app.main:app --app-dir apps/halo --host $(HOST) --port 8004 --reload
