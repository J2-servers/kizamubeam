// "Crie seu produto" (Produkt erstellen): the contract between its three parts.
//   ui     — src/criar/page.ts and friends: the separate window (chat, images, 3D, settings, "send to program")
//   llm    — src/criar/llm.ts: one call to any supported AI provider (official HTTP APIs, no SDK)
//   engine — src/criar/engine.ts: the photo -> parts pipeline (port of ai/foto-para-pecas), driving an Editor
// Each part only imports the others through these types and the three entry functions named below.

import type { Editor } from '../editor';

// ---------------------------------------------------------------- llm.ts
export type ProviderId = 'openrouter' | 'anthropic' | 'openai' | 'google';

export interface LlmConfig {
  provider: ProviderId;
  apiKey: string;
  /** Model for the stages that decide geometry (understand, views, spec, scene, final check) */
  model: string;
  /** Cheaper model for the many small per-part reviews; falls back to `model` */
  reviewModel?: string;
  /** Reasoning effort where the provider supports it */
  effort?: 'low' | 'medium' | 'high';
}

export interface LlmImage {
  /** image/png, image/jpeg, image/webp, image/gif */
  mediaType: string;
  base64: string;
}

/** One turn; a turn may carry images and text (images first, as the providers recommend) */
export interface LlmMessage {
  role: 'user' | 'assistant';
  text?: string;
  images?: LlmImage[];
}

export interface LlmRequest {
  /** Pipeline stage, for logs and per-stage token limits (e.g. '1-compreender', 'peca-conferir') */
  stage: string;
  system: string;
  messages: LlmMessage[];
  maxTokens: number;
  /** true for the small per-part reviews: uses reviewModel */
  review?: boolean;
  signal?: AbortSignal;
}

export interface LlmResult {
  text: string;
  model: string;
  usage: { input: number; output: number; usd?: number };
}

/** Thrown for every provider failure, with the provider's OWN message kept literally (never "unknown error") */
export class LlmError extends Error {
  constructor(
    public provider: ProviderId,
    public status: number,
    /** The literal message the provider answered (e.g. "This request requires more credits ...") */
    public providerMessage: string,
    /** 'credits' | 'auth' | 'rate' | 'truncated' | 'network' | 'other' */
    public cause2: 'credits' | 'auth' | 'rate' | 'truncated' | 'network' | 'other',
  ) {
    super(`${provider} ${status}: ${providerMessage}`);
  }
}

/** Entry point of llm.ts */
export type CallLlm = (cfg: LlmConfig, req: LlmRequest) => Promise<LlmResult>;

/** Catalogue shown in the settings of the page (label, default models, where to get a key) */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  keyUrl: string;
  keyPrefix?: string;
  models: { id: string; label: string; vision: boolean }[];
  defaultModel: string;
  defaultReviewModel: string;
}

// ---------------------------------------------------------------- engine.ts
export interface Measure {
  /** x = width, y = depth, z = height */
  axis: 'x' | 'y' | 'z';
  mm: number;
  what: string;
}

export interface CreateRequest {
  images: LlmImage[];
  /** What the user typed: what they want made */
  text: string;
  measures: Measure[];
  thickness: number;
  /** Usable cutting area of the machine, mm [width, height] */
  bed: [number, number];
}

export type EngineEvent =
  | { kind: 'stage'; stage: string; title: string; status: 'start' | 'done' | 'error'; detail?: string }
  /** Text the AI wrote for the user (summary, explanation) */
  | { kind: 'assistant'; stage: string; text: string }
  /** One step of the harness, like a tool call in a log: what ran and what it answered */
  | { kind: 'step'; label: string; detail?: string; ok: boolean }
  /** A decorative part was built: how it was judged (image is a PNG data URL of the part as cut) */
  | { kind: 'part'; id: string; name: string; score: number; source: string; image?: string; accepted: boolean }
  /** The editor's document changed: refresh the 3D view */
  /** axes: where the product's right/back/up ended up in the 3D, so the views look at its front (ViewAxes) */
  | { kind: 'model'; axes?: { x: [number, number, number]; y: [number, number, number]; z: [number, number, number] } }
  | { kind: 'cost'; usd: number; calls: number }
  | { kind: 'result'; ok: boolean; summary: string; warnings: string[]; notVerified: string[] };

export interface Question {
  question: string;
  /** true when the answer changes the size or the number of parts */
  blocks: boolean;
}

export interface EngineHooks {
  onEvent: (e: EngineEvent) => void;
  /** Stop point: show the AI's understanding and its questions; resolves with the user's confirmation and answers.
   *  Resolve { confirmed: false } to cancel. */
  confirm: (summary: string, questions: Question[], assumptions: string[]) => Promise<{ confirmed: boolean; answers: string[] }>;
}

/** Entry point of engine.ts. `editor` is the isolated editor of the creator window (never the main window's). */
export type RunEngine = (editor: Editor, llm: LlmConfig, call: CallLlm, req: CreateRequest, hooks: EngineHooks, signal?: AbortSignal) => Promise<void>;

// ---------------------------------------------------------------- page -> main window
/** Message the creator window sends to the main window on "Enviar para o programa" */
export interface SendToProgram {
  type: 'kizamubeam:criar:send';
  /** Name of the new tab */
  name: string;
  /** editor.serialize() of the creator's document */
  project: string;
}
