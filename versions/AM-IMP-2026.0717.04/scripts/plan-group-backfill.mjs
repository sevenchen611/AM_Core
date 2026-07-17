// 依來源 relation 產生舊資料「負責群組」回填計畫；絕不以群組名稱猜測，也不直接寫 Notion。
// input: { records:[{id, sourceMessageBindingIds?, meetingBindingIds?, feedbackBindingIds?}] }
// node plan-group-backfill.mjs --input records.json [--out plan.json]
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((rows, item, index, all) => {
  if (item.startsWith('--')) rows.push([item.slice(2), all[index + 1]]);
  return rows;
}, []));
if (!args.input) {
  console.error('Usage: node plan-group-backfill.mjs --input records.json [--out plan.json]');
  process.exit(2);
}
const doc = JSON.parse(fs.readFileSync(path.resolve(args.input), 'utf8'));
const records = Array.isArray(doc) ? doc : doc.records || [];
const norm = (value) => String(value || '').replace(/-/g, '').toLowerCase();
const planned = [];
for (const record of records) {
  const evidence = [
    ...(record.sourceMessageBindingIds || []).map((id) => ({ id, source: 'source-message' })),
    ...(record.meetingBindingIds || []).map((id) => ({ id, source: 'meeting' })),
    ...(record.feedbackBindingIds || []).map((id) => ({ id, source: 'feedback-ticket' })),
  ].filter((item) => item.id);
  const byId = new Map();
  for (const item of evidence) {
    const key = norm(item.id);
    if (!key) continue;
    if (!byId.has(key)) byId.set(key, { groupBindingId: item.id, evidenceSources: [] });
    byId.get(key).evidenceSources.push(item.source);
  }
  const matches = [...byId.values()];
  planned.push(matches.length === 1
    ? { id: record.id, decision: 'backfill', ...matches[0] }
    : matches.length > 1
      ? { id: record.id, decision: 'conflict-needs-review', candidates: matches }
      : { id: record.id, decision: 'unassigned', reason: '沒有可稽核的來源群組 relation；禁止以名稱猜測。' });
}
const output = {
  generatedAt: new Date().toISOString(),
  mode: 'dry-run-only',
  records: planned,
  summary: {
    total: planned.length,
    backfill: planned.filter((item) => item.decision === 'backfill').length,
    conflicts: planned.filter((item) => item.decision === 'conflict-needs-review').length,
    unassigned: planned.filter((item) => item.decision === 'unassigned').length,
  },
};
const serialized = `${JSON.stringify(output, null, 2)}\n`;
if (args.out) fs.writeFileSync(path.resolve(args.out), serialized, 'utf8');
else process.stdout.write(serialized);
