// Backfill AMCore upgrade packages for versions that exist in the shared
// registry / project manifests but have no package folder under versions/ yet.
//
// AMCore is the version master. Every AM-IMP version must have a package here,
// even if it was implemented and deployed inside SevenAM or HOZO_AM first.
//
// This tool does not invent content. For each missing version it reads the
// authoritative project upgrade record (SevenAM first, then HOZO_AM) and the
// shared registry row, then writes a complete 5-file package whose body is
// reconstructed from that real record and clearly marked as backfilled.
//
// Usage:
//   node tools/backfill-version-packages.js           # write missing packages
//   node tools/backfill-version-packages.js --dry-run # report only

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config', 'projects.json'), 'utf8'));
const versionsRoot = path.join(root, 'versions');
const dryRun = process.argv.includes('--dry-run');

function readText(filePath) {
  return filePath && fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : '';
}

function parseRegistry(markdown) {
  const rows = new Map();
  for (const line of markdown.split(/\r?\n/)) {
    if (!line.startsWith('| `AM-IMP-')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    // cells[0] is empty (leading pipe). Real cells start at index 1.
    const version = (cells[1] || '').replace(/`/g, '');
    // Ignore range/bulk-parity labels like `AM-IMP-...01–AM-IMP-...15`.
    if (!/^AM-IMP-\d{4}\.\d{4}\.\d{2}$/.test(version)) continue;
    rows.set(version, {
      version,
      improvement: cells[2] || '',
      type: cells[3] || '',
      portable: (cells[4] || '').toLowerCase() === 'yes',
      hozoStatus: cells[5] || '',
      sevenStatus: cells[6] || '',
      notes: cells[7] || '',
    });
  }
  return rows;
}

function existingPackageIds() {
  if (!fs.existsSync(versionsRoot)) return new Set();
  return new Set(
    fs.readdirSync(versionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('AM-IMP-'))
      .map((entry) => entry.name)
  );
}

function findSourceDoc(version) {
  // Prefer SevenAM, then HOZO_AM. Match any file ending with <version>.md.
  const order = ['SEVEN_AM', 'HOZO_AM'];
  const byKey = new Map(config.projects.map((p) => [p.projectKey, p]));
  for (const key of order) {
    const project = byKey.get(key);
    if (!project) continue;
    const dir = project.upgradeRecordsPath;
    if (!fs.existsSync(dir)) continue;
    const match = fs.readdirSync(dir).find((name) => name.endsWith(`${version}.md`));
    if (match) {
      return { projectKey: key, displayName: project.displayName, path: path.join(dir, match) };
    }
  }
  return null;
}

function extractSection(markdown, heading) {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase().startsWith(`## ${heading.toLowerCase()}`));
  if (start === -1) return '';
  const body = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('## ')) break;
    body.push(lines[i]);
  }
  return body.join('\n').trim();
}

function parseEnvNames(envSection) {
  if (!envSection) return [];
  const cleaned = envSection.replace(/\(.*?\)/g, ' ').replace(/\.$/, '');
  const tokens = cleaned.split(/[\s,/]+/).map((t) => t.trim());
  const names = tokens.filter((t) => /^[A-Z][A-Z0-9_]{2,}$/.test(t));
  return [...new Set(names)];
}

function buildUpgradeJson(version, registry, source, sections) {
  const requiresEnv = parseEnvNames(sections.env);
  return {
    id: version,
    name: registry?.improvement || version,
    type: registry?.type || 'Core',
    portable: registry ? registry.portable : true,
    requiresDatabases: [],
    requiresEnv,
    requiresScripts: [],
    installTargets: ['HOZO_AM', 'SEVEN_AM', 'FUTURE_AM_PROJECTS'],
    dataIsolation: {
      canCopyCode: true,
      canCopySchema: true,
      canCopyData: false,
      canCopySecrets: false,
    },
    definitionOfDone: [
      'Package files are complete',
      'Project manifest is updated',
      'Upgrade record is created',
      'Local verification passed',
    ],
    backfill: {
      backfilled: true,
      backfilledAt: new Date().toISOString().slice(0, 10),
      authoritativeSource: source ? `${source.displayName}: ${path.basename(source.path)}` : 'none',
      projectStatus: {
        HOZO_AM: registry?.hozoStatus || 'Unknown',
        SEVEN_AM: registry?.sevenStatus || 'Unknown',
      },
    },
  };
}

function titleCase(version, name) {
  return `${version} ${name}`;
}

function readmeContent(version, registry, source, sections) {
  const name = registry?.improvement || version;
  const lines = [];
  lines.push(`# ${titleCase(version, name)}`);
  lines.push('');
  lines.push('> Backfilled package. This improvement was implemented and tracked inside the');
  lines.push('> production projects first; AMCore now holds it so the version master is complete.');
  lines.push(`> Authoritative upgrade record: ${source ? `${source.displayName} \`${path.basename(source.path)}\`` : 'not found'}.`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(sections.summary || registry?.notes || '(see authoritative upgrade record)');
  lines.push('');
  if (sections.changes) {
    lines.push('## Changes');
    lines.push('');
    lines.push(sections.changes);
    lines.push('');
  }
  lines.push('## Type');
  lines.push('');
  lines.push(registry?.type || 'Core');
  lines.push('');
  lines.push('## Project Status At Backfill');
  lines.push('');
  lines.push(`- HOZO AM: ${registry?.hozoStatus || 'Unknown'}`);
  lines.push(`- 7AM: ${registry?.sevenStatus || 'Unknown'}`);
  lines.push('');
  if (registry?.notes) {
    lines.push('## Registry Note');
    lines.push('');
    lines.push(registry.notes);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function installContent(version, registry, source, sections) {
  const envNames = parseEnvNames(sections.env);
  const lines = [];
  lines.push(`# Install ${version}`);
  lines.push('');
  lines.push('This package was backfilled from a production upgrade record. Install it into a');
  lines.push('target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes');
  lines.push('below in that project only. Never copy another project\'s secrets or data.');
  lines.push('');
  lines.push(`Authoritative source record: ${source ? `${source.displayName} \`${path.basename(source.path)}\`` : 'not found'}.`);
  lines.push('');
  lines.push('## Changes To Apply');
  lines.push('');
  lines.push(sections.changes || '(see authoritative upgrade record)');
  lines.push('');
  lines.push('## Environment Variables (names only)');
  lines.push('');
  lines.push(envNames.length ? envNames.map((n) => `- \`${n}\``).join('\n') : 'None.');
  lines.push('');
  lines.push('## Data Isolation Check');
  lines.push('');
  lines.push(sections.isolation || 'Use only the target project\'s own LINE, Notion, Render, and environment values.');
  lines.push('');
  return `${lines.join('\n').trim()}\n`;
}

function verifyContent(version, sections) {
  const lines = [];
  lines.push(`# Verify ${version}`);
  lines.push('');
  lines.push('## Verification Performed (from source record)');
  lines.push('');
  lines.push(sections.verification || '(see authoritative upgrade record)');
  lines.push('');
  lines.push('## Re-verification For A New Install');
  lines.push('');
  lines.push('- `node --check` passes on any changed scripts.');
  lines.push('- The target project shows the new behavior using its own data only.');
  lines.push('- No values from another project appear in config, logs, or output.');
  lines.push('');
  return `${lines.join('\n').trim()}\n`;
}

function rollbackContent(version, sections) {
  const lines = [];
  lines.push(`# Rollback ${version}`);
  lines.push('');
  lines.push('This package was backfilled, so rollback is described generically.');
  lines.push('');
  lines.push('- Revert the commit(s) that applied this version in the target project.');
  lines.push('- Restore the previous values of any environment variables introduced by this version.');
  lines.push('- If a database column or table was added, keep it (additive) or drop it only after');
  lines.push('  confirming no other version depends on it.');
  lines.push('- Mark the version as rolled back in the target project\'s improvement manifest.');
  lines.push('');
  if (sections.status) {
    lines.push('## Source Status Note');
    lines.push('');
    lines.push(sections.status);
    lines.push('');
  }
  return `${lines.join('\n').trim()}\n`;
}

function main() {
  const registry = parseRegistry(readText(config.sharedRegistryPath));
  const existing = existingPackageIds();
  const missing = [...registry.keys()].filter((v) => !existing.has(v)).sort();

  if (!missing.length) {
    console.log('No missing packages. AMCore versions/ already covers the registry.');
    return;
  }

  console.log(`${dryRun ? '[dry-run] ' : ''}Backfilling ${missing.length} package(s): ${missing.join(', ')}`);

  for (const version of missing) {
    const reg = registry.get(version);
    const source = findSourceDoc(version);
    const doc = readText(source?.path);
    const sections = {
      summary: extractSection(doc, 'Summary'),
      changes: extractSection(doc, 'Changes'),
      env: extractSection(doc, 'Environment Variables'),
      isolation: extractSection(doc, 'Data Isolation Check'),
      verification: extractSection(doc, 'Verification'),
      status: extractSection(doc, 'Status'),
    };

    const files = {
      'upgrade.json': `${JSON.stringify(buildUpgradeJson(version, reg, source, sections), null, 2)}\n`,
      'README.md': readmeContent(version, reg, source, sections),
      'INSTALL.md': installContent(version, reg, source, sections),
      'VERIFY.md': verifyContent(version, sections),
      'ROLLBACK.md': rollbackContent(version, sections),
    };

    const dir = path.join(versionsRoot, version);
    if (dryRun) {
      console.log(`  ${version} <- ${source ? path.basename(source.path) : 'NO SOURCE DOC'}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), content, 'utf8');
    }
    console.log(`  wrote ${version} <- ${source ? path.basename(source.path) : 'NO SOURCE DOC'}`);
  }
}

main();
