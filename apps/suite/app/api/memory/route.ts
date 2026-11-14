// GET /api/memory — everything the suite remembers about the signed-in profile, for the Memory page:
//   { facts:    shared facts (Lumen and every Flicker with Memory on use these),
//     flickers: each Flicker, whether its Memory is on, and its own notes,
//     chats:    what each chat remembers of itself (summary, saved exchanges, last recall) }

import { NextResponse } from 'next/server';
import db from '@/lib/db';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { listBotNotes, listSharedFacts, type Memory } from '@/lib/memory';
import { chatMemoryOverview } from '@/lib/chat-memory';
import { listBots } from '@/lib/umbra/bots';

const view = (m: Memory) => ({ id: m.id, fact: m.fact, category: m.category, updatedAt: m.updated_at });

export async function GET() {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return NextResponse.json({
    facts: listSharedFacts(db, userId).map(view),
    flickers: listBots(userId).map((bot) => ({
      id: bot.id,
      name: bot.name,
      flame: bot.flame,
      memoryOn: bot.tools.includes('notes'),
      notes: listBotNotes(db, bot.id).map(view),
    })),
    chats: chatMemoryOverview(userId),
  });
}
