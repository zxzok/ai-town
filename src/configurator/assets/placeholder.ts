import { deflateSync } from 'zlib';

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
}

const CRC_TABLE = crcTable();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function writeChunk(type: string, data: Uint8Array): Buffer {
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  Buffer.from(data).copy(chunk, 8);
  const crcInput = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
  chunk.writeUInt32BE(crc32(crcInput), chunk.length - 4);
  return chunk;
}

function packColor(r: number, g: number, b: number, a = 255): [number, number, number, number] {
  return [Math.round(r), Math.round(g), Math.round(b), Math.round(a)];
}

function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function colorFromHash(hash: number): { r: number; g: number; b: number } {
  const r = (hash & 0xff0000) >>> 16;
  const g = (hash & 0x00ff00) >>> 8;
  const b = hash & 0x0000ff;
  return { r, g, b };
}

function adjust(color: { r: number; g: number; b: number }, factor: number): { r: number; g: number; b: number } {
  return {
    r: Math.max(0, Math.min(255, color.r * factor)),
    g: Math.max(0, Math.min(255, color.g * factor)),
    b: Math.max(0, Math.min(255, color.b * factor)),
  };
}

function createPng(width: number, height: number, rgba: Uint8Array): string {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.writeUInt8(8, 8); // bit depth
  ihdr.writeUInt8(6, 9); // RGBA
  ihdr.writeUInt8(0, 10); // compression method
  ihdr.writeUInt8(0, 11); // filter method
  ihdr.writeUInt8(0, 12); // no interlace

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * stride] = 0; // no filter
    const start = y * width * 4;
    Buffer.from(rgba.subarray(start, start + width * 4)).copy(raw, y * stride + 1);
  }

  const idat = Buffer.from(deflateSync(raw));
  const png = Buffer.concat([
    signature,
    writeChunk('IHDR', ihdr),
    writeChunk('IDAT', idat),
    writeChunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}

function drawPlaceholderPixels(
  width: number,
  height: number,
  background: [number, number, number, number],
  border: [number, number, number, number],
  accent: [number, number, number, number],
): Uint8Array {
  const data = new Uint8Array(width * height * 4);
  const centerX = (width - 1) / 2;
  const centerY = (height - 1) / 2;
  const radius = Math.min(width, height) / 3;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const idx = (y * width + x) * 4;
      const isBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1;
      if (isBorder) {
        data.set(border, idx);
        continue;
      }
      const dx = x - centerX;
      const dy = y - centerY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance <= radius) {
        data.set(accent, idx);
      } else if (Math.abs(dx) <= 1 || Math.abs(dy) <= 1) {
        // cross hair accent
        data.set(accent, idx);
      } else {
        data.set(background, idx);
      }
    }
  }
  return data;
}

export function generatePlaceholderSprite(
  agentId: string,
  agentName: string,
  size = 24,
): { id: string; dataUrl: string; prompt: string } {
  const hash = hashString(agentId || agentName || 'agent');
  const baseColor = colorFromHash(hash);
  const accentColor = adjust(baseColor, 1.2);
  const borderColor = adjust(baseColor, 0.8);
  const background = packColor(baseColor.r, baseColor.g, baseColor.b);
  const border = packColor(borderColor.r, borderColor.g, borderColor.b);
  const accent = packColor(accentColor.r, accentColor.g, accentColor.b);

  const pixels = drawPlaceholderPixels(size, size, background, border, accent);
  const dataUrl = createPng(size, size, pixels);
  return {
    id: `${agentId}-placeholder`,
    dataUrl,
    prompt: `Placeholder sprite for ${agentName}`,
  };
}
