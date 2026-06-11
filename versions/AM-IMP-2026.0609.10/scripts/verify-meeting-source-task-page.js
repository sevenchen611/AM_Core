#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const generatorCandidates = [
  path.join(projectRoot, 'scripts', 'build-user-ui-connected-preview.js'),
  path.join(projectRoot, 'tools', 'build-user-ui-connected-preview.js'),
];
const generatorPath = generatorCandidates.find((candidate) => fs.existsSync(candidate));

function fail(message, details = {}) {
  console.error(JSON.stringify({ ok: false, message, projectRoot, ...details }, null, 2));
  process.exit(1);
}

if (!generatorPath) {
  fail('Missing connected User UI generator', { generatorCandidates });
}

const source = fs.readFileSync(generatorPath, 'utf8');
const requiredPatterns = [
  ['meeting detector', /isMeetingDerivedTask|meeting-checkbox|meeting-action|同步識別碼\s*[:：]\s*meeting:/],
  ['meeting source label', /資料來源：會議記錄/],
  ['meeting body label', /會議記錄內文/],
  ['meeting related page renderer', /findMeetingByUrl|findMeetingByName|關聯頁面/],
  ['meeting content loading', /pageContentPreview\(page\.id\)|content:\s*await\s+pageContentPreview/],
];

const missing = requiredPatterns
  .filter(([, pattern]) => !pattern.test(source))
  .map(([name]) => name);

if (missing.length) {
  fail('Meeting-source task page evidence behavior is incomplete', { missing });
}

console.log(JSON.stringify({
  ok: true,
  projectRoot,
  generatorPath,
  checked: requiredPatterns.map(([name]) => name),
}, null, 2));
