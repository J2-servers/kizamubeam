// Tests for src/criar/llm.ts with a fake fetch (no network, no key).
// Run: node scripts/run-ts.mjs scripts/criar-llm-test.ts
// Real cheap call through OpenRouter (reads OPENROUTER_API_KEY from ai/foto-para-pecas/harness/config/chaves.env,
// never prints it): node scripts/run-ts.mjs scripts/criar-llm-test.ts --real
import { strict as assert } from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const { callLlm, PROVIDERS, priceUsd, classify } = await import('../src/criar/llm');
const { LlmError } = await import('../src/criar/contract');
type Cfg = import('../src/criar/contract').LlmConfig;
type Req = import('../src/criar/contract').LlmRequest;

let failed = 0;
async function test(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n${(e as Error).stack}`);
  }
}

// ---------------------------------------------------------------- fake fetch
interface Call { url: string; headers: Record<string, string>; body: any; signal?: AbortSignal }
let calls: Call[] = [];
let queue: (() => Response | Promise<Response>)[] = [];
const realFetch = globalThis.fetch;
function fake() {
  globalThis.fetch = (async (url: any, init: any) => {
    if (init?.signal?.aborted) throw new DOMException('This operation was aborted', 'AbortError');
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body), signal: init.signal });
    const next = queue.shift();
    if (!next) throw new Error('fake fetch: no answer queued');
    return next();
  }) as typeof fetch;
}
function reset(...answers: (() => Response | Promise<Response>)[]) {
  calls = [];
  queue = answers;
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const sse = (events: unknown[]) => () =>
  new Response(events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''), { status: 200, headers: { 'content-type': 'text/event-stream' } });

const IMG = { mediaType: 'image/png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==' };
const REQ: Req = { stage: '1-compreender', system: 'Você é um projetista.', messages: [{ role: 'user', text: 'O que é isto?', images: [IMG] }], maxTokens: 900 };
const cfg = (provider: Cfg['provider'], extra: Partial<Cfg> = {}): Cfg => {
  const p = PROVIDERS.find((x) => x.id === provider)!;
  return { provider, apiKey: `KEY-${provider}`, model: p.defaultModel, reviewModel: p.defaultReviewModel, effort: 'high', ...extra };
};
async function rejects(p: Promise<unknown>, check: (e: InstanceType<typeof LlmError>) => void) {
  try {
    await p;
  } catch (e) {
    assert.ok(e instanceof LlmError, `expected LlmError, got ${e}`);
    check(e as InstanceType<typeof LlmError>);
    return;
  }
  assert.fail('expected a rejection');
}

// Anthropic SSE answer
const anthropicOk = (text: string, stop = 'end_turn', model = 'claude-fable-5-2', extra: unknown[] = []) =>
  sse([
    { type: 'message_start', message: { id: 'msg_1', model, usage: { input_tokens: 1200, output_tokens: 1 } } },
    ...extra,
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(0, 3) } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: text.slice(3) } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: stop, stop_details: null }, usage: { output_tokens: 300 } },
    { type: 'message_stop' },
  ]);

fake();

// ---------------------------------------------------------------- catalogue
await test('catálogo: 4 provedores, modelos padrão estão na lista e têm visão', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['openrouter', 'anthropic', 'openai', 'google']);
  for (const p of PROVIDERS) {
    for (const id of [p.defaultModel, p.defaultReviewModel]) {
      const m = p.models.find((x) => x.id === id);
      assert.ok(m && m.vision, `${p.id}: ${id}`);
    }
    assert.ok(p.keyUrl.startsWith('https://'));
  }
});

await test('preço: tabela por modelo, mudança de data e contexto longo', () => {
  assert.equal(priceUsd('anthropic', 'claude-fable-5-2', 1_000_000, 1_000_000), 48);
  assert.equal(priceUsd('google', 'gemini-4-carbon', 1_000_000, 0, new Date('2026-11-30T12:00:00Z')), 2);
  assert.equal(priceUsd('google', 'gemini-4-carbon', 1_000_000, 0, new Date('2026-12-01T12:00:00Z')), 4);
  assert.equal(priceUsd('openai', 'gpt-6.2-astra', 300_000, 0), 300_000 * 16 / 1e6);
  assert.equal(priceUsd('openai', 'modelo-sem-preco', 10, 10), undefined);
  assert.equal(priceUsd('openrouter', 'anthropic/claude-fable-5.2', 10, 10), undefined);
});

await test('classificação', () => {
  assert.equal(classify(402, 'x'), 'credits');
  assert.equal(classify(429, 'You exceeded your current quota insufficient_quota'), 'credits');
  assert.equal(classify(400, 'Your credit balance is too low to access the Anthropic API.'), 'credits');
  assert.equal(classify(401, 'x'), 'auth');
  assert.equal(classify(403, 'x'), 'auth');
  assert.equal(classify(400, 'API key not valid. Please pass a valid API key. API_KEY_INVALID'), 'auth');
  assert.equal(classify(429, 'Rate limit reached'), 'rate');
  assert.equal(classify(500, 'x'), 'other');
});

// ---------------------------------------------------------------- OpenRouter
await test('openrouter: corpo (imagem antes do texto, esforço, usage.include) e leitura do texto/custo', async () => {
  reset(json(200, { model: 'anthropic/claude-fable-5.2', choices: [{ finish_reason: 'stop', message: { content: 'Um cofrinho.' } }], usage: { prompt_tokens: 50, completion_tokens: 7, cost: 0.00068 } }));
  const r = await callLlm(cfg('openrouter'), REQ);
  const c = calls[0];
  assert.equal(c.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.equal(c.headers.authorization, 'Bearer KEY-openrouter');
  assert.equal(c.body.model, 'anthropic/claude-fable-5.2');
  assert.equal(c.body.max_tokens, 900);
  assert.deepEqual(c.body.reasoning, { effort: 'high' });
  assert.deepEqual(c.body.usage, { include: true });
  assert.deepEqual(c.body.messages[0], { role: 'system', content: 'Você é um projetista.' });
  assert.deepEqual(c.body.messages[1].content, [{ type: 'image_url', image_url: { url: `data:image/png;base64,${IMG.base64}` } }, { type: 'text', text: 'O que é isto?' }]);
  assert.deepEqual(r, { text: 'Um cofrinho.', model: 'anthropic/claude-fable-5.2', usage: { input: 50, output: 7, usd: 0.00068 } });
});

await test('openrouter: review usa o modelo de revisão', async () => {
  reset(json(200, { choices: [{ finish_reason: 'stop', message: { content: '8' } }], usage: {} }));
  await callLlm(cfg('openrouter'), { ...REQ, review: true });
  assert.equal(calls[0].body.model, 'anthropic/claude-sonnet-5.5');
});

await test('openrouter: 402 sem saldo guarda a frase literal', async () => {
  const msg = 'This request requires more credits, or fewer max_tokens. You requested up to 32000 tokens, but can only afford 1234.';
  reset(json(402, { error: { code: 402, message: msg } }));
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => {
    assert.equal(e.cause2, 'credits');
    assert.equal(e.status, 402);
    assert.equal(e.providerMessage, msg);
    assert.equal(e.provider, 'openrouter');
  });
  assert.equal(calls.length, 1);
});

await test('openrouter: 401 chave inválida', async () => {
  reset(json(401, { error: { code: 401, message: 'No auth credentials found' } }));
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => {
    assert.equal(e.cause2, 'auth');
    assert.equal(e.providerMessage, 'No auth credentials found');
  });
});

await test('openrouter: 429 com retry-after → espera o pedido, tenta UMA vez e dá certo', async () => {
  reset(json(429, { error: { code: 429, message: 'Rate limit exceeded' } }, { 'retry-after': '0' }), json(200, { choices: [{ finish_reason: 'stop', message: { content: 'ok' } }], usage: {} }));
  const r = await callLlm(cfg('openrouter'), REQ);
  assert.equal(r.text, 'ok');
  assert.equal(calls.length, 2);
});

await test('openrouter: 429 duas vezes → só uma nova tentativa, depois a frase dele', async () => {
  reset(json(429, { error: { code: 429, message: 'Rate limit exceeded' } }, { 'retry-after': '0' }), json(429, { error: { code: 429, message: 'Rate limit exceeded: free-models-per-min' } }, { 'retry-after': '0' }));
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => {
    assert.equal(e.cause2, 'rate');
    assert.equal(e.providerMessage, 'Rate limit exceeded: free-models-per-min');
  });
  assert.equal(calls.length, 2);
});

await test('openrouter: 429 sem retry-after → não inventa espera, joga na hora', async () => {
  reset(json(429, { error: { code: 429, message: 'Rate limit exceeded' } }));
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => assert.equal(e.cause2, 'rate'));
  assert.equal(calls.length, 1);
});

await test('openrouter: cortada (finish_reason length)', async () => {
  reset(json(200, { choices: [{ finish_reason: 'length', native_finish_reason: 'max_tokens', message: { content: '{"pecas": [' } }], usage: {} }));
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => {
    assert.equal(e.cause2, 'truncated');
    assert.equal(e.providerMessage, 'finish_reason: length (native_finish_reason: max_tokens)');
  });
});

await test('openrouter: erro dentro de um 200 (falha do provedor depois de aceitar)', async () => {
  reset(json(200, { error: { code: 502, message: 'Provider returned error', metadata: { raw: 'upstream overloaded', provider_name: 'Anthropic' } } }));
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.cause2, 'other');
    assert.equal(e.providerMessage, 'Provider returned error | upstream overloaded');
  });
});

await test('rede: fetch falhou → network com a frase do erro', async () => {
  reset(() => { throw new TypeError('fetch failed'); });
  await rejects(callLlm(cfg('openrouter'), REQ), (e) => {
    assert.equal(e.cause2, 'network');
    assert.equal(e.status, 0);
    assert.equal(e.providerMessage, 'fetch failed');
  });
});

await test('signal: abortado → rejeita com AbortError, não LlmError', async () => {
  const ac = new AbortController();
  ac.abort();
  reset(json(200, {}));
  await assert.rejects(callLlm(cfg('openrouter'), { ...REQ, signal: ac.signal }), (e: Error) => e.name === 'AbortError' && !(e instanceof LlmError));
  assert.equal(calls.length, 0);
});

await test('signal: abort durante a espera do retry-after', async () => {
  const ac = new AbortController();
  reset(json(429, { error: { code: 429, message: 'Rate limit exceeded' } }, { 'retry-after': '30' }));
  const p = callLlm(cfg('openrouter'), { ...REQ, signal: ac.signal });
  setTimeout(() => ac.abort(), 20);
  await assert.rejects(p, (e: Error) => e.name === 'AbortError');
  assert.equal(calls.length, 1);
});

// ---------------------------------------------------------------- Anthropic
await test('anthropic: corpo (imagem base64, adaptive, effort, cabeçalhos do navegador) e leitura do stream', async () => {
  reset(anthropicOk('Um cofrinho de MDF.'));
  const r = await callLlm(cfg('anthropic'), REQ);
  const c = calls[0];
  assert.equal(c.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(c.headers['x-api-key'], 'KEY-anthropic');
  assert.equal(c.headers['anthropic-version'], '2026-10-21');
  assert.equal(c.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(c.headers['anthropic-beta'], 'server-side-fallback-2026-07-01');
  assert.equal(c.body.fallbacks, 'default');
  assert.equal(c.body.model, 'claude-fable-5-2');
  assert.equal(c.body.system, 'Você é um projetista.');
  assert.equal(c.body.max_tokens, 900);
  assert.equal(c.body.stream, true);
  assert.deepEqual(c.body.thinking, { type: 'adaptive' });
  assert.deepEqual(c.body.output_config, { effort: 'high' });
  assert.equal(c.body.thinking.budget_tokens, undefined);
  assert.deepEqual(c.body.messages[0].content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: IMG.base64 } },
    { type: 'text', text: 'O que é isto?' },
  ]);
  assert.equal(r.text, 'Um cofrinho de MDF.');
  assert.equal(r.model, 'claude-fable-5-2');
  assert.deepEqual(r.usage, { input: 1200, output: 300, usd: (1200 * 8 + 300 * 40) / 1e6 });
});

await test('anthropic: haiku não leva o fallback do servidor', async () => {
  reset(anthropicOk('ok', 'end_turn', 'claude-haiku-5-5'));
  await callLlm(cfg('anthropic', { model: 'claude-haiku-5-5' }), REQ);
  assert.equal(calls[0].headers['anthropic-beta'], undefined);
  assert.equal(calls[0].body.fallbacks, undefined);
});

await test('anthropic: depois de um fallback do servidor, sem preço inventado', async () => {
  reset(anthropicOk('ok', 'end_turn', 'claude-fable-5-2', [{ type: 'content_block_start', index: 9, content_block: { type: 'fallback', from: { model: 'claude-fable-5-2' }, to: { model: 'claude-opus-5' } } }]));
  const r = await callLlm(cfg('anthropic'), REQ);
  assert.equal(r.usage.usd, undefined);
});

await test('anthropic: 400 sem crédito → credits com a frase literal', async () => {
  const msg = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.';
  reset(json(400, { type: 'error', error: { type: 'invalid_request_error', message: msg }, request_id: 'req_1' }));
  await rejects(callLlm(cfg('anthropic'), REQ), (e) => {
    assert.equal(e.cause2, 'credits');
    assert.equal(e.providerMessage, msg);
  });
});

await test('anthropic: 402 billing_error', async () => {
  reset(json(402, { type: 'error', error: { type: 'billing_error', message: 'Billing problem on this account.' } }));
  await rejects(callLlm(cfg('anthropic'), REQ), (e) => assert.equal(e.cause2, 'credits'));
});

await test('anthropic: 401 chave inválida', async () => {
  reset(json(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
  await rejects(callLlm(cfg('anthropic'), REQ), (e) => {
    assert.equal(e.cause2, 'auth');
    assert.equal(e.providerMessage, 'invalid x-api-key');
  });
});

await test('anthropic: 429 com retry-after → uma nova tentativa', async () => {
  reset(json(429, { type: 'error', error: { type: 'rate_limit_error', message: 'Number of request tokens has exceeded your per-minute rate limit' } }, { 'retry-after': '0' }), anthropicOk('ok'));
  const r = await callLlm(cfg('anthropic'), REQ);
  assert.equal(r.text, 'ok');
  assert.equal(calls.length, 2);
});

await test('anthropic: cortada (stop_reason max_tokens)', async () => {
  reset(anthropicOk('{"pec', 'max_tokens'));
  await rejects(callLlm(cfg('anthropic'), REQ), (e) => {
    assert.equal(e.cause2, 'truncated');
    assert.equal(e.providerMessage, 'stop_reason: max_tokens');
  });
});

await test('anthropic: erro no meio do stream (overloaded)', async () => {
  reset(sse([{ type: 'message_start', message: { model: 'claude-fable-5-2', usage: { input_tokens: 5 } } }, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }]));
  await rejects(callLlm(cfg('anthropic'), REQ), (e) => {
    assert.equal(e.status, 529);
    assert.equal(e.cause2, 'other');
    assert.equal(e.providerMessage, 'Overloaded');
  });
});

await test('anthropic: recusa guarda categoria e explicação', async () => {
  reset(sse([{ type: 'message_start', message: { model: 'claude-fable-5-2', usage: { input_tokens: 5 } } }, { type: 'message_delta', delta: { stop_reason: 'refusal', stop_details: { type: 'refusal', category: 'cyber', explanation: 'declined' } }, usage: { output_tokens: 1 } }]));
  await rejects(callLlm(cfg('anthropic'), REQ), (e) => assert.equal(e.providerMessage, 'stop_reason: refusal (cyber: declined)'));
});

// ---------------------------------------------------------------- OpenAI
await test('openai: corpo Responses (input_image data URL, instructions, reasoning) e leitura', async () => {
  reset(json(200, { id: 'resp_1', model: 'gpt-6.2-astra', status: 'completed', output: [{ type: 'reasoning', summary: [] }, { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Um cofrinho.' }] }], usage: { input_tokens: 1000, output_tokens: 200, output_tokens_details: { reasoning_tokens: 150 } } }));
  const r = await callLlm(cfg('openai'), { ...REQ, messages: [...REQ.messages, { role: 'assistant', text: 'Entendi.' }, { role: 'user', text: 'E a tampa?' }] });
  const c = calls[0];
  assert.equal(c.url, 'https://api.openai.com/v1/responses');
  assert.equal(c.headers.authorization, 'Bearer KEY-openai');
  assert.equal(c.body.model, 'gpt-6.2-astra');
  assert.equal(c.body.instructions, 'Você é um projetista.');
  assert.equal(c.body.max_output_tokens, 900);
  assert.equal(c.body.store, false);
  assert.deepEqual(c.body.reasoning, { effort: 'high' });
  assert.deepEqual(c.body.input[0].content, [{ type: 'input_image', image_url: `data:image/png;base64,${IMG.base64}`, detail: 'auto' }, { type: 'input_text', text: 'O que é isto?' }]);
  assert.deepEqual(c.body.input[1], { role: 'assistant', content: 'Entendi.' });
  assert.deepEqual(r, { text: 'Um cofrinho.', model: 'gpt-6.2-astra', usage: { input: 1000, output: 200, usd: (1000 * 8 + 200 * 40) / 1e6 } });
});

await test('openai: 429 insufficient_quota → credits, sem nova tentativa', async () => {
  const msg = 'You exceeded your current quota, please check your plan and billing details.';
  reset(json(429, { error: { message: msg, type: 'insufficient_quota', param: null, code: 'insufficient_quota' } }, { 'retry-after': '0' }));
  await rejects(callLlm(cfg('openai'), REQ), (e) => {
    assert.equal(e.cause2, 'credits');
    assert.equal(e.providerMessage, msg);
  });
  assert.equal(calls.length, 1);
});

await test('openai: 401', async () => {
  reset(json(401, { error: { message: 'Incorrect API key provided: KEY-open*****. You can find your API key at https://platform.openai.com/account/api-keys.', type: 'invalid_request_error', code: 'invalid_api_key' } }));
  await rejects(callLlm(cfg('openai'), REQ), (e) => assert.equal(e.cause2, 'auth'));
});

await test('openai: 429 rate com retry-after-ms → uma nova tentativa', async () => {
  reset(json(429, { error: { message: 'Rate limit reached for requests', type: 'requests', code: 'rate_limit_exceeded' } }, { 'retry-after-ms': '1' }), json(200, { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'ok' }] }], usage: { input_tokens: 1, output_tokens: 1 } }));
  assert.equal((await callLlm(cfg('openai'), REQ)).text, 'ok');
  assert.equal(calls.length, 2);
});

await test('openai: cortada (incomplete / max_output_tokens)', async () => {
  reset(json(200, { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: [], usage: { input_tokens: 1, output_tokens: 900 } }));
  await rejects(callLlm(cfg('openai'), REQ), (e) => {
    assert.equal(e.cause2, 'truncated');
    assert.equal(e.providerMessage, 'status: incomplete (incomplete_details.reason: max_output_tokens)');
  });
});

// ---------------------------------------------------------------- Google
await test('google: corpo generateContent (inline_data, system_instruction, thinkingLevel) e leitura', async () => {
  reset(json(200, { candidates: [{ content: { role: 'model', parts: [{ text: 'pensando', thought: true }, { text: 'Um cofrinho.' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 400, candidatesTokenCount: 20, thoughtsTokenCount: 80 }, modelVersion: 'gemini-4-hydrogen' }));
  const r = await callLlm(cfg('google'), { ...REQ, review: true, messages: [...REQ.messages, { role: 'assistant', text: 'Entendi.' }] });
  const c = calls[0];
  assert.equal(c.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-4-hydrogen:generateContent');
  assert.equal(c.headers['x-goog-api-key'], 'KEY-google');
  assert.deepEqual(c.body.system_instruction, { parts: [{ text: 'Você é um projetista.' }] });
  assert.deepEqual(c.body.contents[0], { role: 'user', parts: [{ inline_data: { mime_type: 'image/png', data: IMG.base64 } }, { text: 'O que é isto?' }] });
  assert.deepEqual(c.body.contents[1], { role: 'model', parts: [{ text: 'Entendi.' }] });
  assert.deepEqual(c.body.generationConfig, { maxOutputTokens: 900, thinkingConfig: { thinkingLevel: 'high' } });
  assert.equal(r.text, 'Um cofrinho.');
  assert.deepEqual(r.usage, { input: 400, output: 100, usd: (400 * 1.5 + 100 * 7.5) / 1e6 });
});

await test('google: 400 API_KEY_INVALID → auth', async () => {
  reset(json(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason: 'API_KEY_INVALID' }] } }));
  await rejects(callLlm(cfg('google'), REQ), (e) => {
    assert.equal(e.cause2, 'auth');
    assert.equal(e.providerMessage, 'API key not valid. Please pass a valid API key.');
  });
});

await test('google: 402 Prepay sem saldo → credits', async () => {
  reset(json(402, { error: { code: 402, message: 'Your Prepay credit balance is depleted.', status: 'FAILED_PRECONDITION' } }));
  await rejects(callLlm(cfg('google'), REQ), (e) => assert.equal(e.cause2, 'credits'));
});

await test('google: 429 com RetryInfo → uma nova tentativa', async () => {
  reset(
    json(429, { error: { code: 429, message: 'Resource has been exhausted (e.g. check quota).', status: 'RESOURCE_EXHAUSTED', details: [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '0s' }] } }),
    json(200, { candidates: [{ content: { parts: [{ text: 'ok' }] }, finishReason: 'STOP' }], usageMetadata: {} }),
  );
  assert.equal((await callLlm(cfg('google'), REQ)).text, 'ok');
  assert.equal(calls.length, 2);
});

await test('google: cortada (finishReason MAX_TOKENS)', async () => {
  reset(json(200, { candidates: [{ content: { parts: [{ text: '{"pe' }] }, finishReason: 'MAX_TOKENS' }], usageMetadata: {} }));
  await rejects(callLlm(cfg('google'), REQ), (e) => {
    assert.equal(e.cause2, 'truncated');
    assert.equal(e.providerMessage, 'finishReason: MAX_TOKENS');
  });
});

await test('erro com corpo que não é JSON guarda o texto cru', async () => {
  reset(() => new Response('<html>502 Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }));
  await rejects(callLlm(cfg('google'), REQ), (e) => {
    assert.equal(e.status, 502);
    assert.equal(e.providerMessage, '<html>502 Bad Gateway</html>');
  });
});

globalThis.fetch = realFetch;

// ---------------------------------------------------------------- real call (opt-in)
if (process.argv.includes('--real')) {
  await test('REAL openrouter: uma imagem minúscula, max_tokens baixo, volta texto e custo', async () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const f = join(here, '..', 'ai', 'foto-para-pecas', 'harness', 'config', 'chaves.env');
    assert.ok(existsSync(f), 'chaves.env não encontrado');
    const line = readFileSync(f, 'utf8').split(/\r?\n/).find((l) => /^\s*OPENROUTER_API_KEY\s*=/.test(l));
    const apiKey = line?.split('=').slice(1).join('=').trim();
    assert.ok(apiKey, 'OPENROUTER_API_KEY ausente');
    const r = await callLlm(
      { provider: 'openrouter', apiKey, model: 'anthropic/claude-sonnet-5.5', effort: 'low' },
      { stage: 'teste', system: 'Responda em português, em poucas palavras.', messages: [{ role: 'user', images: [IMG], text: 'Que cor tem este pixel? Responda com uma palavra.' }], maxTokens: 1024 },
    ).catch((e) => {
      // never print the key: only the provider's sentence
      throw new Error(e instanceof LlmError ? `${e.cause2} ${e.status}: ${e.providerMessage}` : String(e?.message ?? e));
    });
    console.log(`     texto: ${JSON.stringify(r.text)} | modelo: ${r.model} | tokens ${r.usage.input}/${r.usage.output} | US$ ${r.usage.usd}`);
    assert.ok(r.text.trim().length > 0, 'texto vazio');
    assert.ok(typeof r.usage.usd === 'number' && r.usage.usd > 0, 'sem custo');
  });
}

console.log(failed ? `\n${failed} FALHA(S)` : '\ntodos ok');
if (failed) process.exit(1);
