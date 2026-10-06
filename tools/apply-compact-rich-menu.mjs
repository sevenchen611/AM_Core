import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
const value = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || '' : ''; };
const apply = args.includes('--apply');
const config = JSON.parse(await readFile(path.join(root, 'versions/AM-IMP-2026.1006.04/config/work-journal-uof-rich-menu.json'), 'utf8'));
const uofArea = config.areas?.[0];
if (config.areas.length !== 1 || uofArea.action.type !== 'message' || uofArea.action.text !== '待簽'
  || uofArea.bounds.x !== 1250 || uofArea.bounds.y !== 0 || uofArea.bounds.width !== 1250 || uofArea.bounds.height !== 843) {
  throw new Error('Expected only the right-side UOF 待簽 action; the journal must remain inactive.');
}
for (const { bounds } of config.areas) {
  if (!Object.values(bounds).every(Number.isInteger) || bounds.x < 0 || bounds.y < 0 || bounds.width <= 0 || bounds.height <= 0
    || bounds.x + bounds.width > config.size.width || bounds.y + bounds.height > config.size.height) throw new Error('Invalid click bounds.');
}
const image = await readFile(path.join(root, 'assets/line/work-journal-uof-rich-menu.png'));
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
if (current.richMenuId !== created.richMenuId || JSON.stringify(menu.areas) !== JSON.stringify(config.areas)) throw new Error('Default menu verification failed; use the saved receipt to restore.');
console.log(JSON.stringify({ ok: true, defaultApplied: true, areas: menu.areas.map(a => a.action.label), receiptPath }));
