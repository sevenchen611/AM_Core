const fs = require('fs');
const path = require('path');

const packageId = process.argv[2];

if (!packageId) {
  console.error('Usage: node tools/check-upgrade-package.js AM-IMP-YYYY.MMDD.NN');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const packageDir = path.join(root, 'versions', packageId);
const requiredFiles = [
  'README.md',
  'upgrade.json',
  'INSTALL.md',
  'VERIFY.md',
  'ROLLBACK.md'
];

function exists(relativePath) {
  return fs.existsSync(path.join(packageDir, relativePath));
}

function main() {
  const missing = [];

  if (!fs.existsSync(packageDir)) {
    console.error(`Missing package folder: ${packageDir}`);
    process.exit(1);
  }

  for (const file of requiredFiles) {
    if (!exists(file)) missing.push(file);
  }

  const upgradeJsonPath = path.join(packageDir, 'upgrade.json');
  let upgrade = null;
  if (fs.existsSync(upgradeJsonPath)) {
    try {
      upgrade = JSON.parse(fs.readFileSync(upgradeJsonPath, 'utf8'));
    } catch (error) {
      console.error(`Invalid upgrade.json: ${error.message}`);
      process.exit(1);
    }
  }

  const metadataProblems = [];
  if (upgrade) {
    for (const key of ['id', 'name', 'type', 'portable', 'requiresDatabases', 'requiresEnv', 'requiresScripts', 'installTargets', 'dataIsolation', 'definitionOfDone']) {
      if (!(key in upgrade)) metadataProblems.push(key);
    }
    if (upgrade.id && upgrade.id !== packageId) {
      metadataProblems.push(`id mismatch: expected ${packageId}, got ${upgrade.id}`);
    }
  }

  if (missing.length || metadataProblems.length) {
    console.log(`Package check failed: ${packageId}`);
    if (missing.length) console.log(`Missing files: ${missing.join(', ')}`);
    if (metadataProblems.length) console.log(`Metadata problems: ${metadataProblems.join(', ')}`);
    process.exit(1);
  }

  console.log(`Package is complete: ${packageId}`);
}

main();
