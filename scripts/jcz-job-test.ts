// Galvo job (JCZ/EZCad): polylines in field coordinates, hatching, field limits, parameters per layer, device data.
// Aufruf: npm run test:jcz
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import { newDevice, withJcz, Device, DEFAULT_DEVICE } from '../src/gcode';
import { defaultImageLayer, defaultLayer, defaultSubLayer, Layer, loadDoc, Obj } from '../src/model';
import { buildJczJob, jczFramePath, jczSummary } from '../src/jcz/job';
import { DEFAULT_JCZ, normalizeJcz } from '../src/jcz/settings';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const FIELD = 110;
const dev = (patch: Partial<Device['jcz']> = {}): Device => newDevice({ fw: 'jcz', jcz: { ...DEFAULT_JCZ, field: FIELD, ...patch } as Device['jcz'] });
/** Closed path in document coordinates (mm, y down) */
const square = (id: number, x: number, y: number, s: number): Obj => ({
  id, m: [1, 0, 0, 1, 0, 0], layer: 1,
  shape: { kind: 'path', subs: [{ closed: true, nodes: [{ x, y }, { x: x + s, y }, { x: x + s, y: y + s }, { x, y: y + s }] }] },
} as Obj);
const line = (id: number, a: { x: number; y: number }, b: { x: number; y: number }): Obj => ({
  id, m: [1, 0, 0, 1, 0, 0], layer: 1, shape: { kind: 'path', subs: [{ closed: false, nodes: [a, b] }] },
} as Obj);
const run = (objs: Obj[], layer: (i: number) => Layer, d = dev()) =>
  buildJczJob({ doc: loadDoc({ bed: { w: FIELD, h: FIELD }, objs, layers: {} }), layer, imgLayer: () => defaultImageLayer(), device: d });
const lineLayer = (patch: Partial<Layer> = {}) => (i: number): Layer => ({ ...defaultLayer(i), mode: 'line', speed: 60000, power: 50, passes: 3, galvo: { freq: 40, pulse: 100 }, ...patch });
const near = (a: number, b: number, e = 1e-3) => Math.abs(a - b) <= e;

await test('Quadrat in der Feldmitte: ein Linienzug, Ecken ±10 mm, Parameter des Layers', async () => {
  const { prep } = await run([square(1, 45, 45, 20)], lineLayer());
  assert.equal(prep.outside, false);
  assert.equal(prep.job.groups.length, 1);
  const g = prep.job.groups[0];
  assert.deepEqual(g.params, { speed: 1000, power: 50, frequency: 40, pulseWidth: 100, passes: 3 });
  assert.equal(g.polylines.length, 1, 'passes go as a parameter, the path is there once');
  const p = g.polylines[0];
  assert.equal(p.length, 5);
  assert.deepEqual(p[0], p[p.length - 1], 'closed');
  for (const [x, y] of p) assert.ok(near(Math.abs(x), 10) && near(Math.abs(y), 10), `corner ${x},${y}`);
  assert.deepEqual(prep.bounds, { x0: -10, y0: -10, x1: 10, y1: 10 });
  assert.equal(prep.job.repeat, 1);
  // 80 mm at 1000 mm/s, three passes
  assert.ok(prep.time >= 0.24 && prep.time < 0.3, String(prep.time));
});

await test('Feldkoordinaten: Mitte = 0, y nach oben (oben im Entwurf = +y)', async () => {
  const { prep } = await run([line(1, { x: 55, y: 55 }, { x: 75, y: 35 })], lineLayer());
  const p = prep.job.groups[0].polylines[0];
  assert.deepEqual(p, [[0, 0], [20, 20]]);
});

await test('Füllen: Hachura mit Zeilenabstand und Winkel des Layers, nur im Quadrat', async () => {
  for (const angle of [0, 90]) {
    const { prep } = await run([square(1, 45, 45, 20)], (i) => ({ ...defaultLayer(i), mode: 'fill', speed: 120000, power: 30, interval: 1, angle, overscan: 2.5, galvo: { freq: 60, pulse: 200 } }));
    assert.equal(prep.outside, false);
    const lines = prep.job.groups.flatMap((g) => g.polylines);
    assert.ok(lines.length >= 19 && lines.length <= 21, `${lines.length} hatch lines`);
    for (const pl of lines) {
      assert.equal(pl.length, 2);
      const [[ax, ay], [bx, by]] = pl;
      if (angle === 0) assert.ok(near(ay, by), 'horizontal');
      else assert.ok(near(ax, bx), 'vertical');
      // The overscan is travel: no marked point outside the square
      for (const v of [ax, ay, bx, by]) assert.ok(Math.abs(v) <= 10 + 1e-6, `inside ${v}`);
    }
    assert.equal(prep.job.groups[0].params.speed, 2000);
    assert.equal(prep.job.groups[0].params.frequency, 60);
  }
});

await test('Entwurf ragt über das Feld: Warnung und Markieren gesperrt (outside)', async () => {
  const { prep } = await run([square(1, 100, 45, 20)], lineLayer());
  assert.equal(prep.outside, true);
  assert.match(prep.warnings[0], /Galvo-Feld \(110 × 110 mm\)/);
  assert.match(prep.warnings[0], /X 45[.,]0 … 65[.,]0/);
});

await test('Objekt ganz außerhalb: nicht im Job, Hinweis „geparkt“', async () => {
  const { prep } = await run([square(1, 45, 45, 20), square(2, 300, 300, 10)], lineLayer());
  assert.equal(prep.outside, false);
  assert.equal(prep.job.groups.flatMap((g) => g.polylines).length, 1);
  assert.ok(prep.warnings.some((w) => /außerhalb des Arbeitsbereichs/.test(w)), prep.warnings.join('\n'));
});

await test('Frequenz außerhalb der Quelle wird begrenzt und gemeldet', async () => {
  const { prep } = await run([square(1, 45, 45, 20)], lineLayer({ galvo: { freq: 500, pulse: 100 } }));
  assert.equal(prep.job.groups[0].params.frequency, 200);
  assert.ok(prep.warnings.some((w) => /500 kHz.*200 kHz/.test(w)), prep.warnings.join('\n'));
});

await test('Sub-Layer: eigene Gruppe mit eigenen Werten; Layer ohne Galvo-Werte bekommen Standardwerte', async () => {
  const sub = { ...defaultSubLayer('fill'), speed: 30000, power: 20, interval: 2, passes: 2, galvo: { freq: 80, pulse: 50 } };
  const { prep } = await run([square(1, 45, 45, 20)], (i) => ({ ...defaultLayer(i), mode: 'line', speed: 6000, power: 70, sub: [sub] }));
  const byFreq = new Map(prep.groups.map((g) => [g.params.frequency, g]));
  assert.equal(byFreq.get(30)?.params.speed, 100, 'layer without galvo values: 30 kHz default');
  assert.equal(byFreq.get(30)?.params.passes, 1);
  assert.equal(byFreq.get(80)?.params.passes, 2);
  assert.equal(byFreq.get(80)?.params.power, 20);
  assert.equal(byFreq.get(80)?.sub, 0);
});

await test('Rotlicht-Rahmen: Rechteck und Kontur in Feldkoordinaten, geschlossen', async () => {
  const { base } = await run([square(1, 45, 45, 20)], lineLayer());
  const rect = jczFramePath(base, { w: FIELD, h: FIELD }, false)!;
  assert.deepEqual(rect, [[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]]);
  const hull = jczFramePath(base, { w: FIELD, h: FIELD }, true)!;
  assert.ok(hull.length >= 4);
  assert.deepEqual(hull[0], hull[hull.length - 1]);
  assert.equal(jczFramePath({ ...base, bounds: null }, { w: FIELD, h: FIELD }, false), null);
});

await test('Bestätigung nennt Geschwindigkeit, Leistung, Frequenz und (MOPA) Pulsbreite', async () => {
  const { prep } = await run([square(1, 45, 45, 20)], lineLayer());
  const [plain] = jczSummary(prep, dev());
  assert.match(plain, /1000 mm\/s, 50 %, 40 kHz, 3×/);
  assert.doesNotMatch(plain, /Pulsbreite/);
  const [mopa] = jczSummary(prep, dev({ pulseWidthEnabled: true }));
  assert.match(mopa, /Pulsbreite 100 ns/);
});

await test('Gerätedaten: Standardwerte, tolerantes Lesen, Arbeitsfläche = Feld', () => {
  const d = newDevice({ fw: 'jcz' });
  assert.equal(d.bedW, DEFAULT_JCZ.field);
  assert.equal(d.bedH, DEFAULT_JCZ.field);
  assert.equal(d.startFrom, 'absolute');
  const n = normalizeJcz({ field: 'x', galvo1: { scale: 0.9, sign: -3 }, ports: { redLight: 3 }, laserType: 'laser', unknown: 7, lightburn: { Galvo_1_Bulge: 1 } });
  assert.equal(n.field, DEFAULT_JCZ.field);
  assert.deepEqual(n.galvo1, { scale: 0.9, bulge: 1, skew: 1, trapezoid: 1, sign: -1 });
  assert.equal(n.ports.redLight, 3);
  assert.equal(n.ports.startMark, -1);
  assert.equal(n.laserType, 'fiber');
  assert.equal((n as unknown as Record<string, unknown>).unknown, 7, 'unknown fields are kept');
  assert.deepEqual(n.lightburn, { Galvo_1_Bulge: 1 });
  // A stored galvo device without settings (older version) gets them; other devices stay unchanged
  const old = withJcz({ ...DEFAULT_DEVICE, fw: 'jcz', bedW: 400, bedH: 300, startFrom: 'current' });
  assert.equal(old.jcz?.field, DEFAULT_JCZ.field);
  assert.equal(old.bedW, DEFAULT_JCZ.field);
  assert.equal(old.startFrom, 'absolute');
  const grbl = { ...DEFAULT_DEVICE };
  assert.equal(withJcz(grbl), grbl);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Galvo-Job-Tests bestanden');
