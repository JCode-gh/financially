import axios from 'axios';
import {
  ensureOllamaReady,
  ollamaHost,
  currentOllamaModel,
  currentSearchModel
} from './ollama.js';

const CHAT_TIMEOUT = Number(process.env.OLLAMA_CHAT_TIMEOUT_MS || 180000);

export const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web and news wires for current facts, headlines, or background the desk does not already have.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Short search query' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'lookup_ticker',
      description: 'Load the latest quote, desk call, and headlines for one ticker.',
      parameters: {
        type: 'object',
        properties: {
          symbol: { type: 'string', description: 'Ticker such as NVDA or INGA.AS' }
        },
        required: ['symbol']
      }
    }
  }
];

function parseArgs(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); } catch { return {}; }
}

export function parseToolCalls(message) {
  const native = message?.tool_calls;
  if (Array.isArray(native) && native.length) {
    return native.map(tc => ({
      name: tc.function?.name || tc.name,
      args: parseArgs(tc.function?.arguments ?? tc.arguments)
    })).filter(t => t.name);
  }

  const text = String(message?.content || '');
  const out = [];
  const re = /(?:tool_call|function_call)?\s*(web_search|lookup_ticker)\s*\(\s*(\{[\s\S]*?\}|"[^"]+")\s*\)/gi;
  let m;
  while ((m = re.exec(text))) {
    const raw = m[2].startsWith('{') ? m[2] : JSON.stringify({
      [m[1] === 'lookup_ticker' ? 'symbol' : 'query']: m[2].replace(/^"|"$/g, '')
    });
    out.push({ name: m[1], args: parseArgs(raw) });
  }
  if (out.length) return out;

  const jsonBlock = text.match(/\{[\s\S]*"name"\s*:\s*"(web_search|lookup_ticker)"[\s\S]*\}/);
  if (jsonBlock) {
    try {
      const obj = JSON.parse(jsonBlock[0]);
      const name = obj.name || obj.function?.name;
      const args = obj.arguments || obj.args || obj.function?.arguments || {};
      if (name) return [{ name, args: parseArgs(args) }];
    } catch { /* ignore */ }
  }
  return [];
}

export async function ollamaChatOnce(messages, { model, tools, timeout, temperature = 0.2, numPredict = 400 } = {}) {
  await ensureOllamaReady();
  const body = {
    model: model || currentOllamaModel(),
    stream: false,
    messages,
    options: { temperature, num_predict: numPredict, num_ctx: 8192 }
  };
  if (tools?.length) body.tools = tools;
  const res = await axios.post(`${ollamaHost()}/api/chat`, body, {
    timeout: timeout ?? CHAT_TIMEOUT
  });
  return res.data?.message || { role: 'assistant', content: '' };
}

export async function streamOllamaChat(messages, { model, onToken, signal, temperature = 0.45, numPredict = 900 } = {}) {
  await ensureOllamaReady();
  const res = await axios.post(`${ollamaHost()}/api/chat`, {
    model: model || currentOllamaModel(),
    stream: true,
    messages,
    options: { temperature, num_predict: numPredict, num_ctx: 8192 }
  }, {
    responseType: 'stream',
    timeout: CHAT_TIMEOUT,
    signal
  });

  let buffer = '';
  let full = '';
  for await (const chunk of res.data) {
    if (signal?.aborted) break;
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let json;
      try { json = JSON.parse(line); } catch { continue; }
      const piece = json.message?.content || '';
      if (piece) {
        full += piece;
        if (onToken) await onToken(piece);
      }
    }
  }
  return full;
}

export function searchPlannerModel() {
  return currentSearchModel();
}
