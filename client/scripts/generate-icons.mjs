// regenerates the PWA icons in public/ from icon.svg — run via `npm run icons -w client`
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const root = fileURLToPath(new URL('..', import.meta.url));
const svg = await readFile(new URL('../icon.svg', import.meta.url));

const targets = [
  { size: 192, file: 'public/icon-192.png' },
  { size: 512, file: 'public/icon-512.png' },
  { size: 180, file: 'public/apple-touch-icon.png' },
];

for (const { size, file } of targets) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(root + file);
  console.log(`${file} (${size}x${size})`);
}
