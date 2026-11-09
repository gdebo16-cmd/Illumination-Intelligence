'use client';

import { flameColor } from '@/config/umbra';
import { MessageContent } from '@/components/MessageContent';
import Flame from './Flame';
import type { AgentStep } from './types';

// The tool steps behind a reply: what the bot did, with links and pictures.
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
            <Flame flame={step.bot.flame} size={26} still={step.status !== 'running'} className="umbra-step-flame" />
          ) : (
            <span className="umbra-step-mark" aria-hidden>
              {step.status === 'running' ? '' : step.status === 'done' ? '✓' : '!'}
            </span>
          )}
          <span className="umbra-step-body">
            <span className="umbra-step-label">{step.label}</span>
            {step.children && step.children.length > 0 && <Steps steps={step.children} />}
            {step.summary && step.status !== 'running' && !step.detail && <span className="umbra-step-summary">{step.summary}</span>}
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
