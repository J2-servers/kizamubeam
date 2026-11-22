// Fenster „Produkt erstellen“: Eingabe unter dem Verlauf. Bilder ziehen, einfügen oder auswählen (Miniaturen mit
// Entfernen), der Wunsch als Text, Maße (Breite X / Höhe Z / Tiefe Y, mindestens eines), Materialdicke und
// Arbeitsfläche der Maschine, Senden/Stoppen.
import { evalExpr, h, setIcon } from '../dom';
import { t } from '../i18n';
import type { LlmImage, Measure } from './contract';

/** Größte Kantenlänge der Bilder an die KI: genug für Details, unter den Grenzen aller Anbieter (Anthropic: 8000 px, 5 MB) */
const MAX_EDGE = 2000;
const MAX_BYTES = 3_700_000;
const DIRECT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

export interface PickedImage {
  name: string;
  /** Daten-URL für Miniatur und Verlauf */
  url: string;
  llm: LlmImage;
}

const readUrl = (f: Blob) =>
  new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(f);
  });

const loadImg = (src: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error(t('Bild konnte nicht gelesen werden (Format nicht unterstützt?)')));
    img.src = src;
  });

/** Datei → Bild für die KI; zu große Bilder werden verkleinert (JPEG, Qualität 0,92) */
export async function prepareImage(f: File): Promise<PickedImage> {
  const url = await readUrl(f);
  const img = await loadImg(url);
  const edge = Math.max(img.naturalWidth, img.naturalHeight);
  if (DIRECT.includes(f.type) && edge <= MAX_EDGE && f.size <= MAX_BYTES) return { name: f.name, url, llm: { mediaType: f.type, base64: url.slice(url.indexOf(',') + 1) } };
  const k = Math.min(1, MAX_EDGE / edge);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(img.naturalWidth * k));
  c.height = Math.max(1, Math.round(img.naturalHeight * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  const out = c.toDataURL('image/jpeg', 0.92);
  return { name: f.name, url: out, llm: { mediaType: 'image/jpeg', base64: out.slice(out.indexOf(',') + 1) } };
}

export interface ComposeValue {
  images: PickedImage[];
  text: string;
  measures: Measure[];
  thickness: number;
  bed: [number, number];
}

export interface Composer {
  el: HTMLElement;
  value(): ComposeValue;
  /** Nach dem Senden: Text und Bilder leeren (Maße, Dicke und Arbeitsfläche bleiben) */
  clear(): void;
  setRunning(on: boolean): void;
  addFiles(files: Iterable<File>): Promise<void>;
  setError(msg: string): void;
  focus(): void;
}

export function buildComposer(opts: {
  thickness: number;
  bed: [number, number];
  onSend: () => void;
  onStop: () => void;
  onSettingsChange: (thickness: number, bed: [number, number]) => void;
}): Composer {
  let images: PickedImage[] = [];
  let running = false;
  const thumbs = h('div', { class: 'cr-c-thumbs' });
  const file = h('input', { type: 'file', accept: 'image/png,image/jpeg,image/webp,image/gif,image/bmp', multiple: true, hidden: true }) as HTMLInputElement;
  const addBtn = h('button', { class: 'cr-c-add', title: t('Bilder auswählen'), onclick: () => file.click() }, h('span', { class: 'cr-c-add-icon', icon: 'image' }), h('span', {}, t('Fotos')));
  const dropHint = h('span', { class: 'cr-c-drophint' }, t('Fotos hierher ziehen, einfügen (Ctrl+V) oder auswählen'));
  const text = h('textarea', {
    class: 'cr-c-text',
    rows: 2,
    spellcheck: 'true',
    placeholder: t('Was soll gebaut werden? z. B. „Eine Spardose wie auf dem Foto, mit Schlitz oben und abnehmbarem Boden“'),
  }) as HTMLTextAreaElement;
  const err = h('div', { class: 'cr-c-err', hidden: true });

  const num = (value: string, title: string, cls = '') => h('input', { type: 'text', inputmode: 'decimal', class: 'cr-num ' + cls, value, title, spellcheck: 'false' }) as HTMLInputElement;
  const mx = num('', t('Breite (X) des fertigen Produkts in mm'));
  const mz = num('', t('Höhe (Z) des fertigen Produkts in mm'));
  const my = num('', t('Tiefe (Y) des fertigen Produkts in mm'));
  const th = num(String(opts.thickness), t('Materialdicke in mm'), 'short');
  const bw = num(String(opts.bed[0]), t('Breite der Arbeitsfläche in mm'), 'short');
  const bh = num(String(opts.bed[1]), t('Höhe der Arbeitsfläche in mm'), 'short');
  const field = (label: string, axis: string, input: HTMLInputElement) =>
    h('label', { class: 'cr-c-field' }, h('span', { class: 'cr-c-flabel' }, label, axis ? h('span', { class: 'cr-axis' }, axis) : null), h('span', { class: 'cr-c-unit' }, input, 'mm'));
  const sendIcon = h('span', { class: 'cr-c-send-icon', icon: 'send' });
  const sendLabel = h('span', {}, t('Senden'));
  const send = h('button', { class: 'btn primary cr-c-send', title: t('Senden (Enter, neue Zeile mit Umschalt+Enter)') }, sendIcon, sendLabel) as HTMLButtonElement;
  send.addEventListener('click', () => (running ? opts.onStop() : opts.onSend()));

  const val = (i: HTMLInputElement): number | null => {
    const s = i.value.trim();
    if (!s) return null;
    const v = evalExpr(s);
    return v !== null && Number.isFinite(v) && v > 0 ? v : NaN;
  };
  const markBad = () => {
    for (const i of [mx, mz, my, th, bw, bh]) i.classList.toggle('bad', Number.isNaN(val(i)));
  };
  const settingsChanged = () => {
    markBad();
    const t1 = val(th),
      w = val(bw),
      hh = val(bh);
    if (t1 && w && hh && !Number.isNaN(t1) && !Number.isNaN(w) && !Number.isNaN(hh)) opts.onSettingsChange(t1, [w, hh]);
  };
  for (const i of [mx, mz, my]) i.addEventListener('input', markBad);
  for (const i of [th, bw, bh]) i.addEventListener('change', settingsChanged);

  const renderThumbs = () => {
    thumbs.replaceChildren(
      ...images.map((im, k) =>
        h(
          'div',
          { class: 'cr-c-thumb', title: im.name },
          h('img', { src: im.url, alt: im.name }),
          h('button', {
            class: 'cr-c-del',
            title: t('Bild entfernen'),
            onclick: () => {
              images.splice(k, 1);
              renderThumbs();
            },
          }, '✕'),
        ),
      ),
      addBtn,
    );
    dropHint.hidden = images.length > 0;
  };
  const setError = (msg: string) => {
    err.hidden = !msg;
    err.textContent = msg;
  };
  const addFiles = async (files: Iterable<File>) => {
    const bad: string[] = [];
    for (const f of files) {
      if (!f.type.startsWith('image/')) {
        bad.push(f.name);
        continue;
      }
      try {
        images.push(await prepareImage(f));
      } catch (e) {
        bad.push(`${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    renderThumbs();
    setError(bad.length ? t('Nicht übernommen: {list}', { list: bad.join(', ') }) : '');
  };
  file.addEventListener('change', () => {
    if (file.files) void addFiles([...file.files]);
    file.value = '';
  });
  text.addEventListener('input', () => {
    text.style.height = 'auto';
    text.style.height = `${Math.min(220, text.scrollHeight + 2)}px`;
  });
  text.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      if (!running) opts.onSend();
    }
  });

  const drop = h('div', { class: 'cr-c-drop' }, thumbs, dropHint, file);
  const el = h(
    'div',
    { class: 'cr-compose' },
    drop,
    text,
    h(
      'div',
      { class: 'cr-c-row' },
      h('div', { class: 'cr-c-group' }, h('span', { class: 'cr-c-gtitle' }, t('Maße des Produkts')), h('div', { class: 'cr-c-fields' }, field(t('Breite'), 'X', mx), field(t('Höhe'), 'Z', mz), field(t('Tiefe'), 'Y', my))),
      h('div', { class: 'cr-c-group' }, h('span', { class: 'cr-c-gtitle' }, t('Material und Maschine')), h('div', { class: 'cr-c-fields' }, field(t('Dicke'), '', th), h('label', { class: 'cr-c-field' }, h('span', { class: 'cr-c-flabel' }, t('Arbeitsfläche')), h('span', { class: 'cr-c-unit' }, bw, '×', bh, 'mm')))),
    ),
    h('div', { class: 'cr-c-foot' }, err, h('span', { class: 'cr-st-gap' }), send),
  );
  renderThumbs();
  // Ziehen über die ganze Eingabe
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    el.classList.add('drag');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget as Node)) el.classList.remove('drag');
  });
  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('drag');
    if (e.dataTransfer?.files.length) void addFiles([...e.dataTransfer.files]);
  });

  return {
    el,
    value() {
      const ms: Measure[] = [];
      const m = (i: HTMLInputElement, axis: Measure['axis'], what: string) => {
        const v = val(i);
        if (v && !Number.isNaN(v)) ms.push({ axis, mm: v, what });
      };
      m(mx, 'x', 'overall width (X)');
      m(mz, 'z', 'overall height (Z)');
      m(my, 'y', 'overall depth (Y)');
      const t1 = val(th);
      const w = val(bw),
        hh = val(bh);
      return {
        images: [...images],
        text: text.value.trim(),
        measures: ms,
        thickness: t1 && !Number.isNaN(t1) ? t1 : NaN,
        bed: [w && !Number.isNaN(w) ? w : NaN, hh && !Number.isNaN(hh) ? hh : NaN],
      };
    },
    clear() {
      images = [];
      text.value = '';
      text.style.height = '';
      renderThumbs();
      setError('');
    },
    setRunning(on) {
      running = on;
      el.classList.toggle('running', on);
      send.classList.toggle('stop', on);
      setIcon(sendIcon, on ? 'stop' : 'send');
      sendLabel.textContent = on ? t('Stopp') : t('Senden');
      send.title = on ? t('Die KI anhalten') : t('Senden (Enter, neue Zeile mit Umschalt+Enter)');
      for (const i of [text, mx, mz, my, th, bw, bh]) i.disabled = on;
      addBtn.disabled = on;
    },
    addFiles,
    setError,
    focus: () => text.focus(),
  };
}
