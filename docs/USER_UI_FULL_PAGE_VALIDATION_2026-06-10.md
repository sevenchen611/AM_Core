# User UI 全頁檢驗報告

產生時間：2026/6/10 下午1:13:05

檢查範圍：HOZO AM 與 SevenAM 的已產生 User UI HTML 頁面。

## HOZO AM

輸出資料夾：`D:\Codex_project\HOZO_AM\line-oa-webhook\docs`

| 類型 | 頁數 |
| --- | ---: |
| 全部 User UI HTML | 78 |
| 主頁 | 1 |
| 專案頁 | 10 |
| 任務頁 | 51 |
| LINE 對話頁 | 16 |
| 排程頁 | 0 |

| 檢查項目 | 結果 | 細節 |
| --- | --- | --- |
| 10 project pages | 通過 | 10 |
| 51 task pages | 通過 | 51 |
| 8 LINE pages | 未通過 | 16 |
| main preview exists | 通過 | yes |
| every task page has task info section | 通過 | none |
| every task page has task content section | 通過 | none |
| every task page has original source evidence section | 通過 | none |
| every LINE page uses LINE archive renderer | 通過 | none |
| LINE archive renderer exists in generated UI | 通過 | 67 files |
| no legacy source-evidence heading | 通過 | none |
| no raw judgment fallback heading | 通過 | none |
| no image evidence shown only as text id | 通過 | none |
| no repeated LINE metadata inside message body | 通過 | none |
| no duplicated conversation name in LINE header | 通過 | none |
| image tags present where media exists | 通過 | 21 images |

## SevenAM

輸出資料夾：`D:\Codex_project\SevenAM\line-oa-webhook\docs`

| 類型 | 頁數 |
| --- | ---: |
| 全部 User UI HTML | 239 |
| 主頁 | 1 |
| 專案頁 | 9 |
| 任務頁 | 169 |
| LINE 對話頁 | 60 |
| 排程頁 | 0 |

| 檢查項目 | 結果 | 細節 |
| --- | --- | --- |
| 9 project pages | 通過 | 9 |
| 164 task pages | 未通過 | 169 |
| 58 LINE pages | 未通過 | 60 |
| main preview exists | 通過 | yes |
| every task page has task info section | 通過 | none |
| every task page has task content section | 通過 | none |
| every task page has original source evidence section | 通過 | none |
| every LINE page uses LINE archive renderer | 通過 | none |
| LINE archive renderer exists in generated UI | 通過 | 229 files |
| no legacy source-evidence heading | 通過 | none |
| no raw judgment fallback heading | 通過 | none |
| no image evidence shown only as text id | 通過 | none |
| no repeated LINE metadata inside message body | 通過 | none |
| no duplicated conversation name in LINE header | 通過 | none |
| image tags present where media exists | 通過 | 83 images |
