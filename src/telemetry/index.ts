import { trace, metrics, type Tracer, type Meter } from "@opentelemetry/api";
import type { OtelConfig } from "../types.ts";

const INSTRUMENTATION_NAME = "agent-comm";

let initialized = false;
let sdkShutdown: (() => Promise<void>) | null = null;

/**
 * Initialize OpenTelemetry. If config is null, the OTEL API returns no-op
 * instances by default, so nothing needs to be done.
 * If config is provided, lazily load the SDK and configure exporters.
 */
export async function initTelemetry(config: OtelConfig | null): Promise<void> {
  if (!config) return;
  if (initialized) return;

  const { NodeSDK } = await import("@opentelemetry/sdk-node");
  const { OTLPTraceExporter } = await import(
    "@opentelemetry/exporter-trace-otlp-http"
  );
  const { OTLPMetricExporter } = await import(
    "@opentelemetry/exporter-metrics-otlp-http"
  );
  const { PeriodicExportingMetricReader } = await import(
    "@opentelemetry/sdk-metrics"
  );

  const traceExporter = new OTLPTraceExporter({ url: config.endpoint });
  const metricExporter = new OTLPMetricExporter({ url: config.endpoint });

  const sdk = new NodeSDK({
    traceExporter,
    metricReader: new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: 10_000,
    }),
    serviceName: INSTRUMENTATION_NAME,
  });

  sdk.start();
  initialized = true;
  sdkShutdown = () => sdk.shutdown();
}

/** Return a Tracer. Returns a no-op tracer when SDK is not configured. */
export function getTracer(): Tracer {
  return trace.getTracer(INSTRUMENTATION_NAME);
}

/** Return a Meter. Returns a no-op meter when SDK is not configured. */
export function getMetrics(): Meter {
  return metrics.getMeter(INSTRUMENTATION_NAME);
}

/** Gracefully shut down the SDK. Safe to call even when unconfigured. */
export async function shutdownTelemetry(): Promise<void> {
  if (sdkShutdown) {
    await sdkShutdown();
    sdkShutdown = null;
    initialized = false;
  }
}
