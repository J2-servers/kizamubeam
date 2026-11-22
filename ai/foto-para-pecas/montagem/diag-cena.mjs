// diag-cena.mjs — o que a cena (conjuntos de camadas) tem no projeto e o que entrou na Vista 3D
import { readFileSync } from 'node:fs';
const LIB = process.env.KZ_LIB ?? 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const { studio, sleep } = await import(LIB);
const p = await studio('pt-BR');
await p.ev(`(()=>{ window.editor.load(JSON.stringify({ doc: JSON.parse(${JSON.stringify(readFileSync(process.argv[2], 'utf8'))}) })); window.editor.emit("doc"); return true; })()`);
await sleep(500);
console.log(JSON.stringify(await p.ev(`(async()=>{
  const { collectScene } = await import('/src/view3d/panel.ts');
  const ed = window.editor;
  const { scene } = collectScene(ed, 3);
  const nome = (id) => { const o = ed.doc.objs.find((x) => x.id === id); return o ? (o.name ?? o.label ?? o.type ?? '?') : 'SUMIU'; };
  return {
    conjuntos: (ed.doc.multiLayerAssemblies ?? []).map((a) => ({ id: a.id, mount: a.mount, placas: a.plates.map((q) => ({ nome: q.name, obj: q.object, existe: nome(q.object), z: q.z, esp: q.thickness })) })),
    solidos3d: scene.solids.map((s) => s.key + (s.label ? ':' + s.label : '')),
  };
})()`), null, 1));
await p.close();
