// Protokoll des Verschachtelns im eigenen Thread (src/nestClient.ts), mit einem Worker-Doppelgänger:
// ein Lauf nach dem anderen, Fortschritt, Abbruch, Fehler, und niemals eine Antwort von gestern.
// Aufruf: npm run test:nest-client
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const workers = [];
let constructionError = false;
class WorkerStub {
  constructor(url, options) {
    if (constructionError) throw new Error('Worker blocked');
    assert.ok(String(url.pathname).endsWith('/nest.worker.ts'), `URL falsch: ${url}`);
    assert.equal(options.type, 'module');
    this.messages = [];
    this.terminated = false;
    workers.push(this);
  }
  postMessage(m) {
    if (this.postError) throw new Error('Cannot post');
    this.messages.push(m);
  }
  terminate() {
    this.terminated = true;
  }
  reply(data) {
    this.onmessage({ data });
  }
}
globalThis.Worker = WorkerStub;

const bundle = await build({ entryPoints: ['src/nestClient.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const source = bundle.outputFiles[0].text.replaceAll('import.meta.url', JSON.stringify('file:///src/nestClient.ts'));
const { createNestClient, NestCancelled, workersAvailable } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

let failed = 0;
async function test(name, fn) {
  workers.length = 0;
  constructionError = false;
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${e.stack}`);
  }
}

const parts = [{ key: 0, region: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }]] }];
const sheet = { area: [[{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]], obstacles: [] };
const opt = { gap: 2, margin: 3, rotations: [0], flipX: false, flipY: true, cell: 0.5, newSheets: true, maxSheets: 50, timeLimit: 0 };
const ergebnis = { placed: [{ key: 0, sheet: 0, angle: 0, m: [1, 0, 0, 1, 5, 5] }], unplaced: [], sheets: 1, usage: [0.5] };

await test('In dieser Umgebung gibt es Worker (der Doppelgänger)', () => {
  assert.equal(workersAvailable(), true);
});

await test('Ein Lauf: Anfrage geht hin, Ergebnis kommt zurück', async () => {
  const client = createNestClient();
  const p = client.run(parts, sheet, opt);
  const w = workers.at(-1);
  assert.equal(w.messages.length, 1);
  assert.deepEqual(w.messages[0].parts, parts);
  assert.deepEqual(w.messages[0].sheet, sheet);
  assert.equal(w.messages[0].opt.cell, 0.5);
  w.reply({ id: w.messages[0].id, kind: 'done', result: ergebnis });
  assert.deepEqual(await p, ergebnis);
  assert.equal(w.terminated, true, 'der Worker wird nach dem Ergebnis beendet');
  client.dispose();
});

await test('Fortschritt erreicht den Aufrufer', async () => {
  const client = createNestClient();
  const gesehen = [];
  const p = client.run(parts, sheet, opt, (x) => void gesehen.push(x.done));
  const w = workers.at(-1);
  const { id } = w.messages[0];
  w.reply({ id, kind: 'progress', progress: { done: 0.25, sheets: 1, unplaced: 0 } });
  w.reply({ id, kind: 'progress', progress: { done: 0.75, sheets: 1, unplaced: 0 } });
  w.reply({ id, kind: 'done', result: ergebnis });
  await p;
  assert.deepEqual(gesehen, [0.25, 0.75]);
  client.dispose();
});

await test('false aus onProgress bricht ab: Worker beendet, Versprechen abgelehnt', async () => {
  const client = createNestClient();
  const p = client.run(parts, sheet, opt, () => false);
  const w = workers.at(-1);
  w.reply({ id: w.messages[0].id, kind: 'progress', progress: { done: 0.1, sheets: 1, unplaced: 0 } });
  await assert.rejects(p, (e) => e instanceof NestCancelled);
  assert.equal(w.terminated, true);
  client.dispose();
});

await test('cancel() und dispose() brechen ebenfalls ab', async () => {
  const c1 = createNestClient();
  const p1 = c1.run(parts, sheet, opt);
  c1.cancel();
  await assert.rejects(p1, (e) => e instanceof NestCancelled);
  assert.equal(workers.at(-1).terminated, true);
  const c2 = createNestClient();
  const p2 = c2.run(parts, sheet, opt);
  c2.dispose();
  await assert.rejects(p2, (e) => e instanceof NestCancelled);
  assert.equal(workers.at(-1).terminated, true);
  // Nach dispose() startet kein neuer Lauf mehr
  await assert.rejects(c2.run(parts, sheet, opt), (e) => e instanceof NestCancelled);
});

await test('Ein neuer Lauf ersetzt den alten', async () => {
  const client = createNestClient();
  const alt = client.run(parts, sheet, opt);
  const w1 = workers.at(-1);
  const neu = client.run(parts, sheet, opt);
  const w2 = workers.at(-1);
  assert.notEqual(w1, w2);
  assert.equal(w1.terminated, true, 'der alte Worker stirbt');
  await assert.rejects(alt, (e) => e instanceof NestCancelled);
  assert.ok(w2.messages[0].id > w1.messages[0].id, 'die neue Anfrage hat eine neue Nummer');
  w2.reply({ id: w2.messages[0].id, kind: 'done', result: ergebnis });
  assert.deepEqual(await neu, ergebnis);
  client.dispose();
});

await test('Eine Antwort von gestern wird ignoriert', async () => {
  const client = createNestClient();
  const p = client.run(parts, sheet, opt);
  const w = workers.at(-1);
  const { id } = w.messages[0];
  let abgeschlossen = false;
  void p.then(() => (abgeschlossen = true)).catch(() => (abgeschlossen = true));
  w.reply({ id: id - 1, kind: 'done', result: ergebnis });
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(abgeschlossen, false, 'eine fremde Nummer darf nichts auslösen');
  w.reply({ id, kind: 'done', result: ergebnis });
  assert.deepEqual(await p, ergebnis);
  client.dispose();
});

await test('Fehler aus dem Worker kommen als Fehler an', async () => {
  const client = createNestClient();
  const p = client.run(parts, sheet, opt);
  const w = workers.at(-1);
  w.reply({ id: w.messages[0].id, kind: 'error', error: 'Clipper hat aufgegeben' });
  await assert.rejects(p, (e) => !(e instanceof NestCancelled) && /Clipper hat aufgegeben/.test(e.message));
  assert.equal(w.terminated, true);
  client.dispose();
});

await test('onerror und ein fehlschlagendes postMessage werden gemeldet, nicht verschluckt', async () => {
  const c1 = createNestClient();
  const p1 = c1.run(parts, sheet, opt);
  workers.at(-1).onerror({ message: 'boom', preventDefault() {} });
  await assert.rejects(p1, (e) => /boom/.test(e.message));
  c1.dispose();

  const c2 = createNestClient();
  // Doppelgänger, der beim Senden scheitert
  const vorher = WorkerStub.prototype.postMessage;
  WorkerStub.prototype.postMessage = function () {
    throw new Error('Cannot post');
  };
  const p2 = c2.run(parts, sheet, opt);
  WorkerStub.prototype.postMessage = vorher;
  await assert.rejects(p2, (e) => /Cannot post/.test(e.message));
  assert.equal(workers.at(-1).terminated, true);
  c2.dispose();
});

await test('Lässt sich kein Worker bauen, scheitert der Lauf statt still zu hängen', async () => {
  constructionError = true;
  const client = createNestClient();
  await assert.rejects(client.run(parts, sheet, opt), (e) => /Worker blocked/.test(e.message));
  constructionError = false;
  client.dispose();
});

console.log(failed ? `\n${failed} Test(s) fehlgeschlagen` : '\nalle Tests ok');
process.exit(failed ? 1 : 0);
