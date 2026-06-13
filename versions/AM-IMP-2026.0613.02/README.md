# AM-IMP-2026.0613.02 Worker wrapper OS-level log redirection

> Backfilled package. This improvement was implemented and tracked inside the
> production projects first; AMCore now holds it so the version master is complete.
> Authoritative upgrade record: 7AM `UPGRADE-2026-06-13-AM-IMP-2026.0613.02.md`.

## Summary

Worker wrapper OS-level log redirection: `start-local-worker.ps1` must not pipe node output through PowerShell (`Tee-Object` or pwsh `>`/`>>` operators). When that object pipeline stalls, node's stdout pipe fills, console.log blocks, and the whole worker freezes silently (no self-test result, no timeout, no children — observed live on 2026-06-12). The wrapper now uses `cmd /c "node ... >> log 2>&1"` so the OS owns the file append.

## Changes

- `scripts/start-local-worker.ps1` (both projects): `& cmd /c "node scripts/local-worker.js >> \"$logFile\" 2>&1"` replaces the Tee-Object pipeline; warning comment documents the pitfall.

## Type

Reliability (incident fix)

## Project Status At Backfill

- HOZO AM: Deployed
- 7AM: Deployed

## Registry Note

Never pipe worker output through PowerShell (Tee-Object / pwsh redirects): a stalled pipeline blocks node stdout and freezes the worker silently. Wrappers use cmd /c append redirection.
