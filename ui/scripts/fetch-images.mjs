// Downloads the game images the web build serves itself (see src/imageBase.ts) into images/,
// keeping files already there and removing those no longer used. Reads the exported game data,
// so run `npm run gamedata` first.
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAMED_ICONS, classIconName, iconPath, mapPath, portraitPath } from '../src/imagePaths.ts';

const ui = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ui, 'images');
const SOURCE = 'https://wow.zamimg.com/images/wow/';
const CONCURRENCY = 16;
const ATTEMPTS = 4;
const TIMEOUT_MS = 30_000;

const readJson = async (path) => JSON.parse(await readFile(join(ui, path), 'utf8'));
const [spellIcons, portraits, mapArt, classesSpecs] = await Promise.all([
  readJson('public/game-data/spell-icons.json'),
  readJson('public/game-data/boss-portraits.json'),
  readJson('public/game-data/map-art.json'),
  readJson('../crates/openlogs-gamedata/data/classes_specs.json'),
]);

const iconNames = [
  ...spellIcons.names,
  ...classesSpecs.classes.map((c) => classIconName(c.token)),
  ...classesSpecs.specs.map((s) => s.icon),
  ...NAMED_ICONS,
];
const files = [
  ...new Set([
    ...iconNames.map(iconPath),
    ...Object.values(portraits).map(portraitPath),
    ...Object.values(mapArt.maps)
      .filter((map) => map.raid)
      .map(mapPath),
  ]),
];

const exists = (path) => stat(path).then((s) => s.size > 0, () => false);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** `missing` when the CDN has no such image; the app shows the name's initials instead. */
async function download(file) {
  const target = join(OUT, file);
  if (await exists(target)) return 'kept';
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(new URL(file, SOURCE), { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (response.status === 404) return 'missing';
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = Buffer.from(await response.arrayBuffer());
      await mkdir(dirname(target), { recursive: true });
      await writeFile(`${target}.part`, body);
      await rename(`${target}.part`, target);
      return 'fetched';
    } catch (error) {
      if (attempt === ATTEMPTS) throw new Error(`${file}: ${error.message}`);
      await sleep(1000 * 2 ** attempt);
    }
  }
}

async function removeUnused() {
  const used = new Set(files);
  const entries = await readdir(OUT, { recursive: true, withFileTypes: true }).catch(() => []);
  const unused = entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((path) => !used.has(relative(OUT, path).split(sep).join('/')));
  await Promise.all(unused.map((path) => rm(path)));
  return unused.length;
}

const counts = { kept: 0, fetched: 0, missing: 0 };
const failures = [];
let next = 0;
async function worker() {
  while (next < files.length) {
    const file = files[next++];
    try {
      counts[await download(file)]++;
    } catch (error) {
      failures.push(error.message);
    }
    const done = counts.kept + counts.fetched + counts.missing + failures.length;
    if (done % 1000 === 0) console.log(`${done} / ${files.length}`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));
const removed = await removeUnused();

console.log(`${files.length} images: ${counts.fetched} fetched, ${counts.kept} already there, ${counts.missing} not on the CDN, ${removed} unused removed`);
if (failures.length > 0) {
  console.error(`${failures.length} images could not be fetched:\n${failures.slice(0, 20).join('\n')}`);
  process.exit(1);
}
