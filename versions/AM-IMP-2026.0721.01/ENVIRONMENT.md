# Environment and One-Time Setup

This version adds no shared secret and no mandatory new global environment
variable. It reads the target's existing project-local configuration.

## Capabilities used by current Preflight

Depending on the requested mode, the selected tenant must already have:

- Portal authentication and tenant-wide group-manager authorization;
- an enabled meetings module and configured Group Bindings source;
- a meeting-record storage destination;
- transcription and AI meeting summarization configuration;
- LINE notification support;
- public base URL and signed review-link configuration for review modes;
- a tenant LIFF ID and synchronized group members for review modes;
- a formal tasks source for `review_and_create`;
- optional Drive backup configuration (currently a Warning when absent).

`formalTasksEnabled` remains the current tenant ceiling. It is not edited from
the management page.

## Checkbox and initializer boundary

The page can list groups, run configured-readiness Preflight, initialize the
meeting fields in an existing Group Bindings source, and update group modes. It
does not:

- create or publish a LINE Login channel or LIFF app;
- verify every LINE Developer console state;
- change LINE credentials or add a bot to a group;
- create or resize Render services or write Render secrets;
- create Notion sources/integrations or grant permissions;
- provision storage, transcription, or AI accounts.

If a required configured capability is missing, Preflight returns Blocked and
the authorized one-time setup must be completed outside this page.

AM Platform, HOZO AM, SevenAM, and each new AM project keep separate
configuration, credentials, deployment, and verification status.
