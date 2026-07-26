# Environment

No new secrets or environment variables are introduced.

For production deep links, configure one of the existing public base URL variables:

| Variable | Required | Purpose |
| --- | --- | --- |
| `ENG_PUBLIC_BASE_URL` | Recommended for engineering | Tenant-specific public dashboard base URL. |
| `AMCORE_PUBLIC_BASE_URL` | Fallback | Platform public dashboard base URL. |

Expected production value:

```text
https://am.hozorental.com
```

Do not store Render secret values in this package.
