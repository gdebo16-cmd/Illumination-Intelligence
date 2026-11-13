// Checks the enlarge plans and recipes without ComfyUI.
//
//   node scripts/check-upscale.mjs     (run from apps/suite)
//
// A real enlarge still needs ComfyUI and the model files in docs/prism-upscale.md.

import assert from 'node:assert/strict';
import sharp from 'sharp';
import { noWorkerMessage, rankWorkers } from '../lib/gpu/router.ts';
import { buildUpscaleWorkflow, filesIn, needsForPlan, pictureForUpscale } from '../lib/prism/upscale.ts';
import {
  SEEDVR_INPUT_MEGAPIXELS,
  SEEDVR_UNET,
  SEEDVR_VAE,
  choicesFor,
  planUpscale,
} from '../lib/prism/upscale-plan.ts';

const raider = { id: 'raider', name: 'Raider', url: 'http://127.0.0.1:8188', vramGB: 16, ramGB: 32, local: true };
const alienware = { id: 'alienware', name: 'Alienware', url: 'http://192.168.1.102:8188', vramGB: 8, ramGB: 64 };
const state = (worker, files) => ({ worker, online: true, comfyBusy: false, files: new Set(files) });

const square = planUpscale('fast-4x', 1024, 1024);
assert.deepEqual([square.width, square.height], [4096, 4096]);
assert.equal(square.path, 'fast');

const hd = planUpscale('fast-4x', 1920, 1080);
assert.deepEqual([hd.width, hd.height], [7680, 4320], '1080p at 4× is 8K UHD');

const fourK = planUpscale('4k', 1024, 1024);
assert.deepEqual([fourK.width, fourK.height], [4096, 4096]);
assert.equal(fourK.thenFast2x, false);
assert.deepEqual([fourK.seedvrWidth, fourK.seedvrHeight], [4096, 4096]);

const fourKWide = planUpscale('4k', 1920, 1080);
assert.equal(Math.max(fourKWide.width, fourKWide.height), 4096);
assert.equal(fourKWide.width / fourKWide.height, 1920 / 1080);

assert.deepEqual([planUpscale('4k-uhd', 1920, 1080).width, planUpscale('4k-uhd', 1920, 1080).height], [3840, 2160]);
assert.deepEqual([planUpscale('4k-uhd', 1080, 1920).width, planUpscale('4k-uhd', 1080, 1920).height], [2160, 3840]);
assert.deepEqual([planUpscale('4k-uhd', 1024, 1024).width, planUpscale('4k-uhd', 1024, 1024).height], [3840, 3840]);

const eight = planUpscale('8k', 1024, 1024);
assert.deepEqual([eight.width, eight.height], [8192, 8192]);
assert.equal(eight.thenFast2x, true);
assert.deepEqual([eight.seedvrWidth, eight.seedvrHeight], [4096, 4096]);

const eightUhd = planUpscale('8k-uhd', 1920, 1080);
assert.deepEqual([eightUhd.width, eightUhd.height], [7680, 4320]);
assert.deepEqual([eightUhd.seedvrWidth, eightUhd.seedvrHeight], [3840, 2160]);

const two = planUpscale('fast-2x', 1920, 1080);
assert.deepEqual([two.width, two.height], [3840, 2160], '1080p at 2× is 4K UHD');

assert.equal(choicesFor(1024, 1024).length, 6);
assert.ok(choicesFor(4096, 4096).every((choice) => choice.target === '8k' || choice.target === '8k-uhd'));
assert.ok(!choicesFor(2160, 2160).some((choice) => choice.target === 'fast-4x'));
assert.ok(choicesFor(1920, 1080).some((choice) => choice.label === 'Fast 4×'));

const fastFlow = buildUpscaleWorkflow({
  uploadedName: 'prism/in.png',
  sourceWidth: 1024,
  sourceHeight: 1024,
  plan: square,
  modelFile: 'RealESRGAN_x4plus.pth',
});
assert.equal(fastFlow['14'].inputs.image, 'prism/in.png');
assert.equal(fastFlow['1'].inputs.model_name, 'RealESRGAN_x4plus.pth');
assert.equal(fastFlow['3'], undefined, 'Fast 4× does not resample the 4× result');
assert.deepEqual(filesIn(fastFlow), ['RealESRGAN_x4plus.pth']);

const photo = planUpscale('fast-4x', 800, 600, 'nomos');
const photoFlow = buildUpscaleWorkflow({
  uploadedName: 'prism/in.png',
  sourceWidth: 800,
  sourceHeight: 600,
  plan: photo,
  modelFile: '4xNomos2_hq_dat2.safetensors',
});
assert.equal(photoFlow['1'].inputs.model_name, '4xNomos2_hq_dat2.safetensors');

const half = buildUpscaleWorkflow({
  uploadedName: 'prism/in.png',
  sourceWidth: 1024,
  sourceHeight: 1024,
  plan: planUpscale('fast-2x', 1024, 1024),
  modelFile: 'RealESRGAN_x4plus.safetensors',
});
assert.equal(half['3'].inputs.width, 2048);
assert.equal(half['3'].inputs.height, 2048);

const enhance = buildUpscaleWorkflow({
  uploadedName: 'prism/in.png',
  sourceWidth: 1024,
  sourceHeight: 1024,
  plan: fourK,
  modelFile: null,
});
const enhanceTypes = Object.values(enhance).map((box) => box.class_type);
assert.ok(enhanceTypes.includes('SeedVR2Preprocess'));
assert.ok(enhanceTypes.includes('SeedVR2Conditioning'));
assert.ok(enhanceTypes.includes('SeedVR2PostProcessing'));
assert.equal(enhance['20'].inputs.megapixels, SEEDVR_INPUT_MEGAPIXELS);
assert.equal(enhance['52'].inputs.unet_name, SEEDVR_UNET);
assert.equal(enhance['52'].inputs.weight_dtype, 'default');
assert.equal(enhance['51'].inputs.vae_name, SEEDVR_VAE);
assert.equal(enhance['21'].inputs.width, 4096);
assert.ok(!enhanceTypes.includes('UpscaleModelLoader'), '4K does not load the 2× model');
assert.deepEqual(needsForPlan(fourK).files, [SEEDVR_UNET, SEEDVR_VAE]);
assert.equal(needsForPlan(fourK).oneOf, undefined);

const big = buildUpscaleWorkflow({
  uploadedName: 'prism/in.png',
  sourceWidth: 1920,
  sourceHeight: 1080,
  plan: eightUhd,
  modelFile: 'RealESRGAN_x2plus.pth',
});
assert.equal(big['1'].inputs.model_name, 'RealESRGAN_x2plus.pth');
assert.equal(big['2'].class_type, 'ImageUpscaleWithModel');
assert.equal(big['21'].inputs.width, 3840);
assert.equal(big['21'].inputs.height, 2160);
assert.equal(big['3'].inputs.width, 7680);
assert.equal(big['3'].inputs.height, 4320);
assert.ok(needsForPlan(eightUhd).oneOf?.includes('RealESRGAN_x2plus.pth'));

const fastNeeds = needsForPlan(square);
const withPth = [state(raider, ['RealESRGAN_x4plus.pth'])];
assert.equal(rankWorkers(fastNeeds, withPth).length, 1);
assert.match(noWorkerMessage(fastNeeds, [state(raider, [])]), /RealESRGAN_x4plus/);

const enhanceNeeds = needsForPlan(eight);
const seedvrFiles = [SEEDVR_UNET, SEEDVR_VAE, 'RealESRGAN_x2plus.pth'];
const both = [
  state(alienware, seedvrFiles),
  state(raider, seedvrFiles),
];
assert.equal(rankWorkers(enhanceNeeds, both)[0].worker.name, 'Raider', 'SeedVR2 prefers the 16 GB card');
assert.match(noWorkerMessage(enhanceNeeds, [state(raider, [])]), new RegExp(SEEDVR_UNET));

const tiny = await sharp({
  create: { width: 32, height: 16, channels: 3, background: { r: 10, g: 20, b: 30 } },
}).png().toBuffer();
const opened = await pictureForUpscale(tiny);
assert.equal(opened.width, 32);
assert.equal(opened.height, 16);

const tooBig = await sharp({
  create: { width: 9000, height: 2, channels: 3, background: 'black' },
}).png().toBuffer();
await assert.rejects(() => pictureForUpscale(tooBig), /8K/);

console.log('Upscale plans and recipes check out.');
