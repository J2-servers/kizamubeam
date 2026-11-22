import { readFileSync } from 'node:fs';
const LIB = 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio, sleep } = await import(LIB);
const rel = JSON.parse(readFileSync('saida/cofrinho-ensaio-relatorio.json', 'utf8'));
const ids = Object.fromEntries(rel.pecas.map((x) => [x.placa, x.id]));
const p = await studio('pt-BR');
await p.ev(`(()=>{ window.editor.load(JSON.stringify({ doc: JSON.parse(${JSON.stringify(readFileSync('saida/cofrinho-ensaio.kzb', "utf8"))}) })); window.editor.emit("doc"); return true; })()`);
await sleep(500);
const out = await p.ev(`(async()=>{
  const { collectScene } = await import('/src/view3d/panel.ts');
  const { scene } = collectScene(window.editor, 3);
  const ids = ${JSON.stringify(ids)};
  const w = (s, q) => [0,1,2].map((i) => s.pose.o[i] + q.x * s.pose.u[i] + q.y * s.pose.v[i]);
  const res = {};
  for (const nome of ['base', 'frente', 'divisoria1', 'prateleira']) {
    const s = scene.solids.find((x) => x.key === 'm' + ids[nome]);
    if (!s) { res[nome] = 'sem solido'; continue; }
    const holes = s.polys.slice(1).map((pl) => { const pts = pl.map((q) => w(s, q)); return [0,1,2].map((i) => +(pts.reduce((a, b) => a + b[i], 0) / pts.length).toFixed(1)); });
    const o = window.editor.doc.objs.find((x) => x.id === ids[nome]);
    res[nome] = { holes, mates: (o.mates ?? []).map((m) => ({ to: m.to, kind: m.kind, a: m.a.map((q) => [+q.x.toFixed(1), +q.y.toFixed(1)]), b: m.b.map((q) => [+q.x.toFixed(1), +q.y.toFixed(1)]) })) };
  }
  return res;
})()`);
console.log(JSON.stringify(out, null, 0).replace(/\],\"/g, '],\n"'));
console.log('ids', JSON.stringify(ids));
await p.close();
