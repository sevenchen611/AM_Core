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

function projectIsTargeted(project, metadata) {
  // 已由 AM Platform 租戶取代的 rollback clone 不再安裝新功能。
  if (project.active === false) return false;
  if (Array.isArray(metadata?.excludedTargets) && metadata.excludedTargets.includes(project.projectKey)) return false;
  if (Array.isArray(metadata?.installTargets) && metadata.installTargets.length) {
    return metadata.installTargets.includes(project.projectKey);
  }
  return true;
}

function isAllowedInactiveForPackage(status, projectKey, metadata) {
  if (status !== 'Blocked' || !metadata) return false;
  if (Array.isArray(metadata.excludedTargets) && metadata.excludedTargets.includes(projectKey)) return true;
  if (Array.isArray(metadata.installTargets) && metadata.installTargets.length && !metadata.installTargets.includes(projectKey)) return true;
  return false;
}

function compareArrays(label, leftName, left, rightName, right, findings = errors) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  for (const item of leftSet) {
    if (!rightSet.has(item)) findings.push(`${label}: ${rightName} missing ${item} from ${leftName}.`);
  }
  for (const item of rightSet) {
    if (!leftSet.has(item)) findings.push(`${label}: ${leftName} missing ${item} from ${rightName}.`);
  }
}

function normalizeMetadataStatus(value) {
  const text = String(value || '').trim();
  if (PASS_STATUSES.has(text)) return text;
  if (['未列入', 'Not Applicable', 'N/A', 'Excluded'].includes(text)) return 'Blocked';
  return '';
}

function metadataProjectStatus(metadata, projectKey) {
  return normalizeMetadataStatus(metadata?.projectStatus?.[projectKey]
    || metadata?.backfill?.projectStatus?.[projectKey]);
}

function expandManifestRanges(manifest, packages) {
  for (const [version, row] of [...manifest.entries()]) {
    const match = version.match(/^(AM-IMP-\d{4}\.\d{4}\.\d{2})[–—-]+(AM-IMP-\d{4}\.\d{4}\.\d{2})$/);
    if (!match) continue;
    const start = packages.indexOf(match[1]);
    const end = packages.indexOf(match[2]);
    if (start < 0 || end < start) continue;
    for (const packageId of packages.slice(start, end + 1)) {
      if (!manifest.has(packageId)) manifest.set(packageId, { ...row, expandedFrom: version });
    }
  }
  return manifest;
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
    const manifest = expandManifestRanges(parseManifestTable(readText(project.manifestPath)), packages);
    const packageJsonPath = path.join(project.localPath, 'package.json');
    const packageJson = JSON.parse(readText(packageJsonPath));
    const scripts = Object.keys(packageJson.scripts || {}).sort();
    return { project, manifest, scripts };
  });

  if (projects.length >= 2) {
    // 專案可有自己的 Calendar、B-case 等腳本；差異要被看見，但不是共享契約失敗。
    compareArrays('npm scripts', projects[0].project.projectKey, projects[0].scripts, projects[1].project.projectKey, projects[1].scripts, warnings);
  }

  for (const packageId of packages) {
    const metadata = packageMetadata(packageId);
    const statuses = projects.filter(({ project }) => projectIsTargeted(project, metadata)).map(({ project, manifest }) => {
      const row = manifest.get(packageId);
      const fallback = metadataProjectStatus(metadata, project.projectKey);
      if (!row && fallback) warnings.push(`${project.projectKey} uses ${packageId} package metadata status ${fallback}; add an explicit manifest row when next editing that project.`);
      return {
        projectKey: project.projectKey,
        status: row?.status || fallback || 'Missing',
        fromMetadata: !row && Boolean(fallback),
      };
    });
    for (const item of statuses) {
      if (item.status === 'Missing') errors.push(`${item.projectKey} missing manifest row for ${packageId}.`);
      else if (!PASS_STATUSES.has(item.status)) errors.push(`${item.projectKey} has unknown status for ${packageId}: ${item.status}`);
    }

    const active = statuses.filter((item) => ACTIVE_STATUSES.has(item.status));
    if (active.length > 0 && active.length < statuses.length) {
      const inactive = statuses.filter((item) => !ACTIVE_STATUSES.has(item.status));
      const invalidInactive = inactive.filter((item) => !item.fromMetadata
        && metadataProjectStatus(metadata, item.projectKey) !== item.status
        && !isAllowedInactiveForPackage(item.status, item.projectKey, metadata));
      if (invalidInactive.length) {
        errors.push(`${packageId} is active in only some projects: ${statuses.map((item) => `${item.projectKey}=${item.status}`).join(', ')}`);
      }
    }
  }

  for (const { project } of projects.filter(({ project }) => project.active !== false)) {
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
