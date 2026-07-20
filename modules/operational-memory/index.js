// AM Platform module: operational-memory
// Forest starts here in shadow mode: ingest every routed LINE message, extract
// candidate events/tasks/decisions/knowledge asynchronously, and never mutate
// the existing Notion task path until the tenant owner activates later gates.

import { sendJson } from '../../core/util.js';

let platform = null;
function init(injected) { platform = injected; }

const EXTRACTION_SCHEMA = {
  type: 'object',
  required: ['outcome', 'confidence', 'events'],
  properties: {
    outcome: { type: 'string', enum: ['events_found', 'no_action', 'insufficient_context'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    events: {
      type: 'array',
      maxItems: 12,
      items: {
        type: 'object',
        required: ['event_type', 'summary', 'confidence', 'reason'],
        properties: {
          event_type: {
            type: 'string',
            enum: [
              'task_requested', 'decision_made', 'request_raised', 'issue_raised',
              'progress_reported', 'commitment_made', 'meeting_scheduled', 'risk_raised',
              'information_observed', 'question_raised', 'completion_reported',
              'cancellation_reported', 'change_reported', 'manual_correction', 'approval',
            ],
          },
          summary: { type: 'string' },
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          reason: { type: 'string' },
          topic_thread_key: { type: ['string', 'null'] },
          status: { type: ['string', 'null'] },
          priority: { type: ['string', 'null'] },
          owner: { type: ['string', 'null'] },
          due_at: { type: ['string', 'null'] },
          next_action: { type: ['string', 'null'] },
          project_guess: { type: ['string', 'null'] },
          goal_guess: { type: ['string', 'null'] },
          existing_task_key: { type: ['string', 'null'] },
          knowledge_candidate: { type: 'boolean' },
          knowledge_category: { type: ['string', 'null'] },
          sensitive: { type: 'boolean' },
        },
      },
    },
  },
};

const SHARED_RULES = [
  {
    id: 'shared:topic-thread-before-task', version: '2026.0718.01',
    rule: '先依主題、回覆、時間連續性與明確轉題切 thread，再判斷事件。',
  },
  {
    id: 'shared:update-before-new', version: '2026.0718.01',
    rule: '後續答覆、完成、阻塞、改期或改負責人，優先視為既有任務狀態事件，不重複開新任務。',
  },
  {
    id: 'shared:assistant-command-suppression', version: '2026.0718.01',
    rule: '查詢、列出、打開或更新助理資料的操作指令不是公司任務。',
  },
  {
    id: 'shared:evidence-goal-gate', version: '2026.0718.01',
    rule: '沒有直接來源證據與專案目標連結時只能建立 candidate，不得形成正式任務。',
  },
  {
    id: 'shared:meeting-checkbox-task', version: '2026.0718.01',
    rule: '會議記錄中的 checkbox 是已確認的任務來源；仍須保存會議證據與目標連結。',
  },
];

const ASSISTANT_COMMAND_RE = /^\s*(?:@?\S+\s*)?(?:查|列出|顯示|打開|開啟|搜尋|看一下|更新|修改|標記)(?:目前|今天|本週|第\s*\d+\s*個)?(?:的)?(?:待辦|任務|決策|進度|記錄|資料)(?:\s|$)/i;
const COMMAND_ALIAS_RE = /(謝孟娟|謝夢娟|seven\s*(?:jr|junior)|hozo\s*(?:jr|junior))/i;

function plainProperty(property) {
  if (!property || typeof property !== 'object') return '';
  if (property.type === 'title') return (property.title || []).map((item) => item.plain_text || '').join('');
  if (property.type === 'rich_text') return (property.rich_text || []).map((item) => item.plain_text || '').join('');
  if (property.type === 'select') return property.select?.name || '';
  if (property.type === 'status') return property.status?.name || '';
  if (property.type === 'checkbox') return property.checkbox ? 'true' : 'false';
  return '';
}

function ruleFromPage(page) {
  const properties = page?.properties || {};
  const values = Object.entries(properties).map(([name, value]) => ({ name, value: plainProperty(value) }));
  const title = values.find(({ name }) => /名稱|規則|name|title/i.test(name))?.value
    || values.find(({ value }) => value)?.value
    || page?.id;
  const status = values.find(({ name }) => /狀態|status|啟用/i.test(name))?.value || 'active';
  const active = !/停用|封存|disabled|inactive|archived|false/i.test(status);
  if (!active) return null;
  return {
    id: `notion:${page.id}`,
    version: page.last_edited_time || 'unknown',
    name: title,
    rule: values.map(({ name, value }) => value ? `${name}: ${value}` : '').filter(Boolean).join('；').slice(0, 3000),
  };
}

async function loadRules(ctx) {
  const tenant = ctx.tenant;
  const rules = [...SHARED_RULES];
  const manual = tenant?.operationalMemory?.manualRules;
  if (Array.isArray(manual)) {
    manual.forEach((rule, index) => {
      const text = typeof rule === 'string' ? rule : rule?.rule;
      if (text) rules.push({ id: `tenant:${tenant.key}:manual:${index + 1}`, version: 'tenant-config', rule: String(text) });
    });
  }

  const dataSourceId = tenant?.dataSources?.judgmentRules;
  if (!dataSourceId) {
    return { rules, warning: 'project-local judgment rules data source is not configured' };
  }
  try {
    let cursor = null;
    do {
      const body = { page_size: 100 };
      if (cursor) body.start_cursor = cursor;
      const response = await ctx.notionRequest(`/v1/data_sources/${encodeURIComponent(dataSourceId)}/query`, {
        method: 'POST', body,
      });
      for (const page of response.results || []) {
        const rule = ruleFromPage(page);
        if (rule) rules.push(rule);
      }
      cursor = response.has_more ? response.next_cursor : null;
    } while (cursor);
    return { rules, warning: null };
  } catch (error) {
    return { rules, warning: `judgment rules load failed: ${error.message}` };
  }
}

function isAssistantOperation(text) {
  const value = String(text || '').trim();
  return ASSISTANT_COMMAND_RE.test(value) || (COMMAND_ALIAS_RE.test(value) && /(查|列|顯示|打開|搜尋|看|更新|修改|標記)/.test(value));
}

function extractionPrompt({ tenant, job, context, rules }) {
  const source = job.source || {};
  return [
    `租戶: ${tenant.displayName} (${tenant.key})`,
    `來源時間: ${source.occurred_at || ''}`,
    `LINE 群組: ${source.group_name || source.external_group_key || ''}`,
    `目前訊息: ${source.content_text || '[非文字訊息]'}`,
    '',
    '最近同群對話（由舊到新）:',
    JSON.stringify(context.messages || []),
    '',
    '目前 canonical 任務候選／任務:',
    JSON.stringify(context.tasks || []),
    '',
    '目前有效或候選決策:',
    JSON.stringify(context.decisions || []),
    '',
    '目前專案與目標:',
    JSON.stringify(context.projects || []),
    '',
    '本次已載入規則:',
    rules.map((rule) => `- ${rule.id}@${rule.version}: ${rule.rule}`).join('\n'),
  ].join('\n');
}

function extractionSystem() {
  return [
    '你是 AM Operational Memory 的事件抽取器。使用繁體中文。',
    '你只產生候選事件；不可聲稱已建立正式任務、不可對外採取行動。',
    '先看完整 topic thread，再判斷目前訊息是更新既有任務，還是新的事件。',
    '純背景、致謝、收到、貼圖、測試、重複內容與助理操作指令通常是 no_action。',
    '若訊息補充、完成、取消、阻塞或改期既有事項，輸出相對應狀態事件，不重複 task_requested。',
    '每個事件都要能由目前訊息或同群上下文直接支持；不確定就 insufficient_context。',
    '任務若找不到專案目標，仍可輸出 candidate，但 goal_guess 應為 null 並在 reason 說明。',
    '財務、合約、法律、HR、稅務或對外承諾標 sensitive=true，完成仍需人工確認。',
  ].join('\n');
}

async function onMessage(ctx) {
  const memory = platform?.operationalMemory;
  if (!memory) return false;
  await memory.ingestLineMessage(ctx);
  return false;
}

async function processJob(ctx, job, loadedRules) {
  const memory = platform.operationalMemory;
  const text = String(job.source?.content_text || '').trim();
  if (!text || isAssistantOperation(text)) {
    await memory.storeExtraction(ctx.tenant, job, {
      outcome: 'no_action', confidence: 1, events: [],
      reason: !text ? 'non-text or empty source' : 'assistant operation command suppressed',
    }, {
      promptVersion: 'forest-shadow-v1', model: 'deterministic-suppression', rules: loadedRules.rules,
    });
    return;
  }

  const llm = platform.llmForTenant?.(ctx.tenant) || platform.llm;
  if (!llm?.available) throw new Error('No tenant LLM backend is available for shadow extraction');
  const context = await memory.loadStructuredContext(ctx.tenant, job.source, 24);
  const result = await llm.complete({
    system: extractionSystem(),
    userContent: extractionPrompt({ tenant: ctx.tenant, job, context, rules: loadedRules.rules }),
    schema: EXTRACTION_SCHEMA,
    profile: 'cheap',
    maxTokens: 6000,
    timeoutMs: 60_000,
    budgetMs: 120_000,
  });
  await memory.storeExtraction(ctx.tenant, job, result.data, {
    promptVersion: 'forest-shadow-v1',
    model: result.backend,
    rules: [
      ...loadedRules.rules.map(({ id, version }) => ({ id, version })),
      ...(loadedRules.warning ? [{ id: 'rule-load-warning', version: loadedRules.warning }] : []),
    ],
  });
}

async function tick(ctx) {
  const memory = platform?.operationalMemory;
  if (!memory) return;
  const status = memory.status(ctx.tenant);
  if (!status.enabled || !status.configured) return;
  const loadedRules = await loadRules(ctx);
  const settings = memory.settingsForTenant(ctx.tenant);
  const jobs = await memory.leaseJobs(ctx.tenant, settings.batchSize);
  for (const job of jobs) {
    try {
      await processJob(ctx, job, loadedRules);
    } catch (error) {
      platform.logger.warn(`[operational-memory] extraction failed (tenant=${ctx.tenant.key}, job=${job.job_id}): ${error.message}`);
      await memory.failJob(ctx.tenant, job, error);
    }
  }
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

async function handleMemoryRoute(req, res, ctx) {
  const memory = platform?.operationalMemory;
  if (!memory || !ctx.tenant) return sendJson(res, 503, { error: 'Operational memory is unavailable.' });
  if (!ctx.access?.isTenantAll) return sendJson(res, 403, { error: 'Operational memory dashboard requires tenant-owner access.' });
  const status = memory.status(ctx.tenant);
  if (ctx.pathname === '/memory/api/status') {
    if (!status.configured) return sendJson(res, 200, { status, snapshot: null });
    try {
      return sendJson(res, 200, { status, snapshot: await memory.snapshot(ctx.tenant) });
    } catch (error) {
      return sendJson(res, 503, { status, error: error.message });
    }
  }
  if (ctx.pathname !== '/memory') return sendJson(res, 404, { error: 'Not found' });

  let snapshot = { counts: {}, recent: [] };
  let error = '';
  if (status.configured) {
    try { snapshot = await memory.snapshot(ctx.tenant); }
    catch (caught) { error = caught.message; }
  }
  const counts = snapshot.counts || {};
  const cards = [
    ['來源證據', counts.sources || 0], ['待處理工作', counts.queued_jobs || 0],
    ['事件', counts.events || 0], ['候選任務', counts.candidate_tasks || 0],
    ['候選決策', counts.candidate_decisions || 0], ['候選知識', counts.candidate_knowledge || 0],
  ];
  const rows = (snapshot.recent || []).map((item) => `<tr><td>${esc(item.event_time || '')}</td><td>${esc(item.event_type)}</td><td>${esc(item.event_summary)}</td><td>${esc(item.evidence_excerpt || '')}</td><td>${Math.round(Number(item.confidence || 0) * 100)}%</td></tr>`).join('');
  const html = `<!doctype html><html lang="zh-Hant"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Operational Memory｜${esc(ctx.tenant.displayName)}</title>
  <style>body{font-family:system-ui,'Noto Sans TC',sans-serif;margin:24px;background:#f4f7f5;color:#1f3128}.head{display:flex;justify-content:space-between;align-items:center}.badge{padding:5px 10px;border-radius:999px;background:#fff3cd}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin:18px 0}.card{background:white;padding:16px;border-radius:12px;border:1px solid #dfe8e2}.num{font-size:28px;font-weight:700;color:#287c50}table{width:100%;border-collapse:collapse;background:white}th,td{padding:9px;border:1px solid #dfe8e2;text-align:left;vertical-align:top}th{background:#eaf3ed}.note{padding:12px;background:white;border-left:4px solid #d5a100;margin:12px 0}</style>
  <body><div class="head"><div><h1>${esc(ctx.tenant.displayName)} Operational Memory</h1><p>AM-IMP-2026.0718.01 · PostgreSQL canonical core</p></div><span class="badge">${esc(status.mode)} / query ${esc(status.queryMode)}</span></div>
  ${!status.configured ? '<div class="note">Runtime 已安裝，但尚未設定 AM_MEMORY_DATABASE_URL，因此目前不會寫入或抽取。</div>' : ''}
  ${error ? `<div class="note">資料庫尚未完成 migration：${esc(error)}</div>` : ''}
  <div class="cards">${cards.map(([label, value]) => `<div class="card"><div>${esc(label)}</div><div class="num">${esc(value)}</div></div>`).join('')}</div>
  <h2>最近候選事件與直接證據</h2><table><thead><tr><th>時間</th><th>類型</th><th>摘要</th><th>來源節錄</th><th>信心</th></tr></thead><tbody>${rows || '<tr><td colspan="5">尚無事件。</td></tr>'}</tbody></table></body></html>`;
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  return res.end(html);
}

export default {
  name: 'operational-memory',
  init,
  onMessage,
  tick,
  routes: [
    { prefix: '/memory', access: { kind: 'tenant', capability: 'memory.read' }, handler: handleMemoryRoute },
  ],
};

export const __test = { isAssistantOperation, ruleFromPage, extractionPrompt, EXTRACTION_SCHEMA, SHARED_RULES };
