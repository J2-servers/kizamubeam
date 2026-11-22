// Assembled plates in parallel projection for the toolbox pictures: every plate is an outline extruded by the
// material thickness, placed by its pose (the same data the 3D view and the assembly check use). Faces get one of
// three tones by their direction, cut edges the dark tone of a laser-cut edge, so finger joints show as they do on
// the real piece. Hidden parts are covered by drawing from the back to the front; plates that cross each other are
// cut along the crossing first, so each piece lies wholly in front of or behind the other plate.
import ClipperLib from 'clipper-lib';
import type { Pose, V3 } from '../../src/generators/pose';
import { area, type Box, fitMap, lines, type Poly, type Pt, ROOM, thin, thinAll, thinClosed } from './kit';

export interface Plate {
  /** Closed outlines in local coordinates (mm), holes by the even-odd rule */
  polys: Poly[];
  pose: Pose;
  th: number;
}
export interface View {
  /** Camera turned from the front towards the right side (degrees) */
  yaw: number;
  /** Camera height above the horizon (degrees) */
  pitch: number;
}
export const VIEW: View = { yaw: 36, pitch: 30 };

type Seam = [number, number, number];
interface Piece extends Plate {
  src: number;
  seams: Seam[];
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const at = (p: Pose, x: number, y: number, s: number): V3 => [
  p.o[0] + x * p.u[0] + y * p.v[0] + s * p.n[0],
  p.o[1] + x * p.u[1] + y * p.v[1] + s * p.n[1],
  p.o[2] + x * p.u[2] + y * p.v[2] + s * p.n[2],
];

function camera(v: View) {
  const a = (v.yaw * Math.PI) / 180,
    e = (v.pitch * Math.PI) / 180;
  // Direction of view: from the front right, looking down
  const f: V3 = [-Math.sin(a) * Math.cos(e), Math.cos(a) * Math.cos(e), -Math.sin(e)];
  const right = unit(cross(f, [0, 0, 1]));
  const up = cross(right, f);
  return { f, right, up };
}

/** Light from the upper left front: the top is brightest, the right side darkest */
const LIGHT = unit([-0.35, -0.55, 0.76]);
const tone = (n: V3) => {
  const t = dot(n, LIGHT);
  return t > 0.6 ? 1 : t > 0.15 ? 2 : 3;
};

// ---------- Cutting crossing plates ----------

const K = 1000;
const toPath = (p: Poly) => p.map(([x, y]) => ({ X: Math.round(x * K), Y: Math.round(y * K) }));
function clip(polys: Poly[], half: Poly): Poly[] {
  const c = new ClipperLib.Clipper();
  c.AddPaths(polys.map(toPath), ClipperLib.PolyType.ptSubject, true);
  c.AddPath(toPath(half), ClipperLib.PolyType.ptClip, true);
  const out: ClipperLib.Paths = [];
  c.Execute(ClipperLib.ClipType.ctIntersection, out, ClipperLib.PolyFillType.pftEvenOdd, ClipperLib.PolyFillType.pftNonZero);
  return out.map((p) => p.map((q) => [q.X / K, q.Y / K] as Pt)).filter((p) => p.length > 2);
}

function box2(polys: Poly[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of polys)
    for (const [x, y] of p) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x);
      y1 = Math.max(y1, y);
    }
  return { x0, y0, x1, y1 };
}

/** Line (a·x + b·y + c = 0, a² + b² = 1, in A's coordinates) along which plate B passes through plate A */
function crossing(A: Plate, B: Plate): Seam | null {
  const nB = B.pose.n;
  const mid = at(B.pose, 0, 0, B.th / 2);
  let a = dot(A.pose.u, nB),
    b = dot(A.pose.v, nB);
  const len = Math.hypot(a, b);
  if (len < 0.2) return null; // parallel
  const o = at(A.pose, 0, 0, A.th / 2);
  let c = dot([o[0] - mid[0], o[1] - mid[1], o[2] - mid[2]], nB);
  a /= len;
  b /= len;
  c /= len;
  const tol = Math.max(A.th, B.th) * 1.5;
  let lo = Infinity, hi = -Infinity, t0 = Infinity, t1 = -Infinity;
  for (const p of A.polys)
    for (const [x, y] of p) {
      const d = a * x + b * y + c;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
      const t = -b * x + a * y;
      t0 = Math.min(t0, t);
      t1 = Math.max(t1, t);
    }
  if (lo > -tol || hi < tol) return null; // B only meets A's border
  // Does B reach the line inside A?
  const bb = box2(B.polys);
  for (let i = 1; i < 12; i++) {
    const t = t0 + ((t1 - t0) * i) / 12;
    const x = -a * c - b * t,
      y = -b * c + a * t;
    const P = at(A.pose, x, y, A.th / 2);
    const r: V3 = [P[0] - B.pose.o[0], P[1] - B.pose.o[1], P[2] - B.pose.o[2]];
    const bx = dot(r, B.pose.u),
      by = dot(r, B.pose.v);
    if (bx > bb.x0 + tol && bx < bb.x1 - tol && by > bb.y0 + tol && by < bb.y1 - tol) return [a, b, c];
  }
  return null;
}

function halves(polys: Poly[], [a, b, c]: Seam): [Poly[], Poly[]] {
  const L = 1e4;
  const px = -a * c,
    py = -b * c;
  const side = (s: number): Poly => [
    [px + b * L, py - a * L],
    [px - b * L, py + a * L],
    [px - b * L + s * a * L, py + a * L + s * b * L],
    [px + b * L + s * a * L, py - a * L + s * b * L],
  ];
  return [clip(polys, side(1)), clip(polys, side(-1))];
}

function cutCrossings(plates: Plate[]): Piece[] {
  let out: Piece[] = plates.map((p, i) => ({ ...p, src: i, seams: [] }));
  plates.forEach((B, bi) => {
    const next: Piece[] = [];
    for (const A of out) {
      const seam = A.src === bi ? null : crossing(A, B);
      if (!seam) {
        next.push(A);
        continue;
      }
      const [pos, neg] = halves(A.polys, seam);
      if (!pos.length || !neg.length) {
        next.push(A);
        continue;
      }
      next.push({ ...A, polys: pos, seams: [...A.seams, seam] }, { ...A, polys: neg, seams: [...A.seams, seam] });
    }
    out = next;
  });
  return out;
}

// ---------- Drawing ----------

interface Drawn {
  depth: number;
  /** [class, closed outlines][] in drawing order, then open outline strokes */
  fills: [string, Poly[]][];
  strokes: Poly[];
}

const signedArea = (p: Poly) => {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i],
      [x1, y1] = p[(i + 1) % p.length];
    s += x0 * y1 - x1 * y0;
  }
  return s / 2;
};

function draw(P: Piece, cam: ReturnType<typeof camera>): Drawn {
  const { f, right, up } = cam;
  const px = (v: V3): Pt => [dot(v, right), -dot(v, up)];
  const n = P.pose.n;
  const topSeen = dot(n, f) < 0;
  const sNear = topSeen ? P.th : 0;
  const onSeam = (p: Pt) => P.seams.some(([a, b, c]) => Math.abs(a * p[0] + b * p[1] + c) < 0.02);
  let depth = 0,
    count = 0;
  const edges: [number, Poly][] = [];
  const strokes: Poly[] = [];
  const face: Poly[] = [];
  for (const poly of P.polys) {
    const sgn = Math.sign(signedArea(poly)) || 1;
    const near = poly.map(([x, y]) => at(P.pose, x, y, sNear));
    for (const v of near) {
      depth += dot(v, f);
      count++;
    }
    face.push(near.map(px));
    let run: Poly = [];
    // Cut edges that follow each other with the same tone become one strip: its lower points, then the upper ones back
    let strip: { t: number; pts: Poly } | null = null;
    const flush = () => {
      if (strip) edges.push([strip.t, [...strip.pts.map(([x, y]) => px(at(P.pose, x, y, 0))), ...strip.pts.map(([x, y]) => px(at(P.pose, x, y, P.th))).reverse()]]);
      strip = null;
    };
    const N = poly.length;
    for (let i = 0; i < N; i++) {
      const p = poly[i],
        q = poly[(i + 1) % N];
      const seam = onSeam(p) && onSeam(q);
      if (seam) {
        if (run.length > 1) strokes.push(run);
        run = [];
        flush();
        continue;
      }
      if (!run.length) run.push(px(near[i]));
      run.push(px(near[(i + 1) % N]));
      // Cut edge between p and q, seen when it faces the camera
      const dx = q[0] - p[0],
        dy = q[1] - p[1];
      const l = Math.hypot(dx, dy);
      const ox = (sgn * dy) / (l || 1),
        oy = (-sgn * dx) / (l || 1);
      const N3: V3 = [ox * P.pose.u[0] + oy * P.pose.v[0], ox * P.pose.u[1] + oy * P.pose.v[1], ox * P.pose.u[2] + oy * P.pose.v[2]];
      if (l < 1e-6 || dot(N3, f) >= -1e-6) {
        flush();
        continue;
      }
      const t = tone(N3);
      const open: { t: number; pts: Poly } | null = strip;
      if (open && open.t === t) open.pts.push(q);
      else {
        flush();
        strip = { t, pts: [p, q] };
      }
    }
    flush();
    if (run.length > 1) strokes.push(run);
  }
  const fills: [string, Poly[]][] = [];
  for (const t of [3, 2, 1]) {
    const quads = edges.filter((e) => e[0] === t).map((e) => e[1]);
    if (quads.length) fills.push([`e${t}`, quads]);
  }
  const cls = ['', 'w', 'w2', 'w3'][tone(topSeen ? n : ([-n[0], -n[1], -n[2]] as V3))];
  fills.push([P.seams.length ? `${cls} ns` : cls, face]);
  return { depth: depth / (count || 1), fills, strokes: P.seams.length ? strokes : [] };
}

/**
 * Picture of the plates, fitted into the box. Returns SVG elements, back to front.
 * tol: outlines are simplified to this deviation (mm) first; round parts need more than straight ones.
 */
export function isoPicture(plates: Plate[], box: Box = ROOM, view: View = VIEW, tol = 0.25): string {
  const cam = camera(view);
  const simple = plates.map((p) => ({ ...p, polys: thinAll(p.polys, tol) }));
  const drawn = cutCrossings(simple).map((p) => draw(p, cam));
  drawn.sort((a, b) => b.depth - a.depth);
  const all = drawn.flatMap((d) => [...d.fills.flatMap((x) => x[1]), ...d.strokes]);
  const fit = fitMap(all, box);
  let out = '';
  for (const d of drawn) {
    for (const [cls, polys] of d.fills) out += area(cls, fit(polys).map((p) => thinClosed(p, 0.08)).filter((p) => p.length > 2));
    if (d.strokes.length) out += lines('o', fit(d.strokes).map((p) => thin(p, 0.08)));
  }
  return out;
}

