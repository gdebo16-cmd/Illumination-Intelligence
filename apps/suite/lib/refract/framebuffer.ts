// The remote screen's pixels, kept on the server: RDP bitmap updates are drawn in (decoding the
// compressed ones), and the area that changed since the last send is cut out for the browser.
// Used by remote.ts.

export type RdpBitmap = {
  destTop: number;
  destLeft: number;
  destBottom: number;
  destRight: number;
  width: number;
  height: number;
  bitsPerPixel: number;
  isCompress: boolean;
  decompressed?: boolean;
  data: ArrayBufferView;
};

export class Framebuffer {
  width: number;
  height: number;
  pixels: Buffer; // RGBA, top-down
  // Changed area since the last send (inclusive-exclusive), or empty when x1 <= x0.
  x0 = 0;
  y0 = 0;
  x1 = 0;
  y1 = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.pixels = Buffer.alloc(width * height * 4);
    for (let i = 3; i < this.pixels.length; i += 4) this.pixels[i] = 255;
    this.markAll();
  }

  markAll() {
    this.x0 = 0;
    this.y0 = 0;
    this.x1 = this.width;
    this.y1 = this.height;
  }

  mark(x0: number, y0: number, x1: number, y1: number) {
    if (this.x1 <= this.x0) {
      this.x0 = x0;
      this.y0 = y0;
      this.x1 = x1;
      this.y1 = y1;
      return;
    }
    this.x0 = Math.min(this.x0, x0);
    this.y0 = Math.min(this.y0, y0);
    this.x1 = Math.max(this.x1, x1);
    this.y1 = Math.max(this.y1, y1);
  }

  get dirty(): boolean {
    return this.x1 > this.x0 && this.y1 > this.y0;
  }

  /** Copy one RDP bitmap rectangle in. Decompressed data is RGBA top-down; raw data is bottom-up BGR(X)/RGB565. */
  blit(b: RdpBitmap) {
    const left = b.destLeft;
    const top = b.destTop;
    if (left >= this.width || top >= this.height || b.width <= 0 || b.height <= 0) return;
    const w = Math.min(b.destRight - left + 1, b.width, this.width - left);
    const h = Math.min(b.destBottom - top + 1, b.height, this.height - top);
    if (w <= 0 || h <= 0) return;
    const src = Buffer.from(b.data.buffer, b.data.byteOffset, b.data.byteLength);
    const fb = this.pixels;
    if (b.decompressed) {
      const stride = b.width * 4;
      if (src.length < stride * h) return;
      for (let y = 0; y < h; y++) {
        src.copy(fb, ((top + y) * this.width + left) * 4, y * stride, y * stride + w * 4);
      }
    } else if (!b.isCompress) {
      const bytes = b.bitsPerPixel === 32 ? 4 : b.bitsPerPixel === 24 ? 3 : b.bitsPerPixel === 16 || b.bitsPerPixel === 15 ? 2 : 0;
      if (!bytes) return;
      const stride = (b.width * bytes + 3) & ~3;
      if (src.length < stride * b.height) return;
      for (let y = 0; y < h; y++) {
        const row = (b.height - 1 - y) * stride;
        let o = ((top + y) * this.width + left) * 4;
        for (let x = 0; x < w; x++, o += 4) {
          const i = row + x * bytes;
          if (bytes >= 3) {
            fb[o] = src[i + 2];
            fb[o + 1] = src[i + 1];
            fb[o + 2] = src[i];
          } else {
            const v = src[i] | (src[i + 1] << 8);
            if (b.bitsPerPixel === 16) {
              fb[o] = ((v >> 11) & 0x1f) << 3;
              fb[o + 1] = ((v >> 5) & 0x3f) << 2;
              fb[o + 2] = (v & 0x1f) << 3;
            } else {
              fb[o] = ((v >> 10) & 0x1f) << 3;
              fb[o + 1] = ((v >> 5) & 0x1f) << 3;
              fb[o + 2] = (v & 0x1f) << 3;
            }
          }
          fb[o + 3] = 255;
        }
      }
    } else {
      return;
    }
    this.mark(left, top, left + w, top + h);
  }

  /** The changed area as one message: x, y, w, h (uint16 LE) then RGBA rows. Clears the changed area. */
  takeDirty(): Buffer | null {
    if (!this.dirty) return null;
    const { x0, y0 } = this;
    const w = this.x1 - x0;
    const h = this.y1 - y0;
    this.x1 = this.x0 = this.y1 = this.y0 = 0;
    const out = Buffer.allocUnsafe(8 + w * h * 4);
    out.writeUInt16LE(x0, 0);
    out.writeUInt16LE(y0, 2);
    out.writeUInt16LE(w, 4);
    out.writeUInt16LE(h, 6);
    for (let y = 0; y < h; y++) {
      const start = ((y0 + y) * this.width + x0) * 4;
      this.pixels.copy(out, 8 + y * w * 4, start, start + w * 4);
    }
    return out;
  }
}
