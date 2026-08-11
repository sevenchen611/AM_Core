# AM-IMP-2026.0811.03 Engineering Project Notion Links

This package places a direct `Notion ↗` link after the name and status chips on
every engineering dashboard project card.

The URL comes from that project's tenant-local Notion page object. The link
opens in a new tab, uses safe opener isolation, and stops click propagation so
opening Notion does not also switch the dashboard project.

No Notion data or schema is changed by this package.

## Status

`Ready`: implementation and mock verification are complete. Mark this package
`Deployed` only after the AM Platform Render service and live project-card links
are verified.
