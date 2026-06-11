import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const projects = [
  {
    name: 'HOZO AM',
    root: 'D:\\Codex_project\\HOZO_AM\\line-oa-webhook',
    expected: { projects: 10, tasks: 51, conversations: 8 },
  },
  {
    name: 'SevenAM',
    root: 'D:\\Codex_project\\SevenAM\\line-oa-webhook',
    expected: { projects: 9, tasks: 164, conversations: 58 },
  },
];

const reportRows = [];
let hasFailure = false;

for (const project of projects) {
  const docsDir = path.join(project.root, 'docs');
  const files = existsSync(docsDir)
    ? readdirSync(docsDir).filter((name) => /^user-ui.*\.html$/i.test(name)).sort(naturalCompare)
    : [];
  const taskFiles = files.filter((name) => /^user-ui-task-\d+\.html$/i.test(name));
  const projectFiles = files.filter((name) => /^user-ui-project-\d+\.html$/i.test(name));
  const lineFiles = files.filter((name) => /^user-ui-line-\d+\.html$/i.test(name));
  const scheduledFiles = files.filter((name) => /^user-ui-scheduled-.*\.html$/i.test(name));
  const mainFile = files.includes('user-ui-connected-preview.html') ? ['user-ui-connected-preview.html'] : [];

  const scans = scanFiles(docsDir, files);
  const taskScans = scanFiles(docsDir, taskFiles);
  const lineScans = scanFiles(docsDir, lineFiles);

  const checks = [
    check(projectFiles.length === project.expected.projects, `${project.expected.projects} project pages`, `${projectFiles.length}`),
    check(taskFiles.length === project.expected.tasks, `${project.expected.tasks} task pages`, `${taskFiles.length}`),
    check(lineFiles.length === project.expected.conversations, `${project.expected.conversations} LINE pages`, `${lineFiles.length}`),
    check(mainFile.length === 1, 'main preview exists', mainFile.length ? 'yes' : 'no'),
    check(taskScans.every((item) => item.hasTaskInfo), 'every task page has task info section', missingList(taskScans, 'hasTaskInfo')),
    check(taskScans.every((item) => item.hasTaskContent), 'every task page has task content section', missingList(taskScans, 'hasTaskContent')),
    check(taskScans.every((item) => item.hasOriginalEvidenceSection), 'every task page has original source evidence section', missingList(taskScans, 'hasOriginalEvidenceSection')),
    check(lineScans.every((item) => item.hasLineArchiveRenderer), 'every LINE page uses LINE archive renderer', missingList(lineScans, 'hasLineArchiveRenderer')),
    check(scans.filter((item) => item.hasLineArchiveRenderer).length > 0, 'LINE archive renderer exists in generated UI', `${scans.filter((item) => item.hasLineArchiveRenderer).length} files`),
    check(scans.every((item) => !item.hasLegacyEvidenceHeading), 'no legacy source-evidence heading', offendingList(scans, 'hasLegacyEvidenceHeading')),
    check(scans.every((item) => !item.hasLegacyRawJudgmentFallback), 'no raw judgment fallback heading', offendingList(scans, 'hasLegacyRawJudgmentFallback')),
    check(scans.every((item) => !item.hasMissingImageOnly), 'no image evidence shown only as text id', offendingList(scans, 'hasMissingImageOnly')),
    check(scans.every((item) => !item.hasRepeatedLineMetadata), 'no repeated LINE metadata inside message body', offendingList(scans, 'hasRepeatedLineMetadata')),
    check(scans.every((item) => !item.hasDuplicateConversationSpeaker), 'no duplicated conversation name in LINE header', offendingList(scans, 'hasDuplicateConversationSpeaker')),
    check(scans.filter((item) => item.imageTagCount > 0).length > 0, 'image tags present where media exists', `${scans.reduce((sum, item) => sum + item.imageTagCount, 0)} images`),
  ];

  if (checks.some((item) => !item.ok)) hasFailure = true;
  reportRows.push({
    project,
    docsDir,
    counts: {
      all: files.length,
      main: mainFile.length,
      projects: projectFiles.length,
      tasks: taskFiles.length,
      line: lineFiles.length,
      scheduled: scheduledFiles.length,
    },
    checks,
  });
}

const reportPath = path.resolve('docs', `USER_UI_FULL_PAGE_VALIDATION_${dateStamp()}.md`);
mkdirSync(path.dirname(reportPath), { recursive: true });
writeFileSync(reportPath, renderReport(reportRows), 'utf8');
console.log(JSON.stringify({ ok: !hasFailure, reportPath, projects: reportRows.map((row) => ({ name: row.project.name, counts: row.counts })) }, null, 2));
if (hasFailure) process.exitCode = 1;

function scanFiles(docsDir, files) {
  return files.map((file) => {
    const fullPath = path.join(docsDir, file);
    const html = readFileSync(fullPath, 'utf8');
    return {
      file,
      hasTaskInfo: /<h2>任務資訊<\/h2>/.test(html),
      hasTaskContent: /<h2>(任務正文|Notion 頁面內容(?:（工作卷宗\/摘要）)?)<\/h2>/.test(html),
      hasOriginalEvidenceSection: /<h2>原始來源證據<\/h2>/.test(html),
      hasLineArchiveRenderer: /line-archive-head/.test(html),
      hasLegacyEvidenceHeading: /來源證據與對話記錄/.test(html),
      hasLegacyRawJudgmentFallback: /判斷補充文字/.test(html),
      hasMissingImageOnly: /(?:圖片|照片)\s*[：:]\s*[A-Za-z0-9_-]{10,}/.test(stripTags(html)) && !/<img\b/i.test(html),
      hasRepeatedLineMetadata: hasRepeatedLineMetadata(html),
      hasDuplicateConversationSpeaker: hasDuplicateConversationSpeaker(html),
      imageTagCount: (html.match(/<img\b/gi) || []).length,
    };
  });
}

function check(ok, label, detail) {
  return { ok, label, detail: String(detail || '') };
}

function missingList(scans, prop) {
  const items = scans.filter((item) => !item[prop]).map((item) => item.file);
  return items.length ? items.slice(0, 12).join(', ') + (items.length > 12 ? `, ... +${items.length - 12}` : '') : 'none';
}

function offendingList(scans, prop) {
  const items = scans.filter((item) => item[prop]).map((item) => item.file);
  return items.length ? items.slice(0, 12).join(', ') + (items.length > 12 ? `, ... +${items.length - 12}` : '') : 'none';
}

function stripTags(html) {
  return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
}

function hasRepeatedLineMetadata(html) {
  const blocks = [...String(html || '').matchAll(/<div class="line-archive-message">([\s\S]*?)<\/div>\s*(?:<\/article>)?/g)]
    .map((match) => match[1]);
  const bodyBlocks = blocks.flatMap((block) => [...block.matchAll(/<div class="(?:line-archive-body|preline)">([\s\S]*?)<\/div>/g)]
    .map((match) => decodeBasicEntities(stripTags(match[1]))));
  return bodyBlocks.some((body) => /(?:^|\n)(日期|時間|群組|使用者|發話者|訊息類型)\s*[:：]/.test(body)
    || /(?:^|\n)(圖片|照片)\s*[:：]\s*[A-Za-z0-9_-]{10,}/.test(body));
}

function hasDuplicateConversationSpeaker(html) {
  const heads = [...String(html || '').matchAll(/<div class="line-archive-head(?: assistant)?">([\s\S]*?)<\/div>/g)]
    .map((match) => decodeBasicEntities(stripTags(match[1])));
  return heads.some((head) => {
    const match = head.match(/】(.+?) - (.+?)（/);
    if (!match) return false;
    const conversation = match[1].trim();
    const speaker = match[2].trim();
    return speaker.startsWith(`${conversation} - `);
  });
}

function decodeBasicEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function renderReport(rows) {
  const lines = [
    '# User UI 全頁檢驗報告',
    '',
    `產生時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
    '',
    '檢查範圍：HOZO AM 與 SevenAM 的已產生 User UI HTML 頁面。',
    '',
  ];
  for (const row of rows) {
    lines.push(`## ${row.project.name}`, '');
    lines.push(`輸出資料夾：\`${row.docsDir}\``, '');
    lines.push('| 類型 | 頁數 |');
    lines.push('| --- | ---: |');
    lines.push(`| 全部 User UI HTML | ${row.counts.all} |`);
    lines.push(`| 主頁 | ${row.counts.main} |`);
    lines.push(`| 專案頁 | ${row.counts.projects} |`);
    lines.push(`| 任務頁 | ${row.counts.tasks} |`);
    lines.push(`| LINE 對話頁 | ${row.counts.line} |`);
    lines.push(`| 排程頁 | ${row.counts.scheduled} |`);
    lines.push('');
    lines.push('| 檢查項目 | 結果 | 細節 |');
    lines.push('| --- | --- | --- |');
    for (const checkItem of row.checks) {
      lines.push(`| ${checkItem.label} | ${checkItem.ok ? '通過' : '未通過'} | ${escapePipe(checkItem.detail)} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function escapePipe(value) {
  return String(value || '').replace(/\|/g, '\\|');
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function dateStamp() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}
