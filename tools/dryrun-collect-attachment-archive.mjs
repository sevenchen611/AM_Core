import assert from 'node:assert/strict';
import fs from 'node:fs';
import collect, { __test } from '../modules/collect/index.js';
collect.init({});
await assert.rejects(__test.storeAttachment({ctx:{tenant:{key:'synthetic'},message:{type:'file'},event:{}},messageId:'synthetic'}), /Durable Drive archive is unavailable/);
const source=fs.readFileSync(new URL('../modules/collect/index.js',import.meta.url),'utf8');
assert.equal(source.includes('platform.uploadFileToNotion('),false);
assert.equal(__test.storedMessageContent({type:'sticker',packageId:'p',stickerId:'s'}),'[sticker] package:p sticker:s');
console.log('Collect Drive-only contract passed: durable archive required; no Notion upload. Full transfers covered by test-attachment-retention.mjs.');
