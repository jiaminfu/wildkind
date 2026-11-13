// 零依赖 PNG 解码 / 裁剪 / 缩放 / 重编码工具
// 用途：裁掉 AI 生成图右下角的平台水印，统一输出 1000x1000 PNG
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function readPNG(file) {
  const b = fs.readFileSync(file);
  let p = 8;
  let w = 0, h = 0, bd = 8, ct = 6;
  const idat = [];
  while (p < b.length) {
    const len = b.readUInt32BE(p);
    const type = b.toString('ascii', p + 4, p + 8);
    const data = b.slice(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0); h = data.readUInt32BE(4);
      bd = data[8]; ct = data[9];
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('仅支持 8bit PNG: ' + file);
  const ch = ct === 6 ? 4 : ct === 2 ? 3 : ct === 0 ? 1 : ct === 4 ? 2 : 0;
  if (!ch) throw new Error('不支持的 colorType ' + ct);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const out = Buffer.alloc(h * stride);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.slice(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = Buffer.alloc(stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch] : 0;
      const up = prev[i];
      const c = i >= ch ? prev[i - ch] : 0;
      let v = line[i];
      if (f === 1) v += a;
      else if (f === 2) v += up;
      else if (f === 3) v += (a + up) >> 1;
      else if (f === 4) {
        const pa = Math.abs(up - c), pb = Math.abs(a - c), pc = Math.abs(a + up - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? up : c;
      }
      cur[i] = v & 255;
    }
    cur.copy(out, y * stride);
    prev = cur;
  }
  return { w, h, ch, data: out };
}

function toRGB(img) {
  const { w, h, ch, data } = img;
  if (ch === 3) return data;
  if (ch === 4) {
    const o = Buffer.alloc(w * h * 3);
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      o[i * 3] = data[j]; o[i * 3 + 1] = data[j + 1]; o[i * 3 + 2] = data[j + 2];
    }
    return o;
  }
  const o = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const g = data[i * ch];
    o[i * 3] = g; o[i * 3 + 1] = g; o[i * 3 + 2] = g;
  }
  return o;
}

function sample(src, sw, sh, x, y) {
  const x0 = Math.max(0, Math.min(sw - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(sh - 1, Math.floor(y)));
  const x1 = Math.min(sw - 1, x0 + 1);
  const y1 = Math.min(sh - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, x - x0));
  const fy = Math.min(1, Math.max(0, y - y0));
  const i00 = (y0 * sw + x0) * 3, i10 = (y0 * sw + x1) * 3;
  const i01 = (y1 * sw + x0) * 3, i11 = (y1 * sw + x1) * 3;
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const top = src[i00 + k] * (1 - fx) + src[i10 + k] * fx;
    const bot = src[i01 + k] * (1 - fx) + src[i11 + k] * fx;
    out[k] = Math.round(top * (1 - fy) + bot * fy);
  }
  return out;
}

function cropResize(img, box, outW, outH) {
  const src = toRGB(img);
  const { sx, sy, sw, sh } = box;
  const o = Buffer.alloc(outW * outH * 3);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const px = sx + ((x + 0.5) / outW) * sw - 0.5;
      const py = sy + ((y + 0.5) / outH) * sh - 0.5;
      const c = sample(src, img.w, img.h, px, py);
      const i = (y * outW + x) * 3;
      o[i] = c[0]; o[i + 1] = c[1]; o[i + 2] = c[2];
    }
  }
  return o;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function writePNG(file, rgb, w, h) {
  const stride = w * 3;
  const raw = Buffer.alloc(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    rgb.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(file, png);
}

/** 裁掉底部 trimBottom 比例（含右下角水印），输出指定宽高 */
function processFile(src, dest, opts = {}) {
  const keepRatio = opts.keepRatio ?? 0.87;
  const outW = opts.outW ?? opts.size ?? 1000;
  const outH = opts.outH ?? opts.size ?? 1000;
  const anchorTop = opts.anchorTop ?? true;
  const img = readPNG(src);
  const targetRatio = outW / outH;
  const availH = img.h * keepRatio;
  let ch = Math.round(availH);
  let cw = Math.round(ch * targetRatio);
  if (cw > img.w) { cw = img.w; ch = Math.round(cw / targetRatio); }
  const sx = Math.round((img.w - cw) / 2);
  const sy = anchorTop ? 0 : Math.round((img.h - ch) / 2);
  const rgb = cropResize(img, { sx, sy, sw: cw, sh: ch }, outW, outH);
  writePNG(dest, rgb, outW, outH);
  return { src: path.basename(src), dest: path.basename(dest), from: `${img.w}x${img.h}`, to: `${outW}x${outH}` };
}

module.exports = { readPNG, writePNG, cropResize, processFile };

if (require.main === module) {
  const dir = process.argv[2];
  const map = process.argv[3]; // 可选 JSON: { "文件名片段": "输出名" }
  const files = fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'));
  const results = [];
  for (const f of files) {
    const dest = path.join(dir, f.replace(/\.png$/i, '.crop.png'));
    try {
      results.push(processFile(path.join(dir, f), dest));
    } catch (e) {
      results.push({ src: f, error: e.message });
    }
  }
  console.log(JSON.stringify(results, null, 1));
}
