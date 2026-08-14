// Generate icon PNG + ICO from SVG using sharp
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const electronDir = path.resolve(__dirname, '..', 'electron');
const svgPath = path.join(electronDir, 'icon.svg');
const pngPath = path.join(electronDir, 'icon.png');
const icoPath = path.join(electronDir, 'icon.ico');

// Simple ICO writer — embeds PNG data (works on Windows Vista+)
function writeICO(pngBuffers) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);   // reserved
  header.writeUInt16LE(1, 2);   // ICO type
  header.writeUInt16LE(pngBuffers.length, 4); // image count

  let dirEntries = Buffer.alloc(0);
  let imageData = Buffer.alloc(0);
  let offset = 6 + 16 * pngBuffers.length;

  for (const png of pngBuffers) {
    const len = png.length;
    const entry = Buffer.alloc(16);
    entry.writeUInt8(png === pngBuffers[0] ? Math.min(pngBuffers.length * 32, 256) : 0, 0); // width
    entry.writeUInt8(png === pngBuffers[0] ? Math.min(pngBuffers.length * 32, 256) : 0, 1); // height
    entry.writeUInt8(0, 2);  // palette
    entry.writeUInt8(0, 3);  // reserved
    entry.writeUInt16LE(1, 4);  // color planes
    entry.writeUInt16LE(32, 6); // bpp
    entry.writeUInt32LE(len, 8);  // size
    entry.writeUInt32LE(offset, 12); // offset
    dirEntries = Buffer.concat([dirEntries, entry]);
    imageData = Buffer.concat([imageData, png]);
    offset += len;
  }
  return Buffer.concat([header, dirEntries, imageData]);
}

async function main() {
  const svg = fs.readFileSync(svgPath);

  // Generate 256x256 PNG (main app icon)
  await sharp(svg).resize(256, 256).png().toFile(pngPath);
  console.log('  ✅ icon.png (256x256)');

  // Generate multiple sizes for ICO
  const sizes = [16, 32, 48, 256];
  const pngs = [];
  for (const size of sizes) {
    pngs.push(await sharp(svg).resize(size, size).png().toBuffer());
  }

  // Write ICO
  fs.writeFileSync(icoPath, writeICO(pngs));
  console.log('  ✅ icon.ico (16+32+48+256)');

  console.log('  ✅ Generated icons');
}

main().catch(e => { console.error('Icon generation failed:', e.message); process.exit(1); });
