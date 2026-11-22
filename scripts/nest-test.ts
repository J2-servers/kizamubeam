// Tests des Verschachtelns (Nesting). Aufruf: npm run test:nest
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
import ClipperLib from 'clipper-lib';
import type { Mat, Obj, Pt } from '../src/model';
const { DEFAULT_NEST, autoCell, nest, grow, leftover, regionArea } = await import('../src/nest');
import type { NestOptions, NestPart, NestResult, Poly } from '../src/nest';
const { EditorNest, DEFAULT_NEST_SETTINGS, QUALITY } = await import('../src/editor/nest');
const { t } = await import('../src/i18n');
const { loadDoc, defaultLayer, IDENT, translate, leaves } = await import('../src/model');

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

const rect = (x: number, y: number, w: number, h: number): Poly => [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
const circle = (cx: number, cy: number, r: number, n = 48): Poly =>
  Array.from({ length: n }, (_, i) => ({ x: cx + r * Math.cos((i / n) * 2 * Math.PI), y: cy + r * Math.sin((i / n) * 2 * Math.PI) }));
const ap = (m: Mat, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
const opts = (o: Partial<NestOptions> = {}): NestOptions => ({ ...DEFAULT_NEST, timeLimit: 0, ...o });

/** Lage aller Teile nach dem Verschachteln */
function placedRegions(parts: NestPart[], r: NestResult) {
  return r.placed.map((p) => ({ sheet: p.sheet, key: p.key, region: parts.find((x) => x.key === p.key)!.region.map((poly) => poly.map((q) => ap(p.m, q))) }));
}

const SC = 1000;
const paths = (polys: Poly[]) => polys.map((p) => p.map((q) => ({ X: Math.round(q.x * SC), Y: Math.round(q.y * SC) })));
function overlapArea(a: Poly[], b: Poly[]) {
  const c = new ClipperLib.Clipper();
  c.AddPaths(paths(a), ClipperLib.PolyType.ptSubject, true);
  c.AddPaths(paths(b), ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftEvenOdd);
  return out.reduce((s, p) => s + Math.abs(ClipperLib.Clipper.Area(p)), 0) / (SC * SC);
}

/** Abstände prüfen: Teile untereinander ≥ gap, zum Rand ≥ margin, nicht auf Hindernissen */
function checkLayout(parts: NestPart[], r: NestResult, area: Poly[], o: NestOptions, obstacles: Poly[][] = []) {
  const pr = placedRegions(parts, r);
  const inner = grow(area, -o.margin + 0.01);
  for (const p of pr) {
    const outside = regionArea(p.region) - overlapArea(p.region, inner);
    assert.ok(outside < 0.01, `Teil ${p.key} ragt ${outside.toFixed(3)} mm² über den Rand`);
    if (p.sheet === 0)
      for (const ob of obstacles) assert.ok(overlapArea(grow(p.region, o.gap / 2 - 0.01), grow(ob, o.gap / 2 - 0.01)) < 0.01, `Teil ${p.key} liegt auf einem Hindernis`);
  }
  for (let i = 0; i < pr.length; i++)
    for (let j = i + 1; j < pr.length; j++) {
      if (pr[i].sheet !== pr[j].sheet) continue;
      const ov = overlapArea(grow(pr[i].region, o.gap / 2 - 0.01), grow(pr[j].region, o.gap / 2 - 0.01));
      assert.ok(ov < 0.01, `Teile ${pr[i].key} und ${pr[j].key} kommen sich zu nahe (${ov.toFixed(3)} mm²)`);
    }
}

await test('Rechtecke: alle auf der Platte, Abstand und Rand eingehalten', () => {
  const parts: NestPart[] = Array.from({ length: 10 }, (_, i) => ({ key: i, region: [rect(500 + i * 7, 300, 50, 30)] }));
  const area = [rect(0, 0, 200, 140)];
  const o = opts();
  const r = nest(parts, { area, obstacles: [] }, o);
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.sheets, 1);
  checkLayout(parts, r, area, o);
  // 10 × 1500 mm² auf 200 × 140 = 28000 mm² (nutzbar etwas weniger)
  assert.ok(r.usage[0] > 0.5, `Ausnutzung ${r.usage[0]}`);
});

await test('Zu viele Teile: weitere Platten', () => {
  const parts: NestPart[] = Array.from({ length: 12 }, (_, i) => ({ key: i, region: [rect(0, 0, 90, 90)] }));
  const area = [rect(0, 0, 200, 200)];
  const o = opts({ gap: 2, margin: 2 });
  const r = nest(parts, { area, obstacles: [] }, o);
  assert.equal(r.unplaced.length, 0);
  assert.equal(r.sheets, 3, 'je 4 Teile auf einer Platte');
  for (let s = 0; s < 3; s++) assert.equal(r.placed.filter((p) => p.sheet === s).length, 4);
  checkLayout(parts, r, area, o);
});

await test('Ohne neue Platten bleiben Teile übrig', () => {
  const parts: NestPart[] = Array.from({ length: 6 }, (_, i) => ({ key: i, region: [rect(0, 0, 90, 90)] }));
  const r = nest(parts, { area: [rect(0, 0, 200, 200)], obstacles: [] }, opts({ gap: 2, margin: 2, newSheets: false }));
  assert.equal(r.placed.length, 4);
  assert.equal(r.unplaced.length, 2);
  assert.equal(r.sheets, 1);
});

await test('Zu großes Teil: nicht platziert, keine leere Zusatzplatte', () => {
  const parts: NestPart[] = [{ key: 1, region: [rect(0, 0, 50, 50)] }, { key: 2, region: [rect(0, 0, 300, 50)] }];
  const r = nest(parts, { area: [rect(0, 0, 200, 200)], obstacles: [] }, opts());
  assert.deepEqual(r.unplaced, [2]);
  assert.equal(r.sheets, 1);
});

await test('Langes Teil passt nur gedreht', () => {
  const parts: NestPart[] = [{ key: 1, region: [rect(0, 0, 180, 20)] }];
  const area = [rect(0, 0, 100, 200)];
  const o = opts();
  const r = nest(parts, { area, obstacles: [] }, o);
  assert.equal(r.placed.length, 1);
  assert.ok(r.placed[0].angle === 90 || r.placed[0].angle === 270, `Drehung ${r.placed[0].angle}`);
  checkLayout(parts, r, area, o);
  // Ohne Drehung passt es nicht
  const r0 = nest(parts, { area, obstacles: [] }, opts({ rotations: [0] }));
  assert.equal(r0.placed.length, 0);
});

await test('Kleines Teil landet im Loch eines Rings', () => {
  const ring: NestPart = { key: 1, region: [circle(0, 0, 45), circle(0, 0, 35)] };
  const disc: NestPart = { key: 2, region: [circle(0, 0, 25)] };
  // Platte nur wenig größer als der Ring: die Scheibe passt nur ins Loch
  const area = [rect(0, 0, 100, 100)];
  const o = opts({ gap: 2, margin: 2, cell: 0.4, newSheets: false });
  const r = nest([ring, disc], { area, obstacles: [] }, o);
  assert.equal(r.unplaced.length, 0, 'beide passen');
  checkLayout([ring, disc], r, area, o);
  const pr = placedRegions([ring, disc], r);
  const c = (k: number) => {
    const pts = pr.find((p) => p.key === k)!.region[0];
    return { x: pts.reduce((s, q) => s + q.x, 0) / pts.length, y: pts.reduce((s, q) => s + q.y, 0) / pts.length };
  };
  // Loch 35 mm, Scheibe 25 mm, Abstand 2 mm: Mittenversatz höchstens 8 mm
  assert.ok(Math.hypot(c(1).x - c(2).x, c(1).y - c(2).y) < 8.01, 'Scheibe liegt im Ring');
});

await test('Vorhandene Objekte werden umgangen', () => {
  const ob = [rect(0, 100, 200, 100)];
  const parts: NestPart[] = Array.from({ length: 6 }, (_, i) => ({ key: i, region: [rect(0, 0, 40, 40)] }));
  const area = [rect(0, 0, 200, 200)];
  const o = opts({ flipY: false });
  const r = nest(parts, { area, obstacles: [ob] }, o);
  assert.equal(r.unplaced.length, 0);
  checkLayout(parts, r, area, o, [ob]);
});

await test('Ecke: Teile sammeln sich an der gewählten Ecke', () => {
  const parts: NestPart[] = [{ key: 1, region: [rect(0, 0, 30, 20)] }];
  const area = [rect(0, 0, 200, 100)];
  for (const [fx, fy] of [[false, false], [true, false], [false, true], [true, true]]) {
    const o = opts({ flipX: fx, flipY: fy, margin: 5, gap: 0 });
    const r = nest(parts, { area, obstacles: [] }, o);
    const pts = placedRegions(parts, r)[0].region[0];
    const x0 = Math.min(...pts.map((q) => q.x)),
      x1 = Math.max(...pts.map((q) => q.x)),
      y0 = Math.min(...pts.map((q) => q.y)),
      y1 = Math.max(...pts.map((q) => q.y));
    const near = (v: number, w: number) => Math.abs(v - w) < 1.5;
    assert.ok(fx ? near(x1, 195) : near(x0, 5), `x bei ${fx}: ${x0}…${x1}`);
    assert.ok(fy ? near(y1, 95) : near(y0, 5), `y bei ${fy}: ${y0}…${y1}`);
    checkLayout(parts, r, area, o);
  }
});

await test('L-Formen greifen ineinander (besser als Rechteck-Packen)', () => {
  // L aus 60×60 mit 40×40 Ausschnitt: Begrenzungsrechtecke passen auf 170 × 86 nur 2, ineinander gedreht 4
  const L: Poly = [{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 20 }, { x: 20, y: 20 }, { x: 20, y: 60 }, { x: 0, y: 60 }];
  const parts: NestPart[] = Array.from({ length: 4 }, (_, i) => ({ key: i, region: [L] }));
  const area = [rect(0, 0, 170, 86)];
  const o = opts({ gap: 1, margin: 1, cell: 0.25, rotations: [0, 90, 180, 270], newSheets: false, timeLimit: 300 });
  const r = nest(parts, { area, obstacles: [] }, o);
  assert.equal(r.unplaced.length, 0, `${r.placed.length} von 4 platziert`);
  checkLayout(parts, r, area, o);
});

await test('Freie Form als Platte (Reststück)', () => {
  const area = [circle(100, 100, 100, 96)];
  const parts: NestPart[] = Array.from({ length: 8 }, (_, i) => ({ key: i, region: [rect(0, 0, 40, 40)] }));
  const o = opts({ newSheets: false });
  const r = nest(parts, { area, obstacles: [] }, o);
  assert.ok(r.placed.length >= 8, `${r.placed.length} platziert`);
  checkLayout(parts, r, area, o);
});

await test('Geschwindigkeit: 150 gemischte Teile auf 600 × 400', () => {
  const parts: NestPart[] = [];
  for (let i = 0; i < 150; i++) {
    const k = i % 3;
    parts.push({ key: i, region: k === 0 ? [rect(0, 0, 20 + (i % 7) * 4, 15 + (i % 5) * 3)] : k === 1 ? [circle(0, 0, 8 + (i % 4) * 3)] : [circle(0, 0, 15), rect(-5, -5, 10, 10)] });
  }
  const area = [rect(0, 0, 600, 400)];
  const o = opts({ cell: 0.5, rotations: [0, 90, 180, 270] });
  const t0 = Date.now();
  const r = nest(parts, { area, obstacles: [] }, o);
  const ms = Date.now() - t0;
  console.log(`     ${r.placed.length} Teile, ${r.sheets} Platte(n), Ausnutzung ${(r.usage[0] * 100).toFixed(0)} %, ${ms} ms`);
  assert.equal(r.unplaced.length, 0);
  assert.ok(ms < 8000, `${ms} ms`);
  checkLayout(parts, r, area, o);
});

// ---------- Anbindung an den Editor ----------

/** Nachbildung des Editors mit dem, was das Verschachteln braucht */
function fakeEditor(objs: Obj[], bed = { w: 300, h: 200 }) {
  const doc = loadDoc({ version: 2, bed, pages: [{ name: 'Seite 1', objs }], page: 0, layers: {} });
  const ed = Object.create(EditorNest.prototype) as InstanceType<typeof EditorNest> & Record<string, any>;
  Object.assign(ed, {
    doc, sel: [...objs], hint: '', snapshots: [] as string[],
    layer: (i: number) => ({ ...defaultLayer(i), mode: i === 0 ? 'fill' : 'line' }),
    snapshot(l: string) { this.snapshots.push(l); },
    setSel(s: Obj[]) { this.sel = s; },
    emit() {},
    freePageName() { return `Seite ${this.doc.pages.length + 1}`; },
  });
  return ed;
}
let nextId = 1;
const rectObj = (x: number, y: number, w: number, h: number, layer = 1): Obj => ({ id: nextId++, m: translate(x, y), layer, shape: { kind: 'rect', w, h, r: 0 } });
const circObj = (cx: number, cy: number, r: number, layer = 1): Obj => ({ id: nextId++, m: translate(cx, cy), layer, shape: { kind: 'ellipse', rx: r, ry: r } });
const worldBox = (o: Obj) => {
  const pts: Pt[] = [];
  for (const [l, m] of leaves([o])) {
    const s = l.shape as { kind: string; w?: number; h?: number; rx?: number; ry?: number };
    const c = s.kind === 'rect' ? [[0, 0], [s.w!, 0], [s.w!, s.h!], [0, s.h!]] : [[-s.rx!, 0], [s.rx!, 0], [0, -s.ry!], [0, s.ry!]];
    for (const [x, y] of c) pts.push(ap(m, { x, y }));
  }
  return { x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) };
};

await test('Editor: Gravur und Loch bleiben am Teil, Teil im Loch ist eigenständig', () => {
  const plate = rectObj(10, 10, 100, 80);
  const hole = circObj(60, 50, 30); // eigene Form als Loch in der Platte
  const engraving = rectObj(15, 15, 20, 5, 0); // Füll-Layer: Gravur auf der Platte
  const ring = circObj(200, 100, 45);
  const ringHole = circObj(200, 100, 35);
  const inHole = circObj(200, 100, 10); // liegt im Loch des Rings: eigenes Teil
  const ed = fakeEditor([plate, hole, engraving, ring, ringHole, inHole]);
  const units = ed.nestUnits(ed.sel, true);
  const sets = units.map((u) => u.objs.map((o) => o.id).sort((a, b) => a - b).join(','));
  assert.ok(sets.includes([plate.id, hole.id, engraving.id].join(',')), sets.join(' | '));
  assert.ok(sets.includes([ring.id, ringHole.id].join(',')), sets.join(' | '));
  assert.ok(sets.includes(String(inHole.id)), sets.join(' | '));
  // Die Fläche der Platte hat das Loch
  const plateUnit = units.find((u) => u.objs.includes(plate))!;
  const a = regionArea(plateUnit.region);
  assert.ok(Math.abs(a - (8000 - Math.PI * 900)) < 20, `Fläche ${a}`);
});

await test('Editor: teilweise überlappende und übereinanderliegende Teile bleiben getrennt', () => {
  const a = rectObj(0, 0, 50, 40);
  const b = rectObj(30, 20, 50, 40); // überdeckt a teilweise
  const c = rectObj(100, 0, 30, 30);
  const d = rectObj(100, 0, 30, 30); // genau auf c (z. B. Duplikat)
  // Zwei gestapelte Ringe (Kreis mit Loch als eigene Form): zwei Teile
  const r1 = circObj(200, 100, 40),
    h1 = circObj(200, 100, 30),
    r2 = circObj(200, 100, 40),
    h2 = circObj(200, 100, 30);
  const ed = fakeEditor([a, b, c, d, r1, h1, r2, h2]);
  const units = ed.nestUnits(ed.sel, true);
  assert.equal(units.length, 6, units.map((u) => u.objs.map((o) => o.id).join(',')).join(' | '));
});

await test('Editor: verschachteln, Überlauf auf neue Seite, ein Undo-Schritt', async () => {
  const parts = Array.from({ length: 8 }, (_, i) => rectObj(i * 5, i * 5, 90, 60));
  const other = rectObj(0, 0, 10, 10); // nicht gewählt: wird umgangen
  const ed = fakeEditor([...parts, other], { w: 200, h: 140 });
  ed.sel = [...parts];
  const r = await ed.nestSel({ ...DEFAULT_NEST_SETTINGS, quality: 'fast', gap: 2, margin: 2, rotStep: 90 });
  assert.ok(r);
  assert.deepEqual(ed.snapshots, [t('Verschachteln')]);
  assert.equal(r!.unplaced.length, 0);
  assert.equal(ed.doc.pages.length, 2, 'je 4 Teile auf einer Seite');
  assert.equal(ed.doc.page, 0);
  const all = ed.doc.pages.flatMap((p) => p.objs);
  assert.equal(all.length, 9);
  assert.ok(ed.doc.pages[0].objs.includes(other));
  for (const pg of ed.doc.pages)
    for (const o of pg.objs) {
      const b = worldBox(o);
      assert.ok(b.x0 >= -1e-6 && b.y0 >= -1e-6 && b.x1 <= 200 + 1e-6 && b.y1 <= 140 + 1e-6, `${o.id} außerhalb: ${JSON.stringify(b)}`);
    }
});

await test('Editor: Reststück als Platte bleibt liegen, neue Seiten bekommen eine Kopie', async () => {
  const scrap = circObj(150, 100, 60, 31);
  const parts = Array.from({ length: 6 }, (_, i) => rectObj(i * 3, 0, 40, 30));
  const ed = fakeEditor([scrap, ...parts]);
  const m0 = [...scrap.m];
  const r = await ed.nestSel({ ...DEFAULT_NEST_SETTINGS, sheet: 'shape', quality: 'fast', gap: 1, margin: 1 });
  assert.ok(r && r.placed.length === 6, `${r?.placed.length}`);
  assert.deepEqual(scrap.m, m0);
  for (let i = 1; i < ed.doc.pages.length; i++) assert.ok(ed.doc.pages[i].objs.some((o) => o.shape.kind === 'ellipse'), 'Kopie des Reststücks');
  for (const pg of ed.doc.pages)
    for (const o of pg.objs) {
      if (o.shape.kind !== 'rect') continue;
      const b = worldBox(o);
      for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x0, b.y1], [b.x1, b.y1]]) assert.ok(Math.hypot(x - 150, y - 100) <= 60, `Ecke außerhalb des Reststücks`);
    }
});

await test('Editor: 200×600 und 600×200 passen in jeder Drehrichtung aufs Material (Tester-Meldung)', async () => {
  for (const [w, h] of [[200, 600], [600, 200]])
    for (const [SW, SH] of [[700, 300], [300, 700]])
      for (const rotStep of [90, 45, 5])
        for (const corner of ['bl', 'tr'] as const) {
          const part = rectObj(1100, 50, w, h);
          const ed = fakeEditor([part], { w: 1500, h: 1000 });
          const r = await ed.nestSel({ ...DEFAULT_NEST_SETTINGS, sheet: 'material', w: SW, h: SH, x: 20, y: 30, quality: 'fast', rotStep, corner, newPages: false });
          assert.equal(r?.placed.length, 1, `${w}×${h} auf ${SW}×${SH}, ${rotStep}°, ${corner}`);
          const b = worldBox(part);
          const y0 = 1000 - 30 - SH;
          assert.ok(b.x0 >= 20 - 1e-6 && b.x1 <= 20 + SW + 1e-6 && b.y0 >= y0 - 1e-6 && b.y1 <= y0 + SH + 1e-6, JSON.stringify(b));
        }
});

await test('Editor: ein nicht gewähltes Rohteil wird umgangen, mit Hinweis', async () => {
  const stock = rectObj(0, 0, 700, 300);
  const part = rectObj(800, 400, 600, 200);
  const ed = fakeEditor([stock, part], { w: 1000, h: 700 });
  ed.sel = [part];
  const r = await ed.nestSel({ ...DEFAULT_NEST_SETTINGS, quality: 'fast', newPages: false });
  assert.ok(r);
  const b = worldBox(part);
  assert.ok(b.y0 >= 300 || b.x0 >= 700, 'liegt nicht auf dem Rohteil');
  assert.ok(ed.hint.length > 0);
  // Selected along as the sheet: the part goes onto it
  ed.sel = [stock, part];
  const r2 = await ed.nestSel({ ...DEFAULT_NEST_SETTINGS, sheet: 'shape', quality: 'fast', newPages: false });
  assert.equal(r2?.placed.length, 1);
  const b2 = worldBox(part);
  assert.ok(b2.x1 <= 700 + 1e-6 && b2.y1 <= 300 + 1e-6, JSON.stringify(b2));
});

// ---------- Rasterweite: Was zwischen zwei Teilen wirklich verloren geht ----------

/** Kleinster Abstand zwischen zwei platzierten Teilen (Umgebungskästen, reicht für Rechtecke) */
function engsterAbstand(parts: NestPart[], r: NestResult): number {
  const gelegt = placedRegions(parts, r).filter((p) => p.sheet === 0).map((p) => p.region[0]);
  const kasten = (p: Pt[]) => ({ x0: Math.min(...p.map((q) => q.x)), x1: Math.max(...p.map((q) => q.x)), y0: Math.min(...p.map((q) => q.y)), y1: Math.max(...p.map((q) => q.y)) });
  let min = Infinity;
  for (let i = 0; i < gelegt.length; i++)
    for (let j = i + 1; j < gelegt.length; j++) {
      const A = kasten(gelegt[i]), B = kasten(gelegt[j]);
      const d = Math.hypot(Math.max(0, Math.max(A.x0 - B.x1, B.x0 - A.x1)), Math.max(0, Math.max(A.y0 - B.y1, B.y0 - A.y1)));
      if (d > 1e-9 && d < min) min = d;
    }
  return min;
}

await test('Rasterweite: der wirkliche Abstand bleibt zwischen dem gewünschten und dem gewünschten plus Zelldiagonale', () => {
  // Das Raster zwingt jedes Teil, um cell/√2 zu wachsen (sonst wäre der Abstand nicht garantiert).
  // Der Abstand darf also nie KLEINER als gewünscht sein — und nie größer als gewünscht + cell·√2.
  const gap = 2;
  for (const cell of [2, 1, 0.5]) {
    const parts: NestPart[] = Array.from({ length: 30 }, (_, i) => ({ key: i, region: [rect(0, 0, 60, 40)] }));
    const r = nest(parts, { area: [rect(0, 0, 600, 400)], obstacles: [] }, opts({ cell, gap, margin: 3, newSheets: false }));
    const d = engsterAbstand(parts, r);
    assert.ok(d >= gap - 1e-6, `Zelle ${cell}: ${d.toFixed(2)} mm ist enger als die gewünschten ${gap} mm`);
    assert.ok(d <= gap + cell * Math.SQRT2 + 1e-6, `Zelle ${cell}: ${d.toFixed(2)} mm überschreitet ${gap} + ${cell}·√2`);
  }
});

await test('Rasterweite: eine feinere Zelle verschenkt weniger Platz', () => {
  const gap = 2;
  const messen = (cell: number) => {
    const parts: NestPart[] = Array.from({ length: 30 }, (_, i) => ({ key: i, region: [rect(0, 0, 60, 40)] }));
    return engsterAbstand(parts, nest(parts, { area: [rect(0, 0, 600, 400)], obstacles: [] }, opts({ cell, gap, margin: 3, newSheets: false })));
  };
  assert.ok(messen(0.5) < messen(2), 'die feine Zelle muss näher an den gewünschten Abstand kommen als die grobe');
});

await test('Genauigkeit: die drei Stufen geben auf einer großen Platte DREI verschiedene Rasterweiten', () => {
  // Vor dem 22.11.2026 zwang die feste Obergrenze von 1,5 Mio. Zellen alle drei Stufen auf dieselbe
  // Weite (1,84 mm auf 2750 × 1850): Die Wahl der Genauigkeit tat dort gar nichts.
  const platte: [number, number] = [2750, 1850];
  const weiten = (['fast', 'normal', 'fine'] as const).map((q) => autoCell(platte[0], platte[1], QUALITY[q].cell, QUALITY[q].maxCells));
  assert.equal(new Set(weiten.map((w) => w.toFixed(3))).size, 3, `drei verschiedene Weiten erwartet, bekommen: ${weiten.map((w) => w.toFixed(2)).join(', ')}`);
  assert.ok(weiten[0] > weiten[1] && weiten[1] > weiten[2], `gröber → feiner erwartet: ${weiten.join(', ')}`);
  assert.ok(weiten[2] < 1, `„Gründlich“ sollte unter 1 mm bleiben, ist ${weiten[2].toFixed(2)}`);
  // Und der Speicher bleibt im Rahmen: 3 Byte je Zelle
  for (const q of ['fast', 'normal', 'fine'] as const) assert.ok((QUALITY[q].maxCells * 3) / 1048576 <= 24, `${q}: zu viel Speicher`);
});

// ---------- Reststück: was von der Platte übrig bleibt ----------

const box = (polys: Poly[]) =>
  polys.reduce(
    (b, p) => p.reduce((c, q) => ({ x0: Math.min(c.x0, q.x), y0: Math.min(c.y0, q.y), x1: Math.max(c.x1, q.x), y1: Math.max(c.y1, q.y) }), b),
    { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity },
  );

await test('Reststück: zwei Teile in der Ecke lassen ein L übrig', () => {
  const rest = leftover([rect(0, 0, 300, 200)], [[rect(0, 0, 100, 100)], [rect(100, 0, 60, 60)]], { grow: 1, minWidth: 15 });
  assert.equal(rest.length, 1);
  // 60000 − (102 × 102) − (62 × 62 ohne die Überschneidung) ≈ 46100, auf jeden Fall kleiner als ohne Abstand
  const a = regionArea(rest);
  assert.ok(a > 45000 && a < 60000 - 100 * 100 - 60 * 60 + 1, `${a} mm²`);
  assert.deepEqual(box(rest), { x0: 0, y0: 0, x1: 300, y1: 200 });
});

await test('Reststück: ein Teil in der Mitte lässt einen Ring (Loch bleibt)', () => {
  const rest = leftover([rect(0, 0, 300, 200)], [[rect(120, 80, 60, 40)]], { grow: 1, minWidth: 15 });
  assert.equal(rest.length, 2, 'Außenkontur und Loch');
  assert.ok(Math.abs(regionArea(rest) - (60000 - 62 * 42)) < 5, `${regionArea(rest)} mm²`);
});

await test('Reststück: scharfe Ecken bleiben scharf (kein Rundlaufen durch das Öffnen)', () => {
  const rest = leftover([rect(0, 0, 300, 200)], [[rect(150, 0, 150, 200)]], { grow: 0, minWidth: 15 });
  assert.equal(rest.length, 1);
  assert.deepEqual(box(rest), { x0: 0, y0: 0, x1: 150, y1: 200 });
  assert.ok(Math.abs(regionArea(rest) - 150 * 200) < 1, `${regionArea(rest)} mm²`);
});

await test('Reststück: zu schmale Streifen fallen weg, mit kleinerem Mindestmaß bleiben sie', () => {
  const schmal = [[rect(0, 0, 300, 192)]];
  assert.deepEqual(leftover([rect(0, 0, 300, 200)], schmal, { grow: 0, minWidth: 15 }), []);
  const mit = leftover([rect(0, 0, 300, 200)], schmal, { grow: 0, minWidth: 5 });
  assert.equal(mit.length, 1);
  assert.ok(Math.abs(regionArea(mit) - 300 * 8) < 1, `${regionArea(mit)} mm²`);
});

await test('Reststück: zu kleine Stücke fallen weg, große bleiben', () => {
  // Ein 12 × 200 links (zu schmal) und ein 100 × 200 rechts
  const rest = leftover([rect(0, 0, 300, 200)], [[rect(12, 0, 188, 200)]], { grow: 0, minWidth: 15 });
  assert.equal(rest.length, 1);
  assert.deepEqual(box(rest), { x0: 200, y0: 0, x1: 300, y1: 200 });
});

await test('Reststück: volle Platte und leere Eingabe geben nichts zurück', () => {
  assert.deepEqual(leftover([rect(0, 0, 100, 100)], [[rect(0, 0, 100, 100)]], { grow: 0, minWidth: 15 }), []);
  assert.deepEqual(leftover([], [[rect(0, 0, 10, 10)]], { grow: 0, minWidth: 15 }), []);
  assert.equal(regionArea(leftover([rect(0, 0, 100, 100)], [], { grow: 0, minWidth: 15 })), 10000);
});

await test('Editor: „Reststück zeichnen“ legt den Umriss auf den Werkzeug-Layer', async () => {
  const parts = Array.from({ length: 3 }, (_, i) => rectObj(i * 3, 0, 40, 30));
  const ed = fakeEditor(parts);
  const vorher = ed.doc.pages[0].objs.length;
  const r = await ed.nestSel({ ...DEFAULT_NEST_SETTINGS, sheet: 'material', w: 200, h: 150, x: 0, y: 0, quality: 'fast', rest: true, restMin: 10 });
  assert.ok(r && r.placed.length === 3, `${r?.placed.length}`);
  const neu = ed.doc.pages[0].objs.filter((o) => o.shape.kind === 'path');
  assert.equal(ed.doc.pages[0].objs.length, vorher + 1, 'genau ein neues Objekt');
  assert.equal(neu.length, 1);
  assert.equal(neu[0].layer, 30, 'Werkzeug-Layer T1');
  assert.ok((neu[0].shape as { subs: unknown[] }).subs.length >= 1);
  // Ohne die Einstellung kommt nichts dazu
  const ed2 = fakeEditor(Array.from({ length: 3 }, (_, i) => rectObj(i * 3, 0, 40, 30)));
  const n0 = ed2.doc.pages[0].objs.length;
  await ed2.nestSel({ ...DEFAULT_NEST_SETTINGS, sheet: 'material', w: 200, h: 150, x: 0, y: 0, quality: 'fast' });
  assert.equal(ed2.doc.pages[0].objs.length, n0);
});

if (failed) {
  console.log(`\n${failed} Test(s) fehlgeschlagen`);
  process.exit(1);
}
console.log('\nAlle Nesting-Tests bestanden');
