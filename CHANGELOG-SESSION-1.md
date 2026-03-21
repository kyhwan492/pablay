# Session 1 Changelog — 2026-03-21

## What Was Built

`ac` (agent-comm) — a CLI-first async communication tool for agent teams.

## Documents Created

- **Spec:** `docs/superpowers/specs/2026-03-21-agent-comm-design.md` — fully reviewed (3 rounds, 24 issues fixed)
- **Plan:** `docs/superpowers/plans/2026-03-21-agent-comm.md` — 20 tasks across 6 chunks

## Implementation Status

### Completed (Tasks 1-6, 8-16)

All committed. **79 tests passing.** `bun test` runs clean.

| Layer | Files | Status |
|-------|-------|--------|
| Types | `src/types.ts` | Done |
| Config | `src/core/config.ts` | Done — scope resolution (walk-up), author precedence, default transitions |
| Message | `src/core/message.ts` | Done — ID generation, state machine validation, createMessage |
| Store | `src/core/store.ts` | Done — `bun:sqlite` (NOT better-sqlite3, Bun doesn't support it), WAL mode, CRUD, filters, state log, channels |
| Markdown | `src/core/markdown.ts` | Done — render/parse with YAML frontmatter, atomic file writes |
| Telemetry | `src/telemetry/{index,metrics,traces,logs}.ts` | Done — no-op when unconfigured, OTLP exporters when configured |
| CLI entry | `src/cli/index.ts` | Done — all commands registered |
| CLI commands | `src/cli/commands/{init,create,show,list,update,feed,thread,children,channels,log,sync,export}.ts` | Done — all written |
| Formatters | `src/cli/formatters/{text,json}.ts` | Done |

### NOT Done Yet

| Task | What's Missing |
|------|----------------|
| **Task 7: Sync engine** | `src/core/sync.ts` — NOT created yet. The CLI commands `create.ts`, `update.ts`, `sync.ts` import `SyncEngine` from `../../core/sync` but the file doesn't exist. This will cause runtime errors. |
| **Task 17: Wire telemetry into CLI** | Telemetry module exists but is not called from any CLI command yet |
| **Task 18: E2E integration test** | `tests/e2e/workflow.test.ts` not written |
| **Task 19: CLI executable verification** | `bun link` not tested |
| **Task 20: Final cleanup** | TypeScript check not run |

## Key Decisions / Gotchas

1. **`bun:sqlite` not `better-sqlite3`** — Bun doesn't support better-sqlite3. The store uses `bun:sqlite` which has a slightly different API (positional params with `?`, not named `@params`; `PRAGMA` returns object not scalar).

2. **`better-sqlite3` is still in package.json** — Can be removed since we don't use it. Same for `@types/better-sqlite3`.

3. **Sync engine is the critical blocker** — Must create `src/core/sync.ts` before the CLI can work end-to-end. The `create`, `update`, and `sync` commands import it.

4. **FeedFilters** — Changed from worker's version (which had `type`, `channel`, `author`) to spec-matching version (`channel`, `since`).

## Git Log

```
74674c0 feat: add store, markdown, telemetry, and CLI commands
3d48295 feat: add core types, config loader, and message state machine
66c3add chore: initialize Bun project with dependencies
0d58535 Add implementation plan for agent-comm (ac)
5fd5169 Add --add-ref/--remove-ref to ac update synopsis
a45b7ea Address all spec review findings (rounds 1 and 2)
a12d69e Add initial design spec for agent-comm (ac)
```

## Next Session: Resume Plan

1. Create `src/core/sync.ts` + `tests/core/sync.test.ts` (Task 7 from plan)
2. Wire telemetry into CLI commands (Task 17)
3. Write E2E integration test (Task 18)
4. Remove `better-sqlite3` from dependencies
5. Run `bun link` and test CLI end-to-end (Task 19)
6. TypeScript check + final cleanup (Task 20)
