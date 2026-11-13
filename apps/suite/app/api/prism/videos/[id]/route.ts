// GET /api/prism/videos/<id> — the video file, only for the profile that made it.
// GET /api/prism/videos/<id>?poster=1 — its starting picture instead.
//
// Video players (iPhones especially) don't download a video in one go: they ask for pieces,
// with a "Range: bytes=start-end" header, and won't play it unless we answer piece by piece.

import fs from 'node:fs';
import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { deleteVideo, videoFilePath } from '@/lib/prism/videos';

// DELETE /api/prism/videos/<id> — delete that video for good (the ✕ on its thumbnail).
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  const { id } = await params;
  const outcome = deleteVideo(userId, id);
  if (outcome === 'missing') return NextResponse.json({ error: 'Video not found.' }, { status: 404 });
  if (outcome === 'working') {
    return NextResponse.json({ error: 'This video is still being made. Delete it once it’s finished.' }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

// A finished video never changes, so the browser can keep it.
const CACHE = 'private, max-age=31536000, immutable';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();

  const { id } = await params;
  const poster = new URL(req.url).searchParams.has('poster');
  const file = videoFilePath(userId, id, poster ? 'poster' : 'video');
  if (!file) return NextResponse.json({ error: 'Video not found.' }, { status: 404 });

  if (poster) {
    return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': CACHE },
    });
  }

  const size = fs.statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');

  // No range asked for: send the whole file.
  if (!range) {
    return new NextResponse(new Uint8Array(fs.readFileSync(file)), {
      headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(size), 'Accept-Ranges': 'bytes', 'Cache-Control': CACHE },
    });
  }

  // "bytes=100-199" = those bytes; "bytes=100-" = from 100 to the end; "bytes=-500" = the last 500.
  let start = range[1] ? Number(range[1]) : size - Number(range[2]);
  let end = range[1] && range[2] ? Number(range[2]) : size - 1;
  start = Math.max(0, start);
  end = Math.min(end, size - 1);
  if (start > end) {
    return new NextResponse(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  }

  const piece = Buffer.alloc(end - start + 1);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, piece, 0, piece.length, start);
  } finally {
    fs.closeSync(fd);
  }
  return new NextResponse(new Uint8Array(piece), {
    status: 206,
    headers: {
      'Content-Type': 'video/mp4',
      'Content-Length': String(piece.length),
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': CACHE,
    },
  });
}
