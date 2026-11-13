"use client";

import { useEffect, useState } from "react";
import AppShell from "@/components/AppShell";
import useSidebar from "@/hooks/use-sidebar";
import RefractTerminal from "./RefractTerminal";
import RefractRemote from "./RefractRemote";
import { powerActionAllowed, type PowerAction } from "@/lib/refract/power";

type VmSnapshot = {
  id: string;
  name: string;
  current: boolean;
};

type WorkshopSnapshot = {
  id: string;
  label: string;
  takenAt: string;
};

type Workshop = {
  name: string;
  git: string | null;
  snapshots: WorkshopSnapshot[];
};

type VmStatus = {
  state: string;
  currentSnapshot: string | null;
  snapshots: VmSnapshot[];
};

type PowerResponse = Partial<VmStatus> & {
  forced?: boolean;
  statusUnavailable?: boolean;
};

const POWER_BUSY_LINES: Record<PowerAction, string> = {
  start: "Starting the virtual machine\u2026",
  stop: "Stopping the virtual machine\u2026",
  reset: "Resetting the virtual machine\u2026",
};

const POWER_FAILED: Record<PowerAction, string> = {
  start: "Couldn't start the virtual machine.",
  stop: "Couldn't stop the virtual machine.",
  reset: "Couldn't reset the virtual machine.",
};

type RestoreResponse = Partial<VmStatus> & {
  restartFailed?: boolean;
  statusUnavailable?: boolean;
};

const STATE_LINES: Record<string, string> = {
  running: "The virtual machine is running.",
  poweroff: "The virtual machine is off.",
  paused: "The virtual machine is paused.",
  saved: "The virtual machine is in a saved state.",
  aborted: "The virtual machine stopped unexpectedly.",
  starting: "The virtual machine is starting.",
  stopping: "The virtual machine is stopping.",
  restoring: "The virtual machine is restoring.",
  restoringsnapshot: "The virtual machine is restoring a snapshot.",
};

function statusLine(status: VmStatus): string {
  const line = STATE_LINES[status.state] ?? `The virtual machine is ${status.state}.`;
  if (!status.currentSnapshot) return line;
  return `${line.replace(/\.$/, "")}, on the ${status.currentSnapshot} snapshot.`;
}

function applyStatus(
  info: VmStatus,
  setStatus: (line: string) => void,
  setSnapshots: (list: VmSnapshot[]) => void,
  setVmState?: (state: string) => void,
) {
  setStatus(statusLine(info));
  setSnapshots(info.snapshots ?? []);
  setVmState?.(info.state);
}

async function fetchStatus(): Promise<VmStatus> {
  const res = await fetch("/api/refract/status", { cache: "no-store" });
  if (!res.ok) throw new Error();
  return res.json();
}

async function fetchWorkspaces(): Promise<Workshop[]> {
  const res = await fetch("/api/refract/workspaces", { cache: "no-store" });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(typeof data?.error === "string" ? data.error : "Couldn't list workspaces.");
  return Array.isArray(data?.workspaces) ? data.workspaces : [];
}

const Refract = () => {
  const panel = useSidebar();
  const [snapshots, setSnapshots] = useState<VmSnapshot[]>([]);
  const [workspaces, setWorkspaces] = useState<Workshop[]>([]);
  const [workspaceNote, setWorkspaceNote] = useState<string | null>(null);
  const [status, setStatus] = useState("Checking the virtual machine\u2026");
  const [taking, setTaking] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<VmSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vmState, setVmState] = useState<string | null>(null);
  const [powering, setPowering] = useState<PowerAction | null>(null);
  const [powerConfirm, setPowerConfirm] = useState<"stop" | "reset" | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const busy = taking || restoringId !== null || powering !== null;
  const canPower = (action: PowerAction) => !busy && powerActionAllowed(action, vmState);

  // Stop and Reset only run from their confirmation; Start runs straight away.
  const runPower = async (action: PowerAction) => {
    setPowerConfirm(null);
    setError(null);
    setNotice(null);
    setPowering(action);
    try {
      const res = await fetch("/api/refract/power", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError((res.status === 409 || res.status === 400) && data?.error ? data.error : POWER_FAILED[action]);
        fetchStatus()
          .then((info) => applyStatus(info, setStatus, setSnapshots, setVmState))
          .catch(() => {});
        return;
      }
      const data: PowerResponse = await res.json();
      if (data.statusUnavailable || !data.state) {
        applyStatus(await fetchStatus(), setStatus, setSnapshots, setVmState);
      } else {
        applyStatus(data as VmStatus, setStatus, setSnapshots, setVmState);
      }
      if (data.forced) {
        setNotice("The guest didn\u2019t shut down in time, so the virtual machine was powered off.");
      }
    } catch {
      setError(POWER_FAILED[action]);
      fetchStatus()
        .then((info) => applyStatus(info, setStatus, setSnapshots, setVmState))
        .catch(() => {});
    } finally {
      setPowering(null);
    }
  };

  const addSnapshot = async () => {
    const suggested = new Date().toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });
    const entered = window.prompt("Name this snapshot", suggested);
    if (entered === null) return;
    const name = entered.trim() || suggested;
    setError(null);
    setTaking(true);
    try {
      const res = await fetch("/api/refract/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error();
      applyStatus(await res.json(), setStatus, setSnapshots);
    } catch {
      setError("Couldn't take a snapshot.");
    } finally {
      setTaking(false);
    }
  };

  // Restore only runs after the confirmation's Restore button; tapping a snapshot row never does.
  const restoreSnapshot = async (snapshot: VmSnapshot) => {
    setConfirmTarget(null);
    setError(null);
    setRestoringId(snapshot.id);
    try {
      const res = await fetch("/api/refract/snapshots/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uuid: snapshot.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(res.status === 409 && data?.error ? data.error : "Couldn't restore the snapshot.");
        return;
      }
      const data: RestoreResponse = await res.json();
      if (data.statusUnavailable || !data.state) {
        applyStatus(await fetchStatus(), setStatus, setSnapshots);
      } else {
        applyStatus(data as VmStatus, setStatus, setSnapshots);
      }
      if (data.restartFailed) {
        setError(`Restored ${snapshot.name}, but couldn't start the virtual machine again.`);
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      setError("Couldn't restore the snapshot.");
      fetchStatus()
        .then((info) => applyStatus(info, setStatus, setSnapshots))
        .catch(() => {});
    } finally {
      setRestoringId(null);
    }
  };

  useEffect(() => {
    if (!confirmTarget && !powerConfirm) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setConfirmTarget(null);
        setPowerConfirm(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmTarget, powerConfirm]);

  useEffect(() => {
    let live = true;
    const load = () => {
      fetchStatus()
        .then((info: VmStatus) => {
          if (live) {
            applyStatus(info, setStatus, setSnapshots, setVmState);
            setError((current) => (current?.startsWith("Restored ") ? current : null));
          }
        })
        .catch(() => {
          if (live) setStatus("Couldn't reach the virtual machine.");
        });
      fetchWorkspaces()
        .then((list) => {
          if (live) {
            setWorkspaces(list);
            setWorkspaceNote(null);
          }
        })
        .catch((err: Error) => {
          if (live) {
            setWorkspaces([]);
            setWorkspaceNote(err.message || "Couldn't list workspaces.");
          }
        });
    };
    load();
    const tick = setInterval(load, 10_000);
    return () => {
      live = false;
      clearInterval(tick);
    };
  }, []);

  const workshop = (
    <div className="refract-sidebar-content">
      <div className="refract-sidebar-workspaces">
        <span className="sidebar-separator">Copied-in work</span>
        {workspaces.length === 0 ? (
          <p className="refract-workspace-empty">
            {workspaceNote ?? "No projects yet. A Flicker with the Refract workshop tool can copy a repo in."}
          </p>
        ) : (
          workspaces.map((workspace) => (
            <div key={workspace.name} className="chat-row refract-workspace-row">
              <div className="chat-button">
                {workspace.name}
                {workspace.git ? <span className="refract-workspace-git">{workspace.git}</span> : null}
                {workspace.snapshots.length > 0 ? (
                  <span className="refract-workspace-snaps">
                    {workspace.snapshots.length === 1
                      ? "1 snapshot"
                      : `${workspace.snapshots.length} snapshots`}
                  </span>
                ) : null}
              </div>
            </div>
          ))
        )}
      </div>
      <div className="refract-sidebar-snapshots">
        <button type="button" className="new-chat-button" onClick={() => void addSnapshot()} disabled={busy}>
          {taking ? "Taking snapshot\u2026" : "+ New snapshot"}
        </button>
        <span className="sidebar-separator">VM snapshots</span>
        {snapshots.map((snapshot) => (
          <div key={snapshot.id} className={`chat-row refract-snapshot-row ${snapshot.current ? "is-current" : ""}`}>
            <div className="chat-button" aria-current={snapshot.current ? "true" : undefined}>
              {snapshot.name}
              {snapshot.current && <span className="refract-snapshot-current">Current</span>}
            </div>
            <button
              type="button"
              className="refract-snapshot-restore"
              aria-label={`Restore snapshot: ${snapshot.name}`}
              title="Restore this snapshot"
              disabled={busy}
              onClick={() => setConfirmTarget(snapshot)}
            >
              {restoringId === snapshot.id ? "Restoring\u2026" : "Restore"}
            </button>
          </div>
        ))}
      </div>
      <RefractTerminal vmState={vmState} />
    </div>
  );

  return (
    <AppShell
      appId="refract"
      sidebar={{ panel, title: "Workshop", label: "workshop and terminal", className: "refract-sidebar", content: workshop }}
      overlays={
        <>
          {confirmTarget && (
            <div className="refract-confirm-backdrop" onClick={() => setConfirmTarget(null)}>
              <div
                className="refract-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="refract-confirm-title"
                aria-describedby="refract-confirm-body"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="refract-confirm-title" className="refract-confirm-title">
                  Restore {"\u201c"}{confirmTarget.name}{"\u201d"}?
                </h2>
                <p id="refract-confirm-body" className="refract-confirm-body">
                  Restoring will stop the virtual machine and discard any work done since this snapshot was taken.
                  This can{"\u2019"}t be undone unless you take a snapshot first.
                </p>
                <p className="refract-confirm-note">If the virtual machine is running, it will start again from the snapshot.</p>
                <div className="refract-confirm-actions">
                  <button
                    type="button"
                    className="refract-confirm-cancel"
                    autoFocus
                    onClick={() => setConfirmTarget(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="refract-confirm-restore"
                    onClick={() => void restoreSnapshot(confirmTarget)}
                  >
                    Restore
                  </button>
                </div>
              </div>
            </div>
          )}
          {powerConfirm && (
            <div className="refract-confirm-backdrop" onClick={() => setPowerConfirm(null)}>
              <div
                className="refract-confirm"
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="refract-power-confirm-title"
                aria-describedby="refract-power-confirm-body"
                onClick={(event) => event.stopPropagation()}
              >
                <h2 id="refract-power-confirm-title" className="refract-confirm-title">
                  {powerConfirm === "stop" ? "Stop the virtual machine?" : "Reset the virtual machine?"}
                </h2>
                <p id="refract-power-confirm-body" className="refract-confirm-body">
                  {powerConfirm === "stop"
                    ? "The virtual machine will shut down. Any unsaved work in the guest may be lost."
                    : "Reset restarts the virtual machine immediately, like pressing a reset button. Any unsaved work in the guest may be lost."}
                </p>
                <p className="refract-confirm-note">
                  {powerConfirm === "stop"
                    ? "It shuts down cleanly first; if that doesn\u2019t finish in time, it\u2019s powered off. The SSH terminal and virtual remote will disconnect."
                    : "The SSH terminal and virtual remote will disconnect; use Reconnect once it\u2019s back up."}
                </p>
                <div className="refract-confirm-actions">
                  <button
                    type="button"
                    className="refract-confirm-cancel"
                    autoFocus
                    onClick={() => setPowerConfirm(null)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="refract-confirm-restore"
                    onClick={() => void runPower(powerConfirm)}
                  >
                    {powerConfirm === "stop" ? "Stop" : "Reset"}
                  </button>
                </div>
              </div>
            </div>
          )}
    
        </>
      }
    >
      <main className="refract">
        <h1>Refract</h1>
        <p className="refract-status" aria-live="polite">
          {powering ? POWER_BUSY_LINES[powering] : restoringId ? "Restoring the virtual machine\u2026" : status}
        </p>
        <div className="refract-power" role="group" aria-label="Virtual machine power">
          <button
            type="button"
            className="refract-power-button"
            disabled={!canPower("start")}
            onClick={() => void runPower("start")}
          >
            {powering === "start" ? "Starting\u2026" : "Start"}
          </button>
          <button
            type="button"
            className="refract-power-button is-danger"
            disabled={!canPower("stop")}
            onClick={() => setPowerConfirm("stop")}
          >
            {powering === "stop" ? "Stopping\u2026" : "Stop"}
          </button>
          <button
            type="button"
            className="refract-power-button is-danger"
            disabled={!canPower("reset")}
            onClick={() => setPowerConfirm("reset")}
          >
            {powering === "reset" ? "Resetting\u2026" : "Reset"}
          </button>
        </div>
        {error && <p className="refract-error" role="alert">{error}</p>}
        {notice && !error && <p className="refract-notice">{notice}</p>}
        <RefractRemote vmState={vmState} />
      </main>
    </AppShell>
  );
};

export default Refract;
