"use client";

// The SSH terminal in Refract's main pane: xterm.js in the browser, talking over a WebSocket to the
// suite server, which holds the one SSH session to the Refract VM (lib/refract/terminal.ts).

import { useCallback, useEffect, useRef, useState } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

type Phase = "idle" | "connecting" | "connected" | "disconnected";

// Browser-side flow control: ask the server to pause when xterm has this much output still to draw.
const WRITE_HIGH_WATER = 256 * 1024;
const WRITE_LOW_WATER = 32 * 1024;

const KEYS: { label: string; title: string; seq: string }[] = [
  { label: "Ctrl-C", title: "Interrupt (Ctrl-C)", seq: "\u0003" },
  { label: "Ctrl-D", title: "End of input (Ctrl-D)", seq: "\u0004" },
  { label: "Tab", title: "Tab", seq: "\t" },
  { label: "Esc", title: "Escape", seq: "\u001b" },
  { label: "\u2191", title: "Up arrow", seq: "\u001b[A" },
  { label: "\u2193", title: "Down arrow", seq: "\u001b[B" },
  { label: "\u2190", title: "Left arrow", seq: "\u001b[D" },
  { label: "\u2192", title: "Right arrow", seq: "\u001b[C" },
];

function terminalUrl(cols: number, rows: number): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/refract/terminal?cols=${cols}&rows=${rows}`;
}

export default function RefractTerminal({ vmState }: { vmState: string | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const autoTried = useRef(false);
  const manualClose = useRef(false);
  const [ready, setReady] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const send = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  // Create xterm once. It's loaded here (not at the top) because it needs the browser.
  useEffect(() => {
    let disposed = false;
    let observer: ResizeObserver | null = null;
    let term: Terminal | null = null;
    (async () => {
      const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
      if (disposed || !hostRef.current) return;
      term = new Terminal({
        cursorBlink: true,
        convertEol: false,
        fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 13,
        scrollback: 3000,
        theme: { background: "#0b0d12", foreground: "#e5e7f0", cursor: "#ffd9a8", selectionBackground: "#3a4257" },
      });
      const fit = new FitAddon();
      term.loadAddon(fit);
      term.open(hostRef.current);
      try {
        fit.fit();
      } catch {}
      termRef.current = term;
      fitRef.current = fit;
      term.onData((data) => send({ t: "i", d: data }));
      term.onResize(({ cols, rows }) => send({ t: "r", c: cols, r: rows }));
      observer = new ResizeObserver(() => {
        try {
          fit.fit();
        } catch {}
      });
      observer.observe(hostRef.current);
      setReady(true);
    })();
    return () => {
      disposed = true;
      observer?.disconnect();
      wsRef.current?.close();
      wsRef.current = null;
      term?.dispose();
      termRef.current = null;
    };
  }, [send]);

  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term) return;
    manualClose.current = false;
    wsRef.current?.close();
    setPhase("connecting");
    setMessage(null);
    term.reset();
    try {
      fitRef.current?.fit();
    } catch {}

    const ws = new WebSocket(terminalUrl(term.cols, term.rows));
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    let pendingWrites = 0;
    let paused = false;
    let serverMessage: string | null = null;
    let opened = false;

    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      if (event.data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(event.data);
        pendingWrites += bytes.length;
        if (!paused && pendingWrites > WRITE_HIGH_WATER) {
          paused = true;
          ws.send(JSON.stringify({ t: "p" }));
        }
        term.write(bytes, () => {
          pendingWrites -= bytes.length;
          if (paused && pendingWrites < WRITE_LOW_WATER) {
            paused = false;
            if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ t: "g" }));
          }
        });
        return;
      }
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.t === "s" && msg.s === "connected") {
          setPhase("connected");
          term.focus();
        } else if (msg.t === "s" && msg.s === "closed") {
          serverMessage = typeof msg.m === "string" ? msg.m : null;
        }
      } catch {}
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      setPhase("disconnected");
      const manual = manualClose.current;
      manualClose.current = false;
      setMessage(manual ? "Disconnected." : serverMessage ?? (opened ? "The connection to the terminal was lost." : "Couldn't open the terminal."));
    };
  }, []);

  // Open a session on its own the first time the VM is seen running; after that, Reconnect is manual.
  useEffect(() => {
    if (!ready || autoTried.current || vmState !== "running") return;
    autoTried.current = true;
    connect();
  }, [ready, vmState, connect]);

  const disconnect = () => {
    manualClose.current = true;
    wsRef.current?.close();
  };

  const pressKey = (seq: string) => {
    send({ t: "i", d: seq });
    termRef.current?.focus();
  };

  const vmOff = vmState !== null && vmState !== "running";
  let statusText: string;
  if (phase === "connecting") statusText = "Connecting\u2026";
  else if (phase === "connected") statusText = "Connected";
  else if (vmOff && phase !== "disconnected") statusText = "The virtual machine isn\u2019t running, so the terminal can\u2019t connect.";
  else if (phase === "disconnected" && vmOff) statusText = "Disconnected. The virtual machine isn\u2019t running.";
  else if (phase === "disconnected") statusText = message ?? "Disconnected";
  else statusText = "Not connected";

  return (
    <section className={`refract-terminal is-${phase}`} aria-label="Terminal">
      <div className="refract-terminal-bar">
        <span className={`refract-terminal-dot is-${phase}`} aria-hidden="true" />
        <span className="refract-terminal-status" role="status" aria-live="polite">
          {statusText}
        </span>
        {phase === "connected" ? (
          <button type="button" className="refract-terminal-action" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="refract-terminal-action"
            disabled={!ready || phase === "connecting"}
            onClick={connect}
          >
            {phase === "disconnected" ? "Reconnect" : "Connect"}
          </button>
        )}
      </div>
      <div className="refract-terminal-screen" ref={hostRef} />
      <div className="refract-terminal-keys" aria-label="Terminal keys">
        {KEYS.map((key) => (
          <button
            key={key.label}
            type="button"
            className="refract-terminal-key"
            title={key.title}
            aria-label={key.title}
            disabled={phase !== "connected"}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => pressKey(key.seq)}
          >
            {key.label}
          </button>
        ))}
      </div>
    </section>
  );
}
