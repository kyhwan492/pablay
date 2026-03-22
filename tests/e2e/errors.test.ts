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

  test("show without init → exit 1 with helpful message", async () => {
    // TEST_DIR has no .pablay/ — do not run init
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
    const mdPath = join(TEST_DIR, ".pablay", "messages", "task", `${id}.md`);
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

    const mdPath = join(TEST_DIR, ".pablay", "messages", "task", `${id}.md`);
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
    const taskDir = join(TEST_DIR, ".pablay", "messages", "task");
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
});
