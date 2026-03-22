# E2E and Performance Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add e2e error/multi-agent tests and CLI latency benchmarks to the agent-comm test suite.

**Architecture:** Extract the shared `run()` helper into `tests/e2e/helpers.ts`, then add `errors.test.ts` (8 edge-case scenarios), `multi-agent.test.ts` (3 coordination scenarios), and `tests/perf/latency.test.ts` (6 CLI command benchmarks with p95 assertions).

**Tech Stack:** Bun, bun:test, TypeScript, Bun.spawn (real CLI subprocess invocation), performance.now()

---

## Chunk 1: Shared Helper Extraction

### Task 1: Create `tests/e2e/helpers.ts`

**Files:**
- Create: `tests/e2e/helpers.ts`
- Modify: `tests/e2e/workflow.test.ts` (import helper, remove inline `run()`)

- [ ] **Step 1: Create `tests/e2e/helpers.ts`**

```ts
import { join } from "path";

const CLI = join(import.meta.dir, "../../src/cli/index.ts");

export async function run(
  dir: string,
  args: string[],
  env?: Record<string, string>
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: dir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, AC_AUTHOR: "test-agent", ...env },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}
```

- [ ] **Step 2: Refactor `tests/e2e/workflow.test.ts` to use the helper**

Replace the file's top section. Remove the `const CLI = ...` line and the inline `run()` function. Add an import. The test logic is unchanged.

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { run } from "./helpers";

const TEST_DIR = join(import.meta.dir, ".tmp-e2e-test");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});
```

Note: `workflow.test.ts` calls `run()` as `run("init")` (spread args), but the new helper signature is `run(dir, args[])`. Update every call in the file:

- `run("init")` → `run(TEST_DIR, ["init"])`
- `run("create", "plan", ...)` → `run(TEST_DIR, ["create", "plan", ...])`
- `run("children", planId, "--json")` → `run(TEST_DIR, ["children", planId, "--json"])`
- etc. — apply to all `run(...)` calls in the file

- [ ] **Step 3: Run the existing workflow test to confirm it still passes**

```bash
cd /Users/yonghwan/Documents/Dev/agent-comm && bun test tests/e2e/workflow.test.ts
```

Expected: `1 pass, 0 fail`

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/helpers.ts tests/e2e/workflow.test.ts
git commit -m "refactor: extract run() helper from workflow.test.ts into helpers.ts"
```

---

## Chunk 2: Error Tests

### Task 2: Create `tests/e2e/errors.test.ts`

**Files:**
- Create: `tests/e2e/errors.test.ts`

- [ ] **Step 1: Create the file with test scaffolding and first two tests**

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { run } from "./helpers";

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = join(import.meta.dir, `.tmp-errors-${Date.now()}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("error handling", () => {
  test("invalid state transition: complete a draft task → exit 1", async () => {
    await run(TEST_DIR, ["init"]);
    const create = await run(TEST_DIR, ["create", "task", "--title", "My task"]);
    const id = create.stdout;
    // task starts as "draft"; jumping straight to "completed" is not allowed
    const result = await run(TEST_DIR, ["complete", id]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Invalid transition");
  });

  test("non-existent ID → exit 2", async () => {
    await run(TEST_DIR, ["init"]);
    const result = await run(TEST_DIR, ["show", "msg_doesnotexist"]);
    expect(result.exitCode).toBe(2);
  });
});
```

- [ ] **Step 2: Run to verify these two pass**

```bash
bun test tests/e2e/errors.test.ts
```

Expected: `2 pass, 0 fail`

- [ ] **Step 3: Add remaining 6 tests to the `describe` block**

```ts
  test("show without init → exit 1 with helpful message", async () => {
    // TEST_DIR has no .agent-comm/ — do not run init
    const result = await run(TEST_DIR, ["show", "msg_anything"]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  test("double archive → exit 1 (terminal state)", async () => {
    await run(TEST_DIR, ["init"]);
    const create = await run(TEST_DIR, ["create", "task", "--title", "To archive"]);
    const id = create.stdout;
    await run(TEST_DIR, ["archive", id]);
    // Second archive: fromStatus is "archived" → validateTransition throws
    const result = await run(TEST_DIR, ["archive", id]);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("terminal state");
  });

  test("sync: markdown newer than SQLite → markdown wins", async () => {
    await run(TEST_DIR, ["init"]);
    const create = await run(TEST_DIR, ["create", "task", "--title", "Original title"]);
    const id = create.stdout;

    // Read the markdown file and overwrite with a newer updated_at and changed title
    const mdPath = join(TEST_DIR, ".agent-comm", "messages", "task", `${id}.md`);
    const content = Bun.file(mdPath);
    const original = await content.text();

    // Bump the timestamp by 10 seconds and change the title in the frontmatter
    const future = new Date(Date.now() + 10000).toISOString();
    const updated = original
      .replace(/title: .+/, "title: Updated title")
      .replace(/updated_at: .+/, `updated_at: ${future}`);
    writeFileSync(mdPath, updated, "utf-8");

    await run(TEST_DIR, ["sync"]);

    const show = await run(TEST_DIR, ["show", id, "--json"]);
    const msg = JSON.parse(show.stdout);
    expect(msg.title).toBe("Updated title");
  });

  test("sync: markdown same updated_at as SQLite → no change", async () => {
    await run(TEST_DIR, ["init"]);
    const create = await run(TEST_DIR, ["create", "task", "--title", "Stable title"]);
    const id = create.stdout;

    const mdPath = join(TEST_DIR, ".agent-comm", "messages", "task", `${id}.md`);
    const original = await Bun.file(mdPath).text();

    // Change the title but keep updated_at the same (no bump → markdown is not newer)
    const tampered = original.replace(/title: .+/, "title: Tampered title");
    writeFileSync(mdPath, tampered, "utf-8");

    await run(TEST_DIR, ["sync"]);

    const show = await run(TEST_DIR, ["show", id, "--json"]);
    const msg = JSON.parse(show.stdout);
    expect(msg.title).toBe("Stable title");
  });

  test("sync: malformed markdown in type subdir → exits 0, reports conflicts", async () => {
    await run(TEST_DIR, ["init"]);
    await run(TEST_DIR, ["create", "task", "--title", "Real task"]);

    // Place a file with no frontmatter inside the task type subdirectory
    const taskDir = join(TEST_DIR, ".agent-comm", "messages", "task");
    writeFileSync(join(taskDir, "bad.md"), "no frontmatter here", "utf-8");

    const result = await run(TEST_DIR, ["sync"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("conflicts");
    // Extract the conflict count from "Synced: N updated, N conflicts"
    const match = result.stdout.match(/(\d+) conflicts/);
    expect(match).not.toBeNull();
    expect(parseInt(match![1])).toBeGreaterThan(0);
  });

  test("malformed --metadata → exit 1", async () => {
    await run(TEST_DIR, ["init"]);
    const result = await run(TEST_DIR, ["create", "task", "--title", "Test", "--metadata", "not-json"]);
    expect(result.exitCode).toBe(1);
  });
```

- [ ] **Step 4: Run all 8 tests**

```bash
bun test tests/e2e/errors.test.ts
```

Expected: `8 pass, 0 fail`

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/errors.test.ts
git commit -m "test: add e2e error/edge-case tests"
```

---

## Chunk 3: Multi-Agent Tests

### Task 3: Create `tests/e2e/multi-agent.test.ts`

**Files:**
- Create: `tests/e2e/multi-agent.test.ts`

- [ ] **Step 1: Create the file with Scenario 1 (Command / Pickup)**

```ts
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { run } from "./helpers";

let TEST_DIR: string;

beforeEach(() => {
  TEST_DIR = join(import.meta.dir, `.tmp-multiagent-${Date.now()}`);
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("command / pickup pattern", () => {
  test("orchestrator posts a command, worker picks it up and completes it", async () => {
    await run(TEST_DIR, ["init"]);

    // Orchestrator posts command (command type starts as "open" — not "draft")
    const create = await run(
      TEST_DIR,
      ["create", "command", "--title", "Run test suite", "--channel", "commands",
       "--metadata", '{"to":"worker-agent","args":["--coverage"]}'],
      { AC_AUTHOR: "orchestrator" }
    );
    expect(create.exitCode).toBe(0);
    const cmdId = create.stdout;

    // Worker polls the channel and finds the command
    const feed = await run(
      TEST_DIR,
      ["feed", "--channel", "commands", "--json"],
      { AC_AUTHOR: "worker" }
    );
    const msgs = JSON.parse(feed.stdout);
    expect(msgs.find((m: any) => m.id === cmdId)).toBeDefined();

    // Worker starts the command (open → in_progress)
    const startResult = await run(TEST_DIR, ["start", cmdId], { AC_AUTHOR: "worker" });
    expect(startResult.exitCode).toBe(0);

    // Worker completes the command with result metadata
    const completeResult = await run(
      TEST_DIR,
      ["complete", cmdId, "--metadata", '{"result":"all 42 tests passed"}'],
      { AC_AUTHOR: "worker" }
    );
    expect(completeResult.exitCode).toBe(0);

    // Orchestrator verifies completion
    const show = await run(TEST_DIR, ["show", cmdId, "--json"], { AC_AUTHOR: "orchestrator" });
    const msg = JSON.parse(show.stdout);
    expect(msg.status).toBe("completed");
    expect(msg.metadata.result).toBe("all 42 tests passed");
  });
});
```

- [ ] **Step 2: Run Scenario 1**

```bash
bun test tests/e2e/multi-agent.test.ts
```

Expected: `1 pass, 0 fail`

- [ ] **Step 3: Add Scenario 2 (Context Handoff)**

```ts
describe("context handoff", () => {
  test("agent A leaves a note, agent B creates a follow-up task referencing it", async () => {
    await run(TEST_DIR, ["init"]);

    // Agent A creates a note on the handoff channel
    // note type starts as "open"; no completion lifecycle (open → cancelled only)
    const noteCreate = await run(
      TEST_DIR,
      ["create", "note", "--title", "Handoff: auth context",
       "--body", "Session context for agent-b", "--channel", "handoff"],
      { AC_AUTHOR: "agent-a" }
    );
    expect(noteCreate.exitCode).toBe(0);
    const noteId = noteCreate.stdout;

    // Agent B reads the handoff channel and finds the note
    const feed = await run(
      TEST_DIR,
      ["feed", "--channel", "handoff", "--json"],
      { AC_AUTHOR: "agent-b" }
    );
    const msgs = JSON.parse(feed.stdout);
    expect(msgs.find((m: any) => m.id === noteId)).toBeDefined();

    // Agent B creates a task referencing the note
    const taskCreate = await run(
      TEST_DIR,
      ["create", "task", "--title", "Implement auth from handoff", "--refs", noteId],
      { AC_AUTHOR: "agent-b" }
    );
    expect(taskCreate.exitCode).toBe(0);
    const taskId = taskCreate.stdout;

    // Verify: thread on the task should include the note in the refs array
    const thread = await run(TEST_DIR, ["thread", taskId, "--json"]);
    const threadData = JSON.parse(thread.stdout);
    // thread response shape: { message, children, refs }
    expect(Array.isArray(threadData.refs)).toBe(true);
    expect(threadData.refs.find((r: any) => r.id === noteId)).toBeDefined();
  });
});
```

- [ ] **Step 4: Run Scenarios 1 + 2**

```bash
bun test tests/e2e/multi-agent.test.ts
```

Expected: `2 pass, 0 fail`

- [ ] **Step 5: Add Scenario 3 (Plan → Task Breakdown + Session Resume)**

```ts
describe("plan → task breakdown + session resume", () => {
  test("orchestrator creates plan+tasks, agent resumes from scratch and completes all", async () => {
    await run(TEST_DIR, ["init"]);

    // Record a timestamp before plan creation for feed --since tests
    const beforePlan = new Date().toISOString();

    // Small delay to ensure created_at is after beforePlan (50ms for CI reliability)
    await Bun.sleep(50);

    // Orchestrator creates plan + 3 tasks
    const planCreate = await run(
      TEST_DIR,
      ["create", "plan", "--title", "Q2 Roadmap", "--channel", "planning"],
      { AC_AUTHOR: "orchestrator" }
    );
    const planId = planCreate.stdout;

    const task1 = await run(TEST_DIR, ["create", "task", "--title", "Task A", "--parent", planId], { AC_AUTHOR: "orchestrator" });
    const task2 = await run(TEST_DIR, ["create", "task", "--title", "Task B", "--parent", planId], { AC_AUTHOR: "orchestrator" });
    const task3 = await run(TEST_DIR, ["create", "task", "--title", "Task C", "--parent", planId], { AC_AUTHOR: "orchestrator" });

    const afterPlan = new Date().toISOString();

    // --- Simulated agent restart: no in-memory state, all info from CLI ---

    // Agent discovers open tasks (tasks start as "draft")
    const draftList = await run(TEST_DIR, ["list", "--type", "task", "--status", "draft", "--json"]);
    const drafts = JSON.parse(draftList.stdout);
    expect(drafts).toHaveLength(3);

    // Agent progresses each task through the full lifecycle
    for (const taskResult of [task1, task2, task3]) {
      const id = taskResult.stdout;
      await run(TEST_DIR, ["update", id, "--status", "open"], { AC_AUTHOR: "worker" });
      await run(TEST_DIR, ["start", id], { AC_AUTHOR: "worker" });
      await run(TEST_DIR, ["complete", id], { AC_AUTHOR: "worker" });
    }

    // All children of the plan should be completed
    const children = await run(TEST_DIR, ["children", planId, "--json"]);
    const childList = JSON.parse(children.stdout);
    expect(childList).toHaveLength(3);
    expect(childList.every((t: any) => t.status === "completed")).toBe(true);

    // feed --since beforePlan includes plan + all tasks (at least 4 messages)
    const feedAll = await run(TEST_DIR, ["feed", "--since", beforePlan, "--json"]);
    const allMsgs = JSON.parse(feedAll.stdout);
    expect(allMsgs.length).toBeGreaterThanOrEqual(4);

    // feed --since afterPlan includes only task messages (created after plan)
    const feedAfter = await run(TEST_DIR, ["feed", "--since", afterPlan, "--json"]);
    const afterMsgs = JSON.parse(feedAfter.stdout);
    expect(afterMsgs.every((m: any) => m.type === "task")).toBe(true);
  });
});
```

- [ ] **Step 6: Run all 3 scenarios**

```bash
bun test tests/e2e/multi-agent.test.ts
```

Expected: `3 pass, 0 fail`

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/multi-agent.test.ts
git commit -m "test: add e2e multi-agent coordination tests"
```

---

## Chunk 4: Performance Latency Benchmarks

### Task 4: Create `tests/perf/latency.test.ts`

**Files:**
- Create: `tests/perf/latency.test.ts`

- [ ] **Step 1: Create the file with the `benchmark()` helper and `init` benchmark**

```ts
import { describe, expect, test, beforeAll, afterAll } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { run } from "../e2e/helpers";

// ─── benchmark helper ────────────────────────────────────────────────────────

async function benchmark(
  label: string,
  fn: () => Promise<void>,
  iterations: number
): Promise<{ p50: number; p95: number }> {
  const durations: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    durations.push(performance.now() - start);
  }
  durations.sort((a, b) => a - b);
  const n = durations.length;
  const p50 = durations[Math.floor(n * 0.5)];
  const p95 = durations[Math.min(Math.ceil(n * 0.95) - 1, n - 1)];
  console.log(`[perf] ${label}: p50=${p50.toFixed(0)}ms  p95=${p95.toFixed(0)}ms`);
  return { p50, p95 };
}

// ─── shared temp dir (init once, reused for all benchmarks except "init") ────

let BENCH_DIR: string;

beforeAll(async () => {
  BENCH_DIR = join(import.meta.dir, ".tmp-perf");
  mkdirSync(BENCH_DIR, { recursive: true });
  await run(BENCH_DIR, ["init"]);

  // Pre-seed 10 messages for the list benchmark
  for (let i = 0; i < 10; i++) {
    await run(BENCH_DIR, ["create", "task", "--title", `Seeded task ${i}`]);
  }
});

afterAll(() => {
  if (BENCH_DIR) rmSync(BENCH_DIR, { recursive: true, force: true });
});

// ─── benchmarks ──────────────────────────────────────────────────────────────

describe("CLI latency benchmarks", () => {
  test("init (cold, fresh dir per iteration) — p95 < 2000ms", async () => {
    const { p95 } = await benchmark(
      "init",
      async () => {
        const dir = join(import.meta.dir, `.tmp-init-${Date.now()}-${Math.random()}`);
        mkdirSync(dir, { recursive: true });
        try {
          await run(dir, ["init"]);
        } finally {
          rmSync(dir, { recursive: true, force: true });
        }
      },
      5
    );
    expect(p95).toBeLessThan(2000);
  });
});
```

- [ ] **Step 2: Run to verify the init benchmark passes**

```bash
bun test tests/perf/latency.test.ts
```

Expected: `1 pass, 0 fail` — also observe the p50/p95 log line

- [ ] **Step 3: Add remaining 5 benchmarks to the `describe` block**

```ts
  test("create task — p95 < 500ms", async () => {
    const { p95 } = await benchmark(
      "create task",
      async () => {
        await run(BENCH_DIR, ["create", "task", "--title", "Benchmark task"]);
      },
      10
    );
    expect(p95).toBeLessThan(500);
  });

  test("show — p95 < 300ms", async () => {
    // Get a real message ID to show
    const create = await run(BENCH_DIR, ["create", "task", "--title", "Show target"]);
    const id = create.stdout;

    const { p95 } = await benchmark(
      "show",
      async () => {
        await run(BENCH_DIR, ["show", id, "--json"]);
      },
      10
    );
    expect(p95).toBeLessThan(300);
  });

  test("list (10 messages pre-seeded) — p95 < 300ms", async () => {
    // Messages were seeded in beforeAll — timing excludes seeding
    const { p95 } = await benchmark(
      "list",
      async () => {
        await run(BENCH_DIR, ["list", "--json"]);
      },
      10
    );
    expect(p95).toBeLessThan(300);
  });

  test("update --status open — p95 < 500ms", async () => {
    const { p95 } = await benchmark(
      "update",
      async () => {
        // Create a fresh draft task each iteration so status is always "draft → open"
        const create = await run(BENCH_DIR, ["create", "task", "--title", "Update target"]);
        const id = create.stdout;
        await run(BENCH_DIR, ["update", id, "--status", "open"]);
      },
      10
    );
    expect(p95).toBeLessThan(500);
  });

  test("sync — p95 < 1000ms", async () => {
    const { p95 } = await benchmark(
      "sync",
      async () => {
        await run(BENCH_DIR, ["sync"]);
      },
      5
    );
    expect(p95).toBeLessThan(1000);
  });
```

- [ ] **Step 4: Run all 6 benchmarks**

```bash
bun test tests/perf/latency.test.ts
```

Expected: `6 pass, 0 fail` — observe p50/p95 log lines for each command as your baseline

- [ ] **Step 5: Run the full test suite to confirm nothing is broken**

```bash
bun test
```

Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
git add tests/perf/latency.test.ts
git commit -m "test: add CLI latency benchmarks with p95 thresholds"
```

---

## Note on `update` benchmark timing

The `update` benchmark creates a new task per iteration, which means it measures `create + update` combined. This is intentional — isolating `update` alone would require pre-creating N tasks in `beforeAll`, which adds setup complexity. Since `create` is fast (< 500ms p95), the combined measurement is still a useful proxy for `update` latency. Separate `create` and `update` benchmarks can be split if more precision is needed later.
