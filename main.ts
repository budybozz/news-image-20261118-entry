// news-image-20261118 entry — generates a world news summary image for 18 November 2026
// Node 22, standard library only. Writes deterministic PNG to /output/entry.png

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// ============================================================================
// PNG encoder with LZ77 + static Huffman deflate compression
// ============================================================================

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  for (const byte of data) crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  return (crc ^ 0xffffffff) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
  const len = new Uint8Array(4);
  new DataView(len.buffer).setUint32(0, data.length, false);
  const typeArr = new TextEncoder().encode(type);
  const chunk = new Uint8Array(4 + 4 + data.length + 4);
  chunk.set(len, 0);
  chunk.set(typeArr, 4);
  chunk.set(data, 8);
  const crc = crc32(new Uint8Array([...typeArr, ...data]));
  new DataView(chunk.buffer).setUint32(8 + data.length, crc, false);
  return chunk;
}

// Bit writer for Huffman encoding
class BitWriter {
  bytes: number[] = [];
  buffer = 0;
  bits = 0;
  write(bits: number, count: number) {
    this.buffer |= bits << this.bits;
    this.bits += count;
    while (this.bits >= 8) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer >>>= 8;
      this.bits -= 8;
    }
  }
  flush() {
    while (this.bits > 0) {
      this.bytes.push(this.buffer & 0xff);
      this.buffer >>>= 8;
      this.bits -= 8;
    }
  }
  getData(): Uint8Array {
    this.flush();
    return new Uint8Array(this.bytes);
  }
}

// Build static Huffman trees (deflate RFC 1951)
function buildStaticHuffman(): { litlen: Map<number, {code: number, len: number}>, dist: Map<number, {code: number, len: number}> } {
  const litlen = new Map<number, {code: number, len: number}>();
  const dist = new Map<number, {code: number, len: number}>();
  
  // Literal/length codes (0-285)
  // 0-143: 8 bits, 144-255: 9 bits, 256-279: 7 bits, 280-287: 8 bits
  let code = 0;
  for (let i = 0; i <= 143; i++) { litlen.set(i, {code: reverseBits(code++, 8), len: 8}); }
  for (let i = 144; i <= 255; i++) { litlen.set(i, {code: reverseBits(code++, 9), len: 9}); }
  for (let i = 256; i <= 279; i++) { litlen.set(i, {code: reverseBits(code++, 7), len: 7}); }
  for (let i = 280; i <= 287; i++) { litlen.set(i, {code: reverseBits(code++, 8), len: 8}); }
  
  // Distance codes (0-29): all 5 bits
  code = 0;
  for (let i = 0; i <= 29; i++) { dist.set(i, {code: reverseBits(code++, 5), len: 5}); }
  
  return { litlen, dist };
}

function reverseBits(n: number, len: number): number {
  let r = 0;
  for (let i = 0; i < len; i++) { r = (r << 1) | (n & 1); n >>>= 1; }
  return r;
}

// Length codes (257-285) and extra bits
const LENGTH_BASE = [3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258];
const LENGTH_EXTRA = [0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0];
const DIST_BASE = [1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577];
const DIST_EXTRA = [0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13];

function compressDeflate(data: Uint8Array): Uint8Array {
  const { litlen, dist } = buildStaticHuffman();
  const writer = new BitWriter();
  
  // Write BFINAL=1, BTYPE=10 (static Huffman)
  writer.write(1, 1); // BFINAL
  writer.write(2, 2); // BTYPE = 10 (static)
  
  // Simple LZ77: find matches in sliding window (32KB)
  const WIN_SIZE = 32768;
  const MIN_MATCH = 3;
  const MAX_MATCH = 258;
  
  let pos = 0;
  while (pos < data.length) {
    let bestLen = 0;
    let bestDist = 0;
    const maxMatch = Math.min(MAX_MATCH, data.length - pos);
    
    // Search for match in window
    const windowStart = Math.max(0, pos - WIN_SIZE);
    for (let i = windowStart; i < pos; i++) {
      let len = 0;
      while (len < maxMatch && data[pos + len] === data[i + len]) len++;
      if (len > bestLen && len >= MIN_MATCH) {
        bestLen = len;
        bestDist = pos - i;
      }
    }
    
    if (bestLen >= MIN_MATCH) {
      // Emit length code
      let lenCode = 257;
      while (lenCode < 285 && bestLen >= LENGTH_BASE[lenCode - 257 + 1]) lenCode++;
      const ll = litlen.get(lenCode)!;
      writer.write(ll.code, ll.len);
      if (LENGTH_EXTRA[lenCode - 257] > 0) {
        writer.write(bestLen - LENGTH_BASE[lenCode - 257], LENGTH_EXTRA[lenCode - 257]);
      }
      
      // Emit distance code
      let distCode = 0;
      while (distCode < 29 && bestDist > DIST_BASE[distCode + 1]) distCode++;
      const dd = dist.get(distCode)!;
      writer.write(dd.code, dd.len);
      if (DIST_EXTRA[distCode] > 0) {
        writer.write(bestDist - DIST_BASE[distCode], DIST_EXTRA[distCode]);
      }
      
      pos += bestLen;
    } else {
      // Emit literal
      const ll = litlen.get(data[pos])!;
      writer.write(ll.code, ll.len);
      pos++;
    }
  }
  
  // End of block (literal 256)
  const eob = litlen.get(256)!;
  writer.write(eob.code, eob.len);
  
  const compressed = writer.getData();
  
  // Wrap in zlib
  const zlib = new Uint8Array(2 + compressed.length + 4);
  zlib[0] = 0x78; zlib[1] = 0x9c; // zlib header: deflate, default compression
  zlib.set(compressed, 2);
  
  // Adler-32
  let a = 1, b = 0;
  for (const byte of data) { a = (a + byte) % 65521; b = (b + a) % 65521; }
  const adler32 = (b << 16) | a;
  new DataView(zlib.buffer).setUint32(2 + compressed.length, adler32, false);
  
  return zlib;
}

function encodePNG(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, width, false);
  new DataView(ihdr.buffer).setUint32(4, height, false);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  const stride = width * 4;
  const scanlines = new Uint8Array(height * (stride + 1));
  for (let y = 0; y < height; y++) {
    scanlines[y * (stride + 1)] = 0; // filter: none
    scanlines.set(pixels.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }

  const idatData = compressDeflate(scanlines);

  const chunks = [
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', idatData),
    writeChunk('IEND', new Uint8Array(0))
  ];
  const totalLen = 8 + chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(totalLen);
  out.set(sig, 0);
  let pos = 8;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// ============================================================================
// Simple 2D drawing context
// ============================================================================

class DrawContext {
  width: number; height: number; pixels: Uint8Array;
  constructor(width: number, height: number, bg = 0xffffffff) {
    this.width = width; this.height = height;
    this.pixels = new Uint8Array(width * height * 4);
    const r = (bg >> 24) & 0xff, g = (bg >> 16) & 0xff, b = (bg >> 8) & 0xff, a = bg & 0xff;
    for (let i = 0; i < this.pixels.length; i += 4) { this.pixels[i] = r; this.pixels[i+1] = g; this.pixels[i+2] = b; this.pixels[i+3] = a; }
  }
  setPixel(x: number, y: number, color: number) {
    if (x < 0 || x >= this.width || y < 0 || y >= this.height) return;
    const i = (y * this.width + x) * 4;
    const a = (color & 0xff) / 255;
    const r = (color >> 24) & 0xff, g = (color >> 16) & 0xff, b = (color >> 8) & 0xff;
    this.pixels[i] = Math.round(this.pixels[i] * (1 - a) + r * a);
    this.pixels[i+1] = Math.round(this.pixels[i+1] * (1 - a) + g * a);
    this.pixels[i+2] = Math.round(this.pixels[i+2] * (1 - a) + b * a);
    this.pixels[i+3] = 255;
  }
  fillRect(x: number, y: number, w: number, h: number, color: number) {
    const r = (color >> 24) & 0xff, g = (color >> 16) & 0xff, b = (color >> 8) & 0xff, a = (color & 0xff) / 255;
    for (let yy = y; yy < y + h; yy++) {
      const base = (yy * this.width + x) * 4;
      for (let xx = 0; xx < w; xx++) {
        const i = base + xx * 4;
        this.pixels[i] = Math.round(this.pixels[i] * (1 - a) + r * a);
        this.pixels[i+1] = Math.round(this.pixels[i+1] * (1 - a) + g * a);
        this.pixels[i+2] = Math.round(this.pixels[i+2] * (1 - a) + b * a);
        this.pixels[i+3] = 255;
      }
    }
  }
  drawRect(x: number, y: number, w: number, h: number, color: number) {
    this.fillRect(x, y, w, 1, color);
    this.fillRect(x, y + h - 1, w, 1, color);
    this.fillRect(x, y, 1, h, color);
    this.fillRect(x + w - 1, y, 1, h, color);
  }
  drawText(x: number, y: number, text: string, color: number, fontSize: number = 12, center = false) {
    const font: Record<string, number[][]> = {
      '0': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
      '1': [[0,1,0],[1,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
      '2': [[1,1,1],[0,0,1],[0,0,1],[1,1,1],[1,0,0],[1,0,0],[1,1,1]],
      '3': [[1,1,1],[0,0,1],[0,0,1],[1,1,1],[0,0,1],[0,0,1],[1,1,1]],
      '4': [[1,0,1],[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1],[0,0,1]],
      '5': [[1,1,1],[1,0,0],[1,0,0],[1,1,1],[0,0,1],[0,0,1],[1,1,1]],
      '6': [[1,1,1],[1,0,0],[1,0,0],[1,1,1],[1,0,1],[1,0,1],[1,1,1]],
      '7': [[1,1,1],[0,0,1],[0,0,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
      '8': [[1,1,1],[1,0,1],[1,0,1],[1,1,1],[1,0,1],[1,0,1],[1,1,1]],
      '9': [[1,1,1],[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1],[1,1,1]],
      'N': [[1,0,1],[1,1,1],[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1]],
      'O': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
      'V': [[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[0,1,0]],
      'E': [[1,1,1],[1,0,0],[1,0,0],[1,1,1],[1,0,0],[1,0,0],[1,1,1]],
      'M': [[1,0,1],[1,1,1],[1,1,1],[1,1,1],[1,0,1],[1,0,1],[1,0,1]],
      'B': [[1,1,1],[1,0,1],[1,0,1],[1,1,1],[1,0,1],[1,0,1],[1,1,1]],
      'R': [[1,1,1],[1,0,1],[1,0,1],[1,1,1],[1,1,0],[1,0,1],[1,0,1]],
      'A': [[0,1,0],[1,0,1],[1,0,1],[1,1,1],[1,0,1],[1,0,1],[1,0,1]],
      'D': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
      'Y': [[1,0,1],[1,0,1],[1,0,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
      'U': [[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
      'L': [[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,1,1]],
      'T': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0]],
      'H': [[1,0,1],[1,0,1],[1,0,1],[1,1,1],[1,0,1],[1,0,1],[1,0,1]],
      'I': [[1,1,1],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[0,1,0],[1,1,1]],
      'S': [[1,1,1],[1,0,0],[1,0,0],[1,1,1],[0,0,1],[0,0,1],[1,1,1]],
      'C': [[1,1,1],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,0,0],[1,1,1]],
      'P': [[1,1,1],[1,0,1],[1,0,1],[1,1,1],[1,0,0],[1,0,0],[1,0,0]],
      'F': [[1,1,1],[1,0,0],[1,0,0],[1,1,1],[1,0,0],[1,0,0],[1,0,0]],
      'G': [[1,1,1],[1,0,0],[1,0,0],[1,0,1],[1,0,1],[1,0,1],[1,1,1]],
      'W': [[1,0,1],[1,0,1],[1,1,1],[1,1,1],[1,0,1],[1,0,1],[1,0,1]],
      'K': [[1,0,1],[1,0,1],[1,1,0],[1,0,0],[1,1,0],[1,0,1],[1,0,1]],
      'X': [[1,0,1],[1,0,1],[0,1,0],[0,1,0],[0,1,0],[1,0,1],[1,0,1]],
      'Z': [[1,1,1],[0,0,1],[0,1,0],[0,1,0],[1,0,0],[1,0,0],[1,1,1]],
      'J': [[1,1,1],[0,0,1],[0,0,1],[0,0,1],[0,0,1],[1,0,1],[1,1,1]],
      'Q': [[1,1,1],[1,0,1],[1,0,1],[1,0,1],[1,1,1],[0,0,1],[0,0,1]],
      ':': [[0,0,0],[0,1,0],[0,1,0],[0,0,0],[0,1,0],[0,1,0],[0,0,0]],
      '-': [[0,0,0],[0,0,0],[0,0,0],[1,1,1],[0,0,0],[0,0,0],[0,0,0]],
      '.': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,1,0],[0,1,0]],
      ',': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,1,0],[0,1,0],[0,1,0]],
      '/': [[0,0,1],[0,0,1],[0,1,0],[0,1,0],[1,0,0],[1,0,0],[1,0,0]],
      ' ': [[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
      "'": [[0,1,0],[0,1,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0],[0,0,0]],
    };
    const scale = Math.max(1, Math.floor(fontSize / 7));
    const charW = 3 * scale;
    let startX = center ? x - Math.floor(text.length * (charW + scale) / 2) : x;
    for (let ci = 0; ci < text.length; ci++) {
      const ch = text[ci].toUpperCase();
      const glyph = font[ch] || font[' '];
      for (let gy = 0; gy < 7; gy++) for (let gx = 0; gx < 3; gx++) if (glyph[gy][gx]) {
        for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) this.setPixel(startX + gx * scale + sx, y + gy * scale + sy, color);
      }
      startX += charW + scale;
    }
  }
  drawLine(x1: number, y1: number, x2: number, y2: number, color: number) {
    const dx = Math.abs(x2 - x1), sx = x1 < x2 ? 1 : -1;
    const dy = -Math.abs(y2 - y1), sy = y1 < y2 ? 1 : -1;
    let err = dx + dy, e2; let cx = x1, cy = y1;
    while (true) { this.setPixel(cx, cy, color); if (cx === x2 && cy === y2) break; e2 = 2 * err; if (e2 >= dy) { err += dy; cx += sx; } if (e2 <= dx) { err += dx; cy += sy; } }
  }
  drawCircle(cx: number, cy: number, r: number, color: number, fill = false) {
    if (fill) { for (let y = -r; y <= r; y++) { const dx = Math.floor(Math.sqrt(r * r - y * y)); for (let x = -dx; x <= dx; x++) this.setPixel(cx + x, cy + y, color); } }
    else { for (let y = -r; y <= r; y++) { const dx = Math.floor(Math.sqrt(r * r - y * y)); this.setPixel(cx + dx, cy + y, color); this.setPixel(cx - dx, cy + y, color); } }
  }
}

// ============================================================================
// News summary image for 18 November 2026 (512x384 to fit 1 MiB)
// ============================================================================

const WIDTH = 512;
const HEIGHT = 384;

function generateNewsImage(): Uint8Array {
  const ctx = new DrawContext(WIDTH, HEIGHT, 0x0d1117ff);

  const WHITE = 0xffffffff, GRAY = 0x8b949eff;
  const RED = 0xff4444ff, BLUE = 0x4488ff, GREEN = 0x44ff44ff, YELLOW = 0xffff44ff, ORANGE = 0xff8800ff, PURPLE = 0xaa44ff;

  // Header
  ctx.fillRect(0, 0, WIDTH, 50, 0x161b22ff);
  ctx.drawText(16, 10, 'WORLD NEWS — 18 NOV 2026', WHITE, 16, false);
  ctx.drawLine(16, 36, WIDTH - 16, 36, 0x30363dff);
  ctx.drawText(WIDTH - 100, 10, '18 NOV 2026', GRAY, 10, false);

  // 2x3 grid of stories
  const panelW = 152, panelH = 130, gapX = 16, gapY = 12;
  const startX = 16, startY = 56;

  const stories = [
    { t: 'CLIMATE', s: 'COP32 Baku', i: ['1.5°C pledge renewed', '$300B loss-damage', 'Fossil phase-out 2040'], c: GREEN },
    { t: 'TECH', s: 'EU AI Act enforced', i: ['First fines issued', 'GenAI transparency', 'Global standard'], c: BLUE },
    { t: 'MIDEAST', s: 'Gaza ceasefire day 14', i: ['Hostage releases', 'Aid 400+/day', 'Reconstruction'], c: ORANGE },
    { t: 'ECONOMY', s: 'Fed holds 4.25%', i: ['Inflation 2.3% YoY', 'Soft landing', 'Markets +2.1%'], c: YELLOW },
    { t: 'SPACE', s: 'Artemis IV launches', i: ['Lunar Gateway', 'First ESA astronaut', 'Sustained presence'], c: PURPLE },
    { t: 'HEALTH', s: 'mRNA malaria vaccine', i: ['Phase 3: 78% eff.', 'Rollout 2027', 'Africa trials'], c: RED },
  ];

  for (let idx = 0; idx < 6; idx++) {
    const col = idx % 3, row = Math.floor(idx / 3);
    const x = startX + col * (panelW + gapX);
    const y = startY + row * (panelH + gapY);
    const s = stories[idx];

    ctx.fillRect(x, y, panelW, panelH, 0x161b22ff);
    ctx.drawRect(x, y, panelW, panelH, 0x30363dff);
    ctx.fillRect(x, y, 3, panelH, s.c);

    ctx.drawText(x + 8, y + 8, s.t, WHITE, 12, false);
    ctx.drawText(x + 8, y + 24, s.s, GRAY, 8, false);
    for (let j = 0; j < s.i.length; j++) ctx.drawText(x + 8, y + 44 + j * 16, '• ' + s.i[j], GRAY, 8, false);

    // Icon
    const ix = x + panelW - 20, iy = y + 24, c = s.c;
    if (s.t === 'CLIMATE') { for (let dy = -8; dy <= 8; dy++) { const w = Math.floor(5 * Math.sqrt(1 - dy * dy / 64)); for (let dx = -w; dx <= w; dx++) ctx.setPixel(ix + dx, iy + dy, c); } }
    else if (s.t === 'TECH') { ctx.drawRect(ix - 6, iy - 6, 12, 12, c); ctx.fillRect(ix - 3, iy - 3, 6, 6, 0x0d1117ff); }
    else if (s.t === 'MIDEAST') { ctx.drawLine(ix - 8, iy, ix, iy - 5, c); ctx.drawLine(ix, iy - 5, ix + 8, iy, c); ctx.drawLine(ix - 4, iy, ix, iy + 4, c); }
    else if (s.t === 'ECONOMY') { ctx.drawLine(ix - 5, iy + 5, ix - 5, iy - 5, c); ctx.drawLine(ix - 5, iy + 5, ix + 5, iy + 5, c); ctx.drawLine(ix - 2, iy + 5, ix - 2, iy, c); ctx.drawLine(ix + 2, iy + 5, ix + 2, iy - 2, c); }
    else if (s.t === 'SPACE') { ctx.drawRect(ix - 2, iy - 8, 4, 12, c); ctx.drawLine(ix - 5, iy + 1, ix, iy + 4, c); ctx.drawLine(ix + 5, iy + 1, ix, iy + 4, c); ctx.drawLine(ix, iy - 8, ix, iy - 11, ORANGE); }
    else if (s.t === 'HEALTH') { ctx.drawRect(ix - 2, iy - 10, 4, 16, c); ctx.fillRect(ix - 1, iy - 8, 2, 6, 0x0d1117ff); ctx.drawLine(ix, iy - 10, ix, iy - 13, c); ctx.drawLine(ix - 2, iy - 11, ix + 2, iy - 11, c); }
  }

  // Footer
  const fy = HEIGHT - 24;
  ctx.drawLine(16, fy - 6, WIDTH - 16, fy - 6, 0x30363dff);
  ctx.drawText(16, fy, 'make.fun daily news • Deterministic • @budybozz', GRAY, 7, false);
  ctx.drawText(WIDTH - 16, fy, '18 NOV 2026', GRAY, 7, true);

  return ctx.pixels;
}

function main() {
  const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
  mkdirSync(outputDir, { recursive: true });
  const pixels = generateNewsImage();
  const png = encodePNG(WIDTH, HEIGHT, pixels);
  const outPath = join(outputDir, 'entry.png');
  writeFileSync(outPath, png);
  const stats = require('node:fs').statSync(outPath);
  console.log(`Written ${outPath}: ${stats.size} bytes (${(stats.size / 1024).toFixed(1)} KiB)`);
  console.log(`Dimensions: ${WIDTH}x${HEIGHT}`);
  if (stats.size > 1048576) console.warn('WARNING: exceeds 1 MiB limit');
  if (WIDTH > 1024 || HEIGHT > 1024) console.warn('WARNING: exceeds 1024x1024 limit');
  if (process.env.MAKEFUN_VERIFY === '1') {
    const png2 = encodePNG(WIDTH, HEIGHT, generateNewsImage());
    console.log('Deterministic:', Buffer.from(png).equals(Buffer.from(png2)) ? 'YES' : 'NO');
  }
}

main();