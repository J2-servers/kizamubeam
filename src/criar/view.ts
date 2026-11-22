// Fenster „Produkt erstellen“: die 3D-Ansicht der App (src/view3d/) über dem eigenen Editor dieses Fensters.
// Gleiche Szene wie das Fenster „3D-Ansicht“ (collectScene ohne Auswahl = alle Schnitte der Seite), mit den
// Ansichten 3D/Oben/Vorne, der Explosion und der Zeile „Teile: N · Überschneidungen“.
import type { Editor } from '../editor';
import { h } from '../dom';
import { locale, t } from '../i18n';
import { collectScene } from '../view3d/panel';
import type { Viewer3D, ViewAxes, ViewPreset, ViewSolid } from '../view3d/viewer';
import type { Overlap } from '../view3d/solids';
import { onPluginResult } from '../plugins/generator';
import { onImageReady } from '../images';

const fmt = (v: number) => (Math.round(v * 10) / 10).toLocaleString(locale, { maximumFractionDigits: 1 });

/** Wie overlapText im Fenster „3D-Ansicht“ (dieselben Texte) */
function overlapText(list: Overlap[], solids: ViewSolid[]): string {
  if (!list.length) return t('Keine Überschneidungen');
  const name = (k: string) => {
    const s = solids.find((x) => x.key === k);
    return s ? (s.label.includes(': ') ? s.label.slice(s.label.lastIndexOf(': ') + 2) : s.label) : k;
  };
  const vol = list.reduce((s, o) => s + o.volume, 0);
  const worst = [...list].sort((a, b) => b.volume - a.volume).slice(0, 3);
  return (
    t('Überschneidungen: {n}, zusammen {v} mm³', { n: list.length, v: fmt(vol) }) +
    ': ' +
    worst.map((o) => `${name(o.a)} / ${name(o.b)}`).join(', ') +
    (list.length > 3 ? ' …' : '')
  );
}

export interface CreatorView {
  el: HTMLElement;
  /** Szene neu aufbauen (nach einem Ereignis „model“ des Motors) */
  update(): void;
  /** Dicke für Teile ohne eigene Materialdicke */
  setThickness(th: number): void;
  /** Anzahl der Teile in der letzten Szene */
  parts(): number;
  /** Bild der Ansicht (PNG-Daten-URL) */
  snapshot(): string | null;
  /** Lage des Produkts in der Szene (Ereignis „model“ des Motors): „Vorne“ zeigt dann die Vorderseite des Produkts */
  setAxes(a: ViewAxes): void;
}

export function buildCreatorView(ed: Editor, thickness: number): CreatorView {
  /** Where the product's right/back/up are in the scene (from the engine); undefined = the plain presets */
  let axes: ViewAxes | undefined;
  let th = thickness;
  let viewer: Viewer3D | null = null;
  let lastKey = '';
  let count = 0;
  let queued = 0;
  let info = '';
  const host = h('div', { class: 'v3d-canvas' });
  const empty = h(
    'div',
    { class: 'v3d-empty cr-view-empty' },
    h('div', { class: 'cr-view-empty-icon', icon: 'view3d' }),
    h('div', { class: 'cr-view-empty-title' }, t('Hier entsteht dein Produkt in 3D')),
    h('div', { class: 'cr-view-empty-text' }, t('Füge links Fotos hinzu, beschreibe, was gebaut werden soll, und gib mindestens ein Maß an. Jede Änderung der KI erscheint sofort hier.')),
  );
  const statusText = h('span', { class: 'cr-view-info' });
  const status = h('div', { class: 'v3d-status cr-view-status' }, statusText);
  const explode = h('input', { type: 'range', min: '0', max: '1.5', step: '0.01', value: '0', title: t('Teile auseinanderziehen') }) as HTMLInputElement;
  const presetBtn = (p: ViewPreset, label: string, title: string) => h('button', { class: 'cr-seg-btn', title, onclick: () => viewer?.view(p, axes) }, label);
  const bar = h(
    'div',
    { class: 'v3d-bar cr-view-bar' },
    h('span', { class: 'cr-view-title' }, h('span', { class: 'cr-view-title-icon', icon: 'view3d' }), t('3D-Ansicht')),
    h('div', { class: 'cr-seg' }, presetBtn('iso', t('3D'), t('Schräg von vorne')), presetBtn('top', t('Oben|3D'), t('Von oben')), presetBtn('front', t('Vorne|3D'), t('Von vorne'))),
    h('label', { class: 'v3d-range', title: t('Teile auseinanderziehen') }, t('Explosion'), explode),
  );
  const el = h('section', { class: 'cr-view' }, bar, h('div', { class: 'v3d-stage cr-view-stage' }, host, empty), status);

  const update = () => {
    window.clearTimeout(queued);
    queued = 0;
    if (!viewer) return;
    const { scene, key } = collectScene(ed, th, true, undefined, true);
    count = scene.solids.length;
    empty.hidden = count > 0;
    viewer.setScene(scene, key !== lastKey);
    lastKey = key;
    info = count ? `${t('Teile: {n}', { n: count })} · ${overlapText(scene.overlaps, scene.solids)}` : '';
    statusText.textContent = info || t('Noch keine Teile');
    status.classList.toggle('v3d-bad', scene.overlaps.length > 0);
  };
  const schedule = () => {
    if (!queued) queued = window.setTimeout(update, 120);
  };
  void import('../view3d/viewer')
    .then(({ Viewer3D }) => {
      try {
        viewer = new Viewer3D(host);
      } catch (e) {
        empty.hidden = false;
        empty.replaceChildren(t('3D-Darstellung nicht möglich: {msg}', { msg: e instanceof Error ? e.message : String(e) }));
        return;
      }
      viewer.onHover = (label) => (statusText.textContent = label ?? (info || t('Noch keine Teile')));
      viewer.setExplode(0);
      viewer.setShowOverlaps(true);
      update();
      viewer.setActive(true);
    })
    .catch((e) => {
      empty.hidden = false;
      empty.replaceChildren(t('3D-Darstellung nicht möglich: {msg}', { msg: String(e) }));
    });
  explode.addEventListener('input', () => viewer?.setExplode(Number(explode.value)));
  ed.on((what) => what === 'doc' && schedule());
  onPluginResult(schedule);
  onImageReady(schedule);
  statusText.textContent = t('Noch keine Teile');
  return {
    el,
    update: schedule,
    setThickness(v) {
      if (v > 0 && v !== th) {
        th = v;
        schedule();
      }
    },
    parts: () => count,
    snapshot: () => (viewer && count ? viewer.snapshot(1) : null),
    setAxes(a) {
      const neu = JSON.stringify(a) !== JSON.stringify(axes);
      axes = a;
      if (neu && viewer && count) viewer.view('iso', axes);
    },
  };
}
