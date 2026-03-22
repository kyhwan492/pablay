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
      { PABLAY_AUTHOR: "orchestrator" }
    );
    expect(create.exitCode).toBe(0);
    const cmdId = create.stdout;

    // Worker polls the channel and finds the command
    const feed = await run(
      TEST_DIR,
      ["feed", "--channel", "commands", "--json"],
      { PABLAY_AUTHOR: "worker" }
    );
    const msgs = JSON.parse(feed.stdout);
    expect(msgs.find((m: any) => m.id === cmdId)).toBeDefined();

    // Worker starts the command (open → in_progress)
    const startResult = await run(TEST_DIR, ["start", cmdId], { PABLAY_AUTHOR: "worker" });
    expect(startResult.exitCode).toBe(0);

    // Worker completes the command with result metadata
    const completeResult = await run(
      TEST_DIR,
      ["complete", cmdId, "--metadata", '{"result":"all 42 tests passed"}'],
      { PABLAY_AUTHOR: "worker" }
    );
    expect(completeResult.exitCode).toBe(0);

    // Orchestrator verifies completion
    const show = await run(TEST_DIR, ["show", cmdId, "--json"], { PABLAY_AUTHOR: "orchestrator" });
    const msg = JSON.parse(show.stdout);
    expect(msg.status).toBe("completed");
    expect(msg.metadata.result).toBe("all 42 tests passed");
  });
});

describe("context handoff", () => {
  test("agent A leaves a note, agent B creates a follow-up task referencing it", async () => {
    await run(TEST_DIR, ["init"]);

    // Agent A creates a note on the handoff channel
    // note type starts as "open"; no completion lifecycle (open → cancelled only)
    const noteCreate = await run(
      TEST_DIR,
      ["create", "note", "--title", "Handoff: auth context",
       "--body", "Session context for agent-b", "--channel", "handoff"],
      { PABLAY_AUTHOR: "agent-a" }
    );
    expect(noteCreate.exitCode).toBe(0);
    const noteId = noteCreate.stdout;

    // Agent B reads the handoff channel and finds the note
    const feed = await run(
      TEST_DIR,
      ["feed", "--channel", "handoff", "--json"],
      { PABLAY_AUTHOR: "agent-b" }
    );
    const msgs = JSON.parse(feed.stdout);
    expect(msgs.find((m: any) => m.id === noteId)).toBeDefined();

    // Agent B creates a task referencing the note
    const taskCreate = await run(
      TEST_DIR,
      ["create", "task", "--title", "Implement auth from handoff", "--refs", noteId],
      { PABLAY_AUTHOR: "agent-b" }
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
      { PABLAY_AUTHOR: "orchestrator" }
    );
    const planId = planCreate.stdout;

    const task1 = await run(TEST_DIR, ["create", "task", "--title", "Task A", "--parent", planId], { PABLAY_AUTHOR: "orchestrator" });
    const task2 = await run(TEST_DIR, ["create", "task", "--title", "Task B", "--parent", planId], { PABLAY_AUTHOR: "orchestrator" });
    const task3 = await run(TEST_DIR, ["create", "task", "--title", "Task C", "--parent", planId], { PABLAY_AUTHOR: "orchestrator" });

    const afterPlan = new Date().toISOString();

    // --- Simulated agent restart: no in-memory state, all info from CLI ---

    // Agent discovers open tasks (tasks start as "draft")
    const draftList = await run(TEST_DIR, ["list", "--type", "task", "--status", "draft", "--json"]);
    const drafts = JSON.parse(draftList.stdout);
    expect(drafts).toHaveLength(3);

    // Agent progresses each task through the full lifecycle
    for (const taskResult of [task1, task2, task3]) {
      const id = taskResult.stdout;
      await run(TEST_DIR, ["update", id, "--status", "open"], { PABLAY_AUTHOR: "worker" });
      await run(TEST_DIR, ["start", id], { PABLAY_AUTHOR: "worker" });
      await run(TEST_DIR, ["complete", id], { PABLAY_AUTHOR: "worker" });
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
