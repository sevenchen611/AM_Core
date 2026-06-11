import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const projectRoot = process.argv[2];
if (!projectRoot) {
  console.error('Usage: node verify-task-page-source-format.js <projectRoot>');
  process.exit(2);
}

const docsDir = path.join(projectRoot, 'docs');
if (!existsSync(docsDir)) {
  console.error(`Missing docs directory: ${docsDir}`);
  process.exit(2);
}

const taskFiles = readdirSync(docsDir)
  .filter((name) => /^user-ui-task-\d+\.html$/.test(name))
  .map((name) => path.join(docsDir, name));

const failures = [];
let filesWithArchiveEvidence = 0;
let filesWithSourceSummary = 0;

for (const file of taskFiles) {
  const html = readFileSync(file, 'utf8');
  if (html.includes('<h2>來源證據與對話記錄</h2>')) {
    failures.push(`${file}: contains standalone source-evidence section`);
  }
  if (html.includes('判斷補充文字')) {
    failures.push(`${file}: contains raw judgment supplement card`);
  }
  if (html.includes('目前沒有可讀來源內容')) {
    failures.push(`${file}: contains missing-readable-source placeholder`);
  }
  if (html.includes('No page content loaded.')) {
    failures.push(`${file}: contains empty page-content placeholder`);
  }
  if (html.includes('line-archive-message')) {
    filesWithArchiveEvidence += 1;
    if (!html.includes('line-archive-head') || !html.includes('line-archive-body')) {
      failures.push(`${file}: archive evidence is missing header/body markup`);
    }
  }
  if (html.includes('source-summary')) filesWithSourceSummary += 1;
}

const indexPath = path.join(docsDir, 'user-ui-connected-preview.html');
if (!existsSync(indexPath)) failures.push(`${indexPath}: missing generated index`);
if (!taskFiles.length) failures.push(`${docsDir}: no task pages generated`);

if (failures.length) {
  console.error(JSON.stringify({
    ok: false,
    projectRoot,
    taskFiles: taskFiles.length,
    filesWithArchiveEvidence,
    filesWithSourceSummary,
    failures,
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  projectRoot,
  taskFiles: taskFiles.length,
  filesWithArchiveEvidence,
  filesWithSourceSummary,
}, null, 2));
