# HOZO AM 2.0 personal LINE identity routing

This package adds the first safe layer required for 葉小蝸 to act as a one-to-one
HOZO assistant.

The platform derives a private identity from the stable LINE user ID already
recorded in formally enabled HOZO AM 2.0 group member maps. Display names are
never used to decide identity. A direct message is routed only when exactly one
enabled tenant matches. Cross-tenant duplicates, Notion lookup failures, shadow
groups, disabled groups and unknown users fail closed.

Direct messages use a dedicated `onDirectMessage` hook and a `line-user`
principal. Existing group `onMessage` modules such as collect, triage, meetings
and task extraction never receive private messages.

The first-stage `personal-assistant` module replies with the confirmed tenant
identity and routing status. It deliberately does not read, create or update
tasks yet. Calendar, personal todo and Rental reminder functions can be added to
the same private hook after their own data and permission contracts are ready.

No LINE user ID, private message, customer data or secret is stored in AMCore.
Live identity evidence remains in the HOZO AM 2.0 tenant's own group binding
data source.
