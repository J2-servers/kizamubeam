// Port of ai/foto-para-pecas/harness/conferir-vistas.mjs: do the three orthographic views (kz-vistas/1) describe the
// SAME plates? Axes: X width (right), Y depth (back), Z height (up), mm. front = X,Z  side = Y,Z  top = X,Y.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type Iv = [number, number];
export interface PlacaVista { id: string; x: Iv; y: Iv; z: Iv }
export interface Erro { codigo: string; placa?: string | null; msg: string; placas?: string[] }
export interface Conferencia { ok: boolean; erros: Erro[]; avisos: Erro[]; placas: PlacaVista[]; envolvente: Record<'x' | 'y' | 'z', Iv> | null }

type Eixo = 'x' | 'y' | 'z';
const EIXOS: Record<string, [Eixo, Eixo]> = { frente: ['x', 'z'], lado: ['y', 'z'], topo: ['x', 'y'] };
const PARES: [Eixo, string, string][] = [['x', 'frente', 'topo'], ['y', 'lado', 'topo'], ['z', 'frente', 'lado']];
const r3 = (n: number) => Math.round(n * 1000) / 1000;

export function conferir(doc: any, { tol = 0.05, mesa = [400, 400] as [number, number] } = {}): Conferencia {
  const erros: Erro[] = [];
  const avisos: Erro[] = [];
  const E = (codigo: string, placa: string | null, msg: string) => erros.push({ codigo, placa, msg });
  if (!doc || doc.spec !== 'kz-vistas/1') E('spec', null, 'spec deve ser "kz-vistas/1"');
  const t = doc?.espessura;
  const temT = typeof t === 'number' && t > 0;
  if (!temT) E('espessura', null, 'espessura (mm) e obrigatoria e maior que zero; pergunte ao usuario, nao invente');
  const v = doc?.vistas ?? {};
  const porPlaca = new Map<string, Record<string, any>>();

  for (const [vista, eixos] of Object.entries(EIXOS)) {
    const lista = v[vista];
    if (!Array.isArray(lista)) { E('vista-ausente', null, `vista "${vista}" ausente`); continue; }
    const vistos = new Set<string>();
    for (const ret of lista) {
      const id = ret?.placa;
      if (typeof id !== 'string' || !id) { E('id', null, `vista ${vista}: retangulo sem "placa"`); continue; }
      if (vistos.has(id)) { E('duplicada', id, `vista ${vista}: placa "${id}" aparece duas vezes`); continue; }
      vistos.add(id);
      let ok = true;
      for (const e of eixos) {
        const iv = ret[e];
        if (!Array.isArray(iv) || iv.length !== 2 || !iv.every(Number.isFinite)) {
          E('intervalo', id, `vista ${vista}: "${e}" de "${id}" deve ser [inicio, fim] em mm`); ok = false;
        } else if (!(iv[1] > iv[0])) {
          E('invertido', id, `vista ${vista}: "${e}" de "${id}" tem fim <= inicio (${iv[0]}, ${iv[1]})`); ok = false;
        }
      }
      if (!ok) continue;
      if (!porPlaca.has(id)) porPlaca.set(id, {});
      porPlaca.get(id)![vista] = ret;
    }
  }

  const placas: PlacaVista[] = [];
  for (const [id, p] of porPlaca) {
    const faltam = Object.keys(EIXOS).filter((vista) => !p[vista]);
    if (faltam.length) { E('falta-vista', id, `placa "${id}" falta na vista: ${faltam.join(', ')}`); continue; }
    let bate = true;
    const caixa = {} as Record<Eixo, Iv>;
    for (const [eixo, a, b] of PARES) {
      const ia = p[a][eixo];
      const ib = p[b][eixo];
      const d = Math.max(Math.abs(ia[0] - ib[0]), Math.abs(ia[1] - ib[1]));
      if (d > tol) {
        bate = false;
        E('nao-bate', id, `placa "${id}": eixo ${eixo.toUpperCase()} e [${ia}] na vista ${a} e [${ib}] na vista ${b} (diferenca ${r3(d)} mm)`);
      }
      caixa[eixo] = [ia[0], ia[1]];
    }
    if (!bate) continue;
    const dims = (['x', 'y', 'z'] as Eixo[]).map((e) => [e, caixa[e][1] - caixa[e][0]] as [Eixo, number]);
    if (temT) {
      const finos = dims.filter(([, d]) => Math.abs(d - t) <= tol);
      const menor = Math.min(...dims.map(([, d]) => d));
      const txt = dims.map(([e, d]) => `${e}=${r3(d)}`).join(', ');
      if (menor < t - tol) E('mais-fina', id, `placa "${id}": dimensao ${r3(menor)} mm menor que a espessura ${t} mm (${txt})`);
      else if (finos.length === 0) E('espessura-placa', id, `placa "${id}": nenhuma dimensao e igual a espessura ${t} mm (${txt})`);
      else if (finos.length > 1) avisos.push({ codigo: 'ripa', placa: id, msg: `placa "${id}": ${finos.length} dimensoes iguais a espessura (ripa ou pino); confira a orientacao` });
      const grandes = dims.map(([, d]) => d).sort((m, n) => n - m).slice(0, 2);
      const [ma, mb] = [...mesa].sort((m, n) => n - m);
      if (grandes[0] > ma + tol || grandes[1] > mb + tol) {
        E('maior-que-mesa', id, `placa "${id}": ${r3(grandes[0])} x ${r3(grandes[1])} mm nao cabe na mesa ${mesa[0]} x ${mesa[1]} mm`);
      }
    }
    placas.push({ id, x: caixa.x, y: caixa.y, z: caixa.z });
  }

  let envolvente: Conferencia['envolvente'] = null;
  if (placas.length) {
    const env = {} as Record<Eixo, Iv>;
    for (const e of ['x', 'y', 'z'] as Eixo[]) env[e] = [Math.min(...placas.map((q) => q[e][0])), Math.max(...placas.map((q) => q[e][1]))];
    envolvente = env;
  }

  // Scale lock: every real measure the user gave must show up unchanged in the model
  const reais = doc?.medidas_reais;
  if (!Array.isArray(reais) || reais.length === 0) {
    E('sem-medida-real', null, 'falta pelo menos UMA medida real (medidas_reais); foto nao tem escala — pergunte ao usuario');
  } else if (envolvente) {
    for (const m of reais) {
      const alvo: any = m?.alvo === 'envolvente' ? envolvente : placas.find((q) => q.id === m?.alvo);
      if (!alvo) { E('medida-real', null, `medida real aponta para "${m?.alvo}", que nao existe`); continue; }
      if (!['x', 'y', 'z'].includes(m.eixo) || !Number.isFinite(m.mm)) { E('medida-real', null, 'medida real precisa de eixo (x|y|z) e mm'); continue; }
      const tem = alvo[m.eixo][1] - alvo[m.eixo][0];
      if (Math.abs(tem - m.mm) > tol) {
        E('medida-real', m.alvo, `medida real "${m.o_que ?? ''}" = ${m.mm} mm no eixo ${m.eixo.toUpperCase()} de "${m.alvo}", mas as vistas dao ${r3(tem)} mm`);
      }
    }
  }

  return { ok: erros.length === 0, erros, avisos, placas, envolvente };
}
