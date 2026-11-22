// Fenster „Chargenprüfung“: die Probe einer ganzen Serie, Stück für Stück. Jede Zeile zeigt die Nummer, das Stück
// so gezeichnet, wie es graviert würde, den eingesetzten Inhalt und die Befunde. Geprüft wird in batchproof.ts
// (ohne DOM); hier kommen die Schriftdateien und das Zeichnen dazu.
import { check, numField } from './arrayDialogs';
import { barcodeOutline } from './barcode';
import { encodeLinear } from './barcode1d';
import { batchProof, maxOffset, type FontKey, type GlyphInfo, type ProofPart, type ProofSheet } from './batchproof';
import { h, showDialog } from './dom';
import type { Editor } from './editor';
import { loadedFont, loadFont } from './fonts';
import { boundsOf, textOutline } from './geom';
import { t, tn } from './i18n';
import { IDENT, leaves, outputLeaves, type BarcodeShape, type Obj, type TextShape } from './model';
import { objLabel } from './objectsPanel';

/** Ohne CSV-Datei ist die Serie oft 9999 Nummern lang: So viele Stücke zeigt das Fenster beim Öffnen. */
const FIRST_VIEW = 100;

/**
 * Schrift-Auskunft aus den geladenen Schriftdateien. Fehlt die Schrift, wird die Ersatzschrift geprüft — denn die
 * würde graviert. Heißt die Ersatzschrift selbst so wie die gewünschte (Roboto), ist nichts ersetzt worden.
 */
function glyphInfo(f: FontKey): GlyphInfo | null {
  const lf = loadedFont(f.family, f.bold, f.italic);
  if (!lf) return null;
  const real = (lf.font.names?.fontFamily?.en ?? '').trim();
  const same = real.toLowerCase() === f.family.trim().toLowerCase();
  return { has: (ch) => !!lf.font.charToGlyphIndex(ch), fallback: lf.fallback && !same, family: real || f.family };
}

/** Alle Schriften der Objekte mit variablem Text laden, damit die Glyphen-Prüfung und die Vorschau stimmen */
async function loadProofFonts(objs: Obj[]): Promise<void> {
  const seen = new Set<string>();
  const jobs: Promise<unknown>[] = [];
  for (const o of objs) {
    const s = o.shape;
    if (s.kind !== 'text') continue;
    const key = `${s.font}|${s.bold}|${s.italic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    jobs.push(loadFont(s.font, s.bold, s.italic));
  }
  await Promise.all(jobs);
}

/**
 * Objekte mit variablem Text, die wirklich gelasert würden: Dieselbe Ausgabe-Semantik wie der Job (#217) —
 * noLaser und eine falsche Bedingung schließen auch alles darunter aus, und ein Layer ohne Ausgabe zählt nicht.
 * Sonst würde ein ausgeblendeter Text mit leerem Feld einen Job aufhalten, den er gar nicht erreicht.
 */
function laserObjs(ed: Editor): Obj[] {
  const out: Obj[] = [];
  for (const [o] of outputLeaves(ed.doc.objs)) {
    const s = o.shape;
    if ((s.kind === 'text' || s.kind === 'barcode') && s.vt && ed.layer(o.layer).output) out.push(o);
  }
  return out;
}

/**
 * Prüfung der Stücke, die der nächste Job graviert (für die Abfrage vor dem Start). only = nur diese Objekte
 * („Nur Auswahl“ lasern); null = alles auf der Seite. Die Nummern kommen aus DIESEN Objekten: Wer nur ein
 * Schild eines Jigs lasert, verbraucht auch nur dessen Nummer.
 */
export function jobProof(ed: Editor, only: Obj[] | null = null): ProofSheet {
  let objs = laserObjs(ed);
  if (only) objs = objs.filter((o) => only.some((s) => s === o || (s.shape.kind === 'group' && [...leaves([s])].some(([l]) => l === o))));
  const from = ed.varText.current;
  return { ...batchProof({ objs, vt: ed.varText, from, to: from + maxOffset(objs), glyphs: glyphInfo }) };
}

/** Ein Stück zeichnen, wie es graviert würde: eingesetzter Inhalt in der gewählten Schrift */
function drawPart(canvas: HTMLCanvasElement, part: ProofPart, src: Obj | undefined) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = canvas.clientWidth || 220;
  const hgt = canvas.clientHeight || 40;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(hgt * dpr);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const s = src?.shape;
  if (!s || (s.kind !== 'text' && s.kind !== 'barcode')) return;
  // Der eingesetzte Inhalt ist fester Text: geschweifte Klammern verdoppeln, sonst würde fillTemplate
  // sie noch einmal als Projekt-Parameter lesen. Variablen Text abschalten, sonst käme die aktuelle Nummer.
  const fixed = part.text.replace(/[{}]/g, (c) => c + c);
  let path: Path2D | null = null;
  let shape: TextShape | BarcodeShape;
  if (s.kind === 'text') {
    shape = { ...s, text: fixed };
    delete shape.vt;
    path = textOutline(shape)?.path ?? null;
  } else {
    shape = { ...s, data: fixed };
    delete shape.vt;
    // Lässt sich der Inhalt in dieser Strichcode-Art gar nicht kodieren, zeichnet barcodeOutline eine volle
    // Fläche. Ein schwarzer Block als Vorschau wäre eine Falschaussage: dann lieber nichts zeigen.
    path = s.type !== 'qr' && !encodeLinear(s.type, fixed, !!s.check).ok ? null : barcodeOutline(shape).path;
  }
  const box = path ? boundsOf([{ id: -1, m: IDENT, layer: 0, shape } as Obj]) : null;
  if (!path || !box || box.w <= 0 || box.h <= 0) return;
  const pad = 3 * dpr;
  const k = Math.min((canvas.width - 2 * pad) / box.w, (canvas.height - 2 * pad) / box.h);
  ctx.setTransform(k, 0, 0, k, (canvas.width - box.w * k) / 2 - box.x * k, (canvas.height - box.h * k) / 2 - box.y * k);
  ctx.fillStyle = getComputedStyle(canvas).color;
  ctx.fill(path, 'evenodd');
}

/** Fenster „Chargenprüfung“ öffnen (Werkzeugkasten, Menü Laser und Fenster „Variabler Text“) */
export function openBatchProof(ed: Editor) {
  const vt = ed.varText;
  let from = Math.max(1, vt.csv ? 1 : vt.start);
  let to = vt.csv ? Math.max(1, vt.csv.rows.length) : Math.min(vt.end, from + FIRST_VIEW - 1);
  let onlyBad = true;
  let sheet: ProofSheet | null = null;

  const summary = h('span', { class: 'chk-summary' });
  const list = h('div', { class: 'bp-list' });
  const note = h('div', { class: 'note' });

  // EIN Beobachter für das Fenster. Er hält seine Ziele fest, also wird er vor jedem Neuaufbau der Liste und
  // beim Schließen gelöst — sonst bliebe bei jedem Tastendruck in „Von“/„bis“ eine Liste von Leinwänden hängen.
  const draw = new WeakMap<Element, () => void>();
  const io = new IntersectionObserver((entries) => {
    for (const e of entries)
      if (e.isIntersecting) {
        draw.get(e.target)?.();
        io.unobserve(e.target);
      }
  });

  const render = () => {
    const objs = new Map(ed.varTextObjs(false).map((o) => [o.id, o]));
    const s = sheet;
    io.disconnect();
    list.replaceChildren();
    if (!s || s.nothing) {
      summary.textContent = '';
      list.append(h('div', { class: 'empty' }, t('Auf dieser Seite gibt es noch keinen variablen Text. Text auswählen und in der Textleiste „Variabel“ einschalten.')));
      return;
    }
    const ok = s.rows.length - s.bad - s.warned;
    summary.textContent = [
      tn('{n} Stück geprüft|one', '{n} Stück geprüft', s.rows.length, { n: s.rows.length }),
      s.bad ? tn('{n} mit Fehler', '{n} mit Fehlern', s.bad, { n: s.bad }) : '',
      s.warned ? tn('{n} mit Warnung', '{n} mit Warnungen', s.warned, { n: s.warned }) : '',
      ok ? t('{n} in Ordnung', { n: ok }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const rows = onlyBad ? s.rows.filter((r) => r.issues.length) : s.rows;
    if (!rows.length) {
      list.append(h('div', { class: 'empty' }, t('Kein Stück dieser Serie hat ein Problem.')));
      return;
    }
    // Vorschau erst zeichnen, wenn die Zeile zu sehen ist: Eine Serie kann tausende Stücke haben.
    for (const r of rows) {
      const level = r.issues.some((x) => x.level === 'error') ? 'error' : r.issues.length ? 'warn' : 'ok';
      const art = h('div', { class: 'bp-art' });
      for (const p of r.parts) {
        const canvas = h('canvas', { class: 'bp-canvas', title: p.text }) as HTMLCanvasElement;
        draw.set(canvas, () => drawPart(canvas, p, objs.get(p.ids[0])));
        art.append(canvas);
      }
      const row = h(
        'div',
        { class: `bp-row lvl-${level}${r.n === ed.varText.current ? ' cur' : ''}` },
        h('span', { class: 'chk-dot' }),
        h('b', { class: 'bp-n' }, String(r.n)),
        art,
        h(
          'div',
          { class: 'bp-text' },
          ...r.parts.map((p) =>
            h(
              'div',
              { class: 'bp-value' },
              p.text.split('\n').join(' ⏎ ') || '—',
              r.parts.length > 1 ? h('span', { class: 'bp-who' }, ' · ' + p.ids.map((id) => (objs.get(id) ? objLabel(objs.get(id)!) : '?')).join(', ')) : null,
            ),
          ),
          ...r.issues.map((x) => h('div', { class: `bp-msg lvl-${x.level}` }, x.msg)),
        ),
        h(
          'button',
          {
            class: 'small',
            title: t('Diese Nummer auf der Arbeitsfläche zeigen'),
            onclick: () => {
              ed.setVarText({ current: r.n });
              list.querySelectorAll('.bp-row.cur').forEach((e) => e.classList.remove('cur'));
              row.classList.add('cur');
            },
          },
          t('Zeigen'),
        ),
      );
      list.append(row);
      for (const c of art.children) io.observe(c);
    }
  };

  const run = () => {
    const objs = ed.varTextObjs(false);
    sheet = batchProof({ objs, vt: ed.varText, from, to, glyphs: glyphInfo });
    note.textContent = sheet.truncated
      ? t('Geprüft wurden die Stücke {from} bis {to}; die Serie ist länger. Für den Rest den Bereich weiterschieben.', { from: sheet.from, to: sheet.to })
      : t('Geprüft werden leere Felder, fehlende CSV-Zeilen und Spalten, Anweisungen des Kunden im Inhalt, Emoji und unsichtbare Zeichen, Zeichen, die in der Schrift fehlen, und zweimal derselbe Inhalt.');
    render();
  };

  // Die Zahlenfelder melden jeden Tastendruck; eine lange Serie soll nicht bei jeder Ziffer neu geprüft werden
  let timer = 0;
  const later = () => {
    clearTimeout(timer);
    timer = window.setTimeout(run, 250);
  };

  const numbers = h(
    'div',
    { class: 'vt-inline' },
    h('span', {}, t('Von')),
    numField('bp-from', from, (v) => ((from = Math.max(1, Math.round(v))), later())),
    h('span', {}, t('bis')),
    numField('bp-to', to, (v) => ((to = Math.max(1, Math.round(v))), later())),
    h('button', { class: 'btn', onclick: () => run() }, t('Prüfen')),
    check(onlyBad, (v) => ((onlyBad = v), render()), t('Nur Stücke mit Problemen')),
  );

  const dlg = h(
    'dialog',
    { class: 'bp-dialog' },
    h('h3', {}, t('Chargenprüfung')),
    numbers,
    h('div', { class: 'bp-bar' }, summary),
    list,
    note,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Schließen'))),
  ) as HTMLDialogElement;
  showDialog(dlg, () => (clearTimeout(timer), io.disconnect()));
  // Schriften laden, sonst hätten die ersten Zeilen keine Vorschau und keine Glyphen-Prüfung
  void loadProofFonts(ed.varTextObjs(false)).then(run);
  run();
}
