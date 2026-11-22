#!/usr/bin/env node
// ver3d.mjs — abre um projeto (.kzb) no app e fotografa a Vista 3D de perto, nos tres angulos, so do conjunto montado.
//   node ver3d.mjs saida/cofrinho-ensaio.kzb [--mockup]
import { readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
const LIB = process.env.KZ_LIB ?? 'file:///C:/Users/jujug/AppData/Local/Temp/claude/2ec6f9f02287c589/0b6d0ff8-b907-4e5b-98ec-704cef1e9aa0/scratchpad/shots/app.mjs';
const arq = process.argv[2];
const mockup = process.argv.includes('--mockup');
const { studio, sleep } = await import(LIB);
const p = await studio('pt-BR', { width: 1600, height: 1000 });
await p.ev(`(()=>{ window.editor.load(JSON.stringify({ doc: JSON.parse(${JSON.stringify(readFileSync(arq, "utf8"))}) })); window.editor.emit("doc"); return true; })()`);
await sleep(800);
// so o que esta montado (objetos com encaixe e a cena), para a vista dar zoom nele
await p.ev(`(()=>{ const ed = window.editor; ed.setSel(ed.doc.objs.filter((o) => (o.mates?.length) || (ed.doc.multiLayerAssemblies ?? []).some((a) => a.plates.some((q) => q.object === o.id)))); ed.emit('sel'); return true; })()`);
await p.show('view3d');
await sleep(800);
// janela da Vista 3D grande, flutuando
// (mudar o estilo direto nao pega: o dock redesenha a janela pelo layout dele) — arrasta-se a barra e o canto, como a mao faria
const canto = await p.rect('.dock-group.floating .float-resize');
if (canto) { await p.drag(canto.cx, canto.cy, p.width - 30, p.height - 30); await sleep(500); }
await sleep(2500);
if (mockup) {
  await p.ev(`(async()=>{ const { windowBody } = await window.__kzImport('/src/dock.ts'); const cb = [...windowBody('view3d').querySelectorAll('label')].find((l) => /Mockup/i.test(l.textContent))?.querySelector('input'); if (cb && !cb.checked) cb.click(); return !!cb; })()`);
  await sleep(1500);
}
const base = join(dirname(arq), basename(arq).replace(/\.kzb$/i, ''));
const linha = await p.ev(`(()=>{const e=[...document.querySelectorAll('*')].filter(n=>n.children.length===0&&/Pe[cç]as: \\d+/.test(n.textContent||''));return e.length?e[e.length-1].textContent.trim():null;})()`);
for (const [nome, i] of Object.entries({ iso: 0, topo: 1, frente: 2 })) {
  await p.ev(`(async()=>{const { windowBody } = await window.__kzImport('/src/dock.ts'); windowBody('view3d').querySelectorAll('button')[${i}].click(); return true;})()`);
  await sleep(1200);
  await p.shot(`${base}-perto-${nome}.png`);
}
console.log(JSON.stringify({ linha, fotos: ['iso', 'topo', 'frente'].map((n) => `${base}-perto-${n}.png`) }));
await p.close();
