// POST /api/prism/generate — "make me a picture", or "edit this picture".
//
// Make one from words (JSON):
//   { prompt, model?, expand?, style?, width?, height?, seed? }
// Edit one of your Prism pictures (JSON):
//   { prompt: "make it nighttime", sourceId: "<picture id>", model?, expand?, style?, seed? }
// Edit a picture from your device (a form upload, multipart/form-data):
//   fields prompt, model?, expand?, style?, seed?, and the file in "image"
//
// `model` is an id from config/prism-models.ts; leave it out for the default model.
// `expand: false` sends the prompt exactly as typed; otherwise a model with a prompt expander
// (FLUX.3) rewrites it into a long, detailed one first.
//
// Get back (status 202, right away): a picture job with status 'working'. The picture is made in
// the background, so leaving the page (or minimizing the iPhone app) doesn't stop it. The page
// checks GET /api/prism/jobs until the job is 'done' (its `imageId` is the new picture in
// GET /api/prism/images) or 'failed' (with an `error`). See lib/prism/imageJobs.ts.
// An edit keeps the shape of the picture you started from, so width/height are ignored.

import { NextResponse } from 'next/server';
import { getCurrentUserId, noProfile } from '@/lib/user';
import { generateImage, imageNeeds, type ImageRequest } from '@/lib/prism/comfy';
import { startImageJob } from '@/lib/prism/imageJobs';
import { readImageFile, saveImage } from '@/lib/prism/images';
import { MAX_SOURCE_BYTES, prepareSource, type PreparedSource } from '@/lib/prism/source';
import { PRISM_STYLES } from '@/config/prism-styles';
import { findPrismModel } from '@/config/prism-models';

const MAX_PROMPT = 2000;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

export async function POST(req: Request) {
  // 1. Who is asking?
  const userId = await getCurrentUserId();
  if (!userId) return noProfile();

  // 2. Read what they sent: JSON, or a form with a picture file.
  const fields: Record<string, unknown> = {};
  let upload: File | null = null;
  try {
    if ((req.headers.get('content-type') ?? '').includes('multipart/form-data')) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (key === 'image' && typeof value !== 'string') upload = value;
        else if (typeof value === 'string') fields[key] = key === 'seed' || key === 'width' || key === 'height' ? Number(value) : value;
      }
    } else {
      Object.assign(fields, await req.json());
    }
  } catch {
    return bad('Send the request as JSON or as a form.');
  }

  const prompt = typeof fields.prompt === 'string' ? fields.prompt.trim() : '';
  if (!prompt) return bad('Describe the picture you want, or what to change.');
  if (prompt.length > MAX_PROMPT) return bad(`Keep the description under ${MAX_PROMPT} characters.`);

  const style = PRISM_STYLES.some((s) => s.id === fields.style) ? (fields.style as string) : 'none';
  const model = findPrismModel(fields.model); // anything unknown → the default model
  // On unless switched off. (A form sends everything as text, so "false" counts too.)
  const expand = fields.expand !== false && fields.expand !== 'false';
  const number = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const seed = number(fields.seed);

  // 3. Editing? Get the starting picture ready (upright, no transparency, about 1 megapixel).
  let source: PreparedSource | undefined;
  const sourceId = typeof fields.sourceId === 'string' && fields.sourceId ? fields.sourceId : null;
  try {
    if (upload) {
      if (upload.size > MAX_SOURCE_BYTES) return bad('That picture is too big (over 25 MB).');
      source = await prepareSource(Buffer.from(await upload.arrayBuffer()));
    } else if (sourceId) {
      const file = readImageFile(userId, sourceId);
      if (!file) return bad('That picture wasn’t found.', 404);
      source = await prepareSource(file);
    }
  } catch (err) {
    return bad((err as Error).message || 'Couldn’t read that picture.');
  }

  // 4. Order it. The GPU queue picks a machine that has this model (see lib/gpu/router.ts), and
  //    unloads Lumen's chat model first if the job runs on this machine's card. The answer goes
  //    back straight away; the picture is made and saved (step 5) even if the page is gone.
  const request: ImageRequest = {
    prompt,
    model: model.id,
    expand,
    style,
    width: number(fields.width),
    height: number(fields.height),
    seed: seed === undefined ? undefined : Math.floor(Math.abs(seed)) % 2 ** 32,
    source,
  };
  const job = startImageJob(userId, {
    mode: source ? 'edit' : 'create',
    prompt,
    model: model.id,
    modelName: model.name,
    sourceId: upload ? null : sourceId,
    needs: imageNeeds(request),
    run: (worker) => generateImage(request, worker),
    // 5. Keep it (the page finds it by the job's imageId).
    save: (result) => saveImage(userId, prompt, style, result, source ? { sourceId: upload ? null : sourceId } : undefined).id,
    label: 'Prism generate error',
  });
  return NextResponse.json(job, { status: 202 });
}
