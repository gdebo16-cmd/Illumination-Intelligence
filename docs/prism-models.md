# More models for Prism: what could go in a model picker

Research notes, November 2026. Nothing here is built yet.

**Your PC:** RTX 5080 Laptop (16 GB of graphics memory), 32 GB of normal memory, ComfyUI.
**Prism today:** FLUX.2 Klein 4B for pictures and picture edits, Wan 2.2 TI2V 5B for picture → video.

How to read the tables:

- **Size** is how much space the model takes on the graphics card. Over 16 GB still works, but some of it spills into normal memory and it gets slower.
- **"Slimmed-down" (FP8, NVFP4, GGUF)** means a compressed copy of the model: a little lower quality, much smaller. Your card is a 50-series ("Blackwell"), so it can use the newest NVFP4 copies, which are the smallest.
- **License:** "Free for anything" (Apache 2.0, MIT) means you can do whatever you like. "Personal only" means fine at home, but not for selling things.
- Speeds are rough guesses for your laptop, not measured.

## Pictures

| Model | What it adds to Prism | Size / speed | License |
|---|---|---|---|
| **Z-Image Turbo** (Alibaba) | Very realistic photos, and it can write short text in pictures. Best all-rounder for a 16 GB card. | 6B. Fits in 16 GB. About 8 steps, so a few seconds a picture. | Free for anything (Apache 2.0) |
| **Qwen-Image** + **Qwen-Image-Edit** (Alibaba) | The best at **text in pictures**: posters, signs, menus, logos. The Edit version can change words in a photo. | 20B. Needs the slimmed-down GGUF copy (about 12 GB). Slow: tens of seconds. | Original release: free for anything (Apache 2.0). The newer **2.1 is research only**, so stick with the original. |
| **HiDream-O1-Image Dev** (HiDream, May 2026) | Strong at following long, detailed descriptions. | 8B. About 8 GB as FP8. 28 steps, so slower than Z-Image. | Free for anything (MIT) |
| **FLUX.2 Klein 9B** (Black Forest Labs) | Same kind of model you have now, but bigger and better looking. Easiest swap. | 9B. Fits as FP8. A bit slower than the 4B. | Personal only (FLUX non-commercial). Your 4B is Apache 2.0. |
| **SDXL anime models** (for example Illustrious) | **Anime and cartoon** styles, plus thousands of free style add-ons ("LoRAs") from the community. | About 7 GB. Fast. | Free with some rules (OpenRAIL) |
| **Hunyuan3D 2.1** (Tencent) | A new kind of creation: **picture → 3D model** you can spin around or 3D print. | Fits in 16 GB for the shape. Around a minute. | Tencent community license (free at home; not allowed in the EU, UK or South Korea) |
| **An upscaler** (for example SeedVR2, or 4x-UltraSharp) | Makes any picture or video **bigger and sharper**. Good as an "Enlarge" button. | Small. Seconds. | Free (check each one) |

## Videos

| Model | What it adds to Prism | Size / speed | License |
|---|---|---|---|
| **Wan 2.2 14B** (image → video and text → video) | Much better motion and detail than the 5B you use now, and **text → video** with no starting picture. With the free "Lightning" add-on it needs only 4 steps. | Two 14B halves. Needs the slimmed-down GGUF copy and spills into normal memory. A few minutes per 5-second clip. | Free for anything (Apache 2.0) |
| **LTX-2.3** (Lightricks, March 2026) | **Videos with sound**: voices, music and noises made together with the picture. | 22B. Lightricks lists 16 GB with the NVFP4 copy on 50-series cards. The "distilled" version needs only about 8 steps. | LTX-2 community license: free unless a company makes over $10M a year |
| **HunyuanVideo 1.5** (Tencent) | Good-looking text → video and image → video, built into ComfyUI. | 8.3B. Should fit with spill-over. Slower than LTX. | Tencent community license (not in the EU, UK or South Korea) |
| **FramePack** | **Long videos**: up to about a minute from one picture, even on small cards. | Runs on as little as 6 GB. Slow, but steady. | Code is free (Apache 2.0); it uses Tencent's Hunyuan model license |
| **Wan 2.2 Animate / S2V** | **Make a picture talk or sing** from a sound clip (S2V), or copy the moves from one video onto your character (Animate). | 14B, so same as Wan 14B above. | Free for anything (Apache 2.0) |

Note: Wan 2.5 and newer are **not** free to download. In ComfyUI they only run as paid online services, so they don't fit Prism.

## My suggestion

1. **Pictures:** add **Z-Image Turbo** first. It's fast, looks great, fits easily and is free for anything. Add **Qwen-Image** second, as the "text and posters" choice.
2. **Videos:** add **Wan 2.2 14B with the Lightning add-on** first. It's the same family you already use, so the work is small, and you get text → video too.
3. **Something new:** **LTX-2.3** for videos with sound is the most exciting next step, but check it fits well on your card before building around it.

A model picker would only need: a list of models (name, kind, what it's good at), one ComfyUI workflow file per model, and a drop-down in Prism. Only one big model fits on the card at a time, so switching models makes the first picture after a switch a bit slower.

## Unsure

Some numbers come from blogs and don't always agree. Check each model's page before downloading. In particular:

- LTX-2.3's memory needs: blogs say 16 GB with NVFP4, 32 GB with FP8.
- Reports of an even newer "LTX-2.5" (August 2026) that needs 32 GB I couldn't confirm.

## Sources

- [Best ComfyUI image models 2026: guide and licences](https://www.tutorial3d.it/en/ai-artificial-intelligence/comfyui-image-models-guide/)
- [Best Open-Source AI Image Models to Self-Host in 2026](https://pinggy.io/blog/best_free_open_source_ai_image_generators_to_self_host/)
- [Best ComfyUI Models 2026: Flux, Qwen, Z-Image, SDXL and Wan](https://iimagined.ai/blog/best-comfyui-models-2026)
- [HiDream-O1-Image on Hugging Face](https://huggingface.co/HiDream-ai/HiDream-O1-Image) and [ComfyUI docs for HiDream-O1](https://docs.comfy.org/tutorials/image/hidream/hidream-o1.md)
- [LTX-2 in ComfyUI (Comfy blog)](https://blog.comfy.org/p/ltx-2-open-source-audio-video-ai) and [LTX-2.3 FP8 model card](https://huggingface.co/Lightricks/LTX-2.3-fp8/blob/main/README.md)
- [Best Open-Source Video Generation Stack 2026](https://builderai.tools/blog/best-open-source-video-generation-stack-2026)
- [Best Open-Source AI Video Generation Models (2026)](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)
- [Local Text-to-Video on Low VRAM (2026)](https://localaimaster.com/blog/local-text-to-video-low-vram)
