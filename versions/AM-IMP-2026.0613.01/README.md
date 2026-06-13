# AM-IMP-2026.0613.01 OpenAI Codex CLI LLM backend

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.01.md`.

## Summary

OpenAI Codex CLI LLM backend: a third pluggable backend (`LLM_BACKEND=codex`) running `codex exec` headlessly on the ChatGPT subscription quota, alongside `api` (Anthropic metered) and `claude-code` (Claude subscription). Enables the engine A/B test: SevenAM on Claude vs HOZO AM on OpenAI Codex with identical prompts, schemas, and calibration rules.

## Changes

- `src/llm-backend.js`: `createCodexBackend` + `runCodex` (prompt via stdin, final message via `-o` temp file, `--sandbox read-only --skip-git-repo-check`, OPENAI_API_KEY stripped from the child env to force subscription auth) + `codexSelfTest`. Optional `CODEX_MODEL` override.
- `scripts/local-worker.js`: backend selector `*_WORKER_LLM_BACKEND` (codex | claude-code) drives self-test and child `LLM_BACKEND`.
- Codex CLI installed globally via npm; auth via `codex login` (ChatGPT account).

## Type

Architecture / LLM backend

## Project Status At Backfill

- HOZO AM: Deployed
- 7AM: Ready

## Registry Note

Third pluggable backend (codex exec, ChatGPT subscription quota) with worker backend selector; enables Claude-vs-OpenAI engine A/B with identical prompts and rules.
