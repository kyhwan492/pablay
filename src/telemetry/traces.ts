import {
  type Span,
  SpanStatusCode,
  context,
  trace,
} from "@opentelemetry/api";
import { getTracer } from "./index.ts";

/**
 * Start a new span for a CLI command and return it.
 * The caller is responsible for ending it via endSpanOk / endSpanError.
 */
export function startCommandSpan(command: string): Span {
  const tracer = getTracer();
  const span = tracer.startSpan(`command:${command}`);
  return span;
}

/** Mark a span as successful and end it. */
export function endSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

/** Mark a span as failed, record the error, and end it. */
export function endSpanError(span: Span, error: Error): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.recordException(error);
  span.end();
}
