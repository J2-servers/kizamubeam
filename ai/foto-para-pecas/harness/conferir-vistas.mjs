#!/usr/bin/env node
// conferir-vistas.mjs — Node puro, sem dependencias.
// Confere se as tres vistas ortogonais (kz-vistas/1) descrevem as MESMAS placas.
// Eixos: X largura (direita), Y profundidade (fundo), Z altura (cima), em mm.
//   frente = plano X,Z   lado = plano Y,Z   topo = plano X,Y
//
// Uso:
//   node conferir-vistas.mjs vistas.json            relatorio JSON; sai com 1 se houver erro
//   node conferir-vistas.mjs vistas.json --placas   so o bloco "placas" pronto para kz-montagem/1
//   node conferir-vistas.mjs vistas.json --tol 0.05 --mesa 400x400
//   node conferir-vistas.mjs --teste                casos embutidos (bom e ruins)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const EIXOS = { frente: ['x', 'z'], lado: ['y', 'z'], topo: ['x', 'y'] };
const PARES = [['x', 'frente', 'topo'], ['y', 'lado', 'topo'], ['z', 'frente', 'lado']];
const r3 = (n) => Math.round(n * 1000) / 1000;

export function conferir(doc, { tol = 0.05, mesa = [400, 400] } = {}) {
  const erros = [];
  const avisos = [];
  const E = (codigo, placa, msg) => erros.push({ codigo, placa, msg });
  if (!doc || doc.spec !== 'kz-vistas/1') E('spec', null, 'spec deve ser "kz-vistas/1"');
  const t = doc?.espessura;
  const temT = typeof t === 'number' && t > 0;
  if (!temT) E('espessura', null, 'espessura (mm) e obrigatoria e maior que zero; pergunte ao usuario, nao invente');
  const v = doc?.vistas ?? {};
  const porPlaca = new Map();

  for (const [vista, eixos] of Object.entries(EIXOS)) {
    const lista = v[vista];
    if (!Array.isArray(lista)) { E('vista-ausente', null, `vista "${vista}" ausente`); continue; }
    const vistos = new Set();
    for (const ret of lista) {
      const id = ret?.placa;
      if (typeof id !== 'string' || !id) { E('id', null, `vista ${vista}: retangulo sem "placa"`); continue; }
      if (vistos.has(id)) { E('duplicada', id, `vista ${vista}: placa "${id}" aparece duas vezes`); continue; }
      vistos.add(id);
      let ok = true;
      for (const e of eixos) {
        const iv = ret[e];
        if (!Array.isArray(iv) || iv.length !== 2 || !iv.every(Number.isFinite)) {
          E('intervalo', id, `vista ${vista}: "${e}" de "${id}" deve ser [inicio, fim] em mm`); ok = false;
        } else if (!(iv[1] > iv[0])) {
          E('invertido', id, `vista ${vista}: "${e}" de "${id}" tem fim <= inicio (${iv[0]}, ${iv[1]})`); ok = false;
        }
      }
      if (!ok) continue;
      if (!porPlaca.has(id)) porPlaca.set(id, {});
      porPlaca.get(id)[vista] = ret;
    }
  }

  const placas = [];
  for (const [id, p] of porPlaca) {
    const faltam = Object.keys(EIXOS).filter((vista) => !p[vista]);
    if (faltam.length) { E('falta-vista', id, `placa "${id}" falta na vista: ${faltam.join(', ')}`); continue; }
    let bate = true;
    const caixa = {};
    for (const [eixo, a, b] of PARES) {
      const ia = p[a][eixo];
      const ib = p[b][eixo];
      const d = Math.max(Math.abs(ia[0] - ib[0]), Math.abs(ia[1] - ib[1]));
      if (d > tol) {
        bate = false;
        E('nao-bate', id, `placa "${id}": eixo ${eixo.toUpperCase()} e [${ia}] na vista ${a} e [${ib}] na vista ${b} (diferenca ${r3(d)} mm)`);
      }
      caixa[eixo] = [ia[0], ia[1]];
    }
    if (!bate) continue;
    const dims = ['x', 'y', 'z'].map((e) => [e, caixa[e][1] - caixa[e][0]]);
    if (temT) {
      const finos = dims.filter(([, d]) => Math.abs(d - t) <= tol);
      const menor = Math.min(...dims.map(([, d]) => d));
      const txt = dims.map(([e, d]) => `${e}=${r3(d)}`).join(', ');
      if (menor < t - tol) E('mais-fina', id, `placa "${id}": dimensao ${r3(menor)} mm menor que a espessura ${t} mm (${txt})`);
      else if (finos.length === 0) E('espessura-placa', id, `placa "${id}": nenhuma dimensao e igual a espessura ${t} mm (${txt})`);
      else if (finos.length > 1) avisos.push({ codigo: 'ripa', placa: id, msg: `placa "${id}": ${finos.length} dimensoes iguais a espessura (ripa ou pino); confira a orientacao` });
      const grandes = dims.map(([, d]) => d).sort((m, n) => n - m).slice(0, 2);
      const [ma, mb] = [...mesa].sort((m, n) => n - m);
      if (grandes[0] > ma + tol || grandes[1] > mb + tol) {
        E('maior-que-mesa', id, `placa "${id}": ${r3(grandes[0])} x ${r3(grandes[1])} mm nao cabe na mesa ${mesa[0]} x ${mesa[1]} mm`);
      }
    }
    placas.push({ id, x: caixa.x, y: caixa.y, z: caixa.z });
  }

  let envolvente = null;
  if (placas.length) {
    envolvente = {};
    for (const e of ['x', 'y', 'z']) {
      envolvente[e] = [Math.min(...placas.map((q) => q[e][0])), Math.max(...placas.map((q) => q[e][1]))];
    }
  }

  // Trava da escala: toda medida real informada pelo usuario tem de aparecer igual no modelo.
  const reais = doc?.medidas_reais;
  if (!Array.isArray(reais) || reais.length === 0) {
    E('sem-medida-real', null, 'falta pelo menos UMA medida real (medidas_reais); foto nao tem escala — pergunte ao usuario');
  } else if (envolvente) {
    for (const m of reais) {
      const alvo = m?.alvo === 'envolvente' ? envolvente : placas.find((q) => q.id === m?.alvo);
      if (!alvo) { E('medida-real', null, `medida real aponta para "${m?.alvo}", que nao existe`); continue; }
      if (!['x', 'y', 'z'].includes(m.eixo) || !Number.isFinite(m.mm)) { E('medida-real', null, 'medida real precisa de eixo (x|y|z) e mm'); continue; }
      const tem = alvo[m.eixo][1] - alvo[m.eixo][0];
      if (Math.abs(tem - m.mm) > tol) {
        E('medida-real', m.alvo, `medida real "${m.o_que ?? ''}" = ${m.mm} mm no eixo ${m.eixo.toUpperCase()} de "${m.alvo}", mas as vistas dao ${r3(tem)} mm`);
      }
    }
  }

  return { ok: erros.length === 0, erros, avisos, placas, envolvente };
}

// ---------- casos de teste embutidos ----------
function caixaBoa() {
  const t = 3;
  const P = {
    fundo: { x: [0, 200], y: [0, 120], z: [0, t] },
    frente: { x: [0, 200], y: [0, t], z: [0, 60] },
    tras: { x: [0, 200], y: [120 - t, 120], z: [0, 60] },
    esquerda: { x: [0, t], y: [0, 120], z: [0, 60] },
    direita: { x: [200 - t, 200], y: [0, 120], z: [0, 60] },
    divisoria: { x: [98.5, 101.5], y: [0, 120], z: [0, 60] },
  };
  const vista = (a, b) => Object.entries(P).map(([placa, c]) => ({ placa, [a]: [...c[a]], [b]: [...c[b]] }));
  return {
    spec: 'kz-vistas/1', espessura: t,
    medidas_reais: [{ o_que: 'largura total', eixo: 'x', mm: 200, alvo: 'envolvente' }],
    vistas: { frente: vista('x', 'z'), lado: vista('y', 'z'), topo: vista('x', 'y') },
  };
}

function teste() {
  const casos = [
    ['caixa boa passa', (d) => d, null],
    ['largura diferente entre frente e topo', (d) => { d.vistas.topo[1].x = [0, 190]; return d; }, 'nao-bate'],
    ['placa some na vista de lado', (d) => { d.vistas.lado.pop(); return d; }, 'falta-vista'],
    ['placa com 5 mm onde a espessura e 3', (d) => { for (const k of ['frente', 'topo']) d.vistas[k][5].x = [98, 103]; return d; }, 'espessura-placa'],
    ['medida real do usuario nao respeitada', (d) => { d.medidas_reais[0].mm = 250; return d; }, 'medida-real'],
    ['sem medida real', (d) => { d.medidas_reais = []; return d; }, 'sem-medida-real'],
    ['sem espessura', (d) => { delete d.espessura; return d; }, 'espessura'],
    ['intervalo invertido', (d) => { d.vistas.frente[0].x = [200, 0]; return d; }, 'invertido'],
    ['placa maior que a mesa', (d) => { for (const k of ['frente', 'topo']) { d.vistas[k][0].x = [0, 500]; } d.medidas_reais = [{ o_que: 'profundidade', eixo: 'y', mm: 120, alvo: 'envolvente' }]; return d; }, 'maior-que-mesa'],
  ];
  let falhas = 0;
  for (const [nome, mexe, esperado] of casos) {
    const r = conferir(mexe(caixaBoa()));
    const codigos = r.erros.map((e) => e.codigo);
    const passou = esperado === null ? r.ok && r.placas.length === 6 : !r.ok && codigos.includes(esperado);
    if (!passou) falhas++;
    console.log(`${passou ? 'PASSOU' : 'FALHOU'}  ${nome}  -> ${esperado === null ? 'ok' : esperado}  [${codigos.join(', ')}]`);
  }
  console.log(falhas ? `\n${falhas} caso(s) FALHARAM` : `\n${casos.length} casos, todos passaram`);
  process.exit(falhas ? 1 : 0);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--teste')) return teste();
  const arq = args.find((a) => !a.startsWith('--') && a !== args[args.indexOf('--tol') + 1] && a !== args[args.indexOf('--mesa') + 1]);
  if (!arq) { console.error('uso: node conferir-vistas.mjs vistas.json [--placas] [--tol 0.05] [--mesa 400x400] | --teste'); process.exit(2); }
  const opt = {};
  if (args.includes('--tol')) opt.tol = Number(args[args.indexOf('--tol') + 1]);
  if (args.includes('--mesa')) opt.mesa = args[args.indexOf('--mesa') + 1].split('x').map(Number);
  const r = conferir(JSON.parse(readFileSync(arq, 'utf8')), opt);
  console.log(JSON.stringify(args.includes('--placas') && r.ok ? r.placas : r, null, 2));
  process.exit(r.ok ? 0 : 1);
}

const euMesmo = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (euMesmo) main();
