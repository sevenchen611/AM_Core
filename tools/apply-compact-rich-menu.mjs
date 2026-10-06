import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || '' : ''; };
const apply = args.includes('--apply');
const configPath = path.resolve(root, value('--config') || 'versions/AM-IMP-2026.1006.06/config/work-journal-uof-rich-menu.json');
const imagePath = path.resolve(root, value('--image') || 'assets/line/work-journal-uof-rich-menu-active-half-height.png');
const config = JSON.parse(await readFile(configPath, 'utf8'));
const uofArea = config.areas?.find(area => area.action?.type === 'message');
const journalArea = config.areas?.find(area => area.action?.type === 'uri');
if (![1, 2].includes(config.areas?.length) || !uofArea || uofArea.action.text !== '待簽'
  || config.size.width !== 2500 || !Number.isInteger(config.size.height) || config.size.height < 250
  || uofArea.bounds.x !== 1250 || uofArea.bounds.y !== 0 || uofArea.bounds.width !== 1250 || uofArea.bounds.height !== config.size.height) {
  throw new Error('Expected the right-side UOF 待簽 action with an optional left-side journal URI.');
}
if (config.areas.length === 2) {
  if (!journalArea || journalArea.bounds.x !== 0 || journalArea.bounds.y !== 0 || journalArea.bounds.width !== 1250 || journalArea.bounds.height !== config.size.height) {
    throw new Error('The journal URI must occupy exactly the left half.');
  }
  if (journalArea.action.uri === '{{WORK_JOURNAL_URL}}') {
    if (!value('--journal-url')) throw new Error('Provide --journal-url for the active journal menu.');
    journalArea.action.uri = value('--journal-url');
  }
  const journalUrl = new URL(journalArea.action.uri);
  if (journalUrl.protocol !== 'https:' || journalUrl.username || journalUrl.password || ['localhost', '127.0.0.1', '::1'].includes(journalUrl.hostname)) {
    throw new Error('The journal link must be a mobile-accessible HTTPS URL.');
  }
}
for (const { bounds } of config.areas) {
  if (!Object.values(bounds).every(Number.isInteger) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > config.size.width || bounds.y + bounds.height > config.size.height) throw new Error('Invalid click bounds.');
}
const image = await readFile(imagePath);
if (image.length > 1024 * 1024 || image.readUInt32BE(16) !== config.size.width || image.readUInt32BE(20) !== config.size.height) throw new Error('Invalid menu image dimensions or size.');
if (!apply) {
  console.log(JSON.stringify({ dryRun: true, richMenu: config, imageBytes: image.length }, null, 2));
  process.exit(0);
}
const token = process.env.LINE_CHANNEL_ACCESS_TOKEN;
const expectedBot = value('--expected-bot');
const receiptFile = value('--receipt');
if (!token || !expectedBot || !receiptFile) throw new Error('--apply requires LINE_CHANNEL_ACCESS_TOKEN, --expected-bot (basic ID) and --receipt outside this repository.');
const receiptPath = path.resolve(receiptFile);
const relative = path.relative(root, receiptPath);
if (!relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) throw new Error('Production receipts must be saved outside AMCore.');
async function request(apiPath, options = {}, data = false) {
  const response = await fetch(`${data ? 'https://api-data.line.me' : 'https://api.line.me'}${apiPath}`, {
    ...options, headers: { Authorization: `Bearer ${token}`, ...options.headers }, signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(`LINE API ${response.status}: ${body.message || 'request failed'}`), { status: response.status });
  return body;
}
const bot = await request('/v2/bot/info');
if (bot.basicId !== expectedBot) throw new Error('LINE channel does not match --expected-bot. No menu was changed.');
await request('/v2/bot/richmenu/validate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
let previous = null;
let restoreManagerDefault = false;
try { previous = await request('/v2/bot/user/all/richmenu'); }
catch (error) {
  if (![403, 404].includes(error.status)) throw error;
  restoreManagerDefault = true;
}
const created = await request('/v2/bot/richmenu', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) });
if (!created.richMenuId) throw new Error('LINE API did not return a menu ID.');
await mkdir(path.dirname(receiptPath), { recursive: true });
const receipt = { createdAt: new Date().toISOString(), botBasicId: bot.basicId, previous, restoreManagerDefault, richMenuId: created.richMenuId, defaultApplied: false };
await writeFile(receiptPath, JSON.stringify(receipt, null, 2), { flag: 'wx' });
await request(`/v2/bot/richmenu/${created.richMenuId}/content`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: image }, true);
await request(`/v2/bot/user/all/richmenu/${created.richMenuId}`, { method: 'POST' });
receipt.defaultApplied = true;
await writeFile(receiptPath, JSON.stringify(receipt, null, 2));
const current = await request('/v2/bot/user/all/richmenu');
const menu = await request(`/v2/bot/richmenu/${created.richMenuId}`);
if (current.richMenuId !== created.richMenuId || !isDeepStrictEqual(menu.areas, config.areas)) throw new Error('Default menu verification failed; use the saved receipt to restore.');
console.log(JSON.stringify({ ok: true, defaultApplied: true, areas: menu.areas.map(a => a.action.label), receiptPath }));
