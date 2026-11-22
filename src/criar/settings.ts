// Fenster „Produkt erstellen“: Einstellungen der KI (Anbieter, Modelle, Aufwand) und der Anfrage (Dicke, Arbeitsfläche).
// Die Schlüssel der Anbieter liegen getrennt unter kizamubeam.criar.keys und gehören nur zu diesem Rechner
// (LOCAL_KEYS in src/syncData.ts): sie kommen nie in den Sync-Ordner.
import { h, setIcon, showDialog } from '../dom';
import { t } from '../i18n';
import { hasNative, native } from '../native';
import type { LlmConfig, ProviderId, ProviderInfo } from './contract';

const SET_KEY = 'kizamubeam.criar.settings';
const KEYS_KEY = 'kizamubeam.criar.keys';

export type Effort = NonNullable<LlmConfig['effort']>;

export interface CreatorSettings {
  provider: ProviderId;
  /** Gewählte Modelle je Anbieter (beim Wechsel des Anbieters bleibt die Wahl des anderen erhalten) */
  models: Partial<Record<ProviderId, { model: string; review: string }>>;
  effort: Effort;
  thickness: number;
  bed: [number, number];
}

const DEFAULTS: CreatorSettings = { provider: 'openrouter', models: {}, effort: 'high', thickness: 3, bed: [600, 400] };

const read = <T>(key: string, d: T): T => {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? 'null');
    return v && typeof v === 'object' ? { ...d, ...v } : d;
  } catch {
    return d;
  }
};
const write = (key: string, v: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* Speicher nicht verfügbar: gilt nur für diese Sitzung */
  }
};

export function loadSettings(providers: ProviderInfo[]): CreatorSettings {
  const s = read(SET_KEY, DEFAULTS);
  if (!providers.some((p) => p.id === s.provider)) s.provider = providers[0]?.id ?? DEFAULTS.provider;
  if (!(['low', 'medium', 'high'] as unknown[]).includes(s.effort)) s.effort = DEFAULTS.effort;
  if (!(s.thickness > 0 && s.thickness <= 50)) s.thickness = DEFAULTS.thickness;
  if (!Array.isArray(s.bed) || !(s.bed[0] > 0) || !(s.bed[1] > 0)) s.bed = [...DEFAULTS.bed];
  s.models = s.models && typeof s.models === 'object' ? s.models : {};
  return s;
}
export const saveSettings = (s: CreatorSettings) => write(SET_KEY, s);

export const loadKeys = (): Partial<Record<ProviderId, string>> => read(KEYS_KEY, {});
export const saveKeys = (k: Partial<Record<ProviderId, string>>) => write(KEYS_KEY, k);

/** Modell und Prüfmodell des Anbieters: gespeicherte Wahl oder seine Voreinstellung */
export function modelsOf(s: CreatorSettings, p: ProviderInfo): { model: string; review: string } {
  const m = s.models[p.id];
  return { model: m?.model || p.defaultModel, review: m?.review || p.defaultReviewModel };
}

export function llmConfig(s: CreatorSettings, providers: ProviderInfo[]): LlmConfig | null {
  const p = providers.find((x) => x.id === s.provider);
  const key = loadKeys()[s.provider]?.trim();
  if (!p || !key) return null;
  const m = modelsOf(s, p);
  return { provider: p.id, apiKey: key, model: m.model, reviewModel: m.review, effort: s.effort };
}

/** Schlüssel-Seite des Anbieters im Browser öffnen (in der App über Rust, dort öffnet kein Link ein neues Fenster) */
export function openKeyPage(url: string) {
  if (hasNative()) void native('criar_open_key_page', { url }).catch(() => {});
  else window.open(url, '_blank', 'noopener');
}

const CUSTOM = '__custom__';

/** Auswahl eines Modells aus dem Katalog des Anbieters, mit „Eigene Modell-ID …“ für neuere Modelle */
function modelPicker(p: ProviderInfo, value: string, onChange: (v: string) => void) {
  const known = p.models.some((m) => m.id === value);
  const sel = h(
    'select',
    { class: 'cr-set-model' },
    ...p.models.map((m) => h('option', { value: m.id, selected: m.id === value }, m.vision ? m.label : `${m.label} (${t('ohne Bilder')})`)),
    h('option', { value: CUSTOM, selected: !known }, t('Eigene Modell-ID …')),
  ) as HTMLSelectElement;
  const custom = h('input', { type: 'text', class: 'cr-set-custom', value: known ? '' : value, placeholder: t('Modell-ID des Anbieters'), spellcheck: 'false', hidden: known }) as HTMLInputElement;
  const id = h('code', { class: 'cr-set-id' }, value);
  const sync = () => {
    custom.hidden = sel.value !== CUSTOM;
    const v = sel.value === CUSTOM ? custom.value.trim() : sel.value;
    id.textContent = v || '—';
    if (v) onChange(v);
  };
  sel.addEventListener('change', () => {
    if (sel.value === CUSTOM) custom.focus();
    sync();
  });
  custom.addEventListener('input', sync);
  return h('div', { class: 'cr-set-pick' }, sel, custom, id);
}

/** Einstellungen als Dialog (Zahnrad im Kopf der Seite). onSaved läuft nach jeder Änderung. */
export function openSettingsDialog(providers: ProviderInfo[], s: CreatorSettings, onSaved: () => void) {
  const keys = loadKeys();
  const dlg = h('dialog', { class: 'cr-settings' }) as HTMLDialogElement;
  const body = h('div', { class: 'cr-set-body' });
  const render = () => {
    const p = providers.find((x) => x.id === s.provider) ?? providers[0];
    const m = modelsOf(s, p);
    const keyIn = h('input', {
      type: 'password',
      class: 'cr-set-key',
      value: keys[p.id] ?? '',
      placeholder: p.keyPrefix ? `${p.keyPrefix}…` : t('Schlüssel einfügen'),
      spellcheck: 'false',
      autocomplete: 'off',
    }) as HTMLInputElement;
    const eye = h('button', { class: 'ib small', title: t('Schlüssel zeigen'), icon: 'eye' });
    eye.addEventListener('click', () => {
      const show = keyIn.type === 'password';
      keyIn.type = show ? 'text' : 'password';
      eye.title = show ? t('Schlüssel verbergen') : t('Schlüssel zeigen');
      setIcon(eye, show ? 'eyeoff' : 'eye');
    });
    const keyHint = h('div', { class: 'cr-set-hint' });
    const checkKey = () => {
      const v = keyIn.value.trim();
      keyHint.classList.toggle('warn', !!v && !!p.keyPrefix && !v.startsWith(p.keyPrefix));
      keyHint.textContent = !v
        ? t('Ohne Schlüssel kann die KI nicht arbeiten.')
        : p.keyPrefix && !v.startsWith(p.keyPrefix)
          ? t('Schlüssel von {name} beginnen meist mit „{prefix}“. Bitte prüfen.', { name: p.label, prefix: p.keyPrefix })
          : t('Gespeichert nur auf diesem Rechner, nie im Sync-Ordner.');
    };
    keyIn.addEventListener('input', () => {
      const v = keyIn.value.trim();
      if (v) keys[p.id] = v;
      else delete keys[p.id];
      saveKeys(keys);
      checkKey();
      onSaved();
    });
    checkKey();
    const setModel = (which: 'model' | 'review') => (v: string) => {
      s.models[p.id] = { ...modelsOf(s, p), [which]: v };
      saveSettings(s);
      onSaved();
    };
    const effort = h(
      'select',
      {},
      ...(['low', 'medium', 'high'] as Effort[]).map((e) =>
        h('option', { value: e, selected: e === s.effort }, e === 'low' ? t('Niedrig|Aufwand') : e === 'medium' ? t('Mittel|Aufwand') : t('Hoch|Aufwand')),
      ),
    ) as HTMLSelectElement;
    effort.addEventListener('change', () => {
      s.effort = effort.value as Effort;
      saveSettings(s);
      onSaved();
    });
    const tabs = h(
      'div',
      { class: 'cr-set-providers', role: 'tablist' },
      ...providers.map((x) =>
        h(
          'button',
          {
            class: 'cr-set-prov' + (x.id === p.id ? ' on' : ''),
            role: 'tab',
            onclick: () => {
              s.provider = x.id;
              saveSettings(s);
              onSaved();
              render();
            },
          },
          h('span', {}, x.label),
          keys[x.id] ? h('span', { class: 'cr-set-dot', title: t('Schlüssel hinterlegt') }) : null,
        ),
      ),
    );
    body.replaceChildren(
      h('div', { class: 'cr-set-row' }, h('div', { class: 'cr-set-label' }, t('Anbieter')), tabs),
      h(
        'div',
        { class: 'cr-set-row' },
        h('div', { class: 'cr-set-label' }, t('API-Schlüssel')),
        h('div', { class: 'cr-set-keyrow' }, keyIn, eye),
        keyHint,
        h(
          'div',
          { class: 'cr-set-hint' },
          t('Schlüssel anlegen:') + ' ',
          h('a', { href: p.keyUrl, class: 'cr-link', onclick: (e: Event) => (e.preventDefault(), openKeyPage(p.keyUrl)) }, p.keyUrl),
        ),
      ),
      h(
        'div',
        { class: 'cr-set-row' },
        h('div', { class: 'cr-set-label' }, t('Modell'), h('span', { class: 'cr-set-sub' }, t('entscheidet Maße, Ansichten und Aufbau'))),
        modelPicker(p, m.model, setModel('model')),
      ),
      h(
        'div',
        { class: 'cr-set-row' },
        h('div', { class: 'cr-set-label' }, t('Prüfmodell'), h('span', { class: 'cr-set-sub' }, t('günstiger, für die vielen kleinen Prüfungen je Teil'))),
        modelPicker(p, m.review, setModel('review')),
      ),
      h(
        'div',
        { class: 'cr-set-row cr-set-inline' },
        h('div', { class: 'cr-set-label' }, t('Denkaufwand'), h('span', { class: 'cr-set-sub' }, t('höher = genauer, langsamer und teurer'))),
        effort,
      ),
    );
  };
  render();
  dlg.append(
    h('div', { class: 'dlg-bar cr-dlg-bar' }, h('h3', {}, t('KI-Einstellungen')), h('button', { class: 'ib dlg-close', title: t('Schließen'), onclick: () => dlg.close() }, '✕')),
    body,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn primary', onclick: () => dlg.close() }, t('Fertig'))),
  );
  showDialog(dlg);
}
