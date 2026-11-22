// Example pictures of the toolbox tiles: draws every picture from scripts/app-art/*.ts (most of them from the
// real geometry of the generators) and writes src/appArt.json (tile id → SVG elements for a 120 × 104 field).
// With --sheet FILE.html also an overview of all pictures at tile size, light and dark, for checking.
// Call: npm run build:app-art [-- --sheet /tmp/art.html] [-- --only gear,box]
import './core-fixtures-env';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
await import('./builtin-generators');
const { ART } = await import('./app-art/tiles');
const { FW, FH } = await import('./app-art/kit');
const { appList } = await import('../src/apps');

const args = process.argv.slice(2);
const sheetAt = args.indexOf('--sheet');
const onlyAt = args.indexOf('--only');
const only = onlyAt >= 0 ? args[onlyAt + 1].split(',') : null;

const tiles = appList();
const groupOf = new Map(tiles.map((a) => [a.id, a.group as string]));
groupOf.set('packs', 'pack');
const out: Record<string, string> = {};
let problems = 0;
const cards: string[] = [];
for (const [id, draw] of Object.entries(ART)) {
  if (only && !only.includes(id)) continue;
  if (!groupOf.has(id)) {
    console.log(`UNKNOWN ${id}: no toolbox tile with this id`);
    problems++;
    continue;
  }
  let body: string;
  try {
    body = draw();
  } catch (e) {
    console.log(`ERROR ${id}: ${(e as Error).stack}`);
    problems++;
    continue;
  }
  if (!body || /NaN|Infinity|undefined/.test(body)) {
    console.log(`BROKEN ${id}`);
    problems++;
    continue;
  }
  out[id] = body;
  const svg = `<svg class="art" viewBox="0 0 ${FW} ${FH}">${body}</svg>`;
  cards.push(`<figure><div class="app-art" data-g="${groupOf.get(id)}">${svg}</div><div class="app-art big" data-g="${groupOf.get(id)}">${svg}</div><figcaption>${id} · ${(body.length / 1024).toFixed(1)} KB</figcaption></figure>`);
}
for (const a of tiles) if (!only && !ART[a.id]) {
  console.log(`MISSING ${a.id}: tile without a picture`);
  problems++;
}

// Pictures of the options inside dialogs (scripts/app-art/options.ts → src/optionArt.json, "<group>:<value>" → SVG
// elements for a field of OW × OH units)
const { OPTION_ART, OW, OH } = await import('./app-art/options');
const optOut: Record<string, string> = {};
const optCards: string[] = [];
if (!only)
  for (const [key, draw] of Object.entries(OPTION_ART)) {
    let body: string;
    try {
      body = draw();
    } catch (e) {
      console.log(`ERROR ${key}: ${(e as Error).stack}`);
      problems++;
      continue;
    }
    if (!body || /NaN|Infinity|undefined/.test(body)) {
      console.log(`BROKEN ${key}`);
      problems++;
      continue;
    }
    optOut[key] = body;
    const svg = `<svg class="art" viewBox="0 0 ${OW} ${OH}">${body}</svg>`;
    optCards.push(`<figure><div class="opt-art">${svg}</div><figcaption>${key} · ${(body.length / 1024).toFixed(1)} KB</figcaption></figure>`);
  }

if (!only) {
  const file = resolve('src/appArt.json');
  const json = JSON.stringify(out);
  writeFileSync(file, json + '\n');
  console.log(`${Object.keys(out).length} pictures, ${(json.length / 1024).toFixed(0)} KB → ${file}`);
  const optFile = resolve('src/optionArt.json');
  const optJson = JSON.stringify(optOut);
  writeFileSync(optFile, optJson + '\n');
  console.log(`${Object.keys(optOut).length} option pictures, ${(optJson.length / 1024).toFixed(0)} KB → ${optFile}`);
}
if (sheetAt >= 0) {
  // The colours of the pictures and of the tiles come from the app's own style sheet
  const css = readFileSync(resolve('src/style.css'), 'utf8');
  const pick = (from: string, to: string) => css.slice(css.indexOf(from), css.indexOf(to));
  const artCss = pick('/* Werkzeugkasten: Beispielbilder', '/* Ende Beispielbilder */');
  const groupCss = pick('/* Werkzeugkasten */', '.win-apps {');
  const page = (theme: string) =>
    `<section data-theme="${theme}" class="${theme}"><h2>${theme}</h2><div class="grid">${cards.join('')}</div>${optCards.length ? `<h2 style="margin-top:14px">${theme}: options in dialogs</h2><div class="grid">${optCards.join('')}</div>` : ''}</section>`;
  writeFileSync(
    args[sheetAt + 1],
    `<!doctype html><meta charset="utf-8"><style>
:root{--accent:#2f6fe8;--surface-2:#f0f1f3;--icon:#2b3038}
${groupCss.replace(/:root\[data-theme='dark'\]/g, 'section.dark').replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, '')}
${artCss.replace(/:root\[data-theme='dark'\]/g, 'section.dark').replace(/@media \(prefers-color-scheme: dark\) \{[\s\S]*?\n\}\n/, '')}
body{font:11px system-ui,sans-serif;margin:0}
section{padding:10px 14px 18px}section.light{background:#f4f5f7;color:#1f2328}
section.dark{background:#24282e;color:#e3e6ea;--accent:#5b93f5;--surface-2:#262a30;--icon:#d4d8de}
h2{margin:0 0 8px;font-size:12px}
.grid{display:grid;grid-template-columns:repeat(8,1fr);gap:12px 10px}
figure{margin:0;text-align:center}figcaption{margin-top:3px;white-space:nowrap;overflow:hidden}
.app-art{width:78px;aspect-ratio:1.15;border-radius:8px;display:grid;place-items:center;background:var(--app-bg,var(--surface-2));margin:0 auto 5px;overflow:hidden}
.app-art.big{width:172px}.app-art .art{display:block;width:100%;height:100%}
</style>${page('light')}${page('dark')}`,
  );
  console.log(`Overview: ${args[sheetAt + 1]}`);
}
if (problems) process.exitCode = 1;
