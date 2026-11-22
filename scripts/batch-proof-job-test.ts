// Die Chargenprüfung VOR DEM START (jobProof in batchProofDialog.ts): Welche Objekte zählen, und welche
// Nummern verbraucht der Job? Aufruf: npm run test:batch-proof-job
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const g = globalThis as Record<string, unknown>;
// Path2D und IntersectionObserver gibt es in Node nicht; geprüft wird hier nichts Gezeichnetes
g.Path2D ??= class {
  moveTo() {}
  lineTo() {}
  bezierCurveTo() {}
  closePath() {}
  addPath() {}
};
g.IntersectionObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
const { jobProof } = await import('../src/batchProofDialog');
const { defaultVarText, parseCsv } = await import('../src/vartext');
import type { Editor } from '../src/editor';
import type { Layer, Obj, TextShape, VarText } from '../src/model';

let failed = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const text = (id: number, tpl: string, extra: Partial<TextShape> = {}, obj: Partial<Obj> = {}): Obj =>
  ({
    id,
    layer: 0,
    m: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'text', text: tpl, font: 'Arial', size: 10, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0, vt: { offset: 0 }, ...extra },
    ...obj,
  }) as unknown as Obj;

const gruppe = (id: number, kinder: Obj[], extra: Partial<Obj> = {}): Obj =>
  ({ id, layer: 0, m: [1, 0, 0, 1, 0, 0], shape: { kind: 'group', children: kinder }, ...extra }) as unknown as Obj;

function csv(src: string): VarText {
  const rows = parseCsv(src);
  const header = rows.shift() ?? null;
  return { ...defaultVarText(), csv: { name: 'liste.csv', header, rows }, start: 1, end: Math.max(1, rows.length), current: 1 };
}

/** Editor-Attrappe: jobProof liest nur die Objekte der Seite, den Layer und den variablen Text */
const editor = (objs: Obj[], vt: VarText, aus: number[] = []): Editor =>
  ({
    doc: { objs },
    varText: vt,
    layer: (i: number) => ({ output: !aus.includes(i) }) as Layer,
    sel: [],
  }) as unknown as Editor;

// Zeile 1 hat ein leeres Feld: Daran erkennt man, ob ein Objekt mitgeprüft wurde
const LISTE = csv('Name;Ort\n;Köln\nBruno;Bonn\n;Mainz\n');

test('Ein Text auf einem Layer ohne Ausgabe hält den Job nicht auf', () => {
  assert.equal(jobProof(editor([text(1, '%{Name}')], LISTE)).issues.length, 1);
  assert.equal(jobProof(editor([text(1, '%{Name}', {}, { layer: 3 })], LISTE, [3])).issues.length, 0);
});

test('noLaser und eine falsche Bedingung zählen nicht, auch von der Gruppe darüber', () => {
  assert.equal(jobProof(editor([text(1, '%{Name}', {}, { noLaser: true })], LISTE)).issues.length, 0);
  assert.equal(jobProof(editor([gruppe(9, [text(1, '%{Name}')], { noLaser: true })], LISTE)).issues.length, 0);
  assert.equal(jobProof(editor([gruppe(9, [text(1, '%{Name}')])], LISTE)).issues.length, 1);
  // Eine Bedingung, die nicht aufgeht, blendet das Teil aus (eine, die sich nicht auswerten lässt, nicht:
  // conditionHolds gibt dann true zurück — das Teil bleibt sichtbar und wird mitgeprüft)
  assert.equal(jobProof(editor([text(1, '%{Name}', {}, { showIf: '0' })], LISTE)).issues.length, 0);
  assert.equal(jobProof(editor([gruppe(9, [text(1, '%{Name}')], { showIf: '0' })], LISTE)).issues.length, 0);
});

test('Der Job verbraucht so viele Nummern, wie die Stücke Versatz haben', () => {
  const jig = [text(1, '%{Name}'), text(2, '%{Name}', { vt: { offset: 1 } }), text(3, '%{Name}', { vt: { offset: 2 } })];
  const s = jobProof(editor(jig, LISTE));
  assert.equal(s.from, 1);
  assert.equal(s.to, 3);
  assert.equal(s.rows.length, 3);
  // Zeilen 1 und 3 sind leer, Zeile 2 nicht
  assert.equal(s.bad, 2);
});

test('„Nur Auswahl“: geprüft wird nur das gewählte Stück — und nur dessen Nummern', () => {
  const eins = text(1, '%{Name}');
  const zwei = text(2, '%{Name}', { vt: { offset: 2 } });
  const ed = editor([eins, zwei], LISTE);
  assert.equal(jobProof(ed).to, 3);
  // Nur das erste Schild: eine Nummer, ein Stück
  const s = jobProof(ed, [eins]);
  assert.equal(s.to, 1);
  assert.equal(s.rows.length, 1);
  // Nur das zweite: dessen Versatz bestimmt die Nummer
  assert.equal(jobProof(ed, [zwei]).to, 3);
  // Eine Gruppe in der Auswahl nimmt ihre Kinder mit
  const grp = gruppe(9, [eins]);
  assert.equal(jobProof(editor([grp, zwei], LISTE), [grp]).rows.length, 1);
});

test('Ohne variablen Text meldet der Start nichts', () => {
  const s = jobProof(editor([text(1, 'fester Text', { vt: undefined })], LISTE));
  assert.equal(s.nothing, true);
  assert.equal(s.issues.length, 0);
});

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nalle Tests ok');
process.exit(failed ? 1 : 0);
