# core/ — 平台底座(路由器 + 租戶解析 + 接線 + 資料隔離)

平台的運行時底座。收 webhook、**依群組把事件分流到租戶**、注入共用能力給模組、守住 per-tenant 資料隔離。
功能邏輯不放這裡(在 `modules/`);此處只有 plumbing。平台入口在專案根:`../server.js` + `../package.json`。

## 檔案

| 檔 | 職責 |
|---|---|
| `tenants.js` | 讀 `tenants/*.json` + 依 `envPrefix` 從 `.env` 補機密 → 執行期 tenant 物件;建「資料源 → 租戶」隔離登記 |
| `notion.js` | `notionRequest` + **per-tenant 資料隔離守衛**(只放行該租戶宣告、且位於其母頁下的資料源) |
| `line.js` | LINE 簽章驗證 / 取成員名 / 下載內容 / `pushLineMessage`(共用同一支 OA) |
| `drive.js` | Google Drive client(token / ensureFolder / upload) |
| `portal.js` | Portal 授權(PIN cookie;`hozo_session` → `rental.hozorental.com/api/me`) |
| `router.js` | `resolveGroupBinding`:對各租戶群組綁定庫查群 → `{ tenant, binding }`,快取(TTL) |
| `modules.js` | 模組載入(`modules/<name>/index.js`)、建 `ctx`、依序分派 `onMessage/onAudio`、蒐集 `routes`、跑 `tick` |
| `bootstrap.js` | 從 env 組裝以上一切(可注入 mock 供測試) |
| `util.js` | 共用小工具(id 正規化、http 基礎、env→camel) |

## 端點(`../server.js`)

- `GET /health` — 平台 + 各租戶設定狀態
- `POST /webhook/line` — 唯一入口:驗簽 → 解析租戶 → 分派模組(未綁定即忽略)
- `GET /cron/tick?key=…` — 觸發模組 `tick` 巡邏
- 其餘 → 各模組 `routes`

## 資料隔離(A 租戶不可碰 B 租戶庫)

1. 每個資料源 id 在登記表自我識別「屬哪個租戶」;寫入前守衛驗證它位於**該租戶母頁**下,否則拒絕。
2. 模組拿到的資料源 id 一律來自 `ctx.tenant.dataSources.*`,結構上碰不到別租戶。
3. core 內部呼叫可加 `tenantKey` 做嚴格綁定(路由器查群組綁定即用此擋跨租戶)。

## 驗證

`node tools/dryrun-core.mjs`(不需真憑證):兩租戶各發一則 → 分別落各自訊息庫、守衛擋越界。契約見 `../modules/README.md`。
