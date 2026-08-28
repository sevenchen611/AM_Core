# Environment contract

Set values only in the target service's secret/configuration UI. This package
declares names and validation rules; it contains no values.

| Name | Secret | Required | Rule |
| --- | --- | --- | --- |
| `ENG_CONTRACTS_SIGNING_ENABLED` | No | Yes | Start at `0`; set to `1` only after pilot verification. |
| `ENG_CONTRACTS_DATABASE_URL` | Yes | Yes | PostgreSQL connection for the isolated `engineering_contracts` schema. |
| `ENG_CONTRACTS_LIFF_ID` | No | Yes | LIFF app used to verify the designated external signer. |
| `ENG_PUBLIC_BASE_URL` | No | Yes | HTTPS origin for signer links; no path, query, or fragment. |
| `ENG_CONTRACTS_TOKEN_PEPPER` | Yes | Yes | Independent secret of at least 32 bytes used to HMAC opaque tokens. Never reuse queue, Portal, LINE, or meeting secrets. |
| `ENG_CONTRACTS_PDF_RENDER_URL` | No | Yes | HTTPS origin of the trusted server-side PDF renderer. |
| `ENG_CONTRACTS_PDF_RENDER_TOKEN` | Yes | Yes | Independent renderer bearer token of at least 32 bytes. |
| `ENG_CONTRACTS_DATA_SOURCE_ID` | Sensitive config | Yes | Existing Engineering contract projection data source. |
| `ENG_PROJECTS_DATA_SOURCE_ID` | Sensitive config | Yes | Existing Engineering project data source. |
| `ENG_GROUP_BINDINGS_DATA_SOURCE_ID` | Sensitive config | Yes | Existing Engineering group-binding data source. |
| `ENG_DRIVE_ROOT_FOLDER_ID` | Sensitive config | Yes | Existing Engineering Drive root. |
| `NOTION_TOKEN` | Yes | Yes | Existing platform Notion identity; never sent to the browser. |
| `LINE_CHANNEL_ACCESS_TOKEN` | Yes | Yes | Existing shared OA server token for send and membership lookup. |
| `LINE_CHANNEL_SECRET` | Yes | Yes | Existing shared OA webhook secret. |
| `GOOGLE_OAUTH_CLIENT_ID` | Yes | Yes | Existing platform Drive OAuth identity. |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Yes | Yes | Existing platform Drive OAuth identity. |
| `GOOGLE_OAUTH_REFRESH_TOKEN` | Yes | Yes | Existing platform Drive OAuth identity. |

## Required runtime mapping

The runtime should expose the following server-only values to the Engineering
contract store/handler. None may be serialized into initial page data except
`liffId`, `publicBaseUrl`, numeric limits, and non-sensitive UI flags.

```text
tenant.config.contracts.signingEnabled
tenant.config.contracts.liffId
tenant.config.contracts.tokenPepper
tenant.config.contracts.tokenTtlHours = 168 (fixed by runtime)
tenant.config.contracts.pdfRenderUrl
tenant.config.contracts.pdfRenderToken
tenant.publicBaseUrl
```

## Token rules

- Generate at least 32 random bytes with a cryptographic RNG.
- Show the raw base64url token only in the HTTPS signing URL.
- Store only `HMAC-SHA-256(token, ENG_CONTRACTS_TOKEN_PEPPER)` as
  lowercase hex in `signing_sessions.token_digest`.
- Never log the raw token or place it in Notion, Drive metadata, LINE alt text,
  analytics, error messages, or event payloads.
- Redact the signer path query/path segment from access logs where supported.
- Rotation revokes active sessions and requires reissue; old evidence remains.

## Trusted proxy and IP policy

Before production, document the exact Render/Cloudflare proxy chain. Accept a
forwarded IP header only from that trusted hop; otherwise use
`req.socket.remoteAddress`. Normalize the result to PostgreSQL `inet`. Store the
full value only in protected evidence and use a masked display in ordinary lists.

## Startup fail-closed rules

When `ENG_CONTRACTS_SIGNING_ENABLED=1`, startup or the contract route must reject
signing operations if any required value is absent, the fixed TTL is not seven days, the
database schema version differs, Drive is unavailable, or the public base URL is
not HTTPS. Read-only management may remain available with a clear degraded-state
banner; issue and sign operations must not degrade open.
