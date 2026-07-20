// Verifies fixed platform integration identities without printing credentials.
// Usage: node --env-file=.env tools/verify-platform-connection-identities.mjs <Drive-folder-ID>

const folderId = process.argv[2];
const expectedNotionName = process.env.AMCORE_EXPECTED_NOTION_BOT_NAME || 'BuildAM';
const expectedGoogleEmail = (process.env.AMCORE_EXPECTED_GOOGLE_DRIVE_ACCOUNT_EMAIL || '2014greenhotel@gmail.com').toLowerCase();

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

async function json(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.message || body.error?.message || body.error || 'request failed'}`);
  return body;
}

async function main() {
  if (!folderId) throw new Error('Usage: node --env-file=.env tools/verify-platform-connection-identities.mjs <Drive-folder-ID>');
  const notion = await json('https://api.notion.com/v1/users/me', {
    headers: { Authorization: `Bearer ${required('NOTION_TOKEN')}`, 'Notion-Version': process.env.NOTION_VERSION || '2025-09-03' }
  });
  if (notion.type !== 'bot' || notion.name !== expectedNotionName) throw new Error(`Notion identity mismatch: expected bot ${expectedNotionName}, received ${notion.type || 'unknown'} ${notion.name || '(unnamed)'}.`);

  const oauth = await json('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: required('GOOGLE_OAUTH_CLIENT_ID'), client_secret: required('GOOGLE_OAUTH_CLIENT_SECRET'), refresh_token: required('GOOGLE_OAUTH_REFRESH_TOKEN'), grant_type: 'refresh_token' })
  });
  const drive = await json(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(folderId)}?supportsAllDrives=true&fields=id,name,mimeType,owners(emailAddress),permissions(emailAddress,role),capabilities(canEdit,canAddChildren)`, {
    headers: { Authorization: `Bearer ${oauth.access_token}` }
  });
  if (drive.mimeType !== 'application/vnd.google-apps.folder') throw new Error('Drive root is not a folder.');
  if (!drive.capabilities?.canEdit || !drive.capabilities?.canAddChildren) throw new Error('Active Google OAuth grant cannot edit and add files to the Drive root.');
  const grants = [...(drive.owners || []), ...(drive.permissions || [])];
  if (!grants.some((grant) => String(grant.emailAddress || '').toLowerCase() === expectedGoogleEmail)) throw new Error(`Drive root does not expose ${expectedGoogleEmail} as owner or permission.`);
  console.log(JSON.stringify({ ok: true, notion: { name: notion.name, workspace: notion.bot?.workspace_name || null }, drive: { id: drive.id, name: drive.name, expectedAccount: expectedGoogleEmail, canEdit: drive.capabilities.canEdit, canAddChildren: drive.capabilities.canAddChildren } }, null, 2));
}

main().catch((error) => { console.error(`Connection identity check failed: ${error.message}`); process.exit(1); });
