// 只產生「待審核」候選，不寫 Portal / Notion。
// node plan-account-review.mjs --users users.json --directory directory.json [--engineering-map map.json] [--out review.json]
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, item, index, all) => {
  if (item.startsWith('--')) rows.push([item.slice(2), all[index + 1]]);
  return rows;
}, []));
if (!args.users || !args.directory) {
  console.error('Usage: node plan-account-review.mjs --users users.json --directory directory.json [--engineering-map map.json] [--out review.json]');
  process.exit(2);
}
const readJson = (file) => JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
const usersDoc = readJson(args.users);
const directory = readJson(args.directory);
const engineeringMap = args['engineering-map'] ? readJson(args['engineering-map']) : {};
const users = Array.isArray(usersDoc) ? usersDoc : usersDoc.users || [];
const tenants = Array.isArray(directory) ? directory : directory.tenants || [];
const norm = (value) => String(value || '').replace(/-/g, '').toLowerCase();

const review = [];
for (const user of users) {
  if (!user?.id || user.role === 'owner') continue;
  const features = new Set(Array.isArray(user.allowedFeatures) ? user.allowedFeatures : []);
  const existing = user.amAccess && typeof user.amAccess === 'object' ? user.amAccess : {};
  const candidates = {};
  for (const tenant of tenants) {
    if (!tenant?.key) continue;
    if (existing[tenant.key]) {
      candidates[tenant.key] = { status: 'already-configured', current: existing[tenant.key] };
      continue;
    }
    const legacyRoots = tenant.key === 'engineering'
      ? new Set(['am-engineering', 'am-buildam', tenant.featureKey])
      : new Set([`am-${tenant.key}`, tenant.featureKey]);
    const reasons = [];
    const groupIds = new Set();
    if ([...legacyRoots].some((key) => key && features.has(key))) {
      reasons.push('legacy-tenant-entry');
      for (const group of tenant.groups || []) if (group.status === '啟用') groupIds.add(group.id);
    }
    if (tenant.key === 'engineering') {
      for (const [suffix, ids] of Object.entries(engineeringMap || {})) {
        if (!features.has(`am-buildam-${suffix}`)) continue;
        reasons.push(`legacy-engineering-scope:${suffix}`);
        for (const id of Array.isArray(ids) ? ids : []) groupIds.add(id);
      }
    }
    if (!reasons.length) continue;
    const validIds = new Map((tenant.groups || []).map((group) => [norm(group.id), group.id]));
    const candidateGroupBindingIds = [...groupIds].map((id) => validIds.get(norm(id))).filter(Boolean);
    candidates[tenant.key] = {
      status: 'needs-owner-review',
      reasons,
      candidateGroupBindingIds,
      suggestedAmAccess: candidateGroupBindingIds.length
        ? { mode: 'selected', groupBindingIds: candidateGroupBindingIds, reviewed: false }
        : null,
      note: '候選僅供最高管理者勾選；不得自動寫回或自動升級為 all。',
    };
  }
  if (Object.keys(candidates).length) {
    review.push({ userId: user.id, username: user.username, displayName: user.displayName, candidates });
  }
}

const output = {
  generatedAt: new Date().toISOString(),
  mode: 'review-only',
  users: review,
  summary: { inputUsers: users.length, accountsNeedingReview: review.length },
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (args.out) fs.writeFileSync(path.resolve(args.out), serialized, 'utf8');
else process.stdout.write(serialized);
