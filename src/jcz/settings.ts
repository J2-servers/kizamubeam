// Galvo (JCZ/EZCad) device settings: defaults and tolerant reading of stored devices, imports and older versions.
// Field names follow LightBurn's JCZFiber device (see contract.ts); no DOM here, so the job tests can use it.
import type { JczGalvo, JczSettings } from './contract';

export const DEFAULT_JCZ_GALVO: JczGalvo = { scale: 1, bulge: 1, skew: 1, trapezoid: 1, sign: 1 };

/** Defaults of a new galvo device: 110 mm lens, EZCad's standard delays, red light on the board's standard output */
export const DEFAULT_JCZ: JczSettings = {
  field: 110,
  offsetX: 0,
  offsetY: 0,
  angle: 0,
  galvo1: { ...DEFAULT_JCZ_GALVO },
  galvo2: { ...DEFAULT_JCZ_GALVO },
  galvo1IsX: true,
  laserType: 'fiber',
  fiberType: '',
  minFreq: 1,
  maxFreq: 200,
  pulseWidthEnabled: false,
  redDot: { offsetX: 0, offsetY: 0, scaleX: 1, scaleY: 1 },
  // redLight -1: the driver uses output 8, the usual one on these boards (as MeerK40t does)
  ports: { startMark: -1, startFrame: -1, stopMark: -1, doorProtect: -1, redLight: -1 },
  jumpSpeed: 4000,
  laserOnDelay: 100,
  laserOffDelay: 100,
  polygonDelay: 100,
  endDelay: 300,
  minJumpDelay: 100,
  maxJumpDelay: 200,
  maxJumpDistance: 10,
  frameSpeed: 3000,
};

/** Fiber sources LightBurn offers (Laser_FiberType); free text is kept as it is */
export const JCZ_FIBER_TYPES = ['JPT M7', 'JPT Type E', 'Raycus Q', 'Raycus MOPA', 'IPG YLP', 'IPG YLPN', 'MAX Q', 'MAX MOPA'];

/** Marking parameters a layer adds for galvo devices (LightBurn: Frequency, Q-Pulse Width) */
export interface GalvoLayer {
  /** kHz */
  freq: number;
  /** ns, MOPA sources only */
  pulse: number;
}
export const DEFAULT_GALVO_LAYER: GalvoLayer = { freq: 30, pulse: 200 };

const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function galvo(v: unknown): JczGalvo {
  const g = obj(v);
  return {
    scale: num(g.scale, 1),
    bulge: num(g.bulge, 1),
    skew: num(g.skew, 1),
    trapezoid: num(g.trapezoid, 1),
    sign: num(g.sign, 1) < 0 ? -1 : 1,
  };
}

/** Complete galvo settings from whatever was stored (missing or broken fields get the defaults; unknown ones stay) */
export function normalizeJcz(raw: unknown): JczSettings {
  const r = obj(raw);
  const D = DEFAULT_JCZ;
  const rd = obj(r.redDot);
  const pt = obj(r.ports);
  const port = (k: keyof JczSettings['ports']) => Math.round(num(pt[k], D.ports[k]));
  const field = num(r.field, D.field);
  const lt = r.laserType;
  return {
    ...r,
    field: field > 0 ? field : D.field,
    offsetX: num(r.offsetX, 0),
    offsetY: num(r.offsetY, 0),
    angle: num(r.angle, 0),
    galvo1: galvo(r.galvo1),
    galvo2: galvo(r.galvo2),
    galvo1IsX: typeof r.galvo1IsX === 'boolean' ? r.galvo1IsX : D.galvo1IsX,
    laserType: lt === 'co2' || lt === 'uv' ? lt : 'fiber',
    fiberType: typeof r.fiberType === 'string' ? r.fiberType : '',
    minFreq: num(r.minFreq, D.minFreq),
    maxFreq: num(r.maxFreq, D.maxFreq),
    pulseWidthEnabled: r.pulseWidthEnabled === true,
    redDot: { offsetX: num(rd.offsetX, 0), offsetY: num(rd.offsetY, 0), scaleX: num(rd.scaleX, 1), scaleY: num(rd.scaleY, 1) },
    ports: { startMark: port('startMark'), startFrame: port('startFrame'), stopMark: port('stopMark'), doorProtect: port('doorProtect'), redLight: port('redLight') },
    jumpSpeed: num(r.jumpSpeed, D.jumpSpeed),
    laserOnDelay: num(r.laserOnDelay, D.laserOnDelay),
    laserOffDelay: num(r.laserOffDelay, D.laserOffDelay),
    polygonDelay: num(r.polygonDelay, D.polygonDelay),
    endDelay: num(r.endDelay, D.endDelay),
    minJumpDelay: num(r.minJumpDelay, D.minJumpDelay),
    maxJumpDelay: num(r.maxJumpDelay, D.maxJumpDelay),
    maxJumpDistance: num(r.maxJumpDistance, D.maxJumpDistance),
    frameSpeed: num(r.frameSpeed, D.frameSpeed!),
    ...(r.lightburn && typeof r.lightburn === 'object' ? { lightburn: r.lightburn as Record<string, unknown> } : {}),
  };
}

/** Galvo marking parameters of a layer or sub-layer (missing in older files: defaults) */
export function galvoLayer(v: unknown): GalvoLayer {
  const g = obj(v);
  const freq = num(g.freq, DEFAULT_GALVO_LAYER.freq);
  const pulse = num(g.pulse, DEFAULT_GALVO_LAYER.pulse);
  return { freq: freq > 0 ? freq : DEFAULT_GALVO_LAYER.freq, pulse: pulse > 0 ? pulse : DEFAULT_GALVO_LAYER.pulse };
}
