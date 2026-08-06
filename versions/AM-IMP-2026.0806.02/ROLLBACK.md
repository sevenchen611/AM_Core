# Rollback

1. Remove `personal-assistant` from `tenants/hozo-am-2-0.json` or set
   `config.personalAssistant.enabled=false`.
2. Redeploy the AM Platform production service.
3. Confirm group messages still route normally.
4. Confirm new one-to-one messages receive no private project data.

The shared core functions may remain installed while no tenant enables the
module; they are dormant and do not change group routing. No data migration or
private binding table needs reversal because this version stores no new live
identity data.
