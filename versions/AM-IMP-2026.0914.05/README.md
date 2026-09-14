# AM-IMP-2026.0914.05 — 請款表單停用顯示與版本歷史

Status: `Deployed`

讓請款單管理直接顯示每張表單的目前版本與版本歷史，並將沒有任何適用群組的
「共同營業費用請款單」移入「已停用表單與歷史」，不再出現在一般可用表單清單。

- Finance Claims 是表單版本與請款快照的唯一來源。
- 三張舊版 AM LIFF 表單各建立不可變更的 published v1 基準版本。
- 新請款保存送件當時的 form id、version no、definition hash 與完整定義快照。
- 既有舊請款不改寫，以 `legacy_v1_inferred` 顯示其歷史基準版本。
- V3 原有的 draft／publish／immutable version 規則保持不變。

本版本不刪除表單或歷史請款，也不自動修改正式環境的群組發布設定。
