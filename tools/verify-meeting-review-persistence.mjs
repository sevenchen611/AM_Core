import assert from 'node:assert/strict';
import meetings, { __test } from '../modules/meetings/index.js';

const meetingId = '3a451c686dac81e3b7f1f3f77b8c83ca';
const markerBlocks = [];
let blockSeq = 0;

meetings.init({
  publicLinkSecret: 'meeting-review-test-secret',
  publicBaseUrl: 'https://example.test',
  notionRequest: async (path, options = {}) => {
    if (path.startsWith(`/v1/blocks/${meetingId}/children`)) {
      if (options.method === 'GET') return { results: markerBlocks, has_more: false };
      if (options.method === 'PATCH') {
        for (const child of options.body.children || []) {
          markerBlocks.push({ id: `block-${++blockSeq}`, ...child });
        }
        return { results: markerBlocks.slice(-((options.body.children || []).length)) };
      }
    }
    const updateMatch = path.match(/^\/v1\/blocks\/([^/]+)$/);
    if (updateMatch && options.method === 'PATCH') {
      const block = markerBlocks.find((item) => item.id === updateMatch[1]);
      assert.ok(block, 'marker block must exist before update');
      block.paragraph = options.body.paragraph;
      return block;
    }
    throw new Error(`unexpected Notion request: ${options.method || 'GET'} ${path}`);
  },
});

const tenant = {
  key: 'engineering',
  config: { meetings: { formalTasksEnabled: true, liffId: '2010757652-test' } },
  dataSources: { tasks: 'tasks-db' },
};

const session = __test.createReviewSession({
  tenant,
  binding: {
    pageId: 'binding-page',
    groupName: '葉綠宿Seven',
    role: '總管',
    projectPageId: 'project-page',
    members: { Seven: 'U_HOST' },
  },
  groupId: 'C_TEST',
  hostName: 'Seven',
  hostUserId: 'U_HOST',
  meetingId,
  meetingUrl: 'https://notion.example/meeting',
  publicUrl: 'https://example.test/m/meeting',
  projectPageId: 'project-page',
  perGroup: false,
  todos: [{ content: '完成會議確認持久化', owner: 'Seven', due: '2026-07-21' }],
});

assert.equal(session.id, meetingId, 'new review session id must be the normalized meeting page id');
await __test.persistReviewSession(session);
assert.equal(markerBlocks.length, 1, 'persist should append one marker block');

session.status = 'reviewing';
session.todos[0].ownerConfirmed = true;
session.todos[0].ownerConfirmedBy = 'Seven';
await __test.persistReviewSession(session);
assert.equal(markerBlocks.length, 1, 'persist should update the existing marker block');

__test.reviewSessions.delete(session.id);
const restored = await __test.loadReviewSessionFromMeeting(session.id, [tenant], null);
assert.ok(restored, 'review session must restore from the meeting page marker after memory loss');
assert.equal(restored.id, session.id);
assert.equal(restored.status, 'reviewing');
assert.equal(restored.tenant.key, 'engineering');
assert.equal(restored.groupId, 'C_TEST');
assert.equal(restored.hostUserId, 'U_HOST');
assert.equal(restored.todos[0].content, '完成會議確認持久化');
assert.equal(restored.todos[0].ownerConfirmed, true);

console.log('Meeting review persistence verification passed: session survives memory loss via meeting-page marker.');
