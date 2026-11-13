# Videos in Prism

Prism makes short videos on your own ComfyUI, either from a picture or from words only.

- **From a picture:** load a picture (or press **Make video** under one of yours), then describe what should move.
- **From words:** press **Video** above the prompt box with no picture loaded, pick a shape in the side panel, and describe the whole video.

The **Video model** dropdown in the side panel has two choices:

| Model | What it's like | Size and speed |
| --- | --- | --- |
| **Fast (Wan 2.2 5B)** | The model Prism started with. 720p, 24 frames a second. | About 2½ min for a 2-second clip on the Raider. |
| **Better (Wan 2.2 14B)** | Much better motion and detail. Uses the 4-step Lightning add-ons. 1024×576, 16 frames a second. | Not measured yet. The time shown under each length becomes the real average after a few videos. |

A model shows as "not downloaded yet" until a machine's ComfyUI has every file it needs. Videos from words and videos from a picture need different files for the 14B model, so it can be ready for one and not the other.

Both models want about 14 GB of graphics memory, so videos go to the Raider (16 GB). They only go to the Alienware if its ComfyUI has the same files.

## Smooth

Under a finished video, **Smooth** makes a copy with an in-between frame after every frame (RIFE frame interpolation). The clip keeps its length but plays at twice the frames a second, so motion looks smoother: 24 → 48 for Fast, 16 → 32 for Better. The original is kept. If a video already has a smooth copy, the button says **See smooth version** instead.

RIFE is small, so the GPU queue sends it to the machine with the smallest card that can run it: the **Alienware**, leaving the Raider free for the next video. If only the Raider has it set up, it runs there.

**Setup, on the Alienware (and the Raider too if you like):** in ComfyUI Manager, install **ComfyUI-Frame-Interpolation** (by Fannovel16), then restart ComfyUI. That's all. The RIFE model file (`rife49.pth`, MIT licence) downloads itself the first time Smooth runs, so that first run takes a bit longer and needs the internet. The Smooth button stays hidden until some machine has the add-on.

## Files ComfyUI needs

Model files are large and stay in ComfyUI's folders, not in git. Put each file in the folder shown, then press R in ComfyUI (or restart it). Prism notices within about a minute.

The names must match exactly: Prism reads them from the recipes (`apps/suite/lib/prism/wan-video-workflow.json` and `wan14b-video-workflow.json`).

### Fast (Wan 2.2 5B)

You already have these.

- `models/diffusion_models/wan2.2_ti2v_5B_fp16.safetensors`
- `models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`
- `models/vae/wan2.2_vae.safetensors`

The same files also make videos from words.

### Better (Wan 2.2 14B with Lightning), Apache 2.0

**1. Install the GGUF add-on.** In ComfyUI Manager, install **ComfyUI-GGUF** (by city96), then restart ComfyUI. It adds the "Unet Loader (GGUF)" box that loads the slimmed-down 14B halves. Without it, the 14B model stays greyed out.

**2. Shared files.** Put these in place for both kinds of video:

- `models/text_encoders/umt5_xxl_fp8_e4m3fn_scaled.safetensors`: you already have this.
- `models/vae/wan_2.1_vae.safetensors` (about 250 MB). The 14B model uses the Wan **2.1** VAE, not the 2.2 one. Download it from [Comfy-Org/Wan_2.2_ComfyUI_Repackaged](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/vae).

**3. For videos from a picture:** two model halves and two Lightning add-ons.

- `models/unet/Wan2.2-I2V-A14B-HighNoise-Q4_K_M.gguf` (about 9.7 GB)
- `models/unet/Wan2.2-I2V-A14B-LowNoise-Q4_K_M.gguf`

  Both are from [QuantStack/Wan2.2-I2V-A14B-GGUF](https://huggingface.co/QuantStack/Wan2.2-I2V-A14B-GGUF/tree/main), in its `HighNoise` and `LowNoise` folders. Put the files straight into `models/unet/`, not in subfolders.
- `models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_high_noise.safetensors`
- `models/loras/wan2.2_i2v_lightx2v_4steps_lora_v1_low_noise.safetensors`

  Both are from [Comfy-Org/Wan_2.2_ComfyUI_Repackaged, loras folder](https://huggingface.co/Comfy-Org/Wan_2.2_ComfyUI_Repackaged/tree/main/split_files/loras), about 1.2 GB each.

**4. For videos from words:** the text → video versions of the same four files.

- `models/unet/Wan2.2-T2V-A14B-HighNoise-Q4_K_M.gguf`
- `models/unet/Wan2.2-T2V-A14B-LowNoise-Q4_K_M.gguf`

  Both are from [QuantStack/Wan2.2-T2V-A14B-GGUF](https://huggingface.co/QuantStack/Wan2.2-T2V-A14B-GGUF/tree/main).
- `models/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_high_noise.safetensors`
- `models/loras/wan2.2_t2v_lightx2v_4steps_lora_v1.1_low_noise.safetensors`

  Both are from the same Comfy-Org loras folder.

### Why Q4_K_M

Q4_K_M is the slimmed-down copy that fits the Raider's memory. The two halves are about 19 GB together, plus about 7 GB for the text model, which leaves room in 32 GB for Windows. Q5_K_M looks a little better but is about 2 GB bigger per half. To try it, download the Q5 files and change the four `.gguf` names: two in `wan14b-video-workflow.json`, two in `TEXT_FILES` in `lib/prism/video.ts`.

## Tuning the 14B model

These settings are in `apps/suite/config/prism-video-models.ts`:

- **Frame size** (`pixels`): 1024×576 to start. If it runs out of memory, use 832×480 (`832 * 480`). If it's comfortable, try 1280×720.
- **Time guesses** (`estimates`): only the first guess. Real averages replace them.

In `wan14b-video-workflow.json`:

- **Lightning strength** (`strength_model` in boxes 60 and 61): 1. If motion looks slow-motion, lower box 60 (high noise) to about 0.5–0.8.
- **Shift** (boxes 48 and 49): 5.

## If something goes wrong

- **"Better" stays greyed out:** a file is missing or named differently, or ComfyUI-GGUF isn't installed. The names in the recipe are the ones Prism looks for.
- **Out of memory, or Windows error 1450:** close other programs, use 832×480, or keep Q4 instead of Q5.
- **ComfyUI says "UnetLoaderGGUF" doesn't exist:** ComfyUI-GGUF isn't installed, or ComfyUI wasn't restarted after installing it.
- **No Smooth button:** no machine has ComfyUI-Frame-Interpolation yet, or ComfyUI wasn't restarted after installing it.
- **Smooth fails the first time:** RIFE couldn't download `rife49.pth`. Check that machine's internet, or put the file in `ComfyUI/custom_nodes/ComfyUI-Frame-Interpolation/ckpts/rife/` yourself.
