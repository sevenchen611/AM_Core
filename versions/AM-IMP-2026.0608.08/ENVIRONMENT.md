# Environment

Use project-local names.

HOZO_AM currently uses:

- `HOZO_RESPONSIBILITY_DATA_SOURCE_ID`
- `HOZO_LINE_GROUP_OPTIONS_DATA_SOURCE_ID`
- `HOZO_LINE_GROUP_MEMBERS_DATA_SOURCE_ID`

SevenAM currently uses:

- `SEVEN_RESPONSIBILITY_DATA_SOURCE_ID`
- `SEVEN_LINE_GROUP_OPTIONS_DATA_SOURCE_ID`
- `SEVEN_LINE_GROUP_MEMBERS_DATA_SOURCE_ID`

Future AM_Core code should migrate toward generic internal names while adapters map them to project-local env vars.

