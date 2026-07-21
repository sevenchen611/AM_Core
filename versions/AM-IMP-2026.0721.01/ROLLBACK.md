# Rollback

Rollback is target-local. Do not change another AM project's settings,
deployment, records, credentials, or group bindings.

## Configuration rollback

1. Before code rollback, use the current page to set affected groups to the
   verified safer mode (`僅記錄` or `關閉`) when the page remains usable.
2. Confirm the stored group mode changed and the next new meeting follows it.
3. Record the operational decision in the target's existing change process.

This version has no rollback-history UI or independent audit database.

## Code rollback

1. Stop deploying this version in the affected target.
2. Restore only the target-local management page, policy resolver, Group
   Bindings schema additions, router mapping, meetings integration, and matching
   tests to the previous verified revision.
3. Redeploy that target's own service.
4. Verify the previous meeting-record, routing, confirmation, and formal-task
   behavior.
5. Update the target-local upgrade record and manifest; do not leave the version
   marked `Deployed` after rollback.

The five meeting-management fields may remain in Group Bindings; older runtimes
can ignore them. Do not delete group bindings, member mappings, meeting media,
transcripts, meeting records, candidate todos, confirmations, or formal tasks.

Formal tasks already created through `review_and_create` remain valid and must
not be deleted unless the project owner separately authorizes reviewed cleanup.
Rollback never copies or merges data between tenants or targets.

## Later extensions

Emergency-stop controls and a rollback-history UI are not included in this
version; do not claim they are available during rollback.
