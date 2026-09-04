/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS script */
// Generate icon PNG + ICO from the brand logo.
//
// Source precedence:
//   1. electron/icon-source.jpg  (raster brand logo on an opaque background —
//      its background is removed via border-connected flood fill, then trimmed
//      and centered on a square TRANSPARENT canvas → no painted background)
//   2. electron/icon-source.png  (square transparent raster logo, used as-is)
//   3. electron/icon.svg         (legacy vector icon)
//
// icon-preview.png is composited over a checkerboard so transparency is visible.
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

// Cut the opaque brand background out of a raster: flood-fill from the borders
// over pixels close to the inferred bg color, so only border-connected bg is
// removed and dark interior logo detail survives. Returns { data, w, h } RGBA.
function removeBackground(data, w, h) {
  // Infer bg from the outer ring (the source is a centered logo on a plain canvas)
  const ring = 12;
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ring && y >= ring && x < w - ring && y < h - ring) continue;
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  const bg = [r / n, g / n, b / n];
  const cutT = 44; // squared-threshold cutoff for "background-ish"
  const cutT2 = cutT * cutT;
  const nPix = w * h;

  // Denoised color copy (3x3 box). JPEG ringing/noise at the logo edges makes a
  // hard threshold flip per-pixel, so the cut contour comes out notched ("毛刺").
  // Classifying against the smoothed colors cuts one clean edge instead.
  const dn = Buffer.alloc(nPix * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let c = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = (ny * w + nx) * 4;
          sr += data[j];
          sg += data[j + 1];
          sb += data[j + 2];
          c++;
        }
      }
      dn[i] = sr / c;
      dn[i + 1] = sg / c;
      dn[i + 2] = sb / c;
      dn[i + 3] = 255;
    }
  }

  const isCand = (i) => {
    const p = i * 4;
    const dr = dn[p] - bg[0];
    const dg = dn[p + 1] - bg[1];
    const db = dn[p + 2] - bg[2];
    return dr * dr + dg * dg + db * db <= cutT2;
  };

  // Pass 1: clear background connected to the border
  const cut = new Uint8Array(nPix);
  const q = new Int32Array(nPix);
  let head = 0;
  let tail = 0;
  const seed = (i) => {
    if (!cut[i] && isCand(i)) {
      cut[i] = 1;
      q[tail++] = i;
    }
  };
  for (let x = 0; x < w; x++) {
    seed(x);
    seed((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    seed(y * w);
    seed(y * w + w - 1);
  }
  while (head < tail) {
    const i = q[head++];
    const x = i % w;
    const nb = [i - 1, i + 1, i - w, i + w];
    for (const j of nb) {
      if (j < 0 || j >= nPix) continue;
      if (Math.abs((j % w) - x) > 1) continue; // skip horizontal wrap
      if (!cut[j] && isCand(j)) {
        cut[j] = 1;
        q[tail++] = j;
      }
    }
  }

  // Pass 2: clear enclosed bg-colored regions — holes, letter counters and
  // JPEG specks of ANY size. An interior area matching the background color is
  // negative space the artwork punches through (e.g. a hollow donut center), so
  // it must become transparent; real drawn strokes never match bg within the
  // threshold, so they survive even when nested inside such a hole.
  const visited = new Uint8Array(nPix); // avoids re-flooding cleared regions
  for (let s = 0; s < nPix; s++) {
    if (cut[s] || visited[s] || !isCand(s)) continue;
    head = 0;
    tail = 0;
    visited[s] = 1;
    cut[s] = 2;
    q[tail++] = s;
    while (head < tail) {
      const i = q[head++];
      const x = i % w;
      const nb = [i - 1, i + 1, i - w, i + w];
      for (const j of nb) {
        if (j < 0 || j >= nPix) continue;
        if (Math.abs((j % w) - x) > 1) continue;
        if (!cut[j] && visited[j] === 0 && isCand(j)) {
          visited[j] = 1;
          cut[j] = 2;
          q[tail++] = j;
        }
      }
    }
    for (let k = 0; k < tail; k++) cut[q[k]] = 3; // 3 = cleared → transparent
  }

  // Apply alpha: cleared → 0, kept → 255 with a feathered boundary
  const featherLo = cutT;
  const featherHi = cutT + 26;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = i * 4;
      if (cut[i] === 1 || cut[i] === 3) {
        data[p + 3] = 0;
        continue;
      }
      data[p + 3] = 255;
      // Feather: soften pixels touching a cleared one by their distance from bg
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const c = cut[ny * w + nx];
          if (c === 1 || c === 3) {
            near = true;
            break;
          }
        }
      }
      if (near) {
        const dr = dn[p] - bg[0];
        const dg = dn[p + 1] - bg[1];
        const db = dn[p + 2] - bg[2];
        const d = Math.sqrt(dr * dr + dg * dg + db * db);
        if (d < featherHi) {
          const t = Math.max(0, (d - featherLo) / (featherHi - featherLo));
          data[p + 3] = Math.round(255 * t * t * (3 - 2 * t));
        }
      }
    }
  }

  // Smooth the alpha mask (3x3 gaussian) to round any residual 1px burrs left
  // by the threshold cut, then drop faint isolated residue (JPEG fringe).
  const cur = Buffer.from(data); // read source alpha from an untouched copy
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * 4;
      const a00 = cur[((y - 1) * w + (x - 1)) * 4 + 3];
      const a01 = cur[((y - 1) * w + x) * 4 + 3];
      const a02 = cur[((y - 1) * w + (x + 1)) * 4 + 3];
      const a10 = cur[(y * w + (x - 1)) * 4 + 3];
      const a11 = cur[i + 3];
      const a12 = cur[(y * w + (x + 1)) * 4 + 3];
      const a20 = cur[((y + 1) * w + (x - 1)) * 4 + 3];
      const a21 = cur[((y + 1) * w + x) * 4 + 3];
      const a22 = cur[((y + 1) * w + (x + 1)) * 4 + 3];
      const sm = (a00 + 2 * a01 + a02 + 2 * a10 + 4 * a11 + 2 * a12 + a20 + 2 * a21 + a22) / 16;
      data[i + 3] = sm < 32 ? 0 : Math.round(sm);
    }
  }
  return { data, w, h, bg };
}

// Checkerboard PNG so transparency is easy to eyeball in the preview
async function checkerboard(size) {
  const cell = size / 16;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const light = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      const v = light ? 232 : 255;
      const p = (y * size + x) * 4;
      buf[p] = v;
      buf[p + 1] = v;
      buf[p + 2] = v;
      buf[p + 3] = 255;
    }
  }
  return sharp(buf, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
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

  let master; // square RGBA PNG buffer of the finished icon

  if (srcKind !== 'svg' && !square) {
    // Raster, non-square → background-remove, trim, center on transparent square
    const { data, info } = await sharp(srcBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;

    let rgba;
    if (meta.hasAlpha) {
      rgba = { data: Buffer.from(data), w, h }; // already transparent source
      console.log(`  ℹ logo ${w}x${h} — has alpha, used as-is`);
    } else {
      const r = removeBackground(Buffer.from(data), w, h);
      rgba = r;
      console.log(`  ℹ logo ${w}x${h} — removed bg ~rgb(${r.bg.map(Math.round).join(',')}) → transparent`);
    }
    // Trim to the opaque content, then square it up on a transparent canvas
    const d = rgba.data;
    const aT = 10;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (d[(y * w + x) * 4 + 3] >= aT) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX) {
      console.error('No content left after background removal');
      process.exit(1);
    }
    const cw = maxX - minX + 1;
    const ch = maxY - minY + 1;
    const pad = Math.round(Math.max(cw, ch) * 0.06);
    const side = Math.max(cw, ch) + pad * 2;
    const cropLeft = Math.max(0, minX - pad);
    const cropTop = Math.max(0, minY - pad);
    const cropW = Math.min(cw + pad * 2, w - cropLeft);
    const cropH = Math.min(ch + pad * 2, h - cropTop);

    const base = await sharp({
      create: {
        width: side,
        height: side,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();
    const clipped = await sharp(d, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: cropLeft, top: cropTop, width: cropW, height: cropH })
      .png()
      .toBuffer();
    master = await sharp(base)
      .composite([
        {
          input: clipped,
          left: Math.round((side - cropW) / 2),
          top: Math.round((side - cropH) / 2),
        },
      ])
      .png()
      .toBuffer();
    console.log(`  ℹ content ${cw}x${ch} → transparent ${side}x${side} master`);
  } else {
    // Square source (or legacy SVG) — just resize
    master = await sharp(srcBuf).resize(1024, 1024, { fit: 'contain' }).png().toBuffer();
  }

  // 256x256 PNG (main app icon)
  await sharp(master).resize(256, 256).png().toFile(outPng);
  console.log('  ✅ icon.png (256x256, transparent)');

  // 512x512 preview over a checkerboard so transparency is visible
  const previewLogo = await sharp(master).resize(512, 512).png().toBuffer();
  const cb = await checkerboard(512);
  await sharp(cb)
    .composite([{ input: previewLogo }])
    .png()
    .toFile(outPreview);
  console.log('  ✅ icon-preview.png (512x512 over checkerboard)');

  // Multiple sizes for ICO
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
