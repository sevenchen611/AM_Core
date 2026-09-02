import crypto from 'node:crypto';

export const PARTY_A_ASSET_MAX_BYTES = 2 * 1024 * 1024;

const ASSET_KINDS = new Set(['large_seal', 'signature']);
const MIME_TYPES = new Set(['image/png', 'image/jpeg']);

function fail(message, statusCode = 400, code = 'PARTY_A_PROFILE_ERROR') {
  return Object.assign(new Error(message), { statusCode, code });
}

function text(value, max = 500) {
  return String(value || '').normalize('NFKC').trim().slice(0, max);
}

function safeSegment(value, fallback) {
  const normalized = text(value, 160).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_');
  return normalized || fallback;
}

function header(req, name) {
  const value = req?.headers?.[name] ?? req?.headers?.[name.toLowerCase()];
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

export function partyAAssetUploadMetadata(req) {
  let filename = '';
  try { filename = decodeURIComponent(header(req, 'x-party-a-file-name')); } catch { throw fail('甲方簽章檔名編碼不正確'); }
  const kind = header(req, 'x-party-a-asset-kind');
  const mimeType = header(req, 'content-type').split(';')[0].trim().toLowerCase();
  if (!ASSET_KINDS.has(kind)) throw fail('甲方簽章類型不合法');
  if (!MIME_TYPES.has(mimeType)) throw fail('甲方簽章只接受 PNG 或 JPEG', 415);
  return { filename, kind, mimeType };
}

export async function readPartyAAssetBody(req, maxBytes = PARTY_A_ASSET_MAX_BYTES) {
  const declared = Number(header(req, 'content-length') || 0);
  if (Number.isFinite(declared) && declared > maxBytes) throw fail('甲方簽章圖檔不可超過 2 MB', 413);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw fail('甲方簽章圖檔不可超過 2 MB', 413);
    chunks.push(buffer);
  }
  if (!size) throw fail('甲方簽章圖檔不可為空');
  return Buffer.concat(chunks);
}

export async function uploadPartyAAsset(deps, input = {}) {
  if (!deps.driveConfigured || !deps.driveRootFolderId) throw fail('工程合約 Drive 尚未設定', 503);
  if (!ASSET_KINDS.has(input.kind) || !MIME_TYPES.has(input.mimeType)) throw fail('甲方簽章資料不合法');
  if (!Buffer.isBuffer(input.buffer) || !input.buffer.length || input.buffer.length > PARTY_A_ASSET_MAX_BYTES) {
    throw fail('甲方簽章圖檔大小不合法', input.buffer?.length > PARTY_A_ASSET_MAX_BYTES ? 413 : 400);
  }
  if (typeof deps.auditDrivePrivate !== 'function') throw fail('工程合約 Drive 隱私稽核尚未設定', 503);
  const root = await deps.ensureDriveFolder('工程合約管理', deps.driveRootFolderId);
  const profiles = await deps.ensureDriveFolder('甲方主檔', root);
  const pending = await deps.ensureDriveFolder('待綁定簽章', profiles);
  const folderPrivacy = await deps.auditDrivePrivate(pending);
  if (folderPrivacy?.private !== true) throw fail('甲方主檔資料夾不可公開分享', 503);
  const filename = safeSegment(input.filename, `${input.kind}.${input.mimeType === 'image/png' ? 'png' : 'jpg'}`);
  const uploaded = await deps.uploadToDrive(input.buffer, filename, input.mimeType, pending);
  if (!uploaded?.id) throw fail('Drive 未回傳甲方簽章檔案 ID', 502);
  const filePrivacy = await deps.auditDrivePrivate(uploaded.id);
  if (filePrivacy?.private !== true) throw fail('甲方簽章檔案不可公開分享', 503);
  return Object.freeze({
    kind: input.kind,
    fileId: uploaded.id,
    name: filename,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.length,
    sha256: crypto.createHash('sha256').update(input.buffer).digest('hex'),
    driveUrl: uploaded.webViewLink || '',
    uploadedBy: text(input.actor, 240),
  });
}

export function normalizePartyAProfileInput(input = {}) {
  const profileType = text(input.profileType, 20);
  if (!['company', 'individual'].includes(profileType)) throw fail('甲方類型必須是公司或個人');
  const displayName = text(input.displayName, 240);
  const legalName = text(input.legalName, 300);
  const taxId = text(input.taxId, 20).replace(/\s+/g, '');
  const responsiblePerson = text(input.responsiblePerson, 240);
  const representative = text(input.representative, 240);
  const identityNumber = text(input.identityNumber, 30).toUpperCase().replace(/\s+/g, '');
  const address = text(input.address, 500);
  if (!displayName || !legalName || !address) throw fail('請填寫甲方顯示名稱、法定名稱與地址');
  if (profileType === 'company' && (!/^\d{8}$/.test(taxId) || !responsiblePerson)) {
    throw fail('公司甲方必須填寫 8 碼統一編號與負責人');
  }
  const suppliedAssets = input.assets && typeof input.assets === 'object' && !Array.isArray(input.assets) ? input.assets : {};
  const assets = {};
  for (const [kind, asset] of Object.entries(suppliedAssets)) {
    if (!ASSET_KINDS.has(kind)) throw fail('甲方簽章類型不合法');
    if (!asset || !asset.fileId || !/^[0-9a-f]{64}$/.test(String(asset.sha256 || '').toLowerCase())
      || !MIME_TYPES.has(String(asset.mimeType || '').toLowerCase())) throw fail('甲方簽章檔案資料不完整');
    assets[kind] = {
      kind,
      fileId: text(asset.fileId, 240),
      name: text(asset.name, 300),
      mimeType: String(asset.mimeType).toLowerCase(),
      sizeBytes: Number(asset.sizeBytes || 0),
      sha256: String(asset.sha256).toLowerCase(),
    };
    if (!assets[kind].fileId || !assets[kind].name || !Number.isInteger(assets[kind].sizeBytes)
      || assets[kind].sizeBytes < 1 || assets[kind].sizeBytes > PARTY_A_ASSET_MAX_BYTES) {
      throw fail('甲方簽章檔案資料不完整');
    }
  }
  if (profileType === 'company' && !assets.large_seal) throw fail('公司甲方必須上傳公司大章');
  if (profileType === 'individual' && !assets.signature) throw fail('個人甲方必須上傳簽名');
  const id = text(input.id, 80) || null;
  if (id && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw fail('甲方主檔 ID 不合法');
  }
  return {
    id,
    profileType, displayName, legalName,
    taxId: profileType === 'company' ? taxId : '',
    responsiblePerson: profileType === 'company' ? responsiblePerson : '',
    representative: representative || responsiblePerson || legalName,
    identityNumber: profileType === 'individual' ? identityNumber : '',
    address,
    assets,
  };
}

export function partyAContractSnapshot(profile) {
  if (!profile) return null;
  const assets = profile.assets && typeof profile.assets === 'object' ? profile.assets : {};
  return Object.freeze({
    profileId: profile.id,
    profileType: profile.profileType,
    displayName: profile.displayName,
    contractFields: {
      partyAProfileId: profile.id,
      partyAProfileType: profile.profileType,
      partyAOrganization: profile.legalName,
      partyATaxId: profile.taxId || '',
      partyAResponsiblePerson: profile.responsiblePerson || '',
      partyARepresentative: profile.representative || profile.legalName,
      partyAIdentityNumber: profile.identityNumber || '',
      partyAAddress: profile.address,
    },
    assets: JSON.parse(JSON.stringify(assets)),
  });
}

export async function hydratePartyASigningAssets(deps, version) {
  const pkg = version?.documentPackage || version?.snapshot?.documentPackage || version?.contract_snapshot?.documentPackage || {};
  const snapshot = pkg.partyAProfileSnapshot || pkg.contractFields?.partyAProfileSnapshot || {};
  const assets = snapshot.assets && typeof snapshot.assets === 'object' ? snapshot.assets : {};
  const hydrated = { profileType: snapshot.profileType || '', displayName: snapshot.displayName || '' };
  for (const [kind, asset] of Object.entries(assets)) {
    if (!ASSET_KINDS.has(kind) || !asset?.fileId) continue;
    const privacy = await deps.auditDrivePrivate?.(asset.fileId);
    if (privacy?.private !== true) throw fail('甲方簽章檔案不是私有狀態', 503, 'PARTY_A_ASSET_PRIVACY_FAILED');
    const downloaded = await deps.downloadFromDrive?.(asset.fileId, PARTY_A_ASSET_MAX_BYTES);
    const buffer = Buffer.isBuffer(downloaded) ? downloaded : downloaded?.buffer;
    if (!Buffer.isBuffer(buffer) || !buffer.length) throw fail('無法讀取甲方簽章檔案', 503, 'PARTY_A_ASSET_DOWNLOAD_FAILED');
    const actualHash = crypto.createHash('sha256').update(buffer).digest('hex');
    if (actualHash !== String(asset.sha256 || '').toLowerCase()) throw fail('甲方簽章檔案雜湊不一致', 409, 'PARTY_A_ASSET_HASH_MISMATCH');
    hydrated[kind] = { mimeType: asset.mimeType || downloaded?.contentType || 'image/png', base64: buffer.toString('base64'), sha256: actualHash };
  }
  return hydrated;
}

export const __test = { ASSET_KINDS, MIME_TYPES, safeSegment, text };
