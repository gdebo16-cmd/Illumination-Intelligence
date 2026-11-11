// Writes www/app-url.js so the offline page's "Try again" button knows where the app lives.
// Same rule as capacitor.config.ts: ILLUMINATION_APP_URL if set, else app-url.json "default".
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const urls = JSON.parse(fs.readFileSync(path.join(shell, 'app-url.json'), 'utf8'));
const url = (process.env.ILLUMINATION_APP_URL || urls.default).trim().replace(/\/+$/, '');
if (!/^https?:\/\/[^\s"'<>]+$/.test(url)) throw new Error(`Not a usable app URL: ${url}`);
fs.writeFileSync(path.join(shell, 'www/app-url.js'), `window.ILLUMINATION_APP_URL = ${JSON.stringify(url)};\n`);
console.log(`App URL: ${url}`);
