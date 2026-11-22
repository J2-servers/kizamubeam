// The example picture of every toolbox tile, by tile id (src/apps.ts and the generators' tiles). Each one shows what
// the tool makes: generators are drawn from their real geometry (the gear is a gear the generator computed, the box
// is assembled from the generator's panels), the other tools as a small scene in the same style.
// New tool: add its picture here and run npm run build:app-art; npm run test:apps checks that none is missing.
import type { Obj } from '../../src/model';
import { translate } from '../../src/model';
import { buildGen, defaultParams, getGenerator, normalizeParams, type Params } from '../../src/generators/index';
import { asmSolids } from '../../src/view3d/solids';
import type { Pose } from '../../src/generators/pose';
import { computeHinge, DEFAULT_HINGE } from '../../src/hinges';
import { qrMatrix } from '../../src/barcode';
import { bars, encodeLinear } from '../../src/barcode1d';
import {
  arcPts, area, arrow, bez, boundsOf, type Box, circle, circlePts, ellipse, fade, fitMap, flat, inside, label, labelWidth, line, lines,
  move, moveAll, plate, type Poly, type Pt, rect, rectPts, ROOM, roundRectPts, scaleAll, smooth, starPts, thinAll, turn, turnAll,
} from './kit';
import { isoPicture, type Plate } from './iso';

// ---------- Real parts ----------

/** Outlines of the parts a generator makes (mm, y down), each part moved to its place in the arrangement */
function parts(id: string, params: Params): { key: string; polys: Poly[] }[] {
  const g = getGenerator(id);
  if (!g) throw new Error(`no generator ${id}`);
  const r = buildGen(g, normalizeParams(g, { ...defaultParams(g), ...params }));
  if (!r.parts.length) throw new Error(`${id}: ${r.issues.map((i) => i.msg).join('; ')}`);
  return r.parts.map((p) => ({ key: p.shape.part ?? 'main', polys: moveAll(flat(p.shape.subs), p.at.x, p.at.y) }));
}

type KeyPlate = Plate & { key: string };

/** The plates of an assembly in their place in space */
function plates(id: string, params: Params): KeyPlate[] {
  const g = getGenerator(id);
  if (!g) throw new Error(`no generator ${id}`);
  const s = asmSolids(id, { ...defaultParams(g), ...params }, 3);
  if (!s || s === 'pending' || !s.length) throw new Error(`${id}: no assembly`);
  return s.map((x) => ({ key: x.key, polys: x.polys.map((p) => p.map((q) => [q.x, q.y] as Pt)), pose: x.pose, th: x.th }));
}

/** A flat part as a cut piece, fitted into the box */
function piece(polys: Poly[], box: Box = ROOM): string {
  return plate(thinAll(fitMap(polys, box)(polys), 0.18));
}

/** Flat plates of an assembly seen from above (x to the right, the back at the top) */
const fromAbove = (ps: KeyPlate[]): Poly[][] => ps.map((p) => p.polys.map((poly) => poly.map(([x, y]) => [p.pose.o[0] + x * p.pose.u[0] + y * p.pose.v[0], -(p.pose.o[1] + x * p.pose.u[1] + y * p.pose.v[1])] as Pt)));

const centre = (ps: Poly[]): Pt => {
  const b = boundsOf(ps);
  return [b.x + b.w / 2, b.y + b.h / 2];
};

// ---------- Mechanics ----------

function gear() {
  return piece(parts('gear', { teeth: 14, module: 3, boreDia: 9, kerf: 0 })[0].polys, { x: 17, y: 8, w: 86, h: 84 });
}

/** The rack with a pinion (helper outline) rolling on its pitch line */
function rack() {
  const m = 4,
    back = 9,
    z = 9;
  const r = parts('rack', { teeth: 6, module: m, back, kerf: 0 })[0].polys;
  const rb = boundsOf(r);
  const pitchY = rb.y + rb.h - (back + 1.25 * m);
  // A gap of the rack: half way between two neighbouring tooth tips, nearest to the middle
  const tips = r[0].filter(([, y]) => y < rb.y + 0.05).map((p) => p[0]).sort((a, b) => a - b);
  const mids: number[] = [];
  for (let i = 1; i < tips.length; i++) if (tips[i] - tips[i - 1] > m) mids.push((tips[i] + tips[i - 1]) / 2);
  const gapX = mids.reduce((best, x) => (Math.abs(x) < Math.abs(best) ? x : best), mids[0] ?? 0);
  // The pinion with one tooth pointing straight down into that gap
  let pin = parts('gear', { teeth: z, module: m, boreDia: 8, kerf: 0 })[0].polys;
  const far = pin[0].reduce((best, p) => (Math.hypot(p[0], p[1]) > Math.hypot(best[0], best[1]) ? p : best), pin[0][0]);
  pin = moveAll(turnAll(pin, 90 - (Math.atan2(far[1], far[0]) * 180) / Math.PI), gapX, pitchY - (m * z) / 2);
  const fit = fitMap([...r, ...pin], { x: 8, y: 10, w: 104, h: 84 });
  return area('g', thinAll(fit(pin), 0.18)) + plate(thinAll(fit(r), 0.18));
}

/** A timing pulley with its belt */
function pulley() {
  const p = parts('pulley', { profile: 'gt2_5', teeth: 14, boreDia: 6, kerf: 0 })[0].polys;
  const q = thinAll(fitMap(p, { x: 10, y: 20, w: 62, h: 62 })(p), 0.18);
  const [cx, cy] = centre(q);
  const R = boundsOf(q).w / 2 + 0.6;
  const belt: Poly = [[112, cy - R], ...arcPts(cx, cy, R, -90, -270, R, 18), [112, cy + R]];
  return plate(q) + lines('r', [belt]);
}

/** A disc cam lifting its roller follower */
function cam() {
  const p = parts('cam', { baseRadius: 18, lift: 9, boreDia: 7, kerf: 0 })[0].polys;
  const q = thinAll(fitMap(p, { x: 20, y: 34, w: 80, h: 62 })(p), 0.18);
  const [cx] = centre([q[1] ?? q[0]]);
  // Highest point of the outline above the shaft
  let top = Infinity;
  const o = q[0];
  for (let i = 0; i < o.length; i++) {
    const a = o[i],
      b = o[(i + 1) % o.length];
    if ((a[0] - cx) * (b[0] - cx) <= 0 && a[0] !== b[0]) top = Math.min(top, a[1] + ((b[1] - a[1]) * (cx - a[0])) / (b[0] - a[0]));
  }
  const rr = 6.5;
  return rect('m', cx - 2.6, 3, 5.2, top - rr - 3) + circle('m', cx, top - rr - 0.6, rr) + circle('d', cx, top - rr - 0.6, 1.7) + plate(q);
}

function gearpair() {
  const ps = fromAbove(plates('gearpair', { teeth1: 9, teeth2: 15, module: 3, plate: false, boreDia1: 6, boreDia2: 8, kerf: 0 }));
  const fit = fitMap(ps.flat(), { x: 8, y: 14, w: 104, h: 76 });
  return ps.map((p) => plate(thinAll(fit(p), 0.18))).join('');
}

// ---------- Boxes and furniture ----------

const box = () => isoPicture(plates('box', { width: 100, depth: 80, height: 56, thickness: 6, finger: 16, top: 'open', kerf: 0 }));

const boxDivided = () =>
  isoPicture(plates('box-divided', { width: 116, depth: 84, height: 44, thickness: 5, finger: 15, top: 'open', compartmentsX: 3, compartmentsY: 2, dividerDrop: 8, kerf: 0 }), ROOM, { yaw: 30, pitch: 40 });

/** The drawer pulled half out of its carcass */
function drawer() {
  const ps = plates('drawer', { width: 104, height: 58, depth: 92, thickness: 5, finger: 14, carcass: true, front: 'overlay', handle: 'slot', handleWidth: 34, handleHeight: 11, kerf: 0 });
  const out = ps.map((p) => (p.key.startsWith('c') ? p : { ...p, pose: { ...p.pose, o: [p.pose.o[0], p.pose.o[1] - 44, p.pose.o[2]] } as Pose }));
  return isoPicture(out, ROOM, { yaw: 38, pitch: 28 });
}

const insert = () => isoPicture(plates('insert', { width: 120, depth: 92, height: 36, thickness: 5, cellsX: 3, cellsY: 2, kerf: 0 }), ROOM, { yaw: 32, pitch: 38 });

const shelf = () => isoPicture(plates('shelf', { width: 110, depth: 54, height: 124, thickness: 6, shelves: 3, bottomGap: 14, topGap: 12, overhang: 9, kerf: 0 }), ROOM, { yaw: 34, pitch: 22 });

/** A box seen from the side, its lid swinging on the hinge pin */
function lidhinge() {
  const px = 87.5,
    py = 48.5;
  const body: Poly = [[26, 52], [31, 52], [31, 87], [83, 87], [83, 52], [88, 52], [88, 92], [26, 92]];
  const lid = rectPts(22, py - 2.5, px - 22 + 2.5, 5);
  const sweep = arcPts(px, py, 52, 186, 214);
  return (
    area('g', [lid]) +
    plate([body], 'w2') +
    plate([turn(lid, 36, px, py)]) +
    circle('w', px, py, 6.2) +
    circle('d', px, py, 1.9) +
    lines('a', [sweep, ...arrow(sweep[sweep.length - 2], sweep[sweep.length - 1]).slice(1)])
  );
}

// ---------- 3D slot-together models ----------

/** Stacked sheets following the outline of a 3D model */
function stack() {
  const cx = 60,
    th = 6.4;
  const rx = [41, 38, 32.5, 25, 16.5, 8];
  let out = lines('g', [arcPts(cx, 91, 46, 180, 360, 71, 20)]);
  rx.forEach((r, i) => {
    const cy = 81 - i * 10.4,
      ry = r * 0.34;
    out += ellipse('e2', cx, cy + th, r, ry) + rect('e2', cx - r, cy, 2 * r, th) + ellipse(i % 2 ? 'w2' : 'w', cx, cy, r, ry);
  });
  return out;
}

/** Three sheets behind each other, each with a larger window: a shadow box */
function multilayer() {
  const sheet = (x: number, y: number, hole: Poly[], face: string) => plate([rectPts(x, y, 60, 60), ...hole], face, 2.2);
  return (
    sheet(42, 9, [], 'w3') +
    area('b', [starPts(54.5, 55, 9, 3.9, 5)]) +
    sheet(30, 20, [circlePts(60, 50, 19, 26)], 'w2') +
    sheet(18, 31, [circlePts(48, 61, 25, 30)], 'w')
  );
}

/** Ribs slotted across a spine */
function ribs() {
  const L = 62;
  const h = (x: number) => 36 * Math.sqrt(Math.max(0, 1 - (x / L) ** 2)) * (1 + (0.18 * x) / L);
  const arch = (w: number, top: number, n = 12): Poly => [...arcPts(0, 0, w, 180, 360, top, n), [w, 3], [-w, 3]];
  const out: Plate[] = [];
  // Spine: stands along X in the middle
  const spine: Poly = [];
  for (let i = 0; i <= 24; i++) {
    const x = -L + 3 + ((2 * L - 6) * i) / 24;
    spine.push([x, -Math.max(2, h(x) - 6)]);
  }
  spine.push([L - 3, 3], [-L + 3, 3]);
  out.push({ polys: [spine], pose: { o: [0, -2, 0], u: [1, 0, 0], v: [0, 0, -1], n: [0, 1, 0] }, th: 4 });
  for (const x of [-46, -31, -16, -1, 14, 29, 44]) {
    const top = h(x);
    out.push({ polys: [arch(13 + 0.52 * top, top)], pose: { o: [x - 2, 0, 0], u: [0, 1, 0], v: [0, 0, -1], n: [1, 0, 0] }, th: 4 });
  }
  return isoPicture(out, { x: 6, y: 12, w: 108, h: 82 }, { yaw: 52, pitch: 24 });
}

const discsphere = () => isoPicture(plates('discsphere', { diameter: 120, shape: 'cube', overlap: 70, thickness: 3, topHole: 0, kerf: 0 }), { x: 14, y: 6, w: 92, h: 92 }, { yaw: 28, pitch: 26 }, 1.1);

// ---------- Sketches with relations ----------

const NODE = 2.3;
const SKETCH: Poly = [[30, 70], [30, 30], [54, 30], [54, 50], [90, 50], [90, 70]];
/** A dimension: the line with arrows, its two extension lines and the number */
function dimension(a: Pt, b: Pt, off: number, text: string): string {
  const y = Math.max(a[1], b[1]) + off;
  const mid = (a[0] + b[0]) / 2,
    w = labelWidth(text, 6);
  return (
    lines('at', [[[a[0], a[1] + 3], [a[0], y + 3]], [[b[0], b[1] + 3], [b[0], y + 3]], ...arrow([mid - w / 2 - 3, y], [a[0], y], 3.4), ...arrow([mid + w / 2 + 3, y], [b[0], y], 3.4)]) +
    lines('at', label(text, mid - w / 2, y - 3, 6))
  );
}
function sketchLines(pts: Poly) {
  return area('i', [pts]) + pts.map(([x, y]) => circle('af', x, y, NODE)).join('');
}
/** A dimensioned outline with a right-angle relation */
function sketch() {
  return sketchLines(SKETCH) + line('at', [30, 62], [38, 62], [38, 70]) + line('at', [46, 30], [46, 38], [54, 38]) + dimension([30, 70], [90, 70], 14, '60');
}
/** An ordinary shape becomes a sketch that carries dimensions */
function sketchconv() {
  const src: Poly = [[10, 64], [10, 34], [26, 34], [26, 48], [42, 48], [42, 64]];
  const dst = move(src, 62, 0);
  return plate([src]) + lines('a', arrow([47, 49], [61, 49])) + sketchLines(dst) + dimension([72, 64], [104, 64], 12, '32');
}
/** A freehand loop drawn around two shapes joins them into one */
function shaper() {
  const a = rectPts(24, 40, 44, 34),
    b = circlePts(74, 48, 21, 30);
  const loop = smooth([[15, 54], [20, 32], [46, 28], [72, 19], [98, 34], [102, 58], [86, 77], [52, 83], [24, 82]], true, 5);
  return area('e2', moveAll([a], 1.1, 1.8)) + area('e2', moveAll([b], 1.1, 1.8)) + area('o2', [a]) + area('o2', [b]) + area('w ns', [a]) + area('w ns', [b]) + area('ad', [loop]) + area('af', [starPts(101, 18, 7, 2.6, 4)]);
}

// ---------- Joints and bending ----------

/** Two boards with matching fingers, about to be pushed together */
function joint() {
  const g = 6;
  const a: Poly = [[12, 24], [58, 24], [58, 36], [50, 36], [50, 48], [58, 48], [58, 60], [50, 60], [50, 72], [58, 72], [58, 84], [12, 84]];
  const b: Poly = [[58 + g, 24], [108, 24], [108, 84], [58 + g, 84], [58 + g, 72], [50 + g, 72], [50 + g, 60], [58 + g, 60], [58 + g, 48], [50 + g, 48], [50 + g, 36], [58 + g, 36]];
  return plate([a]) + plate([b], 'w2') + lines('a', [...arrow([30, 14], [46, 14]), ...arrow([92, 14], [76, 14])]);
}

/** A board with the cut pattern that lets it bend (computed by the living hinge tool) */
function hinge() {
  const zone: Obj = { id: 1, m: translate(0, 0), layer: 0, shape: { kind: 'rect', w: 46, h: 56, r: 0 } };
  const r = computeHinge([zone], { ...DEFAULT_HINGE, kind: 'straight', cutLength: 19, bridge: 5, spacing: 6.4, margin: 4.5, orient: 'vertical' });
  if (r.error || !r.subs.length) throw new Error(`hinge: ${r.error}`);
  const cuts = flat(r.subs, true);
  const board = roundRectPts(-30, 0, 106, 56, 4);
  const fit = fitMap([board], { x: 7, y: 20, w: 106, h: 62 });
  return plate(fit([board])) + lines('c', fit(cuts));
}

/** A slot widened to the thickness of the board that goes into it */
function slots() {
  const body: Poly = [[14, 42], [51, 42], [51, 72], [69, 72], [69, 42], [106, 42], [106, 92], [14, 92]];
  return (
    plate([body]) +
    lines('g', [[[55, 42], [55, 72]], [[65, 42], [65, 72]]]) +
    plate([rectPts(52.5, 6, 15, 46)], 'w2') +
    lines('at', [[[51, 77], [51, 85]], [[69, 77], [69, 85]], ...arrow([58, 81], [51, 81], 3.2), ...arrow([62, 81], [69, 81], 3.2)])
  );
}

// ---------- Copy and arrange ----------

/** A disc filled with a honeycomb pattern */
function patternfill() {
  const cx = 60,
    cy = 51,
    R = 39,
    r = 7.2;
  const cells: Poly[] = [];
  for (let row = -5; row <= 5; row++)
    for (let col = -5; col <= 5; col++) {
      const x = cx + (col + (row % 2 ? 0.5 : 0)) * r * Math.sqrt(3),
        y = cy + row * r * 1.5;
      const hex = arcPts(x, y, r - 0.9, -90, 270, r - 0.9, 6).slice(0, 6);
      if (hex.every((p) => Math.hypot(p[0] - cx, p[1] - cy) < R - 2.6)) cells.push(hex);
    }
  return plate([circlePts(cx, cy, R, 44)]) + area('bl', cells);
}

const tagAt = (x: number, y: number, w: number, h: number): Poly[] => [roundRectPts(x, y, w, h, Math.min(w, h) * 0.28), circlePts(x + h * 0.42, y + h / 2, h * 0.14, 10)];

/** One piece copied in columns and rows */
function gridarray() {
  let out = '';
  for (let row = 0; row < 3; row++)
    for (let col = 0; col < 3; col++) {
      const t = tagAt(12 + col * 34.5, 13 + row * 28, 27, 19);
      out += plate(t, row || col ? 'w2' : 'w', 1.5);
      if (!row && !col) out += area('a', [roundRectPts(9.5, 10.5, 32, 24, 7)]);
    }
  return out;
}

/** One piece copied around a centre */
function circarray() {
  const cx = 60,
    cy = 52;
  const petal: Poly = smooth([[cx, cy - 15], [cx + 7.5, cy - 27], [cx, cy - 41], [cx - 7.5, cy - 27]], true, 5);
  let out = area('g', [circlePts(cx, cy, 28, 36)]) + lines('at', [[[cx - 4, cy], [cx + 4, cy]], [[cx, cy - 4], [cx, cy + 4]]]);
  for (let i = 7; i >= 0; i--) out += plate([turn(petal, i * 45, cx, cy)], i ? 'w2' : 'w', 1.4);
  return out + area('a', [scaleAll([petal], 1.24, cx, cy - 28)[0]]);
}

/** Parts packed closely on a sheet */
function nest() {
  const partsOnSheet: Poly[][] = [
    [[[16, 17], [51, 17], [51, 30], [29, 30], [29, 61], [16, 61]]],
    [circlePts(42, 46, 11.5, 22), circlePts(42, 46, 4, 10)],
    [[[55, 17], [104, 17], [55, 50]]],
    [[[104, 22], [104, 55], [60, 55]]],
    [roundRectPts(16, 65, 31, 21, 5)],
    [starPts(63, 73, 12.5, 5.6, 5)],
    [rectPts(80, 59, 24, 12)],
    [rectPts(80, 74, 24, 12)],
  ];
  return plate([rectPts(11, 12, 98, 79)], 'w3', 2.2) + partsOnSheet.map((p) => area('w', p)).join('');
}

/** The camera finds the blanks on the bed and the design lands on each of them */
function workpiece() {
  const blank = (x: number, y: number, deg: number) => plate([turn(roundRectPts(x - 15, y - 15, 30, 30, 5), deg, x, y)], 'w', 1.6) + area('b', [turn(starPts(x, y, 9, 3.9, 5), deg, x, y)]);
  return (
    lines('g', [[[50, 20], [8, 96]], [[70, 20], [112, 96]]]) +
    rect('m', 47, 5, 26, 15, 3) +
    circle('d', 60, 12.5, 4.6) +
    blank(27, 60, -14) +
    blank(62, 72, 9) +
    blank(93, 52, 31)
  );
}

/** Lettering bent into an arch */
function warp() {
  const cx = 60,
    cy = 100,
    r0 = 46,
    hgt = 24;
  const text = 'ABC',
    w = labelWidth(text, hgt, 0.3);
  const bend = (p: Pt): Pt => {
    const a = ((p[0] - w / 2) / (r0 + hgt / 2)) * 0.98 - Math.PI / 2,
      r = r0 + hgt - p[1];
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  };
  // More points per stroke, so straight strokes follow the arch
  const dense = label(text, 0, 0, hgt, 0.3).map((s) => {
    const out: Poly = [];
    for (let i = 0; i < s.length - 1; i++) for (let k = 0; k < 6; k++) out.push([s[i][0] + ((s[i + 1][0] - s[i][0]) * k) / 6, s[i][1] + ((s[i + 1][1] - s[i][1]) * k) / 6]);
    out.push(s[s.length - 1]);
    return out.map(bend);
  });
  const band: Poly = [...arcPts(cx, cy, r0 - 9, -143, -37, r0 - 9, 16), ...arcPts(cx, cy, r0 + hgt + 9, -37, -143, r0 + hgt + 9, 16)];
  return plate([band]) + lines('bb', dense);
}

function jigPlate(filled: boolean) {
  const slots: Pt[] = [];
  for (let row = 0; row < 2; row++) for (let col = 0; col < 3; col++) slots.push([20 + col * 28.5, 24 + row * 31]);
  let out = plate([roundRectPts(12, 14, 96, 76, 5), ...slots.map(([x, y]) => roundRectPts(x, y, 23, 15, 4))], 'w', 2);
  slots.forEach(([x, y], i) => {
    out += lines('bt', label(String(i + 1), x + 9.5, y + 17.5, 5.4));
    if (filled) out += plate(tagAt(x + 1.6, y + 1.6, 19.8, 11.8), 'w2', 1) + line('bl', [x + 10, y + 7.5], [x + 18, y + 7.5]);
  });
  for (const [x, y] of [[17.5, 19.5], [102.5, 19.5], [17.5, 84.5]] as Pt[]) out += circle('bt', x, y, 2.2);
  return out;
}
/** A holding plate with cut-outs for a batch of blanks */
const jig = () => jigPlate(false);
/** The design copied into every slot of the jig */
const jigfill = () => jigPlate(true) + area('a', [roundRectPts(18, 22, 27, 19, 5)]);

// ---------- Text and data ----------

/** A real QR code engraved on a tag */
function qr() {
  const q = qrMatrix('KIZAMUBEAM', 'M');
  if (!q) throw new Error('qr');
  const size = 62,
    k = size / q.n,
    x0 = 60 - size / 2,
    y0 = 52 - size / 2;
  const runs: Poly[] = [];
  for (let r = 0; r < q.n; r++) {
    let c = 0;
    while (c < q.n) {
      if (!q.dark(r, c)) {
        c++;
        continue;
      }
      let e = c;
      while (e < q.n && q.dark(r, e)) e++;
      runs.push(rectPts(x0 + c * k, y0 + r * k, (e - c) * k, k));
      c = e;
    }
  }
  return plate([roundRectPts(21, 13, 78, 78, 6)]) + area('b', runs);
}

/** A real EAN-13 code with its digits */
function barcode() {
  const r = encodeLinear('ean13', '4006381333931');
  if (!r.ok) throw new Error(r.error);
  const x0 = 17.5,
    k = 85 / r.code.total;
  const rects = bars(r.code).map(([a, b, guard]) => rectPts(x0 + a * k, 29, (b - a) * k, guard ? 40 : 34));
  const digits = r.code.value;
  return (
    plate([roundRectPts(10, 20, 100, 62, 5)]) +
    area('b', rects) +
    lines('bt', [...label(digits.slice(1, 7), x0 + 6 * k, 66.5, 5.6, 0.42), ...label(digits.slice(7), x0 + 52 * k, 66.5, 5.6, 0.42)])
  );
}

/** A letter with serifs next to samples in other weights and slants */
function fonts() {
  const A: Poly[] = [
    [[0, 40], [0, 37.4], [3.3, 36.8], [13, 0], [17.6, 0], [27.4, 36.8], [30.6, 37.4], [30.6, 40], [18, 40], [18, 37.4], [21.3, 36.8], [19.2, 28.6], [9.3, 28.6], [7.1, 36.8], [10.3, 37.4], [10.3, 40]],
    [[10.2, 25.4], [18.3, 25.4], [14.3, 10.2]],
  ];
  const big = moveAll(scaleAll(A, 1.42), 17, 22);
  const slant = (ps: Poly[], y0: number) => ps.map((p) => p.map(([x, y]) => [x - (y - y0) * 0.28, y] as Pt));
  return (
    plate([roundRectPts(9, 11, 102, 82, 6)]) +
    area('b', big) +
    lines('bl', label('ABC', 70, 24, 11, 0.3)) +
    lines('bb', label('ABC', 70, 46, 11, 0.3)) +
    lines('bl', slant(label('ABC', 73, 68, 11, 0.3), 79))
  );
}

/** Tags that count up: a serial number as variable text */
function vartext() {
  let out = '';
  ['001', '002', '003'].forEach((s, i) => {
    const x = 11 + i * 14,
      y = 13 + i * 27;
    const tx = x + 23;
    out += plate(tagAt(x, y, 70, 24), 'w', 1.6) + lines('bl', label(s.slice(0, 2), tx, y + 6.5, 11, 0.3)) + lines('a', label(s[2], tx + labelWidth('00', 11, 0.3) + 3.3, y + 6.5, 11, 0.3));
  });
  return out;
}

/** The proof of a batch: every piece as it would be engraved, and the one with the empty field is flagged */
function batchproof() {
  const rows: [string, boolean][] = [
    ['ANNA', true],
    ['BRUNO', true],
    ['', false],
  ];
  let out = '';
  rows.forEach(([name, ok], i) => {
    const y = 11 + i * 29;
    out += plate(tagAt(12, y, 72, 22), 'w', 1.6);
    out += name ? lines('bl', label(name, 29, y + 6, 10, 0.3)) : line('g', [29, y + 13], [62, y + 13]);
    out += ok
      ? lines('a', [[[92, y + 11], [97, y + 16], [106, y + 4]]])
      : circle('x', 99, y + 11, 8) + lines('x', [[[95.5, y + 7.5], [102.5, y + 14.5]], [[102.5, y + 7.5], [95.5, y + 14.5]]]);
  });
  return out;
}

const nameTag = (x: number, y: number, len: number) => plate(tagAt(x, y, 42, 20), 'w', 1.4) + line('bb', [x + 15, y + 10], [x + 15 + len, y + 10]);

/** Every row of a table becomes a tag of its own */
function series() {
  let out = rect('k', 9, 20, 42, 60, 2.5) + area('af', [[[9, 30], [9, 22.5], [11.5, 20], [48.5, 20], [51, 22.5], [51, 30]]]);
  for (let i = 1; i < 4; i++) out += line('g', [9, 30 + i * 12.5], [51, 30 + i * 12.5]);
  out += line('g', [27, 30], [27, 80]);
  [[13, 10], [13, 7], [13, 9], [13, 6]].forEach(([x, len], i) => (out += line('dl', [x, 36.5 + i * 12.5], [x + len, 36.5 + i * 12.5]) + line('dl', [31, 36.5 + i * 12.5], [31 + [14, 9, 16, 11][i], 36.5 + i * 12.5])));
  return out + lines('a', arrow([54, 50], [65, 50])) + nameTag(68, 12, 20) + nameTag(68, 42, 14) + nameTag(68, 72, 23);
}

/** A template sheet with its key fob, ready for a new project */
function newtemplate() {
  const fob: Poly[] = [roundRectPts(37, 24, 46, 28, 9), circlePts(47, 38, 3.4, 12)];
  return (
    area('k', [[[27, 9], [79, 9], [93, 23], [93, 95], [27, 95]]]) +
    area('k', [[[79, 9], [79, 23], [93, 23]]]) +
    plate(fob, 'w', 1.4) +
    line('bl', [55, 38], [75, 38]) +
    rect('g', 35, 62, 50, 8, 2) +
    rect('g', 35, 76, 32, 8, 2) +
    circle('af', 93, 82, 11) +
    lines('kl', [[[87.5, 82], [98.5, 82]], [[93, 76.5], [93, 87.5]]])
  );
}

/** The parameters of a template on the left, the part that follows them on the right */
function filltemplate() {
  const slider = (y: number, at: number) => line('dl', [15, y], [49, y]) + circle('af', 15 + at, y, 3.4);
  return (
    rect('k', 9, 15, 46, 74, 3) +
    line('dl', [15, 25], [33, 25]) +
    slider(34, 23) +
    line('dl', [15, 47], [29, 47]) +
    slider(56, 9) +
    line('dl', [15, 69], [37, 69]) +
    rect('k', 15, 74, 34, 9, 2) +
    lines('a', arrow([58, 52], [68, 52])) +
    plate([roundRectPts(71, 30, 40, 44, 9), circlePts(91, 40, 3.6, 12)], 'w', 1.6) +
    line('bb', [79, 54], [103, 54]) +
    line('bl', [83, 63], [99, 63])
  );
}

// ---------- Image ----------

const heart = (): Poly => {
  const out: Poly = [];
  for (let i = 0; i < 48; i++) {
    const t = (i / 48) * 2 * Math.PI;
    out.push([60 + 2.5 * 16 * Math.sin(t) ** 3, 48 - 2.5 * (13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  return out;
};

/** Pixels on the left, the traced outline with its nodes on the right */
function trace() {
  const h = heart();
  const px = 6.2;
  const pixels: Poly[] = [];
  for (let x = 14; x < 60 - px / 2; x += px) for (let y = 6; y < 98; y += px) if (inside([x + px / 2, y + px / 2], [h])) pixels.push(rectPts(x, y, px - 0.5, px - 0.5));
  const right = h.filter((p) => p[0] >= 60);
  const nodes = [0, 5, 10, 15, 20, 24].map((i) => right[Math.min(i, right.length - 1)]);
  return area('if', pixels) + line('g', [60, 6], [60, 98]) + lines('a', [[[60, right[0][1]], ...right, [60, right[right.length - 1][1]]]]) + nodes.map(([x, y]) => rect('k', x - 2.4, y - 2.4, 4.8, 4.8)).join('');
}

/** A photo: the background is still there on the left and removed on the right */
function bgremove() {
  let checks = '';
  for (let i = 0; i < 6; i++) for (let j = 0; j < 10; j++) if ((i + j) % 2) checks += rect('m ns', 60 + i * 7.67, 12 + j * 8, 7.67, 8);
  const bust: Poly = [...arcPts(60, 96, 31, 180, 360, 34, 14)];
  return (
    rect('k', 14, 12, 92, 80, 3) +
    fade(rect('d', 14.5, 12.5, 45.5, 79), 0.32) +
    checks +
    area('w2', [bust.map(([x, y]) => [x, Math.min(y, 91.5)] as Pt)]) +
    circle('w', 60, 43, 15) +
    line('ad', [60, 8], [60, 96])
  );
}

/** A photo in soft tones on the left and as laser dots on the right */
function adjust() {
  let out = rect('k', 14, 12, 92, 80, 3);
  [0.22, 0.42, 0.64, 0.86].forEach((o, i) => (out += fade(rect('d', 14.5, 12.5 + i * 19.75, 45.5, 19.75), o)));
  for (let row = 0; row < 8; row++) for (let col = 0; col < 5; col++) out += circle('d', 65.6 + col * 8.6 + (row % 2 ? 0 : 0), 17.4 + row * 9.9, 1 + (row / 7) * 3.1);
  return out + line('a', [60, 8], [60, 96]) + circle('af', 60, 52, 4.4) + lines('kl', [[[58.2, 52], [61.8, 52]]]);
}

// ---------- Laser and calibration ----------

/** A grid of test squares, darker with more power and less speed */
function materialtest() {
  let out = plate([roundRectPts(14, 9, 92, 84, 5)]);
  for (let row = 0; row < 4; row++) for (let col = 0; col < 4; col++) out += fade(rect('b', 31 + col * 17.6, 15 + row * 15.6, 14, 12), 0.14 + (0.86 * (col + (3 - row))) / 6);
  return out + lines('at', [...arrow([31, 84], [98, 84], 3.4), ...arrow([23, 76], [23, 16], 3.4)]);
}

/** A photo of the test with the best square picked */
function testphoto() {
  let out = rect('k', 15, 8, 90, 88, 5) + area('w', [rectPts(22, 15, 76, 62)]);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) out += fade(rect('b', 29 + col * 22.5, 21 + row * 18, 17, 13.5), 0.2 + (0.8 * (col + (2 - row))) / 4);
  return out + circle('a', 60, 45.7, 13.5) + area('d', [[[64, 50], [64, 68], [69, 63.5], [72.5, 71], [75.5, 69.6], [72, 62.3], [78, 62]]]) + circle('dl', 60, 86.5, 3.6);
}

/** The beam narrows to its focus on a tilted board; the line is finest where it is sharp */
function focustest() {
  const top = (x: number) => 87 - (x - 12) * 0.25;
  const band: Poly = [];
  for (let x = 16; x <= 104; x += 8) band.push([x, top(x) - 0.4 - (Math.abs(x - 60) / 44) * 2.6]);
  for (let x = 104; x >= 16; x -= 8) band.push([x, top(x) + 0.6]);
  return (
    area('m', [[[47, 5], [73, 5], [73, 23], [66.5, 31], [53.5, 31], [47, 23]]]) +
    fade(area('af', [[[54.5, 31], [65.5, 31], [60.7, top(60) - 1], [59.3, top(60) - 1]]]), 0.4) +
    plate([[[12, top(12)], [108, top(108)], [108, 96], [12, 96]]], 'w', 1.2) +
    area('b', [band]) +
    lines('a', [[[60, top(60) - 8], [60, top(60) - 2]], [[52, 44], [68, 44]]])
  );
}

/** A printed sticker, its registration marks and the cut around it */
function printcut() {
  const star = starPts(62, 53, 24, 11.5, 5);
  const mark = (x: number, y: number) => circle('dl', x, y, 3.6) + lines('dl', [[[x - 6, y], [x + 6, y]], [[x, y - 6], [x, y + 6]]]);
  return rect('k', 15, 8, 90, 88, 2.5) + area('af', [star]) + area('x', [smooth(scaleAll([starPts(62, 53, 31, 17.5, 5)], 1, 62, 53)[0], true, 3)]) + mark(27, 20) + mark(93, 20) + mark(27, 84);
}

/** A test square to measure and a comb of stepped slots to try the fit */
function calibrate() {
  const comb: Poly = [[10, 58]];
  let x = 18;
  [3, 4.2, 5.4, 6.6, 7.8].forEach((w) => {
    comb.push([x, 58], [x, 74], [x + w, 74], [x + w, 58]);
    x += w + 11.4;
  });
  comb.push([110, 58], [110, 94], [10, 94]);
  return (
    plate([rectPts(14, 12, 30, 30)]) +
    lines('at', [[[14, 4], [14, 9]], [[44, 4], [44, 9]], ...arrow([24, 6.5], [14, 6.5], 3), ...arrow([34, 6.5], [44, 6.5], 3)]) +
    lines('bt', label('20', 22.5, 22, 10, 0.3)) +
    plate([comb]) +
    plate([rectPts(48.8, 40, 5.2, 30)], 'w2', 1.2) +
    lines('bt', [...label('1', 17.5, 81, 5.4), ...label('2', 32.6, 81, 5.4), ...label('3', 48.6, 81, 5.4), ...label('4', 65.8, 81, 5.4), ...label('5', 84.2, 81, 5.4)])
  );
}

/** An outline with a gap and a line cut twice, both found by the check */
function check() {
  const outline: Poly = [[88, 30], [88, 82], [22, 82], [22, 22], [78, 22]];
  return (
    lines('i', [outline, [[40, 86.2], [70, 86.2]]]) +
    circle('x', 85, 24, 9.5) +
    circle('x', 55, 84, 9.5) +
    lines('a', [[[36, 50], [50, 65], [74, 36]]])
  );
}

/** The machine from above, and the steps of the setup wizard below */
function setup() {
  return (
    area('m', [roundRectPts(13, 8, 94, 62, 5), rectPts(22, 17, 76, 44)]) +
    rect('m', 22, 33, 76, 8) +
    rect('d', 51, 29, 16, 16, 2.5) +
    circle('xf', 59, 49.5, 2.1) +
    line('at', [34, 87], [86, 87]) +
    circle('af', 34, 87, 5.4) +
    circle('af', 60, 87, 5.4) +
    circle('k', 86, 87, 5.4) +
    lines('kl', [[[31.6, 87], [33.4, 89], [36.6, 85.2]], [[57.6, 87], [59.4, 89], [62.6, 85.2]]])
  );
}

/** A cup turning on the rollers of the rotary */
function rotary() {
  const body: Poly = [...arcPts(26, 43, 9, 90, 270, 24, 10), ...arcPts(96, 43, 9, -90, 90, 24, 10)];
  const turnArrow = arcPts(96, 43, 15, -62, 62, 31, 10);
  return (
    circle('m', 40, 83, 10) +
    circle('m', 80, 83, 10) +
    circle('d', 40, 83, 2.2) +
    circle('d', 80, 83, 2.2) +
    area('e2', moveAll([body], 0, 2)) +
    area('w', [body]) +
    ellipse('w2', 26, 43, 9, 24) +
    area('b', [starPts(62, 43, 13, 5.6, 5)]) +
    lines('bl', [[[44, 24], [44, 62]], [[80, 24], [80, 62]]]) +
    lines('a', [turnArrow, ...arrow(turnArrow[turnArrow.length - 2], turnArrow[turnArrow.length - 1]).slice(1)])
  );
}

/** A piece that plugs into the app: extensions */
function packs() {
  const s = 46,
    x = 22,
    y = 24,
    k = 7;
  const pieceOutline: Poly = [
    [x, y],
    [x + s, y],
    [x + s, y + s / 2 - k],
    ...bez([x + s, y + s / 2 - k], [x + s + 15, y + s / 2 - k - 5], [x + s + 15, y + s / 2 + k + 5], [x + s, y + s / 2 + k], 8),
    [x + s, y + s],
    [x + s / 2 + k, y + s],
    ...bez([x + s / 2 + k, y + s], [x + s / 2 + k + 5, y + s - 15], [x + s / 2 - k - 5, y + s - 15], [x + s / 2 - k, y + s], 8),
    [x, y + s],
  ];
  return plate([pieceOutline], 'w', 2) + circle('af', 90, 78, 12) + lines('kl', [[[84, 78], [96, 78]], [[90, 72], [90, 84]]]);
}

export const ART: Record<string, () => string> = {
  gear, rack, pulley, cam, gearpair,
  box, 'box-divided': boxDivided, drawer, insert, shelf, lidhinge,
  stack, multilayer, ribs, discsphere,
  sketch, sketchconv, 'tool:shaper': shaper,
  'tool:joint': joint, hinge, slots,
  patternfill, gridarray, circarray, nest, workpiece, warp, jig, jigfill,
  qr, barcode, fonts, vartext, batchproof, series, newtemplate, filltemplate,
  trace, bgremove, adjust,
  materialtest, testphoto, focustest, printcut, calibrate, check, setup, rotary,
  packs,
};
