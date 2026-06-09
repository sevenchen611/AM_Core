import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const projectRoot = process.argv[2];

if (!projectRoot) {
  console.error('Usage: node verify-thread-first-task-judgement.js <project-root>');
  process.exit(1);
}

const candidates = [
  join(projectRoot, 'scripts', 'sync-line-message-judgements.js'),
  join(projectRoot, 'scripts', 'sync-line-messages.js'),
  join(projectRoot, 'src', 'line-task-judgement.js'),
].filter(existsSync);

if (!candidates.length) {
  fail(`No LINE task judgment script found under ${projectRoot}`);
}

const source = candidates.map((file) => readFileSync(file, 'utf8')).join('\n\n');

const checks = [
  {
    name: 'loads same-conversation context',
    pattern: /sameConversationContext|loadSameConversationContext|conversation context|對話.*前後文/i,
  },
  {
    name: 'uses conversation-level project inference',
    pattern: /conversationProject|getConversationProject|inferConversationProject|總控專案/i,
  },
  {
    name: 'suppresses operation or setup messages',
    pattern: /operational-instruction|isOperationalInstruction|conversation-setup|isConversationSetup|assistant command|指令/i,
  },
  {
    name: 'searches related active tasks before create',
    pattern: /findRelatedActiveTask|queryRelatedActiveTasks|active task|既有任務/i,
  },
  {
    name: 'excludes archived or completed tasks',
    pattern: /isActiveTask|封存|已封存|完成|Deprecated|cancelled|取消/i,
  },
  {
    name: 'has contextual task matching',
    pattern: /scoreContextualTaskMatch|contextualScore|project calibration|topic pattern|context-thread/i,
  },
  {
    name: 'merges duplicate candidates in the same run',
    pattern: /inRunCreatedTasks|same-run|duplicate candidate|同一輪|同輪/i,
  },
  {
    name: 'records evidence when updating tasks',
    pattern: /updateTaskWithEvidence|buildTaskUpdateEvidence|source evidence|更新證據|任務更新判斷/i,
  },
];

const failures = checks.filter((check) => !check.pattern.test(source));

if (failures.length) {
  console.error(JSON.stringify({
    ok: false,
    projectRoot,
    checkedFiles: candidates,
    failedChecks: failures.map((item) => item.name),
  }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({
  ok: true,
  projectRoot,
  checkedFiles: candidates,
  passedChecks: checks.map((item) => item.name),
}, null, 2));

function fail(message) {
  console.error(message);
  process.exit(1);
}
