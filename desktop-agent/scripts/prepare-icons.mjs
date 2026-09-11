import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import sharp from 'sharp';

const require = createRequire(import.meta.url);
const toIco = require('to-ico');

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceLogo = path.join(root, 'src', 'assets', 'vodafone-logo.png');
const buildDir = path.join(root, 'build');
const iconPng = path.join(buildDir, 'icon.png');
const iconIco = path.join(buildDir, 'icon.ico');
const publicLogo = path.join(root, 'public', 'vodafone-logo.png');

if (!fs.existsSync(sourceLogo)) {
  console.error(`Logo bulunamadı: ${sourceLogo}`);
  process.exit(1);
}

fs.mkdirSync(buildDir, { recursive: true });
fs.mkdirSync(path.dirname(publicLogo), { recursive: true });
fs.copyFileSync(sourceLogo, publicLogo);

// Explorer / görev çubuğu için net çoklu boyut PNG + ICO
const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngBuffers = await Promise.all(
  sizes.map((size) =>
    sharp(sourceLogo)
      .resize(size, size, {
        fit: 'contain',
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .png()
      .toBuffer(),
  ),
);

await sharp(sourceLogo)
  .resize(512, 512, {
    fit: 'contain',
    background: { r: 0, g: 0, b: 0, alpha: 1 },
  })
  .png()
  .toFile(iconPng);

const icoBuffer = await toIco(pngBuffers);
fs.writeFileSync(iconIco, icoBuffer);

console.log(`Uygulama ikonları hazır: build/icon.png (${sizes.join(',')}px ICO)`);
