// Port of ai/foto-para-pecas/montagem/silhuetas.mjs: builds ONE decorative part (map, plane, statue, arrow sign...)
// inside a box on the bed and checks whether it came out right. Order of attempts: the source the specification asked
// for (a shape of the program, a motif of the built-in library or a drawing by the AI) and, while the review score
// stays under the minimum, free vector images from Wikimedia Commons, one by one. The best one stays; every attempt
// goes into the log.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { LlmImage } from '../contract';
import { boundsOf } from '../../geom';
import { leaves, Obj } from '../../model';
import { refitSubpath } from '../../vectorFit';
import type { Kit, Rec } from './kit';

/** Rectangle of the part on the bed (machine coordinates, mm): { x, y, w, h } = lower left corner and size */
export interface Caixa { x: number; y: number; w: number; h: number }

export function limites(k: Kit, ids: number[]): Caixa | null {
  const ed = k.ed, objs = ed.doc.objs.filter((o) => ids.includes(o.id));
  const b = boundsOf(objs);
  if (!b) return null;
  return { x: b.x, y: ed.doc.bed.h - b.y - b.h, w: b.w, h: b.h };
}

export const idsCriados = (r: any): number[] => ((r?.created ?? []) as any[]).map((o) => o.id).concat(r?.id !== undefined ? [r.id] : []).concat(r?.ids ?? []);

const achar = (k: Kit, id: number): Obj | undefined => k.ed.doc.objs.find((o) => o.id === id);

/** Joins several objects into one (group) and fits it into the box, centred, without distortion */
async function encaixar(k: Kit, ids: number[], caixa: Caixa, camada: number) {
  if (!ids.length) throw Error('nada foi criado');
  let id = ids[0];
  if (ids.length > 1) id = idsCriados(await k.tool('group', { ids }))[0];
  await k.tool('assign_layer', { ids: [id], layer: camada });
  // assign_layer on a group does not reach the leaves: an SVG from the web brings every colour on its own layer
  // (measured: the map of the states ended up on 9 layers). The whole part goes to the requested layer, to be cut and
  // to show up in the 3D view.
  {
    const ed = k.ed, o = achar(k, id);
    ed.layer(camada);
    if (o) for (const [leaf] of leaves([o])) leaf.layer = camada;
    ed.emit('doc');
  }
  const b = limites(k, [id]);
  if (!b || !(b.w > 0) || !(b.h > 0)) throw Error('a peca ficou vazia');
  const porLargura = caixa.w / b.w <= caixa.h / b.h;
  await k.tool('transform', porLargura ? { ids: [id], width: caixa.w } : { ids: [id], height: caixa.h });
  await k.tool('transform', { ids: [id], x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2, anchor: 'center' });
  const l = limpar(k, id);
  if (l.depois > 8000) throw Error(`peca complexa demais para cortar (${l.depois} nos depois de simplificar; tinha ${l.antes})`);
  if (!l.depois) throw Error('nao sobrou contorno fechado depois da limpeza');
  return id;
}

/**
 * Makes the part good to cut, at its final size: removes open lines (outline of a drawing, not of a part), islands
 * smaller than areaMin mm² (slivers the laser frees and that get lost) and simplifies every contour to tol mm with the
 * same routine as "Simplify / smooth paths". An image from the internet can have 75 thousand nodes.
 */
export function limpar(k: Kit, id: number, tol = 0.15, areaMin = 2) {
  const ed = k.ed, root = achar(k, id);
  let antes = 0, depois = 0, abertos = 0, ilhas = 0;
  if (!root) return { antes, depois, abertos, ilhas };
  for (const [o, m] of leaves([root])) {
    if (o.shape.kind !== 'path') { if (!['text', 'image', 'group'].includes(o.shape.kind)) { antes += 4; depois += 4; } continue; }
    const s = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    const subs = [];
    for (const sp of o.shape.subs) {
      antes += sp.nodes.length;
      if (!sp.closed) { abertos++; continue; }
      const area = Math.abs(sp.nodes.reduce((acc, n, i, arr) => { const q = arr[(i + 1) % arr.length]; return acc + n.x * q.y - q.x * n.y; }, 0) / 2) * s * s;
      if (area < areaMin) { ilhas++; continue; }
      let r = sp;
      try { r = refitSubpath(sp, { tolerance: tol / s, curves: true, preserveCorners: true }); } catch { /* keep the contour as it is */ }
      depois += r.nodes.length;
      subs.push(r);
    }
    o.shape.subs = subs;
  }
  ed.emit('doc');
  return { antes, depois, abertos, ilhas };
}

/** Shapes the program draws exactly */
async function forma(k: Kit, f: Rec, c: Caixa): Promise<number[]> {
  const kind = f.forma;
  if (kind === 'retangulo') return idsCriados(await k.tool('create_shape', { type: 'rect', x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: Math.min(f.raio ?? 0, c.w / 2, c.h / 2) }));
  if (kind === 'circulo') return idsCriados(await k.tool('create_shape', { type: 'ellipse', cx: c.x + c.w / 2, cy: c.y + c.h / 2, rx: c.w / 2, ry: c.h / 2 }));
  if (kind === 'placa_seta' || kind === 'placa_seta_esquerda') {
    // direction sign: rectangle with a triangular tip
    const pt = Math.min(c.h * 0.5, c.w * 0.25);
    const pts = kind === 'placa_seta'
      ? [[c.x, c.y], [c.x + c.w - pt, c.y], [c.x + c.w, c.y + c.h / 2], [c.x + c.w - pt, c.y + c.h], [c.x, c.y + c.h]]
      : [[c.x + pt, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x + pt, c.y + c.h], [c.x, c.y + c.h / 2]];
    return idsCriados(await k.tool('create_shape', { type: 'polyline', points: pts, closed: true }));
  }
  if (kind === 'moldura') {
    // frame: rectangle with a window (the border is f.borda wide)
    const bd = f.borda ?? 10;
    const fora = idsCriados(await k.tool('create_shape', { type: 'rect', x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: f.raio ?? 0 }));
    const dentro = idsCriados(await k.tool('create_shape', { type: 'rect', x: c.x + bd, y: c.y + bd, width: c.w - 2 * bd, height: c.h - 2 * bd, cornerRadius: Math.max(0, (f.raio ?? 0) - bd / 2) }));
    return idsCriados(await k.tool('boolean', { ids: [...fora, ...dentro], op: 'subtract', base: 'first' }));
  }
  throw Error(`forma desconhecida "${kind}" (retangulo, circulo, placa_seta, placa_seta_esquerda, moldura)`);
}

/** SVG from outside: vector drawing only, no script, no embedded image, no text */
export function limparSvg(svg: string) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<text[\s\S]*?<\/text>/gi, '')
    .replace(/<image[^>]*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
}

// Wikimedia asks browser clients to name themselves in Api-User-Agent (a browser does not let a page set User-Agent)
const UA = 'KizamuBeam-criar/0.2 (https://github.com/KizamuBeam/kizamubeam; laser design)';

export interface Candidato { titulo: string; url: string; bytes: number; pagina?: string }

/** Candidates on Wikimedia Commons: free SVG files, smallest first up to ~1.5 MB */
export async function candidatosWeb(busca: string, max = 4, signal?: AbortSignal): Promise<{ lista: Candidato[]; erro?: string }> {
  // "File:<exact title>.svg" = a file already picked by whoever judged (juiz.mjs): straight to it, no search
  const exato = /^File:.+\.svg$/i.test(busca.trim());
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&prop=imageinfo&iiprop=url|size'
    + (exato ? `&titles=${encodeURIComponent(busca.trim())}` : `&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(busca + ' filemime:image/svg+xml')}`);
  let r: Response;
  try {
    r = await fetch(url, { headers: { 'Api-User-Agent': UA }, signal });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { lista: [], erro: String((e as Error)?.message ?? e) };
  }
  if (!r.ok) return { lista: [], erro: `Wikimedia ${r.status}: ${(await r.text().catch(() => '')).slice(0, 300)}` };
  const j = await r.json();
  const lista = (Object.values(j.query?.pages ?? {}) as any[])
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((x) => ({ titulo: x.title, url: x.imageinfo?.[0]?.url, bytes: x.imageinfo?.[0]?.size ?? 0, pagina: x.imageinfo?.[0]?.descriptionurl }))
    .filter((x) => x.url && x.bytes > 0 && x.bytes < 1_500_000)
    .slice(0, max * 2)
    // among the most relevant, the smaller files first: a 900 KB map usually brings the whole continent
    .sort((a, b) => Number(a.bytes > 400_000) - Number(b.bytes > 400_000))
    .slice(0, max);
  return { lista };
}

async function baixarSvg(url: string, signal?: AbortSignal) {
  const r = await fetch(url, { signal });
  if (!r.ok) throw Error(`download ${r.status}`);
  return limparSvg(await r.text());
}

async function importarSvg(k: Kit, svg: string) {
  return idsCriados(await k.tool('import_svg', { svg }));
}

/** Picture of the part alone (what the reviewing AI looks at): PNG data URL */
export async function fotoDaPeca(k: Kit, id: number): Promise<string> {
  await k.tool('select', { ids: [id] });
  const ed = k.ed, o = achar(k, id);
  let img = '';
  if (o) {
    const b = boundsOf([o])!;
    const m = Math.max(b.w, b.h) * 0.06 + 1;
    // only the part: the best attempt so far stays on the bed at the SAME place and would show in the picture
    const outros = ed.doc.objs.filter((x) => x !== o && !x.hidden);
    for (const x of outros) x.hidden = true;
    try { img = ed.renderImage({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, 512); }
    finally { for (const x of outros) x.hidden = false; }
  }
  await k.tool('select', { ids: [] });
  return img;
}

export const dataUrlImagem = (url: string): LlmImage => ({ mediaType: url.slice(5, url.indexOf(';')) || 'image/png', base64: url.slice(url.indexOf(',') + 1) });

export interface Tentativa { origem: string; nota?: number; parece?: string; problemas?: string[]; o_que_buscar?: string; erro?: string }
export interface Registro { peca: string; nome: string; ok: boolean; escolhida: { origem: string; nota: number } | null; tentativas: Tentativa[] }

export interface PecaCtx {
  camada: number;
  /** The reviewing / drawing AI: (stage, images, text) -> JSON object */
  ia: ((etapa: string, imagens: LlmImage[], texto: string) => Promise<any>) | null;
  fotoUsuario: LlmImage | null;
  notaMinima: number;
  maxWeb: number;
  registro: Registro[];
}

/**
 * Builds the part. peca = { id, nome, o_que, fonte, busca?, conferir? }; box in machine coordinates.
 */
export async function construirPeca(k: Kit, peca: Rec, caixa: Caixa, ctx: PecaCtx) {
  const f = peca.fonte ?? { tipo: 'forma', forma: 'retangulo' };
  const tentativas: Tentativa[] = [];
  const precisaConferir = f.tipo !== 'forma' || peca.conferir === true;
  let melhor: (Tentativa & { id: number; nota: number }) | null = null;

  const avaliar = async (id: number, origem: string) => {
    if (!precisaConferir || !ctx.ia) return { nota: 10, parece: 'forma exata do sistema', problemas: [] };
    const img = await fotoDaPeca(k, id);
    const texto = [
      `A ultima imagem e UMA peca de MDF que o programa recortou a laser para reproduzir o produto da primeira foto.`,
      `Esta peca deveria ser: "${peca.nome}" — ${peca.o_que ?? ''}. Origem desta tentativa: ${origem}.`,
      `Avalie como um projetista exigente: (1) da para reconhecer o que ela deveria ser, como na foto? (2) e uma silhueta limpa, de contornos fechados, boa para cortar (sem fiapos, sem pedacos soltos minusculos, sem moldura ou legenda que nao fazem parte)? (3) a proporcao e a orientacao batem com a foto?`,
      `Responda SO com JSON: {"nota": 0-10, "parece": "o que voce ve", "problemas": ["..."], "o_que_buscar": "termos em ingles para buscar uma imagem vetorial melhor, se a nota for baixa"}`,
    ].join('\n');
    return ctx.ia('peca-conferir', [...(ctx.fotoUsuario ? [ctx.fotoUsuario] : []), dataUrlImagem(img)], texto);
  };

  const tentar = async (origem: string, fazer: () => Promise<number[]>) => {
    let ids: number[] | undefined;
    try {
      ids = await fazer();
      const id = await encaixar(k, ids, caixa, ctx.camada ?? 0);
      const av = await avaliar(id, origem);
      const t: Tentativa & { nota: number } = { origem, nota: Number(av.nota) || 0, parece: av.parece, problemas: av.problemas ?? [], o_que_buscar: av.o_que_buscar };
      tentativas.push(t);
      k.step(`peca ${peca.id}: ${origem}`, `nota ${t.nota}${t.parece ? ` — ${t.parece}` : ''}`, t.nota >= (ctx.notaMinima ?? 7));
      if (!melhor || t.nota > melhor.nota) {
        if (melhor) await k.tool('delete_objects', { ids: [melhor.id] });
        melhor = { ...t, id };
      } else await k.tool('delete_objects', { ids: [id] });
      k.changed();
      return t.nota >= (ctx.notaMinima ?? 7);
    } catch (e) {
      if (k.signal?.aborted) throw e;
      // a provider failure of the reviewing AI is not a bad attempt: it goes up with its own words
      if ((e as any)?.providerMessage !== undefined) throw e;
      const msg = String((e as Error)?.message ?? e).slice(0, 300);
      tentativas.push({ origem, erro: msg });
      k.step(`peca ${peca.id}: ${origem}`, msg, false);
      if (ids?.length) await k.tool('delete_objects', { ids }).catch(() => {});
      return false;
    }
  };

  let ok = false;
  if (f.tipo === 'forma') ok = await tentar(`forma ${f.forma}`, () => forma(k, f, caixa));
  else if (f.tipo === 'biblioteca') ok = await tentar(`biblioteca builtin:${f.id}`, async () => idsCriados(await k.tool('insert_asset', { asset: `builtin:${f.id}`, x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2 })));
  // The AI draws the silhouette itself (source "desenho", or the last resort when nothing found on the internet passed)
  const desenhar = (origem: string, proprio?: string) =>
    tentar(origem, async () => {
      let svg = proprio;
      if (!svg) {
        if (!ctx.ia) throw Error('sem IA para desenhar');
        svg = (await ctx.ia('peca-desenho', ctx.fotoUsuario ? [ctx.fotoUsuario] : [],
          `Desenhe em SVG a silhueta de "${peca.nome}" (${peca.o_que ?? ''}) como aparece na foto, para cortar em MDF a laser: so contornos FECHADOS preenchidos (path com fill preto, sem stroke), sem texto, sem fundo, viewBox proporcional a ${caixa.w.toFixed(0)} x ${caixa.h.toFixed(0)} mm. Detalhes internos como furos (fill-rule evenodd). Responda SO com JSON {"svg": "<svg ...>...</svg>"}`)).svg;
      }
      return importarSvg(k, limparSvg(String(svg)));
    });
  if (f.tipo === 'desenho') ok = await desenhar('desenho da IA', f.svg);
  // Not good (or the source is the internet): search a free vector image
  if (!ok && (f.tipo === 'web' || peca.busca || f.busca)) {
    // The queue GROWS: every rejected attempt brings the term the reviewer suggested (o_que_buscar), at the end.
    // (Before, the list was fixed before the attempts and the suggestions were never searched.)
    const buscas: string[] = [f.busca ?? peca.busca, ...tentativas.map((t) => t.o_que_buscar)].filter(Boolean) as string[];
    const vistos = new Set<string>(), buscados = new Set<string>();
    const anotar = () => { for (const t of tentativas) if (t.o_que_buscar && !buscas.includes(t.o_que_buscar)) buscas.push(t.o_que_buscar); };
    for (let i = 0; i < buscas.length && !ok && i < 6; i++) {
      if (buscados.has(buscas[i])) continue;
      buscados.add(buscas[i]);
      const { lista, erro } = await candidatosWeb(buscas[i], ctx.maxWeb ?? 4, k.signal);
      k.step(`busca Wikimedia: ${buscas[i]}`, erro ?? `${lista.length} candidato(s)`, !erro);
      for (const c of lista) {
        if (ok || vistos.has(c.url)) continue;
        vistos.add(c.url);
        ok = await tentar(`web: ${c.titulo} (${c.pagina ?? c.url})`, async () => importarSvg(k, await baixarSvg(c.url, k.signal)));
        anotar();
      }
    }
  }
  // Last resort: no image from the internet passed the reviewer -> the AI draws it from the photo. (Measured on the
  // piggy bank: the "palm tree" ended up as the Palme d'Or trophy, score 1, and the final reviewer marked it grave.)
  if (!ok && f.tipo === 'web' && ctx.ia) ok = await desenhar('desenho da IA (nenhuma imagem da internet passou)');
  const m = melhor as (Tentativa & { id: number; nota: number }) | null;
  ctx.registro.push({ peca: peca.id, nome: peca.nome, ok, escolhida: m ? { origem: m.origem, nota: m.nota } : null, tentativas });
  if (!m) throw Error(`nenhuma tentativa deu certo para "${peca.nome}": ${JSON.stringify(tentativas).slice(0, 1500)}`);
  return { id: m.id, nota: m.nota, ok, origem: m.origem };
}

/** Engraved text (engraving layer), centred on the point, fitting the width */
export async function gravar(k: Kit, g: Rec, ponto: { x: number; y: number }, camada: number): Promise<number> {
  const r = await k.tool('create_text', { text: g.texto, x: ponto.x, y: ponto.y - (g.altura ?? 6) * 0.35, size: g.altura ?? 6, align: 'center', bold: !!g.negrito, font: g.fonte, layer: camada });
  const id = r?.id ?? idsCriados(r)[0];
  if (g.largura_max) await k.tool('edit_object', { id, maxWidth: g.largura_max });
  return id;
}
