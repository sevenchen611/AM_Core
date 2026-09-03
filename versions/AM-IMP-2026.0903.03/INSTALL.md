# Install — AM-IMP-2026.0903.03

1. Deploy the contract-action-task-bridge module with the Engineering contract control-state reducer.
2. In each project-local task adapter, call deriveEngineeringContractActionTaskIntent only after reading the authoritative contract control state.
3. Pass the project-local tenant key, project id, contract id, current project goal, and the source evidence that caused the action.
4. Treat operation deduplicated as no task write.
5. Treat formalizationStatus candidate as a review item. Do not promote it until the project goal and source evidence are attached.
6. The receiving adapter, not this package, may create or update a task. It must retain idempotency key, semantic key, state fingerprint, and status-change evidence.

Do not configure this bridge to infer a project goal, fabricate evidence, send reminders, or automatically close contractual tasks.
