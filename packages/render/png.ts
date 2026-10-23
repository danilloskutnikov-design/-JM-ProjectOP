import { deflateSync } from 'node:zlib';
import type { Surface } from './surface.ts';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

export function encodePng(s: Surface): Buffer {
  const raw = Buffer.alloc((s.w * 4 + 1) * s.h);
  for (let y = 0; y < s.h; y++) {
    raw[y * (s.w * 4 + 1)] = 0;
    Buffer.from(s.data.buffer, s.data.byteOffset + y * s.w * 4, s.w * 4).copy(raw, y * (s.w * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(s.w, 0);
  ihdr.writeUInt32BE(s.h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

/** Box-downscale by an integer factor. */
export function downscale(s: Surface, f: number, Cls: new (w: number, h: number) => Surface): Surface {
  const w = Math.floor(s.w / f);
  const h = Math.floor(s.h / f);
  const o = new Cls(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let j = 0; j < f; j++) for (let i = 0; i < f; i++) {
        const k = ((y * f + j) * s.w + (x * f + i)) * 4;
        r += s.data[k]; g += s.data[k + 1]; b += s.data[k + 2];
      }
      const n = f * f;
      const k = (y * w + x) * 4;
      o.data[k] = r / n; o.data[k + 1] = g / n; o.data[k + 2] = b / n; o.data[k + 3] = 255;
    }
  }
  return o;
}
