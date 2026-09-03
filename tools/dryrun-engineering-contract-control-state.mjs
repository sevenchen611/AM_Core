import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  ENGINEERING_CONTRACT_CONTROL_STATE_VERSION,
  deriveEngineeringContractControlState,
  reduceEngineeringContractControlState,
} from '../modules/construction/contract-control-state.js';

const fixturePath = fileURLToPath(new URL('../versions/AM-IMP-2026.0903.02/config/engineering-contract-control-state-fixtures.json', import.meta.url));
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));

function atPath(value, dottedPath) {
  return dottedPath.split('.').reduce((current, segment) => current?.[segment], value);
}

assert.equal(ENGINEERING_CONTRACT_CONTROL_STATE_VERSION, '2026-09-03.control-state.v1');
assert.ok(Array.isArray(fixture.cases) && fixture.cases.length >= 6, 'six required control-state fixture cases are required');

for (const item of fixture.cases) {
  const state = reduceEngineeringContractControlState(item.input);
  assert.deepEqual(deriveEngineeringContractControlState(item.input), state, `${item.id}: alias must use the same reducer logic`);
  assert.equal(Object.isFrozen(state), true, `${item.id}: reducer output must be immutable`);
  for (const [path, expected] of Object.entries(item.expect || {})) {
    assert.deepEqual(atPath(state, path), expected, `${item.id}: ${path}`);
  }
}

// The reducer must not leak protected token, evidence-ref, identity document,
// IP or user-agent fields even when a raw store bundle contains them.
const redacted = reduceEngineeringContractControlState({
  version: { contractSnapshot: { documentPackage: { partyAProfileSnapshot: { profileType: 'company', assets: { large_seal: { fileId: 'private' } } } } } },
  signingBundle: { session: {
    status: 'signed', tokenHash: 'must-not-leak', submission: { submissionRef: 'object://protected', receivedAt: '2026-09-03T07:00:00.000Z' },
    events: [{ type: 'signed', at: '2026-09-03T07:00:00.000Z', ip: '192.0.2.1', userAgent: 'private-agent' }],
  } },
});
const serialized = JSON.stringify(redacted);
for (const forbidden of ['must-not-leak', 'object://protected', '192.0.2.1', 'private-agent']) {
  assert.equal(serialized.includes(forbidden), false, `control state leaked ${forbidden}`);
}

console.log(`engineering contract control-state dry run passed (${fixture.cases.length} fixtures)`);
