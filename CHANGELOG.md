# Changelog

## 0.1.0-alpha - 2026-03-04

### Added

- Durable run state (`run.json`) with resume support (`run --resume <runId>`)
- Run lock (`run.lock`) to block duplicate execution on same runId
- Stage checkpointing for plan/implement/verify attempts
- Context incremental index cache (`.ohmyqwen/cache/context-index.json`)
- Context inspect CLI (`context inspect`)
- Executor safety enhancements:
  - command allowlist config (`config/commands.allowlist.json`)
  - workspace boundary protection
  - patch transactions + rollback helper
  - dry-run execution mode
  - `tools.log` JSONL runtime traces
- Verify intelligence:
  - verify profile support
  - failure category classifier
  - stable failure signature + summary artifacts
- Mode policies (`feature/refactor/medium/microservice/auto`) and clarification wait flow
- Plugin system with optional hooks and built-in plugins:
  - context-preload
  - gitlab-logs (graceful degrade)
- Localhost runtime console:
  - API (`/api/runs`, `/api/runs/:id`, `/events`, `/artifacts`)
  - minimal web UI (`web/index.html`, `web/app.js`)
- 운영/설계 문서 보강 (`MODES`, `PLUGINS`, `OPERATIONS`)
- Demo assets (`examples/sample-task.md`, `scripts/demo-run.sh`)

### Changed

- Runtime state graph extended with `WAIT_CLARIFICATION`
- Package version updated to `0.1.0-alpha`
- README updated for run/plan/verify/serve and failure artifact locations

### Tests

- Added tests for runner resume/idempotency, mode policy, verify profiles, plugins
- Extended context/executor/state-machine coverage
