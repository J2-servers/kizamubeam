// silhuetas.mjs — constroi UMA peca decorativa (mapa, aviao, Cristo, placa com seta...) dentro de uma caixa da mesa,
// e confere se ficou boa. Ordem das tentativas: a fonte que a especificacao pediu (forma do sistema, motivo da
// biblioteca embutida ou desenho feito pela IA) e, se a nota da conferencia ficar abaixo do minimo, imagens vetoriais
// livres buscadas na internet (Wikimedia Commons), uma por uma. Fica a melhor; cada tentativa vai para o registro.
//
// Usado por montar.mjs, dentro da mesma sessao do app (p = studio de app.mjs).

const UA = 'KizamuBeam-foto-para-pecas/0.2 (https://github.com/KizamuBeam/kizamubeam; laser design research)';

/** Retangulo da peca na mesa (coordenadas da maquina, mm): { x, y, w, h } = canto de baixo a esquerda e tamanho */
export async function limites(p, ids) {
  return p.ev(`(async()=>{
    const { boundsOf } = await import('/src/geom.ts');
    const ed = window.editor, objs = ed.doc.objs.filter((o) => ${JSON.stringify(ids)}.includes(o.id));
    const b = boundsOf(objs); if (!b) return null;
    return { x: b.x, y: ed.doc.bed.h - b.y - b.h, w: b.w, h: b.h };
  })()`);
}

export const idsCriados = (r) => (r?.created ?? []).map((o) => o.id).concat(r?.id !== undefined ? [r.id] : []).concat(r?.ids ?? []);

/** Junta varios objetos num so (grupo) e encaixa dentro da caixa, centrado, sem deformar */
async function encaixar(p, ids, caixa, camada) {
  if (!ids.length) throw Error('nada foi criado');
  let id = ids[0];
  if (ids.length > 1) id = idsCriados(await p.tool('group', { ids }))[0];
  await p.tool('assign_layer', { ids: [id], layer: camada });
  // assign_layer no grupo nao desce as folhas: um SVG da web traz cada cor numa camada (medido: o mapa de estados ficou
  // em 9 camadas). A peca inteira vai para a camada pedida, para ser cortada e aparecer na Vista 3D.
  await p.ev(`(async()=>{
    const { leaves } = await window.__kzImport('/src/model.ts');
    const ed = window.editor, o = ed.doc.objs.find((x) => x.id === ${id});
    ed.layer(${camada});
    for (const [leaf] of leaves([o])) leaf.layer = ${camada};
    ed.emit('doc');
    return true;
  })()`);
  const b = await limites(p, [id]);
  if (!b || !(b.w > 0) || !(b.h > 0)) throw Error('a peca ficou vazia');
  const porLargura = caixa.w / b.w <= caixa.h / b.h;
  await p.tool('transform', porLargura ? { ids: [id], width: caixa.w } : { ids: [id], height: caixa.h });
  await p.tool('transform', { ids: [id], x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2, anchor: 'center' });
  const l = await limpar(p, id);
  if (l.depois > 8000) throw Error(`peca complexa demais para cortar (${l.depois} nos depois de simplificar; tinha ${l.antes})`);
  if (!l.depois) throw Error('nao sobrou contorno fechado depois da limpeza');
  return id;
}

/**
 * Deixa a peca boa para cortar, no tamanho final: tira linhas abertas (contorno de desenho, nao de peca), ilhas
 * menores que areaMin mm2 (fiapos que o laser solta e se perdem) e simplifica cada contorno a tol mm com a mesma rotina
 * do "Simplificar / suavizar caminhos" do sistema. Uma imagem baixada da internet chega a ter 75 mil nos.
 */
export async function limpar(p, id, tol = 0.15, areaMin = 2) {
  return p.ev(`(async()=>{
    const { refitSubpath } = await import('/src/vectorFit.ts');
    const { leaves } = await import('/src/model.ts');
    const ed = window.editor, root = ed.doc.objs.find((o) => o.id === ${id});
    let antes = 0, depois = 0, abertos = 0, ilhas = 0;
    for (const [o, m] of leaves([root])) {
      if (o.shape.kind !== 'path') { if (!['text', 'image', 'group'].includes(o.shape.kind)) { antes += 4; depois += 4; } continue; }
      const k = Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
      const subs = [];
      for (const sp of o.shape.subs) {
        antes += sp.nodes.length;
        if (!sp.closed) { abertos++; continue; }
        const area = Math.abs(sp.nodes.reduce((s, n, i, arr) => { const q = arr[(i + 1) % arr.length]; return s + n.x * q.y - q.x * n.y; }, 0) / 2) * k * k;
        if (area < ${areaMin}) { ilhas++; continue; }
        let r = sp;
        try { r = refitSubpath(sp, { tolerance: ${tol} / k, curves: true, preserveCorners: true }); } catch {}
        depois += r.nodes.length;
        subs.push(r);
      }
      o.shape.subs = subs;
    }
    ed.emit('doc');
    return { antes, depois, abertos, ilhas };
  })()`);
}

/** Formas que o proprio sistema desenha com exatidao */
async function forma(p, f, c) {
  const k = f.forma;
  if (k === 'retangulo') return idsCriados(await p.tool('create_shape', { type: 'rect', x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: Math.min(f.raio ?? 0, c.w / 2, c.h / 2) }));
  if (k === 'circulo') return idsCriados(await p.tool('create_shape', { type: 'ellipse', cx: c.x + c.w / 2, cy: c.y + c.h / 2, rx: c.w / 2, ry: c.h / 2 }));
  if (k === 'placa_seta' || k === 'placa_seta_esquerda') {
    // placa de direcao: retangulo com a ponta em triangulo
    const pt = Math.min(c.h * 0.5, c.w * 0.25);
    const pts = k === 'placa_seta'
      ? [[c.x, c.y], [c.x + c.w - pt, c.y], [c.x + c.w, c.y + c.h / 2], [c.x + c.w - pt, c.y + c.h], [c.x, c.y + c.h]]
      : [[c.x + pt, c.y], [c.x + c.w, c.y], [c.x + c.w, c.y + c.h], [c.x + pt, c.y + c.h], [c.x, c.y + c.h / 2]];
    return idsCriados(await p.tool('create_shape', { type: 'polyline', points: pts, closed: true }));
  }
  if (k === 'moldura') {
    // quadro: retangulo com janela (a borda tem a largura f.borda)
    const bd = f.borda ?? 10;
    const fora = idsCriados(await p.tool('create_shape', { type: 'rect', x: c.x, y: c.y, width: c.w, height: c.h, cornerRadius: f.raio ?? 0 }));
    const dentro = idsCriados(await p.tool('create_shape', { type: 'rect', x: c.x + bd, y: c.y + bd, width: c.w - 2 * bd, height: c.h - 2 * bd, cornerRadius: Math.max(0, (f.raio ?? 0) - bd / 2) }));
    return idsCriados(await p.tool('boolean', { ids: [...fora, ...dentro], op: 'subtract', base: 'first' }));
  }
  throw Error(`forma desconhecida "${k}" (retangulo, circulo, placa_seta, placa_seta_esquerda, moldura)`);
}

/** SVG vindo de fora: so desenho vetorial, sem script, sem imagem embutida, sem texto */
function limparSvg(svg) {
  return svg
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<text[\s\S]*?<\/text>/gi, '')
    .replace(/<image[^>]*>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
}

/** Candidatos na Wikimedia Commons: arquivos SVG livres, do menor para o maior ate ~1,5 MB */
export async function candidatosWeb(busca, max = 4) {
  // "File:<titulo exato>.svg" = um arquivo ja escolhido por quem julgou (juiz.mjs): vai direto nele, sem busca
  const exato = /^File:.+\.svg$/i.test(busca.trim());
  const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url|size'
    + (exato ? `&titles=${encodeURIComponent(busca.trim())}` : `&generator=search&gsrnamespace=6&gsrlimit=12&gsrsearch=${encodeURIComponent(busca + ' filemime:image/svg+xml')}`);
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) return [];
  const j = await r.json();
  return Object.values(j.query?.pages ?? {})
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map((x) => ({ titulo: x.title, url: x.imageinfo?.[0]?.url, bytes: x.imageinfo?.[0]?.size ?? 0, pagina: x.imageinfo?.[0]?.descriptionurl }))
    .filter((x) => x.url && x.bytes > 0 && x.bytes < 1_500_000)
    .slice(0, max * 2)
    // entre os mais relevantes, os arquivos menores primeiro: mapa de 900 KB costuma trazer o continente inteiro
    .sort((a, b) => (a.bytes > 400_000) - (b.bytes > 400_000))
    .slice(0, max);
}

async function baixarSvg(url) {
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw Error(`download ${r.status}`);
  return limparSvg(await r.text());
}

async function importarSvg(p, svg) {
  return idsCriados(await p.tool('import_svg', { svg }));
}

/** Foto so da peca (o que a IA conferente vai olhar) */
async function fotoDaPeca(p, id) {
  await p.tool('select', { ids: [id] });
  const img = await p.ev(`(async()=>{
    const { boundsOf } = await import('/src/geom.ts');
    const ed = window.editor, o = ed.doc.objs.find((x) => x.id === ${id});
    const b = boundsOf([o]); const m = Math.max(b.w, b.h) * 0.06 + 1;
    // so a peca: a melhor tentativa ate agora fica na mesa no MESMO lugar e saia junto na foto (medido no juiz)
    const outros = ed.doc.objs.filter((x) => x !== o && !x.hidden);
    for (const x of outros) x.hidden = true;
    try { return await ed.renderImage({ x: b.x - m, y: b.y - m, w: b.w + 2 * m, h: b.h + 2 * m }, 512); }
    finally { for (const x of outros) x.hidden = false; }
  })()`);
  await p.tool('select', { ids: [] });
  return img.slice(img.indexOf(',') + 1);
}

/**
 * Constroi a peca. peca = { id, nome, o_que, fonte, busca?, conferir? }; caixa em coordenadas da maquina.
 * ctx = { camada, ia: (etapa, conteudo) => Promise<objeto JSON>, fotoUsuario: bloco de imagem, notaMinima, maxWeb, registro: [] }
 */
export async function construirPeca(p, peca, caixa, ctx) {
  const f = peca.fonte ?? { tipo: 'forma', forma: 'retangulo' };
  const tentativas = [];
  const precisaConferir = f.tipo !== 'forma' || peca.conferir === true;
  let melhor = null;

  const avaliar = async (id, origem) => {
    if (!precisaConferir || !ctx.ia) return { nota: 10, parece: 'forma exata do sistema', problemas: [] };
    const img = await fotoDaPeca(p, id);
    const pedido = [
      ...(ctx.fotoUsuario ? [ctx.fotoUsuario] : []),
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: img } },
      { type: 'text', text: [
        `A ultima imagem e UMA peca de MDF que o programa recortou a laser para reproduzir o produto da primeira foto.`,
        `Esta peca deveria ser: "${peca.nome}" — ${peca.o_que ?? ''}. Origem desta tentativa: ${origem}.`,
        `Avalie como um projetista exigente: (1) da para reconhecer o que ela deveria ser, como na foto? (2) e uma silhueta limpa, de contornos fechados, boa para cortar (sem fiapos, sem pedacos soltos minusculos, sem moldura ou legenda que nao fazem parte)? (3) a proporcao e a orientacao batem com a foto?`,
        `Responda SO com JSON: {"nota": 0-10, "parece": "o que voce ve", "problemas": ["..."], "o_que_buscar": "termos em ingles para buscar uma imagem vetorial melhor, se a nota for baixa"}`,
      ].join('\n') },
    ];
    return ctx.ia('peca-conferir', pedido);
  };

  const tentar = async (origem, fazer) => {
    let ids;
    try {
      ids = await fazer();
      const id = await encaixar(p, ids, caixa, ctx.camada ?? 0);
      const av = await avaliar(id, origem);
      const t = { origem, nota: Number(av.nota) || 0, parece: av.parece, problemas: av.problemas ?? [], o_que_buscar: av.o_que_buscar };
      tentativas.push(t);
      if (!melhor || t.nota > melhor.nota) {
        if (melhor) await p.tool('delete_objects', { ids: [melhor.id] });
        melhor = { ...t, id };
      } else await p.tool('delete_objects', { ids: [id] });
      return t.nota >= (ctx.notaMinima ?? 7);
    } catch (e) {
      tentativas.push({ origem, erro: String(e?.message ?? e).slice(0, 300) });
      if (ids?.length) await p.tool('delete_objects', { ids }).catch(() => {});
      return false;
    }
  };

  let ok = false;
  if (f.tipo === 'forma') ok = await tentar(`forma ${f.forma}`, () => forma(p, f, caixa));
  else if (f.tipo === 'biblioteca') ok = await tentar(`biblioteca builtin:${f.id}`, async () => idsCriados(await p.tool('insert_asset', { asset: `builtin:${f.id}`, x: caixa.x + caixa.w / 2, y: caixa.y + caixa.h / 2 })));
  else if (f.tipo === 'desenho') {
    ok = await tentar('desenho da IA', async () => {
      const svg = f.svg ?? (await ctx.ia('peca-desenho', [
        ...(ctx.fotoUsuario ? [ctx.fotoUsuario] : []),
        { type: 'text', text: `Desenhe em SVG a silhueta de "${peca.nome}" (${peca.o_que ?? ''}) como aparece na foto, para cortar em MDF a laser: so contornos FECHADOS preenchidos (path com fill preto, sem stroke), sem texto, sem fundo, viewBox proporcional a ${caixa.w.toFixed(0)} x ${caixa.h.toFixed(0)} mm. Detalhes internos como furos (fill-rule evenodd). Responda SO com JSON {"svg": "<svg ...>...</svg>"}` },
      ])).svg;
      return importarSvg(p, limparSvg(String(svg)));
    });
  }
  // Nao ficou bom (ou a fonte e a internet): buscar imagem vetorial livre
  if (!ok && (f.tipo === 'web' || peca.busca || f.busca)) {
    // A fila CRESCE: cada tentativa reprovada traz o termo que o juiz sugeriu (o_que_buscar), e ele entra no fim.
    // (Antes a lista era fixada antes das tentativas e as sugestoes nunca eram buscadas.)
    const buscas = [f.busca ?? peca.busca, ...tentativas.map((t) => t.o_que_buscar)].filter(Boolean);
    const vistos = new Set(), buscados = new Set();
    const anotar = () => { for (const t of tentativas) if (t.o_que_buscar && !buscas.includes(t.o_que_buscar)) buscas.push(t.o_que_buscar); };
    for (let i = 0; i < buscas.length && !ok && i < 6; i++) {
      if (buscados.has(buscas[i])) continue;
      buscados.add(buscas[i]);
      for (const c of await candidatosWeb(buscas[i], ctx.maxWeb ?? 4)) {
        if (ok || vistos.has(c.url)) continue;
        vistos.add(c.url);
        ok = await tentar(`web: ${c.titulo} (${c.pagina ?? c.url})`, async () => importarSvg(p, await baixarSvg(c.url)));
        anotar();
      }
    }
  }
  ctx.registro?.push({ peca: peca.id, nome: peca.nome, ok, escolhida: melhor ? { origem: melhor.origem, nota: melhor.nota } : null, tentativas });
  if (!melhor) throw Error(`nenhuma tentativa deu certo para "${peca.nome}": ${JSON.stringify(tentativas).slice(0, 1500)}`);
  return { id: melhor.id, nota: melhor.nota, ok };
}

/** Texto gravado (camada de gravacao), centrado no ponto, cabendo na largura */
export async function gravar(p, g, ponto, camada) {
  const r = await p.tool('create_text', { text: g.texto, x: ponto.x, y: ponto.y - (g.altura ?? 6) * 0.35, size: g.altura ?? 6, align: 'center', bold: !!g.negrito, font: g.fonte, layer: camada });
  const id = r?.id ?? idsCriados(r)[0];
  if (g.largura_max) await p.tool('edit_object', { id, maxWidth: g.largura_max });
  return id;
}
