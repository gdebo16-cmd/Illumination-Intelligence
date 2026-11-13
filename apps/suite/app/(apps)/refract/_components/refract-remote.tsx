"use client";

// The virtual remote in Refract's main pane: the VM's actual screen (VirtualBox's built-in remote
// display) drawn on a canvas, with keyboard and basic mouse input. The browser only talks to the
// suite server over a WebSocket (lib/refract/remote.ts); the server holds the RDP connection.
// The SSH terminal stays the everyday tool; this is for boot, installers, hangs and recovery.

import { useCallback, useEffect, useRef, useState } from "react";
import type { FormEvent, KeyboardEvent, PointerEvent } from "react";

type Phase = "idle" | "connecting" | "connected" | "disconnected" | "off";

/** A PS/2 set-1 scancode and whether it's an extended (E0) key. */
type Stroke = [code: number, extended: boolean];

// KeyboardEvent.code -> scancode. Physical keys, so any keyboard layout types what the guest expects for US.
const CODES: Record<string, Stroke> = {
  Escape: [0x01, false], Digit1: [0x02, false], Digit2: [0x03, false], Digit3: [0x04, false],
  Digit4: [0x05, false], Digit5: [0x06, false], Digit6: [0x07, false], Digit7: [0x08, false],
  Digit8: [0x09, false], Digit9: [0x0a, false], Digit0: [0x0b, false], Minus: [0x0c, false],
  Equal: [0x0d, false], Backspace: [0x0e, false], Tab: [0x0f, false], KeyQ: [0x10, false],
  KeyW: [0x11, false], KeyE: [0x12, false], KeyR: [0x13, false], KeyT: [0x14, false],
  KeyY: [0x15, false], KeyU: [0x16, false], KeyI: [0x17, false], KeyO: [0x18, false],
  KeyP: [0x19, false], BracketLeft: [0x1a, false], BracketRight: [0x1b, false], Enter: [0x1c, false],
  ControlLeft: [0x1d, false], KeyA: [0x1e, false], KeyS: [0x1f, false], KeyD: [0x20, false],
  KeyF: [0x21, false], KeyG: [0x22, false], KeyH: [0x23, false], KeyJ: [0x24, false],
  KeyK: [0x25, false], KeyL: [0x26, false], Semicolon: [0x27, false], Quote: [0x28, false],
  Backquote: [0x29, false], ShiftLeft: [0x2a, false], Backslash: [0x2b, false], KeyZ: [0x2c, false],
  KeyX: [0x2d, false], KeyC: [0x2e, false], KeyV: [0x2f, false], KeyB: [0x30, false],
  KeyN: [0x31, false], KeyM: [0x32, false], Comma: [0x33, false], Period: [0x34, false],
  Slash: [0x35, false], ShiftRight: [0x36, false], NumpadMultiply: [0x37, false], AltLeft: [0x38, false],
  Space: [0x39, false], CapsLock: [0x3a, false], F1: [0x3b, false], F2: [0x3c, false],
  F3: [0x3d, false], F4: [0x3e, false], F5: [0x3f, false], F6: [0x40, false],
  F7: [0x41, false], F8: [0x42, false], F9: [0x43, false], F10: [0x44, false],
  NumLock: [0x45, false], ScrollLock: [0x46, false], Numpad7: [0x47, false], Numpad8: [0x48, false],
  Numpad9: [0x49, false], NumpadSubtract: [0x4a, false], Numpad4: [0x4b, false], Numpad5: [0x4c, false],
  Numpad6: [0x4d, false], NumpadAdd: [0x4e, false], Numpad1: [0x4f, false], Numpad2: [0x50, false],
  Numpad3: [0x51, false], Numpad0: [0x52, false], NumpadDecimal: [0x53, false], IntlBackslash: [0x56, false],
  F11: [0x57, false], F12: [0x58, false],
  NumpadEnter: [0x1c, true], ControlRight: [0x1d, true], NumpadDivide: [0x35, true], PrintScreen: [0x37, true],
  AltRight: [0x38, true], Home: [0x47, true], ArrowUp: [0x48, true], PageUp: [0x49, true],
  ArrowLeft: [0x4b, true], ArrowRight: [0x4d, true], End: [0x4f, true], ArrowDown: [0x50, true],
  PageDown: [0x51, true], Insert: [0x52, true], Delete: [0x53, true], MetaLeft: [0x5b, true],
  MetaRight: [0x5c, true], ContextMenu: [0x5d, true],
};

// KeyboardEvent.key -> code name, for on-screen keyboards that don't report physical keys.
const NAMED_KEYS: Record<string, string> = {
  Backspace: "Backspace", Enter: "Enter", Tab: "Tab", Escape: "Escape", Delete: "Delete",
  ArrowUp: "ArrowUp", ArrowDown: "ArrowDown", ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
  Home: "Home", End: "End", PageUp: "PageUp", PageDown: "PageDown", Insert: "Insert",
  F1: "F1", F2: "F2", F3: "F3", F4: "F4", F5: "F5", F6: "F6", F7: "F7", F8: "F8", F9: "F9",
  F10: "F10", F11: "F11", F12: "F12",
};

const MODIFIER_CODES = new Set(["ControlLeft", "ControlRight", "AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight", "CapsLock"]);

const SHIFTED_DIGITS = ")!@#$%^&*(";
const SYMBOLS: Record<string, [string, boolean]> = {
  "-": ["Minus", false], _: ["Minus", true], "=": ["Equal", false], "+": ["Equal", true],
  "[": ["BracketLeft", false], "{": ["BracketLeft", true], "]": ["BracketRight", false], "}": ["BracketRight", true],
  "\\": ["Backslash", false], "|": ["Backslash", true], ";": ["Semicolon", false], ":": ["Semicolon", true],
  "'": ["Quote", false], '"': ["Quote", true], "`": ["Backquote", false], "~": ["Backquote", true],
  ",": ["Comma", false], "<": ["Comma", true], ".": ["Period", false], ">": ["Period", true],
  "/": ["Slash", false], "?": ["Slash", true], " ": ["Space", false], "\n": ["Enter", false], "\t": ["Tab", false],
};

/** A typed character -> the US-layout key and whether Shift is needed. Null for characters a US keyboard can't type. */
function charKey(ch: string): [string, boolean] | null {
  if (/^[a-z]$/.test(ch)) return [`Key${ch.toUpperCase()}`, false];
  if (/^[A-Z]$/.test(ch)) return [`Key${ch}`, true];
  if (/^[0-9]$/.test(ch)) return [`Digit${ch}`, false];
  const shiftedDigit = SHIFTED_DIGITS.indexOf(ch);
  if (shiftedDigit >= 0) return [`Digit${shiftedDigit}`, true];
  if (ch === "\u2018" || ch === "\u2019") return ["Quote", false]; // iOS smart quotes
  if (ch === "\u201c" || ch === "\u201d") return ["Quote", true];
  return SYMBOLS[ch] ?? null;
}

const KEY_ROW: { label: string; title: string; code: string }[] = [
  { label: "Esc", title: "Escape", code: "Escape" },
  { label: "Tab", title: "Tab", code: "Tab" },
  { label: "Enter", title: "Enter", code: "Enter" },
  { label: "\u2190", title: "Left arrow", code: "ArrowLeft" },
  { label: "\u2191", title: "Up arrow", code: "ArrowUp" },
  { label: "\u2193", title: "Down arrow", code: "ArrowDown" },
  { label: "\u2192", title: "Right arrow", code: "ArrowRight" },
  { label: "Del", title: "Delete", code: "Delete" },
  ...Array.from({ length: 12 }, (_, i) => ({ label: `F${i + 1}`, title: `F${i + 1}`, code: `F${i + 1}` })),
];

function remoteUrl(): string {
  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.host}/api/refract/remote`;
}

export default function RefractRemote({ vmState }: { vmState: string | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const manualClose = useRef(false);
  const phaseRef = useRef<Phase>("idle");
  // Physical keys held down: code -> whether the latched Ctrl/Alt were pressed with it.
  const pressed = useRef(new Map<string, { latched: { ctrl: boolean; alt: boolean } }>());
  const latchRef = useRef({ ctrl: false, alt: false });
  const cadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const moveFrame = useRef<number | null>(null);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const [phase, setPhaseState] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [latched, setLatched] = useState({ ctrl: false, alt: false });
  const [cadArmed, setCadArmed] = useState(false);
  const [focused, setFocused] = useState(false);

  const setPhase = useCallback((next: Phase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const send = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN && phaseRef.current === "connected") ws.send(JSON.stringify(payload));
  }, []);

  const sendStroke = useCallback(
    (stroke: Stroke, down: boolean) => send({ t: "k", c: stroke[0], e: stroke[1], d: down }),
    [send],
  );

  const setLatch = useCallback((next: { ctrl: boolean; alt: boolean }) => {
    latchRef.current = next;
    setLatched(next);
  }, []);

  /** Press and release one key, with Shift if needed and any latched Ctrl/Alt from the key row. */
  const tap = useCallback(
    (code: string, shift = false) => {
      const stroke = CODES[code];
      if (!stroke) return;
      const latch = latchRef.current;
      if (latch.ctrl) sendStroke(CODES.ControlLeft, true);
      if (latch.alt) sendStroke(CODES.AltLeft, true);
      if (shift) sendStroke(CODES.ShiftLeft, true);
      sendStroke(stroke, true);
      sendStroke(stroke, false);
      if (shift) sendStroke(CODES.ShiftLeft, false);
      if (latch.alt) sendStroke(CODES.AltLeft, false);
      if (latch.ctrl) sendStroke(CODES.ControlLeft, false);
      if (latch.ctrl || latch.alt) setLatch({ ctrl: false, alt: false });
    },
    [sendStroke, setLatch],
  );

  const releaseAll = useCallback(() => {
    for (const code of pressed.current.keys()) {
      const stroke = CODES[code];
      if (stroke) sendStroke(stroke, false);
    }
    pressed.current.clear();
    send({ t: "rel" });
  }, [send, sendStroke]);

  const drawFrame = useCallback((buffer: ArrayBuffer) => {
    const canvas = canvasRef.current;
    if (!canvas || buffer.byteLength < 8) return;
    const view = new DataView(buffer);
    const x = view.getUint16(0, true);
    const y = view.getUint16(2, true);
    const w = view.getUint16(4, true);
    const h = view.getUint16(6, true);
    if (!w || !h || buffer.byteLength !== 8 + w * h * 4) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.putImageData(new ImageData(new Uint8ClampedArray(buffer, 8, w * h * 4), w, h), x, y);
  }, []);

  const connect = useCallback(() => {
    manualClose.current = false;
    wsRef.current?.close();
    pressed.current.clear();
    setPhase("connecting");
    setMessage(null);

    const ws = new WebSocket(remoteUrl());
    ws.binaryType = "arraybuffer";
    wsRef.current = ws;
    let serverMessage: string | null = null;
    let serverSaysOff = false;
    let opened = false;

    ws.onopen = () => {
      opened = true;
    };
    ws.onmessage = (event) => {
      if (wsRef.current !== ws) return;
      if (event.data instanceof ArrayBuffer) {
        drawFrame(event.data);
        return;
      }
      try {
        const msg = JSON.parse(String(event.data));
        if (msg.t !== "s") return;
        if (msg.s === "connected") {
          const canvas = canvasRef.current;
          const w = Number(msg.w);
          const h = Number(msg.h);
          // Size the drawing surface to the VM's screen; CSS scales it to fit the pane.
          if (canvas && w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
            canvas.width = w;
            canvas.height = h;
          }
          setPhase("connected");
        } else if (msg.s === "off") {
          serverSaysOff = true;
          serverMessage = typeof msg.m === "string" ? msg.m : null;
        } else if (msg.s === "closed") {
          serverMessage = typeof msg.m === "string" ? msg.m : null;
        }
      } catch {}
    };
    ws.onclose = () => {
      if (wsRef.current !== ws) return;
      wsRef.current = null;
      pressed.current.clear();
      const manual = manualClose.current;
      manualClose.current = false;
      if (serverSaysOff) {
        setPhase("off");
        setMessage(null);
        return;
      }
      setPhase("disconnected");
      setMessage(
        manual
          ? "Disconnected."
          : serverMessage ?? (opened ? "The connection to the remote view was lost." : "Couldn\u2019t open the remote view."),
      );
    };
  }, [drawFrame, setPhase]);

  useEffect(() => {
    return () => {
      wsRef.current?.close();
      wsRef.current = null;
      if (cadTimer.current) clearTimeout(cadTimer.current);
      if (moveFrame.current !== null) cancelAnimationFrame(moveFrame.current);
    };
  }, []);

  const disconnect = () => {
    releaseAll();
    manualClose.current = true;
    wsRef.current?.close();
  };

  const focusInput = () => {
    inputRef.current?.focus({ preventScroll: true });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (phaseRef.current !== "connected") return;
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    // Leave the browser's own Cmd shortcuts alone on a Mac.
    if (event.metaKey && !event.ctrlKey) return;
    const stroke = CODES[event.code];
    if (stroke) {
      event.preventDefault();
      const held = pressed.current.get(event.code);
      if (!held) {
        const latch = MODIFIER_CODES.has(event.code) ? { ctrl: false, alt: false } : { ...latchRef.current };
        if (latch.ctrl) sendStroke(CODES.ControlLeft, true);
        if (latch.alt) sendStroke(CODES.AltLeft, true);
        pressed.current.set(event.code, { latched: latch });
      }
      sendStroke(stroke, true); // repeats are sent as more key-downs, like a real keyboard
      return;
    }
    // On-screen keyboards often report no physical key: fall back to the key's name or character.
    const named = NAMED_KEYS[event.key];
    if (named) {
      event.preventDefault();
      tap(named);
      return;
    }
    if (event.key.length === 1) {
      const mapped = charKey(event.key);
      if (mapped) {
        event.preventDefault();
        tap(mapped[0], mapped[1]);
      }
    }
  };

  const onKeyUp = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    const held = pressed.current.get(event.code);
    if (!held) return;
    event.preventDefault();
    pressed.current.delete(event.code);
    sendStroke(CODES[event.code], false);
    if (held.latched.alt) sendStroke(CODES.AltLeft, false);
    if (held.latched.ctrl) sendStroke(CODES.ControlLeft, false);
    if (held.latched.ctrl || held.latched.alt) setLatch({ ctrl: false, alt: false });
  };

  // Text that arrives without key events (autocorrect, dictation, some on-screen keyboards).
  const onInput = (event: FormEvent<HTMLTextAreaElement>) => {
    const field = event.currentTarget;
    const text = field.value;
    field.value = "";
    if (phaseRef.current !== "connected") return;
    for (const ch of text.slice(0, 200)) {
      const mapped = charKey(ch);
      if (mapped) tap(mapped[0], mapped[1]);
    }
  };

  const toScreen = (event: PointerEvent<HTMLCanvasElement>) => {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);
    return { x: Math.min(canvas.width - 1, Math.max(0, x)), y: Math.min(canvas.height - 1, Math.max(0, y)) };
  };

  const BUTTONS: Record<number, number> = { 0: 1, 1: 3, 2: 2 };

  const onPointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    focusInput();
    // Touch just focuses typing (and lets the page scroll); a text console has no use for taps as clicks.
    if (event.pointerType === "touch" || phaseRef.current !== "connected") return;
    const at = toScreen(event);
    const button = BUTTONS[event.button];
    if (!at || !button) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    send({ t: "m", x: at.x, y: at.y, b: 0 });
    send({ t: "m", x: at.x, y: at.y, b: button, d: true });
  };

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" || phaseRef.current !== "connected") return;
    const at = toScreen(event);
    if (!at) return;
    pendingMove.current = at;
    if (moveFrame.current !== null) return;
    moveFrame.current = requestAnimationFrame(() => {
      moveFrame.current = null;
      const next = pendingMove.current;
      pendingMove.current = null;
      if (next) send({ t: "m", x: next.x, y: next.y, b: 0 });
    });
  };

  const onPointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "touch" || phaseRef.current !== "connected") return;
    const at = toScreen(event);
    const button = BUTTONS[event.button];
    if (!at || !button) return;
    send({ t: "m", x: at.x, y: at.y, b: button, d: false });
  };

  const pressCad = () => {
    if (!cadArmed) {
      setCadArmed(true);
      if (cadTimer.current) clearTimeout(cadTimer.current);
      cadTimer.current = setTimeout(() => setCadArmed(false), 3000);
      return;
    }
    if (cadTimer.current) clearTimeout(cadTimer.current);
    setCadArmed(false);
    send({ t: "cad" });
    focusInput();
  };

  const vmRunning = vmState === "running";
  const vmKnownOff = vmState !== null && !vmRunning;
  const connected = phase === "connected";
  let statusText: string;
  if (phase === "connecting") statusText = "Connecting\u2026";
  else if (connected) statusText = focused ? "Connected. Typing goes to the virtual machine." : "Connected. Click or tap the screen to type.";
  else if (phase === "off" || (vmKnownOff && phase !== "disconnected")) statusText = "The virtual machine isn\u2019t running.";
  else if (phase === "disconnected" && vmKnownOff) statusText = "Disconnected. The virtual machine isn\u2019t running.";
  else if (phase === "disconnected") statusText = message ?? "Disconnected";
  else statusText = "Not connected. Connect to see the virtual machine\u2019s screen.";

  return (
    <section className={`refract-remote is-${phase}`} aria-label="Virtual remote">
      <div className="refract-remote-bar">
        <span className={`refract-remote-dot is-${phase}`} aria-hidden="true" />
        <span className="refract-remote-title">Virtual remote</span>
        <span className="refract-remote-status" role="status" aria-live="polite">
          {statusText}
        </span>
        {connected ? (
          <button type="button" className="refract-remote-action" onClick={disconnect}>
            Disconnect
          </button>
        ) : (
          <button
            type="button"
            className="refract-remote-action"
            disabled={phase === "connecting" || vmKnownOff}
            onClick={connect}
          >
            {phase === "disconnected" || phase === "off" ? "Reconnect" : "Connect"}
          </button>
        )}
      </div>
      <div className="refract-remote-screen">
        <canvas
          ref={canvasRef}
          className="refract-remote-canvas"
          width={1024}
          height={768}
          aria-label="The virtual machine's screen"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onContextMenu={(event) => event.preventDefault()}
        />
        {!connected && <div className="refract-remote-placeholder">{statusText}</div>}
        <textarea
          ref={inputRef}
          className="refract-remote-input"
          aria-label="Type into the virtual machine"
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          spellCheck={false}
          rows={1}
          tabIndex={connected ? 0 : -1}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onInput={onInput}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false);
            if (phaseRef.current === "connected") releaseAll();
          }}
        />
      </div>
      <div className="refract-remote-keys" aria-label="Remote keys">
        <button
          type="button"
          className="refract-remote-key"
          title="Show the keyboard"
          disabled={!connected}
          onPointerDown={(event) => event.preventDefault()}
          onClick={focusInput}
        >
          Keyboard
        </button>
        <button
          type="button"
          className={`refract-remote-key ${latched.ctrl ? "is-latched" : ""}`}
          title="Hold Ctrl for the next key"
          aria-pressed={latched.ctrl}
          disabled={!connected}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setLatch({ ...latchRef.current, ctrl: !latchRef.current.ctrl })}
        >
          Ctrl
        </button>
        <button
          type="button"
          className={`refract-remote-key ${latched.alt ? "is-latched" : ""}`}
          title="Hold Alt for the next key"
          aria-pressed={latched.alt}
          disabled={!connected}
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => setLatch({ ...latchRef.current, alt: !latchRef.current.alt })}
        >
          Alt
        </button>
        {KEY_ROW.map((key) => (
          <button
            key={key.code}
            type="button"
            className="refract-remote-key"
            title={key.title}
            aria-label={key.title}
            disabled={!connected}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => tap(key.code)}
          >
            {key.label}
          </button>
        ))}
        <button
          type="button"
          className={`refract-remote-key is-danger ${cadArmed ? "is-armed" : ""}`}
          title="Send Ctrl-Alt-Del (on Ubuntu this restarts the virtual machine). Tap twice."
          disabled={!connected}
          onPointerDown={(event) => event.preventDefault()}
          onClick={pressCad}
        >
          {cadArmed ? "Tap again: Ctrl-Alt-Del" : "Ctrl-Alt-Del"}
        </button>
      </div>
    </section>
  );
}