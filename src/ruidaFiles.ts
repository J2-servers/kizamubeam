// Dateien im internen Speicher einer Ruida-Steuerung: anzeigen, starten, löschen.
// Die Befehle führt ruida_link.rs aus (RUIDA_LIST_FILES, RUIDA_START_FILE n, RUIDA_DELETE_FILE n); Fehler
// kommen dort mit der wörtlichen Meldung der Steuerung bzw. der USB-/UDP-Schnittstelle zurück und stehen hier unverändert.
import { h } from './dom';
import { machine } from './machine';
import { t, tn } from './i18n';

export interface RuidaFile {
  /** Nummer im Speicher (1 … 99), wie sie die Steuerung zählt */
  num: number;
  name: string;
  /** Wörtliche Fehlermeldung, wenn der Name nicht gelesen werden konnte */
  error?: string;
}

/** Antwortzeilen von RUIDA_LIST_FILES auswerten */
export function parseRuidaFiles(lines: string[]): { count: number | null; files: RuidaFile[]; errors: string[] } {
  let count: number | null = null;
  const files: RuidaFile[] = [];
  const errors: string[] = [];
  for (const raw of lines) {
    const l = raw.trim();
    let m = /^\[Ruida\] Dateien im Speicher: (\d+)$/.exec(l);
    if (m) {
      count = Number(m[1]);
      continue;
    }
    m = /^\[Ruida\] Datei (\d+): (.*)$/.exec(l);
    if (m) {
      const rest = m[2];
      const bad = /^(Name nicht gelesen: |unerwartete Antwort )/.test(rest);
      files.push(bad ? { num: Number(m[1]), name: '', error: rest } : { num: Number(m[1]), name: rest });
      continue;
    }
    m = /^\[Ruida\] (Dateiliste nicht gelesen: .*|Die Steuerung meldet .*)$/.exec(l);
    if (m) errors.push(m[1]);
  }
  return { count, files, errors };
}

/** Ergebnis von RUIDA_START_FILE / RUIDA_DELETE_FILE: null = erledigt, sonst die wörtliche Meldung */
export function ruidaResult(lines: string[], okRe: RegExp): string | null {
  const fail = lines.map((l) => l.trim()).find((l) => /^\[Ruida\] (Start|Löschen) fehlgeschlagen: /.test(l));
  if (fail) return fail.replace(/^\[Ruida\] /, '');
  return lines.some((l) => okRe.test(l.trim())) ? null : t('Keine Antwort der Steuerung.');
}

const ready = () => machine.connected && !machine.running && machine.fw.read === 'ruida';
const notReady = () =>
  !machine.connected ? t('Nicht verbunden.') : machine.running ? t('Es läuft bereits ein Auftrag.') : t('Nur für Ruida-Steuerungen.');

/** Knopf fürs Laser-Fenster; zeigt sich und sperrt sich wie twin („In Steuerung speichern …“, nur bei Ruida) */
export function ruidaFilesButton(twin: HTMLElement): HTMLButtonElement {
  const b = h('button', {
    class: 'btn',
    title: t('Dateien im internen Speicher der Ruida-Steuerung anzeigen, starten und löschen'),
    onclick: () => openRuidaFiles(),
  }, t('Dateien in der Steuerung …')) as HTMLButtonElement;
  const sync = () => {
    b.hidden = twin.hidden;
    b.disabled = (twin as HTMLButtonElement).disabled;
  };
  new MutationObserver(sync).observe(twin, { attributes: true, attributeFilter: ['hidden', 'disabled'] });
  sync();
  return b;
}

/** Dateien im Speicher der Ruida-Steuerung: ansehen, starten, löschen */
export async function openRuidaFiles() {
  const list = h('div', { class: 'fluid-files' });
  const note = h('div', { class: 'note' });
  const reload = h('button', { class: 'btn', onclick: () => load() }, t('Neu lesen')) as HTMLButtonElement;
  const dlg = h('dialog', { class: 'fluid-dialog fluid-files-dialog ruida-files-dialog' },
    h('h3', {}, t('Dateien in der Ruida-Steuerung')),
    h('div', { class: 'note' }, t('Gelesen wird der interne Speicher der Steuerung (wie „Dateien“ am Bedienfeld). Starten fährt den Auftrag sofort ab; Löschen lässt sich nicht rückgängig machen.')),
    h('div', { class: 'conn-row' }, reload),
    list,
    note,
    h('div', { class: 'dialog-buttons' }, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  ) as HTMLDialogElement;
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();

  const setNote = (text: string, error = false) => {
    note.textContent = text;
    note.classList.toggle('error', error);
  };

  async function load() {
    list.textContent = '';
    if (!ready()) return setNote(notReady(), true);
    reload.disabled = true;
    setNote(t('Lese Dateiliste …'));
    const lines = await machine.query(['RUIDA_LIST_FILES'], 120000);
    reload.disabled = false;
    const r = parseRuidaFiles(lines);
    if (r.count === null) return setNote(r.errors[0] ?? t('Keine Antwort der Steuerung.'), true);
    for (const f of r.files) {
      list.append(h('div', { class: 'fluid-file' },
        h('span', { class: 'note' }, `${f.num}.`),
        h('span', { class: 'grow' }, f.error ? h('span', { class: 'error' }, f.error) : f.name || t('(ohne Namen)')),
        h('button', { class: 'btn small', title: t('Auf der Steuerung starten'), onclick: () => run(f) }, t('Starten')),
        h('button', { class: 'btn small', title: t('Aus dem Speicher der Steuerung löschen'), onclick: () => del(f) }, t('Löschen')),
      ));
    }
    const text = r.count ? tn('{n} Datei im Speicher.', '{n} Dateien im Speicher.', r.count) : t('Keine Dateien im Speicher.');
    setNote([text, ...r.errors].join(' '), r.errors.length > 0);
  }

  const label = (f: RuidaFile) => (f.name ? `${f.num} „${f.name}“` : String(f.num));

  async function run(f: RuidaFile) {
    if (!ready()) return setNote(notReady(), true);
    if (!confirm(t('Datei {file} jetzt auf der Steuerung starten? Der Laser beginnt sofort.', { file: label(f) }))) return;
    const err = ruidaResult(await machine.query([`RUIDA_START_FILE ${f.num}`], 10000), /^\[Ruida\] Datei \d+ gestartet\.$/);
    if (err) return setNote(err, true);
    dlg.close();
  }

  async function del(f: RuidaFile) {
    if (!ready()) return setNote(notReady(), true);
    if (!confirm(t('Datei {file} aus dem Speicher der Steuerung löschen? Das lässt sich nicht rückgängig machen.', { file: label(f) }))) return;
    const err = ruidaResult(await machine.query([`RUIDA_DELETE_FILE ${f.num}`], 10000), /^\[Ruida\] Datei \d+ gelöscht\.$/);
    if (err) return setNote(err, true);
    await load();
  }

  await load();
}
