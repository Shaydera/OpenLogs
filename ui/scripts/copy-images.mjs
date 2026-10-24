// Copies the images from `npm run images` into the website build (see src/imageBase.ts) and makes
// sure the build loads none from the Wowhead CDN. `--check` only checks that the images are there.
import { cpSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../images', import.meta.url));
if (!existsSync(source)) {
  console.error('images/ is missing; run `npm run images` first');
  process.exit(1);
}
if (process.argv.includes('--check')) process.exit(0);

const assets = fileURLToPath(new URL('../dist/assets', import.meta.url));
const cdnUser = readdirSync(assets).find((file) => readFileSync(`${assets}/${file}`, 'utf8').includes('zamimg'));
if (cdnUser) {
  console.error(`dist/assets/${cdnUser} still loads images from the Wowhead CDN`);
  process.exit(1);
}
cpSync(source, fileURLToPath(new URL('../dist/images', import.meta.url)), { recursive: true, filter: (path) => !path.endsWith('.part') });
