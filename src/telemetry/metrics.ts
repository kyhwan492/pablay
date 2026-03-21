import { getMetrics } from "./index.ts";
import type { Status } from "../types.ts";

/**
 * Increment a counter every time a message is created.
 */
export function recordMessageCreated(channel: string | null): void {
  const meter = getMetrics();
  const counter = meter.createCounter("agent_comm.message.created", {
    description: "Number of messages created",
  });
  counter.add(1, { channel: channel ?? "none" });
}

/**
 * Increment a counter for each state transition.
 */
export function recordStateTransition(
  from: Status | null,
  to: Status,
): void {
  const meter = getMetrics();
  const counter = meter.createCounter("agent_comm.state.transition", {
    description: "Number of state transitions",
  });
  counter.add(1, { from: from ?? "none", to });
}

/**
 * Record the latency (in milliseconds) of a CLI command execution.
 */
export function recordCommandLatency(
  command: string,
  durationMs: number,
): void {
  const meter = getMetrics();
  const histogram = meter.createHistogram("agent_comm.command.latency", {
    description: "CLI command latency in milliseconds",
    unit: "ms",
  });
  histogram.record(durationMs, { command });
}
