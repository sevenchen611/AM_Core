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
//   3. imagePaths 存在時,自動只挑「看得見圖」的後端(看不見的直接跳過,
//      而不是看不到圖卻硬生出解析結果)。
//   3b. 重試分三類(見下方 classify):暫時性錯誤退避重試同一後端,解析失敗立刻重試,
//      確定性錯誤(金鑰錯/模型不存在)不重試直接換人。三者混為一談會既慢又救不回來。
//   4. 零相依:全部走 fetch,不引入 SDK(平台 npm install 目前是 0 套件)。
//
// 合約(與 HOZO_AM src/llm-backend.js 相同,收編時可直接對接):
//   llm.completeJson({ system, userContent, schema, maxTokens, imagePaths, profile, chain }) → 解析後的物件
//   llm.completeText({ ... 同上 }) → 純文字
//   llm.complete(...) → { data, backend, attempts }   // 想知道實際是誰答的
//   llm.available / llm.backends / llm.profiles / llm.selfTest()
//
//   profile:'quality' → 長逐字稿、要品質(assemblyai gateway 當頭)
//   profile:'cheap'   → 短 prompt、每則訊息都跑(＝預設鏈,minimax 當頭)
//   chain:'a,b,c'     → 直接指名鏈序(蓋過 profile)
//   兩者指名的後端若全不可用,會退回預設鏈,不會變成空鏈。

import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_CHAIN = 'minimax,gemini,anthropic';
const DEFAULT_TIMEOUT_MS = 300_000;

// ── 失敗分類:三種失敗的正確處置相反,別混為一談 ─────────────
//   transient 429 / 5xx / 網路例外 / timeout → 退避後重試同一後端
//   parse     JSON 解不出來 / 回傳空內容      → 立刻重試,sleep 是純浪費
//   fatal     400 / 401 / 403(金鑰錯、模型不存在)→ 不重試,直接換下一個後端
//
// 註:單靠 `retryable` 布林蓋不住三種處置——「回傳空內容」沒有 HTTP status,
//    會被誤判成 retryable 而白白睡 24 秒。所以以 kind 分流,retryable 僅供觀測。
const PARSE_ATTEMPTS = 2;       // 解析類:共 2 次,不 sleep
const TRANSIENT_ATTEMPTS = 3;   // 暫時性:共 3 次,退避 8s → 16s(單一後端最壞 24s)
const TRANSIENT_BASE_DELAY_MS = 8000;

const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

function httpError(name, status, detail) {
  const transient = status === 429 || status >= 500;
  const e = new Error(`${name} ${status}: ${detail}`);
  e.status = status;
  e.retryable = transient;
  e.kind = transient ? 'transient' : 'fatal';
  return e;
}

function taggedError(kind, message) {
  const e = new Error(message);
  e.kind = kind;
  e.retryable = kind === 'transient';
  return e;
}

// 沒帶 kind 的例外 = fetch 自己丟的(TypeError / AbortError 逾時)→ 當暫時性。
function classify(error) {
  return error?.kind || 'transient';
}

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
  if (!mime) throw taggedError('fatal', `unsupported image type: ${p}`);
  try {
    return { mime, base64: fs.readFileSync(p).toString('base64') };
  } catch (e) {
    // 檔案讀不到是確定性錯誤,重試三次還睡 24 秒毫無意義。
    throw taggedError('fatal', `讀取圖片失敗 ${p}: ${e.message}`);
  }
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

// ── 後端:MiniMax(OpenAI 相容)────────────────────────────────
// 視覺能力依「型號」而定,不是整家廠商的屬性:
//   M3  原生多模態(ViT encoder,吃 text/image/video)—— 2026-07-10 以四象限彩圖實測通過
//   M2  純文字 —— 帶圖呼叫會回「請提供圖片。」(圖被丟掉,模型卻照樣答)
// HOZO 的 llm-backend.js 註明「minimax 不支援圖片」,那是 M2 時代的事實,別再沿用。
const MINIMAX_VISION_RE = /(^|[-_])m3\b/i;
function minimaxSeesImages(model, override) {
  if (override === '1' || override === 'true') return true;
  if (override === '0' || override === 'false') return false;
  return MINIMAX_VISION_RE.test(String(model || ''));
}

function minimaxBackend({ apiKey, model, baseUrl, visionOverride }) {
  // 平台 .env 的 MINIMAX_API_BASE_URL 已含 /v1;HOZO 的 MINIMAX_BASE_URL 不含。兩種都吃。
  const root = String(baseUrl || '').replace(/\/+$/, '');
  const url = /\/v\d+$/.test(root) ? `${root}/chat/completions` : `${root}/v1/chat/completions`;

  return {
    name: 'minimax',
    model,
    available: Boolean(apiKey),
    supportsImages: minimaxSeesImages(model, visionOverride),
    async callRaw({ prompt, maxTokens, imagePaths }) {
      let userMessage = prompt;
      if (imagePaths && imagePaths.length) {
        // OpenAI 相容的 image_url + data URL。PDF 不走這條(端點只吃圖),丟錯讓鏈落到 Gemini。
        const parts = [{ type: 'text', text: prompt }];
        for (const p of imagePaths) {
          const { mime, base64 } = readImage(p);
          if (!mime.startsWith('image/')) throw new Error(`MiniMax 不吃 ${mime}(只吃圖片)`);
          parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } });
        }
        userMessage = parts;
      }
      const { ok, status, data } = await postJson(url, {
        headers: { authorization: `Bearer ${apiKey}` },
        body: { model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: userMessage }] },
      });
      if (!ok) throw httpError('MiniMax', status, brief(data?.error || data?.base_resp || data));
      // MiniMax 有兩種錯誤面貌:HTTP 錯誤碼,或 200 但 base_resp.status_code != 0。
      if (data?.base_resp && Number(data.base_resp.status_code) !== 0) {
        const code = Number(data.base_resp.status_code);
        // 1001 逾時 / 1002 觸發限流 / 1013 內部錯誤 → 值得退避重試;其餘(1004 認證、
        // 1008 餘額不足、2013 參數錯誤)是確定性的,重試只是浪費。
        const kind = [1001, 1002, 1013].includes(code) ? 'transient' : 'fatal';
        throw taggedError(kind, `MiniMax base_resp ${code}: ${data.base_resp.status_msg || 'unknown'}`);
      }
      // ⚠️ 空值檢查必須在 stripThink「之後」。MiniMax 是推理模型:當它把 max_tokens
      // 燒光在 <think>…</think> 裡(finish_reason=length),content 非空但剝完是空的。
      // 先檢查再剝,等於放行一個空字串出去。
      const cleaned = stripThink(data?.choices?.[0]?.message?.content);
      if (!cleaned) throw taggedError('parse', `MiniMax 無內容 (finish_reason: ${data?.choices?.[0]?.finish_reason || 'unknown'})`);
      return cleaned;
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
      if (!ok) throw httpError('Gemini', status, brief(data?.error || data));
      const content = (data?.candidates?.[0]?.content?.parts || []).map((p) => p.text || '').join('');
      if (!content) throw taggedError('parse', `Gemini 無內容 (finishReason: ${data?.candidates?.[0]?.finishReason || 'unknown'})`);
      return content;
    },
  };
}

// ── 後端:AssemblyAI LLM Gateway(OpenAI 相容;轉售 Claude/GPT/Gemini/Qwen/Kimi)──
// AssemblyAI 的「分析」不是特殊能力,它就是個 LLM 代理。auth 用原始金鑰、不加 Bearer
// (與 AssemblyAI 轉寫端點一致)。模型清單:GET https://llm-gateway.assemblyai.com/v1/models
//
// ⚠️ ASSEMBLYAI_API_KEY 早已存在(轉寫在用),所以此後端一加入就是 available。
//    它「不在」DEFAULT_CHAIN 裡是刻意的——只有明確指名 profile:'quality' 才會用到它,
//    否則每則 LINE 訊息初判都會去打 Claude,錢燒得莫名其妙。
//
// ⚠️ 韌性鐵律:任何鏈裡至少保留一個「非 AssemblyAI」的廠商。轉寫已經押在 AssemblyAI,
//    若摘要也只走 Gateway,AssemblyAI 一掛就同時失去轉寫與摘要。quality 鏈的第二順位
//    因此是「直連 Gemini(我們自己的金鑰)」,而不是 Gateway 裡轉售的 gemini。
function assemblyaiBackend({ apiKey, model }) {
  return {
    name: 'assemblyai',
    model,
    available: Boolean(apiKey),
    supportsImages: false, // 未驗證 gateway 的多模態請求形狀,先關;要開請先實測(scripts/check-llm.mjs)
    async callRaw({ prompt, maxTokens }) {
      const { ok, status, data } = await postJson('https://llm-gateway.assemblyai.com/v1/chat/completions', {
        headers: { authorization: apiKey },
        body: { model, max_tokens: maxTokens, temperature: 0.2, messages: [{ role: 'user', content: prompt }] },
      });
      if (!ok) throw httpError('AssemblyAI Gateway', status, brief(data?.error || data));
      const cleaned = stripThink(data?.choices?.[0]?.message?.content);
      if (!cleaned) throw taggedError('parse', `AssemblyAI Gateway 無內容 (finish_reason: ${data?.choices?.[0]?.finish_reason || 'unknown'})`);
      return cleaned;
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
      if (!ok) throw httpError('Anthropic', status, brief(data?.error || data));
      const textBlock = (data?.content || []).find((b) => b.type === 'text');
      if (!textBlock) throw taggedError('parse', `Anthropic 無文字區塊 (stop_reason: ${data?.stop_reason || 'unknown'})`);
      return textBlock.text;
    },
  };
}

// ── 組裝 ────────────────────────────────────────────────────
// sleep 可注入:測試用 no-op 跑完退避邏輯而不真的等 24 秒。
export function createLlm({ env = process.env, logger = console, sleep = sleepReal } = {}) {
  const all = [
    minimaxBackend({
      apiKey: env.MINIMAX_API_KEY || '',
      model: env.MINIMAX_MODEL || env.AMCORE_AI_JUDGE_MODEL || env.BUILD_AI_JUDGE_MODEL || 'MiniMax-M2',
      baseUrl: env.MINIMAX_API_BASE_URL || env.MINIMAX_BASE_URL || 'https://api.minimax.io/v1',
      // 換型號時若自動偵測判錯,用 AMCORE_LLM_MINIMAX_VISION=1/0 手動覆寫。
      visionOverride: env.AMCORE_LLM_MINIMAX_VISION || '',
    }),
    geminiBackend({
      apiKey: env.GEMINI_API_KEY || '',
      model: env.AMCORE_LLM_GEMINI_MODEL || 'gemini-2.5-flash',
    }),
    assemblyaiBackend({
      apiKey: env.ASSEMBLYAI_API_KEY || '',
      model: env.AMCORE_LLM_ASSEMBLYAI_MODEL || 'claude-haiku-4-5-20251001',
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

  // ── per-call 鏈序(profile)────────────────────────────────
  // 全域一條鏈滿足不了兩種相反的呼叫者:
  //   quality — meetings:每天幾場、長逐字稿、要品質(實測 gateway 三模型 9/9,MiniMax 每三次掛一次)
  //   cheap   — triage :每則 LINE 訊息都跑、prompt 很短、不該為此打 Claude
  // ⚠️ 上面的 MiniMax 失敗率是「針對長逐字稿」量到的。短訊息初判 MiniMax 可能好好的,
  //    沒測過就別當已證實 —— 所以 cheap 維持現況,不動 triage。
  const PROFILES = {
    quality: env.AMCORE_LLM_CHAIN_QUALITY || 'assemblyai,gemini,minimax',
    cheap: env.AMCORE_LLM_CHAIN_CHEAP || env.AMCORE_LLM_CHAIN || DEFAULT_CHAIN,
  };

  // 指名的後端全都不可用時退回預設鏈,不要靜默變成空鏈(那會讓呼叫直接失敗)。
  function resolveChain(spec) {
    if (!spec) return chain;
    const names = Array.isArray(spec) ? spec : String(spec).split(',');
    const picked = names
      .map((n) => byName.get(String(n).trim().toLowerCase()))
      .filter((b) => b && b.available);
    return picked.length ? picked : chain;
  }

  // 依這次呼叫的需求挑出合格後端(要看圖 → 只留看得見圖的)。
  function eligible(imagePaths, spec) {
    const base = resolveChain(spec);
    if (!imagePaths || !imagePaths.length) return base;
    return base.filter((b) => b.supportsImages);
  }

  async function complete({
    system, userContent, schema = null, maxTokens = 16000, imagePaths = [],
    profile = null, chain: chainSpec = null,
  }) {
    const candidates = eligible(imagePaths, chainSpec || (profile && PROFILES[profile]));
    if (!candidates.length) {
      throw new Error(imagePaths?.length
        ? '沒有支援圖片的 LLM 後端可用(需要 GEMINI_API_KEY 或 ANTHROPIC_API_KEY)。'
        : '沒有可用的 LLM 後端。');
    }

    const prompt = buildPrompt({ system, userContent, schema });
    const failures = [];
    let totalAttempts = 0;

    // 打一次,並把「空回應」與「解析失敗」都標成 parse 類。
    async function attemptOnce(backend) {
      const raw = await backend.callRaw({ prompt, maxTokens, imagePaths });
      // 空回應一律當失敗。有 schema 時 parseJsonLoose('') 本來就會拋錯,但
      // completeText(schema=null)會把 '' 當成功回傳 → 靜默失敗、永不落備援。
      // 擋在這裡,四家後端 × 兩個入口一次全保護。
      if (!String(raw || '').trim()) {
        throw taggedError('parse', `${backend.name} 回傳空內容(推理可能吃光 max_tokens)`);
      }
      if (!schema) return raw;
      try {
        return parseJsonLoose(raw, schema);
      } catch (e) {
        throw taggedError('parse', `${backend.name} 回傳無法解析的 JSON: ${e.message}`);
      }
    }

    for (const backend of candidates) {
      let transientTries = 0;
      let parseTries = 0;

      // 依失敗類別決定「重試同一後端」或「換下一個後端」。
      // 退避只吃短暫抖動;跨不過 Gemini 完整的 60 秒限流窗口是刻意的取捨——
      // 韌性主要由「換後端」承擔(quality 鏈頭 assemblyai 是付費、不受免費額度限流),
      // 不值得為了湊滿 60 秒把單一後端卡死一分鐘、拖慢整條鏈。
      for (;;) {
        totalAttempts += 1;
        try {
          const data = await attemptOnce(backend);
          if (failures.length) logger.log(`[llm] ${backend.name} 接手成功(前面失敗:${failures.map((f) => f.backend).join(', ')})`);
          return { data, backend: backend.name, attempts: totalAttempts };
        } catch (error) {
          const kind = classify(error);

          if (kind === 'transient' && transientTries + 1 < TRANSIENT_ATTEMPTS) {
            transientTries += 1;
            const delay = transientTries * TRANSIENT_BASE_DELAY_MS;
            logger.warn(`[llm] ${backend.name} 暫時性失敗(${error.message}),${delay / 1000}s 後重試`);
            await sleep(delay);
            continue;
          }
          if (kind === 'parse' && parseTries + 1 < PARSE_ATTEMPTS) {
            parseTries += 1;
            continue; // 立刻重試,不 sleep
          }

          failures.push({ backend: backend.name, kind, message: error.message });
          logger.warn(`[llm] ${backend.name} 失敗(${kind}),改用下一個後端: ${error.message}`);
          break;
        }
      }
    }

    throw new Error(`所有 LLM 後端都失敗 → ${failures.map((f) => `${f.backend}/${f.kind}(${f.message})`).join('; ')}`);
  }

  const describe = (b) => ({ name: b.name, model: b.model, supportsImages: b.supportsImages });

  return {
    available: chain.length > 0,
    backends: chain.map(describe),                       // 預設鏈(＝不指名 profile 時會用的)
    allBackends: all.filter((b) => b.available).map(describe), // 有金鑰、可被 profile 指名的全部
    profiles: PROFILES,
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
