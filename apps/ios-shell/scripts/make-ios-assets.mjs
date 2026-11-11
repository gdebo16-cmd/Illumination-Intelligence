// Makes the iOS app icon and launch screen from the suite's Lumen home-screen icon.
//   node scripts/make-ios-assets.mjs   (run from apps/ios-shell, after `npx cap add ios`)
// Uses sharp from ../suite so this folder needs no image library of its own.
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const shell = path.resolve(here, '..');
const suite = path.resolve(shell, '../suite');
const sharp = createRequire(path.join(suite, 'package.json'))('sharp');

const SOURCE = path.join(suite, 'public/icons/lumen-512.png');
const BG = { r: 3, g: 4, b: 6 }; // #030406, the page's edge colour
const assets = path.join(shell, 'ios/App/App/Assets.xcassets');
if (!fs.existsSync(assets)) throw new Error('Run `npx cap add ios` first.');

// App Store icons must be 1024x1024 with no transparency.
const iconDir = path.join(assets, 'AppIcon.appiconset');
const iconFile = fs.readdirSync(iconDir).find((f) => f.endsWith('.png'));
await sharp(SOURCE).resize(1024, 1024, { kernel: 'lanczos3' }).flatten({ background: BG })
  .removeAlpha().png().toFile(path.join(iconDir, iconFile));
console.log(`icon -> AppIcon.appiconset/${iconFile}`);

// Launch screen: plain dark square (replaces Capacitor's default splash art).
const splashDir = path.join(assets, 'Splash.imageset');
if (fs.existsSync(splashDir)) {
  for (const f of fs.readdirSync(splashDir).filter((f) => f.endsWith('.png'))) {
    const { width, height } = await sharp(path.join(splashDir, f)).metadata();
    const buf = await sharp({ create: { width, height, channels: 3, background: BG } }).png().toBuffer();
    fs.writeFileSync(path.join(splashDir, f), buf);
    console.log(`splash -> Splash.imageset/${f} (${width}x${height})`);
  }
}
