// Der Thread, in dem verschachtelt wird. Nur Geometrie: nest.ts kennt weder DOM noch Editor noch i18n,
// deshalb braucht dieser Worker — anders als slotPreview.worker.ts — keine Ersatz-Objekte für die Umgebung.
// Nachrichtenformat und Fehlerbehandlung stehen in nestClient.ts.
import type { NestReply, NestRequest } from './nestClient';

/** Fortschritt höchstens zehnmal je Sekunde: Mehr sieht niemand, und jede Nachricht kostet eine Kopie. */
const PROGRESS_MS = 100;

globalThis.onmessage = async (event: MessageEvent<NestRequest>) => {
  const { id, parts, sheet, opt } = event.data;
  const post = (reply: NestReply) => (globalThis as unknown as { postMessage: (m: NestReply) => void }).postMessage(reply);
  try {
    // Erst hier laden: So stürzt der Worker nicht schon beim Start ab, wenn etwas am Modul klemmt,
    // sondern meldet den Fehler als Antwort auf die Anfrage.
    const { nestSteps } = await import('./nest');
    const steps = nestSteps(parts, sheet, opt);
    let last = 0;
    for (;;) {
      const it = steps.next();
      if (it.done) {
        post({ id, kind: 'done', result: it.value });
        return;
      }
      const now = Date.now();
      if (now - last >= PROGRESS_MS) {
        last = now;
        post({ id, kind: 'progress', progress: it.value });
      }
    }
  } catch (e) {
    post({ id, kind: 'error', error: e instanceof Error ? e.message : String(e) });
  }
};
