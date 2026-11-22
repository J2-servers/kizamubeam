// "Crie seu produto": one call to any supported AI provider, through its official HTTP API (plain fetch, no SDK).
//
// Providers and the documentation each request shape follows:
//   openrouter  POST https://openrouter.ai/api/v1/chat/completions            https://openrouter.ai/docs/api/reference/overview
//   anthropic   POST https://api.anthropic.com/v1/messages (SSE stream)        https://platform.claude.com/docs/en/api/messages
//   openai      POST https://api.openai.com/v1/responses                       https://developers.openai.com/api/docs/guides/images-vision
//   google      POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
//                                                                              https://aistudio.google.com/api-reference/generate-content/generate-content.md
//
// Rules of this module:
//  - every provider failure becomes an LlmError that keeps the provider's OWN sentence (providerMessage);
//  - no limits of our own: no attempt counters, no growing waits, no request queue. Only when the provider answers
//    429 and says how long to wait (retry-after header, or Gemini's RetryInfo) do we wait that long and try ONE more time;
//  - the AbortSignal is passed to fetch and to that one wait; an abort rejects with the AbortError itself.
//
// The WebView fetches these hosts directly, so they must be in connect-src of src-tauri/tauri.conf.json:
//   https://openrouter.ai https://api.anthropic.com https://api.openai.com https://generativelanguage.googleapis.com

import { LlmError, type CallLlm, type LlmConfig, type LlmImage, type LlmMessage, type LlmRequest, type LlmResult, type ProviderId, type ProviderInfo } from './contract';

// ---------------------------------------------------------------- catalogue

/** US$ per million tokens. `from` (YYYY-MM-DD) = the date this price starts; `longAbove` = input tokens above which the long-context price applies */
export interface Price {
  input: number;
  output: number;
  from?: string;
  longAbove?: number;
  longInput?: number;
  longOutput?: number;
}

export interface CatalogModel {
  id: string;
  label: string;
  vision: boolean;
  /** Official list prices (checked on the provider's pricing page on 2026-11-19); absent = we do not compute a cost */
  prices?: Price[];
}

/** ProviderInfo of the contract, with the price table of each model */
export interface ProviderCatalog extends ProviderInfo {
  models: CatalogModel[];
}

export const PROVIDERS: ProviderCatalog[] = [
  {
    // https://openrouter.ai/api/v1/models (ids and image input checked 2026-11-19). The cost comes back in usage.cost.
    id: 'openrouter',
    label: 'OpenRouter',
    keyUrl: 'https://openrouter.ai/settings/keys',
    keyPrefix: 'sk-or-',
    models: [
      { id: 'anthropic/claude-fable-5.2', label: 'Claude Fable 5.2', vision: true },
      { id: 'anthropic/claude-opus-5.5', label: 'Claude Opus 5.5', vision: true },
      { id: 'anthropic/claude-sonnet-5.5', label: 'Claude Sonnet 5.5', vision: true },
      { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', vision: true },
      { id: 'openai/gpt-6.2-astra', label: 'GPT-6.2 Astra', vision: true },
      { id: 'openai/gpt-6.2-sol', label: 'GPT-6.2 Sol', vision: true },
      { id: 'google/gemini-4-carbon', label: 'Gemini 4 Carbon', vision: true },
      { id: 'google/gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', vision: true },
    ],
    defaultModel: 'anthropic/claude-fable-5.2',
    defaultReviewModel: 'anthropic/claude-sonnet-5.5',
  },
  {
    // Model ids and prices: Claude API model table (platform.claude.com/docs/en/about-claude/models, pricing page)
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    keyUrl: 'https://platform.claude.com/settings/keys',
    keyPrefix: 'sk-ant-',
    models: [
      { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', vision: true, prices: [{ input: 8, output: 40 }] },
      { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', vision: true, prices: [{ input: 4, output: 20 }] },
      { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', vision: true, prices: [{ input: 2, output: 10 }] },
      { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', vision: true, prices: [{ input: 0.1, output: 0.5, longAbove: 100_000, longInput: 0.5, longOutput: 2.5 }] },
    ],
    defaultModel: 'claude-fable-5-2',
    defaultReviewModel: 'claude-sonnet-5-5',
  },
  {
    // https://developers.openai.com/api/docs/models and /api/docs/pricing (standard tier; long context above 272K input tokens)
    id: 'openai',
    label: 'OpenAI',
    keyUrl: 'https://platform.openai.com/api-keys',
    keyPrefix: 'sk-',
    models: [
      { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', vision: true, prices: [{ input: 8, output: 40, longAbove: 272_000, longInput: 16, longOutput: 60 }] },
      { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', vision: true, prices: [{ input: 2, output: 10, longAbove: 272_000, longInput: 4, longOutput: 15 }] },
      { id: 'gpt-6.1-terra', label: 'GPT-6.1 Terra', vision: true, prices: [{ input: 1, output: 5, longAbove: 272_000, longInput: 2, longOutput: 7.5 }] },
      { id: 'gpt-6-luna', label: 'GPT-6 Luna', vision: true, prices: [{ input: 0.1, output: 0.5, longAbove: 272_000, longInput: 0.2, longOutput: 0.75 }] },
    ],
    defaultModel: 'gpt-6.2-astra',
    defaultReviewModel: 'gpt-6.2-sol',
  },
  {
    // https://aistudio.google.com/docs/models and /docs/pricing (paid tier; output price includes thinking tokens)
    id: 'google',
    label: 'Google (Gemini)',
    keyUrl: 'https://aistudio.google.com/apikey',
    keyPrefix: 'AIza',
    models: [
      { id: 'gemini-4-carbon', label: 'Gemini 4 Carbon', vision: true, prices: [{ input: 2, output: 10 }, { from: '2026-12-01', input: 4, output: 20 }] },
      { id: 'gemini-4-neon', label: 'Gemini 4 Neon', vision: true, prices: [{ input: 3, output: 15 }] },
      { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen', vision: true, prices: [{ input: 1.5, output: 7.5 }] },
      { id: 'gemini-4-argon', label: 'Gemini 4 Argon', vision: true, prices: [{ input: 2, output: 10 }, { from: '2026-12-01', input: 4, output: 20 }] },
      { id: 'gemini-3.8-flash', label: 'Gemini 3.8 Flash', vision: true, prices: [{ input: 0.75, output: 3.75 }, { from: '2027-01-01', input: 1.5, output: 7.5 }] },
    ],
    defaultModel: 'gemini-4-carbon',
    defaultReviewModel: 'gemini-4-hydrogen',
  },
];

/** Cost in US$ from the catalogue price of `model`, or undefined when we have no official price for it */
export function priceUsd(provider: ProviderId, model: string, input: number, output: number, now = new Date()): number | undefined {
  const m = PROVIDERS.find((p) => p.id === provider)?.models.find((x) => x.id === model);
  if (!m?.prices?.length) return undefined;
  const today = now.toISOString().slice(0, 10);
  const valid = m.prices.filter((p) => !p.from || p.from <= today);
  const p = valid[valid.length - 1];
  if (!p) return undefined;
  const long = p.longAbove !== undefined && input > p.longAbove;
  const pin = long ? p.longInput ?? p.input : p.input;
  const pout = long ? p.longOutput ?? p.output : p.output;
  return (input * pin + output * pout) / 1e6;
}

// ---------------------------------------------------------------- errors

type Cause = LlmError['cause2'];

/** LlmError that also carries the wait the provider asked for on a 429 (seconds) */
class RateLimited extends LlmError {
  constructor(provider: ProviderId, status: number, message: string, public retryAfter?: number) {
    super(provider, status, message, 'rate');
  }
}

const CREDITS_RE = /insufficient_quota|credit_balance|credit balance|insufficient credits|more credits|requires more credits|billing_error|payment_required|prepay/i;
const BAD_KEY_RE = /API_KEY_INVALID|API key not valid|invalid api key|invalid x-api-key|incorrect api key/i;

export function classify(status: number, text: string): Cause {
  if (status === 402 || CREDITS_RE.test(text)) return 'credits';
  if (status === 401 || status === 403 || BAD_KEY_RE.test(text)) return 'auth';
  if (status === 429) return 'rate';
  return 'other';
}

/** The provider's own sentence out of an error body (JSON or not); `extra` = machine codes used only to classify */
function errorText(body: string, statusText: string, status: number): { message: string; extra: string; retryDelay?: number } {
  let j: any;
  try {
    j = JSON.parse(body);
  } catch {
    const raw = body.trim();
    return { message: raw ? raw.slice(0, 2000) : `HTTP ${status}${statusText ? ' ' + statusText : ''}`, extra: '' };
  }
  const e = Array.isArray(j) ? j[0]?.error : j?.error ?? j;
  let message = typeof e === 'string' ? e : typeof e?.message === 'string' ? e.message : JSON.stringify(j).slice(0, 2000);
  // OpenRouter: the upstream provider's own sentence is in metadata.raw
  const raw = e?.metadata?.raw;
  if (raw !== undefined && raw !== null && raw !== '') message += ` | ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
  const extra = [e?.type, e?.code, e?.status, JSON.stringify(e?.details ?? '')].filter((x) => x !== undefined).join(' ');
  // Gemini: RetryInfo {retryDelay: "13s"} inside error.details
  let retryDelay: number | undefined;
  for (const d of Array.isArray(e?.details) ? e.details : []) {
    const m = typeof d?.retryDelay === 'string' ? /^([\d.]+)s$/.exec(d.retryDelay) : null;
    if (m) retryDelay = Number(m[1]);
  }
  return { message, extra, retryDelay };
}

function retryAfterHeader(r: Response): number | undefined {
  const ms = r.headers.get('retry-after-ms');
  if (ms && Number.isFinite(Number(ms))) return Number(ms) / 1000;
  const v = r.headers.get('retry-after');
  if (!v) return undefined;
  if (Number.isFinite(Number(v))) return Number(v);
  const t = Date.parse(v);
  return Number.isFinite(t) ? Math.max(0, (t - Date.now()) / 1000) : undefined;
}

/** Turns a non-2xx response into the LlmError with the provider's literal message */
async function httpError(provider: ProviderId, r: Response): Promise<LlmError> {
  const body = await r.text();
  const { message, extra, retryDelay } = errorText(body, r.statusText, r.status);
  const cause = classify(r.status, `${message} ${extra}`);
  if (cause === 'rate') return new RateLimited(provider, r.status, message, retryAfterHeader(r) ?? retryDelay);
  return new LlmError(provider, r.status, message, cause);
}

function isAbort(e: unknown, signal?: AbortSignal): boolean {
  return !!signal?.aborted || (e instanceof Error && e.name === 'AbortError');
}

async function post(provider: ProviderId, url: string, headers: Record<string, string>, body: unknown, signal?: AbortSignal): Promise<Response> {
  try {
    return await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal });
  } catch (e) {
    if (isAbort(e, signal)) throw e;
    const err = e as Error & { cause?: { message?: string; code?: string } };
    const detail = err.cause?.message ?? err.cause?.code;
    throw new LlmError(provider, 0, detail ? `${err.message}: ${detail}` : String(err?.message ?? e), 'network');
  }
}

async function readText(provider: ProviderId, r: Response, signal?: AbortSignal): Promise<string> {
  try {
    return await r.text();
  } catch (e) {
    if (isAbort(e, signal)) throw e;
    throw new LlmError(provider, r.status, String((e as Error)?.message ?? e), 'network');
  }
}

function parseJson(provider: ProviderId, status: number, body: string): any {
  try {
    return JSON.parse(body);
  } catch {
    throw new LlmError(provider, status, body.trim().slice(0, 2000) || `HTTP ${status} (empty body)`, 'other');
  }
}

function wait(seconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((ok, fail) => {
    if (signal?.aborted) return fail(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      ok();
    }, seconds * 1000);
    const onAbort = () => {
      clearTimeout(t);
      fail(signal!.reason ?? new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// ---------------------------------------------------------------- per provider

type Send = (model: string, cfg: LlmConfig, req: LlmRequest) => Promise<LlmResult>;

const dataUrl = (i: LlmImage) => `data:${i.mediaType};base64,${i.base64}`;
const hasText = (m: LlmMessage) => typeof m.text === 'string' && m.text.length > 0;

// OpenRouter: OpenAI-style chat completions; usage.cost is the price OpenRouter charged (US$ credits)
const openrouter: Send = async (model, cfg, req) => {
  const messages = [
    { role: 'system', content: req.system },
    ...req.messages.map((m) =>
      m.role === 'assistant'
        ? { role: 'assistant', content: m.text ?? '' }
        : {
            role: 'user',
            content: [
              ...(m.images ?? []).map((i) => ({ type: 'image_url', image_url: { url: dataUrl(i) } })),
              ...(hasText(m) ? [{ type: 'text', text: m.text }] : []),
            ],
          },
    ),
  ];
  const body: Record<string, unknown> = { model, messages, max_tokens: req.maxTokens, usage: { include: true } };
  if (cfg.effort) body.reasoning = { effort: cfg.effort };
  const r = await post('openrouter', 'https://openrouter.ai/api/v1/chat/completions', { authorization: `Bearer ${cfg.apiKey}`, 'x-title': 'KizamuBeam' }, body, req.signal);
  if (!r.ok) throw await httpError('openrouter', r);
  const text = await readText('openrouter', r, req.signal);
  const j = parseJson('openrouter', r.status, text);
  // A failure after the provider accepted the request comes as 200 with only an `error` object
  if (j.error) {
    const { message, extra } = errorText(JSON.stringify(j), '', r.status);
    const status = typeof j.error.code === 'number' ? j.error.code : r.status;
    const cause = classify(status, `${message} ${extra}`);
    throw cause === 'rate' ? new RateLimited('openrouter', status, message, retryAfterHeader(r)) : new LlmError('openrouter', status, message, cause);
  }
  const c = j.choices?.[0];
  if (!c) throw new LlmError('openrouter', r.status, `no choices in the answer: ${text.slice(0, 2000)}`, 'other');
  if (c.finish_reason === 'length') throw new LlmError('openrouter', r.status, `finish_reason: length (native_finish_reason: ${c.native_finish_reason ?? '-'})`, 'truncated');
  if (c.finish_reason === 'error' || c.error) {
    const msg = c.error?.message ?? `finish_reason: error (native_finish_reason: ${c.native_finish_reason ?? '-'})`;
    throw new LlmError('openrouter', typeof c.error?.code === 'number' ? c.error.code : r.status, msg, classify(c.error?.code ?? 0, msg));
  }
  if (c.finish_reason === 'content_filter') throw new LlmError('openrouter', r.status, `finish_reason: content_filter (native_finish_reason: ${c.native_finish_reason ?? '-'})`, 'other');
  const content = c.message?.content;
  const out = typeof content === 'string' ? content : Array.isArray(content) ? content.map((b: any) => b?.text ?? '').join('') : '';
  const cost = j.usage?.cost;
  return {
    text: out,
    model: j.model ?? model,
    usage: { input: j.usage?.prompt_tokens ?? 0, output: j.usage?.completion_tokens ?? 0, usd: typeof cost === 'number' ? cost : undefined },
  };
};

// Anthropic Messages API, streamed (long, high-effort answers would otherwise risk an idle-connection drop)
const ANTHROPIC_STATUS: Record<string, number> = {
  invalid_request_error: 400, authentication_error: 401, billing_error: 402, permission_error: 403, not_found_error: 404,
  request_too_large: 413, rate_limit_error: 429, api_error: 500, overloaded_error: 529,
};
/** Models that take the server-side refusal fallback (beta server-side-fallback-2026-07-01, fallbacks: "default") */
const ANTHROPIC_FALLBACK = new Set(['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5']);

const anthropic: Send = async (model, cfg, req) => {
  const messages = req.messages.map((m) =>
    m.role === 'assistant'
      ? { role: 'assistant', content: m.text ?? '' }
      : {
          role: 'user',
          content: [
            ...(m.images ?? []).map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mediaType, data: i.base64 } })),
            ...(hasText(m) ? [{ type: 'text', text: m.text }] : []),
          ],
        },
  );
  const body: Record<string, unknown> = { model, max_tokens: req.maxTokens, system: req.system, messages, thinking: { type: 'adaptive' }, stream: true };
  if (cfg.effort) body.output_config = { effort: cfg.effort };
  const headers: Record<string, string> = {
    'x-api-key': cfg.apiKey,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  };
  if (ANTHROPIC_FALLBACK.has(model)) {
    body.fallbacks = 'default';
    headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
  }
  const r = await post('anthropic', 'https://api.anthropic.com/v1/messages', headers, body, req.signal);
  if (!r.ok) throw await httpError('anthropic', r);
  const sse = await readText('anthropic', r, req.signal);

  let served = model;
  let input = 0;
  let output = 0;
  let stop: string | undefined;
  let stopDetails: any;
  let fellBack = false;
  const blocks = new Map<number, string>();
  for (const chunk of sse.split(/\r?\n\r?\n/)) {
    const data = chunk.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
    if (!data) continue;
    let ev: any;
    try {
      ev = JSON.parse(data);
    } catch {
      continue;
    }
    switch (ev.type) {
      case 'message_start':
        served = ev.message?.model ?? served;
        input = ev.message?.usage?.input_tokens ?? input;
        output = ev.message?.usage?.output_tokens ?? output;
        break;
      case 'content_block_start':
        if (ev.content_block?.type === 'fallback') fellBack = true;
        if (ev.content_block?.type === 'text') blocks.set(ev.index, ev.content_block.text ?? '');
        break;
      case 'content_block_delta':
        if (ev.delta?.type === 'text_delta') blocks.set(ev.index, (blocks.get(ev.index) ?? '') + ev.delta.text);
        break;
      case 'message_delta':
        stop = ev.delta?.stop_reason ?? stop;
        stopDetails = ev.delta?.stop_details ?? stopDetails;
        if (typeof ev.usage?.input_tokens === 'number') input = ev.usage.input_tokens;
        if (typeof ev.usage?.output_tokens === 'number') output = ev.usage.output_tokens;
        break;
      case 'error': {
        // An error after the 200 (e.g. overloaded mid-stream) arrives as an SSE event
        const msg = ev.error?.message ?? JSON.stringify(ev.error ?? ev);
        const status = ANTHROPIC_STATUS[ev.error?.type] ?? r.status;
        const cause = classify(status, `${msg} ${ev.error?.type ?? ''}`);
        throw cause === 'rate' ? new RateLimited('anthropic', status, msg) : new LlmError('anthropic', status, msg, cause);
      }
    }
  }
  if (stop === 'max_tokens') throw new LlmError('anthropic', r.status, 'stop_reason: max_tokens', 'truncated');
  if (stop === 'refusal') {
    const why = [stopDetails?.category, stopDetails?.explanation].filter(Boolean).join(': ');
    throw new LlmError('anthropic', r.status, `stop_reason: refusal${why ? ` (${why})` : ''}`, 'other');
  }
  if (!stop) throw new LlmError('anthropic', r.status, `the stream ended without message_delta: ${sse.slice(-2000)}`, 'network');
  const text = [...blocks.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]).join('\n');
  // After a server-side fallback the bill is split between two models: no single catalogue price applies
  return { text, model: served, usage: { input, output, usd: fellBack ? undefined : priceUsd('anthropic', model, input, output) } };
};

// OpenAI Responses API
const openai: Send = async (model, cfg, req) => {
  const input = req.messages.map((m) =>
    m.role === 'assistant'
      ? { role: 'assistant', content: m.text ?? '' }
      : {
          role: 'user',
          content: [
            ...(m.images ?? []).map((i) => ({ type: 'input_image', image_url: dataUrl(i), detail: 'auto' })),
            ...(hasText(m) ? [{ type: 'input_text', text: m.text }] : []),
          ],
        },
  );
  const body: Record<string, unknown> = { model, instructions: req.system, input, max_output_tokens: req.maxTokens, store: false };
  if (cfg.effort) body.reasoning = { effort: cfg.effort };
  const r = await post('openai', 'https://api.openai.com/v1/responses', { authorization: `Bearer ${cfg.apiKey}` }, body, req.signal);
  if (!r.ok) throw await httpError('openai', r);
  const j = parseJson('openai', r.status, await readText('openai', r, req.signal));
  if (j.status === 'failed' || (j.error && j.status !== 'completed')) {
    const msg = j.error?.message ?? `status: ${j.status}`;
    throw new LlmError('openai', r.status, msg, classify(0, `${msg} ${j.error?.code ?? ''}`));
  }
  if (j.status === 'incomplete') {
    const reason = j.incomplete_details?.reason ?? '-';
    throw new LlmError('openai', r.status, `status: incomplete (incomplete_details.reason: ${reason})`, reason === 'max_output_tokens' ? 'truncated' : 'other');
  }
  const parts: string[] = [];
  let refusal = '';
  for (const item of j.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const c of item.content ?? []) {
      if (c?.type === 'output_text') parts.push(c.text ?? '');
      if (c?.type === 'refusal') refusal = c.refusal ?? 'refusal';
    }
  }
  if (!parts.length && refusal) throw new LlmError('openai', r.status, refusal, 'other');
  const inTok = j.usage?.input_tokens ?? 0;
  const outTok = j.usage?.output_tokens ?? 0;
  return { text: parts.join(''), model: j.model ?? model, usage: { input: inTok, output: outTok, usd: priceUsd('openai', model, inTok, outTok) } };
};

// Google Gemini generateContent
const google: Send = async (model, cfg, req) => {
  const contents = req.messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [
      ...(m.role === 'user' ? (m.images ?? []).map((i) => ({ inline_data: { mime_type: i.mediaType, data: i.base64 } })) : []),
      ...(hasText(m) ? [{ text: m.text }] : []),
    ],
  }));
  const generationConfig: Record<string, unknown> = { maxOutputTokens: req.maxTokens };
  if (cfg.effort) generationConfig.thinkingConfig = { thinkingLevel: cfg.effort };
  const body = { system_instruction: { parts: [{ text: req.system }] }, contents, generationConfig };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const r = await post('google', url, { 'x-goog-api-key': cfg.apiKey }, body, req.signal);
  if (!r.ok) throw await httpError('google', r);
  const j = parseJson('google', r.status, await readText('google', r, req.signal));
  if (j.error) {
    const { message, extra } = errorText(JSON.stringify(j), '', r.status);
    throw new LlmError('google', typeof j.error.code === 'number' ? j.error.code : r.status, message, classify(j.error.code ?? 0, `${message} ${extra}`));
  }
  if (j.promptFeedback?.blockReason) {
    throw new LlmError('google', r.status, `promptFeedback.blockReason: ${j.promptFeedback.blockReason}${j.promptFeedback.blockReasonMessage ? ` (${j.promptFeedback.blockReasonMessage})` : ''}`, 'other');
  }
  const c = j.candidates?.[0];
  if (!c) throw new LlmError('google', r.status, `no candidates in the answer: ${JSON.stringify(j).slice(0, 2000)}`, 'other');
  const finish = c.finishReason;
  if (finish === 'MAX_TOKENS') throw new LlmError('google', r.status, 'finishReason: MAX_TOKENS', 'truncated');
  if (finish && finish !== 'STOP') throw new LlmError('google', r.status, `finishReason: ${finish}${c.finishMessage ? ` (${c.finishMessage})` : ''}`, 'other');
  const text = (c.content?.parts ?? []).filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join('');
  const u = j.usageMetadata ?? {};
  const inTok = u.promptTokenCount ?? 0;
  const outTok = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);
  return { text, model: j.modelVersion ?? model, usage: { input: inTok, output: outTok, usd: priceUsd('google', model, inTok, outTok) } };
};

const SENDERS: Record<ProviderId, Send> = { openrouter, anthropic, openai, google };

// ---------------------------------------------------------------- entry point

export const callLlm: CallLlm = async (cfg, req) => {
  const send = SENDERS[cfg.provider];
  if (!send) throw new LlmError(cfg.provider, 0, `provider not supported: ${String(cfg.provider)}`, 'other');
  const model = (req.review && cfg.reviewModel) || cfg.model;
  try {
    return await send(model, cfg, req);
  } catch (e) {
    // 429 with a wait the provider itself asked for: wait exactly that and try once more; otherwise its error goes up
    if (!(e instanceof RateLimited) || e.retryAfter === undefined || e.retryAfter > 120) throw e;
    await wait(e.retryAfter, req.signal);
    return await send(model, cfg, req);
  }
};
