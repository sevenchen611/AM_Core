// Claims governance dry-run: no credentials, no LINE calls, and no Notion writes.
import assert from 'node:assert';
import { Readable } from 'node:stream';
import vm from 'node:vm';
import { loadTenants } from '../core/tenants.js';
import {
  GROUP_CAPABILITIES,
  GROUP_BINDING_CLAIMS_REQUIRED_FIELDS,
  GROUP_BINDING_V2_PROPERTIES,
} from '../core/group-binding-schema.js';
import groupModule, { __test as groups } from '../modules/groups/index.js';
import claimsModule, { __test as claims } from '../modules/claims/index.js';

const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (error) {
    results.push([false, `${name} - ${error.message}`]);
  }
}

await check('claims capability and schema fields are declared', () => {
  assert.ok(GROUP_CAPABILITIES.includes('請款'));
  assert.deepEqual(GROUP_BINDING_CLAIMS_REQUIRED_FIELDS, ['請款送件權限', '請款指定送件人']);
  assert.ok(GROUP_BINDING_V2_PROPERTIES['請款送件權限']);
  assert.ok(GROUP_BINDING_V2_PROPERTIES['請款指定送件人']);
});

await check('only a claims tenant requires the additive claims fields', () => {
  const withoutClaims = {
    properties: Object.fromEntries(Object.entries(GROUP_BINDING_V2_PROPERTIES)
      .filter(([name]) => !GROUP_BINDING_CLAIMS_REQUIRED_FIELDS.includes(name))),
  };
  assert.deepEqual(groups.missingSchemaFields(withoutClaims, { modules: ['groups'] }), []);
  assert.deepEqual(groups.missingSchemaFields(withoutClaims, { modules: ['groups', 'claims'] }), GROUP_BINDING_CLAIMS_REQUIRED_FIELDS);
});

await check('submitters are stored as member-map validated LINE user IDs', () => {
  const memberMap = { '送件人 A': 'U-allowed', '送件人 B': 'U-second' };
  const props = groups.updateProperties({
    name: '名稱可以變更的群組',
    purpose: '請款溝通',
    owner: '送件人 A',
    capabilities: ['請款'],
    goal: '財務請款流程',
    statusUpdatePolicy: '主要負責人',
    reminderTargets: [],
    claimSubmissionPolicy: '指定成員',
    claimSubmitterUserIds: ['U-allowed'],
    status: '啟用',
  }, { properties: GROUP_BINDING_V2_PROPERTIES }, 'test-admin', memberMap);
  const stored = props['請款指定送件人'].rich_text[0].text.content;
  assert.equal(stored, '["U-allowed"]');
  assert.equal(stored.includes('送件人 A'), false);
});

await check('unknown LINE IDs and empty designated allowlists fail closed', () => {
  const schema = { properties: GROUP_BINDING_V2_PROPERTIES };
  const base = {
    name: '測試群組', purpose: '', owner: '', capabilities: ['請款'], goal: '',
    statusUpdatePolicy: '所有成員', reminderTargets: [], status: '啟用',
  };
  assert.throws(() => groups.updateProperties({
    ...base, claimSubmissionPolicy: '指定成員', claimSubmitterUserIds: ['U-unknown'],
  }, schema, 'test-admin', { '送件人 A': 'U-allowed' }), /現有成員對照/);
  assert.throws(() => groups.updateProperties({
    ...base, claimSubmissionPolicy: '指定成員', claimSubmitterUserIds: [],
  }, schema, 'test-admin', { '送件人 A': 'U-allowed' }), /至少要選擇/);
  const disabled = groups.updateProperties({
    ...base, claimSubmissionPolicy: '停用', claimSubmitterUserIds: ['U-stale'],
  }, schema, 'test-admin', { '送件人 A': 'U-allowed' });
  assert.equal(disabled['請款指定送件人'].rich_text.length, 0);
});

await check('group API rejects claim-governance writes without tenant-all authority or a local member ID', async () => {
  const writes = [];
  const bindingPage = {
    id: 'binding-claims-test',
    properties: {
      '群組名稱': { title: [{ plain_text: '名稱可變更' }] },
      'LINE 群組 ID': { rich_text: [{ plain_text: 'group-stable-id' }] },
      '狀態': { select: { name: '啟用' } },
      '成員對照': { rich_text: [{ plain_text: '{"送件人 A":"U-allowed"}' }] },
    },
  };
  groupModule.init({
    logger: { warn: () => {} },
    router: { invalidate: () => {} },
    notionRequest: async (pathname, opts = {}) => {
      if (pathname === '/v1/data_sources/claims-groups' && opts.method === 'GET') return { properties: GROUP_BINDING_V2_PROPERTIES };
      if (pathname.endsWith('/query')) return { results: [bindingPage], has_more: false };
      if (pathname === '/v1/pages/binding-claims-test' && opts.method === 'PATCH') { writes.push(opts.body); return { id: bindingPage.id }; }
      throw new Error(`Unexpected request: ${opts.method} ${pathname}`);
    },
  });
  const route = groupModule.routes.find((item) => item.prefix === '/groups');
  const request = (body) => {
    const req = Readable.from([Buffer.from(JSON.stringify(body))]);
    req.method = 'POST';
    req.headers = {};
    return req;
  };
  const response = () => ({ status: 0, body: '', writeHead(status) { this.status = status; }, end(value = '') { this.body += value; } });
  const tenant = { key: 'claims-test', modules: ['groups', 'claims'], dataSources: { groupBindings: 'claims-groups' } };
  const payload = {
    pageId: bindingPage.id, name: '名稱可變更', purpose: '', owner: '', capabilities: ['請款'], goal: '',
    statusUpdatePolicy: '所有成員', reminderTargets: [], status: '啟用',
    claimSubmissionPolicy: '指定成員', claimSubmitterUserIds: ['U-allowed'],
  };
  const selectedAccess = { allowed: true, isTenantAll: false, actor: 'selected-admin', filterBindings: (rows) => rows, assert: () => {} };
  const denied = response();
  await route.handler(request(payload), denied, { tenant, pathname: '/groups/api/update', access: selectedAccess });
  assert.equal(denied.status, 403);
  assert.equal(writes.length, 0);

  const tenantAllAccess = { ...selectedAccess, isTenantAll: true };
  const unknown = response();
  await route.handler(request({ ...payload, claimSubmitterUserIds: ['U-injected'] }), unknown, { tenant, pathname: '/groups/api/update', access: tenantAllAccess });
  assert.equal(unknown.status, 500);
  assert.equal(writes.length, 0);
});

await check('HOZO AM 2.0 keeps enabled claims settings scoped to HZ2 environment names', () => {
  const tenants = loadTenants({
    HZ2_CLAIMS_LIFF_ID: 'test-liff-id',
    HZ2_RENTAL_BASE_URL: 'https://rental.example.test/',
    HZ2_RENTAL_CLAIMS_TOKEN: 'test-claims-token',
    HZ2_RENTAL_EVENT_TOKEN: 'test-event-token',
  }, { warn: () => {} });
  const tenant = tenants.find((item) => item.key === 'hozo-am-2-0');
  assert.ok(tenant?.modules.includes('claims'));
  assert.equal(tenant.config.claims.enabled, true);
  assert.equal(tenant.config.claims.liffId, 'test-liff-id');
  assert.equal(tenant.config.claims.rentalBaseUrl, 'https://rental.example.test');
  assert.equal(tenant.config.claims.rentalClaimsToken, 'test-claims-token');
  assert.equal(tenant.config.claims.rentalEventToken, 'test-event-token');
});

await check('LIFF claim deep link uses a token relative to its registered claims endpoint', () => {
  claimsModule.init({ publicLinkSecret: 'claims-test-secret' });
  const session = { id: 'a'.repeat(32), expiresAt: Date.now() + 60_000 };
  const tenant = { config: { claims: { liffId: '2010966226-5pyR1QR4' } } };
  const link = claims.liffLink(tenant, session);
  const token = new URL(link).searchParams.get('session');
  assert.equal(new URL(link).pathname, '/2010966226-5pyR1QR4');
  assert.ok(token);
  assert.equal(claims.liffTokenFromRequest('/claims/liff', new URL(`https://example.test/claims/liff?liff.state=?session=${token}`)), token);
});

await check('LIFF claim page emits syntactically valid client JavaScript', () => {
  claimsModule.init({ publicLinkSecret: 'claims-test-secret' });
  const session = {
    id: 'b'.repeat(32),
    expiresAt: Date.now() + 60_000,
    sourceGroupName: 'HOZO 公司群',
    draftText: '勞健保\n電梯保養費',
  };
  const tenant = {
    config: {
      claims: {
        liffId: '2010966226-5pyR1QR4',
        claimTypes: ['labor_health_insurance', 'shared_operating', 'other'],
      },
    },
  };
  const page = claims.liffHtml(session, tenant);
  const inlineScript = page.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(inlineScript, 'inline LIFF script is missing');
  assert.doesNotThrow(() => new vm.Script(inlineScript[1], { filename: 'claims-liff-client.js' }));
  assert.match(inlineScript[1], /split\(\/\\n\+\/\)/);
  assert.match(page, />切換 LINE 帳號<\/button>/);
  assert.match(inlineScript[1], /liff\.logout\(\)/);
  assert.match(inlineScript[1], /location\.replace\(DATA\.apiPath\)/);
  assert.match(page, /勞健保費用/);
  assert.match(page, /共同營業費用/);
  assert.match(page, /其他費用/);
  assert.match(page, /請款總金額/);
  assert.match(page, /勞健保分攤欄位/);
  assert.match(inlineScript[1], /syncTotal/);
  assert.match(inlineScript[1], /syncTypeFields/);
  assert.match(inlineScript[1], /INSURANCE_DEFAULT_LINES/);
  assert.match(inlineScript[1], /applyInsuranceDefaults/);
  assert.match(inlineScript[1], /removeUntouchedInsuranceDefaults/);
  assert.match(inlineScript[1], /data-insurance-default/);
  assert.match(inlineScript[1], /replaceChildren\(\)/);
});

await check('LIFF OAuth callback restores its signed session from a short-lived secure cookie', () => {
  claimsModule.init({ publicLinkSecret: 'claims-test-secret' });
  const session = { id: 'c'.repeat(32), expiresAt: Date.now() + 60_000 };
  const token = claims.makeSessionToken(session);
  const cookie = claims.liffSessionCookie(session);
  assert.match(cookie, /^am_claims_liff_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Lax/);
  const callbackUrl = new URL('https://example.test/claims/liff?code=oauth-code&state=oauth-state');
  assert.equal(claims.liffTokenFromRequest('/claims/liff', callbackUrl, cookie), token);
  assert.equal(claims.liffTokenFromRequest('/claims/liff', new URL('https://example.test/claims/liff'), cookie), '');
});

let passed = 0;
for (const [ok, name] of results) {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}`);
  if (ok) passed += 1;
}
console.log(`\n${passed}/${results.length} checks passed.`);
process.exit(passed === results.length ? 0 : 1);
