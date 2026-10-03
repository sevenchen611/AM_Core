# Shorter LINE event capture database path

Status: Ready. Ordinary personal-group messages avoid a second unchanged binding
list refresh. Binding lifecycle processing and directory observation run together,
and both must finish successfully before an event can be appended. Membership
changes therefore still suspend access before event authorization.

Binding expiry and a current-row read use one database statement. Verification
retains separate database reads before and after fresh LINE identity checks;
revoked or suspended status cannot be restored by a completed proof. No completed
authorization cache, schema change or new environment setting is introduced.

This reduces database round trips on event capture and repeated authorization.
The full response time must still be measured from a real LINE input timestamp
to the platform accepting its reply, and can vary with LINE and UOF calls.
