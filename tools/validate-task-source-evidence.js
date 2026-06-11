const fs = require('node:fs');
const path = require('node:path');

const projects = [
  {
    name: 'HOZO AM',
    root: 'D:\\Codex_project\\HOZO_AM\\line-oa-webhook',
    expectedTaskPages: 51,
  },
  {
    name: 'SevenAM',
    root: 'D:\\Codex_project\\SevenAM\\line-oa-webhook',
    expectedTaskPages: 164,
  },
];

let hasFailure = false;
const rows = [];

for (const project of projects) {
  const docsDir = path.join(project.root, 'docs');
  const taskFiles = fs.existsSync(docsDir)
    ? fs.readdirSync(docsDir).filter((name) => /^user-ui-task-\d+\.html$/i.test(name)).sort(naturalCompare)
    : [];

  const scans = taskFiles.map((file) => scanTaskPage(path.join(docsDir, file), file));
  const missingEvidence = scans.filter((item) => !item.hasOriginalEvidenceSection);
  const noEvidenceContent = scans.filter((item) => !item.hasEvidenceContent && !item.hasTaskBodySourceEvidence);
  const noTaskBody = scans.filter((item) => !item.hasTaskBody);

  const ok = taskFiles.length === project.expectedTaskPages
    && missingEvidence.length === 0
    && noEvidenceContent.length === 0
    && noTaskBody.length === 0;

  if (!ok) hasFailure = true;
  rows.push({
    project,
    taskCount: taskFiles.length,
    ok,
    missingEvidence,
    noEvidenceContent,
    noTaskBody,
  });
}

const reportPath = path.resolve('docs', `TASK_SOURCE_EVIDENCE_VALIDATION_${dateStamp()}.md`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, renderReport(rows), 'utf8');

console.log(JSON.stringify({
  ok: !hasFailure,
  reportPath,
  projects: rows.map((row) => ({
    name: row.project.name,
    taskCount: row.taskCount,
    ok: row.ok,
    missingEvidence: row.missingEvidence.length,
    noEvidenceContent: row.noEvidenceContent.length,
    noTaskBody: row.noTaskBody.length,
  })),
}, null, 2));

if (hasFailure) process.exitCode = 1;

function scanTaskPage(fullPath, file) {
  const html = fs.readFileSync(fullPath, 'utf8');
  const text = stripTags(html);
  const evidenceSection = sectionText(html, '原始來源證據');
  const taskBodySection = sectionText(html, 'Notion 頁面內容');
  return {
    file,
    hasOriginalEvidenceSection: /<h2>原始來源證據<\/h2>/.test(html),
    hasEvidenceContent: evidenceSection.length > 40 && /(LINE|對話|會議|訊息|來源|附件|檔案|報告|系統建議|source|message|meeting)/i.test(evidenceSection),
    hasTaskBodySourceEvidence: /(來源|對話|會議|訊息|附件|檔案|報告|系統建議|關聯頁面|https?:\/\/)/i.test(taskBodySection),
    hasTaskBody: taskBodySection.length > 20 || /<h2>任務正文<\/h2>/.test(html),
    hasAnySourceWord: /(原始來源證據|來源|對話|會議|訊息|附件|檔案|報告)/.test(text),
  };
}

function sectionText(html, heading) {
  const pattern = new RegExp(`<h2>${escapeRegExp(heading)}[^<]*<\\/h2>([\\s\\S]*?)(?:<h2>|<\\/section>|<footer|$)`, 'i');
  const match = String(html || '').match(pattern);
  return match ? stripTags(match[1]).replace(/\s+/g, ' ').trim() : '';
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function renderReport(rows) {
  const lines = [
    '# 任務來源證據檢查報告',
    '',
    `產生時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
    '',
    '檢查目的：確認 HOZO AM 與 SevenAM 的任務頁都有任務來源證據區塊，且來源證據區塊或任務正文至少一處有可稽核內容。這是任務資料庫來源證據規則的輸出層驗證。',
    '',
  ];

  for (const row of rows) {
    lines.push(`## ${row.project.name}`, '');
    lines.push(`任務頁數：${row.taskCount}`);
    lines.push(`結果：${row.ok ? '通過' : '未通過'}`, '');
    lines.push('| 檢查項目 | 未通過數量 | 範例 |');
    lines.push('| --- | ---: | --- |');
    lines.push(`| 缺少原始來源證據區塊 | ${row.missingEvidence.length} | ${sampleFiles(row.missingEvidence)} |`);
    lines.push(`| 來源證據區與任務正文均缺少可稽核來源 | ${row.noEvidenceContent.length} | ${sampleFiles(row.noEvidenceContent)} |`);
    lines.push(`| 缺少任務正文/工作卷宗 | ${row.noTaskBody.length} | ${sampleFiles(row.noTaskBody)} |`);
    lines.push('');
  }

  return lines.join('\n');
}

function sampleFiles(items) {
  if (!items.length) return 'none';
  const names = items.slice(0, 10).map((item) => item.file).join(', ');
  return items.length > 10 ? `${names}, ... +${items.length - 10}` : names;
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dateStamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date()).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
