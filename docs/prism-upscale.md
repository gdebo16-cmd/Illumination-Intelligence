# Enlarging pictures in Prism

Prism can make a picture bigger on your own ComfyUI. Nothing is sent to a cloud upscaler.

The buttons sit under the picture you’re looking at (and under a picture you’ve just loaded, before it’s edited):

| Button | What it does | Result |
| --- | --- | --- |
| **Fast 4×** | Faithful enlarge with Real-ESRGAN. The picture stays as it is, four times bigger. | 1024×1024 → 4096×4096. 1920×1080 → 7680×4320. |
| **Photo 4×** | The same kind of enlarge, with a photo model (Nomos DAT). | Also exactly 4×. |
| **Enhance 4K** | SeedVR2, then fitted so the long edge is 4096 (a square becomes 4096×4096). | Can invent fine detail, such as hair. |
| **4K UHD** | Same enhance. 16:9 pictures land on 3840×2160 (9:16 on 2160×3840). Other shapes keep their ratio, with 3840 on the long edge. | |
| **Enhance 8K** | SeedVR2 to about 4K, then a faithful 2×. Long edge 8192. | There isn’t a single SeedVR2 pass to 8K on a 16 GB card. |
| **8K UHD** | That same two-step path. 16:9 lands on 7680×4320. | |

Fast and Photo do not repaint the picture. Enhance can. The line under the buttons says so.

A picture that’s already that big doesn’t show the button. Fast 4× stops at 8K on the long edge (so it won’t turn a 4K picture into 16K).

The work runs in the background, like a new picture, and can go to the Alienware when that machine has the files. Enhance asks for about 14 GB of graphics memory, so it prefers this PC’s 16 GB card. The int8 SeedVR2 weights are what Prism loads. The fp16 7B file is larger than that card.

## Files ComfyUI needs

Weights are large and stay in ComfyUI’s folders. They are not in git. Put each file in the folder below, then press R in ComfyUI (or restart it) so the Load boxes see it. The router notices within about a minute.

### Fast 4× — Real-ESRGAN (BSD-3)

Either file, in `ComfyUI/models/upscale_models/`:

- [RealESRGAN_x4plus.pth](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth) (the official release)
- `RealESRGAN_x4plus.safetensors`, if you already have that name from the older Upscale button

### Photo 4× — 4xNomos2_hq_dat2 (CC-BY-4.0, credit Philip Hofmann)

Either file, in `ComfyUI/models/upscale_models/`:

- [4xNomos2_hq_dat2.safetensors](https://huggingface.co/Phips/4xNomos2_hq_dat2/resolve/main/4xNomos2_hq_dat2.safetensors)
- `4xNomos2_hq_dat2.pth` from [OpenModelDB](https://openmodeldb.info/models/4x-Nomos2-hq-dat2)

### Enhance — SeedVR2 7B int8 (Apache-2.0)

From [Comfy-Org/SeedVR2](https://huggingface.co/Comfy-Org/SeedVR2):

| File | Folder |
| --- | --- |
| [seedvr2_7b_int8_convrot.safetensors](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/diffusion_models/seedvr2_7b_int8_convrot.safetensors) (about 8 GB) | `ComfyUI/models/diffusion_models/` |
| [seedvr2_ema_vae_fp16.safetensors](https://huggingface.co/Comfy-Org/SeedVR2/resolve/main/vae/seedvr2_ema_vae_fp16.safetensors) (about 480 MB) | `ComfyUI/models/vae/` |

Enhance needs a ComfyUI that already has the built-in SeedVR2 nodes (`SeedVR2Preprocess`, `SeedVR2Conditioning`, `SeedVR2PostProcessing`). Those shipped in ComfyUI in 2026. No custom-node pack. If your ComfyUI is older, Enhance fails immediately and says so. Fast 4× and Photo 4× still work.

The recipe follows Comfy’s own “SeedVR2 7B Int8: Upscale Image” template (one step, euler / simple) and shrinks the picture to about 0.35 megapixels before SeedVR2, which is what [Comfy’s upscaling handbook](https://blog.comfy.org/p/upscaling-in-comfyui) recommends.

### 8K’s extra 2× — Real-ESRGAN x2plus (BSD-3)

Only Enhance 8K and 8K UHD need this. Same folder, `ComfyUI/models/upscale_models/`:

- [RealESRGAN_x2plus.pth](https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.1/RealESRGAN_x2plus.pth)
- or `RealESRGAN_x2plus.safetensors` if that’s the name you have

4K does not load it.

Prism does not use 4x-UltraSharp, UltraSharpV2, or SUPIR. Those aren’t licensed for this.

## If it fails

The job is marked failed, with a reason. It does not sit on “working” waiting for a model that isn’t there.

- **ComfyUI isn’t running.** Start it with `run_nvidia_gpu.bat`.
- **Missing file.** The message names the file. Put it in the folder above.
- **No SeedVR2 nodes.** Update ComfyUI, or use Fast 4× / Photo 4×.
- **Out of memory.** Close a few programs and try again. Enhance unloads other models first and tries once more.

## Recipes in the repo

- `apps/suite/lib/prism/upscale-workflow.json` — Fast 4× / Photo 4× (the model name is filled in when you press the button)
- `apps/suite/lib/prism/enhance-upscale-workflow.json` — SeedVR2, plus the 2× pass. A 4K job takes that 2× pass out before it runs.

## Check without a graphics card

From `apps/suite`:

```bash
node scripts/check-upscale.mjs
```

That checks the sizes and the recipes. It does not call ComfyUI.

To try a real picture: open Prism, make or load a picture, and press Fast 4× (ComfyUI running, Real-ESRGAN in place). Enhance 4K needs the two SeedVR2 files and a current ComfyUI. Enhance 8K also needs Real-ESRGAN x2plus.
