# Inline result links for background LINE deliveries

Push messages carrying a single `inline: true` postback action now contain the result text and an underlined clickable label in one Flex bubble. This uses the same renderer as event replies. It avoids an extra generic operation confirmation card when background processing or Reply fallback uses Push.

The caller provides the read-only result-check action. Tenant, group, member, scoped-key and idempotency checks remain enforced. Existing actions without `inline: true` keep their presentation. No new credentials or data tables are required.
