// What the ported harness needs from the app: the agent tools of src/agentedit.ts run straight against the editor
// (in place of p.tool over CDP), the log of steps, "the document changed" and cancelling.
/* eslint-disable @typescript-eslint/no-explicit-any */
import type { Editor } from '../../editor';
import { EDIT_TOOLS } from '../../agentedit';
import { Tier } from '../../agentutil';

export type Rec = Record<string, any>;

export interface Kit {
  ed: Editor;
  /** One agent tool (src/agentedit.ts), like the agent bridge runs it: one undo step, no questions to the user */
  tool: (name: string, args?: Rec) => Promise<any>;
  /** One line of the harness log */
  step: (label: string, detail?: string, ok?: boolean) => void;
  /** The document changed: the window redraws the 3D view */
  changed: () => void;
  /** Throws when the run was cancelled */
  check: () => void;
  signal?: AbortSignal;
}

export function cancelled(signal?: AbortSignal) {
  return signal?.aborted ? new DOMException('cancelado pelo usuario', 'AbortError') : null;
}

export function makeKit(ed: Editor, step: Kit['step'], changed: Kit['changed'], signal?: AbortSignal): Kit {
  const check = () => {
    const e = cancelled(signal);
    if (e) throw e;
  };
  const tool = async (name: string, args: Rec = {}) => {
    check();
    const def = EDIT_TOOLS.find((d) => d.name === name);
    if (!def) throw Error(`ferramenta desconhecida: ${name}`);
    // the arguments go through JSON, as over CDP in the harness (keys with undefined disappear)
    const a = JSON.parse(JSON.stringify(args ?? {}));
    ed.hint = '';
    ed.agentCall = true;
    try {
      return def.tier !== Tier.Edit || def.ownUndo ? await def.run(ed, a) : await ed.batch(() => def.run(ed, a), `Crie seu produto: ${name}`);
    } finally {
      ed.agentCall = false;
    }
  };
  return { ed, tool, step, changed, check, signal };
}

/** The first JSON object of a text (the AI sometimes writes text around it) — port of extrairJson of ia.mjs */
export function extrairJson(texto: string): any {
  const s = texto.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw Error('a resposta nao tem JSON');
  return JSON.parse(s.slice(a, b + 1));
}

export const contexto = (obj: unknown) => '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
