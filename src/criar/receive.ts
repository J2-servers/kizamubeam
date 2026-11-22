// Hauptfenster: Teile aus dem Fenster „Produkt erstellen“ immer in einem NEUEN Tab öffnen. Das offene Projekt
// bleibt unberührt; der neue Tab zählt als ungespeichert, damit beim Schließen nachgefragt wird.
import type { Editor } from '../editor';
import { receiveFromCreator } from './bridge';

export function installCreatorReceiver(ed: Editor): void {
  receiveFromCreator((msg) => {
    const doc = ed.parseProject(msg.project);
    const name = msg.name.trim().slice(0, 80) || null;
    const tab = ed.newTab(doc, name);
    tab.saved = '';
    tab.changed = true;
    ed.onTabsChange?.();
    ed.saveNow();
    return ed.tabTitle(tab);
  });
}
