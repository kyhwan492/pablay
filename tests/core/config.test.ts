import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveRoot, loadConfig, defaultConfig } from "../../src/core/config";

const TEST_DIR = join(import.meta.dir, ".tmp-config-test");
const NESTED_DIR = join(TEST_DIR, "a", "b", "c");

beforeEach(() => {
  mkdirSync(NESTED_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveRoot", () => {
  test("finds .pablay in current directory", () => {
    mkdirSync(join(TEST_DIR, ".pablay"));
    const root = resolveRoot(TEST_DIR);
    expect(root).toBe(join(TEST_DIR, ".pablay"));
  });

  test("walks up to find .pablay", () => {
    mkdirSync(join(TEST_DIR, ".pablay"));
    const root = resolveRoot(NESTED_DIR);
    expect(root).toBe(join(TEST_DIR, ".pablay"));
  });

  test("returns null if not found", () => {
    // Must use a path outside the project tree so the walk-up doesn't find the project's own .pablay/
    const root = resolveRoot("/tmp");
    expect(root).toBeNull();
  });

  test("global scope returns ~/.pablay", () => {
    const root = resolveRoot(TEST_DIR, true);
    expect(root).toBe(join(process.env.HOME!, ".pablay"));
  });
});

describe("loadConfig", () => {
  test("returns default config if no config.json", () => {
    mkdirSync(join(TEST_DIR, ".pablay"));
    const config = loadConfig(join(TEST_DIR, ".pablay"));
    expect(config.version).toBe(1);
    expect(config.transitions.task.initial).toBe("draft");
    expect(config.transitions.note.initial).toBe("open");
  });

  test("loads config from file", () => {
    mkdirSync(join(TEST_DIR, ".pablay"));
    writeFileSync(
      join(TEST_DIR, ".pablay", "config.json"),
      JSON.stringify({ version: 1, author: "my-agent", transitions: {}, otel: null })
    );
    const config = loadConfig(join(TEST_DIR, ".pablay"));
    expect(config.author).toBe("my-agent");
  });
});

describe("defaultConfig", () => {
  test("has all built-in type transitions", () => {
    const cfg = defaultConfig();
    expect(cfg.transitions.task).toBeDefined();
    expect(cfg.transitions.plan).toBeDefined();
    expect(cfg.transitions.spec).toBeDefined();
    expect(cfg.transitions.note).toBeDefined();
    expect(cfg.transitions.command).toBeDefined();
  });
});
