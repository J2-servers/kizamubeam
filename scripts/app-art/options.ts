// The example picture of every option that a dialog offers by name only (kind of joint, bend pattern, warp …), by
// "<group>:<value of the option>": the value the select or the radio of the dialog uses, e.g. "hinge:wave".
// Drawn like the toolbox tiles (kit.ts: classes only, colours from src/style.css) and from the real geometry of the
// tool wherever a function for it exists (computeJointGeom, computeHinge, warpFn, dither, cornerSub, offsetOp,
// booleanOp, computePattern).
// Field: 96 × 64 units, flatter than a tile (120 × 104), because the picture sits under a select in a form column.
// New option: add its picture here and run npm run build:app-art; npm run test:apps checks that none is missing.
import type { DitherMode, Obj, SubPath } from '../../src/model';
import { defaultImageLayer, translate } from '../../src/model';
import { cornerSub, type CornerMode } from '../../src/corners';
import { computeHinge, DEFAULT_HINGE, type HingeKind, type HingeOptions } from '../../src/hinges';
import { dither } from '../../src/images';
import { computeJointGeom, DEFAULT_JOINT, JOINT_GEOMETRY_VERSION, type JointKind, type JointOptions } from '../../src/jointsGeom';
import { type BoolBase, booleanOp, type OffsetOptions, offsetOp, orderForBoolean } from '../../src/ops';
import { piecesOf } from '../../src/pathtools';
import { computePattern, DEFAULT_PATTERN_OPTIONS, type PatternOptions, patternLattice } from '../../src/pattern';
import type { PatternEdge, PatternRepeat, PatternTile } from '../../src/patternFormat';
import { warpFn, type WarpKind } from '../../src/warp';
import { arcPts, area, arrow, bez, boundsOf, type Box, circle, circlePts, ellipse, fade, fitMap, flat, label, lines, moveAll, plate, type Poly, type Pt, rectPts, roundRectPts, thin, thinAll } from './kit';

/** Drawing field of an option picture */
export const OW = 96;
export const OH = 64;
/** The usual room of a picture inside the field */
const OROOM: Box = { x: 6, y: 5, w: 84, h: 52 };

// ---------- Joints (src/jointDialog.ts) ----------

const rectSub = (x: number, y: number, w: number, h: number): SubPath => ({ closed: true, nodes: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }] });

/** Two boards as the joint tool cuts them: edge 1 is the lower edge of the upper board, edge 2 the upper edge of the lower one */
function joint(kind: JointKind, extra: Partial<JointOptions> = {}) {
  const A = [rectSub(0, 0, 72, 20)];
  const B = [rectSub(0, 31, 72, 20)];
  const picks = [{ obj: 'a', subs: A, sub: 0, seg: 2 }, { obj: 'b', subs: B, sub: 0, seg: 0 }];
  const r = computeJointGeom(picks, { ...DEFAULT_JOINT, kind, ...extra }, JOINT_GEOMETRY_VERSION);
  if (r.error) throw new Error(`joint ${kind}: ${JSON.stringify(r.error)}`);
  const a = flat(r.changes.get('a') ?? A), b = flat(r.changes.get('b') ?? B);
  // The extra parts (wedges, knuckles) lie where the tool puts them in the drawing; here in a row under the boards
  let add = flat(r.added);
  if (add.length) {
    const ab = boundsOf([...a, ...b]), xb = boundsOf(add);
    add = moveAll(add, ab.x + (ab.w - xb.w) / 2 - xb.x, ab.y + ab.h + 5 - xb.y);
  }
  const fit = fitMap([...a, ...b, ...add], OROOM);
  return plate(thinAll(fit(a), 0.15), 'w', 1.3) + plate(thinAll(fit(b), 0.15), 'w2', 1.3) + (add.length ? plate(thinAll(fit(add), 0.15), 'w3', 1.3) : '');
}

// ---------- Bend patterns (src/hingeDialog.ts) ----------

const HINGE: Record<HingeKind, Partial<HingeOptions>> = {
  straight: { cutLength: 20, bridge: 5, spacing: 5 },
  wave: { cutLength: 22, bridge: 5, spacing: 6, waveAmp: 1.8, waveLength: 11 },
  diamond: { cutLength: 9, bridge: 3 },
  honeycomb: { cutLength: 7, bridge: 3 },
  triangle: { cutLength: 10, bridge: 3 },
  cross: { cutLength: 11, bridge: 3, spacing: 3.6 },
  spiral: { spacing: 5 },
};

/** A board with the cut pattern of the living hinge tool */
function hinge(kind: HingeKind) {
  const W = 78, H = 50;
  const zone: Obj = { id: 1, m: translate(0, 0), layer: 0, shape: { kind: 'rect', w: W, h: H, r: 0 } };
  const r = computeHinge([zone], { ...DEFAULT_HINGE, margin: 4, orient: 'vertical', ...HINGE[kind], kind });
  if (r.error || !r.subs.length) throw new Error(`hinge ${kind}: ${r.error}`);
  const board = roundRectPts(0, 0, W, H, 3);
  const fit = fitMap([board], OROOM);
  return plate(fit([board]), 'w', 1.3) + lines('c', fit(flat(r.subs, true)).map((p) => thin(p, 0.15))) + area('c', thinAll(fit(flat(r.subs)), 0.15));
}

// ---------- Warp (src/warpDialog.ts) ----------

/** A board with a grid, bent by the warp function; dashed: the frame before */
function warp(kind: WarpKind) {
  const W = 80, H = 30;
  const f = warpFn({ kind, amount: 60, vertical: false }, { x: 0, y: 0, w: W, h: H });
  const seg = (a: Pt, b: Pt, n = 24): Poly =>
    Array.from({ length: n + 1 }, (_, i) => {
      const q = f({ x: a[0] + ((b[0] - a[0]) * i) / n, y: a[1] + ((b[1] - a[1]) * i) / n });
      return [q.x, q.y] as Pt;
    });
  const outline: Poly = [...seg([0, 0], [W, 0]).slice(0, -1), ...seg([W, 0], [W, H]).slice(0, -1), ...seg([W, H], [0, H]).slice(0, -1), ...seg([0, H], [0, 0]).slice(0, -1)];
  const inner: Poly[] = [...[10, 20].map((y) => seg([0, y], [W, y])), ...[16, 32, 48, 64].map((x) => seg([x, 0], [x, H], 8))];
  const ghost = rectPts(0, 0, W, H);
  const fit = fitMap([outline, ghost], OROOM);
  return plate(thinAll(fit([outline]), 0.12), 'w', 1.3) + lines('bt', fit(inner).map((p) => thin(p, 0.12))) + area('g', fit([ghost]));
}

// ---------- Layer settings (src/layerdialog.ts); drawn by hand ----------

/** An engraved shape on a board: filled line by line, or with rings that follow its outline */
function fillPic(style: 'scan' | 'offset') {
  const cx = 48, cy = 31, rx = 31, ry = 19;
  const ring = (k: number) => arcPts(cx, cy, rx * k, 0, 360, ry * k, 36).slice(0, -1);
  const rows: Poly[] = [];
  for (let y = cy - ry + 1.6; y < cy + ry - 0.5; y += 3.3) {
    const dx = rx * Math.sqrt(1 - ((y - cy) / ry) ** 2);
    rows.push([[cx - dx, y], [cx + dx, y]]);
  }
  return plate([roundRectPts(8, 5, 80, 52, 3)], 'w', 1.3) + (style === 'scan' ? lines('bl', rows) : area('bl', [1, 0.82, 0.64, 0.46, 0.28, 0.1].map(ring)));
}

/** A disc cut out of a board; the cut starts beside the outline: straight, or in an arc that runs into it */
function leadPic(arc: boolean) {
  const cx = 40, cy = 31, r = 20;
  const P: Pt = [cx + r, cy];
  const path: Poly = arc ? arcPts(P[0] + 12, cy, 12, 270, 180) : [[P[0] + 19, cy], P];
  return (
    plate([roundRectPts(6, 5, 84, 52, 3)], 'w2', 1.3) +
    area('w', [circlePts(cx, cy, r, 40)]) +
    lines('a', [path, arrow(path[path.length - 2], P, 4.4)[1]]) +
    circle('af', path[0][0], path[0][1], 1.9)
  );
}

// ---------- Image modes (src/imageLayerFields.ts) ----------

/**
 * The sample every image mode is shown on: 80 × 48 units in the picture from (IX, IY). Modes that set single
 * points get it as 40 × 24 points of 2 × 2 units, so the points can be seen; modes that draw with cells, outlines
 * or tones get the same image with twice as many points (80 × 48 of one unit), so their dots and lines have room.
 */
const IW = 40, IH = 24, IX = 8, IY = 7;
const FINE: DitherMode[] = ['threshold', 'newsprint', 'halftone', 'sketch', 'grayscale'];

/**
 * Test image (0 = black … 255 = white) in w × h points: a ground that runs from dark on the left to light on the
 * right, and on it a ball lit from the top left. So every mode has all tones to show, and an edge that is dark on
 * light as well as light on dark.
 */
function testImage(w: number, h: number): Float32Array {
  const g = new Float32Array(w * h);
  const S = 4; // samples per point and axis, for a soft edge of the ball
  const r = 0.385; // radius of the ball as a part of the image height
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let j = 0; j < S; j++)
        for (let i = 0; i < S; i++) {
          const u = (x + (i + 0.5) / S) / w, v = (y + (j + 0.5) / S) / h;
          const dx = ((u - 0.5) * w) / h, dy = v - 0.5;
          const ground = 15 + 225 * u;
          const ball = 250 - 240 * Math.min(1, Math.hypot(dx + 0.4 * r, dy + 0.4 * r) / (1.5 * r)) ** 2;
          sum += dx * dx + dy * dy < r * r ? ball : ground;
        }
      g[y * w + x] = sum / (S * S);
    }
  return g;
}

/**
 * The chosen points of a w × h sample as boxes [x, y, w, h] of the picture (px units per point): the runs of a
 * row, grown downwards while the row below has the same run
 */
function pointBoxes(w: number, h: number, px: number, on: (x: number, y: number) => boolean): number[][] {
  const out: number[][] = [];
  let above = new Map<string, number>();
  for (let y = 0; y < h; y++) {
    const row = new Map<string, number>();
    for (let x = 0; x < w; ) {
      if (!on(x, y)) {
        x++;
        continue;
      }
      let e = x;
      while (e < w && on(e, y)) e++;
      const key = `${x} ${e}`;
      const k = above.get(key);
      if (k !== undefined) out[k][3] += px;
      row.set(key, k ?? out.push([IX + x * px, IY + y * px, (e - x) * px, px]) - 1);
      x = e;
    }
    above = row;
  }
  return out;
}

/** Boxes with whole numbers as one path of relative steps: a third of the text area() needs for hundreds of points */
function boxPath(cls: string, boxes: number[][], opacity = 1): string {
  let d = '';
  boxes.forEach(([x, y, w, h], i) => (d += (i ? `m${x - boxes[i - 1][0]} ${y - boxes[i - 1][1]}` : `M${x} ${y}`) + `h${w}v${h}h-${w}z`));
  return d ? `<path ${opacity < 1 ? `opacity="${opacity}" ` : ''}class="${cls}" d="${d}"/>` : '';
}

/** How dark a point burns, in TONES steps: the modes with tones need them, the others only know on and off */
const TONES = 8;

/** A board with the test image as the image mode engraves it: dither() of src/images.ts with the layer defaults */
function imageMode(mode: DitherMode) {
  const L = defaultImageLayer();
  const fine = FINE.includes(mode) ? 2 : 1;
  const w = IW * fine, h = IH * fine, px = 2 / fine;
  // Cell size in points as processImage() works it out for a line interval of 0.1 mm
  const out = dither(testImage(w, h), w, h, { mode, threshold: L.threshold, cellPx: 25.4 / L.cells / 0.1, angle: L.angle });
  const tone = (x: number, y: number) => Math.round((1 - out[y * w + x] / 255) * TONES);
  let marks = '';
  for (let k = 1; k <= TONES; k++) marks += boxPath('b', pointBoxes(w, h, px, (x, y) => tone(x, y) === k), k / TONES);
  if (!marks) throw new Error(`image mode ${mode}: nothing is burnt`);
  return plate([roundRectPts(6, 5, 84, 52, 3)], 'w', 1.3) + marks;
}

// ---------- Corners, offset and Boolean base (src/ui.ts) ----------

/** A board whose four corners went through the corner tool; dashed: the corners before, blue: what the tool made of them */
function cornerPic(mode: CornerMode) {
  const before = rectSub(6, 5, 84, 52);
  const r = cornerSub(before, [0, 1, 2, 3], mode, 14);
  if (r.done !== 4) throw new Error(`corner ${mode}: ${r.done} of 4 corners`);
  // The new pieces are the ones that do not run along a side of the board
  const made: Poly[] = piecesOf(r.sub)
    .filter((p) => Math.abs(p.a.x - p.b.x) > 1e-6 && Math.abs(p.a.y - p.b.y) > 1e-6)
    .map((p) => (p.curve ? bez([p.a.x, p.a.y], [p.c1.x, p.c1.y], [p.c2.x, p.c2.y], [p.b.x, p.b.y], 8) : [[p.a.x, p.a.y], [p.b.x, p.b.y]]));
  return area('g', flat([before])) + plate(thinAll(flat([r.sub]), 0.1), 'w', 1.3) + lines('a', made);
}

/** Pieces of the offset pictures: on a triangle the corners of the contour show best, on an angle bracket inside and outside */
const TRIANGLE: Pt[] = [[0, 30], [22, 0], [44, 30]];
const BRACKET: Pt[] = [[0, 0], [15, 0], [15, 17], [44, 17], [44, 32], [0, 32]];

/** A piece with the contour the offset tool lays around or into it (blue); every option of a control at the same scale */
function offsetPic(shape: Pt[], opt: Partial<OffsetOptions> & { distance: number }) {
  const outline: SubPath = { closed: true, nodes: shape.map(([x, y]) => ({ x, y })) };
  const piece: Obj = { id: 1, m: translate(0, 0), layer: 0, shape: { kind: 'path', subs: [outline] } };
  const o: OffsetOptions = { direction: 'outward', join: 'round', ...opt };
  const contour = flat(offsetOp([piece], o));
  if (!contour.length) throw new Error(`offset ${JSON.stringify(opt)}: no contour`);
  // The widest result (pointed corners, outwards) gives the scale, so the piece stays where it is from option to option
  const fit = fitMap(flat(offsetOp([piece], { ...o, direction: 'outward', join: 'miter' })), OROOM);
  return plate(fit([shape]), 'w', 1.3) + area('a', thinAll(fit(contour), 0.1));
}

/**
 * Three discs on top of each other (the darkest at the back, the lightest in front) and below them what “Subtract”
 * leaves: the base without the others (dashed). With the first selected shape as base the numbers give the order
 * of the clicks.
 */
function boolBasePic(base: BoolBase) {
  const R = 10.5, STEP = 13, X = 24.5, Y1 = 5, Y2 = 36;
  const FACE = ['w3', 'w2', 'w'];
  const disc = (i: number): Obj => ({ id: i + 1, m: translate(R + i * STEP, R), layer: 0, shape: { kind: 'ellipse', rx: R, ry: R } });
  const stack = [disc(0), disc(1), disc(2)]; // back first
  const clicked = [stack[1], stack[0], stack[2]];
  const order = orderForBoolean(clicked, stack, base);
  const left = flat(booleanOp('subtract', order));
  if (!left.length) throw new Error(`Boolean base ${base}: nothing is left`);
  const cx = (o: Obj) => X + R + stack.indexOf(o) * STEP;
  let out = '';
  // The discs like plate(): the cut edge below and to the right, then the face
  for (const o of stack) out += circle('e2', cx(o) + 0.78, Y1 + R + 1.3, R) + circle(FACE[stack.indexOf(o)], cx(o), Y1 + R, R);
  // Each number (5 wide, 8 high) in the middle of the part of its disc that the disc in front leaves visible
  const middle = [STEP / 2, STEP * 1.5, R + 2 * STEP];
  if (base === 'selection') out += lines('a', clicked.flatMap((o, k) => label(String(k + 1), X + middle[stack.indexOf(o)] - 2.5, Y1 + R - 4, 8)));
  out += lines('a', arrow([48, Y1 + 2 * R + 3.2], [48, Y2 - 1.6], 3.2));
  for (const o of order.slice(1)) out += circle('g', cx(o), Y2 + R, R);
  return out + plate(thinAll(moveAll(left, X, Y2), 0.1), FACE[stack.indexOf(order[0])], 1.3);
}

// ---------- Pattern fill (src/patternDialog.ts) ----------

/** Motif without any symmetry (an L), so that mirrored and turned tiles can be told apart; tile coordinates */
const MOTIF: SubPath = { closed: true, nodes: [{ x: -3.5, y: -5 }, { x: -0.5, y: -5 }, { x: -0.5, y: 2 }, { x: 4, y: 2 }, { x: 4, y: 5 }, { x: -3.5, y: 5 }] };

/** The pattern tool on a target shape, already in the units of the picture */
function pattern(tile: PatternTile, target: SubPath, o: Partial<PatternOptions>): SubPath[] {
  const r = computePattern({ tile, target: [target], holes: [] }, { ...DEFAULT_PATTERN_OPTIONS, margin: 0, minFragment: 0, ...o });
  if (r.error) throw new Error(`pattern ${JSON.stringify(o)}: ${r.error}`);
  return r.subs;
}

/** A board covered with the motif in this arrangement; fine lines: the frames of the tiles */
function repeatPic(repeat: PatternRepeat) {
  // A regular hexagon for the hexagonal arrangement, a square for the others; 5 × 3 tiles on the board
  const w = 16, h = repeat === 'hex' ? w / Math.cos(Math.PI / 6) : w;
  const board = rectSub(6, 5, 84, 52);
  // Slivers that the edge of the board leaves of a motif are dropped (“smallest leftover pieces”)
  const o: Partial<PatternOptions> = { repeat, margin: 2, minFragment: 3.2 };
  const lattice = patternLattice({ w, h, subs: [MOTIF] }, { ...DEFAULT_PATTERN_OPTIONS, ...o });
  if (typeof lattice === 'string') throw new Error(`pattern ${repeat}: ${lattice}`);
  const frames = pattern({ w, h, subs: [{ closed: true, nodes: lattice.frame.map((p) => ({ x: p.x, y: p.y })) }] }, board, { ...o, output: 'lines' });
  const motifs = pattern({ w, h, subs: [MOTIF] }, board, { ...o, output: 'areas' });
  return (
    plate([roundRectPts(6, 5, 84, 52, 3)], 'w', 1.3) +
    fade(lines('bt', flat(frames, true)), 0.5) +
    fade(area('bt', flat(frames)), 0.5) +
    area('b', thinAll(flat(motifs), 0.05))
  );
}

/** A round target shape on a board, filled with square tiles: what happens to the tiles its outline runs through */
function edgePic(edge: PatternEdge) {
  const cx = 48, cy = 31, rx = 33, ry = 20.5;
  const target: SubPath = { closed: true, nodes: arcPts(cx, cy, rx, 0, 360, ry, 96).slice(0, -1).map(([x, y]) => ({ x, y })) };
  const tiles = pattern({ w: 10, h: 10, subs: [rectSub(-3.6, -3.6, 7.2, 7.2)] }, target, { edge, output: 'areas' });
  return plate([roundRectPts(6, 5, 84, 52, 3)], 'w2', 1.3) + ellipse('w', cx, cy, rx, ry) + area('b', thinAll(flat(tiles), 0.05)) + ellipse('o', cx, cy, rx, ry);
}

export const OPTION_ART: Record<string, () => string> = {
  'fill:scan': () => fillPic('scan'),
  'fill:offset': () => fillPic('offset'),
  'lead:line': () => leadPic(false),
  'lead:arc': () => leadPic(true),
  'joint:finger': () => joint('finger', { fingerWidth: 9 }),
  'joint:tenon': () => joint('tenon', { slotOffset: 8 }),
  'joint:lap': () => joint('lap', { lapCount: 2 }),
  'joint:snap': () => joint('snap', { slotOffset: 8, snapLip: 1, snapLength: 4 }),
  'joint:hook': () => joint('hook', { slotOffset: 8 }),
  'joint:wedge': () => joint('wedge', { slotOffset: 8 }),
  'joint:tslot': () => joint('tslot', { slotOffset: 8 }),
  'joint:lidhinge': () => joint('lidhinge'),
  'hinge:straight': () => hinge('straight'),
  'hinge:wave': () => hinge('wave'),
  'hinge:diamond': () => hinge('diamond'),
  'hinge:honeycomb': () => hinge('honeycomb'),
  'hinge:triangle': () => hinge('triangle'),
  'hinge:cross': () => hinge('cross'),
  'hinge:spiral': () => hinge('spiral'),
  'warp:arc': () => warp('arc'),
  'warp:arcUpper': () => warp('arcUpper'),
  'warp:arcLower': () => warp('arcLower'),
  'warp:bulge': () => warp('bulge'),
  'warp:flag': () => warp('flag'),
  'warp:perspective': () => warp('perspective'),
  'dither:threshold': () => imageMode('threshold'),
  'dither:ordered': () => imageMode('ordered'),
  'dither:atkinson': () => imageMode('atkinson'),
  'dither:floyd': () => imageMode('floyd'),
  'dither:stucki': () => imageMode('stucki'),
  'dither:jarvis': () => imageMode('jarvis'),
  'dither:newsprint': () => imageMode('newsprint'),
  'dither:halftone': () => imageMode('halftone'),
  'dither:sketch': () => imageMode('sketch'),
  'dither:grayscale': () => imageMode('grayscale'),
  'corner:round': () => cornerPic('round'),
  'corner:inverse': () => cornerPic('inverse'),
  'corner:chamfer': () => cornerPic('chamfer'),
  'offsetDir:outward': () => offsetPic(BRACKET, { distance: 4.5, direction: 'outward' }),
  'offsetDir:inward': () => offsetPic(BRACKET, { distance: 4.5, direction: 'inward' }),
  'offsetDir:both': () => offsetPic(BRACKET, { distance: 4.5, direction: 'both' }),
  'offsetJoin:round': () => offsetPic(TRIANGLE, { distance: 6.5, join: 'round' }),
  'offsetJoin:miter': () => offsetPic(TRIANGLE, { distance: 6.5, join: 'miter' }),
  'offsetJoin:square': () => offsetPic(TRIANGLE, { distance: 6.5, join: 'square' }),
  'boolBase:selection': () => boolBasePic('selection'),
  'boolBase:back': () => boolBasePic('back'),
  'boolBase:front': () => boolBasePic('front'),
  'patternRepeat:grid': () => repeatPic('grid'),
  'patternRepeat:brick': () => repeatPic('brick'),
  'patternRepeat:halfdrop': () => repeatPic('halfdrop'),
  'patternRepeat:mirror': () => repeatPic('mirror'),
  'patternRepeat:rotate': () => repeatPic('rotate'),
  'patternRepeat:hex': () => repeatPic('hex'),
  'patternEdge:clip': () => edgePic('clip'),
  'patternEdge:whole': () => edgePic('whole'),
  'patternEdge:touch': () => edgePic('touch'),
};
