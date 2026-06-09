import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.argv[2];

if (!projectRoot) {
  fail('Usage: node verify-line-reconciliation-implementation.js <project-root>');
}

const lineScript = join(projectRoot, 'scripts', 'sync-line-message-judgements.js');
const meetingScript = join(projectRoot, 'scripts', 'sync-meeting-actions.js');
const runtimeConfig = join(projectRoot, 'config', 'daily-intake-reconciliation-runtime.json');
const hourlyConfig = join(projectRoot, 'config', 'hourly-line-task-reconciliation.json');

const checks = [];

const lineSource = readOptional(lineScript);
const meetingSource = readOptional(meetingScript);

checks.push(checkFile(lineScript, lineSource));
checks.push(checkFile(meetingScript, meetingSource));
checks.push(checkFile(hourlyConfig, readOptional(hourlyConfig)));
checks.push(checkFile(runtimeConfig, readOptional(runtimeConfig), false));

checks.push(check('line-loads-conversation-context', /same.*conversation|conversation.*context|load.*context|get.*context|contextMessages|topicThread/i.test(lineSource)));
checks.push(check('line-searches-active-tasks', /active.*task|search.*task|findRelated.*Task|find.*Active.*Task|related.*task/i.test(lineSource)));
checks.push(check('line-can-update-existing-task', /update.*Task|patch.*task|update_existing_task|existing.*task.*update/i.test(lineSource)));
checks.push(check('line-has-no-task-outcome', /judged.*no.*task|mark.*judged|low-signal|command-trigger|ignored|skipped/i.test(lineSource)));
checks.push(check('line-creation-not-only-exact-title-dedupe', !/findExistingTask\(candidate\.name\)/.test(lineSource) || /findRelated.*Task|active.*task|topicThread/i.test(lineSource)));
checks.push(check('meeting-checkbox-rule-present', /checkboxDerived|isCheckboxActionLine|meeting-checkbox/i.test(meetingSource)));
checks.push(check('meeting-dedupes-by-meeting-reference', /findExistingTask\(candidate\.name,\s*meeting\.url\)|meetingUrl/i.test(meetingSource)));

const passed = checks.filter((item) => item.passed).length;
const failed = checks.filter((item) => !item.passed);

console.log(JSON.stringify({
  ok: failed.length === 0,
  projectRoot,
  passed,
  failed: failed.map((item) => item.name),
  checks,
}, null, 2));

if (failed.length) process.exitCode = 1;

function readOptional(pathname) {
  return existsSync(pathname) ? readFileSync(pathname, 'utf8') : '';
}

function checkFile(pathname, content, required = true) {
  return check(`file:${pathname}`, required ? Boolean(content) : true);
}

function check(name, passed) {
  return { name, passed: Boolean(passed) };
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

