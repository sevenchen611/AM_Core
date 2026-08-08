# Install

1. Confirm `HZ2_TASKS_DATA_SOURCE_ID` is set in the AM Platform runtime
   environment.
2. Confirm a MiniMax key is available through either `HZ2_MINIMAX_API_KEY` or
   the platform-level `MINIMAX_API_KEY`.
3. Deploy the AM Platform code containing:
   - `modules/personal-assistant/index.js`
   - `modules/tasks/index.js`
   - `core/bootstrap.js`
   - `core/tenants.js`
   - `tenants/hozo-am-2-0.json`
4. Do not run any Rental Calendar personal-task migration. The target state is
   zero-migration and no dual write.
5. After deployment, use the one-to-one LINE assistant to test:
   - `新增待辦：` with multiple numbered items;
   - `確認新增`;
   - `我的今天`;
   - `我的行事曆`;
   - a photo or sticker message, which should not repeat the identity fallback.

