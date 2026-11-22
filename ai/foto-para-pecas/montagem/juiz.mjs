#!/usr/bin/env node
// juiz.mjs — quando nao ha IA (modo ensaio), quem julga as pecas da cena e uma pessoa (ou o agente que esta conduzindo).
// Para cada peca pedida, o proprio construtor (construirPeca) tenta TODOS os candidatos: a fonte da especificacao e
// cada termo extra de busca. A foto de cada tentativa, como o sistema a recortou, vai para saida/juiz/<peca>/.
// Quem julga olha as fotos e fixa a escolhida na especificacao (fonte.busca = "File:<titulo exato>.svg").
//
//   node juiz.mjs exemplos/cofrinho-ensaio.json mala "suitcase silhouette" "luggage icon"
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { construirPeca } from './silhuetas.mjs';
const LIB = process.env.KZ_LIB ?? 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio } = await import(LIB);

const [arq, pecaId, ...extras] = process.argv.slice(2);
const spec = JSON.parse(readFileSync(arq, 'utf8'));
const peca = spec.cena.camadas.flatMap((c) => c.pecas).find((x) => x.id === pecaId);
if (!peca) throw Error(`peca "${pecaId}" nao esta na cena`);
const pasta = join('saida', 'juiz', pecaId);
mkdirSync(pasta, { recursive: true });

const p = await studio('pt-BR');
await p.fresh();
const w = peca.caixa.x[1] - peca.caixa.x[0], h = peca.caixa.z[1] - peca.caixa.z[0];
const caixa = { x: 20, y: 20, w, h };
let n = 0;
const fila = [...extras];
const lista = [];
// "IA" que so guarda a foto e reprova, para o construtor seguir para o proximo candidato
const ia = async (etapa, pedido) => {
  const img = pedido.find((b) => b.type === 'image' && b.source?.media_type === 'image/png');
  const origem = (pedido.at(-1)?.text ?? '').match(/Origem desta tentativa: (.*)\./)?.[1] ?? '?';
  n++;
  const f = join(pasta, `${String(n).padStart(2, '0')}.png`);
  if (img) writeFileSync(f, Buffer.from(img.source.data, 'base64'));
  lista.push({ n, origem, foto: f });
  return { nota: 0, problemas: ['julgamento manual'], o_que_buscar: fila.shift() };
};
const fonte = peca.fonte.tipo === 'web' ? peca.fonte : { ...peca.fonte, busca: extras.shift() };
await construirPeca(p, { ...peca, fonte }, caixa, { camada: 2, ia, notaMinima: 11, maxWeb: 6, registro: [] }).catch(() => {});
await p.close();
writeFileSync(join(pasta, 'lista.json'), JSON.stringify(lista, null, 2));
console.log(JSON.stringify(lista.map((x) => `${x.n}: ${x.origem}`), null, 1));
