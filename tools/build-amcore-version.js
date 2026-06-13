// Compute and write AMCore's version awareness in one pass.
//
// AMCore is the version master for the AM family. This tool makes AMCore
// self-aware by reading the authoritative sources and writing:
//
//   config/amcore-version.json     machine-readable version state
//   VERSION.md                     human-readable version dashboard
//   docs/CURRENT_VERSION_MATRIX.md refreshed per-project status table
//
// Sources (read-only):
//   - shared improvement registry (config.sharedRegistryPath)
//   - each project's improvement manifest (config.projects[].manifestPath)
//   - this repo's versions/ folder (the packages AMCore actually holds)
//
// AMCore's own version == the highest improvement it fully packages
// (packagedThrough). The "current" ecosystem version == the highest improvement
// tracked anywhere (latestTrackedImprovement). When they match, AMCore is current.

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'projects.json'), 'utf8'));
const versionsRoot = path.join(root, 'versions');

function readText(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function parseTable(markdown, versionIndex, fields) {
  // Generic pipe-table parser. fields maps name -> cell index (1-based incl. leading empty).
  const VERSION_RE = /^AM-IMP-\d{4}\.\d{4}\.\d{2}$/;
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `AM-IMP-')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const version = (cells[versionIndex] || '').replace(/`/g, '');
    // Ignore range/bulk-parity labels like `AM-IMP-...01–AM-IMP-...15`.
    if (!VERSION_RE.test(version)) continue;
    const row = { version };
    for (const [name, idx] of Object.entries(fields)) row[name] = cells[idx] || '';
    rows.set(version, row);
  }
  return rows;
}

function parseRegistry(markdown) {
  return parseTable(markdown, 1, { improvement: 2, type: 3, portable: 4, hozoStatus: 5, sevenStatus: 6, notes: 7 });
}

function parseManifest(markdown) {
  return parseTable(markdown, 1, { improvement: 2, status: 3, appliedDate: 4 });
}

function packageIds() {
  if (!fs.existsSync(versionsRoot)) return [];
  return fs.readdirSync(versionsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('AM-IMP-'))
    .map((e) => e.name)
    .sort();
}

function maxVersion(versions) {
  return [...versions].sort().slice(-1)[0] || null;
}

function compareVersionCount(latest, packaged, all) {
  // How many tracked versions are at or below latest but not yet packaged.
  return [...all].filter((v) => v <= latest && !packaged.has(v)).sort();
}

function main() {
  const registry = parseRegistry(readText(config.sharedRegistryPath));
  const projectData = config.projects.map((project) => ({
    project,
    manifest: parseManifest(readText(project.manifestPath)),
  }));

  const packaged = new Set(packageIds());

  // Union of every version known to any source.
  const allVersions = new Set(registry.keys());
  for (const { manifest } of projectData) for (const v of manifest.keys()) allVersions.add(v);
  for (const v of packaged) allVersions.add(v);

  const latestTracked = maxVersion(allVersions);
  const packagedThrough = maxVersion(packaged);
  const missingPackages = compareVersionCount(latestTracked, packaged, allVersions);

  const projects = projectData.map(({ project, manifest }) => {
    const head = maxVersion(manifest.keys());
    const headRow = head ? manifest.get(head) : null;
    return {
      projectKey: project.projectKey,
      displayName: project.displayName,
      head,
      headStatus: headRow?.status || 'Unknown',
      trackedVersions: manifest.size,
      dataBoundary: project.dataBoundary,
    };
  });

  const isCurrent = packagedThrough === latestTracked && missingPackages.length === 0;

  const state = {
    amcoreVersion: packagedThrough,
    amcoreHubRelease: packagedThrough ? `AMCORE-${packagedThrough.replace('AM-IMP-', '')}` : null,
    latestTrackedImprovement: latestTracked,
    packagedThrough,
    isCurrent,
    behindBy: missingPackages.length,
    missingPackages,
    totalTrackedImprovements: allVersions.size,
    totalPackagedVersions: packaged.size,
    projects,
    sources: {
      sharedRegistry: config.sharedRegistryPath,
      versionsFolder: versionsRoot,
      manifests: config.projects.map((p) => p.manifestPath),
    },
    generatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(path.join(root, 'config', 'amcore-version.json'), `${JSON.stringify(state, null, 2)}\n`, 'utf8');
  writeVersionMd(state);
  writeMatrix(state, registry, projectData, packaged);

  console.log(`AMCore version: ${state.amcoreVersion} (${state.amcoreHubRelease})`);
  console.log(`Latest tracked: ${state.latestTrackedImprovement}`);
  console.log(`Status: ${isCurrent ? 'CURRENT — packages cover every tracked version' : `BEHIND by ${state.behindBy}: ${missingPackages.join(', ')}`}`);
  console.log(`Packaged ${state.totalPackagedVersions} / tracked ${state.totalTrackedImprovements}`);
}

function writeVersionMd(state) {
  const date = state.generatedAt.slice(0, 10);
  const lines = [];
  lines.push('# AMCore Version');
  lines.push('');
  lines.push('AMCore is the version master and core-code holder for the AM family');
  lines.push('(SevenAM, HOZO_AM, and any future AM project). This file is generated by');
  lines.push('`node tools/build-amcore-version.js` from the shared registry, the project');
  lines.push('manifests, and the packages in `versions/`. Do not edit it by hand.');
  lines.push('');
  lines.push(`_Last generated: ${date}_`);
  lines.push('');
  lines.push('## At A Glance');
  lines.push('');
  lines.push('| Field | Value |');
  lines.push('| --- | --- |');
  lines.push(`| AMCore version (packages held through) | \`${state.amcoreVersion}\` |`);
  lines.push(`| AMCore hub release | \`${state.amcoreHubRelease}\` |`);
  lines.push(`| Latest tracked improvement (ecosystem) | \`${state.latestTrackedImprovement}\` |`);
  lines.push(`| AMCore current? | ${state.isCurrent ? 'Yes — every tracked version is packaged' : `No — behind by ${state.behindBy}`} |`);
  lines.push(`| Packaged versions | ${state.totalPackagedVersions} |`);
  lines.push(`| Tracked improvements | ${state.totalTrackedImprovements} |`);
  lines.push('');
  if (state.missingPackages.length) {
    lines.push('## Tracked But Not Yet Packaged');
    lines.push('');
    for (const v of state.missingPackages) lines.push(`- \`${v}\``);
    lines.push('');
    lines.push('Run `node tools/backfill-version-packages.js` to create packages for these.');
    lines.push('');
  }
  lines.push('## Project Heads');
  lines.push('');
  lines.push('| Project | Current head | Status | Tracked versions |');
  lines.push('| --- | --- | --- | --- |');
  for (const p of state.projects) {
    lines.push(`| ${p.displayName} (\`${p.projectKey}\`) | \`${p.head}\` | ${p.headStatus} | ${p.trackedVersions} |`);
  }
  lines.push('');
  lines.push('## Definitions');
  lines.push('');
  lines.push('- **AMCore version**: the highest `AM-IMP` version AMCore fully packages in `versions/`.');
  lines.push('  This is "what version AMCore itself is".');
  lines.push('- **Latest tracked improvement**: the highest `AM-IMP` version known to any source');
  lines.push('  (registry or a project manifest). This is "the current version of the family".');
  lines.push('- AMCore is **current** when it packages every tracked version up to the latest.');
  lines.push('');
  fs.writeFileSync(path.join(root, 'VERSION.md'), `${lines.join('\n').trim()}\n`, 'utf8');
}

function writeMatrix(state, registry, projectData, packaged) {
  const date = state.generatedAt.slice(0, 10);
  const allVersions = new Set(registry.keys());
  for (const { manifest } of projectData) for (const v of manifest.keys()) allVersions.add(v);
  for (const v of packaged) allVersions.add(v);
  const sorted = [...allVersions].sort();

  const hozo = projectData.find((p) => p.project.projectKey === 'HOZO_AM')?.manifest || new Map();
  const seven = projectData.find((p) => p.project.projectKey === 'SEVEN_AM')?.manifest || new Map();

  const lines = [];
  lines.push('# Current Version Matrix');
  lines.push('');
  lines.push('Generated by `node tools/build-amcore-version.js` from the shared improvement');
  lines.push('registry and each project\'s improvement manifest. Do not edit by hand.');
  lines.push('');
  lines.push(`_Last generated: ${date}_`);
  lines.push('');
  lines.push(`- AMCore version (packaged through): \`${state.amcoreVersion}\``);
  lines.push(`- Latest tracked improvement: \`${state.latestTrackedImprovement}\``);
  lines.push('');
  lines.push('Editable planning copies (not authoritative for status):');
  lines.push('');
  lines.push('- [AM_VERSION_CONTROL_TABLE.md](AM_VERSION_CONTROL_TABLE.md)');
  lines.push('- [AM_VERSION_CONTROL_TABLE.xlsx](AM_VERSION_CONTROL_TABLE.xlsx)');
  lines.push('');
  lines.push('| Version | Improvement | HOZO AM | 7AM | AMCore package | Note |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const version of sorted) {
    const reg = registry.get(version);
    const improvement = reg?.improvement
      || hozo.get(version)?.improvement
      || seven.get(version)?.improvement
      || '';
    const hozoStatus = hozo.get(version)?.status || reg?.hozoStatus || 'Missing';
    const sevenStatus = seven.get(version)?.status || reg?.sevenStatus || 'Missing';
    const held = packaged.has(version) ? 'Held' : 'Missing';
    const note = (reg?.notes || '').replace(/\|/g, '/');
    lines.push(`| \`${version}\` | ${improvement} | ${hozoStatus} | ${sevenStatus} | ${held} | ${note} |`);
  }
  lines.push('');
  fs.writeFileSync(path.join(root, 'docs', 'CURRENT_VERSION_MATRIX.md'), `${lines.join('\n').trim()}\n`, 'utf8');
}

main();
