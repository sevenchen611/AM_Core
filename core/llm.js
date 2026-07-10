// AM Platform core — LLM 抽象層(可插拔後端 + 統一備援鏈)
// ─────────────────────────────────────────────────────────────────────────
// 為什麼放 core 不放 modules:每個模組都要呼叫 AI。以前各模組自己接(meetings 手工
// 串了一段 MiniMax→Gemini),結果是「備援策略散在各處、fallback 路徑從沒被走過」。
// 收斂到這裡之後,備援與成本策略只改一個地方。
//
// 設計要點
//   1. 三家後端一律走「schema 內嵌進 prompt + 寬鬆 JSON 解析」,
//      不依賴任何一家的結構化輸出專屬功能(Anthropic output_config / OpenAI json_mode)。
//      唯有如此,它們才是真的可互換 —— 換一家,行為不變,備援才有意義。
//   2. 鏈序 = 成本閥門。預設 minimax(付費穩、單價低)→ gemini(免費額度)→ anthropic(貴、最後手段)。
//      以 AMCORE_LLM_CHAIN 覆寫。
//   3. imagePaths 存在時,自動只挑「看得見圖」的後端(MiniMax 不支援 → 直接跳過,
//      而不是看不到圖卻硬生出解析結果)。
//   4. 零相依:全部走 fetch,不引入 SDK(平台 npm install 目前是 0 套件)。
//
// 合約(與 HOZO_AM src/llm-backend.js 相同,收編時可直接對接):
//   llm.completeJson({ system, userContent, schema, maxTokens, imagePaths }) → 解析後的物件
//   llm.complete(...) → { data, backend, attempts }   // 想知道實際是誰答的
//   llm.available / llm.backends / llm.selfTest()

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CHAIN = 'minimax,gemini,anthropic';
const DEFAULT_TIMEOUT_MS = 300_000;
const PARSE_ATTEMPTS = 2; // 同一後端吐出無法解析的 JSON 時,再給一次機會

// ── prompt 組裝與寬鬆解析(三家共用)────────────────────────────
function buildPrompt({ system, userContent, schema }) {
  const userText = Array.isArray(userContent)
    ? userContent.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n')
    : String(userContent || '');

  const parts = ['<system-instructions>', String(system || ''), '</system-instructions>', '', '<input>', userText, '</input>'];
  if (schema) {
    parts.push(
      '',
      '## 輸出要求(絕對遵守)',
      '只輸出一個符合以下 JSON Schema 的純 JSON 物件。不要任何前言、說明、markdown 圍欄或結尾文字。',
      JSON.stringify(schema),
    );
  }
  return parts.join('\n');
}

// MiniMax 系列會把思考過程放在 <think>…</think>;裡面的大括號會干擾 JSON 抽取,先剝掉。
function stripThink(t) {
  return String(t || '').replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
}

function extractFirstJsonObject(text) {
  const start = text.indexOf('{');
  if (start < 0) throw new Error('no JSON object found');
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const c = text[i];
    if (escaped) { escaped = false; continue; }
    if (c === '\\') { escaped = true; continue; }
    if (c === '"') inString = !inString;
    if (inString) continue;
    if (c === '{') depth += 1;
    if (c === '}' && --depth === 0) return text.slice(start, i + 1);
  }
  throw new Error('unterminated JSON object');
}

function parseJsonLoose(text, schema) {
  const cleaned = String(text || '')
    .replace(/^[\s\S]*?```(?:json)?\s*/i, (m) => (m.includes('{') ? m.slice(m.indexOf('{')) : ''))
    .replace(/```[\s\S]*$/, '')
    .trim();
  const candidate = cleaned.startsWith('{') ? cleaned : extractFirstJsonObject(String(text || ''));
  const parsed = JSON.parse(candidate);
  for (const key of schema?.required || []) {
    if (!(key in parsed)) throw new Error(`missing required key: ${key}`);
  }
  return parsed;
}

// ── 圖片(附件解析用)─────────────────────────────────────────
const MIME_BY_EXT = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.pdf': 'application/pdf',
};
function readImage(p) {
  const mime = MIME_BY_EXT[path.extname(p).toLowerCase()];
  if (!mime) throw new Error(`unsupported image type: ${p}`);
  return { mime, base64: fs.readFileSync(p).toString('base64') };
}

// ── HTTP(統一逾時)──────────────────────────────────────────
async function postJson(url, { headers, body, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, data };
  } finally {
    clearTimeout(timer);
  }
}

const brief = (o) => JSON.stringify(o).slice(0, 240);

// ── 後端:MiniMax(OpenAI 相容;不支援圖片)──────────────────────
function minimaxBackend({ apiKey, model, baseUrl }) {
  // 平台 .env 的 MINIMAX_API_BASE_URL 已含 /v1;HOZO 的 MINIMAX_BASE_URL 不含。兩種都吃。
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const url = /\/v\d+$/.test(root) ? `${root}/chat/completions` : `${root}/v1/chat/completions`;

  return {
    name: 'minimax',
    model,
    available: Boolean(apiKey),
    supportsImages: false,
    async callRaw({ prompt, maxTokens }) {
      const { ok, status, data } = await postJson(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: prompt }] },
      });
      if (!ok) throw new Error(`MiniMax ${status}: ${brief(data?.error || data?.base_resp || data)}`);
      // MiniMax 有兩種錯誤面貌:HTTP 錯誤碼,或 200 但 base_resp.status_code != 0。
      if (data?.base_resp && Number(data.base_resp.status_code) !== 0) {
        throw new Error(`MiniMax base_resp ${data.base_resp.status_code}: ${data.base_resp.status_msg || 'unknown'}`);
      }
      const content = data?.choices?.[0]?.message?.content;
      if (!content) throw new Error(`MiniMax 無內容 (finish_reason: ${data?.choices?.[0]?.finish_reason || 'unknown'})`);
      return stripThink(content);
    },
  };
}

// ── 後端:Gemini(支援圖片/PDF;免費額度會 429)────────────────
function geminiBackend({ apiKey, model }) {
  return {
    name: 'gemini',
    model,
    available: Boolean(apiKey),
    supportsImages: true,
    async callRaw({ prompt, maxTokens, imagePaths }) {
      const parts = [{ text: prompt }];
      for (const p of imagePaths || []) {
        const { mime, base64 } = readImage(p);
        parts.push({ inline_data: { mime_type: mime, data: base64 } });
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const { ok, status, data } = await postJson(url, {
        body: { contents: [{ parts }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens } },
      });
      if (!ok) throw new Error(`Gemini ${status}: ${brief(data?.error || data)}`);
      const content = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!content) throw new Error(`Gemini 無內容 (finishReason: ${data?.candidates?.[0]?.finishReason || 'unknown'})`);
      return content;
    },
  };
}

// ── 後端:Anthropic(支援圖片;最貴,擺鏈尾當最後手段)───────────
function anthropicBackend({ apiKey, model }) {
  return {
    name: 'anthropic',
    model,
    available: Boolean(apiKey),
    supportsImages: true,
    async callRaw({ prompt, maxTokens, imagePaths }) {
      const content = [];
      for (const p of imagePaths || []) {
        const { mime, base64 } = readImage(p);
        content.push({ type: 'image', source: { type: 'base64', media_type: mime, data: base64 } });
      }
      content.push({ type: 'text', text: prompt });
      const { ok, status, data } = await postJson('https://api.anthropic.com/v1/messages', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: { model, max_tokens: maxTokens, messages: [{ role: 'user', content }] },
      });
      if (!ok) throw new Error(`Anthropic ${status}: ${brief(data?.error || data)}`);
      const textBlock = (data?.content || []).find((b) => b.type === 'text');
      if (!textBlock) throw new Error(`Anthropic 無文字區塊 (stop_reason: ${data?.stop_reason || 'unknown'})`);
      return textBlock.text;
    },
  };
}

// ── 組裝 ────────────────────────────────────────────────────
export function createLlm({ env = process.env, logger = console } = {}) {
  const all = [
    minimaxBackend({
      apiKey: env.MINIMAX_API_KEY || '',
      model: env.MINIMAX_MODEL || env.AMCORE_AI_JUDGE_MODEL || env.BUILD_AI_JUDGE_MODEL || 'MiniMax-M2',
      baseUrl: env.MINIMAX_API_BASE_URL || env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
    }),
    geminiBackend({
      apiKey: env.GEMINI_API_KEY || '',
      model: env.AMCORE_LLM_GEMINI_MODEL || 'gemini-2.5-flash',
    }),
    anthropicBackend({
      apiKey: env.ANTHROPIC_API_KEY || '',
      model: env.ANTHROPIC_MODEL || 'claude-opus-4-8',
    }),
  ];
  const byName = new Map(all.map((b) => [b.name, b]));

  // 鏈序 = 成本閥門。只保留「有金鑰」的後端。
  const chain = String(env.AMCORE_LLM_CHAIN || DEFAULT_CHAIN)
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    .map((n) => byName.get(n))
    .filter((b) => b && b.available);

  if (!chain.length) logger.warn('[llm] 沒有任何可用後端(缺 MINIMAX_API_KEY / GEMINI_API_KEY / ANTHROPIC_API_KEY)。');

  // 依這次呼叫的需求挑出合格後端(要看圖 → 只留看得見圖的)。
  function eligible(imagePaths) {
    if (!imagePaths || !imagePaths.length) return chain;
    return chain.filter((b) => b.supportsImages);
  }

  async function complete({ system, userContent, schema = null, maxTokens = 16000, imagePaths = [] }) {
    const candidates = eligible(imagePaths);
    if (!candidates.length) {
      throw new Error(imagePaths?.length
        ? '沒有支援圖片的 LLM 後端可用(需要 GEMINI_API_KEY 或 ANTHROPIC_API_KEY)。'
        : '沒有可用的 LLM 後端。');
    }

    const prompt = buildPrompt({ system, userContent, schema });
    const failures = [];

    for (const backend of candidates) {
      for (let attempt = 1; attempt <= PARSE_ATTEMPTS; attempt += 1) {
        try {
          const raw = await backend.callRaw({ prompt, maxTokens, imagePaths });
          const data = schema ? parseJsonLoose(raw, schema) : raw;
          if (failures.length) logger.log(`[llm] ${backend.name} 接手成功(前面失敗:${failures.map((f) => f.backend).join(', ')})`);
          return { data, backend: backend.name, attempts: failures.length + attempt };
        } catch (error) {
          const last = attempt === PARSE_ATTEMPTS;
          if (last) {
            failures.push({ backend: backend.name, message: error.message });
            logger.warn(`[llm] ${backend.name} 失敗,改用下一個後端: ${error.message}`);
          }
        }
      }
    }

    throw new Error(`所有 LLM 後端都失敗 → ${failures.map((f) => `${f.backend}(${f.message})`).join('; ')}`);
  }

  return {
    available: chain.length > 0,
    backends: chain.map((b) => ({ name: b.name, model: b.model, supportsImages: b.supportsImages })),
    complete,
    // 與 HOZO_AM 的 completeJson 合約相同,收編模組可直接對接。
    async completeJson(opts) {
      const { data } = await complete({ ...opts, schema: opts.schema || { type: 'object' } });
      return data;
    },
    // 純文字(meetings 的摘要/名單解析用),不套 schema。
    async completeText(opts) {
      const { data } = await complete({ ...opts, schema: null });
      return String(data || '').trim();
    },
    async selfTest() {
      try {
        const { data, backend } = await complete({
          system: '你是自我測試器。', userContent: '回覆 {"pong": true}',
          schema: { type: 'object', required: ['pong'] }, maxTokens: 200,
        });
        return { ok: data.pong === true, backend };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
  };
}
