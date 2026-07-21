import assert from 'node:assert/strict';
import { safePortalHandoffLocation } from '../core/portal-handoff.js';

const fallback = '/dashboard?tenant=engineering';
assert.equal(
  safePortalHandoffLocation('/meetings/manage?tenant=forest', 'engineering', fallback),
  '/meetings/manage?tenant=engineering',
);
assert.equal(
  safePortalHandoffLocation('/admin?tab=groups', 'engineering', fallback),
  '/admin?tab=groups&tenant=engineering',
);
for (const unsafe of [
  'https://evil.example/meetings/manage',
  '//evil.example/meetings/manage',
  '/\\evil.example/meetings/manage',
  '/meetings/review/signed-session',
  '/health',
  '',
]) assert.equal(safePortalHandoffLocation(unsafe, 'engineering', fallback), fallback);

console.log('Portal handoff return-path verification passed.');
