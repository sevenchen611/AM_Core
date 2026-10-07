# 工作日誌文字命令

In the OA direct chat, `工作日誌`, `開啟工作日誌` and `打開工作日誌` reply with one `開啟工作日誌` URI button. It reuses the exact journal action from the user's current Messaging API Rich Menu, including external browser parameters. A text message cannot itself trigger a URI action; the user taps the returned button.

This is public navigation, before private-assistant pause and independent UOF transport intake. It never creates a task, parses journal contents, resolves a tenant identity or reads employee data. DailyLog retains login and access enforcement. Group/room messages, longer task content and existing commands keep their original routes.

Menu associations are checked on every command; immutable definitions are coalesced and cached by menu ID, bounded to 64 entries. Missing journal actions, failed API reads and ambiguous tiles give a retry message, with no guessed URL. No new secret, environment setting, database, Rich Menu mutation or shared data is required.

Status: Ready package; root installation evidence is recorded separately. LINE phone acceptance remains separate from isolated webhook tests.
