# UOF direct conversation pilot

LINE IO can explicitly move a verified personal binding from its exclusive group
to the same owner's 1-to-1 LINE conversation. No account changes automatically.
The management endpoint requires the original account, binding and exact expected
LINE identity. Ordinary direct assistant conversations remain on their existing
route; only UOF commands and `uof.` postbacks enter the UOF transport.

The v1 `groupId` envelope remains the conversation key. A direct conversation uses
the verified U-id and reports `conversationType: user`. Group callers remain
compatible. Profile evidence replaces group membership evidence for direct keys.
Unfollow suspends the binding; provider outages fail closed without deleting it.
