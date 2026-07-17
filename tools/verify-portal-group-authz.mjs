// 驗證 Portal 專案已安裝 AM 群組授權介面；不讀取帳號、密碼或正式資料。
// 用法：node tools/verify-portal-group-authz.mjs D:\path\to\portal-project

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '');
if (!process.argv[2] || !fs.existsSync(root)) {
  console.error('請提供 Portal 專案資料夾。');
  process.exit(2);
}

const read = (name) => fs.readFileSync(path.join(root, name), 'utf8').replace(/\r\n/g, '\n');
const worker = read('_worker.js');
const usersHtml = read('admin-users.html');
const usersAlias = read('admin-users');
const portalHtml = read('portal.html');
const portalAlias = read('portal');

assert.equal(usersHtml, usersAlias, 'admin-users.html 與 admin-users 必須完全同步');
assert.equal(portalHtml, portalAlias, 'portal.html 與 portal 必須完全同步');

function checkInlineScripts(name, html) {
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)];
  assert.ok(scripts.length > 0, `${name} 找不到 inline script`);
  for (const [index, match] of scripts.entries()) {
    try {
      // 僅編譯、不執行；可抓到 template literal 或括號錯誤。
      new Function(match[1]);
    } catch (error) {
      throw new Error(`${name} inline script #${index + 1} 語法錯誤：${error.message}`);
    }
  }
}

checkInlineScripts('admin-users.html', usersHtml);
checkInlineScripts('portal.html', portalHtml);

const requirements = [
  ['admin_users.am_access', /ADD COLUMN am_access TEXT NOT NULL DEFAULT '\{\}'/],
  ['admin_users.authz_version', /ADD COLUMN authz_version INTEGER NOT NULL DEFAULT 3/],
  ['權限異動稽核表', /CREATE TABLE IF NOT EXISTS am_authz_audit/],
  ['opaque session verify', /handleAmSsoVerify/],
  ['伺服器服務金鑰', /x-am-platform-token/],
  ['群組目錄 API', /handleAmAccessDirectory/],
  ['amAccess 後端驗證', /validateAmAccess/],
  ['待遷移租戶後端拒絕授權', /tenant\.assignable === false/],
  ['待遷移租戶不產生 SSO 入口', /tenant\.assignable !== false && amSsoAllowed/],
  ['建立帳號預設空 amAccess', /body\.amAccess \|\| \{\}/],
  ['舊帳號遷移只補 Rental 功能', /LEGACY_RENTAL_FEATURES = ASSIGNABLE_FEATURES\.filter/],
  ['舊帳號遷移不使用全功能清單', /\.bind\(JSON\.stringify\(LEGACY_RENTAL_FEATURES\)\)\.run\(\)/],
];
for (const [label, pattern] of requirements) assert.match(worker, pattern, `缺少：${label}`);

assert.match(usersHtml, /data-am-tenant-card/, '帳號頁缺少租戶卡片');
assert.match(usersHtml, /data-am-group/, '帳號頁缺少群組勾選');
assert.match(usersHtml, /data-am-ready/, '帳號頁缺少遷移就緒 fail-closed 狀態');
assert.match(usersHtml, /checkedAmAccess/, '帳號頁沒有送出 amAccess');
assert.doesNotMatch(usersHtml, /fetch\("https:\/\/am-platform-2ymf\.onrender\.com\/portal\/tenants"/, '瀏覽器不可直接讀 Core 管理目錄');
assert.match(portalHtml, /api\/am-entries/, 'Portal 入口未動態讀取 AM 租戶');

console.log('✅ Portal schema / API / opaque SSO / audit contract');
console.log('✅ admin-users 與 portal 雙檔同步');
console.log('✅ inline scripts 語法');
console.log('✅ 動態租戶→群組選擇與新帳號零預設');
