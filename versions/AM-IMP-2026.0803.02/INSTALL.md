# Install

1. Deploy the AM Platform code changes in `core/line.js`, `core/bootstrap.js`, `core/group-onboarding.js`, and `server.js`.
2. Confirm the shared LINE OA has access to the target group and can call `GET /v2/bot/group/{groupId}/summary`.
3. In the affected group, resend the onboarding command. The legacy command remains supported:

```text
<绑定 HOZOAM 2.0 群组>
```

The preferred explicit form is:

```text
綁定 HOZO AM 2.0 群組：好住寓好 明義街 46 號
```

The stored binding name will use the LINE group summary, not the text after the colon.

No schema or environment-variable changes are required.
