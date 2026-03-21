import { getTracer } from "./index.ts";
import type { Status } from "../types.ts";

/**
 * Log a state transition as a span event on a new span.
 */
export function logStateTransition(
  messageId: string,
  from: Status | null,
  to: Status,
  changedBy: string,
): void {
  const tracer = getTracer();
  const span = tracer.startSpan("log.stateTransition");
  span.addEvent("state_transition", {
    "message.id": messageId,
    "state.from": from ?? "none",
    "state.to": to,
    "changed_by": changedBy,
  });
  span.end();
}

/**
 * Log a sync conflict as a span event on a new span.
 */
export function logSyncConflict(
  messageId: string,
  localStatus: Status,
  remoteStatus: Status,
): void {
  const tracer = getTracer();
  const span = tracer.startSpan("log.syncConflict");
  span.addEvent("sync_conflict", {
    "message.id": messageId,
    "status.local": localStatus,
    "status.remote": remoteStatus,
  });
  span.end();
}
