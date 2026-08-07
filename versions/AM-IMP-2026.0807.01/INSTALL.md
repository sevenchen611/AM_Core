# Install

1. Start from an AM Platform revision that already contains
   `AM-IMP-2026.0804.01`, `AM-IMP-2026.0806.01`, and
   `AM-IMP-2026.0806.02`.
2. Install the updated `modules/claims/index.js` and
   `modules/personal-assistant/index.js`.
3. Keep both `personal-assistant` and `claims` enabled for the target tenant.
4. Keep the Rich Menu action as LINE text `我要請款`. Do not paste a generated
   LIFF session URL into the menu.
5. Keep existing claims environment values and group claim-governance fields.
   This package adds no new secret.
6. Run the verification commands in `VERIFY.md` before deployment.
7. Deploy the AM Platform service and complete only the non-financial live
   verification: tap the Rich Menu and open the form. Do not submit a claim as
   part of deployment verification.
