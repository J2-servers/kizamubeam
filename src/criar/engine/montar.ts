// Port of ai/foto-para-pecas/montagem/montar.mjs: builds, with the program's own tools, the parts of a kz-montagem/1
// specification in the editor: plates, joints, holes lined up with the tenons, windows, engravings turned outwards,
// the layered scene mounted on its plate, and the 3D check (collectScene, the same calculation as the 3D view).
/* eslint-disable @typescript-eslint/no-explicit-any */
import { collectScene } from '../../view3d/panel';
import { solidBounds } from '../../view3d/solids';
import { makeAssembly, plateAnchor } from '../../multilayer';
import { boundsOf, shapeSubs } from '../../geom';
import { about, apply, inv, mul, scale, translate } from '../../mat';
import type { Obj } from '../../model';
import type { Kit, Rec } from './kit';
import { validar, type Borda, type Eixo, type Placa, type Validacao } from './validar';
import { construirPeca, fotoDaPeca, gravar, idsCriados, type PecaCtx, type Registro } from './silhuetas';

const MARGEM = 10, VAO = 12, TOL = 0.02;
// Layer C00 of KizamuBeam starts as Fill (engraving); cut is Line. C02 already starts as Line with the program's own
// cut values. (Measured on the piggy bank: with CORTE = 0 the scene and the window went to the machine as engraving and
// disappeared from the 3D view, which only builds cut layers.)
const CORTE = 2, GRAVACAO = 1;

export interface PecaFeita { id: string; nome: string; nota: number; origem: string; ok: boolean; image?: string }

export interface Relatorio {
  ok: boolean; nome?: string; espessura: number;
  pecas: { placa: string; id: number; x: number; y: number; largura: number; altura: number; eixos: [Eixo, Eixo] }[];
  encaixes: Rec[]; nao_feito: Rec[]; avisos: Rec[];
  medidas: { placa: string; esperado: [number, number]; medido: [number, number]; ok: boolean }[];
  recortes: Rec[]; gravuras: Rec[]; faces_gravadas: Rec[];
  cena: { camadas: number; sobre: string; pecas: Registro[] } | null;
  eixos_3d?: Rec;
  vista3d_dados?: { pecas: number; conjuntos: number; placas: Rec[]; colisoes: Rec[] };
  check_design?: { total: number | null; resumo: unknown };
  erro?: string;
}

export interface MontarOpts {
  mesa: [number, number];
  ia: PecaCtx['ia'];
  fotoUsuario: PecaCtx['fotoUsuario'];
  notaMinima: number;
  maxWeb: number;
  /** Every decorative part as soon as it is built */
  onPeca?: (p: PecaFeita) => void;
}

interface Pos {
  id: number; x: number; y: number; w: number; h: number; w0: number; h0: number; pl: Placa; corte: [[number, number], [number, number]];
  /** Tenons really made on the shortened ends, per axis of the part (each adds back 1 thickness) */
  espigas: [number, number];
}

const r3 = (v: number) => Math.round(v * 1000) / 1000;

/** Selection empty: with something selected collectScene only looks at the selection (the last text created stays selected) */
function cena3d(k: Kit, t: number) {
  k.ed.setSel([]);
  return collectScene(k.ed, t);
}

export async function montar(k: Kit, spec: Rec, opts: MontarOpts): Promise<Relatorio> {
  const v: Validacao = validar(spec, opts.mesa);
  const t = v.espessura ?? spec.espessura;
  const rel: Relatorio = { ok: true, nome: v.nome, espessura: t, pecas: [], encaixes: [], nao_feito: [], avisos: [...v.avisos], medidas: [], recortes: [], gravuras: [], faces_gravadas: [], cena: null };
  if (!v.ok) { rel.ok = false; rel.erro = 'validar: ' + JSON.stringify(v.erros); return rel; }
  const [MESA, MESA_A] = opts.mesa;
  const ed = k.ed;
  const achar = (id: number): Obj | undefined => ed.doc.objs.find((o) => o.id === id);
  try {
    await k.tool('new_document', {});
    k.step('new_document', 'documento novo');

    // 1. Every plate becomes a rectangle lying on the bed, in rows, without overlapping
    const pos = new Map<string, Pos>();
    let x = MARGEM, y = MARGEM, alturaFileira = 0;
    for (const pl of v.placas) {
      const [w, h] = pl.peca;
      if (x + w > MESA - MARGEM && x > MARGEM) { x = MARGEM; y += alturaFileira + VAO; alturaFileira = 0; }
      if (y + h > MESA_A - MARGEM) rel.avisos.push({ codigo: 'mesa-cheia', placas: [pl.id], msg: `A peca "${pl.id}" passou do limite da mesa de ${MESA} x ${MESA_A} mm.` });
      // The tenon of make_joint STICKS OUT of the edge (adds 1 thickness). So at the end that gets a tenon the rectangle
      // starts 1 thickness shorter: the shoulder sits on the face of the other plate and the part closes at the exact size.
      const corte: [[number, number], [number, number]] = [[0, 0], [0, 0]]; // [axis u|v][start|end]
      for (const par of v.pares) {
        if (par.tipo !== 'T' || par.espiga !== pl.id) continue;
        const b = (par.espiga === par.a ? par.borda_a : par.borda_b)!;
        corte[b.eixo === pl.eixos_peca[0] ? 0 : 1][b.lado === 'inicio' ? 0 : 1] = t;
      }
      const q = { x: x + corte[0][0], y: y + corte[1][0], w: w - corte[0][0] - corte[0][1], h: h - corte[1][0] - corte[1][1], w0: w, h0: h, pl, corte };
      const r = await k.tool('create_shape', { type: 'rect', x: q.x, y: q.y, width: q.w, height: q.h, layer: CORTE });
      const id = r?.id ?? r?.created?.[0] ?? r?.ids?.[0];
      if (typeof id !== 'number') throw Error(`create_shape nao devolveu id para "${pl.id}": ${JSON.stringify(r)}`);
      pos.set(pl.id, { id, ...q, espigas: [0, 0] });
      rel.pecas.push({ placa: pl.id, id, x, y, largura: w, altura: h, eixos: pl.eixos_peca });
      k.step(`create_shape rect ${pl.id}`, `${r3(q.w)} x ${r3(q.h)} mm`);
      x += w + VAO; alturaFileira = Math.max(alturaFileira, h);
    }
    k.changed();

    // Finds, on the 2D part, the straight edge that matches a 3D border of the plate (axis + side)
    const aresta = async (placaId: string, borda: Borda) => {
      const q = pos.get(placaId)!;
      const emU = borda.eixo === q.pl.eixos_peca[0];
      const alvo = emU ? (borda.lado === 'inicio' ? q.x : q.x + q.w) : (borda.lado === 'inicio' ? q.y : q.y + q.h);
      const kk = emU ? 0 : 1;
      const { edges } = await k.tool('list_edges', { id: q.id });
      const cand = (edges as any[]).filter((e) => Math.abs(e.from[kk] - alvo) <= TOL && Math.abs(e.to[kk] - alvo) <= TOL).sort((a, b) => b.length - a.length);
      if (!cand.length) throw Error(`nenhuma aresta reta de "${placaId}" em ${borda.eixo}/${borda.lado}`);
      return { id: q.id, sub: cand[0].sub, seg: cand[0].seg, comprimento: cand[0].length, de: cand[0].from as [number, number], ate: cand[0].to as [number, number] };
    };

    const alinhar: { espiga: string; furo: string; A: Eixo; ke: Eixo; ee: { de: [number, number]; ate: [number, number] }; subs: [number, number]; reg: Rec }[] = [];
    // 2. Every pair in contact gets its joint. Tenons (T) and half laps (X) first, finger joints (L) last: the tenon uses
    // the whole border of the slotted plate as reference, and fingers chop that border into short pieces (measured: with
    // the fingers first the divider took an 11.4 mm piece instead of the 57 mm border and the 3D view reported 4 overlaps).
    const ORDEM: Record<string, number> = { T: 0, X: 1, L: 2 };
    for (const par of [...v.pares].sort((m, n) => (ORDEM[m.tipo] ?? 3) - (ORDEM[n.tipo] ?? 3))) {
      const lig = v.ligacoes.find((l) => (l.a === par.a && l.b === par.b) || (l.a === par.b && l.b === par.a));
      if (!lig) continue;
      const reg: Rec = { a: par.a, b: par.b, contato: par.tipo, tipo: lig.tipo, eixo: par.eixo, comprimento: par.comprimento };
      try {
        if (par.tipo === 'L' && lig.tipo === 'dedos') {
          const ea = await aresta(par.a, par.borda_a!), eb = await aresta(par.b, par.borda_b!);
          if (Math.abs(ea.comprimento - par.comprimento!) > 0.5 || Math.abs(eb.comprimento - par.comprimento!) > 0.5)
            reg.aviso = `aresta de ${ea.comprimento} / ${eb.comprimento} mm para contato de ${par.comprimento} mm`;
          const r = await k.tool('make_joint', { edges: [{ id: ea.id, sub: ea.sub, seg: ea.seg }, { id: eb.id, sub: eb.sub, seg: eb.seg }], kind: 'finger', thickness: t, direction: 'in' });
          reg.feito = true; reg.ferramenta = 'make_joint finger'; reg.resposta = r;
        } else if (par.tipo === 'T' && lig.tipo === 'espiga') {
          // tenon on the border of the plate that goes through; slots inside the other plate
          const e = (par.espiga === par.a ? par.borda_a : par.borda_b)!;
          const ee = await aresta(par.espiga!, e);
          const f = pos.get(par.furo!)!, esp = pos.get(par.espiga!)!.pl;
          const ke = esp.eixo_espessura;
          // The slots go INSIDE the plate itself: second edge = its border parallel to the joint, and slotOffset =
          // distance from that border to the middle of the thickness of the plate going through. (With a loose line the
          // slots become a separate object and the 3D view reports an overlap, because the plate stays solid.)
          const dIni = (esp[ke][0] + esp[ke][1]) / 2 - f.pl[ke][0], dFim = f.pl[ke][1] - (esp[ke][0] + esp[ke][1]) / 2;
          const ef = await aresta(par.furo!, { eixo: ke, lado: dIni <= dFim ? 'inicio' : 'fim' });
          if (Math.abs(ee.comprimento - ef.comprimento) > 0.5) reg.aviso = `a espiga tem ${ee.comprimento} mm de aresta e a borda de referencia dos furos tem ${ef.comprimento} mm: os furos podem nao casar`;
          const antes = shapeSubs(achar(f.id)!.shape).length;
          const r = await k.tool('make_joint', { edges: [{ id: ee.id, sub: ee.sub, seg: ee.seg }, { id: ef.id, sub: ef.sub, seg: ef.seg }], kind: 'tenon', thickness: t, slotOffset: Math.min(dIni, dFim) });
          reg.feito = true; reg.ferramenta = 'make_joint tenon (slotOffset)'; reg.resposta = r; reg.slotOffset = Math.min(dIni, dFim);
          pos.get(par.espiga!)!.espigas[e.eixo === esp.eixos_peca[0] ? 0 : 1]++;
          // make_joint centres the slots on the MIDDLE of the reference edge and the tenons on the middle of the tenon
          // edge; the two middles only meet by luck. They are lined up after ALL joints (2a), once it is known which way
          // every plate faces in the assembly. Here only what that needs is noted.
          const depois = shapeSubs(achar(f.id)!.shape).length;
          alinhar.push({ espiga: par.espiga!, furo: par.furo!, A: f.pl.eixos_peca.find((x) => x !== ke)!, ke, ee: { de: ee.de, ate: ee.ate }, subs: [antes, depois], reg });
          // where the slots really fell (middle of the slot, measured from the same border)
          const { edges } = await k.tool('list_edges', { id: f.id });
          const kk = f.pl.eixos_peca[0] === ke ? 0 : 1, borda = (kk === 0 ? f.x : f.y) + (dIni <= dFim ? 0 : (kk === 0 ? f.w : f.h));
          const dist = (edges as any[]).filter((x) => x.sub > 0).flatMap((x) => [Math.abs(x.from[kk] - borda), Math.abs(x.to[kk] - borda)]).filter((d) => Math.abs(d - Math.min(dIni, dFim)) <= t);
          reg.furo_medido = dist.length ? { de: Math.min(...dist), ate: Math.max(...dist), meio: (Math.min(...dist) + Math.max(...dist)) / 2, esperado: Math.min(dIni, dFim) } : null;
        } else if (par.tipo === 'X' && lig.tipo === 'meia-madeira') {
          // make_joint lap opens ONE slot in the MIDDLE of the chosen edge, half the height in each plate.
          // So it only works when both plates cross in the middle and have the same height along the crossing axis.
          const A = pos.get(par.a)!.pl, B = pos.get(par.b)!.pl, kc = par.eixo!;
          const noMeio = (P: Placa, Q: Placa) => { const kq = Q.eixo_espessura; return Math.abs((Q[kq][0] + Q[kq][1]) / 2 - (P[kq][0] + P[kq][1]) / 2) <= 0.05; };
          const mesmaAltura = Math.abs(A[kc][0] - B[kc][0]) <= TOL && Math.abs(A[kc][1] - B[kc][1]) <= TOL;
          if (!noMeio(A, B) || !noMeio(B, A) || !mesmaAltura) throw Error('cruzamento fora do meio da aresta ou placas de alturas diferentes: o make_joint lap so abre o rasgo no centro da aresta; falta uma ferramenta de rasgo em posicao livre');
          const ea = await aresta(par.a, { eixo: kc, lado: 'fim' }), eb = await aresta(par.b, { eixo: kc, lado: 'inicio' });
          const r = await k.tool('make_joint', { edges: [{ id: ea.id, sub: ea.sub, seg: ea.seg }, { id: eb.id, sub: eb.sub, seg: eb.seg }], kind: 'lap', thickness: t, lapCount: 1, lapDepth: 50 });
          reg.feito = true; reg.ferramenta = 'make_joint lap'; reg.resposta = r;
        } else {
          reg.feito = false;
          reg.motivo = `contato ${par.tipo} fica colado, sem encaixe`;
        }
        k.step(reg.feito ? `${reg.ferramenta} ${par.a}+${par.b}` : `colado ${par.a}+${par.b}`, reg.aviso ?? reg.motivo ?? `contato ${par.tipo}`, true);
      } catch (e) {
        if (k.signal?.aborted) throw e;
        reg.feito = false; reg.erro = String((e as Error)?.message ?? e);
        rel.nao_feito.push(reg);
        k.step(`encaixe ${par.a}+${par.b} (${par.tipo})`, reg.erro, false);
      }
      delete reg.resposta; // the full answer of the tool is big and not needed by the AI
      rel.encaixes.push(reg);
      k.changed();
    }

    // 2a. Slots where the tenons are. Every plate may enter the 3D assembly flipped (like a flat-packed box: the inner
    // face of one is the outer face of the other). Read from the 3D view itself which way each bed axis points, and move
    // the slots (and the line that mounts the part in 3D) to the middle of the tenons, at the true coordinate.
    if (alinhar.length) {
      const { scene } = cena3d(k, t);
      const porId = new Map(scene.solids.filter((s) => s.key[0] === 'm').map((s) => [Number(s.key.slice(1)), { key: s.key, pose: s.pose, b: solidBounds(s) }]));
      // axis of the specification -> axis of the 3D (with sign), from the boxes of the plates: lengths and positions matching
      const eixo3d = {} as Record<Eixo, { j: number; sg: number; custo: number }>;
      for (const kx of ['x', 'y', 'z'] as Eixo[]) {
        let melhorAj: { j: number; sg: number; custo: number } | null = null;
        for (let j = 0; j < 3; j++) for (const sg of [1, -1]) {
          const offs: number[] = [], erro: number[] = [];
          for (const [, q] of pos) {
            const s = porId.get(q.id); if (!s) continue;
            erro.push(Math.abs((s.b.max[j] - s.b.min[j]) - (q.pl[kx][1] - q.pl[kx][0])));
            offs.push(sg > 0 ? s.b.min[j] - q.pl[kx][0] : s.b.min[j] + q.pl[kx][1]);
          }
          const m = offs.reduce((a, b) => a + b, 0) / (offs.length || 1);
          const custo = erro.reduce((a, b) => a + b, 0) + offs.reduce((a, o) => a + Math.abs(o - m), 0);
          if (!melhorAj || custo < melhorAj.custo) melhorAj = { j, sg, custo };
        }
        eixo3d[kx] = melhorAj!;
      }
      // Is the plate flipped along this bed axis? (1st axis: bed x = pose.u; 2nd: machine y = -pose.v, editor y points down)
      const virada = (placaId: string, eixo: Eixo) => {
        const q = pos.get(placaId)!, s = porId.get(q.id), kk = q.pl.eixos_peca.indexOf(eixo);
        if (!s) return false;
        const d = kk === 0 ? s.pose.u : s.pose.v.map((c: number) => -c);
        return d[eixo3d[eixo].j] * eixo3d[eixo].sg < 0;
      };
      // Bed <-> specification along an axis of the plate. The real part spans [start + cutStart, end - cutEnd] (the end
      // with a tenon starts shortened, on the same side on the bed and in the specification). Flipped in 3D, that shortened
      // part is mirrored on itself, not on the whole plate. (Measured on the piggy bank: without the cut the flipped
      // dividers sat 3 mm to the front and went into the frame.)
      const especDe = (placaId: string, A: Eixo, pt: [number, number]) => {
        const q = pos.get(placaId)!, pe = rel.pecas.find((p) => p.placa === placaId)!, kk = q.pl.eixos_peca.indexOf(A);
        const d = kk === 0 ? pt[0] - pe.x : pt[1] - pe.y, [ci, cf] = q.corte[kk];
        return virada(placaId, A) ? q.pl[A][1] - cf - (d - ci) : q.pl[A][0] + d;
      };
      const mesaDe = (placaId: string, A: Eixo, c: number) => {
        const q = pos.get(placaId)!, pe = rel.pecas.find((p) => p.placa === placaId)!, kk = q.pl.eixos_peca.indexOf(A);
        const [ci, cf] = q.corte[kk];
        return (kk === 0 ? pe.x : pe.y) + (virada(placaId, A) ? ci + (q.pl[A][1] - cf - c) : c - q.pl[A][0]);
      };
      rel.eixos_3d = eixo3d;
      for (const a of alinhar) {
        // along the tenon: middle of the slots = middle of the tenon
        const cEspiga = (especDe(a.espiga, a.A, a.ee.de) + especDe(a.espiga, a.A, a.ee.ate)) / 2;
        const alvo = mesaDe(a.furo, a.A, cEspiga);
        const kF = pos.get(a.furo)!.pl.eixos_peca.indexOf(a.A);
        // across the thickness of the plate going through: line of the slots = middle of its thickness. The slotOffset of
        // make_joint was measured from the BED border, which (a) may be the opposite border in the assembly when the
        // plate enters flipped, and (b) may be the border already shortened by the plate's own tenon. Measured on the
        // piggy bank: base mirrored (410 - x) and shelf +-3 mm.
        const espPl = pos.get(a.espiga)!.pl;
        const alvoK = mesaDe(a.furo, a.ke, (espPl[a.ke][0] + espPl[a.ke][1]) / 2);
        const kK = pos.get(a.furo)!.pl.eixos_peca.indexOf(a.ke);
        a.reg.furos_deslocados = (() => {
          const o = achar(pos.get(a.furo)!.id)!;
          const novos = shapeSubs(o.shape).slice(a.subs[0], a.subs[1]);
          if (!novos.length) return { furos: 0, mm: 0 };
          const pts = novos.flatMap((sp) => sp.nodes.map((n) => apply(o.m, n.x, n.y)));
          const coord = (q: { x: number; y: number }, kk: number) => (kk === 0 ? q.x : ed.doc.bed.h - q.y);
          const med = (kk: number) => pts.reduce((s, q) => s + coord(q, kk), 0) / pts.length;
          const dA = r3(alvo - med(kF)), dK = kK >= 0 ? r3(alvoK - med(kK)) : 0;
          if (Math.abs(dA) < 0.001 && Math.abs(dK) < 0.001) return { furos: novos.length, mm: 0, espessura_mm: 0 };
          const mesa = [0, 0]; mesa[kF] += dA; if (kK >= 0) mesa[kK] += dK;
          const dx = mesa[0], dy = -mesa[1];
          const mi = inv(o.m), a0 = apply(mi, 0, 0), b0 = apply(mi, dx, dy), mx = b0.x - a0.x, my = b0.y - a0.y;
          ed.snapshot('Furos alinhados com as espigas');
          const anda = (ps: { x: number; y: number }[]) => ps.forEach((q) => { q.x += mx; q.y += my; });
          for (const sp of novos) for (const n of sp.nodes) { anda([n]); for (const c of [n.cin, n.cout]) if (c) anda([c]); }
          // the line in the middle of the slots mounts the part in 3D (Mate.b on the tenon, Mate.a on the slots): moves along
          const esp = achar(pos.get(a.espiga)!.id);
          for (const mt of esp?.mates ?? []) if (mt.to === o.id) anda(mt.b as any);
          for (const mt of o.mates ?? []) if (mt.to === pos.get(a.espiga)!.id) anda(mt.a as any);
          ed.emit('doc');
          return { furos: novos.length, mm: dA, espessura_mm: dK };
        })();
        k.step(`furos alinhados ${a.espiga}+${a.furo}`, `${a.reg.furos_deslocados.furos} furo(s), ${a.reg.furos_deslocados.mm} mm ao longo, ${a.reg.furos_deslocados.espessura_mm ?? 0} mm na espessura`);
      }
      k.changed();
    }

    // 2b. Precision: the finished part must have exactly the size of the plate (the joint may neither grow nor shrink it).
    // An end shortened for a tenon that was NOT made (T contact glued, e.g. the tenon fell into a window) stays 1
    // thickness short on purpose: the part ends on the inner face of the other plate instead of going through it.
    // (Measured on the piggy bank: the shelf and the 4 dividers are glued behind the window, 57 mm deep from the inner
    // face of the frame; the old check expected 60 and sent the run into two more rounds.)
    for (const [placa, q] of pos) {
      const { edges } = await k.tool('list_edges', { id: q.id });
      const xs = (edges as any[]).flatMap((e) => [e.from[0], e.to[0]]), ys = (edges as any[]).flatMap((e) => [e.from[1], e.to[1]]);
      const medido: [number, number] = [Math.round((Math.max(...xs) - Math.min(...xs)) * 100) / 100, Math.round((Math.max(...ys) - Math.min(...ys)) * 100) / 100];
      const esperado: [number, number] = [r3(q.w + q.espigas[0] * t), r3(q.h + q.espigas[1] * t)];
      const ok = Math.abs(medido[0] - esperado[0]) <= 0.05 && Math.abs(medido[1] - esperado[1]) <= 0.05;
      rel.medidas.push({ placa, esperado, medido, ok });
      if (!ok) rel.avisos.push({ codigo: 'medida-mudou', placas: [placa], msg: `A peca "${placa}" devia ter ${esperado[0]} x ${esperado[1]} mm e ficou com ${medido[0]} x ${medido[1]} mm depois dos encaixes.` });
      else if (esperado[0] !== q.w0 || esperado[1] !== q.h0) k.step(`peca ${placa} colada de topo`, `${esperado[0]} x ${esperado[1]} mm (a placa ${q.w0} x ${q.h0} mm atravessaria a outra; sem espiga, termina na face dela)`);
    }
    const erradas = rel.medidas.filter((m) => !m.ok).length;
    k.step('medidas das pecas', `${rel.medidas.length - erradas} de ${rel.medidas.length} exatas`, !erradas);

    // 2c. Cut-outs (windows), engravings and the layered scene. 3D point on the face of a plate -> point on the bed.
    const naMesa = (placaId: string, ponto: Rec) => {
      const q = pos.get(placaId)!, pe = rel.pecas.find((p) => p.placa === placaId)!, [a, b] = q.pl.eixos_peca;
      return { x: pe.x + (ponto[a] - q.pl[a][0]), y: pe.y + (ponto[b] - q.pl[b][0]) };
    };
    const caixaNaMesa = (placaId: string, cx: Rec) => {
      const q = pos.get(placaId)!, [a, b] = q.pl.eixos_peca;
      const p0 = naMesa(placaId, { [a]: cx[a][0], [b]: cx[b][0] }), p1 = naMesa(placaId, { [a]: cx[a][1], [b]: cx[b][1] });
      return { x: p0.x, y: p0.y, w: p1.x - p0.x, h: p1.y - p0.y };
    };
    try { await k.tool('set_layer', { layer: GRAVACAO, name: 'Gravacao', mode: 'fill' }); }
    catch (e) { rel.avisos.push({ codigo: 'camada-gravacao', msg: String((e as Error)?.message ?? e) }); }
    for (const sp of spec.placas as Rec[]) {
      if (!pos.has(sp.id)) continue;
      for (const r of sp.recortes ?? []) {
        // the window is a closed shape INSIDE the plate: the laser cuts it and the 3D view treats it as a hole
        const c = caixaNaMesa(sp.id, r);
        const ids = await k.tool('create_shape', { type: 'rect', x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: Math.min(r.raio ?? 0, c.w / 2, c.h / 2), layer: CORTE });
        rel.recortes.push({ placa: sp.id, mm: [c.w, c.h], id: ids?.id });
        k.step(`recorte ${sp.id}`, `${r3(c.w)} x ${r3(c.h)} mm`);
      }
      for (const g of sp.gravuras ?? []) {
        rel.gravuras.push({ placa: sp.id, texto: g.texto, id: await gravar(k, g, naMesa(sp.id, g.centro), GRAVACAO) });
        k.step(`gravura ${sp.id}`, g.texto);
      }
    }
    k.changed();

    // 2d. Engraving on the OUTER face. The laser engraves the top face of the sheet, and KizamuBeam assembles the box like
    // folding the layout: the top face goes INSIDE. (Measured on the piggy bank: the texts were on the inner face of the
    // frame.) Cutting the plate mirrored and turning it over gives the same part with the laser face outwards; the app's
    // 3D reads a mirrored plate as engraving on the other face. Window and texts go to the mirrored place, without
    // mirroring the letters.
    const comGravura = (spec.placas as Rec[]).filter((sp) => pos.has(sp.id) && sp.gravuras?.length);
    if (comGravura.length) {
      const lado = () => {
        const { scene } = cena3d(k, t);
        const caixa = scene.solids.filter((s) => /^m\d/.test(s.key));
        const bs = caixa.map((s) => solidBounds(s));
        const c = [0, 1, 2].map((i) => (Math.min(...bs.map((b) => b.min[i])) + Math.max(...bs.map((b) => b.max[i]))) / 2);
        return Object.fromEntries(caixa.map((s, kk) => {
          const m = [0, 1, 2].map((i) => (bs[kk].min[i] + bs[kk].max[i]) / 2);
          const nFora = [0, 1, 2].reduce((d, i) => d + (m[i] - c[i]) * s.pose.n[i], 0) > 0;
          const eng = (s as any).engraving;
          return [s.key.slice(1), eng ? (eng.top === nFora ? 'fora' : 'dentro') : null];
        })) as Record<string, string | null>;
      };
      const antes = lado();
      for (const sp of comGravura) {
        const q = pos.get(sp.id)!, reg: Rec = { placa: sp.id, antes: antes[q.id] ?? 'sem gravura no 3D' };
        if (antes[q.id] === 'dentro') {
          const junto = [...rel.recortes, ...rel.gravuras].filter((x) => x.placa === sp.id && typeof x.id === 'number').map((x) => x.id as number);
          const cx = q.x + q.w / 2;
          ed.snapshot('Face gravada para fora');
          const placa = achar(q.id)!;
          placa.m = mul(about(scale(-1, 1), cx, 0), placa.m);
          for (const id of junto) {
            const o = achar(id); if (!o) continue;
            const b = boundsOf([o])!, meio = b.x + b.w / 2;
            o.m = mul(translate(2 * (cx - meio), 0), o.m);
          }
          ed.emit('doc');
          reg.espelhada = true; reg.levados = junto.length;
        }
        rel.faces_gravadas.push(reg);
      }
      const depois = lado();
      for (const reg of rel.faces_gravadas) {
        reg.depois = depois[pos.get(reg.placa)!.id] ?? 'sem gravura no 3D';
        if (reg.depois !== 'fora') rel.avisos.push({ codigo: 'gravura-por-dentro', placas: [reg.placa], msg: `A gravura de "${reg.placa}" ficou na face de dentro da caixa.` });
        k.step(`face gravada ${reg.placa}`, `${reg.antes} -> ${reg.depois}${reg.espelhada ? ' (placa espelhada)' : ''}`, reg.depois === 'fora');
      }
      k.changed();
    }

    if (spec.cena?.camadas?.length && pos.has(spec.cena.sobre)) {
      const base: string = spec.cena.sobre, registro: Registro[] = [], camadas: { id: number; nome: string; cor?: string }[] = [];
      const ctx: PecaCtx = { camada: CORTE, ia: opts.ia, fotoUsuario: opts.fotoUsuario, notaMinima: opts.notaMinima, maxWeb: opts.maxWeb, registro };
      const [ea, eb] = pos.get(base)!.pl.eixos_peca;
      for (const c of spec.cena.camadas as Rec[]) {
        const ids: number[] = [];
        for (const pc of c.pecas as Rec[]) {
          const caixa = caixaNaMesa(base, pc.caixa);
          try {
            const r = await construirPeca(k, pc, caixa, ctx);
            ids.push(r.id);
            const image = await fotoDaPeca(k, r.id).catch(() => undefined);
            opts.onPeca?.({ id: pc.id, nome: pc.nome ?? pc.id, nota: r.nota, origem: r.origem, ok: r.ok, image });
            for (const g of pc.gravuras ?? []) {
              const centro = g.centro ?? { [ea]: (pc.caixa[ea][0] + pc.caixa[ea][1]) / 2, [eb]: (pc.caixa[eb][0] + pc.caixa[eb][1]) / 2 };
              rel.gravuras.push({ peca: pc.id, texto: g.texto, id: await gravar(k, g, naMesa(base, centro), GRAVACAO) });
              k.step(`gravura ${pc.id}`, g.texto);
            }
          } catch (e) {
            if (k.signal?.aborted || (e as any)?.providerMessage !== undefined) throw e;
            rel.nao_feito.push({ peca: pc.id, erro: String((e as Error)?.message ?? e) });
            opts.onPeca?.({ id: pc.id, nome: pc.nome ?? pc.id, nota: 0, origem: 'nenhuma', ok: false });
          }
          k.changed();
        }
        if (!ids.length) continue;
        const id = ids.length > 1 ? idsCriados(await k.tool('group', { ids }))[0] : ids[0];
        camadas.push({ id, nome: c.nome, cor: c.cor });
        k.step(`camada da cena: ${c.nome}`, `${ids.length} peca(s)`);
      }
      // the layers become a multi-layer job mounted on the base plate (the 3D view stacks it inside the box)
      ed.snapshot('Cena em camadas');
      const a = makeAssembly(camadas.map((c) => ({ object: c.id, name: c.nome, thickness: t, look: c.cor ? { id: 'plain', color: c.cor } : { id: 'birch' }, anchor: plateAnchor(achar(c.id)!) })));
      a.mount = pos.get(base)!.id;
      (ed.doc.multiLayerAssemblies ??= []).push(a);
      ed.emit('doc');
      rel.cena = { camadas: camadas.length, sobre: base, pecas: registro };
      k.step('cena em camadas', `${camadas.length} camada(s) sobre "${base}"`);
      k.changed();
    }

    // 3. The program's own check (no selection, otherwise the 3D view only shows the selected object).
    // The 3D view as DATA, for the AI and for the code: the same calculation the window uses (collectScene), every
    // collision naming WHICH plates and WHERE (box in mm in the space of the 3D view).
    await k.tool('select', { ids: [] });
    const nomes: Record<string, string> = Object.fromEntries([...pos].map(([placa, q]) => ['m' + q.id, placa]));
    const nome = (kk: string) => nomes[kk] ?? kk;
    const r2 = (vv: number[]) => vv.map((n) => Math.round(n * 100) / 100);
    const caixa = (s: any) => { const b = solidBounds(s); return { min: r2(b.min), max: r2(b.max) }; };
    const { scene, asms } = cena3d(k, t);
    rel.vista3d_dados = {
      pecas: scene.solids.length, conjuntos: asms,
      placas: scene.solids.map((s) => ({ placa: nome(s.key), ...caixa(s) })),
      colisoes: scene.overlaps.map((o) => ({ a: nome(o.a), b: nome(o.b), volume_mm3: Math.round(o.volume * 10) / 10, onde: o.pieces.map(caixa) })),
    };
    k.step('colisoes no 3D', `${rel.vista3d_dados.colisoes.length} (pecas: ${scene.solids.length}, conjuntos: ${asms})`, !rel.vista3d_dados.colisoes.length);
    const check = await k.tool('check_design', {});
    rel.check_design = { total: check?.issues?.length ?? check?.findings?.length ?? null, resumo: check?.summary ?? null };
    k.step('check_design', `${rel.check_design.total ?? '?'} achado(s)`);
  } catch (e) {
    if (k.signal?.aborted || (e as any)?.providerMessage !== undefined) throw e;
    rel.ok = false; rel.erro = String((e as Error)?.stack ?? e);
    k.step('montagem parou', String((e as Error)?.message ?? e), false);
  } finally {
    rel.ok = rel.ok && rel.encaixes.every((e) => e.feito !== false || !e.erro);
  }
  return rel;
}
