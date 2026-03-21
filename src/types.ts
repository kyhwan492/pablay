export const CANONICAL_STATUSES = [
  "draft",
  "open",
  "in_progress",
  "completed",
  "cancelled",
  "archived",
] as const;

export type Status = (typeof CANONICAL_STATUSES)[number];

export interface Message {
  id: string;
  type: string;
  status: Status;
  title: string;
  body: string;
  author: string;
  channel: string | null;
  parent_id: string | null;
  refs: string[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface StateLogEntry {
  id: number;
  message_id: string;
  from_status: Status | null;
  to_status: Status;
  changed_by: string;
  changed_at: string;
}

export interface TransitionRule {
  initial: Status;
  allowed: Partial<Record<Status, Status[]>>;
}

export interface OtelConfig {
  exporter: string;
  endpoint: string;
}

export interface Config {
  version: number;
  author: string | null;
  transitions: Record<string, TransitionRule>;
  otel: OtelConfig | null;
}
