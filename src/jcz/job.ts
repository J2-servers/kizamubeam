// Galvo job (JCZ/EZCad): the project's laser paths as polylines in field coordinates, one group per layer setting.
// The paths come from buildJob, the same computation as every other controller (lines, fill hatching with the
// layer's angle and interval, cross hatch, offset fill, kerf, tabs, images), so a galvo marks what the preview shows.
// Field coordinates: mm, origin at the centre of the design area (= the lens field), x right, y up. Field offset,
// rotation, galvo correction and red-dot calibration are applied by the rust side with the device settings.
import { buildJob, Box, Device, Job, JobInput } from '../gcode';
import { Layer, normalizeLayer, Pt } from '../model';
import { dec, t } from '../i18n';
import type { JczJob, JczParams } from './contract';
import { galvoLayer, normalizeJcz } from './settings';

/** One marking group as the confirmation shows it */
export interface JczGroupInfo {
  layer: number;
  /** sub-layer index, -1 = the layer itself */
  sub: number;
  name: string;
  params: JczParams;
  polylines: number;
  /** marked length of one pass, mm */
  length: number;
}

export interface JczPrepared {
  job: JczJob;
  groups: JczGroupInfo[];
  /** extent of the marked paths in field coordinates; null = nothing to mark */
  bounds: Box | null;
  /** some path lies outside the lens field: the board cannot reach it, marking is refused */
  outside: boolean;
  warnings: string[];
  /** rough marking time in seconds (marking at the layer speeds plus jumps) */
  time: number;
}

/** The device as buildJob needs it for a galvo: absolute coordinates on the field, no rotary, no Z, no return move */
export function jczJobDevice(d: Device): Device {
  const f = normalizeJcz(d.jcz).field;
  return { ...d, bedW: f, bedH: f, startFrom: 'absolute', rotary: { ...d.rotary, enabled: false }, zAxis: false, returnHome: false, pointerOffset: { ...d.pointerOffset, enabled: false } };
}

/** Passes go to the board as a parameter (JczParams.passes): the paths are computed once */
function onePass(L: Layer): Layer {
  return { ...L, passes: 1, zOffset: 0, zStep: 0, sub: L.sub?.map((s) => ({ ...s, passes: 1, zOffset: 0, zStep: 0 })) };
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4;

/**
 * Turn the moves of a job (computed with jczJobDevice and one pass per layer) into a galvo job. bed = design area:
 * its centre is the field centre. layerOf gives the real layer settings (passes, frequency, pulse width).
 */
export function jczFromJob(job: Job, d: Device, layerOf: (i: number) => Layer, bed: { w: number; h: number }): JczPrepared {
  const S = normalizeJcz(d.jcz);
  const mv = job.moves;
  const cx = bed.w / 2,
    cy = bed.h / 2;
  const groups: JczGroupInfo[] = [];
  const out: JczJob['groups'] = [];
  const warnings: string[] = [];
  const freqWarned = new Set<string>();
  let key = '';
  let poly: [number, number][] | null = null;
  let px = mv.x0,
    py = mv.y0;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  let jump = 0,
    jx = 0,
    jy = 0;
  const at = (x: number, y: number): [number, number] => {
    const p: [number, number] = [r4(x - cx), r4(y - cy)];
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
    return p;
  };
  const paramsOf = (li: number, sub: number, f: number, s: number): { params: JczParams; name: string } => {
    const L = layerOf(li);
    const e = sub >= 0 && L.sub?.[sub] ? L.sub[sub] : L;
    const g = galvoLayer(e.galvo);
    const lo = Math.min(S.minFreq, S.maxFreq),
      hi = Math.max(S.minFreq, S.maxFreq);
    const freq = Math.min(hi, Math.max(lo, g.freq));
    const name = sub >= 0 && L.sub?.[sub] ? `${L.name} · ${L.sub[sub].name?.trim() || t('Sub-Layer {n}', { n: sub + 1 })}` : L.name;
    if (freq !== g.freq && !freqWarned.has(name)) {
      freqWarned.add(name);
      warnings.push(t('{layer}: Frequenz {freq} kHz liegt außerhalb der Laserquelle ({min} … {max} kHz) und wird auf {value} kHz begrenzt.', { layer: name, freq: dec(String(g.freq)), min: dec(String(lo)), max: dec(String(hi)), value: dec(String(freq)) }));
    }
    return {
      name,
      params: {
        speed: Math.round((f / 60) * 100) / 100,
        power: Math.round(s * 1000) / 10,
        frequency: freq,
        pulseWidth: g.pulse,
        passes: Math.max(1, Math.round(e.passes || 1)),
      },
    };
  };
  for (let i = 0; i < mv.n; i++) {
    const x = mv.x[i],
      y = mv.y[i],
      f = mv.f[i],
      s = mv.s[i];
    if (f > 0 && s > 0) {
      const li = mv.layer[i],
        sub = mv.sub ? mv.sub[i] : -1;
      const k = `${li}|${sub}|${f}|${Math.round(s * 1000)}`;
      if (k !== key) {
        key = k;
        const { params, name } = paramsOf(li, sub, f, s);
        groups.push({ layer: li, sub, name, params, polylines: 0, length: 0 });
        out.push({ params, polylines: [] });
        poly = null;
      }
      const g = groups[groups.length - 1];
      if (!poly) {
        poly = [at(px, py)];
        out[out.length - 1].polylines.push(poly);
        g.polylines++;
        jump += Math.hypot(px - jx, py - jy);
      }
      poly.push(at(x, y));
      g.length += Math.hypot(x - px, y - py);
      jx = x;
      jy = y;
    } else poly = null;
    px = x;
    py = y;
  }
  const bounds = groups.length ? { x0, y0, x1, y1 } : null;
  const half = S.field / 2 + 1e-6;
  const outside = !!bounds && (bounds.x0 < -half || bounds.y0 < -half || bounds.x1 > half || bounds.y1 > half);
  if (outside && bounds) {
    const m = (v: number) => dec(v.toFixed(1));
    warnings.unshift(
      t('Der Entwurf reicht über das Galvo-Feld ({field} × {field} mm) hinaus: X {x0} … {x1}, Y {y0} … {y1} mm (Feldmitte = 0, erlaubt ±{half} mm). Teile außerhalb kann die Linse nicht erreichen.', {
        field: dec(String(S.field)), x0: m(bounds.x0), x1: m(bounds.x1), y0: m(bounds.y0), y1: m(bounds.y1), half: dec(String(S.field / 2)),
      }),
    );
  }
  let time = jump / Math.max(1, S.jumpSpeed);
  for (const g of groups) time += (g.length / Math.max(0.01, g.params.speed)) * g.params.passes;
  return { job: { groups: out, repeat: 1 }, groups, bounds, outside, warnings, time };
}

/** Compute the galvo job of a project: buildJob with the galvo device, then polylines in field coordinates */
export async function buildJczJob(inp: JobInput): Promise<{ base: Job; prep: JczPrepared }> {
  const layerOf = (i: number) => normalizeLayer(inp.layer(i));
  const base = await buildJob({ ...inp, device: jczJobDevice(inp.device), layer: (i) => onePass(layerOf(i)), position: null, forPreview: false });
  const prep = jczFromJob(base, inp.device, layerOf, inp.doc.bed);
  prep.warnings.push(...base.warnings);
  return { base, prep };
}

/** Red-light frame of a job in field coordinates: the rectangle around it, or its outline (convex hull) */
export function jczFramePath(base: Job, bed: { w: number; h: number }, contour: boolean): [number, number][] | null {
  const cx = bed.w / 2,
    cy = bed.h / 2;
  const b = base.bounds;
  if (!b) return null;
  const pts: Pt[] = contour && base.hull.length >= 3
    ? base.hull
    : [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }];
  const path = pts.map((p): [number, number] => [r4(p.x - cx), r4(p.y - cy)]);
  path.push([...path[0]]);
  return path;
}

/** Text of the confirmation before marking: every group with speed, power, frequency (pulse width), passes */
export function jczSummary(prep: JczPrepared, d: Device): string[] {
  const S = normalizeJcz(d.jcz);
  const lines = prep.groups.length > 12 ? summarizeMany(prep) : prep.groups;
  return lines.map((g) => {
    const p = g.params;
    const pulse = S.pulseWidthEnabled ? t(', Pulsbreite {pulse} ns', { pulse: dec(String(p.pulseWidth)) }) : '';
    return t('• {name}: {speed} mm/s, {power} %, {freq} kHz{pulse}, {passes}× ({lines} Linienzüge)', {
      name: g.name, speed: dec(String(p.speed)), power: dec(String(p.power)), freq: dec(String(p.frequency)), pulse, passes: p.passes, lines: g.polylines,
    });
  });
}

/** Many groups (images with grey levels): one line per layer with the power range */
function summarizeMany(prep: JczPrepared): JczGroupInfo[] {
  const by = new Map<string, JczGroupInfo>();
  for (const g of prep.groups) {
    const k = `${g.layer}|${g.sub}`;
    const o = by.get(k);
    if (!o) by.set(k, { ...g, params: { ...g.params } });
    else {
      o.polylines += g.polylines;
      o.length += g.length;
      o.params.power = Math.max(o.params.power, g.params.power);
    }
  }
  return [...by.values()];
}
