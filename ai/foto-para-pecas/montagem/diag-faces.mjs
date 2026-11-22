// diag-faces.mjs — para cada placa montada: a face gravada (a de cima na mesa, +n) olha para dentro ou para fora da caixa?
import { readFileSync } from 'node:fs';
const LIB = process.env.KZ_LIB ?? 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio, sleep } = await import(LIB);
const rel = JSON.parse(readFileSync(process.argv[2].replace(/\.kzb$/, '-relatorio.json'), 'utf8'));
const p = await studio('pt-BR');
await p.ev(`(()=>{ window.editor.load(JSON.stringify({ doc: JSON.parse(${JSON.stringify(readFileSync(process.argv[2], 'utf8'))}) })); window.editor.emit("doc"); return true; })()`);
await sleep(500);
console.log(JSON.stringify(await p.ev(`(async()=>{
  const { collectScene } = await import('/src/view3d/panel.ts');
  const { solidBounds } = await import('/src/view3d/solids.ts');
  const { scene } = collectScene(window.editor, 3);
  const caixa = scene.solids.filter((s) => s.key[0] === 'm');
  const b = caixa.map((s) => solidBounds(s));
  const c = [0, 1, 2].map((i) => (Math.min(...b.map((x) => x.min[i])) + Math.max(...b.map((x) => x.max[i]))) / 2);
  const nome = new Map(${JSON.stringify(rel.pecas.map((x) => [x.id, x.placa]))});
  return caixa.map((s, k) => {
    const m = [0, 1, 2].map((i) => (b[k].min[i] + b[k].max[i]) / 2);
    const fora = [0, 1, 2].reduce((d, i) => d + (m[i] - c[i]) * s.pose.n[i], 0);
    return nome.get(Number(s.key.slice(1))) + ': n=' + s.pose.n.map((v) => Math.round(v)).join(',') + ' face gravada para ' + (fora > 0 ? 'FORA' : 'DENTRO');
  });
})()`), null, 1));
await p.close();
