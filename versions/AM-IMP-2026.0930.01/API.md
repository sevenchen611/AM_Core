# Personal LINE delivery change

POST `/api/v1/line/messages` still requires the bound `notifyUserId` for personal
groups. The gateway validates that ID against the active binding and confirms the
user is still a member. It uses the ID only to authorize the destination and does
not create a `textV2` mention for dynamic personal bindings.

Plain text sends one text message. A card request sends one Flex message. Text with
legacy actions sends the text and one Flex action card. The recipient field stays
in the idempotency identity and accepted delivery record. Non-personal groups keep
the existing mention and report behavior.
