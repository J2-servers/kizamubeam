// Dialog "Import from LightBurn" (opened from Laser → Devices): reads LightBurn's devices on this computer (desktop
// app, prefs.ini, read only) or from a picked .lbdev / .lbzip / prefs.ini, lists them with check boxes and the report
// of what each one brings, and adds the checked ones. A device with the same name as an existing one is replaced or
// kept next to it, as chosen in the list.
import { h } from './dom';
import { t } from './i18n';
import { Device, FIRMWARES } from './gcode';
import { ImportNote, jczAvailable, LbImport, LbSource, mapLightburnSource, parseLightburnFile, readLightburnPrefs } from './lbdevices';

export interface LbImportHost {
  devices: () => Device[];
  /** Device may be replaced (not the one in use while connected) */
  canReplace: (d: Device) => boolean;
  add: (d: Device) => void;
  replace: (old: Device, d: Device) => void;
  /** After importing: save and refresh the device list */
  done: () => void;
}

const isTauri = () => '__TAURI_INTERNALS__' in window;
const EXTS = ['lbdev', 'lbzip', 'ini', 'json'];

/** Pick a LightBurn file and return its name and bytes (desktop: native dialog; browser: file input) */
async function pickFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  if (isTauri()) {
    const { invoke } = await import('@tauri-apps/api/core');
    const path = await invoke<string | null>('pick_file', { filters: [[t('LightBurn-Geräte (.lbdev, .lbzip, prefs.ini)'), EXTS]] });
    if (!path) return null;
    const buf = await invoke<ArrayBuffer>('read_file', { path });
    return { name: path.split(/[\\/]/).pop() ?? path, bytes: new Uint8Array(buf) };
  }
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = EXTS.map((e) => '.' + e).join(',');
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.click();
  });
}

const KIND_LABEL: Record<ImportNote['kind'], () => string> = {
  taken: () => t('Übernommen'),
  converted: () => t('Umgerechnet'),
  missing: () => t('Nicht übernommen'),
};

export function openLightburnImport(host: LbImportHost) {
  const status = h('div', { class: 'note' });
  const list = h('div', { class: 'lb-list' });
  const result = h('div', { class: 'note lb-result' });
  let rows: { imp: LbImport; check: HTMLInputElement; dup: Device | null; mode: HTMLSelectElement | null }[] = [];

  const show = (src: LbSource) => {
    const imps = mapLightburnSource(src);
    status.textContent = t('{n} Geräte in {file}', { n: imps.length, file: src.from });
    list.textContent = '';
    result.textContent = '';
    rows = [];
    imps.forEach((imp, i) => {
      const jczMissing = imp.device?.fw === 'jcz' && !jczAvailable();
      const reason = imp.reason ?? (jczMissing ? t('Galvo-Steuerung (JCZ) ist in dieser Version von KizamuBeam noch nicht vorhanden.') : '');
      const usable = !!imp.device && !reason;
      const check = h('input', { type: 'checkbox', checked: usable, disabled: !usable, onchange: () => (importB.disabled = !rows.some((r) => r.check.checked)) });
      const dup = host.devices().find((d) => d.name === imp.name) ?? null;
      let mode: HTMLSelectElement | null = null;
      if (dup && usable) {
        const replaceOk = host.canReplace(dup);
        mode = h('select', { title: t('Es gibt schon ein Gerät mit diesem Namen') },
          h('option', { value: 'replace', disabled: !replaceOk, selected: replaceOk }, t('Vorhandenes „{name}“ ersetzen', { name: dup.name })),
          h('option', { value: 'both', selected: !replaceOk }, t('Beide behalten')),
        );
      }
      const fwLabel = imp.device ? (FIRMWARES[imp.device.fw]?.label ?? t('JCZ-Galvo (Faserlaser)')) : '—';
      const counts = (k: ImportNote['kind']) => imp.notes.filter((n) => n.kind === k).length;
      const notes = h('ul', { class: 'lb-notes' }, ...imp.notes.map((n) => h('li', { class: `lb-${n.kind}` }, h('b', {}, KIND_LABEL[n.kind]() + ': '), n.text)));
      list.append(h('div', { class: 'lb-dev' + (usable ? '' : ' off') },
        h('div', { class: 'lb-head' },
          h('label', { class: 'check' }, check, h('b', {}, imp.name)),
          h('span', { class: 'muted' }, `LightBurn „${imp.lbType}“ → ${fwLabel}`),
          i === src.defaultIndex ? h('span', { class: 'muted' }, t('(Standard in LightBurn)')) : null,
          dup && usable ? h('span', { class: 'lb-dup' }, t('Name schon vorhanden:'), mode) : null,
        ),
        reason ? h('div', { class: 'note warn' }, reason) : null,
        imp.device
          ? h('details', { open: true },
              h('summary', {}, t('{a} übernommen · {b} umgerechnet · {c} ohne Gegenstück', { a: counts('taken'), b: counts('converted'), c: counts('missing') })),
              notes)
          : null,
      ));
      rows.push({ imp, check, dup, mode });
    });
    importB.disabled = !rows.some((r) => r.check.checked);
  };
  const fail = (e: unknown) => {
    status.textContent = String((e as Error)?.message ?? e);
    list.textContent = '';
    rows = [];
    importB.disabled = true;
  };

  const readHere = () => readLightburnPrefs().then(show, fail);
  const fromFile = async () => {
    try {
      const f = await pickFile();
      if (f) show(parseLightburnFile(f.name, f.bytes));
    } catch (e) {
      fail(e);
    }
  };
  const doImport = () => {
    let added = 0, replaced = 0;
    for (const r of rows) {
      if (!r.check.checked || !r.imp.device) continue;
      const d = structuredClone(r.imp.device) as unknown as Device;
      if (r.dup && r.mode?.value === 'replace' && host.canReplace(r.dup)) {
        host.replace(r.dup, { ...d, id: r.dup.id });
        replaced++;
      } else {
        host.add(d);
        added++;
      }
      r.check.checked = false;
    }
    host.done();
    importB.disabled = true;
    result.textContent = t('{a} Geräte hinzugefügt, {r} ersetzt. Vor dem ersten Job Schnittstelle wählen und Fahrtrichtungen, Nullpunkt und Rahmen prüfen.', { a: added, r: replaced });
  };

  const importB = h('button', { class: 'btn primary', disabled: true, onclick: doImport }, t('Markierte importieren'));
  const dlg = h('dialog', { class: 'lb-import-dialog' },
    h('h3', {}, t('Aus LightBurn importieren')),
    h('div', { class: 'conn-row' },
      isTauri() ? h('button', { class: 'btn', title: t('Liest die Geräteliste von LightBurn auf diesem Computer (nur lesen)'), onclick: readHere }, t('LightBurn auf diesem Computer lesen')) : null,
      h('button', { class: 'btn', title: t('LightBurn-Geräteprofil (.lbdev), Paket (.lbzip) oder prefs.ini wählen'), onclick: fromFile }, t('Datei wählen …')),
    ),
    status,
    list,
    result,
    h('div', { class: 'dialog-buttons' }, importB, h('button', { class: 'btn', onclick: () => dlg.close() }, t('Schließen'))),
  );
  dlg.addEventListener('close', () => dlg.remove());
  dlg.addEventListener('keydown', (e) => e.stopPropagation());
  document.body.append(dlg);
  dlg.showModal();
  if (isTauri()) readHere();
  else status.textContent = t('Im Browser: LightBurn-Geräteprofil (.lbdev), Paket (.lbzip) oder prefs.ini wählen. Unter Windows liegt prefs.ini in %LOCALAPPDATA%\\LightBurn.');
}
