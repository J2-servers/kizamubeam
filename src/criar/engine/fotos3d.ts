// Pictures of the assembled 3D for the reviewer of stage 5 (iso, top, front), drawn by the app's own 3D viewer in a
// host outside the screen (the harness photographed the 3D window of the main app; the creator's editor has none).
import type { Scene3D, ViewAxes, ViewPreset } from '../../view3d/viewer';
import { solidBounds } from '../../view3d/solids';

export const VISTAS: [string, ViewPreset][] = [['iso', 'iso'], ['topo', 'top'], ['frente', 'front']];

type Eixo = 'x' | 'y' | 'z';
interface Placa { id: string; x: [number, number]; y: [number, number]; z: [number, number] }

/**
 * Where the product's right (+x), back (+y) and up (+z) of the specification ended up in the 3D. The assembly is built
 * from the joints, rooted at whichever plate has most of them, so it can lie or face any way. Matched from the plates:
 * their extent along each 3D axis against their extent in the specification, and their offsets agreeing.
 * (Measured on the piggy bank run with the real AI: the fixed "front" camera showed the closed back, and the reviewer
 * asked for corrections three times because it never saw the window.)
 */
export function eixosDoProduto(scene: Scene3D, placas: Placa[], idDe: (placa: string) => number | undefined): ViewAxes | undefined {
  const porId = new Map(scene.solids.filter((s) => /^m\d/.test(s.key)).map((s) => [Number(s.key.slice(1)), solidBounds(s)]));
  const pares = placas.map((p) => ({ p, b: porId.get(idDe(p.id) ?? -1) })).filter((x) => x.b);
  if (pares.length < 2) return undefined;
  const usados = new Set<number>();
  const out = {} as Record<Eixo, [number, number, number]>;
  // the axis with the clearest match first
  const custos = (['x', 'y', 'z'] as Eixo[]).map((k) => {
    let melhor = { j: 0, sg: 1, custo: Infinity };
    for (let j = 0; j < 3; j++) for (const sg of [1, -1]) {
      const offs: number[] = [];
      let erro = 0;
      for (const { p, b } of pares) {
        erro += Math.abs(b!.max[j] - b!.min[j] - (p[k][1] - p[k][0]));
        offs.push(sg > 0 ? b!.min[j] - p[k][0] : b!.min[j] + p[k][1]);
      }
      const m = offs.reduce((a, c) => a + c, 0) / offs.length;
      const custo = erro + offs.reduce((a, o) => a + Math.abs(o - m), 0);
      if (custo < melhor.custo) melhor = { j, sg, custo };
    }
    return { k, ...melhor };
  }).sort((a, b) => a.custo - b.custo);
  for (const c of custos) {
    if (usados.has(c.j)) return undefined; // two product axes on one 3D axis: no reliable frame
    usados.add(c.j);
    const v: [number, number, number] = [0, 0, 0];
    v[c.j] = c.sg;
    out[c.k] = v;
  }
  return out;
}

/** PNG data URLs, in the order of VISTAS; empty when the scene has no parts or WebGL is not available */
export async function fotos3d(scene: Scene3D, axes?: ViewAxes, w = 900, h = 650): Promise<{ vista: string; url: string }[]> {
  if (!scene.solids.length) return [];
  const { Viewer3D } = await import('../../view3d/viewer');
  const host = document.createElement('div');
  Object.assign(host.style, { position: 'fixed', left: '-20000px', top: '0', width: `${w}px`, height: `${h}px`, pointerEvents: 'none' });
  document.body.append(host);
  let viewer: InstanceType<typeof Viewer3D> | null = null;
  try {
    viewer = new Viewer3D(host);
    viewer.setScene(scene, true);
    const out: { vista: string; url: string }[] = [];
    for (const [vista, preset] of VISTAS) {
      viewer.view(preset, axes, true);
      out.push({ vista, url: viewer.snapshot(1) });
    }
    return out;
  } finally {
    viewer?.dispose();
    host.remove();
  }
}
