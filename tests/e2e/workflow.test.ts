import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".tmp-e2e-test");
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

async function run(...args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    cwd: TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, AC_AUTHOR: "orchestrator" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("full agent workflow", () => {
  test("plan → tasks → execute → complete", async () => {
    // Init
    await run("init");

    // Orchestrator creates a plan
    const plan = await run("create", "plan", "--title", "Auth redesign", "--body", "Redesign the auth system", "--channel", "backend");
    expect(plan.exitCode).toBe(0);
    const planId = plan.stdout;

    // Orchestrator creates tasks under the plan
    const task1 = await run("create", "task", "--title", "Add JWT middleware", "--parent", planId, "--channel", "backend");
    const task1Id = task1.stdout;
    const task2 = await run("create", "task", "--title", "Write auth tests", "--parent", planId, "--channel", "backend");
    const task2Id = task2.stdout;

    // Verify children
    const children = await run("children", planId, "--json");
    const childList = JSON.parse(children.stdout);
    expect(childList).toHaveLength(2);

    // Agent picks up task 1: draft → open → in_progress → completed
    await run("update", task1Id, "--status", "open");
    await run("start", task1Id);
    await run("complete", task1Id, "--metadata", '{"result": "JWT middleware added"}');

    // Verify task 1 is completed
    const show1 = await run("show", task1Id, "--json");
    const msg1 = JSON.parse(show1.stdout);
    expect(msg1.status).toBe("completed");
    expect(msg1.metadata.result).toBe("JWT middleware added");

    // Check state log
    const log = await run("log", task1Id, "--json");
    const logEntries = JSON.parse(log.stdout);
    expect(logEntries.length).toBeGreaterThanOrEqual(3);

    // Verify markdown files exist
    expect(existsSync(join(TEST_DIR, ".agent-comm", "messages", "plan", `${planId}.md`))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".agent-comm", "messages", "task", `${task1Id}.md`))).toBe(true);

    // Check channels
    const channels = await run("channels", "--json");
    const chList = JSON.parse(channels.stdout);
    expect(chList.find((c: any) => c.channel === "backend")).toBeDefined();

    // Archive task 2 (no longer needed)
    await run("archive", task2Id);
    const list = await run("list", "--type", "task", "--json");
    const tasks = JSON.parse(list.stdout);
    expect(tasks.find((t: any) => t.id === task2Id)).toBeUndefined(); // excluded by default

    // Export
    const exported = await run("export");
    expect(exported.exitCode).toBe(0);
    const lines = exported.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3); // plan + 2 tasks (including archived)
  });
});
