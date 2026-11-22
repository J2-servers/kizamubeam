// Verschachteln in einem eigenen Thread. Die Suche läuft zwischen zwei yields bis zu einer halben Sekunde
// am Stück (gemessen 22.11.2026: 488 ms bei 200 Teilen) — im Haupt-Thread friert die Oberfläche darüber ein.
// Hier geht nur fertiges Datenmaterial hin und zurück: Punkte, Zahlen, Wahrheitswerte. Kein DOM, kein Editor.
//
// Ein Lauf nach dem anderen: Ein neuer Lauf beendet den alten (der Dialog lässt ohnehin nur einen zu).
import type { NestOptions, NestPart, NestProgress, NestResult, NestSheet } from './nest';

export interface NestRequest {
  id: number;
  parts: NestPart[];
  sheet: NestSheet;
  opt: NestOptions;
}

export type NestReply =
  | { id: number; kind: 'progress'; progress: NestProgress }
  | { id: number; kind: 'done'; result: NestResult }
  | { id: number; kind: 'error'; error: string };

export interface NestClient {
  /** Rechnet im Worker. Gibt null zurück, wenn onProgress false liefert (Abbruch) oder dispose kam. */
  run(parts: NestPart[], sheet: NestSheet, opt: NestOptions, onProgress?: (p: NestProgress) => boolean | void): Promise<NestResult>;
  /** Laufenden Lauf abbrechen; das Versprechen aus run() wird abgelehnt. */
  cancel(): void;
  dispose(): void;
}

/** Gibt es in dieser Umgebung überhaupt Worker? (In den Tests und im Plugin-Worker nicht.) */
export const workersAvailable = (): boolean => typeof Worker !== 'undefined';

/** Abbruch durch den Benutzer oder durch dispose(); kein Fehler, den man melden müsste. */
export class NestCancelled extends Error {
  constructor() {
    super('nest cancelled');
    this.name = 'NestCancelled';
  }
}

export function createNestClient(): NestClient {
  let worker: Worker | undefined;
  let latest = 0;
  let pending: { id: number; resolve: (r: NestResult) => void; reject: (e: Error) => void; onProgress?: (p: NestProgress) => boolean | void } | undefined;
  let disposed = false;

  const stop = () => {
    worker?.terminate();
    worker = undefined;
  };
  const finish = (err?: Error, result?: NestResult) => {
    const p = pending;
    pending = undefined;
    if (!p) return;
    if (err) p.reject(err);
    else p.resolve(result!);
  };

  return {
    run(parts, sheet, opt, onProgress) {
      if (disposed) return Promise.reject(new NestCancelled());
      // Ein neuer Lauf ersetzt den alten: Der alte Worker stirbt, sein Versprechen wird abgelehnt.
      stop();
      finish(new NestCancelled());
      const id = ++latest;
      return new Promise<NestResult>((resolve, reject) => {
        pending = { id, resolve, reject, onProgress };
        try {
          worker = new Worker(new URL('./nest.worker.ts', import.meta.url), { type: 'module' });
        } catch (e) {
          pending = undefined;
          reject(e instanceof Error ? e : new Error(String(e)));
          return;
        }
        worker.onmessage = (event: MessageEvent<NestReply>) => {
          const msg = event.data;
          if (disposed || !pending || msg.id !== pending.id) return;
          if (msg.kind === 'progress') {
            if (pending.onProgress?.(msg.progress) === false) {
              stop();
              finish(new NestCancelled());
            }
            return;
          }
          stop();
          if (msg.kind === 'error') finish(new Error(msg.error));
          else finish(undefined, msg.result);
        };
        worker.onerror = (event: ErrorEvent) => {
          event.preventDefault?.();
          stop();
          finish(new Error(event.message || 'nest worker failed'));
        };
        worker.onmessageerror = () => {
          stop();
          finish(new Error('nest worker message could not be decoded'));
        };
        const req: NestRequest = { id, parts, sheet, opt };
        try {
          worker.postMessage(req);
        } catch (e) {
          stop();
          finish(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    cancel() {
      stop();
      finish(new NestCancelled());
    },
    dispose() {
      disposed = true;
      stop();
      finish(new NestCancelled());
    },
  };
}
