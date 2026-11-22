// Chargenprüfung: Vor dem Start einer Serie wird JEDES Stück einzeln geprüft, nicht nur das Blatt mit der aktuellen
// Nummer. Gefunden werden fehlende CSV-Zeilen, leere Felder, Spalten, die es in der Datei nicht gibt, Anweisungen des
// Kunden, die im Namen stehen geblieben sind, Emoji und unsichtbare Zeichen, Zeichen, die in der gewählten Schrift
// fehlen, und zweimal derselbe Inhalt. Ohne DOM und ohne Schriftdateien, damit es auch in den Tests läuft: Die
// Glyphen-Auskunft wird hineingegeben (im Programm aus fonts.ts, siehe batchProofDialog.ts).
import { t } from './i18n';
import type { Obj, VarText } from './model';
import { fillTemplate } from './params';
import { csvColumn, csvRow, expand, refs, type VarRef } from './vartext';

export type ProofKind = 'missing-row' | 'no-csv' | 'column' | 'empty' | 'instruction' | 'emoji' | 'invisible' | 'glyph' | 'font' | 'duplicate';
export type ProofLevel = 'error' | 'warn';

export interface ProofIssue {
  /** Gleiche Ursache = gleicher Schlüssel (so steht jede Ursache in der Abfrage vor dem Start nur einmal) */
  key: string;
  kind: ProofKind;
  level: ProofLevel;
  msg: string;
  /** Nummer des Stücks */
  n: number;
  /** Ids der betroffenen Objekte */
  ids: number[];
}

/** Schrift eines Texts, so wie sie graviert würde */
export interface FontKey {
  family: string;
  bold: boolean;
  italic: boolean;
  /** Großbuchstaben: Die Glyphen werden für den großgeschriebenen Text gebraucht */
  upper: boolean;
}

/** Auskunft über eine Schrift */
export interface GlyphInfo {
  /** Hat die Schrift dieses Zeichen? */
  has: (ch: string) => boolean;
  /** true: Die gewünschte Schrift fehlt auf diesem Rechner, graviert würde die Ersatzschrift */
  fallback: boolean;
  /** Name der Schrift, die wirklich graviert würde (bei fallback die Ersatzschrift) */
  family?: string;
}

/** Eine Vorlage, so wie sie in einem geprüften Stück erscheint */
export interface ProofPart {
  /** Objekte mit genau dieser Vorlage und Schrift */
  ids: number[];
  template: string;
  /** null bei Strichcodes: Sie werden kodiert, nicht mit einer Schrift graviert */
  font: FontKey | null;
  /** eingesetzter Inhalt */
  text: string;
  issues: ProofIssue[];
}

/** Ein Stück der Serie (eine Nummer) */
export interface ProofRow {
  n: number;
  parts: ProofPart[];
  /** Befunde des Stücks, Fehler zuerst */
  issues: ProofIssue[];
}

export interface ProofSheet {
  rows: ProofRow[];
  /** Je Ursache einmal, Fehler zuerst, mit der Anzahl betroffener Stücke */
  issues: (ProofIssue & { count: number })[];
  /** Stücke mit Fehler bzw. nur mit Warnung */
  bad: number;
  warned: number;
  from: number;
  to: number;
  /** Die Serie ist länger als die geprüften Stücke */
  truncated: boolean;
  /** Kein variabler Text vorhanden: Es gibt nichts zu prüfen */
  nothing: boolean;
}

export interface ProofSettings {
  /** Höchstzahl geprüfter Stücke */
  maxRows: number;
  /** Ein Feld gilt als Anweisung, wenn es dieses Vielfache der üblichen Feldlänge (Median) überschreitet … */
  longFactor: number;
  /** … und mindestens so viele Zeichen hat */
  longMin: number;
}

export const DEFAULT_PROOF: ProofSettings = { maxRows: 2000, longFactor: 3, longMin: 40 };

/**
 * Wörter, die auf eine Anweisung an den Graveur statt auf einen Inhalt hindeuten. Einzelne Wörter zählen nur als
 * ganzes Wort, Wortgruppen als Teil des Feldes. Übersetzungen dürfen die Liste für ihre Sprache ersetzen.
 */
const phrases = () =>
  t(
    'bitte,please,por favor,favor,siehe,see note,wie oben,same as,ditto,dito,idem,igual,mesmo,nota,note,obs,anmerkung,hinweis,n/a,tbd,kein name,no name,sem nome,leer,empty,none|Chargenprüfung: Wörter, die auf eine Anweisung statt eines Inhalts hindeuten, mit Komma getrennt',
  )
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Emoji der eigenen Ebenen und die Emoji-Darstellung: Dafür hat keine Gravurschrift einen Umriss */
const isEmoji = (cp: number) => (cp >= 0x1f000 && cp <= 0x1faff) || cp === 0xfe0f || cp === 0x20e3;

/**
 * Bildzeichen der Grundebene (✓ ★ ♥ ☺ ✅ ⭐ …). Die zählen NICHT von sich aus als Emoji: Hat die Schrift einen
 * Umriss dafür, wird er sauber graviert und ist oft genau so gewollt. Fehlt er, ist „Emoji“ die hilfreichere
 * Meldung als „Zeichen fehlt in der Schrift“ — denn genau diese Zeichen klebt ein Kunde ins Namensfeld.
 */
const isPictograph = (cp: number) =>
  (cp >= 0x2190 && cp <= 0x21ff) || (cp >= 0x2300 && cp <= 0x23ff) || (cp >= 0x2600 && cp <= 0x27bf) || (cp >= 0x2b00 && cp <= 0x2bff);

/** Zeichen, die man nicht sieht und die deshalb unbemerkt in CSV-Dateien stehen */
const isInvisible = (cp: number) =>
  (cp < 0x20 && cp !== 0x0a) ||
  cp === 0x7f ||
  cp === 0xa0 ||
  cp === 0xad ||
  (cp >= 0x2000 && cp <= 0x200f) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  (cp >= 0x202a && cp <= 0x202f) ||
  cp === 0x205f ||
  cp === 0x2060 ||
  cp === 0x3000 ||
  cp === 0xfeff;

/** Langen Feldinhalt für eine Meldung kürzen */
const short = (s: string, max = 48) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? one.slice(0, max - 1) + '…' : one;
};

/** U+00A0 usw., damit unsichtbare Zeichen in der Meldung benannt werden können */
const codeName = (ch: string) => 'U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');

/** Vorlage und Schrift eines Objekts mit variablem Text; gleiche Vorlage und Schrift werden zusammengefasst */
interface Src {
  ids: number[];
  template: string;
  font: FontKey | null;
  refs: VarRef[];
}

/** Die Vorlagen der Objekte mit variablem Text, nach Vorlage und Schrift zusammengefasst */
export function proofSources(objs: Obj[]): Src[] {
  const by = new Map<string, Src>();
  for (const o of objs) {
    const s = o.shape;
    let key: string, template: string, font: FontKey | null;
    if (s.kind === 'text' && s.vt) {
      font = { family: s.font, bold: s.bold, italic: s.italic, upper: s.upper };
      template = s.text;
      key = `t\u0000${template}\u0000${font.family}\u0000${font.bold}\u0000${font.italic}\u0000${font.upper}`;
    } else if (s.kind === 'barcode' && s.vt) {
      font = null;
      template = s.data;
      // Art und Fehlerkorrektur gehören zum Schlüssel: Ein QR-Code und ein Code 128 mit derselben Vorlage
      // sind zwei verschiedene Stücke und werden in der Liste einzeln gezeigt.
      key = `b\u0000${template}\u0000${s.type}\u0000${s.ec}`;
    } else continue;
    const hit = by.get(key);
    if (hit) hit.ids.push(o.id);
    else by.set(key, { ids: [o.id], template, font, refs: refs(template) });
  }
  return [...by.values()];
}

/** Steht die Wortgruppe als eigenes Wort im Text? („n/a“ ja, aber nicht in „Sean/Ana Silva“) */
function hasPhrase(s: string, p: string): boolean {
  const letter = /[\p{L}\p{N}]/u;
  for (let i = s.indexOf(p); i >= 0; i = s.indexOf(p, i + 1)) {
    const vor = i > 0 ? s[i - 1] : '';
    const nach = i + p.length < s.length ? s[i + p.length] : '';
    if (!letter.test(vor) && !letter.test(nach)) return true;
  }
  return false;
}

/**
 * Höchster Versatz dieser Objekte. Ein Job mit mehreren Kopien (ein Jig voller Schilder) verbraucht so viele
 * Nummern: von der aktuellen bis zur aktuellen + Versatz — genau das, was afterJob() danach weiterzählt.
 */
export function maxOffset(objs: Obj[]): number {
  let max = 0;
  for (const o of objs) {
    const s = o.shape;
    if ((s.kind === 'text' || s.kind === 'barcode') && s.vt) max = Math.max(max, s.vt.offset || 0);
  }
  return max;
}

/** Sieht der Inhalt eines Feldes nach einer Anweisung aus statt nach dem, was graviert werden soll? */
function looksLikeInstruction(v: string, st: ProofSettings, typical: number, list: string[]): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return false;
  const words = new Set(s.split(/[^\p{L}\p{N}]+/u).filter(Boolean));
  for (const p of list) {
    if (/[^\p{L}\p{N}]/u.test(p)) {
      if (hasPhrase(s, p)) return true;
    } else if (words.has(p)) return true;
  }
  return typical > 0 && v.length >= st.longMin && v.length > typical * st.longFactor;
}

export interface ProofInput {
  /** Objekte mit variablem Text (Editor: varTextObjs(false) für die aktuelle Seite) */
  objs: Obj[];
  vt: VarText;
  /** Geprüfte Nummern, einschließlich */
  from: number;
  to: number;
  /** Schrift-Auskunft; fehlt sie, wird nicht auf fehlende Glyphen geprüft */
  glyphs?: (f: FontKey) => GlyphInfo | null;
  settings?: Partial<ProofSettings>;
  /** Fester Zeitpunkt für Datums-Platzhalter (ein Job = ein Zeitpunkt) */
  now?: Date;
}

const LEVEL: Record<ProofLevel, number> = { error: 0, warn: 1 };

/** Jedes Stück der Serie prüfen */
export function batchProof(inp: ProofInput): ProofSheet {
  const st = { ...DEFAULT_PROOF, ...inp.settings, maxRows: Math.max(1, Math.floor(inp.settings?.maxRows ?? DEFAULT_PROOF.maxRows)) };
  const srcs = proofSources(inp.objs);
  // Die erste Nummer ist 1: Nummer 0 gibt es weder als Seriennummer noch als CSV-Zeile.
  const from = Math.max(1, Math.min(inp.from, inp.to));
  const last = Math.max(from, inp.from, inp.to);
  const truncated = last - from + 1 > st.maxRows;
  const to = truncated ? from + st.maxRows - 1 : last;
  const now = inp.now ?? new Date();
  const sheet: ProofSheet = { rows: [], issues: [], bad: 0, warned: 0, from, to, truncated, nothing: !srcs.length };
  if (!srcs.length) return sheet;

  // Breite der Tabelle: So viele Spalten hat die Datei. Ein Platzhalter darüber hinaus (%5 bei zwei Spalten)
  // ist eine Spalte, die es nicht gibt — und nicht ein leeres Feld in jedem einzelnen Stück.
  const width = inp.vt.csv ? (inp.vt.csv.header?.length ?? inp.vt.csv.rows.reduce((w, r) => Math.max(w, r.length), 0)) : 0;
  // Spaltennummer je Platzhalter, einmal berechnet (nicht je Stück); -1 = gibt es nicht
  const colOf = (r: VarRef) => {
    const i = r.kind === 'csv-index' ? (r.col ?? -1) : r.kind === 'csv-name' ? csvColumn(inp.vt, r.name ?? '') : -1;
    return i >= 0 && i < Math.max(width, 1) ? i : -1;
  };
  const csvRefs = srcs.map((s) => s.refs.filter((r) => r.kind === 'csv-index' || r.kind === 'csv-name'));
  const cols = csvRefs.map((rs) => new Map(rs.map((r) => [r.code, colOf(r)])));
  const list = phrases();
  // Eine Nummer unterscheidet die Stücke überhaupt? Sonst wäre jedes Stück gleich und „doppelt“ nur Lärm.
  const varying = srcs.some((s) => s.refs.some((r) => r.kind === 'serial' || r.kind === 'csv-index' || r.kind === 'csv-name'));

  // Erster Durchgang: Inhalte einsetzen und die Feldlängen sammeln. Verglichen wird später mit dem MITTELWERT der
  // Reihe (Median), nicht mit dem Durchschnitt: Ein einzelnes langes Feld zieht den Durchschnitt mit nach oben und
  // würde sich damit selbst verstecken.
  const texts: string[][] = [];
  const lens = srcs.map(() => new Map<string, number[]>());
  for (let n = from; n <= to; n++) {
    const line = srcs.map((s) => expand(fillTemplate(s.template), n, inp.vt, now));
    texts.push(line);
    srcs.forEach((_s, i) => {
      const row = csvRow(inp.vt, n);
      for (const r of csvRefs[i]) {
        const col = cols[i].get(r.code) ?? -1;
        const v = col >= 0 ? (row?.[col] ?? '') : '';
        if (!v.trim()) continue;
        (lens[i].get(r.code) ?? lens[i].set(r.code, []).get(r.code)!).push(v.length);
      }
    });
  }
  const typicalLen = (i: number, code: string) => {
    const a = lens[i].get(code);
    if (!a?.length) return 0;
    const sorted = [...a].sort((x, y) => x - y);
    return sorted[Math.floor(sorted.length / 2)];
  };

  // Zweiter Durchgang: prüfen
  const firstWith = new Map<string, number>();
  for (let n = from; n <= to; n++) {
    const row: ProofRow = { n, parts: [], issues: [] };
    srcs.forEach((s, i) => {
      const text = texts[n - from][i];
      const part: ProofPart = { ids: s.ids, template: s.template, font: s.font, text, issues: [] };
      const add = (kind: ProofKind, level: ProofLevel, key: string, msg: string) => part.issues.push({ key, kind, level, msg, n, ids: s.ids });

      // Felder aus der CSV-Datei
      if (csvRefs[i].length && !inp.vt.csv)
        add('no-csv', 'error', 'no-csv', t('Die Vorlage holt Spalten aus einer CSV-Datei, es ist aber keine geladen.'));
      else if (csvRefs[i].length && !csvRow(inp.vt, n))
        add('missing-row', 'error', 'missing-row', t('Für Nummer {n} gibt es in der CSV-Datei keine Zeile.', { n }));
      else
        for (const r of csvRefs[i]) {
          const col = cols[i].get(r.code) ?? -1;
          if (col < 0) {
            add('column', 'error', `column:${r.code}`, t('Die Spalte „{name}“ gibt es in der CSV-Datei nicht.', { name: r.name ?? r.code }));
            continue;
          }
          const v = csvRow(inp.vt, n)?.[col] ?? '';
          if (!v.trim()) add('empty', 'error', `empty:${r.code}`, t('Das Feld {code} ist bei Nummer {n} leer.', { code: r.code, n }));
          else if (looksLikeInstruction(v, st, typicalLen(i, r.code), list))
            add('instruction', 'warn', `instruction:${r.code}`, t('Hier steht eine Anweisung statt eines Inhalts: „{text}“', { text: short(v) }));
        }

      // Zeichen des eingesetzten Inhalts
      const emoji: string[] = [];
      const invisible: string[] = [];
      const missing: string[] = [];
      const info = s.font && inp.glyphs ? inp.glyphs(s.font) : null;
      for (const ch of s.font?.upper ? text.toUpperCase() : text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (isEmoji(cp)) {
          if (!emoji.includes(ch)) emoji.push(ch);
        } else if (isInvisible(cp)) {
          if (!invisible.includes(ch)) invisible.push(ch);
        } else if (ch !== '\n' && info && !info.has(ch)) {
          // Ein Bildzeichen, für das die Schrift keinen Umriss hat, ist für den Benutzer ein Emoji
          const topf = isPictograph(cp) ? emoji : missing;
          if (!topf.includes(ch)) topf.push(ch);
        }
      }
      if (emoji.length) add('emoji', 'error', `emoji:${emoji.join('')}`, t('Emoji haben keinen Umriss und werden nicht graviert: {chars}', { chars: emoji.join(' ') }));
      if (invisible.length)
        add('invisible', 'warn', `invisible:${invisible.map(codeName).join(' ')}`, t('Unsichtbare Zeichen im Inhalt: {codes}', { codes: invisible.map(codeName).join(' ') }));
      // Gemeldet wird die Schrift, die wirklich graviert würde: bei einer fehlenden Schrift die Ersatzschrift
      const graviert = info?.family || s.font?.family || '';
      if (missing.length)
        add('glyph', 'error', `glyph:${graviert}:${missing.join('')}`, t('Diese Zeichen fehlen in der Schrift „{font}“: {chars}', { font: graviert, chars: missing.join(' ') }));
      if (info?.fallback) add('font', 'warn', `font:${s.font?.family}`, t('Die Schrift „{font}“ ist hier nicht installiert; graviert würde die Ersatzschrift.', { font: s.font?.family ?? '' }));
      row.parts.push(part);
    });

    // Zweimal dasselbe Stück. Wurden die Felder gar nicht erst eingesetzt (keine CSV-Datei, keine Zeile, Spalte
    // gibt es nicht), sind alle Stücke gleich: Das ist die Folge jenes Fehlers und kein eigener Befund. Jeder
    // ANDERE Fehler (Emoji, fehlendes Zeichen) hat mit der Wiederholung nichts zu tun — da wird weiter geprüft,
    // denn „einer der Namen war doppelt“ ist genau die Reklamation, für die es diese Prüfung gibt.
    const content = row.parts.map((p) => p.text).join('\u0000');
    const unersetzt = row.parts.some((p) => p.issues.some((x) => x.kind === 'no-csv' || x.kind === 'missing-row' || x.kind === 'column'));
    if (varying && !unersetzt && content.replace(/\u0000/g, '').trim()) {
      const first = firstWith.get(content);
      if (first !== undefined)
        row.issues.push({
          key: 'duplicate',
          kind: 'duplicate',
          level: 'warn',
          msg: t('Gleicher Inhalt wie Nummer {m}.', { m: first }),
          n,
          ids: srcs.flatMap((s) => s.ids),
        });
      else firstWith.set(content, n);
    }
    // Dieselbe Ursache nur einmal im Stück: Zwei Texte in derselben fehlenden Schrift sind ein Befund, nicht zwei
    const gesehen = new Set(row.issues.map((x) => x.key));
    for (const x of row.parts.flatMap((p) => p.issues)) {
      if (gesehen.has(x.key)) continue;
      gesehen.add(x.key);
      row.issues.push(x);
    }
    row.issues.sort((a, b) => LEVEL[a.level] - LEVEL[b.level]);
    if (row.issues.some((x) => x.level === 'error')) sheet.bad++;
    else if (row.issues.length) sheet.warned++;
    sheet.rows.push(row);
  }

  // Ursachen zusammenfassen
  const by = new Map<string, ProofIssue & { count: number }>();
  for (const r of sheet.rows)
    for (const x of r.issues) {
      const hit = by.get(x.key);
      if (hit) hit.count++;
      else by.set(x.key, { ...x, count: 1 });
    }
  sheet.issues = [...by.values()].sort((a, b) => LEVEL[a.level] - LEVEL[b.level] || a.n - b.n);
  return sheet;
}
