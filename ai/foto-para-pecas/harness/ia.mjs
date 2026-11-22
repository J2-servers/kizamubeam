// ia.mjs — uma chamada de IA, pelo provedor escolhido em modelos.json ("openrouter" ou "anthropic").
// A chave fica em config/chaves.env (fora do git). Para trocar: edite esse arquivo; nada mais muda.
//
// Mensagens no formato da Anthropic (blocos {type:'text'} e {type:'image', source:{base64}}); para o OpenRouter elas
// viram o formato de chat dele. Devolve { texto, conteudo, uso: { entrada, saida, usd }, modelo }.
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
export const MODELOS = JSON.parse(readFileSync(join(AQUI, 'modelos.json'), 'utf8'));

/** Le config/chaves.env (linhas NOME=valor) sem imprimir nada */
function chaves() {
  const f = join(AQUI, 'config', 'chaves.env');
  const out = {};
  if (!existsSync(f)) return out;
  for (const linha of readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/.exec(linha);
    if (m && !linha.trim().startsWith('#')) out[m[1]] = m[2];
  }
  return out;
}

export const modeloDa = (etapa) => MODELOS.por_etapa?.[etapa] ?? MODELOS.padrao;

function paraOpenRouter(sistema, mensagens) {
  const conv = (c) => {
    if (typeof c === 'string') return c;
    return c.map((b) => (b.type === 'image' ? { type: 'image_url', image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` } } : { type: 'text', text: b.text ?? '' }));
  };
  return [{ role: 'system', content: sistema }, ...mensagens.map((m) => ({ role: m.role, content: m.role === 'assistant' ? (typeof m.content === 'string' ? m.content : m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n')) : conv(m.content) }))];
}

export async function chamar({ etapa, sistema, mensagens, modelo = modeloDa(etapa), esforco = MODELOS.effort ?? 'high', maxTokens = MODELOS.max_tokens?.[etapa] ?? MODELOS.max_tokens?.padrao ?? 32000 }) {
  const k = chaves();
  const provedor = MODELOS.provedor ?? (k.OPENROUTER_API_KEY ? 'openrouter' : 'anthropic');
  if (provedor === 'openrouter') {
    const chave = process.env.OPENROUTER_API_KEY ?? k.OPENROUTER_API_KEY;
    if (!chave) throw Error('falta OPENROUTER_API_KEY em config/chaves.env');
    for (let tentativa = 1; ; tentativa++) {
      const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${chave}`, 'Content-Type': 'application/json', 'X-Title': 'KizamuBeam foto-para-pecas' },
        body: JSON.stringify({ model: modelo, messages: paraOpenRouter(sistema, mensagens), max_tokens: maxTokens, reasoning: { effort: esforco }, usage: { include: true } }),
      });
      const corpo = await r.text();
      if (r.status === 429 || r.status >= 500) {
        // limite ou falha do outro lado: esperar o que ele pedir e tentar de novo (limite que VEM DE FORA)
        if (tentativa >= 4) throw Error(`OpenRouter ${r.status}: ${corpo.slice(0, 400)}`);
        await new Promise((ok) => setTimeout(ok, Number(r.headers.get('retry-after') ?? 5) * 1000));
        continue;
      }
      if (!r.ok) throw Error(`OpenRouter ${r.status}: ${corpo.slice(0, 600)}`);
      const j = JSON.parse(corpo);
      if (j.error) throw Error(`OpenRouter: ${JSON.stringify(j.error).slice(0, 600)}`);
      const esc = j.choices?.[0];
      if (esc?.finish_reason === 'length') throw Error(`resposta cortada na etapa ${etapa} (max_tokens)`);
      if (esc?.native_finish_reason === 'refusal' || esc?.finish_reason === 'content_filter') throw Error(`a IA recusou na etapa ${etapa}`);
      const texto = typeof esc?.message?.content === 'string' ? esc.message.content : (esc?.message?.content ?? []).map((b) => b.text ?? '').join('\n');
      return { texto, conteudo: [{ type: 'text', text: texto }], modelo: j.model ?? modelo, uso: { entrada: j.usage?.prompt_tokens ?? 0, saida: j.usage?.completion_tokens ?? 0, usd: j.usage?.cost ?? null } };
    }
  }
  // Anthropic, SDK oficial
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY ?? k.ANTHROPIC_API_KEY });
  const COM_FALLBACK = new Set(['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5']);
  const r = await c.beta.messages.stream({
    model: modelo, max_tokens: maxTokens, system: sistema, messages: mensagens, output_config: { effort: esforco },
    ...(COM_FALLBACK.has(modelo) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' } : {}),
  }).finalMessage();
  if (r.stop_reason === 'refusal') throw Error(`a IA recusou na etapa ${etapa}: ${r.stop_details?.category ?? ''}`);
  if (r.stop_reason === 'max_tokens') throw Error(`resposta cortada na etapa ${etapa} (max_tokens)`);
  const texto = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return { texto, conteudo: r.content, modelo: r.model, uso: { entrada: r.usage.input_tokens, saida: r.usage.output_tokens, usd: null } };
}

/** O primeiro objeto JSON do texto (a IA as vezes poe texto em volta) */
export function extrairJson(texto) {
  const s = texto.replace(/```(?:json)?/g, '');
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw Error('a resposta nao tem JSON');
  return JSON.parse(s.slice(a, b + 1));
}
