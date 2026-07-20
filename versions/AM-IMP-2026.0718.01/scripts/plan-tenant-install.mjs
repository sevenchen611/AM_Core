#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const PACKAGE_ID = 'AM-IMP-2026.0718.01';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODES = new Set(['shared-platform-tenant', 'project-local-runtime']);
const ADAPTERS = ['sourceStore', 'attachmentStore', 'workQueue', 'eventStore', 'projectionStore', 'searchIndex', 'rulesProvider', 'notionProjection'];

function usage(exitCode = 0) {
  const stream = exitCode === 0 ? process.stdout : process.stderr;
  stream.write('Usage: node plan-tenant-install.mjs --config <project-local-config.json> --out <project-local-plan.json>\n');
  process.exit(exitCode);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--help' || argument === '-h') usage(0);
    if (!['--config', '--out'].includes(argument)) throw new Error(`Unknown argument: ${argument}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${argument}`);
    if (result[argument.slice(2)]) throw new Error(`Duplicate argument: ${argument}`);
    result[argument.slice(2)] = value;
    index += 1;
  }
  if (!result.config || !result.out) throw new Error('Both --config and --out are required');
  return result;
}

function normalizedKey(key) {
  return key.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

function inspectForSensitiveData(value, location = '$', problems = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => inspectForSensitiveData(item, `${location}[${index}]`, problems));
    return problems;
  }
  if (!value || typeof value !== 'object') return problems;

  for (const [key, child] of Object.entries(value)) {
    const nextLocation = `${location}.${key}`;
    const compact = normalizedKey(key);
    const isReference = /(ref|reference|env|environment|name|provider|store|required)/i.test(key);
    const isBooleanPolicyFlag = typeof child === 'boolean';
    const isDeclarativeMetadata = /^(contains|requires|allows|supports|has)/i.test(key)
      || /(ready|enabled|allowed|required|present)$/i.test(key);
    if (/(password|passwd|secret|token|apikey|accesskey|privatekey|clientsecret|databaseurl|connectionstring|credentials|authorization|signedurl)/.test(compact)
      && !isReference && !isBooleanPolicyFlag && !isDeclarativeMetadata) {
      problems.push(`${nextLocation} is a secret-bearing field; keep only an environment-variable name or logical reference`);
    }
    if (compact !== 'tenantid' && /(notion|line|render|github|database|datasource|channel|group|page|workspace|service|project).*(id|url)$/.test(compact)) {
      problems.push(`${nextLocation} looks like a project-local production id or URL`);
    }
    if (typeof child === 'string') {
      if (/(postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+|\b(?:sk|ghp|xox[baprs])-[-A-Za-z0-9_]{12,})/i.test(child)) {
        problems.push(`${nextLocation} appears to contain a secret value`);
      }
      if (/\b[CUR][0-9a-f]{32}\b|\bsrv-[a-z0-9-]{8,}\b/i.test(child)) {
        problems.push(`${nextLocation} appears to contain a production connector id`);
      }
    }
    inspectForSensitiveData(child, nextLocation, problems);
  }
  return problems;
}

function adapterConfigured(value) {
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'boolean') return true;
  return Boolean(value && typeof value === 'object' && Object.keys(value).length > 0);
}

function safeEnvironmentNames(config) {
  const values = config.operationalMemory?.requiredEnvironmentVariables;
  if (!Array.isArray(values)) return [];
  return [...new Set(values.filter((value) => typeof value === 'string' && /^[A-Z][A-Z0-9_]+$/.test(value)))].sort();
}

function buildPlan(config) {
  const memory = config.operationalMemory;
  const configuredAdapters = ADAPTERS.map((name) => ({ name, configured: adapterConfigured(memory.adapters[name]) }));
  const fingerprint = crypto.createHash('sha256').update(config.tenantId).digest('hex').slice(0, 12);

  return {
    schemaVersion: '1.0',
    packageId: PACKAGE_ID,
    generatedAt: new Date().toISOString(),
    tenant: {
      tenantKey: config.tenantKey,
      tenantIdFingerprint: fingerprint,
      displayName: config.displayName,
      mode: memory.mode,
      timezone: config.timezone,
      envPrefix: config.envPrefix
    },
    validation: {
      tenantUuidValidated: true,
      secretValuesIncluded: false,
      productionConnectorIdsIncluded: false,
      adapters: configuredAdapters,
      requiredEnvironmentVariables: safeEnvironmentNames(config)
    },
    phases: [
      {
        id: 'M0',
        title: 'Tenant boundary and shadow foundation',
        actions: [
          'Confirm dependency versions and the target project manifest.',
          'Apply the am_memory PostgreSQL schema to this tenant database.',
          'Create the tenant row from the protected AM_MEMORY_TENANT_ID value.',
          'Verify SET LOCAL app.tenant_id, forced RLS, fail-closed access, and a cross-tenant denial.',
          'Start in shadow mode without changing existing answers or Notion records.'
        ],
        gate: 'Raw ingestion is idempotent, queued, tenant-scoped, and acknowledged before AI processing.'
      },
      {
        id: 'M1',
        title: 'Adapters, evidence, and reconciliation',
        actions: [
          'Connect each configured adapter through the standard tenant-scoped envelope.',
          'Load shared, project-local, learned, and manual judgment rules before classification.',
          'Enable candidate event extraction and the evidence/goal/rule-trace gates.',
          'Reconcile against canonical tasks and effective decisions before creating new records.',
          'Run all synthetic acceptance fixtures and project-local redacted comparisons.'
        ],
        gate: 'Confirmed mutations have project-local evidence and retries do not duplicate effects.'
      },
      {
        id: 'M2',
        title: 'Structured-first query shadow',
        actions: [
          'Compare legacy and structured answers for project progress, tasks/commitments, and decisions.',
          'Apply AccessContext before retrieval, reranking, projection, and citation.',
          'Retrieve raw messages only for detail, conflict resolution, or evidence.',
          'Record answer intent, scope, sources, confidence, and feedback.'
        ],
        gate: 'Owner accepts shadow comparison quality and every answer source passes tenant authorization.'
      },
      {
        id: 'M3',
        title: 'Projection and human governance',
        actions: [
          'Enable only project-local Notion projections selected by the tenant owner.',
          'Route Notion edits back as approval or manual-correction events.',
          'Verify the core continues during a projection outage and the outbox catches up idempotently.',
          'Keep knowledge promotion review-only until governance is approved.'
        ],
        gate: 'PostgreSQL remains canonical and no projection can overwrite source history.'
      },
      {
        id: 'M4',
        title: 'Controlled activation and lifecycle',
        actions: [
          'Enable structured-first only after tenant-owner approval.',
          'Apply hot, warm, cold, legal-hold, redaction, and deletion policies.',
          'Update the project-local upgrade record and improvement manifest.',
          'Mark Deployed only after the production tenant-isolation gate passes.'
        ],
        gate: 'AccessContext, RLS, retrieval filters, citations, retention, and rollback are production-verified.'
      }
    ],
    guardrails: [
      'Do not copy data, credentials, connector ids, or Notion database ids from another AM.',
      'Do not write confirmed state without source evidence, goal linkage, and a rule trace.',
      'Do not let an LLM or projection bypass reconciliation or PostgreSQL RLS.',
      'Rollback switches behavior to legacy/off; it does not delete evidence or audit history.'
    ]
  };
}

try {
  const args = parseArgs(process.argv.slice(2));
  const configPath = path.resolve(args.config);
  const outPath = path.resolve(args.out);
  if (configPath === outPath) throw new Error('--out must not overwrite --config');
  if (!fs.existsSync(configPath) || !fs.statSync(configPath).isFile()) throw new Error(`Config file not found: ${configPath}`);

  let config;
  try {
    config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, ''));
  } catch (error) {
    throw new Error(`Invalid config JSON: ${error.message}`);
  }

  const problems = inspectForSensitiveData(config);
  if (!UUID_PATTERN.test(config.tenantId ?? '') || /^0{8}-0{4}-0{4}-0{4}-0{12}$/i.test(config.tenantId ?? '')) problems.push('$.tenantId must be a non-nil RFC-style UUID');
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(config.tenantKey ?? '')) problems.push('$.tenantKey must be a 2-63 character lowercase slug');
  if (!config.operationalMemory || typeof config.operationalMemory !== 'object') problems.push('$.operationalMemory is required');
  else {
    if (!MODES.has(config.operationalMemory.mode)) problems.push(`$.operationalMemory.mode must be one of: ${[...MODES].join(', ')}`);
    if (!config.operationalMemory.adapters || typeof config.operationalMemory.adapters !== 'object') problems.push('$.operationalMemory.adapters is required');
    else for (const name of ADAPTERS) if (!adapterConfigured(config.operationalMemory.adapters[name])) problems.push(`$.operationalMemory.adapters.${name} must declare a logical adapter`);
  }
  const envNames = config.operationalMemory?.requiredEnvironmentVariables;
  if (!Array.isArray(envNames) || !envNames.every((name) => typeof name === 'string' && /^[A-Z][A-Z0-9_]+$/.test(name))) problems.push('requiredEnvironmentVariables must contain environment-variable names only');

  if (problems.length > 0) throw new Error(`Unsafe or invalid tenant config:\n- ${[...new Set(problems)].join('\n- ')}`);

  const plan = buildPlan(config);
  const serialized = `${JSON.stringify(plan, null, 2)}\n`;
  if (/(postgres(?:ql)?:\/\/[^\s]+:[^\s]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+\S+)/i.test(serialized)) throw new Error('Refusing to write a plan that appears to contain secrets');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, serialized, { encoding: 'utf8', mode: 0o600 });
  console.log(`Secret-free phased install plan written to ${outPath}`);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
