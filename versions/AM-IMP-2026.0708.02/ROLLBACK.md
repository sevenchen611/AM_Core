# ROLLBACK — AM-IMP-2026.0708.02

此升級**內建零風險退場**:會議引擎依 `ASSEMBLYAI_API_KEY` 是否存在自動切換。

## 選項 A — 停用 AssemblyAI,保留新版程式(最快、建議)

移除或清空 `ASSEMBLYAI_API_KEY`(Render Environment / 本機 .env),重啟服務。
`handleMeetingAudio` 會偵測無 key → 直接呼叫 `processMeetingRecording`
(舊 Gemini 直轉、不反問),行為與 `AM-IMP-2026.0708.01` 完全一致。
無需改碼、無需回滾 commit。

## 選項 B — 完整回滾程式

`git revert` 本升級的 commit(BuildAM main:「Switch meeting pipeline to
AssemblyAI with speaker diarization」),恢復 `src/meeting.js`、`src/server.js`、
`PROJECT_OVERVIEW.md`。push 觸發 Render 重部署。

## 資料與留痕

- 無資料庫 schema 變更,無需資料遷移。
- 已產出的會議記錄(含署名逐字稿)與待辦任務保留於 Notion,不受回滾影響。
- Drive「會議錄音/日期/」原檔保留。
- 記憶體中待補會議(pending)於重啟即清空,無殘留。

## 注意

回滾後仍需保留 `GEMINI_API_KEY`(後備/舊流程的摘要引擎)。
