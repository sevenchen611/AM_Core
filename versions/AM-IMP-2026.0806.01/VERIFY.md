# Verify

1. Run `npm run dryrun:task-card`.
2. Run `npm run check` and `git diff --check`.
3. Open `/task?tenant=engineering&doc=<known-task-id>` with an authorized Portal account.
4. Confirm the card shows title, owner, deadline, project, source evidence, and existing body history.
5. Save an in-progress note with one test image and confirm both appear after reload.
6. Confirm `完成` is rejected without a written result and succeeds with one.
7. Confirm the bottom link opens `/dashboard?tenant=engineering`.
8. Trigger or preview an engineering reminder and confirm its deep link starts with `/task`.
9. Open a previously sent `/dashboard?tenant=engineering&doc=<known-task-id>` link and confirm it redirects to `/task`.
10. Confirm a user outside the task's project scope receives a denial.
