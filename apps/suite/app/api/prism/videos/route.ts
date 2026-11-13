// /api/prism/videos — Prism's videos.
//
// GET:  your videos (newest first) and the length choices, each with how long it usually takes:
//         { videos: [...], lengths: [{ id, name, seconds, wait, runs }] }
// POST: make a video from a picture. Answers straight away with the video's details and
//       status 'working'; check GET until it says 'done'.
//   From one of your Prism pictures (JSON):  { prompt, length: 'short' | 'medium' | 'long', imageId }
//   From a picture on your device (form):    fields prompt, length, and the file in "image"

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { readImageFile } from '@/lib/prism/images';
import { MAX_SOURCE_BYTES, prepareSource, type PreparedSource } from '@/lib/prism/source';
import { VIDEO_PIXELS, VIDEO_STEP, findLength } from '@/lib/prism/video-workflow';
import { lengthChoices, listVideos, startVideo } from '@/lib/prism/videos';

const MAX_PROMPT = 2000;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  // Run on every request, never a saved copy from build time.
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();
  return NextResponse.json({ videos: listVideos(userId), lengths: lengthChoices() });
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();

  // Read what they sent: JSON, or a form with a picture file.
  const fields: Record<string, unknown> = {};
  let upload: File | null = null;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (key === 'image' && typeof value !== 'string') upload = value;
        else if (typeof value === 'string') fields[key] = value;
      }
    } else {
      Object.assign(fields, await req.json());
    }
  } catch {
    return bad('Send the request as JSON or as a form.');
  }

  const prompt = typeof fields.prompt === 'string' ? fields.prompt.trim() : '';
  if (!prompt) return bad('Describe what should move in the video.');
  if (prompt.length > MAX_PROMPT) return bad(`Keep the description under ${MAX_PROMPT} characters.`);

  const length = findLength(fields.length);
  if (!length) return bad('Pick a video length.');

  // The starting picture, resized to the video size (about 1280×704, sides in steps of 32).
  const imageId = typeof fields.imageId === 'string' && fields.imageId ? fields.imageId : null;
  let picture: PreparedSource;
  try {
    let file: Buffer;
    if (upload) {
      if (upload.size > MAX_SOURCE_BYTES) return bad('That picture is too big (over 25 MB).');
      file = Buffer.from(await upload.arrayBuffer());
    } else if (imageId) {
      const found = readImageFile(userId, imageId);
      if (!found) return bad('That picture wasn’t found.', 404);
      file = found;
    } else {
      return bad('Pick a picture to bring to life.');
    }
    picture = await prepareSource(file, { pixels: VIDEO_PIXELS, step: VIDEO_STEP });
  } catch (err) {
    return bad((err as Error).message || 'Couldn’t read that picture.');
  }

  const video = startVideo(userId, { prompt, length: length.id, picture, imageId: upload ? null : imageId });
  return NextResponse.json(video, { status: 202 });
}
