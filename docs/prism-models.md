# More models for Prism: what could go in a model picker

Research notes, November 2026. Upscale is built (see [prism-upscale.md](prism-upscale.md)). The other models here are not.

**Your PC:** RTX 5080 Laptop (16 GB of graphics memory), 32 GB of normal memory, ComfyUI.
**Prism today:** FLUX.2 Klein 4B for pictures and picture edits, Wan 2.2 TI2V 5B for picture → video. (Since 13 November: Wan 2.2 14B with Lightning is built in as the "Better" video model, and videos can be made from words too. Setup: [prism-video.md](prism-video.md).)

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
| **Upscale, now in Prism** | Fast 4× (Real-ESRGAN or Nomos DAT) and Enhance to 4K / 8K (SeedVR2 7B int8, then a faithful 2× for 8K). Setup is in [prism-upscale.md](prism-upscale.md). 4x-UltraSharp and SUPIR are not used (non-commercial licences). | Fast path is small. SeedVR2 int8 is most of 16 GB. | Apache-2.0, BSD-3, CC-BY-4.0 |

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

## Video update, 13 November 2026

I checked again for video only, against both machines: the **Raider** (RTX 5080 Laptop, 16 GB card, 32 GB memory) and the **Alienware** (RTX 3070 Laptop, 8 GB card, 64 GB memory). Prism still uses Wan 2.2 TI2V 5B: about 150 s for 2 seconds of video, 450 s for 5 seconds.

### What changed since 9 November

| Model | What it is | Fits your machines? | Verdict |
|---|---|---|---|
| **LTX-2.5** (Lightricks, August 2026) | Newer LTX, video with sound. | Lightricks' own minimum is a **32 GB** card. A community NVFP4 copy is about 19 GB, plus a 15 GB text model. | **Skip for now.** Too big for the Raider without heavy spill-over. |
| **Pika H3 Flex** (30 Oct 2026) | Add-ons for the 33B MiniMax H3 model. Video with sound, up to 12 reference pictures. | Tested on an 80 GB server card. The base model alone is about 211 GB to download. | **Skip.** Too big, and reports say its licence may exclude the US. Check before trying. |
| **Tencent Hy-Nomas** (21 Oct 2026) | An "interactive world": you steer the camera and the scene as the video goes, up to about a minute. | A community ComfyUI version says 12 GB and up (INT8, about 9 GB). | **Fun extra, personal use only.** The main model is Apache 2.0, but its video decoder is NVIDIA non-commercial. |
| **NVIDIA Cosmos 3** (5 Nov 2026) | World simulation for robots and cars. | 96 GB card or more. | **Skip.** |

### Recommendation (unchanged at the top, with two additions)

1. **Main upgrade: Wan 2.2 14B image → video and text → video, with the Lightning 4-step add-ons.** It's still the best match for the Raider. Use the Q4 or Q5 GGUF copies (about 8.5 GB per half) or FP8. People run this on 16 GB cards. It's the same family as today's model, so the Prism changes are small: a new workflow file and a text → video switch. Apache 2.0. Test how fast it really is here before replacing the 5B.
2. **Addition: smoother video with RIFE (frame interpolation).** It adds in-between frames, turning 24 frames a second into 48. The model is tiny and fast, so it's a good job for the **Alienware**, leaving the Raider free. It's a cheap win for every video Prism already makes.
3. **Addition, later: video with sound, using LTX-2.3 distilled NVFP4** on the Raider. It's the only model with sound that has a reasonable chance of fitting. Two warnings: NVIDIA's guide pairs 16 GB cards with **64 GB** of memory (the Raider has 32 GB), and some reports say sound pushes it past 16 GB. Try it by hand in ComfyUI before building it into Prism.
4. **Maybe: Enhance for videos with SeedVR2 3B INT8** (720p → 1080p). Prism already uses SeedVR2 7B for pictures, but on video it's very memory-hungry: people with 16 GB cards report failures without "block swap". Make 1080p in one pass; don't go straight to 4K.

The Alienware's 8 GB card is too small for any of the big video models. It's best kept for pictures (Quicksketch) and small video jobs like RIFE.

### Sources for this update

- [LTX-2.5 VRAM requirements](https://willitrunai.com/blog/ltx-2-5-vram-requirements), [LTX-2.5 open weights (ComfyUI Wiki)](https://comfyui-wiki.com/en/news/2026-08-11-ltx-2-5-open-weights-release), [LTX models by VRAM](https://ltxworkflow.com/models), [LTX-2.3 in ComfyUI](https://www.thundercompute.com/blog/ltx-2-3-comfyui)
- [Pika H3 Flex blog](https://pika.art/blog/pika-h3-flex), [H3 Flex hardware fit](https://www.madebyagents.com/models/pika-h3-flex), [H3 Flex licence notes](https://explainx.ai/blog/pika-h3-flex-open-weight-video-audio-model-minimax-h3-six-steps-designarena-7-comfyui-license-2026)
- [ComfyUI-Hy-Nomas](https://github.com/PedroMarinhoDev/ComfyUI-Hy-Nomas), [Hy-Nomas licence and requirements](https://www.datastudios.org/post/tencent-hy-nomas-open-weight-interactive-world-model)
- [AI image and video news roundup, 7 Nov 2026](https://www.kombitz.com/2026/11/07/ai-image-video-model-news-roundup-november-7-2026/)
- [Wan2.2 Lightning](https://github.com/ModelTC/Wan2.2-Lightning), [Wan 2.2 GGUF + Lightning on budget cards](https://community.latenode.com/t/quick-video-ai-setup-for-budget-12gb-graphics-cards-wan-2-2-gguf-models-lightning-training-optimized-steps/33286), [Wan 2.2 speed tips](https://aiidelist.com/blog/how-to-make-wan-2-2-video-generation-faster.md)
- [SeedVR2 video upscaler](https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler), [SeedVR2 notes](https://weirdwonderfulai.art/resources/seedvr2-upscaler-for-video-and-images/), [Best open video models for 8–24 GB](https://blog.ossium.in/what-s-the-best-open-source-ai-video-model-you-can-actually-run-8gb-24gb-vram)

## Unsure

Some numbers come from blogs and don't always agree. Check each model's page before downloading. In particular:

- LTX-2.3's memory needs: blogs say 16 GB with NVFP4, 32 GB with FP8.
- LTX-2.5 (August 2026) is real; see the video update above.

## Sources

- [Best ComfyUI image models 2026: guide and licences](https://www.tutorial3d.it/en/ai-artificial-intelligence/comfyui-image-models-guide/)
- [Best Open-Source AI Image Models to Self-Host in 2026](https://pinggy.io/blog/best_free_open_source_ai_image_generators_to_self_host/)
- [Best ComfyUI Models 2026: Flux, Qwen, Z-Image, SDXL and Wan](https://iimagined.ai/blog/best-comfyui-models-2026)
- [HiDream-O1-Image on Hugging Face](https://huggingface.co/HiDream-ai/HiDream-O1-Image) and [ComfyUI docs for HiDream-O1](https://docs.comfy.org/tutorials/image/hidream/hidream-o1.md)
- [LTX-2 in ComfyUI (Comfy blog)](https://blog.comfy.org/p/ltx-2-open-source-audio-video-ai) and [LTX-2.3 FP8 model card](https://huggingface.co/Lightricks/LTX-2.3-fp8/blob/main/README.md)
- [Best Open-Source Video Generation Stack 2026](https://builderai.tools/blog/best-open-source-video-generation-stack-2026)
- [Best Open-Source AI Video Generation Models (2026)](https://www.thundercompute.com/blog/best-open-source-ai-video-generation-models)
- [Local Text-to-Video on Low VRAM (2026)](https://localaimaster.com/blog/local-text-to-video-low-vram)
