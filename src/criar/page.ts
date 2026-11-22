// Fenster „Produkt erstellen“ (criar.html): eigene Seite mit eigenem JavaScript, getrennt vom Hauptfenster, damit
// die KI-Arbeit einen laufenden Auftrag nie stört. Links der Verlauf im Stil eines Agenten-Harness mit der Eingabe,
// rechts die 3D-Ansicht. Der Motor (engine.ts) baut die Teile in einem EIGENEN Editor dieses Fensters; „An das
// Programm senden“ öffnet sie in einem neuen Tab des Hauptfensters (bridge.ts).
//
// Isolation: der Editor dieses Fensters liest und schreibt weder die automatische Sicherung noch die Tabs des
// Hauptfensters (gleicher Speicher, kizamubeam.autosave / kizamubeam.tabs). Deshalb werden restore/save hier im
// Prototyp ersetzt, BEVOR der Editor entsteht. Tastenkürzel und Einfügen des Editors sind aus: hier tippt man in
// die Eingabe. Kein Modul der Maschinensteuerung (laser, machine, camera, sync, remote) wird geladen.
import '../style.css';
import './criar.css';
import { Editor } from '../editor';
import { makeTab } from '../editor/tabs';
import { allObjs, newDoc } from '../model';
import { h } from '../dom';
import { lang, t, tn } from '../i18n';
import { initTypographyDom } from '../uiTypographyDom';
import { setContextSource, setPluginSpawn, setResourceSource } from '../plugins/generator';
import { workerProcess } from '../plugins/client';
import { useCoreGenerators } from '../plugins/core';
import { CORE_PACK_TEXT } from '../plugins/corePack';
import { editorContext } from '../plugins/context';
import type { PluginManifest } from '../plugins/manifest';
import { meshData } from '../model3d/store';
import { imageResource } from '../plugins/imageResource';
import symbolLight from '../assets/brand/symbol-64.png';
import symbolDark from '../assets/brand/symbol-64-dark.png';
import { callLlm, PROVIDERS } from './llm';
import { LlmError, type CreateRequest, type EngineEvent, type ProviderInfo } from './contract';
import { ChatLog } from './chat';
import { buildComposer } from './compose';
import { buildCreatorView } from './view';
import { llmConfig, loadKeys, loadSettings, modelsOf, openSettingsDialog, saveSettings } from './settings';
import { SEND_EVENT, sendToMain } from './bridge';

// ---------- Isolation des Editors (vor new Editor) ----------
{
  const P = Editor.prototype as unknown as Record<string, unknown>;
  P.restore = function (this: Editor) {
    this.doc = newDoc();
    this.tabs = [makeTab(this.doc)];
    this.tabIndex = 0;
  };
  P.restoreTabs = () => false;
  P.scheduleSave = () => {};
  P.saveNow = () => {};
  P.saveTabs = () => {};
  P.onKey = () => {};
  P.onPaste = () => {};
}

const providers: ProviderInfo[] = PROVIDERS;
document.documentElement.lang = lang;
document.title = `KizamuBeam — ${t('Produkt erstellen')}`;
initTypographyDom();

// Teile aus Generatoren (Boxen, Zahnräder …) rechnen wie im Hauptfenster in ihrem Worker
const spawn = (m: PluginManifest) => workerProcess(m.runtime, m.code, m.host ?? []);
setPluginSpawn(spawn);
useCoreGenerators(CORE_PACK_TEXT);

const canvas = document.getElementById('criar-canvas') as HTMLCanvasElement;
const ed = new Editor(canvas);
setContextSource((what) => editorContext(ed, what));
setResourceSource((kind, id) => (kind === 'model3d' ? meshData(id) : kind === 'image' ? imageResource(id) : null));
(window as unknown as { editor: Editor }).editor = ed;

const settings = loadSettings(providers);
ed.doc.bed = { w: settings.bed[0], h: settings.bed[1] };

// ---------- Design wie im Hauptfenster (gleiche Einstellung kizamubeam.theme, live nachgeführt) ----------
const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const brand = h('img', { class: 'cr-brand', alt: 'KizamuBeam' }) as HTMLImageElement;
function applyTheme() {
  let mode: string | null = null;
  try {
    mode = localStorage.getItem('kizamubeam.theme');
  } catch {
    mode = null;
  }
  const root = document.documentElement;
  if (mode === 'light' || mode === 'dark') root.dataset.theme = mode;
  else delete root.dataset.theme;
  const dark = mode === 'dark' || (mode !== 'light' && darkQuery.matches);
  ed.setDark(dark);
  brand.src = dark ? symbolDark : symbolLight;
}
applyTheme();
darkQuery.addEventListener('change', applyTheme);
window.addEventListener('storage', (e) => {
  if (e.key === 'kizamubeam.theme') applyTheme();
});

// ---------- Aufbau ----------
const chat = new ChatLog();
const view = buildCreatorView(ed, settings.thickness);
let running: AbortController | null = null;
let lastName = '';
/** Kosten früherer Läufe dieser Sitzung und des laufenden */
let spentBefore = 0,
  callsBefore = 0,
  spentRun = 0,
  callsRun = 0;

const money = (usd: number) => '$' + usd.toLocaleString('en-US', { minimumFractionDigits: usd < 1 ? 4 : 2, maximumFractionDigits: usd < 1 ? 4 : 2 });
const costPill = h('span', { class: 'cr-pill cr-cost', title: t('Kosten dieser Sitzung (Listenpreise der Anbieter)') });
const costText = () => {
  const calls = callsBefore + callsRun;
  return `${money(spentBefore + spentRun)} · ${tn('{n} Aufruf', '{n} Aufrufe', calls)}`;
};
const showCost = () => (costPill.textContent = costText());

const modelPill = h('button', { class: 'cr-pill cr-model', title: t('KI-Einstellungen') });
const showModel = () => {
  const p = providers.find((x) => x.id === settings.provider) ?? providers[0];
  const m = modelsOf(settings, p);
  const label = p.models.find((x) => x.id === m.model)?.label ?? m.model;
  const hasKey = !!loadKeys()[p.id];
  modelPill.replaceChildren(h('span', { class: 'cr-dot' + (hasKey ? ' ok' : ' bad') }), h('span', {}, `${p.label} · ${label}`));
  modelPill.title = hasKey ? t('KI-Einstellungen') : t('Kein Schlüssel für {name}: hier eintragen', { name: p.label });
};
const openSettings = () =>
  openSettingsDialog(providers, settings, () => {
    showModel();
  });
modelPill.addEventListener('click', openSettings);
const gear = h('button', { class: 'ib', title: t('KI-Einstellungen'), icon: 'settings', onclick: openSettings });

const sendBtn = h('button', { class: 'btn primary cr-send-program', title: t('Die Teile in einem neuen Tab des Hauptfensters öffnen. Das offene Projekt bleibt unberührt.') }, h('span', { class: 'cr-btn-icon', icon: 'export' }), h('span', {}, t('An das Programm senden'))) as HTMLButtonElement;
const refreshSend = () => {
  const n = allObjs(ed.doc).length;
  sendBtn.disabled = !!running || n === 0;
  sendBtn.title = n === 0 ? t('Noch keine Teile zum Senden') : running ? t('Erst nach dem Ende des Laufs') : t('Die Teile in einem neuen Tab des Hauptfensters öffnen. Das offene Projekt bleibt unberührt.');
};
ed.on((what) => what === 'doc' && refreshSend());

const header = h(
  'header',
  { class: 'cr-head' },
  brand,
  h('div', { class: 'cr-head-title' }, h('h1', {}, t('Produkt erstellen')), h('span', { class: 'cr-head-sub' }, t('KI-Assistent · eigenes Fenster, die Maschinensteuerung läuft ungestört weiter'))),
  h('span', { class: 'cr-st-gap' }),
  modelPill,
  costPill,
  gear,
  h('span', { class: 'sep' }),
  sendBtn,
);

const composer = buildComposer({
  thickness: settings.thickness,
  bed: settings.bed,
  onSend: () => void start(),
  onStop: () => running?.abort(),
  onSettingsChange: (th, bed) => {
    settings.thickness = th;
    settings.bed = bed;
    saveSettings(settings);
    view.setThickness(th);
    if (!running) {
      ed.doc.bed = { w: bed[0], h: bed[1] };
      ed.emit('doc');
    }
  },
});

const left = h('section', { class: 'cr-left' }, chat.el, composer.el);
const splitter = h('div', { class: 'cr-split', title: t('Breite ändern'), role: 'separator' });
const main = h('main', { class: 'cr-main' }, left, splitter, view.el);
document.getElementById('criar')!.append(header, main);
showModel();
showCost();
refreshSend();
composer.focus();

// Breite des Verlaufs ziehen (Doppelklick: Standard)
splitter.addEventListener('pointerdown', (e) => {
  splitter.setPointerCapture(e.pointerId);
  const move = (ev: PointerEvent) => {
    const w = Math.max(360, Math.min(window.innerWidth - 420, ev.clientX));
    main.style.setProperty('--cr-left', `${w}px`);
  };
  const up = () => {
    splitter.removeEventListener('pointermove', move);
    splitter.removeEventListener('pointerup', up);
  };
  splitter.addEventListener('pointermove', move);
  splitter.addEventListener('pointerup', up);
});
splitter.addEventListener('dblclick', () => main.style.removeProperty('--cr-left'));

// Bilder einfügen (Ctrl+V) und an beliebiger Stelle des Fensters fallen lassen
window.addEventListener(
  'paste',
  (e) => {
    const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length || running) return;
    e.preventDefault();
    void composer.addFiles(files);
  },
  true,
);
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  if (!running && e.dataTransfer?.files.length && !composer.el.contains(e.target as Node)) void composer.addFiles([...e.dataTransfer.files]);
});

// ---------- Ein Lauf des Motors ----------
const safeName = (s: string) =>
  s
    .split('\n')[0]
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 48);

/** Ereignisse des Motors in Verlauf, 3D und Kosten */
let gotResult = false;
function handle(e: EngineEvent) {
  switch (e.kind) {
    case 'stage':
      chat.stage(e);
      break;
    case 'assistant':
      chat.assistant(e.text);
      break;
    case 'step':
      chat.step(e);
      break;
    case 'part':
      chat.part(e);
      break;
    case 'model':
      view.update();
      if (e.axes) window.setTimeout(() => view.setAxes(e.axes!), 200);
      refreshSend();
      break;
    case 'cost':
      spentRun = e.usd;
      callsRun = e.calls;
      showCost();
      break;
    case 'result':
      gotResult = true;
      chat.result(e, costText());
      break;
  }
}
// Nur im Entwicklungsmodus: Verlauf und Ereignisse für Tests und Bildschirmfotos erreichbar
if (import.meta.env.DEV) (window as unknown as Record<string, unknown>).__criar = { chat, handle, view };

async function start() {
  if (running) return;
  composer.setError('');
  const v = composer.value();
  const cfg = llmConfig(settings, providers);
  if (!cfg) {
    const p = providers.find((x) => x.id === settings.provider);
    composer.setError(t('Für {name} ist kein API-Schlüssel eingetragen (Zahnrad oben rechts).', { name: p?.label ?? settings.provider }));
    openSettings();
    return;
  }
  if (!v.images.length && !v.text) return composer.setError(t('Füge ein Foto hinzu oder beschreibe, was gebaut werden soll.'));
  if (!v.measures.length) return composer.setError(t('Gib mindestens ein Maß des Produkts an (Breite, Höhe oder Tiefe).'));
  if (!(v.thickness > 0)) return composer.setError(t('Die Materialdicke ist ungültig.'));
  if (!(v.bed[0] > 0 && v.bed[1] > 0)) return composer.setError(t('Die Arbeitsfläche ist ungültig.'));
  const prov = providers.find((x) => x.id === cfg.provider);
  const model = prov?.models.find((m) => m.id === cfg.model);
  if (v.images.length && model && !model.vision) return composer.setError(t('Das Modell {model} kann keine Bilder lesen. Wähle in den Einstellungen ein anderes.', { model: model.label }));

  let engine: typeof import('./engine');
  try {
    engine = await import('./engine');
  } catch (e) {
    chat.error(t('Der Motor konnte nicht geladen werden'), e instanceof Error ? e.message : String(e));
    return;
  }

  const mm = (x: number) => x.toLocaleString(lang, { maximumFractionDigits: 1 });
  const axisName = { x: t('Breite'), z: t('Höhe'), y: t('Tiefe') };
  chat.user({
    text: v.text,
    images: v.images.map((i) => i.url),
    chips: [
      ...v.measures.map((m) => `${axisName[m.axis]} ${mm(m.mm)} mm`),
      `${t('Dicke')} ${mm(v.thickness)} mm`,
      `${t('Arbeitsfläche')} ${mm(v.bed[0])} × ${mm(v.bed[1])} mm`,
      `${prov?.label ?? cfg.provider} · ${model?.label ?? cfg.model}`,
    ],
  });
  lastName = safeName(v.text) || t('Neues Produkt');
  composer.clear();

  // Jede Anfrage baut ein neues Produkt in einem leeren Dokument dieses Fensters
  ed.newDocument();
  ed.doc.bed = { w: v.bed[0], h: v.bed[1] };
  ed.emit('doc');
  view.setThickness(v.thickness);

  const req: CreateRequest = { images: v.images.map((i) => i.llm), text: v.text, measures: v.measures, thickness: v.thickness, bed: v.bed };
  const ac = new AbortController();
  running = ac;
  composer.setRunning(true);
  refreshSend();
  spentBefore += spentRun;
  callsBefore += callsRun;
  spentRun = 0;
  callsRun = 0;
  gotResult = false;
  try {
    await engine.runEngine(ed, cfg, callLlm, req, { onEvent: handle, confirm: (s, q, a) => chat.confirm(s, q, a) }, ac.signal);
    if (ac.signal.aborted) chat.note(t('Angehalten.'), 'warn');
    else if (!gotResult) chat.closeStages('done');
  } catch (e) {
    if (ac.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) chat.note(t('Angehalten.'), 'warn');
    else if (e instanceof LlmError) {
      const cause: Record<LlmError['cause2'], string> = {
        credits: t('Guthaben'),
        auth: t('Schlüssel abgelehnt'),
        rate: t('Zu viele Anfragen'),
        truncated: t('Antwort abgeschnitten'),
        network: t('Netzwerk'),
        other: t('Sonstiges'),
      };
      const p = providers.find((x) => x.id === e.provider);
      chat.error(t('{name} hat die Anfrage abgelehnt', { name: p?.label ?? e.provider }), e.providerMessage || e.message, `HTTP ${e.status || '—'} · ${cause[e.cause2] ?? e.cause2}`);
    } else chat.error(t('Fehler im Ablauf'), e instanceof Error ? e.message : String(e));
  } finally {
    running = null;
    composer.setRunning(false);
    view.update();
    refreshSend();
    showCost();
    composer.focus();
  }
}

// ---------- An das Programm senden ----------
sendBtn.addEventListener('click', async () => {
  if (sendBtn.disabled) return;
  sendBtn.disabled = true;
  try {
    const ack = await sendToMain({ type: SEND_EVENT, name: lastName || t('Neues Produkt'), project: ed.serialize() });
    if (ack.ok) chat.note(t('Im Hauptfenster als neuer Tab „{name}“ geöffnet. Dein offenes Projekt ist unverändert.', { name: ack.text }), 'ok');
    else if (ack.text) chat.error(t('Das Hauptfenster konnte die Teile nicht öffnen'), ack.text);
    else chat.error(t('Das Hauptfenster hat nicht geantwortet'), t('Ist das Hauptfenster von KizamuBeam noch geöffnet? Die Teile sind hier weiterhin vorhanden.'));
  } catch (e) {
    chat.error(t('Senden fehlgeschlagen'), e instanceof Error ? e.message : String(e));
  } finally {
    refreshSend();
  }
});
