// /api/prism/videos — Prism's videos.
//
// GET:  your videos (newest first), the length choices for each video model with how long each
//       usually takes, and which models are downloaded (null when ComfyUI isn't running):
//         { videos: [...], lengths: { 'wan-5b': [{ id, name, seconds, wait, runs }], ... },
//           models: [{ id, ready: { image, text }, missing: { image: [...], text: [...] } }] | null }
// POST: make a video. Answers straight away with the video's details and status 'working';
//       check GET until it says 'done'. Every request has prompt, length ('short' | 'medium' |
//       'long') and model ('wan-5b' | 'wan-14b', default 'wan-5b'), plus:
//   From one of your Prism pictures (JSON):  imageId
//   From a picture on your device (form):    the file in "image"
//   From words only (JSON):                  shape: 'landscape' | 'portrait' | 'square'

import { connection, NextResponse } from 'next/server';
import { getCurrentUserId } from '@/lib/user';
import { readImageFile } from '@/lib/prism/images';
import { MAX_SOURCE_BYTES, prepareSource, type PreparedSource } from '@/lib/prism/source';
import { findLength, findVideoModel, findVideoShape, videoSize } from '@/config/prism-video-models';
import { lengthChoices, listVideos, startVideo, videoModelStatus } from '@/lib/prism/videos';

const MAX_PROMPT = 2000;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function GET() {
  // Run on every request, never a saved copy from build time.
  await connection();
  const userId = await getCurrentUserId();
  if (!userId) return bad('Please select a user profile first.', 401);
  const models = await videoModelStatus().catch(() => null);
  return NextResponse.json({ videos: listVideos(userId), lengths: lengthChoices(), models });
}

export async function POST(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return bad('Please select a user profile first.', 401);

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

  if (fields.model !== undefined && findVideoModel(fields.model).id !== fields.model) return bad('Pick a video model.');
  const model = findVideoModel(fields.model);
  const imageId = typeof fields.imageId === 'string' && fields.imageId ? fields.imageId : null;

  // From words only: no picture, just a shape.
  if (!upload && !imageId) {
    const shape = findVideoShape(fields.shape);
    if (!shape) return bad('Pick a picture to bring to life, or a shape for a video from words.');
    const video = startVideo(userId, { prompt, model: model.id, length: length.id, size: videoSize(model, shape.ratio), imageId: null });
    return NextResponse.json(video, { status: 202 });
  }

  // The starting picture, resized to the model's video size (sides in its steps of 16 or 32).
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
    picture = await prepareSource(file, { pixels: model.pixels, step: model.step });
  } catch (err) {
    return bad((err as Error).message || 'Couldn’t read that picture.');
  }

  const video = startVideo(userId, { prompt, model: model.id, length: length.id, picture, imageId: upload ? null : imageId });
  return NextResponse.json(video, { status: 202 });
}
