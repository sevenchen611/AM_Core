import { test } from 'node:test';
import assert from 'node:assert/strict';
import { externalJournalUrl } from './journal-external-browser-url.mjs';
const options = { allowedOrigin: 'https://journal.example.com', allowedQueryKeys: ['view'] };
test('root URI opens in an external browser', () => {
  assert.equal(externalJournalUrl('https://journal.example.com/', options), 'https://journal.example.com/?openExternalBrowser=1');
});
test('confirmed path, query and hash survive browser selection', () => {
  assert.equal(externalJournalUrl('https://journal.example.com/journal?view=week#today', options), 'https://journal.example.com/journal?view=week&openExternalBrowser=1#today');
});
test('conflicting and duplicate browser parameters converge idempotently', () => {
  const first = externalJournalUrl('https://journal.example.com/?openExternalBrowser=0&openExternalBrowser=1&openInAppBrowser=0', options);
  assert.equal(first, 'https://journal.example.com/?openExternalBrowser=1');
  assert.equal(externalJournalUrl(first, options), first);
});
test('unconfirmed origins, HTTP, credentials and LIFF fail closed', () => {
  for (const url of ['https://wrong.example.com/', 'http://journal.example.com/', 'https://name:pass@journal.example.com/']) assert.throws(() => externalJournalUrl(url, options));
  for (const host of ['liff.line.me', 'miniapp.line.me', 'line.me', 'localhost', '127.0.0.1', '[::1]']) assert.throws(() => externalJournalUrl(`https://${host}/app`, { allowedOrigin: `https://${host}` }));
});
test('origin confirmation is required and cannot carry a path or credentials', () => {
  for (const allowedOrigin of [undefined, 'https://journal.example.com/login', 'https://user:pass@journal.example.com']) assert.throws(() => externalJournalUrl('https://journal.example.com/', { allowedOrigin }));
});
test('sensitive parameters are rejected even if listed as allowed', () => {
  for (const key of ['token', 'account', 'session', 'code', 'lineUserId']) assert.throws(() => externalJournalUrl(`https://journal.example.com/?${key}=private`, { ...options, allowedQueryKeys: [key] }));
});
test('arbitrary query keys cannot be silently preserved', () => {
  assert.throws(() => externalJournalUrl('https://journal.example.com/?destination=elsewhere', options));
});
