const fs = require('fs');
const path = require('path');

const targetRoot = process.argv[2];

if (!targetRoot) {
  console.error('Usage: node verify-task-evidence-media.js <AMCore-or-project-root>');
  process.exit(1);
}

const root = path.resolve(targetRoot);
const candidateFiles = [
  path.join(root, 'tools', 'build-user-ui-connected-preview.js'),
  path.join(root, 'scripts', 'build-user-ui-connected-preview.js'),
].filter((filePath) => fs.existsSync(filePath));

function assertIncludes(text, needle, label, failures) {
  if (!text.includes(needle)) failures.push(label);
}

function assertRegex(text, pattern, label, failures) {
  if (!pattern.test(text)) failures.push(label);
}

function walkFiles(dir, predicate, files = []) {
  if (!fs.existsSync(dir)) return files;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walkFiles(fullPath, predicate, files);
    else if (predicate(fullPath)) files.push(fullPath);
  }
  return files;
}

function verifyGenerator(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const failures = [];

  assertIncludes(
    text,
    'renderEvidenceMessageCard(message, model.attachments)',
    'task evidence cards must receive attachment records',
    failures
  );
  assertIncludes(
    text,
    'const messageAttachments = attachmentsForMessage(message, attachments);',
    'evidence cards must match attachments to the source message',
    failures
  );
  assertRegex(
    text,
    /function\s+renderMessageContent\s*\([^)]*attachments\s*=\s*\[\]/,
    'message renderer must accept matched attachments',
    failures
  );
  assertIncludes(
    text,
    '...(message.media || [])',
    'message renderer must include media stored on the message record',
    failures
  );
  assertIncludes(
    text,
    'attachments.flatMap((attachment) => attachment.fileLinks || [])',
    'message renderer must include attachment file links',
    failures
  );
  assertIncludes(
    text,
    '<div class="message-media">',
    'message renderer must output media markup',
    failures
  );
  assertRegex(
    text,
    /function\s+renderMessageMedia[\s\S]*<img\s+src=/,
    'image media must render as clickable thumbnails',
    failures
  );
  assertRegex(
    text,
    /function\s+renderMessageMedia[\s\S]*class="message-file"/,
    'non-image media must render as file links',
    failures
  );
  assertRegex(
    text,
    /function\s+renderLineArchiveMessage[\s\S]*renderLineArchiveMedia/,
    'LINE archive task content must render media referenced by message ids',
    failures
  );
  assertRegex(
    text,
    /function\s+renderLineArchiveMedia[\s\S]*圖片[\s\S]*renderMessageContent/,
    'LINE archive media renderer must resolve image ids back to message media',
    failures
  );
  assertRegex(
    text,
    /function\s+attachmentsForMessage[\s\S]*lineMessageId[\s\S]*messageUrl/,
    'attachments must be matched by message id, LINE message id, or message URL',
    failures
  );

  return failures;
}

function generatedMediaEvidenceCount() {
  const docsDir = path.join(root, 'docs');
  const pages = walkFiles(docsDir, (filePath) => /^user-ui-(task|line)-.+\.html$/.test(path.basename(filePath)));
  let count = 0;
  for (const pagePath of pages) {
    const html = fs.readFileSync(pagePath, 'utf8');
    if (html.includes('message-media') && (html.includes('<img ') || html.includes('message-file'))) count += 1;
  }
  return count;
}

function main() {
  if (!candidateFiles.length) {
    console.error(`No User UI generator found under ${root}`);
    process.exit(1);
  }

  const results = candidateFiles.map((filePath) => ({
    filePath,
    failures: verifyGenerator(filePath),
  }));
  const failures = results.flatMap((result) => result.failures.map((failure) => `${result.filePath}: ${failure}`));
  const mediaPages = generatedMediaEvidenceCount();

  const report = {
    ok: failures.length === 0,
    targetRoot: root,
    checkedFiles: results.map((result) => result.filePath),
    generatedMediaPages: mediaPages,
    failures,
  };

  console.log(JSON.stringify(report, null, 2));
  if (failures.length) process.exit(1);
}

main();
