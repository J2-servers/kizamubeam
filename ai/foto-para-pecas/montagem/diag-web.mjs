// diagnostico: tamanho das pecas vindas da internet
import { candidatosWeb } from './silhuetas.mjs';
const LIB = 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio } = await import(LIB);
const p = await studio('pt-BR');
for (const busca of ['Brazil blank map', 'Brazil states blank map', 'suitcase icon', 'Christ the Redeemer silhouette']) {
  const c = (await candidatosWeb(busca, 1))[0];
  const svg = await (await fetch(c.url, { headers: { 'User-Agent': 'KizamuBeam-foto-para-pecas/0.2' } })).text();
  await p.fresh();
  const t0 = Date.now();
  const r = await p.tool('import_svg', { svg });
  const info = await p.ev(`(async()=>{ const { shapeSubs } = await import('/src/geom.ts'); const { leaves } = await import('/src/model.ts'); let objs=0, subs=0, nodes=0; for (const [o] of leaves(window.editor.doc.objs)) { objs++; try { const ss = shapeSubs(o.shape); subs += ss.length; nodes += ss.reduce((a,s)=>a+s.nodes.length,0);} catch {} } return {objs, subs, nodes}; })()`);
  console.log(busca, '|', c.titulo, '|', (svg.length/1024).toFixed(0), 'KB |', Date.now() - t0, 'ms |', JSON.stringify(info), '| criados', (r?.created ?? []).length);
}
await p.close();
