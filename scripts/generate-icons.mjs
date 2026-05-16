/**
 * Generate PWA icon PNGs from public/icon.svg.
 *
 * Outputs into public/:
 *   - icon-192.png        (Android Chrome manifest icon, "any")
 *   - icon-512.png        (Android Chrome manifest icon, "any" + splash)
 *   - icon-maskable-512.png (Android adaptive icon — full bleed with safe zone)
 *   - apple-touch-icon.png  (180x180, iOS home screen)
 *   - favicon-32.png        (browser tab)
 *
 * Run via: npm run icons
 *
 * Re-run after editing public/icon.svg.
 */

import sharp from "sharp";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");

const SOURCE = join(publicDir, "icon.svg");

const sizes = [
  { out: "icon-192.png", size: 192 },
  { out: "icon-512.png", size: 512 },
  { out: "icon-maskable-512.png", size: 512 }, // same render; safe zone is baked into the SVG
  { out: "apple-touch-icon.png", size: 180 },
  { out: "favicon-32.png", size: 32 },
];

async function main() {
  const svg = await readFile(SOURCE);
  for (const { out, size } of sizes) {
    const buf = await sharp(svg, { density: 384 })
      .resize(size, size)
      .png()
      .toBuffer();
    await writeFile(join(publicDir, out), buf);
    console.log(`✓ ${out} (${size}x${size})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
