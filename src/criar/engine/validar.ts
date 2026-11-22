// Port of ai/foto-para-pecas/montagem/validar.mjs: checks a kz-montagem/1 specification and classifies every pair of
// plates (L corner, T, X cross, stacked, collision). The bed comes from the request (was KZ_MESA).
/* eslint-disable @typescript-eslint/no-explicit-any */

export const EIXOS = ['x', 'y', 'z'] as const;
export type Eixo = (typeof EIXOS)[number];
const TOL = 0.01; // mm
const r3 = (v: number) => Math.round(v * 1000) / 1000;
const TIPO_AUTO: Record<string, string> = { L: 'dedos', T: 'espiga', X: 'meia-madeira', empilhadas: 'colado', 'topo-L': 'colado', 'topo-T': 'colado' };

export interface Placa {
  id: string; nome: string; x: [number, number]; y: [number, number]; z: [number, number];
  fino: number; eixo_espessura: Eixo; eixos_peca: [Eixo, Eixo]; peca: [number, number]; recortes: any[];
  [k: string]: any;
}
export interface Borda { eixo: Eixo; lado: 'inicio' | 'fim' }
export interface Par {
  a: string; b: string; tipo: string; eixo?: Eixo; comprimento?: number; contato?: Record<Eixo, [number, number]>;
  borda_a?: Borda | null; borda_b?: Borda | null; espiga?: string; furo?: string; motivo?: string; folga?: number;
  de_topo?: string; na_face?: string; area?: number; nota?: string;
}
export interface Ligacao { a: string; b: string; tipo: string; contato: string }
export interface Aviso { codigo: string; placas: string[]; msg: string }
export interface Validacao {
  ok: boolean; erros: Aviso[]; avisos: Aviso[]; nome?: string; espessura?: number;
  tamanho?: Record<Eixo, number> | null; placas: Placa[]; pares: Par[]; ligacoes: Ligacao[];
}

/** Classifies a pair of plates (already with .fino = index of the thickness axis). */
export function classificarPar(A: Placa, B: Placa, t: number): Par {
  const inter = EIXOS.map((k) => Math.min(A[k][1], B[k][1]) - Math.max(A[k][0], B[k][0]));
  const contato = Object.fromEntries(EIXOS.map((k) => [k, [r3(Math.max(A[k][0], B[k][0])), r3(Math.min(A[k][1], B[k][1]))]])) as Record<Eixo, [number, number]>;
  const base = { a: A.id, b: B.id };
  if (inter.some((v) => v < -TOL)) return { ...base, tipo: 'separadas', folga: r3(-Math.min(...inter)) };
  const zeros = inter.map((v, i) => (Math.abs(v) <= TOL ? i : -1)).filter((i) => i >= 0);
  const fa = A.fino, fb = B.fino;
  if (zeros.length >= 2) return { ...base, tipo: 'separadas', folga: 0, nota: 'so se tocam por uma aresta ou um canto' };
  if (zeros.length === 1) {
    const ez = zeros[0];
    const outros = [0, 1, 2].filter((i) => i !== ez);
    if (fa === fb) {
      if (ez === fa) return { ...base, tipo: 'empilhadas', eixo: EIXOS[ez], contato, area: r3(inter[outros[0]] * inter[outros[1]]) };
      return { ...base, tipo: 'separadas', folga: 0, nota: 'no mesmo plano, encostadas pela borda (sem encaixe)' };
    }
    if (ez !== fa && ez !== fb) return { ...base, tipo: 'separadas', folga: 0, nota: 'encostam so por um quadradinho de topo' };
    // One touches the face of the other with its end, no common volume: no finger or tenon without stretching the plate
    const [topo, face] = ez === fb ? [A, B] : [B, A];
    const ft = topo.fino, c = 3 - fa - fb;
    const naBorda = Math.abs(topo[EIXOS[ft]][0] - face[EIXOS[ft]][0]) <= TOL || Math.abs(topo[EIXOS[ft]][1] - face[EIXOS[ft]][1]) <= TOL;
    return { ...base, tipo: naBorda ? 'topo-L' : 'topo-T', de_topo: topo.id, na_face: face.id, eixo: EIXOS[c], comprimento: r3(inter[c]), contato };
  }
  // Common volume
  if (fa === fb) return { ...base, tipo: 'colisao', contato, motivo: 'placas paralelas ocupando o mesmo espaco' };
  const c = 3 - fa - fb;
  if (Math.abs(inter[fa] - t) > TOL || Math.abs(inter[fb] - t) > TOL) return { ...base, tipo: 'colisao', contato, motivo: 'uma placa entra na outra sem atravessar a espessura inteira' };
  const kb = EIXOS[fb], ka = EIXOS[fa];
  const aBaixo = Math.abs(A[kb][0] - B[kb][0]) <= TOL, aAlto = Math.abs(A[kb][1] - B[kb][1]) <= TOL;
  const bBaixo = Math.abs(B[ka][0] - A[ka][0]) <= TOL, bAlto = Math.abs(B[ka][1] - A[ka][1]) <= TOL;
  const aBorda = aBaixo || aAlto, bBorda = bBaixo || bAlto;
  const comum = {
    ...base, eixo: EIXOS[c], comprimento: r3(inter[c]), contato,
    // at which end of each plate the joint is (axis and side), so the builder finds the edge
    borda_a: aBorda ? { eixo: kb, lado: aBaixo ? 'inicio' : 'fim' } as Borda : null,
    borda_b: bBorda ? { eixo: ka, lado: bBaixo ? 'inicio' : 'fim' } as Borda : null,
  };
  if (aBorda && bBorda) return { ...comum, tipo: 'L' };
  if (aBorda) return { ...comum, tipo: 'T', espiga: A.id, furo: B.id };
  if (bBorda) return { ...comum, tipo: 'T', espiga: B.id, furo: A.id };
  return { ...comum, tipo: 'X' };
}

export function validar(spec: any, mesa: [number, number] = [400, 400]): Validacao {
  const [MESA_L, MESA_A] = mesa;
  const erros: Aviso[] = [], avisos: Aviso[] = [];
  const erro = (codigo: string, msg: string, placas: string[] = []) => erros.push({ codigo, placas, msg });
  const aviso = (codigo: string, msg: string, placas: string[] = []) => avisos.push({ codigo, placas, msg });
  const placas: Placa[] = [];
  const pares: Par[] = [];
  let ligacoes: Ligacao[] = [];
  const fim = (extra: Partial<Validacao> = {}): Validacao => ({ ok: erros.length === 0, erros, avisos, placas, pares, ligacoes, ...extra });

  if (!spec || typeof spec !== 'object') { erro('formato', 'A especificacao nao e um objeto JSON.'); return fim(); }
  if (spec.spec !== 'kz-montagem/1') erro('formato', `Campo "spec" deve ser "kz-montagem/1" (veio ${JSON.stringify(spec.spec)}).`);
  if (typeof spec.nome !== 'string' || !spec.nome.trim()) erro('formato', 'Falta o campo "nome".');
  const t = spec.espessura;
  if (typeof t !== 'number' || !(t > 0)) { erro('espessura', 'Falta a espessura do material em mm. Pergunte ao usuario: nao invente.'); return fim(); }
  if (t < 0.5 || t > 30) erro('medida-absurda', `Espessura de ${t} mm esta fora do que um laser corta (0,5 a 30 mm).`);
  if (!Array.isArray(spec.placas) || !spec.placas.length) { erro('formato', 'Falta a lista "placas".'); return fim(); }

  const ids = new Map<string, number>(), nomes = new Map<string, string>();
  for (const [i, p] of (spec.placas as any[]).entries()) {
    const id = typeof p?.id === 'string' && p.id ? p.id : `#${i}`;
    if (typeof p?.id !== 'string' || !p.id) erro('formato', `Placa na posicao ${i} sem "id".`, [id]);
    if (ids.has(id)) erro('id-repetido', `O id "${id}" aparece mais de uma vez.`, [id]);
    ids.set(id, i);
    if (typeof p?.nome === 'string') { if (nomes.has(p.nome)) erro('nome-repetido', `O nome "${p.nome}" esta em "${nomes.get(p.nome)}" e em "${id}".`, [nomes.get(p.nome)!, id]); else nomes.set(p.nome, id); }
    else erro('formato', `Placa "${id}" sem "nome".`, [id]);
    let ruim = false;
    for (const k of EIXOS) {
      const f = p?.[k];
      if (!Array.isArray(f) || f.length !== 2 || !f.every((v) => typeof v === 'number' && Number.isFinite(v))) { erro('formato', `Placa "${id}": "${k}" tem de ser [inicio, fim] em mm.`, [id]); ruim = true; }
      else if (!(f[1] > f[0])) { erro('medida-absurda', `Placa "${id}": em ${k} o fim (${f[1]}) nao e maior que o inicio (${f[0]}).`, [id]); ruim = true; }
    }
    if (ruim) continue;
    const d = EIXOS.map((k) => r3(p[k][1] - p[k][0]));
    const menor = Math.min(...d), fino = d.indexOf(menor);
    if (Math.abs(menor - t) > TOL) erro('espessura', `Placa "${id}": a menor dimensao e ${menor} mm (eixo ${EIXOS[fino]}), mas a espessura do material e ${t} mm.`, [id]);
    if (d.filter((v) => Math.abs(v - menor) <= TOL).length > 1) aviso('ripa', `Placa "${id}": duas dimensoes iguais a espessura (e uma ripa); o eixo da espessura foi assumido como ${EIXOS[fino]}.`, [id]);
    const [u, v] = [0, 1, 2].filter((a) => a !== fino);
    if (Math.max(...d) > 3000) erro('medida-absurda', `Placa "${id}": ${Math.max(...d)} mm e grande demais (limite 3000 mm). Confira a escala.`, [id]);
    else if (Math.min(d[u], d[v]) > Math.min(MESA_L, MESA_A) || Math.max(d[u], d[v]) > Math.max(MESA_L, MESA_A)) aviso('nao-cabe-na-mesa', `Placa "${id}": ${d[u]} x ${d[v]} mm nao cabe na mesa de ${MESA_L} x ${MESA_A} mm.`, [id]);
    if (Math.min(d[u], d[v]) < 3 * t && Math.abs(Math.min(d[u], d[v]) - t) > TOL) aviso('placa-estreita', `Placa "${id}": lado de ${Math.min(d[u], d[v])} mm e menor que 3 espessuras; o encaixe fica fragil.`, [id]);
    placas.push({ id, nome: p.nome, x: p.x, y: p.y, z: p.z, fino, eixo_espessura: EIXOS[fino], eixos_peca: [EIXOS[u], EIXOS[v]], peca: [d[u], d[v]], recortes: p.recortes ?? [] });
  }

  // Pairs
  for (let i = 0; i < placas.length; i++) for (let j = i + 1; j < placas.length; j++) {
    const par = classificarPar(placas[i], placas[j], t);
    if (par.tipo === 'separadas') continue;
    pares.push(par);
    if (par.tipo === 'colisao') erro('colisao', `"${par.a}" e "${par.b}" colidem: ${par.motivo}. Regiao x ${par.contato!.x.join('..')}, y ${par.contato!.y.join('..')}, z ${par.contato!.z.join('..')} mm.`, [par.a, par.b]);
    if (par.tipo === 'topo-L' || par.tipo === 'topo-T') aviso('de-topo', `"${par.de_topo}" so encosta de topo na face de "${par.na_face}" (sem volume em comum): fica colado, sem encaixe. Para dedos ou espiga, estique "${par.de_topo}" em ${t} mm ate a face de fora de "${par.na_face}".`, [par.a, par.b]);
  }

  // Joints: "auto" (default) or a list
  const porPar = new Map(pares.map((p) => [[p.a, p.b].sort().join('|'), p]));
  if (spec.ligacoes === undefined || spec.ligacoes === 'auto') {
    ligacoes = pares.filter((p) => p.tipo !== 'colisao').map((p) => ({ a: p.a, b: p.b, tipo: TIPO_AUTO[p.tipo], contato: p.tipo }));
  } else if (Array.isArray(spec.ligacoes)) {
    for (const l of spec.ligacoes) {
      if (!ids.has(l?.a) || !ids.has(l?.b)) { erro('ligacao', `Ligacao cita placa que nao existe: "${l?.a}" / "${l?.b}".`, [l?.a, l?.b].filter(Boolean)); continue; }
      const par = porPar.get([l.a, l.b].sort().join('|'));
      if (!par || par.tipo === 'colisao') { erro('ligacao', `Ligacao "${l.a}" + "${l.b}" (${l.tipo}): as placas nao se tocam.`, [l.a, l.b]); continue; }
      const esperado = TIPO_AUTO[par.tipo];
      if (l.tipo !== esperado && l.tipo !== 'colado' && !(l.tipo === 'dobradica' && (par.tipo === 'L' || par.tipo === 'topo-L')))
        erro('ligacao', `Ligacao "${l.a}" + "${l.b}": pediu "${l.tipo}", mas o contato e ${par.tipo} (cabe "${esperado}" ou "colado").`, [l.a, l.b]);
      ligacoes.push({ a: l.a, b: l.b, tipo: l.tipo, contato: par.tipo });
    }
  } else erro('formato', '"ligacoes" tem de ser "auto" ou uma lista.');

  // Loose plate: the joint graph must be one block
  const pai = new Map(placas.map((p) => [p.id, p.id]));
  const raiz = (a: string) => { while (pai.get(a) !== a) a = pai.get(a)!; return a; };
  for (const l of ligacoes) if (pai.has(l.a) && pai.has(l.b)) pai.set(raiz(l.a), raiz(l.b));
  const grupos = new Map<string, string[]>();
  for (const p of placas) { const g = raiz(p.id); grupos.set(g, [...(grupos.get(g) ?? []), p.id]); }
  if (grupos.size > 1) {
    const lista = [...grupos.values()].sort((a, b) => b.length - a.length);
    for (const g of lista.slice(1)) erro('placa-solta', `${g.length === 1 ? `A placa "${g[0]}" esta solta` : `As placas ${g.map((s) => `"${s}"`).join(', ')} formam um grupo solto`}: nao encosta no resto da montagem.`, g);
  }

  // Moving parts
  for (const m of Array.isArray(spec.moveis) ? spec.moveis : []) {
    if (!ids.has(m?.placa)) erro('movel', `Parte movel cita a placa "${m?.placa}", que nao existe.`, [m?.placa].filter(Boolean));
    if (!['dobradica', 'desliza', 'gira'].includes(m?.tipo)) erro('movel', `Parte movel de "${m?.placa}": tipo "${m?.tipo}" desconhecido.`, [m?.placa].filter(Boolean));
  }

  // Cut-outs and engravings: inside the face of the plate, on both of its axes
  const naFace = (p: Placa, r: any, k: Eixo) => Array.isArray(r?.[k]) && r[k].length === 2 && r[k][0] < r[k][1] && r[k][0] >= p[k][0] - TOL && r[k][1] <= p[k][1] + TOL;
  const pontoNaFace = (p: Placa, c: any, k: Eixo) => typeof c?.[k] === 'number' && c[k] >= p[k][0] - TOL && c[k] <= p[k][1] + TOL;
  for (const p of placas) {
    for (const [i, r] of (p.recortes ?? []).entries())
      for (const k of p.eixos_peca) if (!naFace(p, r, k)) erro('recorte', `Recorte ${i + 1} da placa "${p.id}": "${k}" tem de ser [inicio, fim] dentro da placa (${p[k][0]}..${p[k][1]}).`, [p.id]);
    const orig = (spec.placas ?? []).find((q: any) => q?.id === p.id);
    for (const [i, g] of ((orig?.gravuras ?? []) as any[]).entries()) {
      if (!g?.texto) erro('gravura', `Gravura ${i + 1} da placa "${p.id}" sem texto.`, [p.id]);
      for (const k of p.eixos_peca) if (!pontoNaFace(p, g?.centro, k)) erro('gravura', `Gravura "${g?.texto}" da placa "${p.id}": centro.${k} tem de cair dentro da placa (${p[k][0]}..${p[k][1]}).`, [p.id]);
    }
  }
  // A tenon that falls into a cut-out (window) of the slotted plate: the slot vanishes inside the window and the tenon
  // hangs in the air or hits the border. make_joint spreads tenons over the whole edge, so the window cannot be avoided:
  // the contact stays glued. (Measured on the piggy bank: with tenons the 3D view reported 5 overlaps.)
  const sobrepoe = (a: number[], b: number[]) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > TOL;
  for (const l of ligacoes) {
    if (l.contato !== 'T' || l.tipo !== 'espiga') continue;
    const par = porPar.get([l.a, l.b].sort().join('|'));
    const furo = placas.find((p) => p.id === par?.furo);
    const janela = (furo?.recortes ?? []).find((r: any) => furo!.eixos_peca.every((k) => Array.isArray(r?.[k]) && sobrepoe(par!.contato![k], r[k])));
    if (!janela || !furo || !par) continue;
    l.tipo = 'colado';
    aviso('espiga-na-janela', `"${par.espiga}" encosta em "${furo.id}" onde ha um recorte (${furo.eixos_peca.map((k) => `${k} ${janela[k].join('..')}`).join(', ')}): fica colado, sem espiga.`, [par.espiga!, furo.id]);
  }

  // Scene: layers stacked on the inner face of one plate
  const cena = spec.cena;
  if (cena) {
    const base = placas.find((p) => p.id === cena.sobre);
    if (!base) erro('cena', `A cena diz "sobre": "${cena.sobre}", que nao e uma placa.`, []);
    else {
      const FONTES = ['forma', 'biblioteca', 'desenho', 'web'];
      const pecasIds = new Set<string>();
      for (const [ci, c] of ((cena.camadas ?? []) as any[]).entries()) {
        if (!Array.isArray(c?.pecas) || !c.pecas.length) erro('cena', `Camada ${ci + 1} ("${c?.nome}") sem pecas.`, []);
        for (const pc of c?.pecas ?? []) {
          if (!pc?.id || pecasIds.has(pc.id)) erro('cena', `Peca da cena sem id ou com id repetido: "${pc?.id}".`, []);
          pecasIds.add(pc?.id);
          if (!FONTES.includes(pc?.fonte?.tipo)) erro('cena', `Peca "${pc?.id}": fonte.tipo tem de ser ${FONTES.join(', ')}.`, []);
          for (const k of base.eixos_peca) if (!naFace(base, pc?.caixa, k)) erro('cena', `Peca "${pc?.id}": caixa.${k} tem de ser [inicio, fim] dentro da placa "${base.id}" (${base[k][0]}..${base[k][1]}).`, []);
        }
      }
    }
  }

  const lim = EIXOS.map((k) => [Math.min(...placas.map((p) => p[k][0])), Math.max(...placas.map((p) => p[k][1]))]);
  return fim({ nome: spec.nome, espessura: t, tamanho: placas.length ? { x: r3(lim[0][1] - lim[0][0]), y: r3(lim[1][1] - lim[1][0]), z: r3(lim[2][1] - lim[2][0]) } : null });
}
