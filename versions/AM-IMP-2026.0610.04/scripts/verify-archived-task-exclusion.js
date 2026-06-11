import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const args = parseArgs(process.argv.slice(2));
const projectRoot = path.resolve(args['project-root'] || args.projectRoot || process.cwd());
const docsDir = path.join(projectRoot, 'docs');
const generatorCandidates = [
  path.join(projectRoot, 'scripts', 'build-user-ui-connected-preview.js'),
  path.join(projectRoot, 'tools', 'build-user-ui-connected-preview.js'),
];
const generatorPath = generatorCandidates.find((candidate) => existsSync(candidate));

const failures = [];

if (!generatorPath) {
  failures.push(`Missing User UI generator under ${projectRoot}.`);
} else {
  const source = readFileSync(generatorPath, 'utf8');
  if (!/excludeArchivedTasks/.test(source) || !/isArchivedTaskStatus/.test(source)) {
    failures.push(`Generator does not contain archived task exclusion helpers: ${generatorPath}`);
  }
  if (!/封存\|Archived/.test(source)) {
    failures.push(`Generator does not match archived status names: ${generatorPath}`);
  }
}

if (!existsSync(docsDir)) {
  failures.push(`Missing docs directory: ${docsDir}`);
} else {
  const files = readdirSync(docsDir)
    .filter((name) => /^user-ui.*\.html$/i.test(name))
    .sort();

  if (!files.length) {
    failures.push(`No generated User UI HTML files found in ${docsDir}.`);
  }

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    const html = readFileSync(filePath, 'utf8');
    const archivedRowPattern = /data-(?:task-row|task-card|project-task-row)[^>]*data-status="(?:封存|已封存|Archived)"/i;
    const archivedFilterPattern = /data-status-filter="(?:封存|已封存|Archived)"/i;
    if (archivedRowPattern.test(html)) {
      failures.push(`${file}: archived task row is still rendered.`);
    }
    if (archivedFilterPattern.test(html)) {
      failures.push(`${file}: archived status filter is still rendered.`);
    }
  }
}

if (failures.length) {
  console.error(JSON.stringify({ ok: false, projectRoot, failures }, null, 2));
  process.exit(1);
}

console.log(JSON.stringify({ ok: true, projectRoot, generatorPath }, null, 2));

function parseArgs(argv) {
  const parsed = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith('--')) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

