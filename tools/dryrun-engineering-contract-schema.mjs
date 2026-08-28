import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const schemaPath = new URL('../versions/AM-IMP-2026.0828.01/schemas/engineering-contract-evidence.sql', import.meta.url);
const expectedTables = [
  'acceptance_criteria',
  'artifacts',
  'contract_documents',
  'contract_template_versions',
  'contract_templates',
  'contract_versions',
  'contracts',
  'integration_outbox',
  'payment_milestones',
  'schema_meta',
  'signatures',
  'signing_events',
  'signing_sessions',
];

const db = new PGlite({ extensions: { pgcrypto } });
try {
  await db.exec(await fs.readFile(schemaPath, 'utf8'));

  const meta = await db.query(
    'SELECT version FROM engineering_contracts.schema_meta WHERE singleton = true',
  );
  assert.equal(meta.rows[0]?.version, '2026-08-28.engineering-contract-evidence.v2');

  const tables = await db.query(
    `SELECT table_name
       FROM information_schema.tables
      WHERE table_schema = 'engineering_contracts' AND table_type = 'BASE TABLE'
      ORDER BY table_name`,
  );
  assert.deepEqual(tables.rows.map((row) => row.table_name), expectedTables);

  const sessionColumns = await db.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'engineering_contracts' AND table_name = 'signing_sessions'`,
  );
  const columnNames = new Set(sessionColumns.rows.map((row) => row.column_name));
  assert.equal(columnNames.has('token_digest'), true);
  assert.equal(columnNames.has('token'), false);
  assert.equal(columnNames.has('raw_token'), false);
  assert.equal(columnNames.has('external_session_id'), true);
  assert.equal(columnNames.has('row_version'), true);

  const immutableTriggers = await db.query(
    `SELECT event_object_table, event_manipulation
       FROM information_schema.triggers
      WHERE trigger_schema = 'engineering_contracts'
        AND event_object_table IN ('signing_events', 'signatures', 'artifacts')`,
  );
  const immutableActions = new Set(immutableTriggers.rows.map(
    (row) => `${row.event_object_table}:${row.event_manipulation}`,
  ));
  for (const table of ['signing_events', 'signatures', 'artifacts']) {
    assert.equal(immutableActions.has(`${table}:UPDATE`), true, `${table} UPDATE trigger missing`);
    assert.equal(immutableActions.has(`${table}:DELETE`), true, `${table} DELETE trigger missing`);
  }

  await assert.rejects(
    db.query(`INSERT INTO engineering_contracts.contracts
      (tenant_key, project_notion_page_id, notion_contract_page_id, title, created_by, updated_by)
      VALUES ('other', '1111111111111111', '2222222222222222', 'invalid tenant', 'test', 'test')`),
    /check constraint/i,
  );

  console.log('Engineering contract disposable PostgreSQL dry-run passed: schema executes with pgcrypto, required tables and immutable triggers exist, raw tokens are absent, and tenant isolation fails closed.');
} finally {
  await db.close();
}
