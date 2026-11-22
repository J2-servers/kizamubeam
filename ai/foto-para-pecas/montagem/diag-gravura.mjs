// diag-gravura.mjs — em que placa e de que lado (face de cima = top) cada gravacao aparece na Vista 3D
import { readFileSync } from 'node:fs';
const LIB = process.env.KZ_LIB ?? 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio, sleep } = await import(LIB);
const rel = JSON.parse(readFileSync(process.argv[2].replace(/\.kzb$/, '-relatorio.json'), 'utf8'));
const p = await studio('pt-BR');
await p.ev(`(()=>{ window.editor.load(JSON.stringify({ doc: JSON.parse(${JSON.stringify(readFileSync(process.argv[2], 'utf8'))}) })); window.editor.emit("doc"); return true; })()`);
await sleep(800);
console.log(JSON.stringify(await p.ev(`(async()=>{
  const { collectScene } = await import('/src/view3d/panel.ts');
  const ed = window.editor;
  const r = collectScene(ed, 3);
  const nome = new Map(${JSON.stringify(rel.pecas.map((x) => [x.id, x.placa]))});
  return { com_gravura: r.scene.solids.filter((s) => s.engraving).map((s) => (nome.get(Number(s.key.slice(1))) ?? s.key) + ' top=' + s.engraving.top), soltas: r.loose.map((o) => o.id + ':' + (o.shape.text ?? o.shape.kind)) };
})()`), null, 1));
await p.close();
