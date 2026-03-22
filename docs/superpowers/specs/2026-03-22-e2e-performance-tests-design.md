---
name: E2E and Performance Tests Design
description: Design spec for adding e2e error/multi-agent tests and CLI latency benchmarks to agent-comm
type: spec
status: approved
date: 2026-03-22
---

# E2E and Performance Tests Design

**Date:** 2026-03-22
**Status:** Approved

## Overview

Extend the existing test suite with:
1. **E2E error tests** — edge cases and invalid paths
2. **E2E multi-agent tests** — realistic multi-agent coordination scenarios
3. **Performance latency benchmarks** — CLI command timing with loose p95 thresholds

The existing `tests/e2e/workflow.test.ts` (happy-path workflow) is unchanged in logic — only its inline `run()` function is refactored to import from `helpers.ts`.

---

## 1. File Structure

```
tests/
├── e2e/
│   ├── helpers.ts             # NEW — shared run() helper extracted from workflow.test.ts
│   ├── workflow.test.ts       # existing — happy path (run() refactored to use helpers.ts)
│   ├── errors.test.ts         # NEW — error paths & edge cases
│   └── multi-agent.test.ts   # NEW — multi-agent scenarios
└── perf/
    └── latency.test.ts        # NEW — CLI latency benchmarks
```

---

## 2. Shared Helper — `tests/e2e/helpers.ts`

Extracted from `workflow.test.ts`. The `run()` signature accepts an optional `env` override to support multi-agent tests where different agents have different `AC_AUTHOR` values:

```ts
export async function run(
  dir: string,
  args: string[],
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }>
```

Default env includes `AC_AUTHOR: "test-agent"`. The `env` parameter is **shallow-merged on top of `process.env`** (i.e., `{ ...process.env, ...env }`), not a full replacement — the subprocess needs `PATH`, `HOME`, etc. Callers override `env` to simulate different agents:

```ts
// Simulate agent-a
await run(dir, ["create", "note", "--title", "Handoff"], { AC_AUTHOR: "agent-a" });
// Simulate agent-b
await run(dir, ["feed", "--channel", "handoff", "--json"], { AC_AUTHOR: "agent-b" });
```

`workflow.test.ts` is updated to use `import { run } from "./helpers"` instead of its inline `run()` definition. No test logic changes.

---

## 3. `errors.test.ts` — Error Paths & Edge Cases

Each scenario is a separate `test()` with its own temp dir via `beforeEach`/`afterEach`. All tests call `init` first unless the scenario is specifically testing the missing-init case.

| Scenario | What we test | Assertion |
|---|---|---|
| Invalid state transition | `complete` a `draft` task (skipping `open` and `in_progress`) | exit code 1, stderr contains `"Invalid transition"` |
| Non-existent ID | `show msg_doesnotexist` | exit code 2 |
| Show without init | `show` in a dir with no `.agent-comm/` | exit code 1, stderr non-empty |
| Double archive | `archive` an already-archived message | exit code 0 or 1 (document actual behavior) |
| Sync: markdown newer wins | Edit markdown file with a `updated_at` timestamp newer than SQLite, run `ac sync` | `show --json` reflects the edited field |
| Sync: markdown older ignored | Edit markdown file but keep `updated_at` equal to SQLite value, run `ac sync` | `show --json` still shows original value |
| Sync: malformed markdown | Write an invalid markdown file (no frontmatter) inside a type subdirectory (e.g., `messages/task/bad.md`) — `syncFromMarkdown()` only iterates subdirectories of `messages/`, so placement matters — then run `ac sync` | command exits 0, stdout contains `"conflicts"` with count > 0 |
| Malformed `--metadata` | Pass `--metadata 'not-json'` to `create` | exit code 1 |

**Notes on sync behavior** (from `src/core/sync.ts`):
- `syncFromMarkdown()` applies markdown changes only when `mdMsg.updated_at > dbMsg.updated_at`. Markdown wins when newer; no-op when same or older.
- Malformed files (parse errors) increment the `conflicts` counter but do not crash the process. No `.conflict.md` files are created — that is a future feature not yet implemented.

---

## 4. `multi-agent.test.ts` — Multi-Agent Scenarios

Three `describe` blocks. Each uses a single temp dir initialized in `beforeEach`. Different agents are simulated by passing `{ AC_AUTHOR: "..." }` to the `run()` helper.

### Scenario 1: Command / Pickup Pattern

Simulates an orchestrator posting a command and a worker agent executing it.

- Orchestrator creates a `command` message on a `commands` channel
  - Note: `command` type starts as `open` (not `draft`) per default config
- Agent polls via `feed --channel commands --json`, finds the command
- Agent calls `start <id>` (transitions `open → in_progress`)
- Agent calls `complete <id> --metadata '{"result": "done"}'`
- Orchestrator calls `show <id> --json`
- Assert: `status === "completed"`, `metadata.result === "done"`

### Scenario 2: Context Handoff

Simulates agent A passing context to agent B via a note with a follow-up task.

- Agent A creates a `note` on a `handoff` channel with session context in body
  - Note: `note` type starts as `open` and has no completion lifecycle (`open → cancelled` only — do not attempt `start` or `complete`)
- Agent B reads via `feed --channel handoff --json`, finds the note by title
- Agent B creates a `task` with `--refs <note-id>`
- Verify `thread <task-id> --json` response — the response is an object `{ message, children, refs }`. Assert that the `refs` array contains an entry whose `id === <note-id>`.

### Scenario 3: Plan → Task Breakdown + Session Resume

Simulates orchestrator-created work and an agent picking it up after a "restart" (no in-memory state).

- Orchestrator creates a `plan` + 3 `task` messages under it (all tasks start as `draft`)
- "Agent restarts": new `run()` calls simulate a fresh process with no prior state
- Agent calls `list --type task --status draft --json` — assert 3 tasks returned
- Agent transitions each task: `update --status open` → `start` → `complete`
- Verify `children <plan-id> --json` returns 3 tasks all with `status === "completed"`
- Call `feed --since <timestamp-before-plan-creation> --json` — assert all messages returned
- Call `feed --since <timestamp-after-plan-creation> --json` — assert only task messages returned

---

## 5. `latency.test.ts` — CLI Latency Benchmarks

### `benchmark()` Helper

```ts
async function benchmark(
  label: string,
  fn: () => Promise<void>,
  iterations: number
): Promise<{ p50: number; p95: number }>
```

- Runs `fn()` N times, collects durations via `performance.now()`
- Logs p50 and p95 to console for observability
- Returns `{ p50, p95 }`
- Only p95 is asserted in `expect()`. p50 is logged only (no assertion).

### Pre-benchmark Setup

All benchmarks share a single temp dir initialized once in `beforeAll` (not `beforeEach`). The `list` benchmark pre-seeds 10 messages in `beforeAll` before the benchmark loop begins — seeding is excluded from timing. Each `benchmark()` call measures only the target command.

For `init`: each iteration runs in a **separate fresh temp directory** (created inside `fn()`) to measure cold-init performance, not the idempotent re-init no-op.

### Benchmarked Commands

| Command | Iterations | p95 threshold | Notes |
|---|---|---|---|
| `init` | 5 | 2000ms | Fresh dir per iteration |
| `create task` | 10 | 500ms | |
| `show <id>` | 10 | 300ms | |
| `list` (10 messages pre-seeded) | 10 | 300ms | Seed once in beforeAll |
| `update --status open` | 10 | 500ms | |
| `sync` | 5 | 1000ms | |

Thresholds are intentionally generous — Bun startup dominates at this stage. Primary value is establishing a baseline. Tighten as the project matures.

---

## 6. Non-Goals

- No scale/load testing (large message counts) — deferred
- No CI integration setup — out of scope for this spec
- No changes to `workflow.test.ts` test logic — only `run()` is refactored to import from helpers
