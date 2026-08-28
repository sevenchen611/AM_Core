import assert from 'node:assert/strict';
import { createDrive } from '../core/drive.js';

const originalFetch = globalThis.fetch;

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withFetch(mock, run) {
  globalThis.fetch = mock;
  try {
    return await run();
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function drive(logger = { warn() {} }) {
  return createDrive({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    refreshToken: 'refresh-token',
    logger,
  });
}

await withFetch(async (url, options = {}) => {
  if (String(url).includes('oauth2.googleapis.com/token')) {
    assert.equal(options.method, 'POST');
    return response({ access_token: 'access-token', expires_in: 3600 });
  }
  const requestUrl = new URL(String(url));
  assert.equal(requestUrl.pathname, '/drive/v3/files/private-file-123/permissions');
  assert.equal(requestUrl.searchParams.get('supportsAllDrives'), 'true');
  assert.equal(requestUrl.searchParams.get('pageSize'), '100');
  assert.equal(
    requestUrl.searchParams.get('fields'),
    'nextPageToken,permissions(id,type,role,domain,allowFileDiscovery,permissionDetails(permissionType,inherited,role))',
  );
  assert.equal(options.headers.Authorization, 'Bearer access-token');
  return response({
    permissions: [{
      id: 'owner-permission', type: 'user', role: 'owner',
      permissionDetails: [{ permissionType: 'file', inherited: false, role: 'owner' }],
    }],
  });
}, async () => {
  assert.deepEqual(await drive().auditPrivateFile('private-file-123'), {
    private: true,
    permissionCount: 1,
    domainRestricted: false,
  });
});

await withFetch(async (url) => {
  if (String(url).includes('oauth2.googleapis.com/token')) {
    return response({ access_token: 'access-token', expires_in: 3600 });
  }
  const requestUrl = new URL(String(url));
  if (!requestUrl.searchParams.get('pageToken')) {
    return response({
      nextPageToken: 'next-page',
      permissions: [{ id: 'owner', type: 'user', role: 'owner' }],
    });
  }
  assert.equal(requestUrl.searchParams.get('pageToken'), 'next-page');
  return response({
    permissions: [{ id: 'public-link', type: 'anyone', role: 'reader', allowFileDiscovery: false }],
  });
}, async () => {
  await assert.rejects(
    () => drive().auditPrivateFile('public-file-123'),
    (error) => error.code === 'DRIVE_BROAD_PERMISSION_FORBIDDEN',
  );
});

const warnings = [];
await withFetch(async (url) => {
  if (String(url).includes('oauth2.googleapis.com/token')) {
    return response({ access_token: 'access-token', expires_in: 3600 });
  }
  return response({ error: { message: 'Invalid field selection permissionDetails' } }, 400);
}, async () => {
  await assert.rejects(
    () => drive({ warn: (...args) => warnings.push(args) }).auditPrivateFile('broken-file-123'),
    (error) => error.code === 'DRIVE_PRIVACY_AUDIT_REQUEST_FAILED' && /400/.test(error.message),
  );
});
assert.equal(warnings.length, 1);
assert.equal(warnings[0][1].status, 400);

console.log('Drive privacy audit dry-run passed: official permissions endpoint, pagination, private-file acceptance, broad-sharing rejection, and safe API error logging verified.');
