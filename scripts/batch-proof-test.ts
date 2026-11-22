// Tests für die Chargenprüfung (jedes Stück einer Serie einzeln prüfen). Aufruf: npm run test:batch-proof
import './core-fixtures-env';
import { strict as assert } from 'node:assert';
const { batchProof, maxOffset, proofSources } = await import('../src/batchproof');
import type { FontKey, GlyphInfo, ProofSheet } from '../src/batchproof';
const { defaultVarText, parseCsv, refs } = await import('../src/vartext');
import type { Obj, TextShape, VarText } from '../src/model';

let failed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

const when = new Date(2026, 10, 22, 9, 30, 0); // 22. November 2026

/** Text mit variablem Text wie im Editor */
const text = (id: number, tpl: string, extra: Partial<TextShape> = {}): Obj =>
  ({
    id,
    layer: 0,
    m: [1, 0, 0, 1, 0, 0],
    shape: { kind: 'text', text: tpl, font: 'Arial', size: 10, bold: false, italic: false, upper: false, align: 'left', hSpace: 0, vSpace: 0, vt: { offset: 0 }, ...extra },
  }) as unknown as Obj;

/** Strichcode mit variablem Text */
const code = (id: number, data: string): Obj =>
  ({ id, layer: 0, m: [1, 0, 0, 1, 0, 0], shape: { kind: 'barcode', type: 'code128', data, size: 40, height: 15, text: true, ec: 'M', vt: { offset: 0 } } }) as unknown as Obj;

/** CSV-Datei wie nach loadCsv (erste Zeile Überschriften) */
function csv(src: string): VarText {
  const rows = parseCsv(src);
  const header = rows.shift() ?? null;
  return { ...defaultVarText(), csv: { name: 'liste.csv', header, rows }, start: 1, end: Math.max(1, rows.length), current: 1 };
}

/** Schrift, die nur die angegebenen Zeichen kennt */
const only = (chars: string, fallback = false) => (_f: FontKey): GlyphInfo => ({ has: (ch) => chars.includes(ch), fallback });
/** Schrift, die alles kennt */
const all = (): GlyphInfo => ({ has: () => true, fallback: false });

const kinds = (s: ProofSheet) => s.issues.map((x) => x.kind).sort();
const rowKinds = (s: ProofSheet, n: number) => s.rows.find((r) => r.n === n)!.issues.map((x) => x.kind);

await test('Platzhalter einer Vorlage auflisten', () => {
  const rs = refs('%{Name} Nr. %4# am %d.%m.%Y %% %2 %Q');
  assert.deepEqual(
    rs.map((r) => [r.code, r.kind]),
    [
      ['%{Name}', 'csv-name'],
      ['%4#', 'serial'],
      ['%d', 'date'],
      ['%m', 'date'],
      ['%Y', 'date'],
      ['%%', 'percent'],
      ['%2', 'csv-index'],
      ['%Q', 'unknown'],
    ],
  );
  assert.equal(rs[0].name, 'Name');
  assert.equal(rs[6].col, 2);
});

await test('Gleiche Vorlage und Schrift werden zu einem Teil zusammengefasst', () => {
  const srcs = proofSources([text(1, '%{Name}'), text(2, '%{Name}'), text(3, '%{Name}', { bold: true }), code(4, '%#'), text(5, 'ohne', { vt: undefined })]);
  assert.equal(srcs.length, 3);
  assert.deepEqual(srcs[0].ids, [1, 2]);
  assert.deepEqual(srcs[1].ids, [3]);
  assert.equal(srcs[2].font, null);
});

await test('Saubere Charge: keine Befunde', () => {
  const vt = csv('Name;Ort\nAnna;Köln\nBruno;Bonn\nCarla;Mainz\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(s.issues, []);
  assert.equal(s.bad, 0);
  assert.equal(s.warned, 0);
  assert.equal(s.rows.length, 3);
  assert.equal(s.rows[1].parts[0].text, 'Bruno');
  assert.equal(s.nothing, false);
});

await test('Leeres Feld ist ein Fehler, mit der Anzahl betroffener Stücke', () => {
  const vt = csv('Name;Ort\nAnna;Köln\n ;Bonn\n;Mainz\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(s), ['empty']);
  assert.equal(s.issues[0].level, 'error');
  assert.equal(s.issues[0].count, 2);
  assert.equal(s.issues[0].n, 2);
  assert.equal(s.bad, 2);
  assert.deepEqual(s.issues[0].ids, [1]);
});

await test('Fehlende Zeile und Spalte, die es nicht gibt', () => {
  const vt = csv('Name;Ort\nAnna;Köln\n');
  const weg = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(weg), ['missing-row']);
  assert.equal(weg.issues[0].count, 2);
  const falsch = batchProof({ objs: [text(1, '%{Nome}')], vt, from: 1, to: 1, glyphs: all, now: when });
  assert.deepEqual(kinds(falsch), ['column']);
  assert.ok(falsch.issues[0].msg.includes('Nome'));
});

await test('Spalten ohne geladene CSV-Datei', () => {
  const s = batchProof({ objs: [text(1, '%0 / %{Name}')], vt: defaultVarText(), from: 1, to: 2, glyphs: all, now: when });
  assert.deepEqual(kinds(s), ['no-csv']);
  assert.equal(s.issues[0].count, 2);
});

await test('Anweisung des Kunden im Namen: Wort und Länge', () => {
  // Semikolon als Trennzeichen, damit Kommas im Feld stehen dürfen
  const vt = csv(
    [
      'Name;Nr',
      'Anna Lima;1',
      'bitte in Kursiv gravieren;2',
      'Bruno Souza;3',
      'o nome correto está no outro arquivo que eu mandei por e-mail ontem;4',
      'Carla Reis;5',
    ].join('\n'),
  );
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 5, glyphs: all, now: when });
  assert.deepEqual(kinds(s), ['instruction']);
  assert.equal(s.issues[0].level, 'warn');
  assert.equal(s.issues[0].count, 2);
  assert.deepEqual(rowKinds(s, 1), []);
  assert.deepEqual(rowKinds(s, 2), ['instruction']);
  assert.deepEqual(rowKinds(s, 4), ['instruction']);
  assert.equal(s.bad, 0);
  assert.equal(s.warned, 2);
});

await test('„Nota“ als ganzes Wort zählt, als Namensteil nicht', () => {
  const vt = csv('Name\nNotarius Felix\nnota: sem nome\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: all, now: when });
  assert.deepEqual(rowKinds(s, 1), []);
  assert.deepEqual(rowKinds(s, 2), ['instruction']);
});

await test('Emoji sind ein Fehler, unsichtbare Zeichen eine Warnung', () => {
  const vt = csv('Name\nAnna \u{1F600}\nBru no\nCar​la\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(s), ['emoji', 'invisible', 'invisible']);
  assert.deepEqual(rowKinds(s, 1), ['emoji']);
  assert.deepEqual(rowKinds(s, 2), ['invisible']);
  assert.ok(s.rows[1].issues[0].msg.includes('U+00A0'));
  assert.ok(s.rows[2].issues[0].msg.includes('U+200B'));
  assert.equal(s.bad, 1);
  assert.equal(s.warned, 2);
});

await test('Zeichen, das in der gewählten Schrift fehlt', () => {
  const vt = csv('Name\nAnna\nBrunö\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: only('AnaBrun') , now: when });
  assert.deepEqual(kinds(s), ['glyph']);
  assert.equal(s.issues[0].level, 'error');
  assert.ok(s.issues[0].msg.includes('ö'));
  assert.ok(s.issues[0].msg.includes('Arial'));
  assert.deepEqual(rowKinds(s, 1), []);
});

await test('Großbuchstaben: geprüft wird, was graviert würde', () => {
  const vt = csv('Name\nanna\n');
  const klein = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 1, glyphs: only('anna'), now: when });
  assert.deepEqual(kinds(klein), []);
  const groß = batchProof({ objs: [text(1, '%{Name}', { upper: true })], vt, from: 1, to: 1, glyphs: only('anna'), now: when });
  assert.deepEqual(kinds(groß), ['glyph']);
  assert.ok(groß.issues[0].msg.includes('A'));
});

await test('Strichcodes werden nicht auf Glyphen geprüft', () => {
  const vt = csv('Code\nABC-ö\n');
  const s = batchProof({ objs: [code(1, '%{Code}')], vt, from: 1, to: 1, glyphs: only('ABC-'), now: when });
  assert.deepEqual(kinds(s), []);
});

await test('Fehlende Schrift wird einmal je Schrift gemeldet', () => {
  const vt = csv('Name\nAnna\nBruno\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: only('AnnaBruo', true), now: when });
  assert.deepEqual(kinds(s), ['font']);
  assert.equal(s.issues[0].count, 2);
  assert.equal(s.issues[0].level, 'warn');
});

await test('Zweimal derselbe Inhalt', () => {
  const vt = csv('Name\nAnna\nBruno\nAnna\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(s), ['duplicate']);
  assert.equal(s.issues[0].msg.includes('1'), true);
  assert.deepEqual(rowKinds(s, 3), ['duplicate']);
  // Mit Seriennummer im Text ist jedes Stück verschieden
  const mitNummer = batchProof({ objs: [text(1, '%{Name} %#')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(mitNummer), []);
});

await test('Ohne Nummer im Text gibt es keine Doppelmeldung (nur Datum)', () => {
  const s = batchProof({ objs: [text(1, 'Serie %Y')], vt: defaultVarText(), from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(s), []);
  assert.equal(s.rows[0].parts[0].text, 'Serie 2026');
});

await test('Mehrere Vorlagen in einem Stück: Nummer und Name', () => {
  const vt = csv('Name;Ort\nAnna;Köln\n;Bonn\n');
  const s = batchProof({ objs: [text(1, '%{Name}'), text(2, 'Nr. %4#')], vt, from: 1, to: 2, glyphs: all, now: when });
  assert.equal(s.rows[0].parts.length, 2);
  assert.equal(s.rows[0].parts[1].text, 'Nr. 0001');
  assert.deepEqual(kinds(s), ['empty']);
  assert.deepEqual(s.issues[0].ids, [1]);
});

await test('Dieselbe Ursache steht im Stück nur einmal', () => {
  // Zwei Texte in derselben fehlenden Schrift: ein Befund, nicht zwei (im Fenster gesehen, 22.11.2026)
  const vt = csv('Name;Nr\nAnna;1\n');
  const schrift = (): GlyphInfo => ({ has: () => true, fallback: true, family: 'Roboto' });
  const s = batchProof({ objs: [text(1, '%{Name}'), text(2, 'Nr. %{Nr}')], vt, from: 1, to: 1, glyphs: schrift, now: when });
  assert.equal(s.rows[0].parts.length, 2);
  assert.deepEqual(rowKinds(s, 1), ['font']);
});

await test('Gemeldet wird die Schrift, die wirklich graviert würde', () => {
  const vt = csv('Name\nBrunö\n');
  const ersatz = (): GlyphInfo => ({ has: (ch) => 'Brun'.includes(ch), fallback: true, family: 'Roboto' });
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 1, glyphs: ersatz, now: when });
  const glyph = s.issues.find((x) => x.kind === 'glyph')!;
  assert.ok(glyph.msg.includes('Roboto'), glyph.msg);
  assert.ok(!glyph.msg.includes('Arial'), glyph.msg);
});

await test('Bildzeichen der Grundebene: nur ohne Umriss ein Befund, und dann als Emoji', () => {
  const vt = csv('Name\nAnna ✅\nBruno ❤\n');
  // Schrift ohne diese Zeichen: Das ist ein Emoji-Befund, keine Meldung über eine fehlende Glyphe
  const ohne = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: only('AnnaBruo '), now: when });
  assert.deepEqual(kinds(ohne), ['emoji', 'emoji']);
  assert.ok(ohne.rows[0].issues[0].msg.includes('✅'), ohne.rows[0].issues[0].msg);
  // Schrift MIT dem Zeichen: Der Umriss wird sauber graviert, da gibt es nichts zu melden
  const mit = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: only('AnnaBruo ✅❤'), now: when });
  assert.deepEqual(kinds(mit), []);
});

await test('Doppelter Inhalt wird auch gemeldet, wenn das Stück noch einen anderen Fehler hat', () => {
  const vt = csv('Name\nAnna \u{1F600}\nBruno\nAnna \u{1F600}\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(rowKinds(s, 3).sort(), ['duplicate', 'emoji']);
  // Nicht eingesetzte Felder bleiben die Ausnahme: ohne CSV-Datei ist „doppelt“ nur die Folge des Fehlers
  const ohneCsv = batchProof({ objs: [text(1, '%{Name}')], vt: defaultVarText(), from: 1, to: 3, glyphs: all, now: when });
  assert.deepEqual(kinds(ohneCsv), ['no-csv']);
});

await test('Spaltennummer außerhalb der Tabelle: die Spalte fehlt, nicht das Feld', () => {
  const vt = csv('Name;Ort\nAnna;Köln\nBruno;Bonn\n');
  const s = batchProof({ objs: [text(1, '%5')], vt, from: 1, to: 2, glyphs: all, now: when });
  assert.deepEqual(kinds(s), ['column']);
  assert.equal(s.issues[0].count, 2);
  assert.ok(!s.issues.some((x) => x.kind === 'empty'));
});

await test('Projekt-Parameter werden wie beim Lasern eingesetzt', () => {
  const vt = csv('Name\nAnna\n');
  const s = batchProof({ objs: [text(1, '{{Kunde}}-%{Name}')], vt, from: 1, to: 1, glyphs: all, now: when });
  assert.equal(s.rows[0].parts[0].text, '{Kunde}-Anna');
});

await test('Anweisung: „n/a“ ja, mitten im Namen nein', () => {
  const vt = csv('Name\nSean/Ana Silva\nn/a\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: all, now: when });
  assert.deepEqual(rowKinds(s, 1), []);
  assert.deepEqual(rowKinds(s, 2), ['instruction']);
});

await test('Strichcode und QR mit derselben Vorlage sind zwei Teile', () => {
  const qr = { ...(code(2, '%#') as unknown as { shape: Record<string, unknown> }).shape, type: 'qr' };
  const obj = { id: 2, layer: 0, m: [1, 0, 0, 1, 0, 0], shape: qr } as unknown as Obj;
  const srcs = proofSources([code(1, '%#'), obj]);
  assert.equal(srcs.length, 2);
});

await test('Nummer 0 und eine Höchstzahl von 0 kippen die Prüfung nicht', () => {
  const s = batchProof({ objs: [text(1, '%#')], vt: defaultVarText(), from: 0, to: 3, glyphs: all, now: when });
  assert.equal(s.from, 1);
  assert.equal(s.rows[0].n, 1);
  const eine = batchProof({ objs: [text(1, '%#')], vt: defaultVarText(), from: 1, to: 9, glyphs: all, settings: { maxRows: 0 }, now: when });
  assert.equal(eine.rows.length, 1);
  assert.equal(eine.truncated, true);
});

await test('Höchster Versatz: so viele Nummern verbraucht ein Job', () => {
  assert.equal(maxOffset([]), 0);
  assert.equal(maxOffset([text(1, '%#'), text(2, '%#', { vt: { offset: 5 } }), code(3, '%#')]), 5);
});

await test('Lange Serien werden gekürzt', () => {
  const s = batchProof({ objs: [text(1, '%#')], vt: { ...defaultVarText(), end: 500 }, from: 1, to: 500, glyphs: all, settings: { maxRows: 10 }, now: when });
  assert.equal(s.rows.length, 10);
  assert.equal(s.truncated, true);
  assert.equal(s.to, 10);
});

await test('Ohne variablen Text gibt es nichts zu prüfen', () => {
  const s = batchProof({ objs: [], vt: defaultVarText(), from: 1, to: 9, glyphs: all, now: when });
  assert.equal(s.nothing, true);
  assert.deepEqual(s.rows, []);
  assert.deepEqual(s.issues, []);
});

await test('Ohne Schrift-Auskunft wird nicht auf Glyphen geprüft', () => {
  const vt = csv('Name\nBrunö\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 1, now: when });
  assert.deepEqual(kinds(s), []);
});

await test('Fehler stehen vor Warnungen', () => {
  const vt = csv('Name\nAnna \n\n');
  const s = batchProof({ objs: [text(1, '%{Name}')], vt, from: 1, to: 2, glyphs: all, now: when });
  assert.deepEqual(
    s.issues.map((x) => x.level),
    ['error', 'warn'],
  );
});

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nalle Tests ok');
process.exit(failed ? 1 : 0);
