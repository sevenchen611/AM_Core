import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [, , configArg, ...rawArgs] = process.argv;
const args = new Set(rawArgs);

function fail(message) {
  console.error(message);
  process.exit(1);
}

function optionValue(name) {
  const index = rawArgs.indexOf(name);
  return index >= 0 ? rawArgs[index + 1] : '';
}

if (!configArg) {
  fail('Usage: node apply-rich-menu-actions.mjs <config.json> [--image image.png] [--apply]');
}

const configPath = path.resolve(configArg);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const imagePath = optionValue('--image') || config.imagePath || '';
const apply = args.has('--apply');

function validateRichMenu(menu) {
  if (!menu || typeof menu !== 'object' || Array.isArray(menu)) fail('Rich Menu config must be an object.');
  if (!menu.size || menu.size.width < 800 || menu.size.width > 2500 || menu.size.height < 250) {
    fail('Rich Menu size is outside LINE limits.');
  }
  if (!Array.isArray(menu.areas) || menu.areas.length !== 6) fail('Expected exactly six Rich Menu areas.');
  for (const area of menu.areas) {
    if (!area.bounds || !area.action || area.action.type !== 'message' || !area.action.text) {
      fail(`Invalid Rich Menu area: ${area.label || 'unnamed'}`);
    }
  }
}

function lineBody(menu) {
  return {
    size: menu.size,
    selected: menu.selected !== false,
    name: String(menu.name || 'AM Rich Menu').slice(0, 300),
    chatBarText: String(menu.chatBarText || 'Menu').slice(0, 14),
    areas: menu.areas.map((area) => ({
      bounds: area.bounds,
      action: area.action,
    })),
  };
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  return 'image/png';
}

async function lineRequest(url, options = {}) {
  const token = String(process.env.LINE_CHANNEL_ACCESS_TOKEN || '').trim();
  if (!token) fail('LINE_CHANNEL_ACCESS_TOKEN is required when --apply is used.');
  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  if (!response.ok) fail(`LINE API failed: ${response.status} ${JSON.stringify(body)}`);
  return body;
}

validateRichMenu(config);
const body = lineBody(config);

if (!apply) {
  console.log(JSON.stringify({ dryRun: true, richMenu: body, imagePath: imagePath || null }, null, 2));
  process.exit(0);
}

const created = await lineRequest('https://api.line.me/v2/bot/richmenu', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const richMenuId = created.richMenuId;
if (!richMenuId) fail('LINE API did not return richMenuId.');

if (imagePath) {
  const absoluteImagePath = path.resolve(imagePath);
  const image = await readFile(absoluteImagePath);
  await lineRequest(`https://api-data.line.me/v2/bot/richmenu/${encodeURIComponent(richMenuId)}/content`, {
    method: 'POST',
    headers: { 'Content-Type': contentType(absoluteImagePath) },
    body: image,
  });
}

if (config.default !== false) {
  await lineRequest(`https://api.line.me/v2/bot/user/all/richmenu/${encodeURIComponent(richMenuId)}`, {
    method: 'POST',
  });
}

console.log(JSON.stringify({ ok: true, richMenuId, default: config.default !== false, uploadedImage: Boolean(imagePath) }, null, 2));
