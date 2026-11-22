#!/usr/bin/env node
// validar.mjs — confere uma especificacao kz-montagem/1 (Node puro, sem dependencia).
//   node validar.mjs exemplos/caixa-aberta.json     -> JSON com erros, avisos, placas e pares
//   node validar.mjs --teste                        -> casos embutidos, imprime ok/falhou
// Sai com codigo 1 quando ha erro.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const EIXOS = ['x', 'y', 'z'];
const TOL = 0.01; // mm
// area util de corte (largura x altura, mm): KZ_MESA="600x400"; padrao 400 x 400
const [MESA_L, MESA_A] = (process.env.KZ_MESA ?? '400x400').split(/x/i).map(Number);
const MESA = Math.min(MESA_L, MESA_A);
const r3 = (v) => Math.round(v * 1000) / 1000;
const TIPO_AUTO = { L: 'dedos', T: 'espiga', X: 'meia-madeira', empilhadas: 'colado', 'topo-L': 'colado', 'topo-T': 'colado' };

/** Classifica um par de placas (ja com .fino = indice do eixo da espessura). */
export function classificarPar(A, B, t) {
  const inter = EIXOS.map((k) => Math.min(A[k][1], B[k][1]) - Math.max(A[k][0], B[k][0]));
  const contato = Object.fromEntries(EIXOS.map((k) => [k, [r3(Math.max(A[k][0], B[k][0])), r3(Math.min(A[k][1], B[k][1]))]]));
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
    // Uma encosta de topo na face da outra, sem volume em comum: nao da para fazer dedo nem espiga sem esticar a placa.
    const [topo, face] = ez === fb ? [A, B] : [B, A];
    const ft = topo.fino, c = 3 - fa - fb;
    const naBorda = Math.abs(topo[EIXOS[ft]][0] - face[EIXOS[ft]][0]) <= TOL || Math.abs(topo[EIXOS[ft]][1] - face[EIXOS[ft]][1]) <= TOL;
    return { ...base, tipo: naBorda ? 'topo-L' : 'topo-T', de_topo: topo.id, na_face: face.id, eixo: EIXOS[c], comprimento: r3(inter[c]), contato };
  }
  // Volume em comum
  if (fa === fb) return { ...base, tipo: 'colisao', contato, motivo: 'placas paralelas ocupando o mesmo espaco' };
  const c = 3 - fa - fb;
  if (Math.abs(inter[fa] - t) > TOL || Math.abs(inter[fb] - t) > TOL) return { ...base, tipo: 'colisao', contato, motivo: 'uma placa entra na outra sem atravessar a espessura inteira' };
  const kb = EIXOS[fb], ka = EIXOS[fa];
  const aBaixo = Math.abs(A[kb][0] - B[kb][0]) <= TOL, aAlto = Math.abs(A[kb][1] - B[kb][1]) <= TOL;
  const bBaixo = Math.abs(B[ka][0] - A[ka][0]) <= TOL, bAlto = Math.abs(B[ka][1] - A[ka][1]) <= TOL;
  const aBorda = aBaixo || aAlto, bBorda = bBaixo || bAlto;
  const comum = {
    ...base, eixo: EIXOS[c], comprimento: r3(inter[c]), contato,
    // em qual ponta de cada placa fica o encaixe (eixo e lado), para o construtor achar a aresta
    borda_a: aBorda ? { eixo: kb, lado: aBaixo ? 'inicio' : 'fim' } : null,
    borda_b: bBorda ? { eixo: ka, lado: bBaixo ? 'inicio' : 'fim' } : null,
  };
  if (aBorda && bBorda) return { ...comum, tipo: 'L' };
  if (aBorda) return { ...comum, tipo: 'T', espiga: A.id, furo: B.id };
  if (bBorda) return { ...comum, tipo: 'T', espiga: B.id, furo: A.id };
  return { ...comum, tipo: 'X' };
}

export function validar(spec) {
  const erros = [], avisos = [];
  const erro = (codigo, msg, placas = []) => erros.push({ codigo, placas, msg });
  const aviso = (codigo, msg, placas = []) => avisos.push({ codigo, placas, msg });
  const fim = (extra = {}) => ({ ok: erros.length === 0, erros, avisos, ...extra });

  if (!spec || typeof spec !== 'object') { erro('formato', 'A especificacao nao e um objeto JSON.'); return fim(); }
  if (spec.spec !== 'kz-montagem/1') erro('formato', `Campo "spec" deve ser "kz-montagem/1" (veio ${JSON.stringify(spec.spec)}).`);
  if (typeof spec.nome !== 'string' || !spec.nome.trim()) erro('formato', 'Falta o campo "nome".');
  const t = spec.espessura;
  if (typeof t !== 'number' || !(t > 0)) { erro('espessura', 'Falta a espessura do material em mm. Pergunte ao usuario: nao invente.'); return fim(); }
  if (t < 0.5 || t > 30) erro('medida-absurda', `Espessura de ${t} mm esta fora do que um laser corta (0,5 a 30 mm).`);
  if (!Array.isArray(spec.placas) || !spec.placas.length) { erro('formato', 'Falta a lista "placas".'); return fim(); }

  const placas = [], ids = new Map(), nomes = new Map();
  for (const [i, p] of spec.placas.entries()) {
    const id = typeof p?.id === 'string' && p.id ? p.id : `#${i}`;
    if (typeof p?.id !== 'string' || !p.id) erro('formato', `Placa na posicao ${i} sem "id".`, [id]);
    if (ids.has(id)) erro('id-repetido', `O id "${id}" aparece mais de uma vez.`, [id]);
    ids.set(id, i);
    if (typeof p?.nome === 'string') { if (nomes.has(p.nome)) erro('nome-repetido', `O nome "${p.nome}" esta em "${nomes.get(p.nome)}" e em "${id}".`, [nomes.get(p.nome), id]); else nomes.set(p.nome, id); }
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

  // Pares
  const pares = [];
  for (let i = 0; i < placas.length; i++) for (let j = i + 1; j < placas.length; j++) {
    const par = classificarPar(placas[i], placas[j], t);
    if (par.tipo === 'separadas') continue;
    pares.push(par);
    if (par.tipo === 'colisao') erro('colisao', `"${par.a}" e "${par.b}" colidem: ${par.motivo}. Regiao x ${par.contato.x.join('..')}, y ${par.contato.y.join('..')}, z ${par.contato.z.join('..')} mm.`, [par.a, par.b]);
    if (par.tipo === 'topo-L' || par.tipo === 'topo-T') aviso('de-topo', `"${par.de_topo}" so encosta de topo na face de "${par.na_face}" (sem volume em comum): fica colado, sem encaixe. Para dedos ou espiga, estique "${par.de_topo}" em ${t} mm ate a face de fora de "${par.na_face}".`, [par.a, par.b]);
  }

  // Ligacoes: "auto" (padrao) ou lista
  const porPar = new Map(pares.map((p) => [[p.a, p.b].sort().join('|'), p]));
  let ligacoes = [];
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

  // Placa solta: o grafo das ligacoes tem de ser um bloco so
  const pai = new Map(placas.map((p) => [p.id, p.id]));
  const raiz = (a) => { while (pai.get(a) !== a) a = pai.get(a); return a; };
  for (const l of ligacoes) if (pai.has(l.a) && pai.has(l.b)) pai.set(raiz(l.a), raiz(l.b));
  const grupos = new Map();
  for (const p of placas) { const g = raiz(p.id); grupos.set(g, [...(grupos.get(g) ?? []), p.id]); }
  if (grupos.size > 1) {
    const lista = [...grupos.values()].sort((a, b) => b.length - a.length);
    for (const g of lista.slice(1)) erro('placa-solta', `${g.length === 1 ? `A placa "${g[0]}" esta solta` : `As placas ${g.map((s) => `"${s}"`).join(', ')} formam um grupo solto`}: nao encosta no resto da montagem.`, g);
  }

  // Partes moveis
  for (const m of Array.isArray(spec.moveis) ? spec.moveis : []) {
    if (!ids.has(m?.placa)) erro('movel', `Parte movel cita a placa "${m?.placa}", que nao existe.`, [m?.placa].filter(Boolean));
    if (!['dobradica', 'desliza', 'gira'].includes(m?.tipo)) erro('movel', `Parte movel de "${m?.placa}": tipo "${m?.tipo}" desconhecido.`, [m?.placa].filter(Boolean));
  }

  // Recortes e gravacoes: dentro da face da placa, nos dois eixos dela
  const naFace = (p, r, k) => Array.isArray(r?.[k]) && r[k].length === 2 && r[k][0] < r[k][1] && r[k][0] >= p[k][0] - TOL && r[k][1] <= p[k][1] + TOL;
  const pontoNaFace = (p, c, k) => typeof c?.[k] === 'number' && c[k] >= p[k][0] - TOL && c[k] <= p[k][1] + TOL;
  for (const p of placas) {
    for (const [i, r] of (p.recortes ?? []).entries())
      for (const k of p.eixos_peca) if (!naFace(p, r, k)) erro('recorte', `Recorte ${i + 1} da placa "${p.id}": "${k}" tem de ser [inicio, fim] dentro da placa (${p[k][0]}..${p[k][1]}).`, [p.id]);
    const orig = (spec.placas ?? []).find((q) => q?.id === p.id);
    for (const [i, g] of (orig?.gravuras ?? []).entries()) {
      if (!g?.texto) erro('gravura', `Gravura ${i + 1} da placa "${p.id}" sem texto.`, [p.id]);
      for (const k of p.eixos_peca) if (!pontoNaFace(p, g?.centro, k)) erro('gravura', `Gravura "${g?.texto}" da placa "${p.id}": centro.${k} tem de cair dentro da placa (${p[k][0]}..${p[k][1]}).`, [p.id]);
    }
  }
  // Espiga que cai num recorte (janela) da placa dos furos: o furo some dentro da janela e a espiga fica no vazio ou
  // bate na borda. O make_joint espalha as espigas pela aresta inteira, entao nao da para fugir da janela: o contato
  // fica colado/encostado. (Medido no cofrinho: as divisorias e a prateleira encostam na moldura da frente dentro da
  // janela; com espiga, a Vista 3D acusou 5 sobreposicoes. Na foto elas ficam atras da janela, sem encaixe.)
  const sobrepoe = (a, b) => Math.min(a[1], b[1]) - Math.max(a[0], b[0]) > TOL;
  for (const l of ligacoes) {
    if (l.contato !== 'T' || l.tipo !== 'espiga') continue;
    const par = porPar.get([l.a, l.b].sort().join('|'));
    const furo = placas.find((p) => p.id === par?.furo);
    const janela = (furo?.recortes ?? []).find((r) => furo.eixos_peca.every((k) => Array.isArray(r?.[k]) && sobrepoe(par.contato[k], r[k])));
    if (!janela) continue;
    l.tipo = 'colado';
    aviso('espiga-na-janela', `"${par.espiga}" encosta em "${furo.id}" onde ha um recorte (${furo.eixos_peca.map((k) => `${k} ${janela[k].join('..')}`).join(', ')}): fica colado, sem espiga.`, [par.espiga, furo.id]);
  }

  // Cena: camadas empilhadas sobre a face de dentro de uma placa
  const cena = spec.cena;
  if (cena) {
    const base = placas.find((p) => p.id === cena.sobre);
    if (!base) erro('cena', `A cena diz "sobre": "${cena.sobre}", que nao e uma placa.`, []);
    else {
      const FONTES = ['forma', 'biblioteca', 'desenho', 'web'];
      const pecasIds = new Set();
      for (const [ci, c] of (cena.camadas ?? []).entries()) {
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
  return fim({ nome: spec.nome, espessura: t, tamanho: placas.length ? { x: r3(lim[0][1] - lim[0][0]), y: r3(lim[1][1] - lim[1][0]), z: r3(lim[2][1] - lim[2][0]) } : null, placas, pares, ligacoes });
}

// ---------- casos embutidos ----------
function casos() {
  const caixa = () => ({
    spec: 'kz-montagem/1', nome: 'caixa de teste', espessura: 3, ligacoes: 'auto',
    placas: [
      { id: 'fundo', nome: 'Fundo', x: [0, 100], y: [0, 80], z: [0, 3] },
      { id: 'frente', nome: 'Frente', x: [0, 100], y: [0, 3], z: [0, 50] },
      { id: 'tras', nome: 'Tras', x: [0, 100], y: [77, 80], z: [0, 50] },
      { id: 'esq', nome: 'Esquerda', x: [0, 3], y: [0, 80], z: [0, 50] },
      { id: 'dir', nome: 'Direita', x: [97, 100], y: [0, 80], z: [0, 50] },
    ],
  });
  const com = (f) => { const s = caixa(); f(s); return s; };
  return [
    { nome: 'valida (caixa aberta, 8 cantos em L)', spec: caixa(), espera: (r) => r.ok && r.pares.length === 8 && r.pares.every((p) => p.tipo === 'L') },
    { nome: 'colisao (placa atravessada no meio do fundo)', spec: com((s) => s.placas.push({ id: 'intruso', nome: 'Intruso', x: [20, 60], y: [20, 60], z: [1, 4] })), espera: (r) => !r.ok && r.erros.some((e) => e.codigo === 'colisao' && e.placas.includes('intruso')) },
    { nome: 'placa solta (longe de tudo)', spec: com((s) => s.placas.push({ id: 'solta', nome: 'Solta', x: [200, 260], y: [0, 40], z: [0, 3] })), espera: (r) => !r.ok && r.erros.some((e) => e.codigo === 'placa-solta' && e.placas.includes('solta')) },
    { nome: 'espessura errada (frente com 4 mm em material de 3)', spec: com((s) => { s.placas[1].y = [0, 4]; }), espera: (r) => !r.ok && r.erros.some((e) => e.codigo === 'espessura' && e.placas.includes('frente')) },
    { nome: 'T e X reconhecidos (prateleira atravessa a lateral; duas nervuras cruzadas)', spec: { spec: 'kz-montagem/1', nome: 't-x', espessura: 3, placas: [
      { id: 'lat', nome: 'Lateral', x: [0, 3], y: [0, 60], z: [0, 100] },
      { id: 'prat', nome: 'Prateleira', x: [0, 80], y: [0, 60], z: [40, 43] },
      { id: 'nerv', nome: 'Nervura', x: [30, 33], y: [0, 60], z: [20, 60] },
    ] }, espera: (r) => r.ok && r.pares.some((p) => p.tipo === 'T' && p.espiga === 'prat' && p.furo === 'lat') && r.pares.some((p) => p.tipo === 'X') },
  ];
}

const direto = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direto) {
  const arg = process.argv[2];
  if (arg === '--teste') {
    let falhas = 0;
    for (const c of casos()) {
      const r = validar(c.spec);
      const ok = !!c.espera(r);
      if (!ok) falhas++;
      console.log(`${ok ? 'ok    ' : 'FALHOU'}  ${c.nome}${ok ? '' : '\n        ' + JSON.stringify({ erros: r.erros, pares: (r.pares ?? []).map((p) => `${p.a}+${p.b}=${p.tipo}`) })}`);
    }
    console.log(falhas ? `${falhas} caso(s) falharam` : 'todos os casos passaram');
    process.exit(falhas ? 1 : 0);
  }
  if (!arg) { console.error('uso: node validar.mjs <especificacao.json> | --teste'); process.exit(2); }
  let spec;
  try { spec = JSON.parse(readFileSync(arg, 'utf8')); }
  catch (e) { console.log(JSON.stringify({ ok: false, erros: [{ codigo: 'formato', placas: [], msg: 'Nao consegui ler o JSON: ' + e.message }], avisos: [] }, null, 2)); process.exit(1); }
  const r = validar(spec);
  console.log(JSON.stringify(r, null, 2));
  process.exit(r.ok ? 0 : 1);
}
