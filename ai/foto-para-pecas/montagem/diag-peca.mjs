// diagnostico: o ciclo de qualidade de UMA peca, com a IA (custa pouco)
import { construirPeca } from './silhuetas.mjs';
import { chamar, extrairJson } from '../harness/ia.mjs';
import { readFileSync } from 'node:fs';
const LIB = 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio } = await import(LIB);
const foto = { type: 'image', source: { type: 'base64', media_type: 'image/webp', data: readFileSync('../referencias/cofrinho-viagem.webp').toString('base64') } };
let usd = 0;
const ia = async (etapa, conteudo) => { const r = await chamar({ etapa, sistema: 'Voce e projetista de pecas de MDF para corte a laser. Responda so com o JSON pedido.', mensagens: [{ role: 'user', content: conteudo }], esforco: 'medium', maxTokens: 16000 }); usd += r.uso.usd ?? 0; return extrairJson(r.texto); };
const p = await studio('pt-BR');
const registro = [];
const peca = JSON.parse(process.argv[2]);
const t0 = Date.now();
const r = await construirPeca(p, peca, { x: 50, y: 50, w: 210, h: 170 }, { camada: 0, ia, fotoUsuario: foto, notaMinima: 7, maxWeb: 4, registro });
await p.tool('select', { ids: [r.id] });
await p.shot(`saida/diag-${peca.id}.png`);
console.log(JSON.stringify({ r, segundos: Math.round((Date.now() - t0) / 1000), usd: Math.round(usd * 1000) / 1000, registro }, null, 1));
await p.close();
