# Environment contract

Set values only in the target service's secret/configuration UI. This package
declares names and validation rules; it contains no values.

| Name | Secret | Required | Rule |
| --- | --- | --- | --- |
| `ENG_CONTRACTS_SIGNING_ENABLED` | No | Yes | Start at `0`; set to `1` only after pilot verification. |
| `ENG_CONTRACTS_DATABASE_URL` | Yes | Yes | PostgreSQL connection for the isolated `engineering_contracts` schema. |
| `ENG_CONTRACTS_DATABASE_DEDICATED` | No | Yes | Must be `1`; confirms this credential/database is dedicated to Engineering contract evidence while the schema has no cross-tenant RLS. |
| `ENG_CONTRACTS_DATABASE_SSL_MODE` | No | Yes | Runtime supports `require` for disposable/local environments; production must use `verify-full` or `verify-pinned`. |
| `ENG_CONTRACTS_DATABASE_CA` | Yes | Yes | Trusted PostgreSQL CA PEM. For `verify-pinned`, set this to the exact self-signed certificate exposed by the private database endpoint. |
| `ENG_CONTRACTS_DATABASE_CERT_SHA256` | No | With `verify-pinned` | Exact SHA-256 fingerprint of the private endpoint leaf certificate (64 hex characters, optional colons). |
| `ENG_CONTRACTS_LIFF_ID` | No | Yes | LIFF app used to verify the designated external signer. |
| `ENG_CONTRACTS_LIFF_ENDPOINT_URL` | No | Yes | Must exactly equal `${ENG_PUBLIC_BASE_URL}/contract-sign`. |
| `ENG_PUBLIC_BASE_URL` | No | Yes | HTTPS origin for signer links; no path, query, or fragment. |
| `ENG_CONTRACTS_TOKEN_PEPPER` | Yes | Yes | Independent secret of at least 32 bytes used to HMAC opaque tokens. Never reuse queue, Portal, LINE, or meeting secrets. |
| `ENG_CONTRACTS_PDF_RENDER_URL` | No | Yes | HTTPS origin of the trusted server-side PDF renderer. |
| `ENG_CONTRACTS_PDF_RENDER_TOKEN` | Yes | Yes | Independent renderer bearer token of at least 32 bytes. |
| `ENG_CONTRACTS_DATA_SOURCE_ID` | Sensitive config | Yes | Existing Engineering contract projection data source. |
| `ENG_PROJECTS_DATA_SOURCE_ID` | Sensitive config | Yes | Existing Engineering project data source. |
| `ENG_GROUP_BINDINGS_DATA_SOURCE_ID` | Sensitive config | Yes | Existing Engineering group-binding data source. |
| `ENG_DRIVE_ROOT_FOLDER_ID` | Sensitive config | Yes | Existing Engineering Drive root. |
| `ENG_CONTRACTS_TRUSTED_PROXY_IPS` | Sensitive config | Yes | Exact immediate proxy hop IPs, or the single sentinel `render` for a Render public web service. Never use public or client-controlled ranges. |
| `ENG_CONTRACTS_TRUSTED_CLIENT_IP_HEADERS` | No | Yes | Headers overwritten by the trusted proxy. Render mode requires exactly `cf-connecting-ip`; `x-forwarded-for` is forbidden in that mode. |
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
tenant.config.contracts.liffEndpointUrl
tenant.config.contracts.databaseDedicated
tenant.config.contracts.databaseSslMode
tenant.config.contracts.databaseCaConfigured
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

For a Render public web service, set exactly:

```text
ENG_CONTRACTS_TRUSTED_PROXY_IPS=render
ENG_CONTRACTS_TRUSTED_CLIENT_IP_HEADERS=cf-connecting-ip
```

The `render` sentinel is deliberately narrow. It accepts `CF-Connecting-IP`
only when the immediate socket peer is loopback, RFC1918, IPv4 link-local,
IPv6 unique-local, or IPv6 link-local. A public socket peer is never trusted.
The mode never reads `X-Forwarded-For`, including when `CF-Connecting-IP` is
missing or malformed, because that chain may retain caller-supplied entries.
Render documents that public web traffic traverses its Cloudflare-backed edge,
that the internal proxy connects to the app, and that `CF-Connecting-IP` is
overwritten before reaching a Render web service.

For a different deployment, list only exact immediate proxy IPs and only
headers that those proxies overwrite. Otherwise the runtime uses
`req.socket.remoteAddress`. Normalize the result to PostgreSQL `inet`. Store the
full value only in protected evidence and use a masked display in ordinary lists.

Render references:

- https://render.com/articles/host-pocketbase-on-render
- https://render.com/tutorials/web-service-vs-static-site/web-services
- https://render.com/docs/private-network

## Startup fail-closed rules

When `ENG_CONTRACTS_SIGNING_ENABLED=1`, startup or the contract route must reject
signing operations if any required value is absent, the fixed TTL is not seven days, the
database schema version differs, Drive is unavailable, or the public base URL is
not an exact HTTPS origin, the LIFF endpoint differs, trusted proxy settings are
empty, the database is not explicitly dedicated, or PostgreSQL TLS is not
`verify-full` with a CA, or `verify-pinned` with the exact self-signed CA and an
independently configured SHA-256 leaf-certificate fingerprint. `verify-pinned`
keeps `rejectUnauthorized=true`; it replaces only DNS hostname matching because
the Render private certificate has no usable SAN. Any CA-chain or pin mismatch
fails closed. Read-only management may remain available with a clear degraded-state
banner; issue and sign operations must not degrade open.
