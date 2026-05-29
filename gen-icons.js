// Generates minimal PNG icons for the PWA manifest using only Node built-ins
// PNG format: IHDR + IDAT (deflate) + IEND

const fs = require('fs');
const zlib = require('zlib');

function crc32(buf) {
  let crc = 0xffffffff;
  for (const b of buf) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, 'ascii');
  const crcVal = Buffer.alloc(4);
  crcVal.writeUInt32BE(crc32(Buffer.concat([typeB, data])));
  return Buffer.concat([len, typeB, data, crcVal]);
}

function makePNG(size) {
  // Draw white paddles + centre line on black background
  const pixels = Buffer.alloc(size * size * 4, 0); // RGBA black

  function setPixel(x, y, r, g, b) {
    if (x < 0 || x >= size || y < 0 || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b; pixels[i+3] = 255;
  }

  const pw = Math.max(2, Math.round(size * 0.04));
  const ph = Math.round(size * 0.3);
  const px = Math.round(size * 0.08);

  // Left paddle
  for (let y = (size - ph) >> 1; y < (size - ph) / 2 + ph; y++)
    for (let x = px; x < px + pw; x++) setPixel(x, y, 255, 255, 255);

  // Right paddle
  for (let y = (size - ph) >> 1; y < (size - ph) / 2 + ph; y++)
    for (let x = size - px - pw; x < size - px; x++) setPixel(x, y, 255, 255, 255);

  // Centre dashes
  const dashH = Math.round(size * 0.07);
  const dashGap = Math.round(size * 0.05);
  const cx = (size >> 1);
  for (let y = 0; y < size; y += dashH + dashGap)
    for (let dy = 0; dy < dashH && y + dy < size; dy++)
      setPixel(cx, y + dy, 255, 255, 255);

  // Ball
  const bs = Math.max(4, Math.round(size * 0.06));
  const bx = (size >> 1) - (bs >> 1);
  const by = (size >> 1) - (bs >> 1);
  for (let y = by; y < by + bs; y++)
    for (let x = bx; x < bx + bs; x++) setPixel(x, y, 255, 255, 255);

  // Build PNG raw rows (filter byte 0 = None per row)
  const rows = [];
  for (let y = 0; y < size; y++) {
    rows.push(Buffer.from([0])); // filter byte
    rows.push(pixels.slice(y * size * 4, (y + 1) * size * 4));
  }
  const raw = Buffer.concat(rows);
  const compressed = zlib.deflateSync(raw);

  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // colour type: RGB truecolour — wait we have RGBA, use 6
  ihdr[9] = 6;  // RGBA
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

fs.writeFileSync('/Users/I854427/Desktop/pong/icons/icon-192.png', makePNG(192));
fs.writeFileSync('/Users/I854427/Desktop/pong/icons/icon-512.png', makePNG(512));
console.log('Icons generated.');
