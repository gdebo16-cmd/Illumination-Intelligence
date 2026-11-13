// POST /api/aegis/suggest — write up one suggestion from a scan: { candidate, model }
// Answers { written } (by the model), or { written, note } with the scan's plainer version when no
// model could write it (note says why). A model can take a minute or two.

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { AEGIS_DEFAULT_MODEL } from '@/config/models';
import { writeFromScan, writeWithModel } from '@/lib/aegis/advise';
import type { SuggestionCandidate } from '@/lib/aegis/types';

export const maxDuration = 400;

const isCandidate = (c: unknown): c is SuggestionCandidate => {
  const o = c as SuggestionCandidate;
  return !!o && typeof o.title === 'string' && Array.isArray(o.files) && Array.isArray(o.evidence) && Array.isArray(o.excerpts) && Array.isArray(o.shared);
};

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const body = await req.json().catch(() => ({}));
  if (!isCandidate(body.candidate)) return NextResponse.json({ error: 'No suggestion to write.' }, { status: 400 });
  const model = typeof body.model === 'string' && body.model ? body.model : AEGIS_DEFAULT_MODEL;
  try {
    return NextResponse.json({ written: await writeWithModel(body.candidate, model, userId) });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    const note = /fetch failed|ECONNREFUSED/i.test(reason) ? 'Ollama isn’t running, so this is the scan’s own write-up.' : `${model} couldn’t write it (${reason}), so this is the scan’s own write-up.`;
    return NextResponse.json({ written: writeFromScan(body.candidate), note });
  }
}
