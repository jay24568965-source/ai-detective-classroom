/**
 * DeepSeek Chat Completions (OpenAI-compatible).
 * The API key is read from DEEPSEEK_API_KEY at call time and is never logged.
 */
const DEFAULT_BASE = 'https://api.deepseek.com';
const DEFAULT_MODEL = 'deepseek-chat';
const DEFAULT_TIMEOUT_MS = 16000;

function apiKey() {
  const key = process.env.DEEPSEEK_API_KEY;
  if (key == null) return '';
  return String(key).trim();
}

function isConfigured() {
  return apiKey().length > 0;
}

function modelName() {
  const name = process.env.DEEPSEEK_MODEL;
  const trimmed = name == null ? '' : String(name).trim();
  return trimmed || DEFAULT_MODEL;
}

function timeoutMs() {
  const n = Number(process.env.DEEPSEEK_TIMEOUT_MS);
  if (Number.isFinite(n) && n >= 200 && n <= 20000) return n;
  return DEFAULT_TIMEOUT_MS;
}

function messageText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part.text === 'string') return part.text;
        return '';
      })
      .join('');
  }
  return '';
}

function fail(code, message) {
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/**
 * @param {{ messages: Array<{role: string, content: string}>, maxTokens?: number }} opts
 * @returns {Promise<{ text: string, model: string }>}
 */
async function chatComplete({ messages, maxTokens }) {
  const key = apiKey();
  if (!key) throw fail('NO_KEY', 'DEEPSEEK_API_KEY is not set');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs());
  let res;
  try {
    res = await fetch(`${DEFAULT_BASE}/chat/completions`, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: modelName(),
        messages,
        temperature: 0.5,
        max_tokens: maxTokens || 320,
      }),
    });
  } catch (e) {
    if (e && (e.name === 'AbortError' || controller.signal.aborted)) {
      throw fail('TIMEOUT', 'timeout');
    }
    throw fail('NETWORK', 'network');
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    await res.text().catch(() => '');
    throw fail('HTTP', `http ${res.status}`);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw fail('EMPTY', 'empty');
  }

  const choice = data && data.choices && data.choices[0];
  const text = messageText(choice && choice.message && choice.message.content).trim();
  if (!text) throw fail('EMPTY', 'empty');
  return { text, model: (data && data.model) || modelName() };
}

module.exports = {
  isConfigured,
  modelName,
  timeoutMs,
  chatComplete,
};
