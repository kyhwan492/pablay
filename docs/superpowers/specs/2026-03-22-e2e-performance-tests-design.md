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

The existing `tests/e2e/workflow.test.ts` (happy-path workflow) is unchanged.

---

## 1. File Structure

```
tests/
├── e2e/
│   ├── helpers.ts             # NEW — shared run() helper extracted from workflow.test.ts
│   ├── workflow.test.ts       # existing — happy path (unchanged)
│   ├── errors.test.ts         # NEW — error paths & edge cases
│   └── multi-agent.test.ts    # NEW — multi-agent scenarios
└── perf/
    └── latency.test.ts        # NEW — CLI latency benchmarks
```

The `run()` helper (temp dir + `Bun.spawn`) is extracted to `tests/e2e/helpers.ts` so all e2e files share it without duplication.

---

## 2. `errors.test.ts` — Error Paths & Edge Cases

| Scenario | What we test |
|---|---|
| Invalid state transition | `complete` a `draft` task → exit code 1, stderr message |
| Non-existent ID | `show msg_doesnotexist` → exit code 2 |
| `show` without init | Run `show` in a dir with no `.agent-comm/` → exit code 1, helpful error |
| Double archive | `archive` an already-archived message → graceful (idempotent or clear error) |
| Sync conflict | Edit markdown frontmatter directly, run `ac sync` → SQLite wins, `.conflict.md` created |
| Malformed `--metadata` | Pass invalid JSON to `--metadata` → exit code 1 |

Each scenario is a separate `test()` with its own `beforeEach`/`afterEach` temp dir lifecycle (via helpers).

---

## 3. `multi-agent.test.ts` — Multi-Agent Scenarios

Three `describe` blocks, each simulating realistic agent coordination:

### Scenario 1: Command / Pickup Pattern
- Orchestrator creates a `command` message on a `commands` channel
- Agent polls via `feed --channel commands --json`, finds the command
- Agent `start`s it, completes it with result metadata
- Orchestrator verifies completion via `show --json`

### Scenario 2: Context Handoff
- Agent A creates a `note` on a `handoff` channel with session context in body
- Agent B reads via `feed --channel handoff --json`, finds the note
- Agent B creates a follow-up `task` referencing the note via `--refs`
- Verify `thread` on the task shows the referenced note

### Scenario 3: Plan → Task Breakdown + Session Resume
- Orchestrator creates plan + 3 tasks under it
- Simulate "agent restart": new `run()` calls with no in-memory state
- Agent lists open tasks via `list --type task --status draft --json`
- Agent progresses each task to completion
- Verify all children completed via `children --json`
- `feed --since <timestamp>` returns only messages after that timestamp

---

## 4. `latency.test.ts` — CLI Latency Benchmarks

### `benchmark()` Helper

```ts
async function benchmark(
  label: string,
  fn: () => Promise<void>,
  iterations = 10
): Promise<{ p50: number; p95: number }>
```

- Runs `fn()` N times, collects durations via `performance.now()`
- Reports p50 and p95 to console (always visible, not suppressed)
- Returns `{ p50, p95 }` for threshold assertions

### Benchmarked Commands

| Command | Iterations | p95 threshold |
|---|---|---|
| `init` | 5 | 2000ms |
| `create task` | 10 | 500ms |
| `show <id>` | 10 | 300ms |
| `list` (10 messages pre-seeded) | 10 | 300ms |
| `update --status open` | 10 | 500ms |
| `sync` | 5 | 1000ms |

Thresholds are intentionally generous — Bun startup dominates at this stage. The primary value is establishing a baseline. Thresholds can be tightened as the project matures.

---

## 5. Shared Helper — `tests/e2e/helpers.ts`

Extracted from `workflow.test.ts`:

```ts
export async function run(
  dir: string,
  ...args: string[]
): Promise<{ stdout: string; stderr: string; exitCode: number }>
```

The `workflow.test.ts` file will be updated to import from `helpers.ts` rather than defining `run()` inline.

---

## 6. Non-Goals

- No scale/load testing (large message counts) — deferred
- No CI integration setup — out of scope for this spec
- No changes to `workflow.test.ts` logic — only refactor `run()` to helpers
