# Patch Notes: Dashboard Project Quick Status

Reference implementation: SevenAM commit `988061b`.

## Implementation Notes

- The status dropdown belongs on each task card in the project dashboard.
- It should use the same status vocabulary already used by the task edit page.
- It should call the existing task update API instead of creating a new endpoint.
- The save handler should be optimistic only after the API succeeds.
- Failed saves must restore the previous dropdown value.
- `封存` must not overwrite confirmation state; this preserves calibration and
  rejection feedback integrity.

## Suggested UI Labels

- Saving: `儲存中...`
- Saved: `已儲存`
- Failed: `儲存失敗，已還原`

## Confirmation Mapping

| Status | Confirmation write |
| --- | --- |
| `待確認` | `未確認` |
| `未開始` | `已確認` |
| `進行中` | `已確認` |
| `等待回覆` | `已確認` |
| `待確認完成` | `已確認` |
| `已完成` | `已確認` |
| `封存` | No write |
