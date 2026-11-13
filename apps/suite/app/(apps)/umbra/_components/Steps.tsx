'use client';

import { useState } from 'react';
import { flameColor } from '@/config/umbra';
import { MessageContent } from '@/components/MessageContent';
import Flame from './Flame';
import type { AgentStep, ApprovalRequest, CodeEdit } from './types';

// The steps behind a reply: what the bot did, with links and pictures.
// A bot with "Think before answering" on also gets "Thinking" steps: while it reasons, the last
// few lines of its thinking show live; afterwards the whole thing folds away under "Thought for…".
// In a team, "Asking <teammate>" steps show that teammate's flame, its own steps underneath,
// and (folded away) the full answer it gave the leader.
export function Steps({ steps }: { steps: AgentStep[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="umbra-steps">
      {steps.map((step) => (
        <li
          key={step.id}
          className={`umbra-step is-${step.status} ${step.bot ? 'is-teammate' : ''}`}
          style={step.bot ? ({ '--mate-color': flameColor(step.bot.flame) } as React.CSSProperties) : undefined}
        >
          {step.bot ? (
            <Flame flame={step.bot.flame} size={26} still mood={step.status === 'running' ? 'working' : 'idle'} className="umbra-step-flame" />
          ) : (
            <span className="umbra-step-mark" aria-hidden>
              {step.status === 'running' ? '' : step.status === 'done' ? '✓' : '!'}
            </span>
          )}
          <span className="umbra-step-body">
            <span className="umbra-step-label">{step.label}</span>
            {step.children && step.children.length > 0 && <Steps steps={step.children} />}
            {step.summary && step.status !== 'running' && !step.detail && <span className="umbra-step-summary">{step.summary}</span>}
            {step.thought &&
              (step.status === 'running' ? (
                <span className="umbra-thought is-live"><span>{step.thought}</span></span>
              ) : (
                <details className="umbra-step-detail">
                  <summary>Show thinking</summary>
                  <span className="umbra-thought">{step.thought}</span>
                </details>
              ))}
            {step.detail && step.bot && (
              <details className="umbra-step-detail">
                <summary>{step.bot.name}’s answer</summary>
                <MessageContent content={step.detail} />
              </details>
            )}
            {step.links && step.links.length > 0 && (
              <span className="umbra-step-links">
                {step.links.slice(0, 5).map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="noreferrer noopener" title={link.url}>
                    {link.title}
                  </a>
                ))}
              </span>
            )}
            {step.edit && <EditCard edit={step.edit} />}
            {step.approval && <ApprovalCard approval={step.approval} />}
            {step.image && (
              <a href={step.image.url} target="_blank" rel="noreferrer" className="umbra-step-image">
                {/* eslint-disable-next-line @next/next/no-img-element -- a picture Prism made, served by our own API */}
                <img src={step.image.url} alt={step.image.prompt} loading="lazy" />
              </a>
            )}
          </span>
        </li>
      ))}
    </ol>
  );
}

// A file change the Code helper suggested: the "diff" (red lines go, green lines come in),
// with buttons to write it to the file or leave the file alone.
function EditCard({ edit: initial }: { edit: CodeEdit }) {
  const [edit, setEdit] = useState(initial);
  const [busy, setBusy] = useState(false);

  const decide = async (apply: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/umbra/edits/${edit.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply }),
      });
      const data = await res.json();
      setEdit(res.ok ? data : { ...edit, status: 'failed', note: data.error ?? 'Something went wrong.' });
    } finally {
      setBusy(false);
    }
  };

  const status = { applied: 'Applied', rejected: 'Not applied', failed: 'Couldn’t apply', pending: '' }[edit.status];
  return (
    <span className={`umbra-edit is-${edit.status}`}>
      <span className="umbra-edit-path">{edit.path}</span>
      <pre className="umbra-edit-diff">
        {/* The "--- file" / "+++ file" header lines repeat the file name shown above, so skip them. */}
        {edit.diff.split('\n').filter((line) => !/^(---|\+\+\+) /.test(line)).map((line, i) => (
          <span key={i} className={line.startsWith('+') ? 'is-add' : line.startsWith('-') ? 'is-del' : undefined}>
            {line}
          </span>
        ))}
      </pre>
      {edit.status === 'pending' ? (
        <span className="umbra-edit-actions">
          <button type="button" className="umbra-edit-apply" disabled={busy} onClick={() => decide(true)}>Apply</button>
          <button type="button" disabled={busy} onClick={() => decide(false)}>Don’t apply</button>
        </span>
      ) : (
        <span className="umbra-edit-status">{status}{edit.note ? `: ${edit.note}` : ''}</span>
      )}
    </span>
  );
}
// Something a Flicker asked to do that needs your OK first (Prod control's restart): what would
// run, with Approve and Deny buttons. Nothing runs until you approve. While the restart goes, the
// step's own updates show how far it got.
function ApprovalCard({ approval: live }: { approval: ApprovalRequest }) {
  const [answered, setAnswered] = useState<ApprovalRequest | null>(null);
  const [busy, setBusy] = useState(false);
  // Your answer shows straight away; once the Flicker's step catches up, its updates take over.
  const approval = answered && live.status === 'pending' ? answered : live;

  const decide = async (approve: boolean) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/umbra/approvals/${approval.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ approve }),
      });
      const data = await res.json();
      setAnswered(res.ok ? data : { ...approval, status: 'failed', note: data.error ?? 'Something went wrong.' });
    } catch {
      setAnswered({ ...approval, status: 'failed', note: 'Couldn’t reach the app.' });
    } finally {
      setBusy(false);
    }
  };

  const status = {
    pending: '',
    approved: 'Approved',
    denied: 'Denied, so nothing ran',
    expired: 'No answer in time, so nothing ran',
    failed: 'Couldn’t start',
  }[approval.status];
  const tone = approval.status === 'failed' || approval.outcome === 'failed' ? 'is-failed' : approval.outcome === 'done' ? 'is-applied' : '';
  return (
    <span className={`umbra-edit umbra-approval is-${approval.status} ${tone}`}>
      <span className="umbra-approval-title">{approval.title}</span>
      <span className="umbra-approval-steps">
        {approval.detail.map((line, i) => (
          <span key={i} className="umbra-approval-step">
            <span className="umbra-approval-num">{i + 1}.</span>
            <span>{line}</span>
          </span>
        ))}
      </span>
      {approval.status === 'pending' ? (
        <span className="umbra-edit-actions">
          <button type="button" className="umbra-edit-apply" disabled={busy} onClick={() => decide(true)}>Approve</button>
          <button type="button" disabled={busy} onClick={() => decide(false)}>Deny</button>
        </span>
      ) : (
        <span className="umbra-edit-status">
          {status}
          {approval.progress ? ` · ${approval.progress}` : ''}
          {approval.note ? `: ${approval.note}` : ''}
        </span>
      )}
    </span>
  );
}
