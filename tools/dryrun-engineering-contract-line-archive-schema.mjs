import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const files = [
  '../versions/AM-IMP-2026.0828.01/schemas/engineering-contract-evidence.sql',
  '../versions/AM-IMP-2026.0828.05/schemas/engineering-contract-draft-review-v3.sql',
  '../versions/AM-IMP-2026.0831.04/schemas/engineering-contract-line-archive-v4.sql',
];
function portable(sql) {
  return sql.replace(/\\if :\{\?runtime_role\}[\s\S]*?\\endif\s*/g, '')
    .replace(/:"runtime_role"/g, 'engineering_contract_runtime');
}

const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec('CREATE ROLE engineering_contract_runtime');
  for (const file of files) await db.exec(portable(await fs.readFile(new URL(file, import.meta.url), 'utf8')));
  const meta = await db.query('SELECT version FROM engineering_contracts.schema_meta WHERE singleton = true');
  assert.equal(meta.rows[0].version, '2026-08-31.engineering-contract-evidence.v4');
  const columns = await db.query(`SELECT column_name FROM information_schema.columns
    WHERE table_schema='engineering_contracts' AND table_name='contract_line_conversation_archives'`);
  const names = new Set(columns.rows.map((row) => row.column_name));
  for (const name of ['archive_key','version_id','draft_review_id','started_after','ended_at','source_manifest_sha256','pdf_sha256']) {
    assert.equal(names.has(name), true, `${name} missing`);
  }
  const triggers = await db.query(`SELECT event_manipulation FROM information_schema.triggers
    WHERE trigger_schema='engineering_contracts' AND event_object_table='contract_line_conversation_archives'`);
  const actions = new Set(triggers.rows.map((row) => row.event_manipulation));
  assert.equal(actions.has('UPDATE'), true);
  assert.equal(actions.has('DELETE'), true);
  console.log('Engineering contract LINE archive schema dry-run passed: v4 migration, immutable trigger, evidence hashes, and tenant table are present.');
} finally {
  await db.close();
}
