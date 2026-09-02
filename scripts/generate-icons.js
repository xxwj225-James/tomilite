/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
// Generate icon PNG + ICO from the brand logo.
//
// Source precedence:
//   1. electron/icon-source.jpg  (raster brand logo — non-square, composited onto a
//      square brand-colored canvas so it can't be distorted)
//   2. electron/icon-source.png  (square transparent raster logo, used as-is)
//   3. electron/icon.svg         (legacy vector icon)
//
// The square canvas background defaults to the average of the logo's four corner
// pixels (so a logo with its own background blends seamlessly); override with
// ICON_BG, e.g. ICON_BG=#ffffff node scripts/generate-icons.js
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const electronDir = path.resolve(__dirname, '..', 'electron');
const jpgPath = path.join(electronDir, 'icon-source.jpg');
const pngPath = path.join(electronDir, 'icon-source.png');
const svgPath = path.join(electronDir, 'icon.svg');
const outPng = path.join(electronDir, 'icon.png');
const outIco = path.join(electronDir, 'icon.ico');
const outPreview = path.join(electronDir, 'icon-preview.png');

// Simple ICO writer — embeds PNG data (works on Windows Vista+)
function writeICO(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // ICO type
  header.writeUInt16LE(pngBuffers.length, 4); // image count

  let dirEntries = Buffer.alloc(0);
  let imageData = Buffer.alloc(0);
  let offset = 6 + 16 * pngBuffers.length;

  for (const png of pngBuffers) {
    const len = png.length;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(png === pngBuffers[0] ? Math.min(pngBuffers.length * 32, 256) : 0, 0); // width
    entry.writeUInt8(png === pngBuffers[0] ? Math.min(pngBuffers.length * 32, 256) : 0, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(len, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries = Buffer.concat([dirEntries, entry]);
    imageData = Buffer.concat([imageData, png]);
    offset += len;
  }
  return Buffer.concat([header, dirEntries, imageData]);
}

// Average hex color of a 3×3 pixel patch — used to infer the logo background
async function patchAvg(buf, left, top) {
  const { data } = await sharp(buf)
    .extract({ left, top, width: 3, height: 3 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const ch = data.length / 9;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < 9; i++) {
    r += data[i * ch];
    g += data[i * ch + 1];
    b += data[i * ch + 2];
  }
  return [Math.round(r / 9), Math.round(g / 9), Math.round(b / 9)];
}

function toHex(rgb) {
  return (
    '#' + [rgb[0], rgb[1], rgb[2]].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')
  );
}

function parseHex(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

async function main() {
  // ── pick source ──
  let srcBuf;
  let srcKind = 'svg'; // jpg | png | svg
  if (fs.existsSync(jpgPath)) {
    srcBuf = fs.readFileSync(jpgPath);
    srcKind = 'jpg';
  } else if (fs.existsSync(pngPath)) {
    srcBuf = fs.readFileSync(pngPath);
    srcKind = 'png';
  } else {
    srcBuf = fs.readFileSync(svgPath);
  }

  const meta = await sharp(srcBuf).metadata();
  const square = meta.width === meta.height;

  const CANVAS = 1024;
  let master; // square RGBA PNG buffer of the finished icon

  if (srcKind !== 'svg' && !square) {
    // Raster + non-square → composite centered on a square brand-colored canvas
    let bgRgb = [99, 102, 241]; // indigo fallback
    if (process.env.ICON_BG) {
      const parsed = parseHex(process.env.ICON_BG);
      if (parsed) bgRgb = [parsed.r, parsed.g, parsed.b];
    } else {
      // Sample the four corners — for a logo that carries its own background this
      // makes the icon look seamless instead of floating on a foreign color.
      const w = meta.width;
      const h = meta.height;
      const corners = await Promise.all([
        patchAvg(srcBuf, 0, 0),
        patchAvg(srcBuf, w - 3, 0),
        patchAvg(srcBuf, 0, h - 3),
        patchAvg(srcBuf, w - 3, h - 3),
      ]);
      bgRgb = [
        Math.round(corners.reduce((s, c) => s + c[0], 0) / 4),
        Math.round(corners.reduce((s, c) => s + c[1], 0) / 4),
        Math.round(corners.reduce((s, c) => s + c[2], 0) / 4),
      ];
    }
    console.log(`  ℹ logo ${meta.width}x${meta.height} — canvas bg #${toHex(bgRgb).slice(1)} (ICON_BG overrides)`);

    const base = await sharp({
      create: {
        width: CANVAS,
        height: CANVAS,
        channels: 4,
        background: { r: bgRgb[0], g: bgRgb[1], b: bgRgb[2], alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    // Contain-fit keeps aspect ratio and letterboxes transparently
    const logo = await sharp(srcBuf).resize(CANVAS, CANVAS, { fit: 'contain' }).png().toBuffer();
    master = await sharp(base)
      .composite([{ input: logo }])
      .png()
      .toBuffer();
  } else {
    // Square source (or legacy SVG) — just resize
    master = await sharp(srcBuf).resize(CANVAS, CANVAS, { fit: 'contain' }).png().toBuffer();
  }

  // Generate 256x256 PNG (main app icon) + a big preview for eyeballing
  await sharp(master).resize(256, 256).png().toFile(outPng);
  console.log('  ✅ icon.png (256x256)');
  await sharp(master).resize(512, 512).png().toFile(outPreview);
  console.log('  ✅ icon-preview.png (512x512)');

  // Generate multiple sizes for ICO
  const sizes = [16, 32, 48, 256];
  const pngs = [];
  for (const size of sizes) {
    pngs.push(await sharp(master).resize(size, size).png().toBuffer());
  }

  // Write ICO
  fs.writeFileSync(outIco, writeICO(pngs));
  console.log('  ✅ icon.ico (16+32+48+256)');

  console.log('  ✅ Generated icons');
}

main().catch((e) => {
  console.error('Icon generation failed:', e.message);
  process.exit(1);
});
