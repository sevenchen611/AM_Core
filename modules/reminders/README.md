# modules/reminders — 到期/逾期/行程提醒(通用排程骨架)

> 狀態:**✅ 已抽出**(自 BuildAM `src/server.js` 提醒引擎)。範本見 `modules/meetings/`。

## 這個模組做什麼
週期性巡邏,對「一個租戶」跑所有提醒 pass。同一入口 `tick(ctx)`,三處觸發:
1. core 每 10 分鐘 `setInterval` → `dispatcher.runTicks()` → 各租戶 `tick(ctx)`。
2. `/cron/tick?key=` → 同上。
3. `/cron/reminders?key=`(本模組 `routes` 專用端點)→ 巡所有啟用 reminders 的租戶(可 `?tenant=key` 指定單一租戶)。

## 五個 pass(行為與 BuildAM 完全等同)
| pass | 節奏 | 內容 |
|---|---|---|
| `runTaskTickPass` | 每次巡邏 | 帶時刻待辦「開始前 30 分」提醒(45 分內觸發,`t30` 去重) |
| `runTaskDailyPass` | 每日 ≥ 提醒時刻,當日一次 | 待辦 明日預告/今日到期/逾期;逾期滿 N 天**升級**內部/總管群並**真 @mention** 負責人 |
| `runTaskEveningPass` | 每日 ≥20:00,當日一次 | 明天帶時刻行程「前一晚」預告 |
| `runDueReminders` | 每日 | 回饋單 明日/今日/逾期推播 + 逾期升級(工程領域;真 @mention 對方/我方主管) |
| `wakeParkedTickets` | 每日 | 擱置回饋單復活(觸發工項開工 / 重提日到)+ **週一擱置盤點**彙總內部群 |

**真 @mention**:推播帶 `{ name, userId }`,`platform.pushLineMessage` 於訊息含該名字時升級為 `textV2` 指名通知。成員對照取自群組綁定的「成員對照」JSON 欄位。

## 契約(預設匯出)
```js
export default {
  name: 'reminders',
  init(platform),         // 注入共用能力:notionRequest / pushLineMessage(含真 @mention)
  async tick(ctx),        // 單一租戶巡一輪所有 pass;由 core runTicks 每租戶呼叫
  routes,                 // [{ prefix: '/cron/reminders', handler }] — 外部 cron 端點
};
```

### ctx — 每次巡邏(帶租戶脈絡)
- `tenant`:`{ key, envPrefix, modules, dataSources: { tasks, feedbackTickets, groupBindings, projects } }`
- 無 `feedbackTickets` 的租戶(如森在)自動略過回饋單相關 pass。

### 提醒設定(env,優先序:租戶前綴 → 平台級 → 相容 BuildAM)
| 設定 | 來源 | 預設 |
|---|---|---|
| 逾期升級門檻(天) | `<PREFIX>_ESCALATION_DAYS` → `AMCORE_ESCALATION_DAYS` → `BUILD_ESCALATION_DAYS` | 2 |
| 每日提醒時刻(台北時) | `<PREFIX>_REMINDER_HOUR` → `AMCORE_REMINDER_HOUR` → `BUILD_REMINDER_HOUR` | 9 |
| 升級點名對象 | `<PREFIX>_ESCALATION_OWNER` → `AMCORE_ESCALATION_OWNER` → `BUILD_ESCALATION_OWNER` | Seven陳聖文 |

`/cron/reminders` 授權:`AMCORE_QUEUE_ACCESS_KEY` 或 `BUILD_QUEUE_ACCESS_KEY`(與 `/cron/tick` 一致)。

## 狀態隔離
「當日一次」的日戳以 **`tenant.key`** 為鍵(`lastDailyDate` / `lastEveningDate` 兩個 Map),各租戶各自巡邏、各自累積,互不污染。升級對象(內部/總管群)per 租戶——查該租戶自己的 `groupBindings`,結構上碰不到別租戶。

## 依賴邊界(尚未抽出,先就地讀取以維持行為等同)
- **tasks 模組**:待辦庫查詢/提醒記錄讀寫(`openTasks` / `taskReminderRecord` / `markTaskReminded`)。tasks 抽出後改呼叫 `tasks.listOpen` / `tasks.markReminded`。
- **construction 模組**:回饋單(`feedbackTickets`)到期/擱置規則屬工程領域(`runDueReminders` / `wakeParkedTickets`)。construction 上線後,這兩個 pass 可改由 construction 注冊「額外 pass」給 reminders。
- 兩者目前皆以 `tenant.dataSources.*` 直讀,行為與 BuildAM 完全等同。

## BuildAM 生產
本次**未觸碰** BuildAM。BuildAM 綁定(vendored 複製 + 薄 shim)待平台上線前另行處理,`src/server.js` 對外介面不變、可回退。

## 驗證
- `node --check modules/reminders/index.js` 通過。
- mock 等同性測試(不打真 API)涵蓋:t30 真 @mention、待辦逾期升級點名、明日行程預告、回饋單到期+升級、擱置復活、週一盤點、`/cron/reminders` 授權——全數通過。
