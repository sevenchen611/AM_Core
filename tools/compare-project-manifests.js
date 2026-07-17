const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config', 'projects.json');
const packageRoot = path.join(root, 'versions');

function readText(filePath) {
  return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function parseManifestTable(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `AM-IMP-')) continue;
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 3) continue;
    const version = cells[0].replace(/`/g, '');
    rows.set(version, {
      version,
      improvement: cells[1],
      status: cells[2],
      appliedDate: cells[3] || '',
      reference: cells[4] || '',
      verification: cells[5] || ''
    });
  }
  return rows;
}

function parseSharedRegistry(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `AM-IMP-')) continue;
    const cells = line.split('|').map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 6) continue;
    const version = cells[0].replace(/`/g, '');
    rows.set(version, {
      version,
      improvement: cells[1],
      type: cells[2],
      portable: cells[3],
      hozoStatus: cells[4],
      sevenStatus: cells[5],
      notes: cells[6] || ''
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
  return JSON.parse(readText(filePath));
}

function normalizeMetadataStatus(value) {
  const text = String(value || '').trim();
  if (['Proposed', 'Ready', 'Installed', 'Deployed', 'Blocked', 'Deprecated'].includes(text)) return text;
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
      if (!manifest.has(packageId)) manifest.set(packageId, { ...row, version: packageId, expandedFrom: version });
    }
  }
  return manifest;
}

function main() {
  const config = JSON.parse(readText(configPath));
  const packages = listPackages();
  const shared = parseSharedRegistry(readText(config.sharedRegistryPath));
  const projectRows = config.projects.map((project) => ({
    project,
    manifest: expandManifestRanges(parseManifestTable(readText(project.manifestPath)), packages)
  }));

  const allVersions = new Set([...packages, ...shared.keys()]);
  for (const { manifest } of projectRows) {
    for (const version of manifest.keys()) allVersions.add(version);
  }

  const sortedVersions = [...allVersions].sort();
  const header = ['Version', 'Improvement', ...projectRows.map(({ project }) => project.projectKey)];
  const table = [header];

  for (const version of sortedVersions) {
    const sharedRow = shared.get(version);
    const metadata = packageMetadata(version);
    const improvement = sharedRow?.improvement || projectRows.find(({ manifest }) => manifest.has(version))?.manifest.get(version).improvement || '';
    const statuses = projectRows.map(({ project, manifest }) => manifest.get(version)?.status
      || metadataProjectStatus(metadata, project.projectKey)
      || (project.active === false ? 'Deprecated' : 'Missing'));
    table.push([version, improvement, ...statuses]);
  }

  const widths = header.map((_, index) => Math.max(...table.map((row) => String(row[index] || '').length)));
  for (const row of table) {
    console.log(row.map((cell, index) => String(cell || '').padEnd(widths[index])).join('  '));
  }
}

main();
