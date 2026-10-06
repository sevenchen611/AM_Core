# UOF direct chat onboarding

UOF managers may issue ten-minute pairing codes for one-to-one LINE conversations. The existing UOF login and final confirmation remain required. The code hash records the requested mode in a separate namespace; a group code cannot be used in a direct chat. No database migration is needed.

Existing bindings migrate through the scoped conversation endpoint with their original account and LINE owner. No grants, signer rights or unrelated tenant behavior change. The paused general assistant admits only a live direct pairing code; ordinary private messages remain paused. Exact-owner unfollow events suspend the binding.