#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_ID = 'AM-IMP-2026.0718.01';
const packageDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) errors.push(message);
}

function packagePath(relativePath) {
  return path.join(packageDir, ...relativePath.split('/'));
}

function readText(relativePath) {
  const absolutePath = packagePath(relativePath);
  if (!fs.existsSync(absolutePath)) return '';
  return fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '');
}

function walk(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, files);
    else files.push(absolutePath);
  }
  return files;
}

const requiredFiles = [
  'README.md',
  'upgrade.json',
  'INSTALL.md',
  'VERIFY.md',
  'ROLLBACK.md',
  'ARCHITECTURE.md',
  'ENVIRONMENT.md',
  'REQUIRED_DATABASES.md',
  'schemas/postgresql-operational-memory.sql',
  'contracts/event-extraction.schema.json',
  'contracts/operational-memory-api.json',
  'config/operational-memory-contract.json',
  'config/reconciliation-policy.json',
  'config/query-answer-policy.json',
  'config/retention-policy.json',
  'notion-schemas/operational-memory-projections.json',
  'templates/tenant-operational-memory.example.json',
  'fixtures/acceptance-cases.json',
  'scripts/plan-tenant-install.mjs',
  'scripts/verify-operational-memory-package.mjs'
];

for (const relativePath of requiredFiles) {
  check(fs.existsSync(packagePath(relativePath)), `Missing required file: ${relativePath}`);
}

const jsonDocuments = new Map();
for (const absolutePath of walk(packageDir).filter((file) => file.toLowerCase().endsWith('.json'))) {
  const relativePath = path.relative(packageDir, absolutePath).split(path.sep).join('/');
  try {
    jsonDocuments.set(relativePath, JSON.parse(fs.readFileSync(absolutePath, 'utf8').replace(/^\uFEFF/, '')));
    checks += 1;
  } catch (error) {
    errors.push(`Invalid JSON in ${relativePath}: ${error.message}`);
  }
}

function document(relativePath) {
  return jsonDocuments.get(relativePath);
}

function requireKeys(value, keys, label) {
  for (const key of keys) check(value && Object.hasOwn(value, key), `${label} is missing ${key}`);
}

const upgrade = document('upgrade.json');
if (upgrade) {
  requireKeys(upgrade, [
    'id', 'name', 'type', 'portable', 'status', 'installTargets', 'requiresDatabases',
    'requiresEnv', 'requiresScripts', 'dataIsolation', 'dependsOn', 'definitionOfDone'
  ], 'upgrade.json');
  check(upgrade.id === PACKAGE_ID, `upgrade.json id must be ${PACKAGE_ID}`);
  check(upgrade.portable === true, 'upgrade.json portable must be true');
  check(upgrade.status === 'Ready', 'upgrade.json status must be Ready');
  check(Array.isArray(upgrade.installTargets) && ['AM_PLATFORM', 'HOZO_AM', 'SEVEN_AM', 'NEW_AM_PROJECT'].every((target) => upgrade.installTargets.includes(target)), 'upgrade.json installTargets must cover platform, existing AMs, and new AM projects');
  check(Array.isArray(upgrade.requiresScripts) && ['scripts/verify-operational-memory-package.mjs', 'scripts/plan-tenant-install.mjs'].every((script) => upgrade.requiresScripts.includes(script)), 'upgrade.json requiresScripts is incomplete');
  check(upgrade.dataIsolation?.canCopyData === false && upgrade.dataIsolation?.canCopySecrets === false, 'upgrade.json must forbid copying data and secrets');
  const done = JSON.stringify(upgrade.definitionOfDone ?? []).toLowerCase();
  check(done.includes('evidence'), 'definitionOfDone must include the evidence gate');
  check(done.includes('tenant') && done.includes('rls'), 'definitionOfDone must include tenant and RLS isolation');
  check(done.includes('structured'), 'definitionOfDone must include structured-first retrieval');
}

const contract = document('config/operational-memory-contract.json');
if (contract) {
  requireKeys(contract, ['schemaVersion', 'id', 'packageVersion', 'dataBoundary', 'tenantBoundary', 'layers', 'entities', 'goalPolicy', 'evidencePolicy', 'ruleTracePolicy', 'supersessionPolicy', 'adapterPorts', 'invariants'], 'operational-memory-contract.json');
  const text = JSON.stringify(contract).toLowerCase();
  check(text.includes('tenant_id'), 'Operational-memory contract must require tenant_id');
  check(text.includes('evidence'), 'Operational-memory contract must define evidence');
  check(text.includes('goal'), 'Operational-memory contract must define goal linkage');
  check(text.includes('rule'), 'Operational-memory contract must define rule traces');
}

const tenant = document('templates/tenant-operational-memory.example.json');
if (tenant) {
  requireKeys(tenant, ['schemaVersion', 'tenantId', 'tenantKey', 'displayName', 'envPrefix', 'runtimeEnabled', 'timezone', 'modules', 'operationalMemory'], 'tenant template');
  check(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tenant.tenantId ?? ''), 'Tenant template tenantId must be an RFC-style UUID');
  check(/^[a-z0-9][a-z0-9-]{1,62}$/.test(tenant.tenantKey ?? ''), 'Tenant template tenantKey must be a safe slug');
  check(['shared-platform-tenant', 'project-local-runtime'].includes(tenant.operationalMemory?.mode), 'Tenant template operationalMemory.mode is unsupported');
  const adapters = tenant.operationalMemory?.adapters;
  for (const name of ['sourceStore', 'attachmentStore', 'workQueue', 'eventStore', 'projectionStore', 'searchIndex', 'rulesProvider', 'notionProjection']) {
    check(adapters && Object.hasOwn(adapters, name), `Tenant template is missing adapter ${name}`);
  }
  const envNames = tenant.operationalMemory?.requiredEnvironmentVariables;
  check(Array.isArray(envNames) && envNames.every((name) => /^[A-Z][A-Z0-9_]+$/.test(name)), 'Tenant template may contain environment variable names only');
  const tenantText = JSON.stringify(tenant);
  check(!/(postgres(?:ql)?:\/\/[^\s"']+:[^\s"']+@|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:sk|ghp|xox[baprs])-[-A-Za-z0-9_]{12,})/i.test(tenantText), 'Tenant template appears to contain a secret value');
  check(!/\b[CUR][0-9a-f]{32}\b|\bsrv-[a-z0-9-]{8,}\b/i.test(tenantText), 'Tenant template appears to contain a production connector id');
}

const eventSchema = document('contracts/event-extraction.schema.json');
if (eventSchema) {
  const topRequired = eventSchema.required ?? [];
  for (const key of ['schema_version', 'tenant_id', 'source_batch_id', 'processor', 'rule_set', 'topic_threads', 'events', 'batch_outcome']) {
    check(topRequired.includes(key), `Event schema top-level required is missing ${key}`);
  }
  for (const definition of ['evidenceRef', 'ruleTrace', 'goalLink', 'statusChange', 'supersession', 'event']) {
    check(Boolean(eventSchema.$defs?.[definition]), `Event schema is missing $defs.${definition}`);
  }
  const eventDefinition = eventSchema.$defs?.event;
  const properties = eventDefinition?.properties ?? {};
  const required = eventDefinition?.required ?? [];
  const semanticKey = (pattern) => Object.keys(properties).find((key) => pattern.test(key));
  const evidenceKey = semanticKey(/evidence|source.*ref/i);
  const goalKey = semanticKey(/goal/i);
  const rulesKey = semanticKey(/rule/i);
  check(Boolean(evidenceKey) && required.includes(evidenceKey), 'Each event must require evidence');
  check(Boolean(goalKey) && required.includes(goalKey), 'Each event must require goal linkage');
  check(Boolean(rulesKey) && required.includes(rulesKey), 'Each event must require a rule trace');
  if (evidenceKey && properties[evidenceKey]?.type === 'array') check((properties[evidenceKey].minItems ?? 0) >= 1, 'Event evidence array must require at least one source');
  check(required.includes('tenant_id'), 'Each event must require tenant_id');
  check(Object.keys(properties).some((key) => /supersession|supersede/i.test(key)), 'Event schema must model supersession');
}

const fixtures = document('fixtures/acceptance-cases.json');
if (fixtures) {
  requireKeys(fixtures, ['schemaVersion', 'id', 'description', 'syntheticOnly', 'coverageRequirements', 'cases'], 'acceptance fixtures');
  check(fixtures.syntheticOnly === true, 'Acceptance fixtures must be synthetic only');
  const cases = Array.isArray(fixtures.cases) ? fixtures.cases : [];
  check(cases.length >= 12, `Acceptance fixtures need at least 12 cases; found ${cases.length}`);
  cases.forEach((testCase, index) => requireKeys(testCase, ['caseId', 'title', 'tenantId', 'covers', 'given', 'when', 'expect'], `acceptance case ${index + 1}`));
  const coverage = cases.map((testCase) => JSON.stringify(testCase).toLowerCase());
  const requiredCoverage = {
    'cross-tenant isolation': /cross[-_ ]?tenant|tenant[-_ ]?isolation/,
    idempotency: /idempot|duplicate[-_ ]?(?:message|delivery)/,
    'task update': /task[-_ ]?(?:update|reconciliation|convergence)|update[-_ ]?existing|canonical[-_ ]?task/,
    'decision supersession': /decision[-_ ]?supers|supers.*decision/,
    'meeting checkbox': /meeting[-_ ]?checkbox|checkbox.*meeting/,
    'assistant command suppression': /command[-_ ]?suppress|assistant[-_ ]?(?:operation[-_ ]?)?command/,
    'knowledge candidate': /knowledge[-_ ]?candidate|candidate.*knowledge/,
    'structured-first query': /structured[-_ ]?first/
  };
  for (const [label, pattern] of Object.entries(requiredCoverage)) {
    check(coverage.some((item) => pattern.test(item)), `Acceptance fixtures are missing ${label}`);
  }
}

const sql = readText('schemas/postgresql-operational-memory.sql');
if (sql) {
  const tableMatches = [...sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?am_memory"?\.)?"?([a-z_][a-z0-9_]*)"?\s*\(([\s\S]*?)\);/gi)];
  const tables = new Map(tableMatches.map((match) => [match[1].toLowerCase(), match[2]]));
  const coreTables = ['tenants', 'source_records', 'raw_messages', 'raw_attachments', 'projects', 'events', 'event_sources', 'tasks', 'task_history', 'decisions', 'decision_sources', 'knowledge_items', 'access_grants', 'answer_logs', 'answer_sources', 'projection_outbox'];
  for (const table of coreTables) {
    check(tables.has(table), `PostgreSQL schema is missing core table ${table}`);
    if (tables.has(table)) check(/\btenant_id\b/i.test(tables.get(table)), `Core table ${table} is missing tenant_id`);
  }
  check(/enable\s+row\s+level\s+security/i.test(sql), 'PostgreSQL schema must enable RLS');
  check(/force\s+row\s+level\s+security/i.test(sql), 'PostgreSQL schema must force RLS');
  check(/create\s+policy/i.test(sql) && /current_tenant_id\s*\(/i.test(sql), 'PostgreSQL schema must create tenant-filtered policies');
  check(/app\.tenant_id/i.test(sql), 'PostgreSQL schema must use the app.tenant_id session context');
  check(/enforce_confirmation_evidence/i.test(sql) && /create\s+(?:constraint\s+)?trigger/i.test(sql), 'PostgreSQL schema must enforce the confirmation evidence gate with triggers');
  check(/apply_decision_supersession/i.test(sql) && tables.has('decision_history'), 'PostgreSQL schema must preserve decision supersession history');
}

if (errors.length > 0) {
  console.error(`${PACKAGE_ID} verification failed (${errors.length} problem${errors.length === 1 ? '' : 's'}):`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`${PACKAGE_ID} operational-memory package verified (${checks} checks, ${jsonDocuments.size} JSON documents).`);
}
