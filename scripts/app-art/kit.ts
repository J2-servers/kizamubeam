// Kit for the example pictures on the toolbox tiles (scripts/build-app-art.ts): points, basic shapes, fitting
// real generator geometry into the picture and writing compact SVG. Drawn in a field of 120 × 104 units, the
// shape of a tile. Not part of the app, like scripts/library/kit.ts.
//
// A picture is a list of SVG elements whose class says what the element is; src/style.css gives every class its
// colours (light and dark theme), so the pictures carry no colours of their own:
//   w / w2 / w3  cut piece: face in the light, in half shade, in shade
//   b            engraved area (burn)            bl  engraved line
//   c            cut line without a face         g   helper line (dashed)
//   a            accent line (what the tool does) af  accent area
//   k            paper, photo or screen          d   dark detail
//   m            machine part (neutral)          s   soft shadow under a piece
import type { SubPath } from '../../src/model';
import { IDENT } from '../../src/model';
import { flattenSub, SCALE } from '../../src/clip';

export type Pt = [number, number];
export type Poly = Pt[];

/** Drawing field */
export const FW = 120;
export const FH = 104;

const num = (v: number) => {
  const s = (Math.round(v * 10) / 10).toString();
  return s === '-0' ? '0' : s;
};

// ---------- SVG ----------

/** Path data of polylines; the first pair moves, the rest are implied line-tos */
export function dOf(polys: Poly[], closed = true): string {
  return polys
    .filter((p) => p.length > 1)
    .map((p) => 'M' + p.map(([x, y]) => `${num(x)} ${num(y)}`).join(' ') + (closed ? 'Z' : ''))
    .join('');
}
/** Closed outlines (holes by the even-odd rule) */
export const area = (cls: string, polys: Poly[]) => (polys.length ? `<path class="${cls}" d="${dOf(polys)}"/>` : '');
/** Open lines */
export const lines = (cls: string, polys: Poly[]) => (polys.length ? `<path class="${cls}" d="${dOf(polys, false)}"/>` : '');
export const line = (cls: string, ...pts: Pt[]) => lines(cls, [pts]);
export const circle = (cls: string, cx: number, cy: number, r: number) => `<circle class="${cls}" cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"/>`;
export const ellipse = (cls: string, cx: number, cy: number, rx: number, ry: number) =>
  `<ellipse class="${cls}" cx="${num(cx)}" cy="${num(cy)}" rx="${num(rx)}" ry="${num(ry)}"/>`;
export const rect = (cls: string, x: number, y: number, w: number, h: number, r = 0) =>
  `<rect class="${cls}" x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${r ? ` rx="${num(r)}"` : ''}/>`;

// ---------- Points ----------

export const rectPts = (x: number, y: number, w: number, h: number): Poly => [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
export function arcPts(cx: number, cy: number, rx: number, a0: number, a1: number, ry = rx, n = 0): Poly {
  const steps = n || Math.max(4, Math.ceil(Math.abs(a1 - a0) / 12));
  const out: Poly = [];
  for (let i = 0; i <= steps; i++) {
    const a = ((a0 + ((a1 - a0) * i) / steps) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}
export const circlePts = (cx: number, cy: number, r: number, n = 32): Poly => arcPts(cx, cy, r, 0, 360, r, n).slice(0, -1);
export function roundRectPts(x: number, y: number, w: number, h: number, r: number): Poly {
  const q = Math.min(r, w / 2, h / 2);
  return [
    ...arcPts(x + w - q, y + q, q, -90, 0, q, 3),
    ...arcPts(x + w - q, y + h - q, q, 0, 90, q, 3),
    ...arcPts(x + q, y + h - q, q, 90, 180, q, 3),
    ...arcPts(x + q, y + q, q, 180, 270, q, 3),
  ];
}
export function starPts(cx: number, cy: number, ro: number, ri: number, n: number, a0 = -90): Poly {
  const out: Poly = [];
  for (let i = 0; i < n * 2; i++) {
    const a = ((a0 + (i * 180) / n) * Math.PI) / 180;
    const r = i % 2 ? ri : ro;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}
/** Cubic Bézier as points */
export function bez(p0: Pt, c1: Pt, c2: Pt, p1: Pt, n = 10): Poly {
  const out: Poly = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n,
      u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * p1[0],
      u * u * u * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * p1[1],
    ]);
  }
  return out;
}
/** Smooth closed or open outline through the points (Catmull-Rom) */
export function smooth(pts: Poly, closed = true, n = 6): Poly {
  const out: Poly = [];
  const N = pts.length;
  const at = (i: number) => (closed ? pts[((i % N) + N) % N] : pts[Math.max(0, Math.min(N - 1, i))]);
  for (let i = 0; i < (closed ? N : N - 1); i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(pts[N - 1]);
  return out;
}

// ---------- Moving ----------

export const move = (p: Poly, dx: number, dy: number): Poly => p.map(([x, y]) => [x + dx, y + dy]);
export const moveAll = (ps: Poly[], dx: number, dy: number): Poly[] => ps.map((p) => move(p, dx, dy));
export function turn(p: Poly, deg: number, cx = 0, cy = 0): Poly {
  const a = (deg * Math.PI) / 180,
    c = Math.cos(a),
    s = Math.sin(a);
  return p.map(([x, y]) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c]);
}
export const turnAll = (ps: Poly[], deg: number, cx = 0, cy = 0): Poly[] => ps.map((p) => turn(p, deg, cx, cy));
export const scaleAll = (ps: Poly[], k: number, cx = 0, cy = 0): Poly[] => ps.map((p) => p.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k] as Pt));

export function boundsOf(ps: Poly[]): { x: number; y: number; w: number; h: number } {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of ps)
    for (const [x, y] of p) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}
/** The usual room of a picture inside the field */
export const ROOM: Box = { x: 10, y: 9, w: 100, h: 86 };

/**
 * Map that fits the bounds of `all` into the box, keeping proportions and centring (or aligning with ax, ay
 * from 0 = left/top to 1 = right/bottom). Returns the map for further groups of the same drawing.
 */
export function fitMap(all: Poly[], box: Box = ROOM, ax = 0.5, ay = 0.5): (ps: Poly[]) => Poly[] {
  const b = boundsOf(all);
  const k = Math.min(box.w / (b.w || 1), box.h / (b.h || 1));
  const dx = box.x + (box.w - b.w * k) * ax - b.x * k;
  const dy = box.y + (box.h - b.h * k) * ay - b.y * k;
  return (ps) => ps.map((p) => p.map(([x, y]) => [x * k + dx, y * k + dy] as Pt));
}

// ---------- Real geometry ----------

/** Fewer points within a tolerance (Ramer-Douglas-Peucker); closed outlines keep their start */
export function thin(p: Poly, tol = 0.12): Poly {
  if (p.length < 4) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = p[a], [bx, by] = p[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    let best = -1, far = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i][0] - ax) * (by - ay) - (p[i][1] - ay) * (bx - ax)) / len;
      if (d > far) {
        far = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return p.filter((_, i) => keep[i]);
}
/** The same for a closed outline: split at the point farthest from the start, so both halves have two ends */
export function thinClosed(p: Poly, tol = 0.12): Poly {
  if (p.length < 5) return p;
  let far = 0,
    best = 0;
  for (let i = 1; i < p.length; i++) {
    const d = Math.hypot(p[i][0] - p[0][0], p[i][1] - p[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = thin(p.slice(0, far + 1), tol);
  const b = thin([...p.slice(far), p[0]], tol);
  return [...a.slice(0, -1), ...b.slice(0, -1)];
}
export const thinAll = (ps: Poly[], tol = 0.12) => ps.map((p) => thinClosed(p, tol)).filter((p) => p.length > 2);

/** Outlines of a generated part as points (mm, y down), closed sub-paths only unless open is set */
export function flat(subs: SubPath[], open = false): Poly[] {
  return subs
    .filter((sp) => (open ? !sp.closed : sp.closed) && sp.nodes.length > 1)
    .map((sp) => flattenSub(sp, IDENT).map((q) => [q.X / SCALE, q.Y / SCALE] as Pt));
}

// ---------- Pieces ----------

/** A flat cut piece seen from above: the dark cut edge below and to the right gives it its thickness */
export function plate(polys: Poly[], face = 'w', lift = 1.8): string {
  return area('e2', moveAll(polys, lift * 0.6, lift)) + area(face, polys);
}

/** The element with one more attribute, e.g. fade(…, 0.4) for a lighter engraving */
export const fade = (el: string, opacity: number) => el.replace(/^<(\w+) /, `<$1 opacity="${num(opacity)}" `);

/** Arrow from a to b as strokes: shaft and head (both ends with two = true) */
export function arrow(a: Pt, b: Pt, head = 4.2, two = false): Poly[] {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const tip = (p: Pt, dir: number): Poly => [
    [p[0] - head * Math.cos(dir - 0.5), p[1] - head * Math.sin(dir - 0.5)],
    p,
    [p[0] - head * Math.cos(dir + 0.5), p[1] - head * Math.sin(dir + 0.5)],
  ];
  return [[a, b], tip(b, ang), ...(two ? [tip(a, ang + Math.PI)] : [])];
}

/** Is the point inside the outlines (even-odd)? */
export function inside(pt: Pt, polys: Poly[]): boolean {
  let hit = false;
  for (const p of polys)
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
      const [xi, yi] = p[i],
        [xj, yj] = p[j];
      if (yi > pt[1] !== yj > pt[1] && pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
  return hit;
}

/** Small numerals and capitals as single-stroke lines (5 wide, 8 high), for labels inside a picture */
const GLYPH: Record<string, Poly[]> = {
  '0': [[[1, 0], [4, 0], [5, 1], [5, 7], [4, 8], [1, 8], [0, 7], [0, 1], [1, 0]]],
  '1': [[[1, 2], [3, 0], [3, 8]], [[1, 8], [5, 8]]],
  '2': [[[0, 1], [1, 0], [4, 0], [5, 1], [5, 3], [0, 8], [5, 8]]],
  '3': [[[0, 1], [1, 0], [4, 0], [5, 1], [5, 3], [4, 4], [2, 4]], [[4, 4], [5, 5], [5, 7], [4, 8], [1, 8], [0, 7]]],
  '4': [[[4, 8], [4, 0], [0, 5.5], [5, 5.5]]],
  '5': [[[5, 0], [0, 0], [0, 3.5], [4, 3.5], [5, 4.5], [5, 7], [4, 8], [1, 8], [0, 7]]],
  '6': [[[5, 1], [4, 0], [1, 0], [0, 1], [0, 7], [1, 8], [4, 8], [5, 7], [5, 5], [4, 4], [0, 4]]],
  '7': [[[0, 0], [5, 0], [2, 8]]],
  '8': [[[1, 4], [0, 3], [0, 1], [1, 0], [4, 0], [5, 1], [5, 3], [4, 4], [1, 4], [0, 5], [0, 7], [1, 8], [4, 8], [5, 7], [5, 5], [4, 4]]],
  '9': [[[5, 4], [1, 4], [0, 3], [0, 1], [1, 0], [4, 0], [5, 1], [5, 7], [4, 8], [1, 8], [0, 7]]],
  A: [[[0, 8], [2.5, 0], [5, 8]], [[1, 5.3], [4, 5.3]]],
  B: [[[0, 0], [0, 8], [3.6, 8], [5, 6.8], [5, 5.2], [3.6, 4], [0, 4]], [[0, 0], [3.3, 0], [4.5, 1.1], [4.5, 2.9], [3.3, 4]]],
  C: [[[5, 1.2], [3.8, 0], [1.2, 0], [0, 1.2], [0, 6.8], [1.2, 8], [3.8, 8], [5, 6.8]]],
  K: [[[0, 0], [0, 8]], [[5, 0], [0, 4.6]], [[1.9, 3.2], [5, 8]]],
  Z: [[[0, 0], [5, 0], [0, 8], [5, 8]]],
};
/** Text as line strokes at (x, y) = top left, h = letter height */
export function label(text: string, x: number, y: number, h: number, gap = 0.35): Poly[] {
  const k = h / 8;
  const out: Poly[] = [];
  let at = x;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (g) for (const stroke of g) out.push(stroke.map(([px, py]) => [at + px * k, y + py * k] as Pt));
    at += (ch === ' ' ? 3 : 5) * k + gap * h;
  }
  return out;
}
export const labelWidth = (text: string, h: number, gap = 0.35) => [...text].reduce((w, ch) => w + ((ch === ' ' ? 3 : 5) * h) / 8 + gap * h, -gap * h);
