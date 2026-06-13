# Install AM-IMP-2026.0613.01

This package was backfilled from a production upgrade record. Install it into a
target project (HOZO_AM, SevenAM, or a future AM project) by reproducing the changes
below in that project only. Never copy another project's secrets or data.

Authoritative source record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.01.md`.

## Changes To Apply

- `src/llm-backend.js`: `createCodexBackend` + `runCodex` (prompt via stdin, final message via `-o` temp file, `--sandbox read-only --skip-git-repo-check`, OPENAI_API_KEY stripped from the child env to force subscription auth) + `codexSelfTest`. Optional `CODEX_MODEL` override.
- `scripts/local-worker.js`: backend selector `*_WORKER_LLM_BACKEND` (codex | claude-code) drives self-test and child `LLM_BACKEND`.
- Codex CLI installed globally via npm; auth via `codex login` (ChatGPT account).

## Environment Variables (names only)

- `LLM_BACKEND`
- `CODEX_MODEL`
- `HOZO_WORKER_LLM_BACKEND`
- `SEVEN_WORKER_LLM_BACKEND`

## Data Isolation Check

Backend change only; no data sources touched.
