/**
 * 工程合約控制中心的可嵌入前端元件。
 *
 * 此檔不讀取合約 snapshot，也不在前端推導簽署或付款狀態；所有顯示值均由
 * control-center read model API 提供。contracts.js 之後只需要將
 * renderContractControlCenter() 的結果插入既有頁面即可。
 */

export const CONTRACT_CONTROL_CENTER_SUMMARY_PATH = '/contracts/api/v2/control-center';
export const CONTRACT_CONTROL_CENTER_DETAIL_PATH = '/contracts/api/v2/contracts/:contractId/control';
export const CONTRACT_CONTROL_CENTER_REFRESH_MS = 15_000;

const DEFAULT_ROOT_ID = 'engineering-contract-control-center';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

/**
 * 可在既有 contracts.js 模板內直接嵌入。
 * tenantKey/apiKey 僅作既有頁面 query 授權轉送，server 仍必須重新做權限檢查。
 */
export function renderContractControlCenter(options = {}) {
  const rootId = String(options.rootId || DEFAULT_ROOT_ID);
  const config = {
    rootId,
    tenantKey: String(options.tenantKey || ''),
    apiKey: String(options.apiKey || ''),
    summaryPath: String(options.summaryPath || CONTRACT_CONTROL_CENTER_SUMMARY_PATH),
    detailPath: String(options.detailPath || CONTRACT_CONTROL_CENTER_DETAIL_PATH),
    refreshMs: Number.isSafeInteger(options.refreshMs) && options.refreshMs >= 5_000
      ? options.refreshMs : CONTRACT_CONTROL_CENTER_REFRESH_MS,
  };
  return `${controlCenterMarkup(config)}<script>${contractControlCenterClientScript(config)}</script>`;
}

/** 提供給 CSP nonce 頁面：呼叫端可分別輸出 markup 與 script。 */
export function renderContractControlCenterMarkup(options = {}) {
  return controlCenterMarkup({ rootId: String(options.rootId || DEFAULT_ROOT_ID) });
}

/** 提供給 CSP nonce 頁面：回傳可放入 nonce script 標籤的 client 程式。 */
export function contractControlCenterClientScript(options = {}) {
  const config = {
    rootId: String(options.rootId || DEFAULT_ROOT_ID),
    tenantKey: String(options.tenantKey || ''),
    apiKey: String(options.apiKey || ''),
    summaryPath: String(options.summaryPath || CONTRACT_CONTROL_CENTER_SUMMARY_PATH),
    detailPath: String(options.detailPath || CONTRACT_CONTROL_CENTER_DETAIL_PATH),
    refreshMs: Number.isSafeInteger(options.refreshMs) && options.refreshMs >= 5_000
      ? options.refreshMs : CONTRACT_CONTROL_CENTER_REFRESH_MS,
  };
  return `
(() => {
  'use strict';
  const DEFAULT_CONFIG = ${escapeScriptJson(config)};
  const QUEUES = [
    ['pending_signing', '待簽署'],
    ['pending_internal_confirmation', '待我方確認'],
    ['payment', '付款管理'],
    ['acceptance', '驗收管理'],
    ['data_health', '資料異常'],
  ];
  const text = value => String(value ?? '').trim();
  const object = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const array = value => Array.isArray(value) ? value : [];
  const el = (tag, className = '') => { const node = document.createElement(tag); if (className) node.className = className; return node; };
  const setText = (node, value, fallback = '—') => { node.textContent = text(value) || fallback; return node; };
  const formatTime = value => {
    const raw = text(value); if (!raw) return '未記錄';
    const date = new Date(raw); if (Number.isNaN(date.getTime())) return raw;
    return new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short', hour12: false }).format(date);
  };
  const asPayload = value => object(value).data && typeof object(value).data === 'object' ? object(value).data : object(value);
  const classForHealth = value => {
    const normalized = text(value).toLowerCase();
    return normalized === 'healthy' || normalized === '正常' ? 'healthy' : normalized ? 'attention' : 'unknown';
  };
  function label(value, fallback = '尚未提供') { return text(value) || fallback; }
  function party(value) {
    const input = object(value);
    return {
      label: label(input.label || input.statusLabel || input.status),
      status: text(input.status),
      signedAt: text(input.signedAt),
      sentAt: text(input.sentAt),
      receivedAt: text(input.receivedAt),
      holder: text(input.holder),
      detail: text(input.detail || input.note),
    };
  }
  function contract(value) {
    const input = object(value);
    const parties = object(input.parties);
    return {
      id: text(input.contractId || input.id),
      contractNumber: text(input.contractNumber || input.number),
      title: text(input.title || input.name),
      projectName: text(input.projectName || input.projectLabel),
      overallStatus: label(input.overallStatus || input.statusLabel || input.workflowStatus),
      workflowStatus: text(input.workflowStatus || input.status),
      partyA: party(input.partyA || parties.partyA),
      partyB: party(input.partyB || parties.partyB),
      currentHolder: label(input.currentHolder || input.currentHolderLabel),
      nextAction: label(input.nextAction || input.nextActionLabel),
      nextActionOwner: text(input.nextActionOwner || input.nextActionOwnerLabel),
      dueAt: text(input.dueAt),
      paymentStatus: label(input.paymentStatus || object(input.payment).label || object(input.payment).status),
      acceptanceStatus: label(input.acceptanceStatus || object(input.acceptance).label || object(input.acceptance).status),
      health: label(input.dataHealth || object(input.health).label || object(input.health).status, '未檢查'),
      healthCode: text(input.dataHealth || object(input.health).status),
      lastEventAt: text(input.lastEventAt || input.updatedAt),
      queueKeys: array(input.queueKeys || input.queues).map(text).filter(Boolean),
      blockers: array(input.blockers).map(item => typeof item === 'string' ? item : text(object(item).label || object(item).message)).filter(Boolean),
      raw: input,
    };
  }
  function summary(value) {
    const payload = asPayload(value);
    const queueCounts = object(payload.queueCounts || payload.queues);
    const records = array(payload.contracts || payload.items || payload.records).map(contract).filter(item => item.id);
    return { records, queueCounts, generatedAt: text(payload.generatedAt || payload.refreshedAt) };
  }
  function queueCount(summaryValue, key) {
    const named = object(summaryValue.queueCounts)[key];
    if (typeof named === 'number') return named;
    if (named && typeof named === 'object' && Number.isFinite(Number(named.count))) return Number(named.count);
    return summaryValue.records.filter(item => item.queueKeys.includes(key)).length;
  }
  function queryUrl(path, state) {
    const url = new URL(path, window.location.origin);
    if (state.config.tenantKey) url.searchParams.set('tenant', state.config.tenantKey);
    if (state.config.apiKey) url.searchParams.set('key', state.config.apiKey);
    return url.pathname + url.search;
  }
  async function getJson(path, state) {
    const response = await fetch(queryUrl(path, state), {
      method: 'GET', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(text(result.error?.message || result.error) || '目前無法取得合約控制資料。');
    return result;
  }
  function statusMessage(state, message, kind = '') {
    state.nodes.status.textContent = message;
    state.nodes.status.className = 'am-contract-control-status ' + kind;
  }
  function setBusy(state, busy) {
    state.busy = busy;
    state.nodes.refresh.disabled = busy;
    state.root.setAttribute('aria-busy', busy ? 'true' : 'false');
    state.nodes.refresh.textContent = busy ? '更新中…' : '重新整理';
  }
  function visibleRecords(state) {
    return state.activeQueue ? state.summary.records.filter(item => item.queueKeys.includes(state.activeQueue)) : state.summary.records;
  }
  function dataCell(caption, value, className = '') {
    const cell = el('div', 'am-contract-control-cell ' + className);
    const labelNode = el('span', 'am-contract-control-caption'); labelNode.textContent = caption;
    const valueNode = el('span', 'am-contract-control-value'); valueNode.textContent = value;
    cell.append(labelNode, valueNode); return cell;
  }
  function renderQueues(state) {
    state.nodes.queues.replaceChildren();
    for (const [key, title] of QUEUES) {
      const button = el('button', 'am-contract-control-chip' + (state.activeQueue === key ? ' active' : ''));
      button.type = 'button'; button.dataset.queue = key; button.setAttribute('aria-pressed', state.activeQueue === key ? 'true' : 'false');
      const name = el('span'); name.textContent = title;
      const count = el('strong'); count.textContent = String(queueCount(state.summary, key));
      button.append(name, count);
      button.addEventListener('click', () => { state.activeQueue = state.activeQueue === key ? '' : key; render(state); });
      state.nodes.queues.append(button);
    }
  }
  function renderList(state) {
    const records = visibleRecords(state);
    state.nodes.count.textContent = state.activeQueue ? '目前顯示 ' + records.length + ' 份合約' : '共 ' + records.length + ' 份合約';
    state.nodes.list.replaceChildren();
    if (!records.length) {
      const empty = el('div', 'am-contract-control-empty');
      empty.textContent = state.activeQueue ? '此佇列目前沒有合約。' : '目前沒有可顯示的合約控制資料。';
      state.nodes.list.append(empty); return;
    }
    records.forEach(item => {
      const row = el('button', 'am-contract-control-row'); row.type = 'button'; row.dataset.contractId = item.id;
      row.setAttribute('aria-label', '開啟 ' + (item.contractNumber || item.title || '工程合約') + ' 的控制詳情');
      const identity = el('div', 'am-contract-control-identity');
      const number = el('strong'); number.textContent = item.contractNumber || '未編號合約';
      const title = el('span'); title.textContent = item.title || '未命名工程合約';
      const project = el('small'); project.textContent = item.projectName || '未提供工程專案';
      identity.append(number, title, project);
      const status = dataCell('目前狀態', item.overallStatus, 'state');
      const partyA = dataCell('甲方', item.partyA.label, 'party-a');
      const partyB = dataCell('乙方', item.partyB.label, 'party-b');
      const next = dataCell('下一步', item.nextAction + (item.nextActionOwner ? '｜' + item.nextActionOwner : ''), 'next');
      const payment = dataCell('付款', item.paymentStatus, 'payment');
      const acceptance = dataCell('驗收', item.acceptanceStatus, 'acceptance');
      const health = dataCell('健康度', item.health, 'health ' + classForHealth(item.healthCode || item.health));
      const when = dataCell('最近事件', formatTime(item.lastEventAt), 'last-event');
      row.append(identity, status, partyA, partyB, next, payment, acceptance, health, when);
      row.addEventListener('click', () => openDetail(state, item.id, row));
      state.nodes.list.append(row);
    });
  }
  function render(state) { renderQueues(state); renderList(state); }
  function detailParty(title, current) {
    const card = el('section', 'am-contract-control-party-card');
    const heading = el('h4'); heading.textContent = title;
    const stateLine = el('p', 'am-contract-control-party-state'); stateLine.textContent = current.label;
    const list = el('dl');
    [['送出時間', current.sentAt], ['收到時間', current.receivedAt], ['簽署時間', current.signedAt], ['目前持有人', current.holder], ['說明', current.detail]].forEach(([name, value]) => {
      if (!value) return; const term = el('dt'); term.textContent = name; const definition = el('dd'); definition.textContent = name.endsWith('時間') ? formatTime(value) : value; list.append(term, definition);
    });
    card.append(heading, stateLine); if (list.childElementCount) card.append(list); return card;
  }
  function detailField(title, value) { const block = el('div', 'am-contract-control-detail-field'); const caption = el('span'); caption.textContent = title; const output = el('strong'); output.textContent = value; block.append(caption, output); return block; }
  function renderTimeline(container, detail) {
    const events = array(detail.timeline || detail.events || detail.activity).map(object);
    container.replaceChildren();
    if (!events.length) { const empty = el('p', 'am-contract-control-empty'); empty.textContent = '尚未提供可顯示的合約事件。'; container.append(empty); return; }
    events.forEach(event => {
      const item = el('li'); const name = el('strong'); name.textContent = label(event.label || event.type || event.title);
      const meta = el('span'); meta.textContent = formatTime(event.occurredAt || event.at || event.createdAt) + (text(event.actor || event.owner) ? '｜' + text(event.actor || event.owner) : '');
      const note = el('p'); note.textContent = text(event.description || event.note || event.summary);
      item.append(name, meta); if (note.textContent) item.append(note); container.append(item);
    });
  }
  function renderDetail(state, response, fallback) {
    const detail = asPayload(response);
    const item = contract(detail.contract || detail.item || detail.summary || fallback.raw);
    state.nodes.drawerTitle.textContent = (item.contractNumber ? item.contractNumber + '｜' : '') + (item.title || '工程合約控制詳情');
    state.nodes.drawerMeta.textContent = item.projectName || '未提供工程專案';
    state.nodes.drawerSummary.replaceChildren(
      detailField('目前狀態', item.overallStatus), detailField('目前持有人', item.currentHolder),
      detailField('下一步', item.nextAction + (item.nextActionOwner ? '｜' + item.nextActionOwner : '')),
      detailField('應完成時間', item.dueAt ? formatTime(item.dueAt) : '未設定'),
      detailField('付款', item.paymentStatus), detailField('驗收', item.acceptanceStatus),
      detailField('資料健康度', item.health), detailField('最近事件', formatTime(item.lastEventAt)),
    );
    state.nodes.parties.replaceChildren(detailParty('甲方簽署狀態', item.partyA), detailParty('乙方簽署狀態', item.partyB));
    state.nodes.blockers.replaceChildren();
    const blockers = array(detail.blockers || item.blockers).map(value => typeof value === 'string' ? value : text(object(value).label || object(value).message)).filter(Boolean);
    state.nodes.blockers.hidden = !blockers.length;
    blockers.forEach(value => { const li = el('li'); li.textContent = value; state.nodes.blockers.append(li); });
    renderTimeline(state.nodes.timeline, detail);
    state.nodes.drawer.hidden = false; state.nodes.drawer.setAttribute('aria-hidden', 'false');
    state.nodes.close.focus();
  }
  function closeDetail(state) {
    if (state.nodes.drawer.hidden) return;
    state.nodes.drawer.hidden = true; state.nodes.drawer.setAttribute('aria-hidden', 'true');
    if (state.lastTrigger?.isConnected) state.lastTrigger.focus();
  }
  async function openDetail(state, contractId, trigger) {
    const fallback = state.summary.records.find(item => item.id === contractId); if (!fallback) return;
    state.lastTrigger = trigger; state.nodes.drawer.hidden = false; state.nodes.drawer.setAttribute('aria-hidden', 'false');
    state.nodes.drawerTitle.textContent = '正在讀取合約控制詳情…'; state.nodes.drawerMeta.textContent = '';
    state.nodes.drawerSummary.replaceChildren(); state.nodes.parties.replaceChildren(); state.nodes.timeline.replaceChildren(); state.nodes.blockers.hidden = true;
    try { const path = state.config.detailPath.replace(':contractId', encodeURIComponent(contractId)); renderDetail(state, await getJson(path, state), fallback); }
    catch (error) { state.nodes.drawerSummary.replaceChildren(); const message = el('p', 'am-contract-control-error'); message.textContent = error.message || '目前無法取得詳情。'; state.nodes.drawerSummary.append(message); state.nodes.close.focus(); }
  }
  async function refresh(state, reason = 'manual') {
    if (state.busy) return;
    const hadData = state.summary.records.length > 0; setBusy(state, true);
    if (!hadData) statusMessage(state, '正在載入工程合約控制資料…');
    try {
      state.summary = summary(await getJson(state.config.summaryPath, state));
      state.lastSuccessAt = Date.now(); render(state);
      delete state.root.dataset.stale;
      statusMessage(state, '已於 ' + formatTime(new Date().toISOString()) + ' 更新。');
    } catch (error) {
      const stale = hadData ? '目前顯示的是先前資料，可能不是最新狀態。' : '';
      statusMessage(state, (error.message || '目前無法取得合約控制資料。') + stale, 'error');
      if (hadData) state.root.dataset.stale = 'true';
    } finally { setBusy(state, false); }
  }
  function mount(root, input = {}) {
    if (!root) throw new Error('找不到工程合約控制中心容器。');
    if (root.__amContractControlCenter) return root.__amContractControlCenter;
    const config = { ...DEFAULT_CONFIG, ...object(input) };
    const state = {
      root, config, summary: { records: [], queueCounts: {} }, activeQueue: '', busy: false, lastSuccessAt: 0, lastTrigger: null,
      nodes: {
        queues: root.querySelector('[data-contract-control-queues]'), count: root.querySelector('[data-contract-control-count]'),
        list: root.querySelector('[data-contract-control-list]'), status: root.querySelector('[data-contract-control-status]'),
        refresh: root.querySelector('[data-contract-control-refresh]'), drawer: root.querySelector('[data-contract-control-drawer]'),
        close: root.querySelector('[data-contract-control-close]'), drawerTitle: root.querySelector('[data-contract-control-drawer-title]'),
        drawerMeta: root.querySelector('[data-contract-control-drawer-meta]'), drawerSummary: root.querySelector('[data-contract-control-detail-summary]'),
        parties: root.querySelector('[data-contract-control-parties]'), blockers: root.querySelector('[data-contract-control-blockers]'), timeline: root.querySelector('[data-contract-control-timeline]'),
      },
    };
    if (Object.values(state.nodes).some(node => !node)) throw new Error('工程合約控制中心 HTML 結構不完整。');
    state.nodes.refresh.addEventListener('click', () => refresh(state));
    state.nodes.close.addEventListener('click', () => closeDetail(state));
    state.nodes.drawer.addEventListener('click', event => { if (event.target === state.nodes.drawer) closeDetail(state); });
    root.addEventListener('keydown', event => { if (event.key === 'Escape') closeDetail(state); });
    const focusHandler = () => refresh(state, 'focus'); window.addEventListener('focus', focusHandler);
    const timer = window.setInterval(() => refresh(state, 'interval'), config.refreshMs);
    const controller = { refresh: () => refresh(state), destroy: () => { window.clearInterval(timer); window.removeEventListener('focus', focusHandler); closeDetail(state); delete root.__amContractControlCenter; } };
    root.__amContractControlCenter = controller; refresh(state, 'initial'); return controller;
  }
  window.AMContractControlCenter = Object.freeze({ mount });
  const root = document.getElementById(DEFAULT_CONFIG.rootId);
  if (root) mount(root);
})();`;
}

function controlCenterMarkup({ rootId }) {
  return `<section id="${escapeHtml(rootId)}" class="am-contract-control-center" aria-label="工程合約控制中心" aria-busy="false">
  <style>
    .am-contract-control-center{--cc-ink:#193027;--cc-muted:#64748b;--cc-line:#d9e4de;--cc-green:#19724a;--cc-pale:#eff8f2;--cc-attention:#a85f00;--cc-danger:#b42318;color:var(--cc-ink);font-family:system-ui,'Noto Sans TC',sans-serif;margin:22px 0}.am-contract-control-header{display:flex;gap:14px;align-items:flex-start;justify-content:space-between;margin:0 0 12px}.am-contract-control-header h2{font-size:20px;margin:0}.am-contract-control-header p{color:var(--cc-muted);font-size:13px;margin:5px 0 0;line-height:1.55}.am-contract-control-refresh{appearance:none;border:1px solid #b6d3c2;border-radius:9px;background:#fff;color:#17613e;font:inherit;font-weight:700;padding:9px 12px;white-space:nowrap;cursor:pointer}.am-contract-control-refresh:focus-visible,.am-contract-control-chip:focus-visible,.am-contract-control-row:focus-visible,.am-contract-control-close:focus-visible{outline:3px solid #6ba6ff;outline-offset:2px}.am-contract-control-queues{display:flex;gap:8px;overflow-x:auto;padding:2px 0 9px}.am-contract-control-chip{display:inline-flex;gap:7px;align-items:center;border:1px solid #cfe0d5;border-radius:999px;background:#fff;color:#315344;font:inherit;font-size:13px;padding:7px 10px;white-space:nowrap;cursor:pointer}.am-contract-control-chip strong{background:#eaf3ee;border-radius:999px;padding:1px 6px}.am-contract-control-chip.active{border-color:#19724a;background:var(--cc-pale);color:#105737}.am-contract-control-status{font-size:13px;color:var(--cc-muted);min-height:20px;margin:0 0 8px}.am-contract-control-status.error{color:var(--cc-danger)}.am-contract-control-list{border:1px solid var(--cc-line);border-radius:12px;overflow:hidden;background:#fff}.am-contract-control-row{display:grid;grid-template-columns:minmax(200px,1.2fr) repeat(3,minmax(100px,.68fr)) minmax(180px,1fr) repeat(4,minmax(100px,.58fr));width:100%;gap:12px;text-align:left;border:0;border-bottom:1px solid var(--cc-line);background:#fff;color:inherit;font:inherit;padding:14px;cursor:pointer}.am-contract-control-row:last-child{border-bottom:0}.am-contract-control-row:hover{background:#f7fbf8}.am-contract-control-identity{display:grid;gap:3px;min-width:0}.am-contract-control-identity strong,.am-contract-control-identity span{overflow-wrap:anywhere}.am-contract-control-identity small{color:var(--cc-muted)}.am-contract-control-cell{display:grid;gap:3px;align-content:start;min-width:0}.am-contract-control-caption{color:var(--cc-muted);font-size:11px}.am-contract-control-value{font-size:13px;overflow-wrap:anywhere}.am-contract-control-cell.party-a .am-contract-control-value{color:#6b3a92}.am-contract-control-cell.party-b .am-contract-control-value{color:#17613e}.am-contract-control-cell.health.healthy .am-contract-control-value{color:#17613e}.am-contract-control-cell.health.attention .am-contract-control-value{color:var(--cc-attention)}.am-contract-control-empty{color:var(--cc-muted);padding:24px;text-align:center}.am-contract-control-footer{display:flex;justify-content:space-between;gap:12px;color:var(--cc-muted);font-size:12px;margin:10px 2px}.am-contract-control-drawer{position:fixed;z-index:30;inset:0;background:#14231b88;padding:24px;overflow:auto}.am-contract-control-drawer[hidden]{display:none}.am-contract-control-drawer-card{background:#fff;border-radius:16px;box-shadow:0 16px 56px #0b24194d;max-width:800px;margin:0 0 0 auto;padding:20px;min-height:calc(100vh - 48px)}.am-contract-control-drawer-heading{display:flex;justify-content:space-between;gap:16px}.am-contract-control-drawer h3{font-size:20px;margin:0}.am-contract-control-drawer-meta{color:var(--cc-muted);font-size:13px;margin:6px 0 0}.am-contract-control-close{border:0;border-radius:8px;background:#eaf3ee;color:#145735;font-size:20px;line-height:1;padding:7px 10px;cursor:pointer}.am-contract-control-detail-summary{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin:18px 0}.am-contract-control-detail-field{border:1px solid var(--cc-line);border-radius:9px;padding:10px;display:grid;gap:4px}.am-contract-control-detail-field span{color:var(--cc-muted);font-size:12px}.am-contract-control-detail-field strong{overflow-wrap:anywhere}.am-contract-control-parties{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.am-contract-control-party-card{border:1px solid var(--cc-line);border-radius:10px;padding:13px}.am-contract-control-party-card h4{margin:0;font-size:15px}.am-contract-control-party-state{font-weight:800;color:#17613e;margin:8px 0}.am-contract-control-party-card dl{display:grid;grid-template-columns:max-content 1fr;gap:5px 9px;margin:0;font-size:13px}.am-contract-control-party-card dt{color:var(--cc-muted)}.am-contract-control-party-card dd{margin:0;overflow-wrap:anywhere}.am-contract-control-blockers{border:1px solid #f4c7c3;border-radius:9px;background:#fff7f6;color:#8c271e;padding:12px 12px 12px 30px;line-height:1.5}.am-contract-control-timeline{border-left:2px solid #cfe0d5;list-style:none;margin:10px 0;padding:0 0 0 15px}.am-contract-control-timeline li{position:relative;padding:0 0 14px}.am-contract-control-timeline li:before{content:'';position:absolute;background:#19724a;border-radius:50%;height:8px;left:-20px;top:5px;width:8px}.am-contract-control-timeline strong,.am-contract-control-timeline span{display:block}.am-contract-control-timeline span{color:var(--cc-muted);font-size:12px;margin-top:2px}.am-contract-control-timeline p{font-size:13px;line-height:1.5;margin:5px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.am-contract-control-error{color:var(--cc-danger)}@media(max-width:900px){.am-contract-control-row{grid-template-columns:repeat(2,minmax(0,1fr))}.am-contract-control-identity{grid-column:1/-1}}@media(max-width:560px){.am-contract-control-center{margin-left:-2px;margin-right:-2px}.am-contract-control-header{align-items:center}.am-contract-control-header h2{font-size:18px}.am-contract-control-row{grid-template-columns:1fr;padding:13px}.am-contract-control-cell{grid-template-columns:74px 1fr;gap:7px}.am-contract-control-caption{font-size:12px}.am-contract-control-drawer{padding:8px}.am-contract-control-drawer-card{min-height:calc(100vh - 16px);padding:16px}.am-contract-control-detail-summary,.am-contract-control-parties{grid-template-columns:1fr}.am-contract-control-footer{display:block;line-height:1.6}}
  </style>
  <div class="am-contract-control-header"><div><h2>合約控制中心</h2><p>所有狀態、時間與下一步均由合約控制 read model 提供。</p></div><button class="am-contract-control-refresh" type="button" data-contract-control-refresh>重新整理</button></div>
  <div class="am-contract-control-queues" data-contract-control-queues aria-label="合約待辦佇列"></div>
  <p class="am-contract-control-status" data-contract-control-status aria-live="polite">尚未載入合約控制資料。</p>
  <div class="am-contract-control-list" data-contract-control-list></div>
  <div class="am-contract-control-footer"><span data-contract-control-count>共 0 份合約</span><span>每 15 秒與回到頁面時自動更新</span></div>
  <div class="am-contract-control-drawer" data-contract-control-drawer role="dialog" aria-modal="true" aria-hidden="true" aria-labelledby="${escapeHtml(rootId)}-drawer-title" tabindex="-1" hidden><section class="am-contract-control-drawer-card"><div class="am-contract-control-drawer-heading"><div><h3 id="${escapeHtml(rootId)}-drawer-title" data-contract-control-drawer-title>合約控制詳情</h3><p class="am-contract-control-drawer-meta" data-contract-control-drawer-meta></p></div><button class="am-contract-control-close" data-contract-control-close type="button" aria-label="關閉合約控制詳情">×</button></div><div data-contract-control-detail-summary></div><h4>簽署與交接</h4><div class="am-contract-control-parties" data-contract-control-parties></div><ul class="am-contract-control-blockers" data-contract-control-blockers hidden></ul><h4>合約事件時間軸</h4><ol class="am-contract-control-timeline" data-contract-control-timeline></ol></section></div>
</section>`;
}

export const __test = {
  controlCenterMarkup,
  escapeHtml,
  escapeScriptJson,
};
