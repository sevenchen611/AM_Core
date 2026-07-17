# Vendored 狀態

AM Platform 目前沒有需要人工同步的正式下游複製品。

工程 AM 已直接由本 repo 的 `core/`、`modules/`、`tenants/engineering.json` 運行；改善會議、LLM、照片或工程功能時，只改平台來源，不再複製到另一個工程服務。

## 歷史紀錄

正式收斂前，舊工程服務曾複製下列檔案作過渡：

| 平台來源 | 舊過渡複製品 |
|---|---|
| `core/llm.js` | `_platform/llm.js` |
| `modules/meetings/index.js` | `_platform/meetings/index.js` |
| `modules/media/index.js` | `_platform/media/index.js` |

這些複製品只供回退版本保留，不再接收新功能。完成 webhook／網域切換與觀察期後，舊服務連同複製品一起退役。
