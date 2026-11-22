#!/usr/bin/env node
// Test of the "Crie seu produto" engine (src/criar/engine.ts) in rehearsal mode, like rodar.mjs --ensaio: the AI is a
// FAKE `call` that answers with recorded responses, so nothing is paid. Everything else runs for real inside the app:
// checker of the views, validator, builder (agent tools against the editor), Wikimedia search for the web parts,
// 3D check (collectScene) and the 3D pictures for stage 5.
//
//   node scripts/criar-engine-test.mjs          (KZ_URL=http://localhost:1420/ by default; pictures and events go to
//                                               KZ_SAIDA, default <tmp>/kizamubeam-criar-engine-test)
//
// Needs the dev server (npm run dev, http://localhost:1420 or KZ_URL) and the capture studio (KZ_LIB: app.mjs, which
// opens the app in a headless Chrome). Cases:
//   organizadora — harness/ensaio/organizadora/*.json (box with a divider; measures by hypothesis accepted)
//   cofrinho     — answers built from montagem/exemplos/cofrinho-ensaio.json (400 x 400 x 100 box, window, engravings,
//                  layered scene with 14 decorative parts; the fake part reviewer gives 10)
//   erro-da-ia   — the provider fails with its own sentence: it must reach the stage event literally
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

process.env.KZ_URL ??= 'http://localhost:1420/';
// The capture studio (app.mjs) lives OUTSIDE the repository, so look in this order: KZ_LIB, then the
// sibling folder ferramentas/capturas/, then stop and say what is missing. Never a path from another machine.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB_SIBLING = resolve(RAIZ, '..', 'ferramentas', 'capturas', 'app.mjs');
const LIB = process.env.KZ_LIB ?? (existsSync(LIB_SIBLING) ? pathToFileURL(LIB_SIBLING).href : null);
if (!LIB) {
  console.error(
    [
      'test:criar-engine needs the capture studio (app.mjs), which lives outside the repository.',
      `  looked for: ${LIB_SIBLING}`,
      '  set its path in KZ_LIB, for example:',
      '    KZ_LIB="file:///path/to/ferramentas/capturas/app.mjs" npm run test:criar-engine',
      `  and the dev server running at ${process.env.KZ_URL}`,
    ].join('\n'),
  );
  process.exit(2);
}
const AI = join(RAIZ, 'ai', 'foto-para-pecas');
const SAIDA = process.env.KZ_SAIDA ?? join(tmpdir(), 'kizamubeam-criar-engine-test');
const lerJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

// ---------- recorded answers ----------
const org = (n) => lerJson(join(AI, 'harness', 'ensaio', 'organizadora', `${n}.json`));
const organizadora = {
  req: { text: 'Uma caixa organizadora aberta com uma divisoria no meio.', measures: [{ axis: 'x', mm: 200, what: 'largura total por fora' }], thickness: 3, bed: [400, 400] },
  respostas: {
    '1-compreender': [org('1-compreender')],
    '2-vistas': [org('2-vistas')],
    '3-especificar': [org('3-especificar')],
    // the organizer rehearsal has no scene: windows, texts and decorative parts are empty
    '4-cena': [{ spec: 'kz-cena/1', recortes: [], gravuras: [], cena: null }],
    '5-conferir': [org('5-conferir')],
  },
  pecasCena: 0,
};

const cof = lerJson(join(AI, 'montagem', 'exemplos', 'cofrinho-ensaio.json'));
const vista = (a, b) => cof.placas.map((p) => ({ placa: p.id, [a]: p[a], [b]: p[b] }));
const cofrinho = {
  req: {
    text: 'Quero este cofrinho de viagem igual a foto: moldura com janela, prateleira com divisorias, o mapa do Brasil e as figuras dentro, os textos gravados.',
    measures: [{ axis: 'x', mm: 400, what: 'largura por fora' }, { axis: 'z', mm: 400, what: 'altura por fora' }],
    thickness: 3, bed: [400, 400],
  },
  respostas: {
    '1-compreender': [{
      spec: 'kz-analise/1', _ensaio: 'escrito a mao a partir de cofrinho-ensaio.json',
      tipo_objeto: 'cofrinho de viagem em caixa com moldura e cena em camadas', rota: 'placas', rota_motivo: 'chapas planas em angulo reto',
      volumes: ['caixa rasa de pe'],
      placas_visiveis: cof.placas.map((p) => ({ id: p.id, papel: p.nome, plano: 'XZ', evidencia: 'na foto' })),
      simetria: 'nenhuma', camadas: 'cena em camadas no fundo', partes_moveis: [], encaixes_visiveis: ['dedos nos cantos'],
      oculto: ['o lado de tras'], hipoteses: ['profundidade 100 mm pela proporcao'], perguntas: [], confianca: 'media',
      resumo_para_usuario: 'Cofrinho 400 x 400 x 100 mm: caixa com moldura de janela, prateleira com 4 divisorias e uma cena em 3 camadas (mapa do Brasil, figuras, placas com nomes de cidades).',
    }],
    '2-vistas': [{
      spec: 'kz-vistas/1', espessura: 3,
      medidas_reais: [{ o_que: 'largura por fora', eixo: 'x', mm: 400, alvo: 'envolvente' }],
      vistas: { frente: vista('x', 'z'), lado: vista('y', 'z'), topo: vista('x', 'y') },
      cotas: [
        { o_que: 'largura (X)', mm: 400, origem: 'usuario', conta: 'informada' },
        { o_que: 'altura (Z)', mm: 400, origem: 'usuario', conta: 'informada' },
        { o_que: 'profundidade (Y)', mm: 100, origem: 'hipotese', conta: 'proporcao da foto' },
      ],
    }],
    '3-especificar': [{ spec: 'kz-montagem/1', nome: cof.nome, espessura: 3, placas: cof.placas.map(({ id, nome }) => ({ id, nome })), ligacoes: 'auto', moveis: [] }],
    '4-cena': [{
      spec: 'kz-cena/1',
      recortes: cof.placas.flatMap((p) => (p.recortes ?? []).map((r) => ({ placa: p.id, ...r }))),
      gravuras: cof.placas.flatMap((p) => (p.gravuras ?? []).map((g) => ({ placa: p.id, ...g }))),
      cena: cof.cena,
    }],
    '5-conferir': [{ spec: 'kz-diferencas/1', observacoes_por_vista: [{ vista: 'iso', o_que_vejo: 'caixa com moldura e cena' }, { vista: 'topo', o_que_vejo: 'caixa rasa' }, { vista: 'frente', o_que_vejo: 'janela com o mapa' }], diferencas: [], veredito: 'igual' }],
    'peca-conferir': [{ nota: 10, parece: 'ensaio: o juiz falso aprova', problemas: [] }],
  },
  pecasCena: cof.cena.camadas.reduce((n, c) => n + c.pecas.length, 0),
};

// ---------- in the page ----------
async function rodar(p, nome, caso, falha) {
  return p.ev(`(async()=>{
    const { runEngine } = await window.__kzImport('/src/criar/engine.ts');
    const { LlmError } = await window.__kzImport('/src/criar/contract.ts');
    const { collectScene } = await window.__kzImport('/src/view3d/panel.ts');
    const caso = ${JSON.stringify(caso)};
    const falha = ${JSON.stringify(falha ?? null)};
    // the "user photo": a small PNG drawn here (the rehearsal has no real photo)
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const cx = cv.getContext('2d'); cx.fillStyle = '#c8a070'; cx.fillRect(8, 8, 48, 48);
    const foto = { mediaType: 'image/png', base64: cv.toDataURL('image/png').split(',')[1] };
    const vezes = {}, chamadas = [];
    const call = async (cfg, r) => {
      if (falha && r.stage === falha.stage) throw new LlmError('openrouter', 402, falha.message, 'credits');
      const lista = caso.respostas[r.stage];
      if (!lista) throw new Error('ensaio sem resposta gravada para ' + r.stage);
      const n = vezes[r.stage] = (vezes[r.stage] ?? 0) + 1;
      chamadas.push({ stage: r.stage, n, review: !!r.review, maxTokens: r.maxTokens, imagens: r.messages.reduce((s, m) => s + (m.images?.length ?? 0), 0), texto: r.messages.map((m) => m.text ?? '').join('').length, pedido: r.messages[0]?.text?.includes(${JSON.stringify(caso.req.text)}) });
      const v = lista[Math.min(n, lista.length) - 1];
      return { text: JSON.stringify(v), model: 'ensaio', usage: { input: 0, output: 0, usd: 0 } };
    };
    const eventos = [], pecas = [];
    const hooks = {
      onEvent: (e) => { if (e.kind === 'part' && e.image) pecas.push(e); eventos.push(e.kind === 'part' ? { ...e, image: e.image ? e.image.length : 0 } : e); },
      confirm: async (resumo, perguntas, hipoteses) => { eventos.push({ kind: 'confirm', resumo, perguntas, hipoteses }); return { confirmed: true, answers: [] }; },
    };
    const t0 = performance.now();
    await runEngine(window.editor, { provider: 'openrouter', apiKey: 'ensaio', model: 'ensaio' }, call, { images: [foto], ...caso.req }, hooks, new AbortController().signal);
    const ms = Math.round(performance.now() - t0);
    const ed = window.editor;
    ed.setSel([]);
    const { scene, asms } = collectScene(ed, caso.req.thickness);
    const asm = ed.doc.multiLayerAssemblies ?? [];
    // pictures to look at: the 3D as delivered (same viewer the engine sends to stage 5) and every decorative part
    const { fotos3d } = await window.__kzImport('/src/criar/engine/fotos3d.ts');
    const imagens = [...(await fotos3d(scene)).map((f) => ['3d-' + f.vista, f.url]), ...pecas.map((x) => ['peca-' + x.id, x.image])];
    return {
      imagens,
      ms, chamadas, eventos,
      sobreposicoes: scene.overlaps.length,
      solidos: scene.solids.length,
      placas3d: scene.solids.filter((s) => /^m\\d/.test(s.key)).length,
      conjuntos: asms,
      cena: asm.map((a) => ({ camadas: a.plates.length, mount: a.mount, existem: a.plates.every((q) => ed.doc.objs.some((o) => o.id === q.object)) })),
      objetos: ed.doc.objs.length,
    };
  })()`);
}

const p = await (await import(LIB)).studio('pt-BR');
const falhas = [];
const conferir = (caso, cond, msg) => { if (!cond) falhas.push(`${caso}: ${msg}`); console.log(`${cond ? 'ok    ' : 'FALHOU'}  ${caso}: ${msg}`); };
mkdirSync(SAIDA, { recursive: true });
try {
  for (const [nome, caso] of [['organizadora', organizadora], ['cofrinho', cofrinho]]) {
    await p.tool('new_document', {});
    const r = await rodar(p, nome, caso);
    for (const [n, url] of r.imagens) if (url) writeFileSync(join(SAIDA, `${nome}-${n}.png`), Buffer.from(url.slice(url.indexOf(',') + 1), 'base64'));
    delete r.imagens;
    writeFileSync(join(SAIDA, `${nome}.json`), JSON.stringify(r, null, 1));
    const res = r.eventos.find((e) => e.kind === 'result');
    const erros = r.eventos.filter((e) => e.kind === 'stage' && e.status === 'error');
    // parts and steps of the last build round (the version delivered)
    const ultima = r.eventos.findLastIndex((e) => e.kind === 'stage' && e.stage === '4-montar' && e.status === 'start');
    const voltas = r.eventos.filter((e) => e.kind === 'stage' && e.stage === '4-montar' && e.status === 'start').length;
    const partes = r.eventos.slice(ultima).filter((e) => e.kind === 'part');
    const passos = r.eventos.slice(ultima).filter((e) => e.kind === 'step');
    conferir(nome, voltas === 1, `uma volta so (${voltas})`);
    console.log(`\n${nome}: ${Math.round(r.ms / 1000)} s, ${r.chamadas.length} chamada(s) de IA, ${passos.length} passo(s), ${r.eventos.filter((e) => e.kind === 'model').length} evento(s) model`);
    if (erros.length) console.log('  erro:', erros.map((e) => `${e.stage}: ${e.detail}`).join(' | '));
    conferir(nome, res?.ok === true, `result.ok (${res?.summary})`);
    conferir(nome, r.sobreposicoes === 0, `sobreposicoes no 3D: ${r.sobreposicoes} (solidos ${r.solidos}, placas ${r.placas3d}, conjuntos ${r.conjuntos})`);
    conferir(nome, r.chamadas.find((c) => c.stage === '1-compreender')?.pedido === true, 'o texto do usuario entrou no pedido da etapa 1');
    conferir(nome, r.eventos.some((e) => e.kind === 'confirm'), 'ponto de parada da etapa 1 (confirm) chamado');
    const c5 = r.chamadas.find((c) => c.stage === '5-conferir');
    conferir(nome, c5?.imagens === 4, `etapa 5 recebeu a foto + 3 fotos do 3D (${c5?.imagens} imagens)`);
    conferir(nome, r.eventos.some((e) => e.kind === 'cost'), 'evento cost depois das chamadas');
    if (nome === 'organizadora') {
      conferir(nome, r.placas3d === 6, `6 placas no 3D (${r.placas3d})`);
      conferir(nome, res?.warnings?.some((w) => /hip[oó]tese/i.test(w)), `cotas por hipotese listadas nos avisos (${res?.warnings?.length} aviso(s))`);
    } else {
      conferir(nome, r.placas3d === cof.placas.length, `${cof.placas.length} placas no 3D (${r.placas3d})`);
      conferir(nome, partes.length === caso.pecasCena && partes.every((x) => x.accepted && x.image > 0), `pecas da cena: ${partes.filter((x) => x.accepted).length} de ${caso.pecasCena} aceitas, com foto (${partes.map((x) => `${x.id}=${x.score}`).join(', ')})`);
      conferir(nome, r.cena.length === 1 && r.cena[0].camadas === cof.cena.camadas.length && r.cena[0].existem, `cena montada: ${JSON.stringify(r.cena)}`);
      const face = passos.find((s) => s.label === 'face gravada frente');
      conferir(nome, !!face?.ok && /-> fora/.test(face.detail), `gravura da frente para fora (${face?.detail})`);
      const web = passos.filter((s) => s.label.startsWith('busca Wikimedia'));
      conferir(nome, web.length > 0 && web.every((s) => s.ok), `busca Wikimedia: ${web.map((s) => `${s.label.slice(17)} -> ${s.detail}`).join('; ')}`);
      const colado = passos.filter((s) => /^colado (divisoria|prateleira).*\+frente|^colado frente\+(divisoria|prateleira)/.test(s.label));
      conferir(nome, colado.length === 5, `espigas que caem na janela viraram colado: ${colado.length} de 5`);
    }
  }
  // the provider's own sentence must reach the chat literally
  const frase = 'This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1234.';
  await p.tool('new_document', {});
  const r = await rodar(p, 'erro-da-ia', organizadora, { stage: '1-compreender', message: frase });
  const err = r.eventos.find((e) => e.kind === 'stage' && e.status === 'error');
  conferir('erro-da-ia', err?.stage === '1-compreender' && err?.detail === frase, `frase literal do provedor no evento stage (${err?.detail})`);
  conferir('erro-da-ia', r.eventos.find((e) => e.kind === 'result')?.ok === false, 'result.ok = false');
  if (p.errors?.length) console.log('erros da pagina:', p.errors.slice(0, 5));
} finally {
  await p.close();
}
console.log(falhas.length ? `\n${falhas.length} conferencia(s) FALHARAM` : '\ntodas as conferencias passaram');
process.exit(falhas.length ? 1 : 0);
