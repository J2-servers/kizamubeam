// Fenster „Produkt erstellen“ ↔ Hauptfenster. In der App ein Tauri-Ereignis an das Fenster „main“ (das Fenster
// „criar“ darf nur das, capabilities/criar.json), im Browser (npm run dev) ein BroadcastChannel derselben Seite.
// Kleines Modul ohne Editor: das Hauptfenster lädt es beim Start (src/app.ts), die Seite criar beim Senden.
import { hasNative, native } from '../native';
import type { SendToProgram } from './contract';

export const SEND_EVENT = 'kizamubeam:criar:send';
/** Antwort des Hauptfensters: Tab geöffnet (ok) oder die Fehlermeldung */
export const ACK_EVENT = 'kizamubeam:criar:ack';
const CHANNEL = 'kizamubeam-criar';

export interface SendAck {
  type: typeof ACK_EVENT;
  ok: boolean;
  /** Name des neuen Tabs oder die Fehlermeldung */
  text: string;
}

export const isSendMessage = (m: unknown): m is SendToProgram =>
  !!m && typeof m === 'object' && (m as SendToProgram).type === SEND_EVENT && typeof (m as SendToProgram).project === 'string' && typeof (m as SendToProgram).name === 'string';

/** Fenster „Produkt erstellen“ öffnen oder nach vorn holen */
export async function openCreatorWindow(): Promise<void> {
  if (hasNative()) {
    await native('open_criar_window');
    return;
  }
  const w = window.open('/criar.html', 'kizamubeam-criar');
  w?.focus();
}

/** Hauptfenster: Teile aus dem Fenster „Produkt erstellen“ annehmen. open() öffnet sie und gibt den Tab-Namen zurück. */
export function receiveFromCreator(open: (msg: SendToProgram) => string): void {
  const handle = (m: unknown): SendAck | null => {
    if (!isSendMessage(m)) return null;
    try {
      return { type: ACK_EVENT, ok: true, text: open(m) };
    } catch (e) {
      return { type: ACK_EVENT, ok: false, text: e instanceof Error ? e.message : String(e) };
    }
  };
  if (hasNative()) {
    void import('@tauri-apps/api/event').then(({ listen, emitTo }) =>
      listen<SendToProgram>(SEND_EVENT, (e) => {
        const ack = handle(e.payload);
        if (!ack) return;
        void native('focus_main_window').catch(() => {});
        void emitTo('criar', ACK_EVENT, ack);
      }),
    );
    return;
  }
  if (typeof BroadcastChannel === 'undefined') return;
  const ch = new BroadcastChannel(CHANNEL);
  ch.onmessage = (e) => {
    const ack = handle(e.data);
    if (!ack) return;
    window.focus();
    ch.postMessage(ack);
  };
}

/** Fenster „Produkt erstellen“: Teile senden und auf die Antwort des Hauptfensters warten */
export async function sendToMain(msg: SendToProgram, waitMs = 8000): Promise<SendAck> {
  const noAnswer: SendAck = { type: ACK_EVENT, ok: false, text: '' };
  if (hasNative()) {
    const { listen, emitTo } = await import('@tauri-apps/api/event');
    let done: (a: SendAck) => void = () => {};
    const answer = new Promise<SendAck>((res) => (done = res));
    const un = await listen<SendAck>(ACK_EVENT, (e) => done(e.payload));
    const timer = window.setTimeout(() => done(noAnswer), waitMs);
    try {
      await emitTo('main', SEND_EVENT, msg);
      return await answer;
    } finally {
      window.clearTimeout(timer);
      un();
    }
  }
  if (typeof BroadcastChannel === 'undefined') return noAnswer;
  const ch = new BroadcastChannel(CHANNEL);
  try {
    return await new Promise<SendAck>((res) => {
      const timer = window.setTimeout(() => res(noAnswer), waitMs);
      ch.onmessage = (e) => {
        const a = e.data as SendAck;
        if (a && a.type === ACK_EVENT) {
          window.clearTimeout(timer);
          res(a);
        }
      };
      ch.postMessage(msg);
    });
  } finally {
    ch.close();
  }
}
