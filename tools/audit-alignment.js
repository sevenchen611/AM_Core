const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'projects.json'), 'utf8'));
const packageRoot = path.join(root, 'versions');
const runtimeTemplate = path.join(root, 'core', 'runtime-template');

const PASS_STATUSES = new Set(['Ready', 'Installed', 'Deployed', 'Proposed', 'Blocked', 'Deprecated']);
const ACTIVE_STATUSES = new Set(['Ready', 'Installed', 'Deployed']);
const errors = [];
const warnings = [];

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function parseManifestTable(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `AM-IMP-')) continue;
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    rows.set(cells[0].replace(/`/g, ''), {
      improvement: cells[1],
      status: cells[2],
    });
  }
  return rows;
}

function listPackages() {
  return fs.readdirSync(packageRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('AM-IMP-'))
    .map((entry) => entry.name)
    .sort();
}

function packageMetadata(packageId) {
  const filePath = path.join(packageRoot, packageId, 'upgrade.json');
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function isAllowedInactiveForPackage(status, projectKey, metadata) {
  if (status !== 'Blocked' || !metadata) return false;
  if (Array.isArray(metadata.excludedTargets) && metadata.excludedTargets.includes(projectKey)) return true;
  if (Array.isArray(metadata.installTargets) && metadata.installTargets.length && !metadata.installTargets.includes(projectKey)) return true;
  return false;
}

function compareArrays(label, leftName, left, rightName, right) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  for (const item of leftSet) {
    if (!rightSet.has(item)) errors.push(`${label}: ${rightName} missing ${item} from ${leftName}.`);
  }
  for (const item of rightSet) {
    if (!leftSet.has(item)) errors.push(`${label}: ${leftName} missing ${item} from ${rightName}.`);
  }
}

function runNodeCheck(filePath) {
  const result = spawnSync(process.execPath, ['--check', filePath], { encoding: 'utf8' });
  if (result.status !== 0) {
    errors.push(`Syntax check failed: ${filePath}\n${result.stderr || result.stdout}`);
  }
}

const SKIP_DIRS = new Set(['node_modules', '.git']);

function walkFiles(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, predicate, files);
    else if (predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function main() {
  if (!fs.existsSync(runtimeTemplate)) {
    errors.push(`Missing runtime template: ${runtimeTemplate}`);
  }

  const packages = listPackages();
  if (!packages.length) errors.push('No AMCore upgrade packages found.');

  for (const packageId of packages) {
    const packageDir = path.join(packageRoot, packageId);
    for (const file of ['README.md', 'upgrade.json', 'INSTALL.md', 'VERIFY.md', 'ROLLBACK.md']) {
      if (!fs.existsSync(path.join(packageDir, file))) {
        errors.push(`${packageId} missing ${file}`);
      }
    }
    const metadata = packageMetadata(packageId);
    if (!metadata) {
      errors.push(`${packageId} missing upgrade.json metadata.`);
    } else if (metadata.id !== packageId) {
      errors.push(`${packageId} upgrade.json id mismatch: ${metadata.id}`);
    }
  }

  const projects = config.projects.map((project) => {
    const manifest = parseManifestTable(readText(project.manifestPath));
    const packageJsonPath = path.join(project.localPath, 'package.json');
    const packageJson = JSON.parse(readText(packageJsonPath));
    const scripts = Object.keys(packageJson.scripts || {}).sort();
    return { project, manifest, scripts };
  });

  if (projects.length >= 2) {
    compareArrays('npm scripts', projects[0].project.projectKey, projects[0].scripts, projects[1].project.projectKey, projects[1].scripts);
  }

  for (const packageId of packages) {
    const metadata = packageMetadata(packageId);
    const statuses = projects.map(({ project, manifest }) => ({
      projectKey: project.projectKey,
      status: manifest.get(packageId)?.status || 'Missing',
    }));
    for (const item of statuses) {
      if (item.status === 'Missing') errors.push(`${item.projectKey} missing manifest row for ${packageId}.`);
      else if (!PASS_STATUSES.has(item.status)) errors.push(`${item.projectKey} has unknown status for ${packageId}: ${item.status}`);
    }

    const active = statuses.filter((item) => ACTIVE_STATUSES.has(item.status));
    if (active.length > 0 && active.length < projects.length) {
      const inactive = statuses.filter((item) => !ACTIVE_STATUSES.has(item.status));
      const invalidInactive = inactive.filter((item) => !isAllowedInactiveForPackage(item.status, item.projectKey, metadata));
      if (invalidInactive.length) {
        errors.push(`${packageId} is active in only some projects: ${statuses.map((item) => `${item.projectKey}=${item.status}`).join(', ')}`);
      }
    }
  }

  for (const { project } of projects) {
    for (const filePath of walkFiles(project.localPath, (file) => file.endsWith('.js'))) runNodeCheck(filePath);
  }
  for (const filePath of walkFiles(root, (file) => file.endsWith('.js'))) runNodeCheck(filePath);

  const report = {
    ok: errors.length === 0,
    checkedAt: new Date().toISOString(),
    packages,
    projects: projects.map(({ project, scripts, manifest }) => ({
      projectKey: project.projectKey,
      scriptCount: scripts.length,
      manifestVersions: [...manifest.keys()].sort(),
    })),
    warnings,
    errors,
  };

  console.log(JSON.stringify(report, null, 2));
  if (errors.length) process.exit(1);
}

main();
