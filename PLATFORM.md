# AM Platform（葉小蝸 AI 小幫手）

> 一支付費 LINE OA（葉小蝸 AI 小幫手）→ 一個平台伺服器 → 依群組分流到各租戶 → 各租戶用自己的 Notion 頁。
> 架構＝**方案一：單一平台 + 多租戶**。本資料夾（AM_Core）即平台本體。
> 名稱維持 `AM_Core`（改名有內部路徑成本、暫不改），角色升級為「平台」。

## 三層結構

| 層 | 資料夾 | 是什麼 |
|---|---|---|
| 底座 | `core/`（已存在） | 收 webhook、**路由器（群→租戶）**、租戶解析、LINE/Notion/Drive 接線、資料隔離。⚠️ **運行時伺服器待建**（要加 `package.json` + `server.js` 才會跑；今天 AM_Core 還不是會跑的伺服器） |
| 功能 | `modules/` | 一個功能一個資料夾，**改一次、全租戶受惠**。契約見 `modules/README.md` |
| 身分 | `tenants/` | 租戶設定（**資料，不是程式**），各指自己的 Notion 頁＋啟用哪些模組。schema 見 `tenants/README.md` |

## 遷移原則（保護現行系統）

- 現行 **BuildAM 一直活著、資料一動不動**。平台在旁邊蓋、測好，**最後才把 OA 的 webhook 切過來**，且**可回退**（指回舊 BuildAM 就復原）。
- 第一批租戶：**工程**（＝BuildAM，原地 Notion 頁）、**森在**（＝Notion「AI」頁）。

## 模組搬遷協作（給平行 session）

- **meetings 模組**：從 BuildAM `src/meeting.js` 整個搬進 `modules/meetings/`，依模組契約重塑；BuildAM 的 meeting 改為**委派/綁定**到此模組——如此「一直改善 Meeting」只改這一處。
- **狀態隔離**：會議「待補資訊」的 pending，由「單群鍵」改為 **（租戶, 群組）鍵**，不同租戶不可互相污染。
- **待決（該 session 拍板）**：BuildAM 與 AM_Core 是不同 repo，「BuildAM 綁到模組」的相依機制——git submodule／本地 npm 套件／vendored 複製。**建議先 vendored 複製＋標註來源**（BuildAM 內複製一份模組並註明來自 platform），等平台上線再統一收斂；此法**不影響現行 BuildAM 部署**。
