const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const configPath = path.join(root, 'config', 'projects.json');

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

function main() {
  const config = JSON.parse(readText(configPath));
  const shared = parseSharedRegistry(readText(config.sharedRegistryPath));
  const projectRows = config.projects.map((project) => ({
    project,
    manifest: parseManifestTable(readText(project.manifestPath))
  }));

  const allVersions = new Set(shared.keys());
  for (const { manifest } of projectRows) {
    for (const version of manifest.keys()) allVersions.add(version);
  }

  const sortedVersions = [...allVersions].sort();
  const header = ['Version', 'Improvement', ...projectRows.map(({ project }) => project.projectKey)];
  const table = [header];

  for (const version of sortedVersions) {
    const sharedRow = shared.get(version);
    const improvement = sharedRow?.improvement || projectRows.find(({ manifest }) => manifest.has(version))?.manifest.get(version).improvement || '';
    const statuses = projectRows.map(({ manifest }) => manifest.get(version)?.status || 'Missing');
    table.push([version, improvement, ...statuses]);
  }

  const widths = header.map((_, index) => Math.max(...table.map((row) => String(row[index] || '').length)));
  for (const row of table) {
    console.log(row.map((cell, index) => String(cell || '').padEnd(widths[index])).join('  '));
  }
}

main();
