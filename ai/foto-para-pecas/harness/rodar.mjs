#!/usr/bin/env node
// rodar.mjs — o ciclo "foto -> pecas" de ponta a ponta (HARNESS.md, etapas 0 a 6).
//
//   node rodar.mjs --foto caixa.jpg --medida "x=200:largura por fora" --espessura 3 --saida execucoes/caixa
//   node rodar.mjs ... --confirmado                 o usuario leu o resumo da etapa 1 e confirma
//   node rodar.mjs ... --resposta "a tampa e solta"  resposta a uma pergunta da IA (pode repetir)
//   node rodar.mjs ... --aceito-hipoteses           seguir com cotas que vieram da proporcao da foto
//   node rodar.mjs --ensaio ensaio/organizadora --medida "x=200:largura por fora" --espessura 3 --saida execucoes/ensaio
//
// --ensaio <pasta>: NAO chama a API; le as respostas gravadas em <pasta>/<etapa>.json (e <etapa>-2.json, ... nas
// voltas). Serve para provar o encanamento sem gastar dinheiro. Tudo o mais (conferidor, validador, construtor no
// app, fotos, verificacoes) roda de verdade.
//
// Com API: precisa de ANTHROPIC_API_KEY (ou outra credencial que o SDK oficial reconheca). Modelos em modelos.json.
// Nada vai ao laser: o ciclo termina com as pecas na mesa do app, o 3D e a lista do que conferir.
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { conferir } from './conferir-vistas.mjs';
import { validar } from '../montagem/validar.mjs';
import { chamar, extrairJson } from './ia.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const MONTAGEM = resolve(AQUI, '../montagem');
const ler = (f) => readFileSync(f, 'utf8');
const lerJson = (f) => JSON.parse(ler(f));
const gravar = (f, v) => writeFileSync(f, typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const MODELOS = lerJson(join(AQUI, 'modelos.json'));
const VOLTAS = MODELOS.voltas_maximas ?? 3;

// ---------- Argumentos (etapa 0) ----------
const args = process.argv.slice(2);
const val = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const todos = (k) => args.flatMap((a, i) => (a === k ? [args[i + 1]] : []));
const tem = (k) => args.includes(k);
const ensaio = val('--ensaio') ? resolve(val('--ensaio')) : null;
const fotos = todos('--foto').map((f) => resolve(f));
const espessura = Number(val('--espessura'));
const medidas = todos('--medida').map((m) => {
  const [eixoMm, oque = 'medida informada'] = m.split(':');
  const [eixo, mm] = eixoMm.split('=');
  return { o_que: oque, eixo: eixo.trim().toLowerCase(), mm: Number(mm), alvo: 'envolvente' };
});
const respostas = todos('--resposta');
const saida = resolve(val('--saida') ?? join(AQUI, 'execucoes', 'ultima'));
mkdirSync(saida, { recursive: true });

const faltas = [];
if (!ensaio && !fotos.length) faltas.push('--foto (pelo menos uma foto do objeto)');
if (!medidas.length || medidas.some((m) => !['x', 'y', 'z'].includes(m.eixo) || !(m.mm > 0))) faltas.push('--medida "x=200:o que foi medido" (pelo menos UMA medida real, em mm, com o eixo: x largura, y profundidade, z altura)');
if (!(espessura > 0)) faltas.push('--espessura 3 (espessura do material, em mm)');
for (const f of fotos) if (!existsSync(f)) faltas.push(`a foto ${f} nao existe`);
if (faltas.length) { console.log(JSON.stringify({ parou: 'etapa 0', motivo: 'Foto nao tem escala: sem estes dados o harness nao inventa nada.', falta: faltas }, null, 2)); process.exit(2); }
// area util de corte da maquina do usuario (padrao 400 x 400); vai para o validador e o construtor por KZ_MESA
const mesa = (val('--mesa') ?? process.env.KZ_MESA ?? '400x400').split(/x/i).map(Number);
process.env.KZ_MESA = mesa.join('x');
const entrada = { fotos: fotos.map((f) => basename(f)), medidas_reais: medidas, espessura, mesa_mm: mesa, respostas_do_usuario: respostas };
gravar(join(saida, 'entrada.json'), entrada);

// ---------- Conversa com a IA ----------
const custo = existsSync(join(saida, 'custo.json')) ? lerJson(join(saida, 'custo.json')) : { chamadas: [], usd_estimado: 0 };
const imagem = (f) => ({ type: 'image', source: { type: 'base64', media_type: ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' })[extname(f).toLowerCase()] ?? 'image/png', data: readFileSync(f).toString('base64') } });
const SISTEMA = ler(join(AQUI, 'prompts', 'sistema.md'));

/** Uma etapa: manda as mensagens, devolve o JSON da resposta. As mensagens so crescem (nada se reescreve). */
async function perguntar(etapa, mensagens, volta) {
  if (ensaio) {
    const f = join(ensaio, volta > 1 ? `${etapa}-${volta}.json` : `${etapa}.json`);
    if (!existsSync(f)) throw Error(`ensaio sem resposta gravada para ${etapa} (volta ${volta}): ${f}`);
    const json = lerJson(f);
    mensagens.push({ role: 'assistant', content: [{ type: 'text', text: JSON.stringify(json) }] });
    return json;
  }
  // --retomar: reaproveita a resposta ja paga desta etapa/volta (gravada em <saida>/<etapa>-v<volta>.resposta.txt)
  const pago = join(saida, `${etapa}-v${volta}.resposta.txt`);
  if (tem('--retomar') && existsSync(pago)) {
    const texto = ler(pago);
    mensagens.push({ role: 'assistant', content: [{ type: 'text', text: texto }] });
    return extrairJson(texto);
  }
  // provedor e modelo de cada etapa em modelos.json (OpenRouter ou Anthropic); a chave em config/chaves.env
  const r = await chamar({ etapa, sistema: SISTEMA, mensagens });
  custo.chamadas.push({ etapa, volta, modelo: r.modelo, entrada: r.uso.entrada, saida: r.uso.saida, usd: r.uso.usd });
  custo.usd_estimado = Math.round(custo.chamadas.reduce((x, c) => x + (c.usd ?? 0), 0) * 10000) / 10000;
  gravar(join(saida, 'custo.json'), custo);
  // a resposta volta inteira para a conversa, para a proxima volta (a conversa so cresce)
  mensagens.push({ role: 'assistant', content: r.conteudo });
  gravar(join(saida, `${etapa}-v${volta}.resposta.txt`), r.texto);
  return extrairJson(r.texto);
}
const esquema = (nome) => ler(join(AQUI, 'esquemas', nome));
const contexto = (obj) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';

/** Repete a etapa ate o conferidor por codigo aceitar; os erros voltam LITERAIS para a IA */
async function etapaComConferencia(etapa, mensagens, conferente) {
  let ultimo;
  for (let volta = 1; volta <= VOLTAS; volta++) {
    const resposta = await perguntar(etapa, mensagens, volta);
    const erros = conferente(resposta);
    ultimo = { resposta, erros, volta };
    gravar(join(saida, `${etapa}.json`), resposta);
    if (!erros.length) return ultimo;
    gravar(join(saida, `${etapa}-erros-v${volta}.json`), erros);
    mensagens.push({ role: 'user', content: [{ type: 'text', text: `O conferidor por codigo recusou a resposta. Erros, literais:\n${contexto(erros)}\nCorrija exatamente o que foi apontado e nao mexa no resto. Responda so com o JSON.` }] });
  }
  return ultimo;
}
const parar = (etapa, extra) => { const r = { parou: etapa, saida, ...extra, custo_usd_estimado: custo.usd_estimado }; gravar(join(saida, 'resultado.json'), r); console.log(JSON.stringify(r, null, 2)); process.exit(3); };

// ---------- Etapa 1: compreender ----------
const fotoBlocos = fotos.map(imagem);
const conversa1 = [{ role: 'user', content: [...fotoBlocos, { type: 'text', text: `${ler(join(AQUI, 'prompts', '1-compreender.md'))}\n\nEntrada:\n${contexto(entrada)}\n\nEsquema da resposta:\n${esquema('analise.schema.json')}` }] }];
const ROTAS = ['placas', 'camadas', 'organico'];
const conferirAnalise = (a) => {
  const req = ['tipo_objeto', 'rota', 'placas_visiveis', 'partes_moveis', 'oculto', 'perguntas', 'resumo_para_usuario'];
  const e = req.filter((k) => !(k in a)).map((k) => ({ codigo: 'campo-faltando', campo: k }));
  if (!ROTAS.includes(a.rota)) e.push({ codigo: 'rota', msg: `rota "${a.rota}" nao e uma de ${ROTAS.join(', ')}` });
  return e;
};
const { resposta: analise, erros: errosAnalise } = await etapaComConferencia('1-compreender', conversa1, conferirAnalise);
if (errosAnalise.length) parar('etapa 1', { motivo: 'a analise nao passou na conferencia depois das voltas', erros: errosAnalise });
const bloqueios = (analise.perguntas ?? []).filter((q) => q.bloqueia);
if (!tem('--confirmado') || (bloqueios.length && !respostas.length)) {
  parar('etapa 1 — ponto de parada 1', {
    motivo: 'O usuario precisa confirmar a interpretacao (e responder as perguntas que mudam tamanho ou numero de pecas) antes de seguir.',
    resumo: analise.resumo_para_usuario, rota: analise.rota, perguntas: analise.perguntas, oculto: analise.oculto, hipoteses: analise.hipoteses,
    como_seguir: 'rode de novo com --confirmado e, se houver perguntas, uma --resposta "..." para cada uma',
  });
}
if (analise.rota !== 'placas') parar('etapa 1', { motivo: `rota "${analise.rota}": este ciclo so constroi a rota "placas" por enquanto (camadas e organico estao so desenhadas em HARNESS.md)` });

// ---------- Etapas 2 a 5, com voltas de conferencia contra o 3D ----------
const conversa2 = [{ role: 'user', content: [...fotoBlocos, { type: 'text', text: `${ler(join(AQUI, 'prompts', '2-vistas.md'))}\n\nAnalise confirmada pelo usuario:\n${contexto(analise)}\n\nEntrada:\n${contexto(entrada)}\n\nEsquema da resposta:\n${esquema('vistas.schema.json')}` }] }];
let melhor = null;
let conversa4 = null;
const avisosRodada = [];
for (let rodada = 1; rodada <= VOLTAS; rodada++) {
  // Etapa 2 — vistas, conferidas por codigo (as medidas reais do usuario entram de fora: a IA nao pode trocar)
  const { resposta: vistas, erros: errosVistas } = await etapaComConferencia('2-vistas', conversa2, (v) => conferir({ ...v, espessura, medidas_reais: medidas }, { mesa }).erros ?? []);
  if (errosVistas.length) parar('etapa 2', { motivo: 'as tres vistas nao fecharam entre si depois das voltas', erros: errosVistas });
  const conf = conferir({ ...vistas, espessura, medidas_reais: medidas }, { mesa });
  const hipoteses = (vistas.cotas ?? []).filter((c) => c.origem === 'hipotese');
  if (hipoteses.length && !tem('--aceito-hipoteses')) {
    parar('etapa 2 — cotas por hipotese', { motivo: 'Estas medidas vieram da proporcao da foto, nao de voce. Confira ou de mais uma --medida; para seguir assim, use --aceito-hipoteses.', hipoteses, placas: conf.placas });
  }

  // Etapa 3 — especificar; os numeros das placas vem do conferidor, nunca da IA
  const conversa3 = [{ role: 'user', content: [{ type: 'text', text: `${ler(join(AQUI, 'prompts', '3-especificar.md'))}\n\nPlacas calculadas pelo conferidor:\n${contexto(conf.placas)}\n\nAnalise:\n${contexto(analise)}\n\nEspessura: ${espessura} mm.\n\nEsquema da resposta:\n${esquema('kz-montagem-1.schema.json')}` }] }];
  const montarSpec = (s) => ({ ...s, spec: 'kz-montagem/1', espessura, placas: conf.placas.map((p) => ({ ...(s.placas ?? []).find((q) => q.id === p.id), ...p })) });
  const { resposta: spec3, erros: errosSpec } = await etapaComConferencia('3-especificar', conversa3, (s) => validar(montarSpec(s)).erros);
  if (errosSpec.length) parar('etapa 3', { motivo: 'a especificacao nao passou no validador', erros: errosSpec });
  const spec0 = montarSpec(spec3);

  // Etapa 4 — cena e acabamento: janelas, textos gravados e as pecas decorativas em camadas
  if (!conversa4) conversa4 = [{ role: 'user', content: [...fotoBlocos, { type: 'text', text: `${ler(join(AQUI, 'prompts', '4-cena.md')).replace('{BIBLIOTECA}', ler(join(AQUI, 'prompts', 'biblioteca-ids.txt')))}\n\nPlacas da estrutura (mm):\n${contexto(spec0.placas.map(({ id, nome, x, y, z }) => ({ id, nome, x, y, z })))}\n\nAnalise:\n${contexto(analise)}\n\nEspessura: ${espessura} mm.\n\nEsquema da resposta:\n${esquema('cena.schema.json')}` }] }];
  const juntar = (c) => ({
    ...spec0,
    placas: spec0.placas.map((p) => ({ ...p, recortes: (c.recortes ?? []).filter((r) => r.placa === p.id), gravuras: (c.gravuras ?? []).filter((g) => g.placa === p.id) })),
    cena: c.cena,
  });
  const { resposta: cena, erros: errosCena } = await etapaComConferencia('4-cena', conversa4, (c) => validar(juntar(c)).erros);
  const spec = errosCena.length ? spec0 : juntar(cena);
  if (errosCena.length) avisosRodada.push({ etapa: '4-cena', msg: 'a cena nao passou no validador; a estrutura segue sem ela', erros: errosCena });
  // nome unico por execucao: a montagem grava em montagem/saida/<nome>-*.png|json, pasta comum a todas as execucoes
  // (medido: "objeto-r1" de um ensaio antigo foi lido como se fosse do cofrinho, e o conferente julgou outro objeto)
  const arqSpec = join(saida, `${basename(saida)}-r${rodada}.json`);
  gravar(arqSpec, spec);

  // Etapa 4b — o construtor do sistema monta as pecas, confere cada peca decorativa e fotografa o 3D
  const inicioMontagem = Date.now();
  const m = spawnSync(process.execPath, [join(MONTAGEM, 'montar.mjs'), arqSpec, ...(fotos[0] ? ['--foto', fotos[0]] : []), ...(ensaio ? ['--sem-ia'] : [])], { encoding: 'utf8', env: process.env, timeout: 3600000 });
  const slug = basename(arqSpec).replace(/\.json$/i, '');
  const arqRel = join(MONTAGEM, 'saida', `${slug}-relatorio.json`);
  // a montagem tem de ter gravado o relatorio DESTA rodada; senao para com a frase literal do erro dela
  if (!existsSync(arqRel) || statSync(arqRel).mtimeMs < inicioMontagem) {
    gravar(join(saida, `montagem-r${rodada}-erro.txt`), `status ${m.status} ${m.signal ?? ''}
${m.error ?? ''}
--- stderr ---
${m.stderr ?? ''}
--- stdout ---
${m.stdout ?? ''}`);
    parar(`etapa 4b (rodada ${rodada})`, { motivo: 'a montagem no programa nao terminou', erro_literal: String(m.error ?? '') + (m.stderr ?? '').trim().split(/\r?\n/).slice(-6).join(' | ') });
  }
  const rel = lerJson(arqRel);
  const fotos3d = ['iso', 'topo', 'frente'].map((v) => join(MONTAGEM, 'saida', `${slug}-3d-${v}.png`)).filter(existsSync);
  const colisoes = rel.vista3d_dados?.colisoes ?? [];
  for (const c of rel.custo_ia?.chamadas ?? []) custo.chamadas.push({ etapa: `montagem:${c.etapa}`, volta: rodada, modelo: c.modelo, entrada: c.entrada, saida: c.saida, usd: c.usd });
  custo.usd_estimado = Math.round(custo.chamadas.reduce((x, c) => x + (c.usd ?? 0), 0) * 10000) / 10000;
  gravar(join(saida, 'custo.json'), custo);
  const pecasCena = (rel.cena?.pecas ?? []).map((x) => ({ peca: x.peca, ok: x.ok, nota: x.escolhida?.nota, origem: x.escolhida?.origem }));
  const sistema = { pecas_da_cena: pecasCena, colisoes, pecas: rel.vista3d_dados?.pecas, conjuntos: rel.vista3d_dados?.conjuntos, medidas_erradas: (rel.medidas ?? []).filter((x) => !x.ok), encaixes_nao_feitos: rel.nao_feito ?? [], check_design: rel.check_design, erro: rel.erro ?? (m.status ? m.stderr?.slice(-800) : undefined) };

  // Etapa 5 — conferente SEM o raciocinio anterior: so a foto, as fotos do 3D e o que o sistema mediu
  const conversa5 = [{ role: 'user', content: [...fotoBlocos, ...fotos3d.map(imagem), { type: 'text', text: `${ler(join(AQUI, 'prompts', '5-conferir.md'))}\n\nAs ${fotos3d.length} ultimas imagens sao o 3D montado pelo programa, nesta ordem: ${['iso', 'topo', 'frente'].slice(0, fotos3d.length).join(', ')}.\n\nVerificacoes do programa:\n${contexto(sistema)}\n\nEsquema da resposta:\n${esquema('diferencas.schema.json')}` }] }];
  const dif = await perguntar('5-conferir', conversa5, rodada);
  gravar(join(saida, `5-conferir-r${rodada}.json`), dif);
  const graves = (dif.diferencas ?? []).filter((d) => d.gravidade === 'grave').length;
  // o veredito e do codigo: "igual" so vale com zero erro do sistema
  const limpoNoSistema = !colisoes.length && !sistema.medidas_erradas.length && !sistema.encaixes_nao_feitos.length && !sistema.erro;
  const nota = colisoes.length * 10 + sistema.medidas_erradas.length * 10 + graves;
  const versao = { rodada, spec: arqSpec, fotos3d, sistema, diferencas: dif, nota };
  if (!melhor || nota < melhor.nota) melhor = versao;
  if (dif.veredito === 'igual' && limpoNoSistema) break;
  if (dif.veredito === 'perguntar') parar('etapa 5', { motivo: 'o conferente nao consegue decidir pela foto', diferencas: dif, melhor_versao: melhor.spec });
  if (rodada > 1 && nota > melhor.nota) break; // piorou: fica a melhor e para
  conversa2.push({ role: 'user', content: [{ type: 'text', text: `O programa montou suas vistas e um conferente comparou o 3D com a foto. Diferencas e verificacoes, literais:\n${contexto({ diferencas: dif.diferencas, sistema })}\nCorrija as VISTAS so nas placas citadas (se a diferenca for so da cena, devolva as mesmas vistas). Responda so com o JSON.` }] });
  conversa4.push({ role: 'user', content: [{ type: 'text', text: `O programa montou a cena e um conferente comparou o 3D com a foto. Diferencas e o resultado de cada peca (nota da conferencia, de onde veio), literais:\n${contexto({ diferencas: dif.diferencas, pecas_da_cena: pecasCena })}\nCorrija a CENA (posicao, tamanho, fonte, busca, camada) so no que foi apontado. Responda so com o JSON.` }] });
}

// ---------- Etapa 6: entregar ----------
const final = lerJson(melhor.spec);
const entrega = {
  ok: !melhor.sistema.colisoes.length && !melhor.sistema.medidas_erradas.length,
  objeto: analise.tipo_objeto,
  especificacao: melhor.spec,
  fotos_3d: melhor.fotos3d,
  pecas: final.placas.map((p) => ({ id: p.id, nome: p.nome, mm: ['x', 'y', 'z'].map((k) => p[k][1] - p[k][0]).filter((d) => Math.abs(d - espessura) > 1e-6) })),
  verificacoes_do_sistema: melhor.sistema,
  hipoteses_assumidas: analise.hipoteses ?? [],
  conferir_antes_de_cortar: ['medidas criticas contra o objeto real', 'um corte de teste de um encaixe na mesma chapa', 'a compensacao do corte (kerf) do material'],
  nao_verificado: ['nenhuma peca foi cortada', 'as faces que a foto nao mostra sao hipotese'],
  custo_usd_estimado: custo.usd_estimado,
  ensaio: !!ensaio,
};
gravar(join(saida, 'resultado.json'), entrega);
console.log(JSON.stringify(entrega, null, 2));
process.exit(entrega.ok ? 0 : 1);
