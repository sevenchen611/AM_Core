# VERIFY — AM-IMP-2026.0708.02

## 靜態

- [x] `node --check src/meeting.js` 通過
- [x] `node --check src/server.js` 通過
- [x] `server.js` 不再 import `processMeetingRecording`(改 import handleMeetingAudio/hasPendingMeeting/consumeMeetingRoster)
- [x] AssemblyAI key 授權:`curl -H "Authorization: <key>" https://api.assemblyai.com/v2/transcript?limit=1` → **HTTP 200**

## 生產端到端(需在綁定群組實測)

1. 到綁定群組(如「茲心園工程測試」或 HZ 設計師群)傳一段會議錄音。
2. 葉小蝸應回覆:收到錄音、已存檔,並反問「①參與者(含發言順序)②主題」。
3. 回覆一則含與會者與主題的文字(例:`①昱晴 女 設計師 ②其勳 男 主任;主題:D區拆除範圍確認`)。
4. 3–8 分鐘後,群裡應出現會議記錄摘要(含「講者:講者A=昱晴(設計師)…」對照)。
5. 開啟 Notion 會議記錄頁,確認:
   - [ ] 參與者、講者對照、摘要、決議、checkbox 待辦皆為**真名**
   - [ ] 頁尾有「逐字稿(署名)」區塊,逐句標註「名字(職務):內容」
   - [ ] 「🎙 錄音原檔」連結可回放(Drive「會議錄音/日期/」)
   - [ ] 待辦任務資料庫已展開對應任務,負責人帶真名
6. 逾時後備:傳錄音後**不回答**,30 分鐘後應仍自動產出(講者 A/B/C 版)。
7. 後備引擎:暫移除 `ASSEMBLYAI_API_KEY` 後傳錄音,應退回舊 Gemini 直轉(不反問),行為同 0708.01。

## 判準

反問→署名→發布全鏈路成功、會議頁署名逐字稿正確、待辦帶真名,即通過。
