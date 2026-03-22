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
});
