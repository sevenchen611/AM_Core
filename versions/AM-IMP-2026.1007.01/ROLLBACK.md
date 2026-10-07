# Rollback

The installation retains the previous menu. Use the same target's private receipt and own LINE credential to restore the previous default with `POST /v2/bot/user/all/richmenu/{previous.richMenuId}`, then read back the default, actions and image. If the prior default came from Official Account Manager, remove the API default instead, as recorded by restoreManagerDefault. Do not delete old menus before acceptance.

Only restore the default if the active menu is still the one created in this receipt. If another change has occurred, reconcile before replacing it. Restore any separately changed per-user or alias associations only from their own captured previous values; this default-only installer does not change them.

No journal data, sessions or runtime rollback is needed. Recovery receipts and production menu IDs remain outside AMCore.
