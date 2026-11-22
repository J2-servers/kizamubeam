// "Crie seu produto": the photo -> parts pipeline, port of ai/foto-para-pecas/harness/rodar.mjs (stages 0 to 6) running
// straight against the creator window's own Editor (no CDP). The AI does not draw lines: it writes a specification of
// plates; the code checks every answer and builds the parts with the program's own tools. The AI is reached only
// through the `call` parameter (llm.ts); prompts and schemas are the harness files themselves (engine/prompts.ts).
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { EngineEvent, LlmImage, LlmMessage, Question, RunEngine } from './contract';
import { LlmError } from './contract';
import { collectScene } from '../view3d/panel';
import { contexto, extrairJson, makeKit, type Rec } from './engine/kit';
import { ESQUEMAS, MAX_WEB, maxTokens, NOTA_MINIMA, PROMPTS, VOLTAS } from './engine/prompts';
import { conferir } from './engine/conferir';
import { validar } from './engine/validar';
import { montar, type Relatorio } from './engine/montar';
import { eixosDoProduto, fotos3d, VISTAS } from './engine/fotos3d';
import { dataUrlImagem } from './engine/silhuetas';

const TITULOS: Record<string, string> = {
  '0-entrada': 'Conferir a entrada (fotos, medidas, espessura)',
  '1-compreender': 'Entender o produto',
  '2-vistas': 'Desenhar as três vistas',
  '3-especificar': 'Especificar as placas e os encaixes',
  '4-cena': 'Janelas, textos e peças decorativas',
  '4-montar': 'Construir as peças no programa',
  '5-conferir': 'Conferir o 3D com a foto',
  '6-entregar': 'Entregar',
};

/** The harness stops here: stage, its literal reason and the literal errors of the checker */
class Parada extends Error {
  constructor(public etapa: string, msg: string, public extra?: unknown) {
    super(msg);
  }
}

const ROTAS = ['placas', 'camadas', 'organico'];
const SISTEMA_PECA = 'Voce e projetista de pecas de MDF para corte a laser. Responda so com o JSON pedido.';

export const runEngine: RunEngine = async (editor, llm, call, req, hooks, signal) => {
  const emit = (e: EngineEvent) => {
    try { hooks.onEvent(e); } catch (err) { console.error('criar: onEvent', err); }
  };
  let atual = '0-entrada';
  const titulo = (s: string, rodada = 1) => (TITULOS[s] ?? s) + (rodada > 1 ? ` (volta ${rodada})` : '');
  const inicio = (s: string, rodada = 1) => { atual = s; emit({ kind: 'stage', stage: s, title: titulo(s, rodada), status: 'start' }); };
  const pronto = (s: string, detail?: string, rodada = 1) => emit({ kind: 'stage', stage: s, title: titulo(s, rodada), status: 'done', detail });
  const kit = makeKit(
    editor,
    (label, detail, ok = true) => emit({ kind: 'step', label, detail, ok }),
    () => emit({ kind: 'model' }),
    signal,
  );
  const custo = { usd: 0, calls: 0 };
  const contar = (usd?: number) => {
    custo.calls++;
    custo.usd = Math.round((custo.usd + (usd ?? 0)) * 10000) / 10000;
    emit({ kind: 'cost', usd: custo.usd, calls: custo.calls });
  };

  /** One stage: sends the messages, returns the JSON of the answer. The conversation only grows (nothing is rewritten). */
  const perguntar = async (etapa: string, mensagens: LlmMessage[]) => {
    kit.check();
    const r = await call(llm, { stage: etapa, system: PROMPTS.sistema, messages: mensagens, maxTokens: maxTokens(etapa), signal });
    contar(r.usage.usd);
    kit.step(`IA ${etapa}`, `${r.model}: ${r.usage.input} tokens de entrada, ${r.usage.output} de saida`);
    // the answer goes back whole into the conversation, for the next round
    mensagens.push({ role: 'assistant', text: r.text });
    try {
      return extrairJson(r.text);
    } catch (e) {
      throw new Parada(etapa, `a resposta da IA nao e JSON valido: ${(e as Error).message}`, { inicio_da_resposta: r.text.slice(0, 400) });
    }
  };
  /** The small per-part calls (review of a cut part, drawing of a silhouette) */
  const ia = async (etapa: string, imagens: LlmImage[], texto: string) => {
    kit.check();
    const r = await call({ ...llm, effort: 'medium' }, { stage: etapa, system: SISTEMA_PECA, messages: [{ role: 'user', images: imagens, text: texto }], maxTokens: 16000, review: etapa === 'peca-conferir', signal });
    contar(r.usage.usd);
    return extrairJson(r.text);
  };
  /** Repeats the stage until the checker in code accepts; the errors go back LITERALLY to the AI */
  const etapaComConferencia = async (etapa: string, mensagens: LlmMessage[], conferente: (r: any) => any[], rodada = 1) => {
    let ultimo: { resposta: any; erros: any[]; volta: number } = { resposta: null, erros: [], volta: 0 };
    for (let volta = 1; volta <= VOLTAS; volta++) {
      const resposta = await perguntar(etapa, mensagens);
      const erros = conferente(resposta);
      ultimo = { resposta, erros, volta };
      kit.step(`conferidor ${etapa}${rodada > 1 ? ` (volta ${rodada})` : ''}, resposta ${volta}`, erros.length ? `${erros.length} erro(s): ${erros.slice(0, 3).map((e) => e.msg ?? e.codigo).join(' | ')}` : 'aceita', !erros.length);
      if (!erros.length) return ultimo;
      mensagens.push({ role: 'user', text: `O conferidor por codigo recusou a resposta. Erros, literais:\n${contexto(erros)}\nCorrija exatamente o que foi apontado e nao mexa no resto. Responda so com o JSON.` });
    }
    return ultimo;
  };

  const warnings: string[] = [];
  const aviso = (s: string) => { if (!warnings.includes(s)) warnings.push(s); };
  const notVerified = ['nenhuma peça foi cortada', 'as faces que a foto não mostra são hipótese', 'medidas críticas contra o objeto real', 'um corte de teste de um encaixe na mesma chapa', 'a compensação do corte (kerf) do material'];
  let melhor: { rodada: number; estado: string; rel: Relatorio; sistema: Rec; dif: any; nota: number; spec: Rec } | null = null;
  let construida = 0;
  let estadoConstruido = '';
  let ultimosEixos: import('../view3d/viewer').ViewAxes | undefined;

  try {
    // ---------- Stage 0: input ----------
    inicio('0-entrada');
    const espessura = Number(req.thickness);
    const mesa: [number, number] = [Number(req.bed?.[0]), Number(req.bed?.[1])];
    const medidas = (req.measures ?? []).map((m) => ({ o_que: m.what || 'medida informada', eixo: String(m.axis).trim().toLowerCase(), mm: Number(m.mm), alvo: 'envolvente' }));
    const faltas: string[] = [];
    if (!req.images?.length) faltas.push('pelo menos uma foto do objeto');
    if (!medidas.length || medidas.some((m) => !['x', 'y', 'z'].includes(m.eixo) || !(m.mm > 0))) faltas.push('pelo menos UMA medida real, em mm, com o eixo: x largura, y profundidade, z altura');
    if (!(espessura > 0)) faltas.push('a espessura do material, em mm');
    if (!(mesa[0] > 0) || !(mesa[1] > 0)) faltas.push('a área útil de corte da máquina (largura x altura, mm)');
    if (faltas.length) throw new Parada('0-entrada', `Foto não tem escala: sem estes dados o programa não inventa nada. Falta: ${faltas.join('; ')}.`);
    // the creator's own editor: new document, the user's machine bed
    await kit.tool('new_document', {});
    editor.doc.bed = { w: mesa[0], h: mesa[1] };
    editor.emit('doc');
    emit({ kind: 'model' });
    const entrada: Rec = { fotos: req.images.map((_, i) => `foto ${i + 1}`), pedido_do_usuario: req.text ?? '', medidas_reais: medidas, espessura, mesa_mm: mesa, respostas_do_usuario: [] as string[] };
    pronto('0-entrada', `${req.images.length} foto(s), ${medidas.length} medida(s), chapa de ${espessura} mm, mesa ${mesa[0]} x ${mesa[1]} mm`);

    // ---------- Stage 1: understand ----------
    inicio('1-compreender');
    const fotos = req.images;
    const pedido = req.text?.trim() ? `\n\nO que o usuario quer fazer, nas palavras dele:\n${req.text.trim()}` : '';
    const conversa1: LlmMessage[] = [{ role: 'user', images: fotos, text: `${PROMPTS.compreender}${pedido}\n\nEntrada:\n${contexto(entrada)}\n\nEsquema da resposta:\n${ESQUEMAS.analise}` }];
    const conferirAnalise = (a: any) => {
      const reqd = ['tipo_objeto', 'rota', 'placas_visiveis', 'partes_moveis', 'oculto', 'perguntas', 'resumo_para_usuario'];
      const e: any[] = reqd.filter((k) => !(k in (a ?? {}))).map((k) => ({ codigo: 'campo-faltando', campo: k }));
      if (!ROTAS.includes(a?.rota)) e.push({ codigo: 'rota', msg: `rota "${a?.rota}" nao e uma de ${ROTAS.join(', ')}` });
      return e;
    };
    const { resposta: analise, erros: errosAnalise } = await etapaComConferencia('1-compreender', conversa1, conferirAnalise);
    if (errosAnalise.length) throw new Parada('1-compreender', 'a análise não passou na conferência depois das voltas', errosAnalise);
    emit({ kind: 'assistant', stage: '1-compreender', text: String(analise.resumo_para_usuario ?? '') });
    pronto('1-compreender', `${analise.tipo_objeto} — rota ${analise.rota}`);

    // Stop point 1: the user confirms the interpretation and answers the questions that change size or number of parts
    const perguntas: Question[] = (analise.perguntas ?? []).map((q: any) => ({ question: String(q?.pergunta ?? q), blocks: !!q?.bloqueia }));
    const hipotesesAnalise: string[] = (analise.hipoteses ?? []).map(String);
    const suposicoes = [...hipotesesAnalise, ...((analise.oculto ?? []) as unknown[]).map((o) => `A foto não mostra: ${typeof o === 'string' ? o : JSON.stringify(o)}`)];
    const conf = await hooks.confirm(String(analise.resumo_para_usuario ?? ''), perguntas, suposicoes);
    kit.check();
    if (!conf?.confirmed) throw new Parada('1-compreender', 'cancelado: o usuário não confirmou a interpretação');
    const respostas = perguntas.map((q, i) => ({ q, r: String(conf.answers?.[i] ?? '').trim() })).filter((x) => x.r).map((x) => `${x.q.question} -> ${x.r}`);
    // answers that do not line up with a question still count (free text of the user)
    for (const extra of (conf.answers ?? []).slice(perguntas.length)) if (String(extra).trim()) respostas.push(String(extra).trim());
    if (perguntas.some((q) => q.blocks) && !respostas.length)
      throw new Parada('1-compreender', 'há perguntas que mudam o tamanho ou o número de peças e nenhuma foi respondida', perguntas.filter((q) => q.blocks).map((q) => q.question));
    entrada.respostas_do_usuario = respostas;
    analise.respostas_do_usuario = respostas;
    kit.step('usuario confirmou', respostas.length ? `${respostas.length} resposta(s)` : 'sem respostas');
    for (const h of hipotesesAnalise) aviso(`Hipótese da análise: ${h}`);
    if (analise.rota !== 'placas') throw new Parada('1-compreender', `rota "${analise.rota}": este ciclo só constrói a rota "placas" por enquanto (camadas e orgânico estão só desenhadas no HARNESS.md)`);

    // ---------- Stages 2 to 5, with check rounds against the 3D ----------
    const conversa2: LlmMessage[] = [{ role: 'user', images: fotos, text: `${PROMPTS.vistas}\n\nAnalise confirmada pelo usuario:\n${contexto(analise)}\n\nEntrada:\n${contexto(entrada)}\n\nEsquema da resposta:\n${ESQUEMAS.vistas}` }];
    let conversa4: LlmMessage[] | null = null;
    const avisosRodada: Rec[] = [];
    for (let rodada = 1; rodada <= VOLTAS; rodada++) {
      // Stage 2 — views, checked in code (the user's real measures come from outside: the AI cannot change them)
      inicio('2-vistas', rodada);
      const conferente2 = (v: any) => conferir({ ...v, espessura, medidas_reais: medidas }, { mesa }).erros ?? [];
      const { resposta: vistas, erros: errosVistas } = await etapaComConferencia('2-vistas', conversa2, conferente2, rodada);
      if (errosVistas.length) throw new Parada('2-vistas', 'as três vistas não fecharam entre si depois das voltas', errosVistas);
      const cf = conferir({ ...vistas, espessura, medidas_reais: medidas }, { mesa });
      // measures from the proportion of the photo: accepted and listed for the user
      for (const c of (vistas.cotas ?? []).filter((c: any) => c?.origem === 'hipotese')) aviso(`Cota por hipótese (da proporção da foto, não medida): ${c.o_que} = ${c.mm} mm${c.conta ? ` — ${c.conta}` : ''}`);
      pronto('2-vistas', `${cf.placas.length} placa(s); ${cf.envolvente ? (['x', 'y', 'z'] as const).map((k) => Math.round((cf.envolvente![k][1] - cf.envolvente![k][0]) * 100) / 100).join(' x ') + ' mm' : ''}`, rodada);

      // Stage 3 — specify; the numbers of the plates come from the checker, never from the AI
      inicio('3-especificar', rodada);
      const conversa3: LlmMessage[] = [{ role: 'user', text: `${PROMPTS.especificar}\n\nPlacas calculadas pelo conferidor:\n${contexto(cf.placas)}\n\nAnalise:\n${contexto(analise)}\n\nEspessura: ${espessura} mm.\n\nEsquema da resposta:\n${ESQUEMAS.montagem}` }];
      const montarSpec = (s: any) => ({ ...s, spec: 'kz-montagem/1', espessura, placas: cf.placas.map((p) => ({ ...(s?.placas ?? []).find((q: any) => q?.id === p.id), ...p })) });
      const { resposta: spec3, erros: errosSpec } = await etapaComConferencia('3-especificar', conversa3, (s) => validar(montarSpec(s), mesa).erros, rodada);
      if (errosSpec.length) throw new Parada('3-especificar', 'a especificação não passou no validador', errosSpec);
      const spec0 = montarSpec(spec3);
      pronto('3-especificar', `${spec0.placas.length} placa(s), ligações ${typeof spec0.ligacoes === 'string' ? spec0.ligacoes : (spec0.ligacoes ?? []).length}`, rodada);

      // Stage 4 — scene and finish: windows, engraved texts and the decorative parts in layers
      inicio('4-cena', rodada);
      if (!conversa4) conversa4 = [{ role: 'user', images: fotos, text: `${PROMPTS.cena}\n\nPlacas da estrutura (mm):\n${contexto(spec0.placas.map(({ id, nome, x, y, z }: Rec) => ({ id, nome, x, y, z })))}\n\nAnalise:\n${contexto(analise)}\n\nEspessura: ${espessura} mm.\n\nEsquema da resposta:\n${ESQUEMAS.cena}` }];
      const juntar = (c: any) => ({
        ...spec0,
        placas: spec0.placas.map((p: Rec) => ({ ...p, recortes: (c?.recortes ?? []).filter((r: any) => r?.placa === p.id), gravuras: (c?.gravuras ?? []).filter((g: any) => g?.placa === p.id) })),
        cena: c?.cena,
      });
      const { resposta: cena, erros: errosCena } = await etapaComConferencia('4-cena', conversa4, (c) => validar(juntar(c), mesa).erros, rodada);
      const spec = errosCena.length ? spec0 : juntar(cena);
      if (errosCena.length) {
        avisosRodada.push({ etapa: '4-cena', msg: 'a cena nao passou no validador; a estrutura segue sem ela', erros: errosCena });
        aviso(`A cena não passou no validador; a estrutura segue sem ela: ${errosCena.slice(0, 3).map((e: any) => e.msg).join(' | ')}`);
      }
      const nPecas = (spec.cena?.camadas ?? []).reduce((n: number, c: Rec) => n + (c.pecas?.length ?? 0), 0);
      pronto('4-cena', errosCena.length ? 'sem cena (não passou no validador)' : `${nPecas} peça(s) decorativa(s) em ${spec.cena?.camadas?.length ?? 0} camada(s)`, rodada);

      // Stage 4b — the program's builder makes the parts, checks every decorative part and photographs the 3D.
      // Everything comes from THIS run: nothing is read from an earlier one.
      inicio('4-montar', rodada);
      const rel = await montar(kit, spec, {
        mesa, ia, fotoUsuario: fotos[0] ?? null, notaMinima: NOTA_MINIMA, maxWeb: MAX_WEB,
        onPeca: (p) => emit({ kind: 'part', id: p.id, name: p.nome, score: p.nota, source: p.origem, image: p.image, accepted: p.ok }),
      });
      construida = rodada;
      editor.setSel([]);
      const { scene } = collectScene(editor, espessura);
      // the views look at the PRODUCT's front, whichever way the assembly ended up in the 3D
      const eixos = eixosDoProduto(scene, spec.placas, (id) => rel.pecas.find((p) => p.placa === id)?.id);
      ultimosEixos = eixos ?? ultimosEixos;
      kit.step('frente do produto no 3D', eixos ? `direita ${eixos.x.join(',')} · fundo ${eixos.y.join(',')} · alto ${eixos.z.join(',')}` : 'nao deu para casar os eixos: vistas padrao', !!eixos);
      const imagens3d = await fotos3d(scene, eixos).catch((e) => { kit.step('fotos do 3D', String((e as Error)?.message ?? e), false); return [] as { vista: string; url: string }[]; });
      kit.step('fotos do 3D', `${imagens3d.length} (${imagens3d.map((f) => f.vista).join(', ')})`, imagens3d.length === VISTAS.length);
      estadoConstruido = JSON.stringify({ doc: editor.doc });
      emit({ kind: 'model', axes: eixos });
      const colisoes = rel.vista3d_dados?.colisoes ?? [];
      const pecasCena = (rel.cena?.pecas ?? []).map((x) => ({ peca: x.peca, ok: x.ok, nota: x.escolhida?.nota, origem: x.escolhida?.origem }));
      const sistema: Rec = { pecas_da_cena: pecasCena, colisoes, pecas: rel.vista3d_dados?.pecas, conjuntos: rel.vista3d_dados?.conjuntos, medidas_erradas: (rel.medidas ?? []).filter((x) => !x.ok), encaixes_nao_feitos: rel.nao_feito ?? [], check_design: rel.check_design, erro: rel.erro };
      pronto('4-montar', rel.erro ? `a montagem parou: ${rel.erro.split('\n')[0]}` : `${rel.pecas.length} placa(s), ${rel.encaixes.filter((e) => e.feito).length} encaixe(s), colisões no 3D: ${colisoes.length}`, rodada);

      // Stage 5 — reviewer WITHOUT the earlier reasoning: only the photo, the 3D pictures and what the system measured
      inicio('5-conferir', rodada);
      const conversa5: LlmMessage[] = [{ role: 'user', images: [...fotos, ...imagens3d.map((f) => dataUrlImagem(f.url))], text: `${PROMPTS.conferir}\n\nAs ${imagens3d.length} ultimas imagens sao o 3D montado pelo programa, nesta ordem: ${imagens3d.map((f) => f.vista).join(', ')}.\n\nVerificacoes do programa:\n${contexto(sistema)}\n\nEsquema da resposta:\n${ESQUEMAS.diferencas}` }];
      const dif = await perguntar('5-conferir', conversa5);
      const difs: any[] = dif?.diferencas ?? [];
      const graves = difs.filter((d) => d?.gravidade === 'grave').length;
      emit({ kind: 'assistant', stage: '5-conferir', text: [`Veredito: ${dif?.veredito}`, ...((dif?.observacoes_por_vista ?? []) as any[]).map((o) => `${o.vista}: ${o.o_que_vejo}`), ...difs.map((d) => `[${d.gravidade}] ${d.onde}: esperado ${d.esperado}; no 3D ${d.observado}`)].join('\n') });
      // the verdict belongs to the code: "igual" only counts with zero errors of the system
      const limpoNoSistema = !colisoes.length && !sistema.medidas_erradas.length && !sistema.encaixes_nao_feitos.length && !sistema.erro;
      const nota = colisoes.length * 10 + sistema.medidas_erradas.length * 10 + graves;
      if (!melhor || nota < melhor.nota) melhor = { rodada, estado: estadoConstruido, rel, sistema, dif, nota, spec };
      pronto('5-conferir', `veredito ${dif?.veredito}; ${difs.length} diferença(s), ${graves} grave(s); sistema ${limpoNoSistema ? 'sem erro' : 'com erro'}`, rodada);
      if (dif?.veredito === 'igual' && limpoNoSistema) break;
      if (dif?.veredito === 'perguntar') throw new Parada('5-conferir', 'o conferente não consegue decidir pela foto', difs);
      if (rodada > 1 && nota > melhor.nota) break; // got worse: keep the best and stop
      if (rodada === VOLTAS) break;
      conversa2.push({ role: 'user', text: `O programa montou suas vistas e um conferente comparou o 3D com a foto. Diferencas e verificacoes, literais:\n${contexto({ diferencas: difs, sistema })}\nCorrija as VISTAS so nas placas citadas (se a diferenca for so da cena, devolva as mesmas vistas). Responda so com o JSON.` });
      conversa4.push({ role: 'user', text: `O programa montou a cena e um conferente comparou o 3D com a foto. Diferencas e o resultado de cada peca (nota da conferencia, de onde veio), literais:\n${contexto({ diferencas: difs, pecas_da_cena: pecasCena })}\nCorrija a CENA (posicao, tamanho, fonte, busca, camada) so no que foi apontado. Responda so com o JSON.` });
    }

    // ---------- Stage 6: deliver ----------
    inicio('6-entregar');
    const m = melhor!;
    if (construida !== m.rodada) {
      editor.load(m.estado);
      editor.emit('doc');
      editor.emit('sel');
      emit({ kind: 'model' });
      kit.step('versao entregue', `a melhor foi a da volta ${m.rodada}`);
    }
    const ok = !m.sistema.colisoes.length && !m.sistema.medidas_erradas.length;
    for (const a of m.rel.avisos ?? []) aviso(String(a.msg ?? a.codigo));
    for (const n of m.rel.nao_feito ?? []) aviso(`Não feito: ${n.peca ?? `${n.a}+${n.b}`}: ${n.erro ?? n.motivo ?? ''}`);
    if (m.rel.erro) aviso(`A montagem parou: ${m.rel.erro.split('\n')[0]}`);
    for (const a of avisosRodada) if (a.etapa !== '4-cena') aviso(String(a.msg));
    // sizes as measured on the cut parts (a glued end is 1 thickness shorter than the plate of the specification)
    const pecas = (m.spec.placas as Rec[]).map((p) => {
      const med = m.rel.medidas.find((x) => x.placa === p.id)?.medido;
      return `${p.nome ?? p.id} ${med ? med.join(' x ') : (['x', 'y', 'z'] as const).map((k) => p[k][1] - p[k][0]).filter((d) => Math.abs(d - espessura) > 1e-6).join(' x ')} mm`;
    });
    const nCena = m.rel.cena?.pecas.length ?? 0;
    const summary = `${analise.tipo_objeto}: ${pecas.length} placa(s) (${pecas.join('; ')})${nCena ? `, ${nCena} peça(s) decorativa(s)` : ''}. Colisões no 3D: ${m.sistema.colisoes.length}. Medidas erradas: ${m.sistema.medidas_erradas.length}. Custo estimado: US$ ${custo.usd} em ${custo.calls} chamada(s).`;
    pronto('6-entregar', ok ? 'pronto para conferir e cortar' : 'entregue com erro do sistema');
    emit({ kind: 'result', ok, summary, warnings, notVerified });
  } catch (e) {
    const abortado = !!signal?.aborted || (e as Error)?.name === 'AbortError';
    let detail: string;
    if (abortado) detail = 'cancelado pelo usuário';
    else if (e instanceof LlmError || (e as any)?.providerMessage !== undefined) detail = String((e as LlmError).providerMessage); // the provider's own words
    else if (e instanceof Parada) detail = e.message + (e.extra !== undefined ? `\n${JSON.stringify(e.extra, null, 1)}` : '');
    else detail = String((e as Error)?.message ?? e);
    const etapa = e instanceof Parada ? e.etapa : atual;
    emit({ kind: 'stage', stage: etapa, title: TITULOS[etapa] ?? etapa, status: 'error', detail });
    // a version already built and checked stays on the table: the best one
    if (melhor && construida !== melhor.rodada && !abortado) {
      try { editor.load(melhor.estado); editor.emit('doc'); editor.emit('sel'); emit({ kind: 'model', axes: ultimosEixos }); } catch { /* keep what is there */ }
    }
    emit({ kind: 'result', ok: false, summary: abortado ? 'Cancelado.' : `Parou na etapa "${TITULOS[etapa] ?? etapa}": ${detail.split('\n')[0]}`, warnings, notVerified });
  }
};
