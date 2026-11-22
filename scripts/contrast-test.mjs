// Farbe wird gemessen, nicht geschätzt: Dieser Test liest src/style.css, holt die Token aus :root
// (hell) und aus :root[data-theme='dark'] und rechnet den Kontrast der Paare nach, auf die es ankommt
// (WCAG 2.2 AA: 4,5:1 für Text, 3:1 für Ränder und Bedienelemente). Er prüft außerdem, dass kein
// var(--x) benutzt wird, das es nirgends gibt. Aufruf: npm run test:contrast
import { readFileSync } from 'node:fs';

// Kommentare raus, bevor irgendetwas gelesen wird: In einem Kommentar steht „--surface: … 4,53:1“ und
// ein Parser, der das für eine Deklaration hält, verschluckt die nächste echte Zeile.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Token eines Blocks, der mit `kopf` beginnt */
function tokens(kopf) {
  const at = css.indexOf(kopf);
  if (at < 0) throw new Error(`Block nicht gefunden: ${kopf}`);
  const ende = css.indexOf('\n}', at);
  const block = css.slice(at, ende);
  const out = {};
  for (const m of block.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const hell = tokens(':root {');
const dunkel = tokens(":root[data-theme='dark'] {");
const dunkelAuto = tokens(":root:not([data-theme='light']) {");

const rgb = (hex) => {
  const v = hex.replace('#', '').trim();
  const teil = (i) => parseInt(v.length === 3 ? v[i] + v[i] : v.slice(2 * i, 2 * i + 2), 16);
  return [teil(0), teil(1), teil(2)];
};
const lum = (hex) => {
  const [r, g, b] = rgb(hex).map((c) => {
    const x = c / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const kontrast = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

let failed = 0;
const prüfe = (thema, vorne, hinten, soll, was) => {
  const v = kontrast(vorne, hinten);
  const ok = v >= soll - 0.005;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${thema.padEnd(7)} ${was.padEnd(46)} ${v.toFixed(2)}:1 (mind. ${soll})`);
};

/** Die Paare, die in der Oberfläche wirklich vorkommen */
function paare(thema, t) {
  const auf = (name) => t[name];
  // Text auf Fläche: 4,5:1
  for (const grund of ['--bg', '--panel', '--surface', '--surface-2', '--title', '--field'])
    prüfe(thema, auf('--text'), auf(grund), 4.5, `--text auf ${grund}`);
  for (const grund of ['--bg', '--panel', '--surface', '--surface-2', '--title'])
    prüfe(thema, auf('--muted'), auf(grund), 4.5, `--muted auf ${grund}`);
  // Fehler und Warnung: Text auf der Fläche, auf der sie stehen
  for (const grund of ['--surface', '--panel', '--bg']) {
    prüfe(thema, auf('--danger'), auf(grund), 4.5, `--danger auf ${grund}`);
    prüfe(thema, auf('--warn'), auf(grund), 4.5, `--warn auf ${grund}`);
  }
  // Rand eines Bedienelements: 3:1 (1.4.11)
  for (const grund of ['--bg', '--panel', '--surface', '--field'])
    prüfe(thema, auf('--line-control'), auf(grund), 3, `--line-control auf ${grund}`);
  // Fokusring: 3:1 gegen die Fläche daneben (2.4.7/1.4.11)
  for (const grund of ['--bg', '--panel', '--surface'])
    prüfe(thema, auf('--accent'), auf(grund), 3, `--accent (Fokusring) auf ${grund}`);
  // Gefüllter Hauptknopf: weiße Schrift darauf
  prüfe(thema, '#ffffff', auf('--accent-solid'), 4.5, 'weiße Schrift auf --accent-solid');
}

console.log('— Farbpaare —');
paare('hell', hell);
paare('dunkel', dunkel);

console.log('\n— die beiden dunklen Blöcke müssen gleich sein —');
for (const k of new Set([...Object.keys(dunkel), ...Object.keys(dunkelAuto)])) {
  if (dunkel[k] !== dunkelAuto[k]) {
    console.log(`FAIL ${k}: [data-theme=dark] ${dunkel[k]} ≠ prefers-color-scheme ${dunkelAuto[k]}`);
    failed++;
  }
}
if (!failed) console.log('ok   beide dunklen Blöcke tragen dieselben Werte');

console.log('\n— kein var(--x) ohne Definition —');
{
  const def = new Set();
  for (const m of css.matchAll(/(^|[;{\s])(--[\w-]+)\s*:/g)) def.add(m[2]);
  // Diese beiden setzt der TypeScript-Teil zur Laufzeit (src/toolbars/docking.ts, system.ts)
  const ausTs = new Set(['--toolbar-rows', '--toolbar-columns']);
  const fehlt = [...new Set([...css.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))].filter((v) => !def.has(v) && !ausTs.has(v));
  if (fehlt.length) {
    console.log(`FAIL benutzt, aber nirgends definiert: ${fehlt.join(', ')}`);
    failed++;
  } else console.log('ok   jedes benutzte Token ist definiert');
}

console.log(failed ? `\n${failed} Prüfung(en) fehlgeschlagen` : '\nalle Farbprüfungen bestanden');
process.exit(failed ? 1 : 0);
