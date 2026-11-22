#!/usr/bin/env node
// montar.mjs — constroi no KizamuBeam, pelas ferramentas do proprio app, as pecas de uma especificacao kz-montagem/1.
//   node montar.mjs exemplos/caixa-aberta.json
// Precisa do app aberto em http://localhost:1421 (ou KZ_URL) e da biblioteca de automacao (KZ_LIB).
// Grava em saida/: <nome>-mesa.png, <nome>-3d.png, <nome>-check.json, <nome>-relatorio.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validar } from './validar.mjs';

const LIB = process.env.KZ_LIB ?? 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const AQUI = dirname(fileURLToPath(import.meta.url));
const SAIDA = join(AQUI, 'saida');
const [MESA, MESA_A] = (process.env.KZ_MESA ?? '400x400').split(/x/i).map(Number), MARGEM = 10, VAO = 12, TOL = 0.02;

const arquivo = process.argv[2];
if (!arquivo) { console.error('uso: node montar.mjs <especificacao.json>'); process.exit(2); }
const spec = JSON.parse(readFileSync(arquivo, 'utf8'));
const v = validar(spec);
if (!v.ok) { console.log(JSON.stringify({ ok: false, etapa: 'validar', erros: v.erros }, null, 2)); process.exit(1); }
const t = v.espessura, slug = basename(arquivo).replace(/\.json$/i, '');
mkdirSync(SAIDA, { recursive: true });

const { studio, sleep } = await import(LIB);
const { construirPeca, gravar, idsCriados } = await import('./silhuetas.mjs');
// --foto <arquivo>: a foto do usuario, para a IA conferir cada peca contra ela; --sem-ia: aceita a primeira tentativa
const argv = process.argv.slice(3);
const opt = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
const semIa = argv.includes('--sem-ia');
const fotoUsuario = opt('--foto') ? { type: 'image', source: { type: 'base64', media_type: ({ webp: 'image/webp', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg' })[opt('--foto').split('.').pop().toLowerCase()] ?? 'image/png', data: readFileSync(opt('--foto')).toString('base64') } } : null;
const custoIa = { chamadas: [], usd: 0 };
const ia = semIa ? null : async (etapa, conteudo) => {
  const { chamar, extrairJson } = await import('../harness/ia.mjs');
  const r = await chamar({ etapa, sistema: 'Voce e projetista de pecas de MDF para corte a laser. Responda so com o JSON pedido.', mensagens: [{ role: 'user', content: conteudo }], esforco: 'medium', maxTokens: 16000 });
  custoIa.chamadas.push({ etapa, modelo: r.modelo, ...r.uso });
  custoIa.usd = Math.round(custoIa.chamadas.reduce((a, c) => a + (c.usd ?? 0), 0) * 10000) / 10000;
  return extrairJson(r.texto);
};
// A C00 do KizamuBeam nasce em Preencher (gravacao); corte e camada em Linha. A C02 ja nasce em Linha com os valores
// de corte do proprio app. (Medido no cofrinho: com CORTE = 0 a cena e a janela iam para a maquina como gravacao e
// sumiam da Vista 3D, que so monta camada de corte.)
const CORTE = 2, GRAVACAO = 1;
const passo = (msg) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}
`);
const p = await studio('pt-BR');
const rel = { ok: true, nome: v.nome, espessura: t, pecas: [], encaixes: [], nao_feito: [], avisos: v.avisos };
try {
  await p.fresh();

  // 1. Cada placa vira um retangulo deitado na mesa, em fileiras, sem sobrepor
  const pos = new Map();
  let x = MARGEM, y = MARGEM, alturaFileira = 0;
  for (const pl of v.placas) {
    const [w, h] = pl.peca;
    if (x + w > MESA - MARGEM && x > MARGEM) { x = MARGEM; y += alturaFileira + VAO; alturaFileira = 0; }
    if (y + h > MESA_A - MARGEM) rel.avisos.push({ codigo: 'mesa-cheia', placas: [pl.id], msg: `A peca "${pl.id}" passou do limite da mesa de ${MESA} x ${MESA_A} mm.` });
    // A espiga do make_joint tenon SAI da aresta (soma 1 espessura). Entao, na ponta que leva espiga, o retangulo
    // nasce 1 espessura mais curto: o ombro fica na face da outra placa e a peca pronta fecha na medida exata.
    const corte = [[0, 0], [0, 0]]; // [eixo u|v][inicio|fim]
    for (const par of v.pares) {
      if (par.tipo !== 'T' || par.espiga !== pl.id) continue;
      const b = par.espiga === par.a ? par.borda_a : par.borda_b;
      corte[b.eixo === pl.eixos_peca[0] ? 0 : 1][b.lado === 'inicio' ? 0 : 1] = t;
    }
    const q = { x: x + corte[0][0], y: y + corte[1][0], w: w - corte[0][0] - corte[0][1], h: h - corte[1][0] - corte[1][1], w0: w, h0: h, pl, corte };
    const r = await p.tool('create_shape', { type: 'rect', x: q.x, y: q.y, width: q.w, height: q.h, layer: CORTE });
    const id = r?.id ?? r?.created?.[0] ?? r?.ids?.[0];
    if (typeof id !== 'number') throw Error(`create_shape nao devolveu id para "${pl.id}": ${JSON.stringify(r)}`);
    pos.set(pl.id, { id, ...q });
    rel.pecas.push({ placa: pl.id, id, x, y, largura: w, altura: h, eixos: pl.eixos_peca });
    x += w + VAO; alturaFileira = Math.max(alturaFileira, h);
  }

  // Acha, na peca 2D, a aresta reta que corresponde a uma borda 3D da placa (eixo + lado)
  const aresta = async (placaId, borda) => {
    const q = pos.get(placaId);
    const emU = borda.eixo === q.pl.eixos_peca[0];
    const alvo = emU ? (borda.lado === 'inicio' ? q.x : q.x + q.w) : (borda.lado === 'inicio' ? q.y : q.y + q.h);
    const k = emU ? 0 : 1;
    const { edges } = await p.tool('list_edges', { id: q.id });
    const cand = edges.filter((e) => Math.abs(e.from[k] - alvo) <= TOL && Math.abs(e.to[k] - alvo) <= TOL).sort((a, b) => b.length - a.length);
    if (!cand.length) throw Error(`nenhuma aresta reta de "${placaId}" em ${borda.eixo}/${borda.lado}`);
    return { id: q.id, sub: cand[0].sub, seg: cand[0].seg, comprimento: cand[0].length, de: cand[0].from, ate: cand[0].to };
  };

  const alinhar = [];
  // 2. Cada par em contato recebe o encaixe. Primeiro os de espiga (T) e os de meia-madeira (X), por ultimo os de dedos (L):
  // a espiga usa como referencia a borda inteira da placa que recebe os furos, e os dedos picam essa borda em trechos curtos
  // (medido: com os dedos antes, a divisoria pegou um trecho de 11,4 mm no lugar da borda de 57 mm e a Vista 3D acusou 4 sobreposicoes).
  const ORDEM = { T: 0, X: 1, L: 2 };
  for (const par of [...v.pares].sort((m, n) => (ORDEM[m.tipo] ?? 3) - (ORDEM[n.tipo] ?? 3))) {
    const lig = v.ligacoes.find((l) => (l.a === par.a && l.b === par.b) || (l.a === par.b && l.b === par.a));
    if (!lig) continue;
    const reg = { a: par.a, b: par.b, contato: par.tipo, tipo: lig.tipo, eixo: par.eixo, comprimento: par.comprimento };
    passo(`encaixe ${par.a}+${par.b} (${par.tipo})`);
    try {
      if (par.tipo === 'L' && lig.tipo === 'dedos') {
        const ea = await aresta(par.a, par.borda_a), eb = await aresta(par.b, par.borda_b);
        if (Math.abs(ea.comprimento - par.comprimento) > 0.5 || Math.abs(eb.comprimento - par.comprimento) > 0.5)
          reg.aviso = `aresta de ${ea.comprimento} / ${eb.comprimento} mm para contato de ${par.comprimento} mm`;
        const r = await p.tool('make_joint', { edges: [{ id: ea.id, sub: ea.sub, seg: ea.seg }, { id: eb.id, sub: eb.sub, seg: eb.seg }], kind: 'finger', thickness: t, direction: 'in' });
        reg.feito = true; reg.ferramenta = 'make_joint finger'; reg.resposta = r;
      } else if (par.tipo === 'T' && lig.tipo === 'espiga') {
        // espiga na borda de quem atravessa; furos numa linha desenhada na face da outra
        const e = par.espiga === par.a ? par.borda_a : par.borda_b;
        const ee = await aresta(par.espiga, e);
        const f = pos.get(par.furo), esp = pos.get(par.espiga).pl;
        const ke = esp.eixo_espessura;
        // Os furos vao DENTRO da propria placa: segunda aresta = a borda dela paralela ao encaixe, e slotOffset = distancia
        // dessa borda ate o meio da espessura de quem atravessa. (Com uma linha solta os furos viram objeto separado e a
        // Vista 3D acusa sobreposicao, porque a placa continua macica.)
        const dIni = (esp[ke][0] + esp[ke][1]) / 2 - f.pl[ke][0], dFim = f.pl[ke][1] - (esp[ke][0] + esp[ke][1]) / 2;
        const ef = await aresta(par.furo, { eixo: ke, lado: dIni <= dFim ? 'inicio' : 'fim' });
        if (Math.abs(ee.comprimento - ef.comprimento) > 0.5) reg.aviso = `a espiga tem ${ee.comprimento} mm de aresta e a borda de referencia dos furos tem ${ef.comprimento} mm: os furos podem nao casar`;
        const antes = await p.ev(`(async()=>{const { shapeSubs } = await import('/src/geom.ts'); return shapeSubs(window.editor.doc.objs.find((o)=>o.id===${f.id}).shape).length;})()`);
        const r = await p.tool('make_joint', { edges: [{ id: ee.id, sub: ee.sub, seg: ee.seg }, { id: ef.id, sub: ef.sub, seg: ef.seg }], kind: 'tenon', thickness: t, slotOffset: Math.min(dIni, dFim) });
        reg.feito = true; reg.ferramenta = 'make_joint tenon (slotOffset)'; reg.resposta = r; reg.slotOffset = Math.min(dIni, dFim);
        // O make_joint centra os furos no MEIO da aresta de referencia, e as espigas no meio da aresta da espiga; os dois
        // meios so coincidem por sorte. O alinhamento e feito depois de TODOS os encaixes (2a), quando ja se sabe para que
        // lado cada placa ficou virada na montagem. Aqui so se anota o que e preciso para isso.
        const depois = await p.ev(`(async()=>{const { shapeSubs } = await import('/src/geom.ts'); return shapeSubs(window.editor.doc.objs.find((o)=>o.id===${f.id}).shape).length;})()`);
        alinhar.push({ espiga: par.espiga, furo: par.furo, A: f.pl.eixos_peca.find((e) => e !== ke), ke, ee: { de: ee.de, ate: ee.ate }, subs: [antes, depois], reg });
        // confere onde os furos cairam de verdade (meio do furo, medido da mesma borda)
        const { edges } = await p.tool('list_edges', { id: f.id });
        const k = f.pl.eixos_peca[0] === ke ? 0 : 1, borda = (k === 0 ? f.x : f.y) + (dIni <= dFim ? 0 : (k === 0 ? f.w : f.h));
        const dist = edges.filter((e) => e.sub > 0).flatMap((e) => [Math.abs(e.from[k] - borda), Math.abs(e.to[k] - borda)]).filter((d) => Math.abs(d - Math.min(dIni, dFim)) <= t);
        reg.furo_medido = dist.length ? { de: Math.min(...dist), ate: Math.max(...dist), meio: (Math.min(...dist) + Math.max(...dist)) / 2, esperado: Math.min(dIni, dFim) } : null;
      } else if (par.tipo === 'X' && lig.tipo === 'meia-madeira') {
        // O make_joint lap poe UM rasgo no MEIO da aresta escolhida, com metade da altura em cada placa.
        // Entao so serve quando as duas placas se cruzam no meio e tem a mesma altura no eixo do cruzamento.
        const A = pos.get(par.a).pl, B = pos.get(par.b).pl, kc = par.eixo;
        const noMeio = (P, Q) => { const k = Q.eixo_espessura; return Math.abs((Q[k][0] + Q[k][1]) / 2 - (P[k][0] + P[k][1]) / 2) <= 0.05; };
        const mesmaAltura = Math.abs(A[kc][0] - B[kc][0]) <= TOL && Math.abs(A[kc][1] - B[kc][1]) <= TOL;
        if (!noMeio(A, B) || !noMeio(B, A) || !mesmaAltura) throw Error('cruzamento fora do meio da aresta ou placas de alturas diferentes: o make_joint lap so abre o rasgo no centro da aresta; falta uma ferramenta de rasgo em posicao livre');
        const ea = await aresta(par.a, { eixo: kc, lado: 'fim' }), eb = await aresta(par.b, { eixo: kc, lado: 'inicio' });
        const r = await p.tool('make_joint', { edges: [{ id: ea.id, sub: ea.sub, seg: ea.seg }, { id: eb.id, sub: eb.sub, seg: eb.seg }], kind: 'lap', thickness: t, lapCount: 1, lapDepth: 50 });
        reg.feito = true; reg.ferramenta = 'make_joint lap'; reg.resposta = r;
      } else {
        reg.feito = false;
        reg.motivo = `contato ${par.tipo} fica colado, sem encaixe`;
      }
    } catch (e) {
      reg.feito = false; reg.erro = String(e?.message ?? e);
      rel.nao_feito.push(reg);
    }
    rel.encaixes.push(reg);
  }

  // 2a. Furos no lugar das espigas. Cada placa entra na montagem 3D possivelmente virada (como numa caixa desmontada:
  // a face de dentro de uma e a de fora da outra). Le-se da propria Vista 3D para que lado cada eixo da mesa aponta, e
  // os furos (e a linha que monta a peca no 3D) andam ate o meio das espigas, na coordenada verdadeira.
  if (alinhar.length) {
    const cena3d = await p.ev(`(async()=>{
      const { collectScene } = await import('/src/view3d/panel.ts');
      const { solidBounds } = await import('/src/view3d/solids.ts');
      const { scene } = collectScene(window.editor, ${t});
      return scene.solids.filter((s) => s.key[0] === 'm').map((s) => ({ key: s.key, pose: s.pose, b: solidBounds(s) }));
    })()`);
    const porId = new Map(cena3d.map((s) => [Number(s.key.slice(1)), s]));
    // eixo da especificacao -> eixo do 3D (com sinal), pelas caixas das placas: comprimentos e posicoes batendo
    const eixo3d = {};
    for (const k of ['x', 'y', 'z']) {
      let melhorAj = null;
      for (let j = 0; j < 3; j++) for (const sg of [1, -1]) {
        const offs = [], erro = [];
        for (const [, q] of pos) {
          const s = porId.get(q.id); if (!s) continue;
          erro.push(Math.abs((s.b.max[j] - s.b.min[j]) - (q.pl[k][1] - q.pl[k][0])));
          offs.push(sg > 0 ? s.b.min[j] - q.pl[k][0] : s.b.min[j] + q.pl[k][1]);
        }
        const m = offs.reduce((x, y) => x + y, 0) / (offs.length || 1);
        const custo = erro.reduce((x, y) => x + y, 0) + offs.reduce((x, o) => x + Math.abs(o - m), 0);
        if (!melhorAj || custo < melhorAj.custo) melhorAj = { j, sg, custo };
      }
      eixo3d[k] = melhorAj;
    }
    // A placa esta virada no eixo da mesa? (1o eixo: x da mesa = pose.u; 2o: y da maquina = -pose.v, editor com y para baixo)
    const virada = (placaId, eixo) => {
      const q = pos.get(placaId), s = porId.get(q.id), k = q.pl.eixos_peca.indexOf(eixo);
      if (!s) return false;
      const d = k === 0 ? s.pose.u : s.pose.v.map((v) => -v);
      return d[eixo3d[eixo].j] * eixo3d[eixo].sg < 0;
    };
    // Mesa <-> especificacao num eixo da placa. A peca de verdade ocupa [ini + corteIni, fim - corteFim] (a ponta com
    // espiga nasce encurtada, no mesmo lado na mesa e na especificacao). Virada no 3D, essa peca encurtada e espelhada
    // nela mesma, nao na placa inteira. (Medido no cofrinho: sem descontar o corte, as divisorias viradas ficavam 3 mm
    // para a frente e entravam na moldura.)
    const especDe = (placaId, A, pt) => {
      const q = pos.get(placaId), pe = rel.pecas.find((x) => x.placa === placaId), k = q.pl.eixos_peca.indexOf(A);
      const d = k === 0 ? pt[0] - pe.x : pt[1] - pe.y, [ci, cf] = q.corte[k];
      return virada(placaId, A) ? q.pl[A][1] - cf - (d - ci) : q.pl[A][0] + d;
    };
    const mesaDe = (placaId, A, c) => {
      const q = pos.get(placaId), pe = rel.pecas.find((x) => x.placa === placaId), k = q.pl.eixos_peca.indexOf(A);
      const [ci, cf] = q.corte[k];
      return (k === 0 ? pe.x : pe.y) + (virada(placaId, A) ? ci + (q.pl[A][1] - cf - c) : c - q.pl[A][0]);
    };
    rel.eixos_3d = eixo3d;
    for (const a of alinhar) {
      // ao longo da espiga: meio dos furos = meio da espiga
      const cEspiga = (especDe(a.espiga, a.A, a.ee.de) + especDe(a.espiga, a.A, a.ee.ate)) / 2;
      const alvo = mesaDe(a.furo, a.A, cEspiga);
      const kF = pos.get(a.furo).pl.eixos_peca.indexOf(a.A);
      // na espessura de quem atravessa: linha dos furos = meio da espessura dela. O slotOffset do make_joint foi medido da
      // borda da MESA, que (a) pode ser a borda oposta na montagem, quando a placa entra virada no 3D, e (b) pode ser a
      // borda ja encurtada pela espiga da propria placa. Medido no cofrinho: base espelhada (410 - x) e prateleira +-3 mm.
      const espPl = pos.get(a.espiga).pl;
      const alvoK = mesaDe(a.furo, a.ke, (espPl[a.ke][0] + espPl[a.ke][1]) / 2);
      const kK = pos.get(a.furo).pl.eixos_peca.indexOf(a.ke);
      a.reg.furos_deslocados = await p.ev(`(async()=>{
        const { inv, apply } = await import('/src/mat.ts');
        const ed = window.editor, o = ed.doc.objs.find((x) => x.id === ${pos.get(a.furo).id});
        const novos = o.shape.subs.slice(${a.subs[0]}, ${a.subs[1]});
        if (!novos.length) return { furos: 0, mm: 0 };
        const pts = novos.flatMap((sp) => sp.nodes.map((n) => apply(o.m, n.x, n.y)));
        const coord = (q, k) => (k === 0 ? q.x : ed.doc.bed.h - q.y);
        const med = (k) => pts.reduce((s, q) => s + coord(q, k), 0) / pts.length;
        const r3 = (v) => Math.round(v * 1000) / 1000;
        const dA = r3(${alvo} - med(${kF})), dK = ${kK} >= 0 ? r3(${alvoK} - med(${kK})) : 0;
        if (Math.abs(dA) < 0.001 && Math.abs(dK) < 0.001) return { furos: novos.length, mm: 0, espessura_mm: 0 };
        const mesa = [0, 0]; mesa[${kF}] += dA; if (${kK} >= 0) mesa[${kK}] += dK;
        const delta = dA;
        const dx = mesa[0], dy = -mesa[1];
        const mi = inv(o.m), a0 = apply(mi, 0, 0), b0 = apply(mi, dx, dy), mx = b0.x - a0.x, my = b0.y - a0.y;
        ed.snapshot('Furos alinhados com as espigas');
        const anda = (pts) => pts.forEach((q) => { q.x += mx; q.y += my; });
        for (const sp of novos) for (const n of sp.nodes) { anda([n]); for (const c of [n.cin, n.cout]) if (c) anda([c]); }
        // a linha do meio dos furos monta a peca no 3D (Mate.b na espiga, Mate.a nos furos): anda junto
        const esp = ed.doc.objs.find((x) => x.id === ${pos.get(a.espiga).id});
        for (const mt of esp?.mates ?? []) if (mt.to === o.id) anda(mt.b);
        for (const mt of o.mates ?? []) if (mt.to === ${pos.get(a.espiga).id}) anda(mt.a);
        ed.emit('doc');
        return { furos: novos.length, mm: delta, espessura_mm: dK };
      })()`);
    }
  }

  // 2b. Precisao: a peca pronta tem de ter exatamente a medida da placa (o encaixe nao pode aumentar nem encolher)
  rel.medidas = [];
  for (const [placa, q] of pos) {
    const { edges } = await p.tool('list_edges', { id: q.id });
    const xs = edges.flatMap((e) => [e.from[0], e.to[0]]), ys = edges.flatMap((e) => [e.from[1], e.to[1]]);
    const medido = [Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100, Math.round((Math.max(...ys) - Math.min(...ys)) * 100) / 100];
    // A ponta que levaria espiga nasce 1 espessura mais curta; a espiga a devolve SO se foi feita. Contato colado
    // (ex.: atras de uma janela) fica curto de proposito, encostado na face da outra placa. (Medido no cofrinho: sem
    // isso, prateleira e divisorias davam "medida errada" 57 x 60 e o ciclo pagava voltas a toa.)
    const esperado = [q.w, q.h];
    for (const par of v.pares) {
      if (par.tipo !== 'T' || par.espiga !== placa) continue;
      const reg = rel.encaixes.find((e) => (e.a === par.a && e.b === par.b) || (e.a === par.b && e.b === par.a));
      if (!reg?.feito || !String(reg.ferramenta ?? '').startsWith('make_joint tenon')) continue;
      const b = par.espiga === par.a ? par.borda_a : par.borda_b;
      esperado[b.eixo === q.pl.eixos_peca[0] ? 0 : 1] += t;
    }
    const ok = Math.abs(medido[0] - esperado[0]) <= 0.05 && Math.abs(medido[1] - esperado[1]) <= 0.05;
    rel.medidas.push({ placa, esperado, medido, ok });
    if (!ok) rel.avisos.push({ codigo: 'medida-mudou', placas: [placa], msg: `A peca "${placa}" devia ter ${esperado[0]} x ${esperado[1]} mm e ficou com ${medido[0]} x ${medido[1]} mm depois dos encaixes.` });
  }

  // 2c. Recortes (janelas), gravacoes e a cena em camadas. Ponto 3D na face de uma placa -> ponto na mesa.
  const naMesa = (placaId, ponto) => {
    const q = pos.get(placaId), pe = rel.pecas.find((x) => x.placa === placaId), [a, b] = q.pl.eixos_peca;
    return { x: pe.x + (ponto[a] - q.pl[a][0]), y: pe.y + (ponto[b] - q.pl[b][0]) };
  };
  const caixaNaMesa = (placaId, cx) => {
    const q = pos.get(placaId), [a, b] = q.pl.eixos_peca;
    const p0 = naMesa(placaId, { [a]: cx[a][0], [b]: cx[b][0] }), p1 = naMesa(placaId, { [a]: cx[a][1], [b]: cx[b][1] });
    return { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
  };
  await p.tool('set_layer', { layer: GRAVACAO, name: 'Gravacao', mode: 'fill' }).catch((e) => rel.avisos.push({ codigo: 'camada-gravacao', msg: String(e?.message ?? e) }));
  rel.recortes = []; rel.gravuras = [];
  for (const sp of spec.placas) {
    if (!pos.has(sp.id)) continue;
    for (const r of sp.recortes ?? []) {
      // a janela e uma forma fechada DENTRO da placa: o laser corta e a Vista 3D a trata como furo
      const c = caixaNaMesa(sp.id, r);
      const ids = await p.tool('create_shape', { type: 'rect', x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: Math.min(r.raio ?? 0, c.w / 2, c.h / 2), layer: CORTE });
      rel.recortes.push({ placa: sp.id, mm: [c.w, c.h], id: ids?.id });
    }
    for (const g of sp.gravuras ?? []) rel.gravuras.push({ placa: sp.id, texto: g.texto, id: await gravar(p, g, naMesa(sp.id, g.centro), GRAVACAO) });
  }

  // 2d. Gravura na face de FORA. O laser grava a face de cima da chapa, e o KizamuBeam monta a caixa como quem dobra a
  // planta: a face de cima vai para DENTRO. (Medido no cofrinho: "PLANEJE, ECONOMIZE, VIAJE!" e a trilha R$20..R$1.000
  // ficavam na face de dentro da moldura.) Cortar a placa espelhada e vira-la da a mesma peca com a face do laser para
  // fora; o 3D do app entende placa espelhada como gravura na outra face. Janela e textos vao para o lugar espelhado,
  // sem espelhar a letra.
  rel.faces_gravadas = [];
  const comGravura = spec.placas.filter((sp) => pos.has(sp.id) && sp.gravuras?.length);
  if (comGravura.length) {
    const lado = () => p.ev(`(async()=>{
      const { collectScene } = await import('/src/view3d/panel.ts');
      const { solidBounds } = await import('/src/view3d/solids.ts');
      // com algo selecionado, collectScene so olha a selecao (o ultimo texto criado fica selecionado)
      window.editor.setSel([]);
      const { scene } = collectScene(window.editor, ${t});
      const caixa = scene.solids.filter((s) => /^m\\d/.test(s.key));
      const bs = caixa.map((s) => solidBounds(s));
      const c = [0, 1, 2].map((i) => (Math.min(...bs.map((b) => b.min[i])) + Math.max(...bs.map((b) => b.max[i]))) / 2);
      return Object.fromEntries(caixa.map((s, k) => {
        const m = [0, 1, 2].map((i) => (bs[k].min[i] + bs[k].max[i]) / 2);
        const nFora = [0, 1, 2].reduce((d, i) => d + (m[i] - c[i]) * s.pose.n[i], 0) > 0;
        return [s.key.slice(1), s.engraving ? (s.engraving.top === nFora ? 'fora' : 'dentro') : null];
      }));
    })()`);
    const antes = await lado();
    for (const sp of comGravura) {
      const q = pos.get(sp.id), reg = { placa: sp.id, antes: antes[q.id] ?? 'sem gravura no 3D' };
      if (antes[q.id] === 'dentro') {
        const junto = [...rel.recortes, ...rel.gravuras].filter((x) => x.placa === sp.id && typeof x.id === 'number').map((x) => x.id);
        const cx = q.x + q.w / 2;
        await p.ev(`(async()=>{
          const { mul, about, scale, translate } = await import('/src/mat.ts');
          const { boundsOf } = await import('/src/geom.ts');
          const ed = window.editor, achar = (id) => ed.doc.objs.find((o) => o.id === id);
          ed.snapshot('Face gravada para fora');
          const placa = achar(${q.id});
          placa.m = mul(about(scale(-1, 1), ${cx}, 0), placa.m);
          for (const id of ${JSON.stringify(junto)}) {
            const o = achar(id); if (!o) continue;
            const b = boundsOf([o]), meio = b.x + b.w / 2;
            o.m = mul(translate(2 * (${cx} - meio), 0), o.m);
          }
          ed.emit('doc');
          return true;
        })()`);
        reg.espelhada = true; reg.levados = junto.length;
      }
      rel.faces_gravadas.push(reg);
    }
    const depois = await lado();
    for (const reg of rel.faces_gravadas) {
      reg.depois = depois[pos.get(reg.placa).id] ?? 'sem gravura no 3D';
      if (reg.depois !== 'fora') rel.avisos.push({ codigo: 'gravura-por-dentro', placas: [reg.placa], msg: `A gravura de "${reg.placa}" ficou na face de dentro da caixa.` });
    }
  }
  rel.cena = null;
  if (spec.cena?.camadas?.length && pos.has(spec.cena.sobre)) {
    const base = spec.cena.sobre, registro = [], camadas = [];
    for (const c of spec.cena.camadas) {
      const ids = [];
      for (const pc of c.pecas) {
        const caixa = caixaNaMesa(base, pc.caixa);
        passo(`peca da cena: ${pc.id} (${pc.fonte?.tipo})`);
        try {
          const r = await construirPeca(p, pc, caixa, { camada: CORTE, ia, fotoUsuario, notaMinima: 7, maxWeb: 4, registro });
          ids.push(r.id);
          for (const g of pc.gravuras ?? []) rel.gravuras.push({ peca: pc.id, texto: g.texto, id: await gravar(p, g, naMesa(base, g.centro ?? { [pos.get(base).pl.eixos_peca[0]]: (pc.caixa[pos.get(base).pl.eixos_peca[0]][0] + pc.caixa[pos.get(base).pl.eixos_peca[0]][1]) / 2, [pos.get(base).pl.eixos_peca[1]]: (pc.caixa[pos.get(base).pl.eixos_peca[1]][0] + pc.caixa[pos.get(base).pl.eixos_peca[1]][1]) / 2 }), GRAVACAO) });
        } catch (e) {
          rel.nao_feito.push({ peca: pc.id, erro: String(e?.message ?? e) });
        }
      }
      if (!ids.length) continue;
      const id = ids.length > 1 ? idsCriados(await p.tool('group', { ids }))[0] : ids[0];
      camadas.push({ id, nome: c.nome, cor: c.cor });
    }
    // as camadas viram um trabalho multicamada montado sobre a placa de base (a Vista 3D empilha dentro da caixa)
    rel.cena = await p.ev(`(async()=>{
      const { makeAssembly, plateAnchor } = await import('/src/multilayer.ts');
      const ed = window.editor, camadas = ${JSON.stringify(camadas)};
      ed.snapshot('Cena em camadas');
      const a = makeAssembly(camadas.map((c) => ({ object: c.id, name: c.nome, thickness: ${t}, look: c.cor ? { id: 'plain', color: c.cor } : { id: 'birch' }, anchor: plateAnchor(ed.doc.objs.find((o) => o.id === c.id)) })));
      a.mount = ${pos.get(base).id};
      (ed.doc.multiLayerAssemblies ??= []).push(a);
      ed.emit('doc');
      return { camadas: camadas.length, sobre: ${JSON.stringify(base)} };
    })()`);
    rel.cena.pecas = registro;
  }
  rel.custo_ia = custoIa;

  passo('fotos e vista 3D');
  // 3. Fotos e conferencia do proprio sistema (sem selecao, senao a Vista 3D mostra so o objeto selecionado)
  await p.tool('select', { ids: [] });
  await sleep(400);
  await p.shot(join(SAIDA, `${slug}-mesa.png`));
  await p.show('view3d');
  await sleep(3500);
  await p.shot(join(SAIDA, `${slug}-3d.png`));
  // A Vista 3D como DADO, para a IA e para o codigo: o mesmo calculo que a janela usa (collectScene), com cada
  // colisao dizendo QUAIS placas e ONDE (caixa em mm no espaco da Vista 3D), e fotos dos tres angulos da janela.
  const nomes = Object.fromEntries([...pos].map(([placa, q]) => ['m' + q.id, placa]));
  rel.vista3d_dados = await p.ev(`(async()=>{
    const { collectScene } = await import('/src/view3d/panel.ts');
    const { solidBounds } = await import('/src/view3d/solids.ts');
    const nomes = ${JSON.stringify(nomes)};
    const nome = (k) => nomes[k] ?? k;
    const r2 = (v) => v.map((n) => Math.round(n * 100) / 100);
    const caixa = (s) => { const b = solidBounds(s); return { min: r2(b.min), max: r2(b.max) }; };
    const { scene, asms } = collectScene(window.editor, ${t});
    return {
      pecas: scene.solids.length, conjuntos: asms,
      placas: scene.solids.map((s) => ({ placa: nome(s.key), ...caixa(s) })),
      colisoes: scene.overlaps.map((o) => ({ a: nome(o.a), b: nome(o.b), volume_mm3: Math.round(o.volume * 10) / 10, onde: o.pieces.map(caixa) })),
    };
  })()`);
  const vistas = { iso: 0, topo: 1, frente: 2 };
  for (const [nomeVista, i] of Object.entries(vistas)) {
    await p.ev(`(async()=>{const { windowBody } = await window.__kzImport('/src/dock.ts'); windowBody('view3d').querySelectorAll('button')[${i}].click(); return true;})()`);
    await sleep(900);
    await p.shot(join(SAIDA, `${slug}-3d-${nomeVista}.png`));
  }
  const check = await p.tool('check_design', {});
  writeFileSync(join(SAIDA, `${slug}-check.json`), JSON.stringify(check, null, 2));
  rel.check_design = { total: check?.issues?.length ?? check?.findings?.length ?? null, resumo: check?.summary ?? null };
  rel.vista3d = await p.ev(`(()=>{const e=[...document.querySelectorAll('*')].filter(n=>n.children.length===0&&/Pe[cç]as: \\d+/.test(n.textContent||''));return e.length?e[e.length-1].textContent.trim():null;})()`);
  rel.erros_da_pagina = Array.isArray(p.errors) ? p.errors.slice(0, 10) : [];
  rel.perguntas_do_app = p.dialogs ?? [];
  // o projeto inteiro, para abrir no KizamuBeam (Arquivo -> Abrir) e cortar
  rel.projeto = join(SAIDA, `${slug}.kzb`);
  writeFileSync(rel.projeto, await p.ev('window.editor.serialize()'));
} catch (e) {
  rel.ok = false; rel.erro = String(e?.stack ?? e);
} finally {
  rel.ok = rel.ok && rel.encaixes.every((e) => e.feito !== false || !e.erro);
  writeFileSync(join(SAIDA, `${slug}-relatorio.json`), JSON.stringify(rel, null, 2));
  await p.close();
}
console.log(JSON.stringify({ ok: rel.ok, pecas: rel.pecas.length, encaixes: rel.encaixes.map((e) => `${e.a}+${e.b}: ${e.contato} -> ${e.feito ? e.ferramenta : 'NAO FEITO (' + (e.erro ?? e.motivo) + ')'}`), erro: rel.erro, saida: SAIDA }, null, 2));
process.exit(rel.ok ? 0 : 1);
