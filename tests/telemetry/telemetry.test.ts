import { describe, test, expect } from "bun:test";
import {
  initTelemetry,
  getTracer,
  getMetrics,
  shutdownTelemetry,
} from "../../src/telemetry/index.ts";
import {
  recordMessageCreated,
  recordStateTransition,
  recordCommandLatency,
} from "../../src/telemetry/metrics.ts";
import {
  startCommandSpan,
  endSpanOk,
  endSpanError,
} from "../../src/telemetry/traces.ts";
import {
  logStateTransition,
  logSyncConflict,
} from "../../src/telemetry/logs.ts";

describe("telemetry – unconfigured (no-op)", () => {
  test("initTelemetry(null) does not throw", async () => {
    await expect(initTelemetry(null)).resolves.toBeUndefined();
  });

  test("getTracer() returns a no-op tracer", () => {
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    // A no-op tracer still exposes startSpan
    expect(typeof tracer.startSpan).toBe("function");
  });

  test("getMetrics() returns a no-op meter", () => {
    const meter = getMetrics();
    expect(meter).toBeDefined();
    expect(typeof meter.createCounter).toBe("function");
    expect(typeof meter.createHistogram).toBe("function");
  });

  test("shutdownTelemetry() does not throw when unconfigured", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});

describe("telemetry – metrics no-op", () => {
  test("recordMessageCreated does not throw", () => {
    expect(() => recordMessageCreated("general")).not.toThrow();
    expect(() => recordMessageCreated(null)).not.toThrow();
  });

  test("recordStateTransition does not throw", () => {
    expect(() => recordStateTransition(null, "open")).not.toThrow();
    expect(() => recordStateTransition("open", "in_progress")).not.toThrow();
  });

  test("recordCommandLatency does not throw", () => {
    expect(() => recordCommandLatency("create", 42)).not.toThrow();
  });
});

describe("telemetry – traces no-op", () => {
  test("startCommandSpan returns a span", () => {
    const span = startCommandSpan("test-cmd");
    expect(span).toBeDefined();
    expect(typeof span.end).toBe("function");
  });

  test("endSpanOk does not throw", () => {
    const span = startCommandSpan("ok-cmd");
    expect(() => endSpanOk(span)).not.toThrow();
  });

  test("endSpanError does not throw", () => {
    const span = startCommandSpan("err-cmd");
    expect(() => endSpanError(span, new Error("boom"))).not.toThrow();
  });
});

describe("telemetry – logs no-op", () => {
  test("logStateTransition does not throw", () => {
    expect(() =>
      logStateTransition("msg-1", null, "open", "agent-a"),
    ).not.toThrow();
    expect(() =>
      logStateTransition("msg-1", "open", "in_progress", "agent-b"),
    ).not.toThrow();
  });

  test("logSyncConflict does not throw", () => {
    expect(() =>
      logSyncConflict("msg-2", "open", "completed"),
    ).not.toThrow();
  });
});

describe("telemetry – shutdown idempotency", () => {
  test("calling shutdownTelemetry twice does not throw", async () => {
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
