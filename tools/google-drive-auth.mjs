// AM Platform one-time Google OAuth helper, ported from the proven BuildAM / ForestAM flow.
// It listens only on 127.0.0.1:8765, verifies the authorized Google account,
// and securely replaces GOOGLE_OAUTH_REFRESH_TOKEN in the platform .env.

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const envPath = path.join(projectRoot, '.env');
const redirectUri = 'http://127.0.0.1:8765';
const expectedEmail = '2014greenhotel@gmail.com';
const state = crypto.randomBytes(24).toString('hex');
const authUrlPath = path.join(process.env.TEMP || projectRoot, 'amcore-google-oauth-url.txt');

function loadEnv(filePath) {
  const env = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2].trim();
  }
  return env;
}

const env = loadEnv(envPath);
const clientId = env.GOOGLE_OAUTH_CLIENT_ID;
const clientSecret = env.GOOGLE_OAUTH_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error('缺少 GOOGLE_OAUTH_CLIENT_ID 或 GOOGLE_OAUTH_CLIENT_SECRET。');
  process.exit(1);
}

const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/calendar',
  access_type: 'offline',
  prompt: 'consent select_account',
  state,
})}`;

fs.writeFileSync(authUrlPath, authUrl, 'utf8');

function finishPage(res, status, html) {
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(html);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', redirectUri);
  if (url.searchParams.get('state') !== state) {
    finishPage(res, 400, '<h2>授權狀態驗證失敗</h2><p>請關閉此頁後重新執行授權。</p>');
    return;
  }
  const error = url.searchParams.get('error');
  if (error) {
    finishPage(res, 400, `<h2>授權未完成：${error}</h2>`);
    console.error(`授權失敗：${error}`);
    server.close();
    return;
  }
  const code = url.searchParams.get('code');
  if (!code) {
    finishPage(res, 404, '<h2>沒有收到授權碼</h2>');
    return;
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.refresh_token || !tokens.access_token) throw new Error(`token exchange ${tokenResponse.status}: ${tokens.error || 'missing token'}`);

    const aboutResponse = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const about = await aboutResponse.json();
    if (!aboutResponse.ok) throw new Error(`Drive identity ${aboutResponse.status}: ${about.error?.message || 'request failed'}`);
    const actualEmail = String(about.user?.emailAddress || '').toLowerCase();
    if (actualEmail !== expectedEmail) throw new Error(`帳號不符：需要 ${expectedEmail}，實際為 ${actualEmail || 'unknown'}`);

    let content = fs.readFileSync(envPath, 'utf8');
    if (/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m.test(content)) {
      content = content.replace(/^GOOGLE_OAUTH_REFRESH_TOKEN=.*$/m, `GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}`);
    } else {
      content += `${content.endsWith('\n') ? '' : '\n'}GOOGLE_OAUTH_REFRESH_TOKEN=${tokens.refresh_token}\n`;
    }
    fs.writeFileSync(envPath, content);
    finishPage(res, 200, '<h2>✅ AM Platform 已連結 Google Drive</h2><p>授權帳號：2014greenhotel@gmail.com。這個視窗可以關閉。</p>');
    console.log('SUCCESS: 已驗證 2014greenhotel@gmail.com，新的 refresh token 已安全寫入平台 .env。');
  } catch (authError) {
    finishPage(res, 500, `<h2>授權處理失敗</h2><p>${String(authError.message).replace(/[<>&]/g, '')}</p>`);
    console.error(`授權處理失敗：${authError.message}`);
  } finally {
    try { fs.unlinkSync(authUrlPath); } catch { /* already removed */ }
    server.close();
  }
});

server.on('error', (error) => {
  console.error(`無法啟動 OAuth 回呼服務：${error.message}`);
  process.exit(1);
});

server.listen(8765, '127.0.0.1', () => {
  console.log('請使用 2014greenhotel@gmail.com 開啟以下連結並完成登入：');
  console.log(authUrl);
  console.log('等待 Google 回傳授權結果（127.0.0.1:8765）…');
});

setTimeout(() => {
  console.error('OAuth 等待逾時，請重新執行。');
  server.close();
}, 15 * 60 * 1000).unref();
