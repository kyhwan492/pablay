import { nanoid } from "nanoid";
import type { Config, Message, Status } from "../types";
import { CANONICAL_STATUSES } from "../types";

export function generateId(): string {
  return `msg_${nanoid(16)}`;
}

export function validateTransition(
  config: Config,
  type: string,
  fromStatus: Status,
  toStatus: Status
): void {
  if (!CANONICAL_STATUSES.includes(toStatus)) {
    throw new Error(`Invalid status: "${toStatus}". Must be one of: ${CANONICAL_STATUSES.join(", ")}`);
  }
  if (!CANONICAL_STATUSES.includes(fromStatus)) {
    throw new Error(`Invalid status: "${fromStatus}". Must be one of: ${CANONICAL_STATUSES.join(", ")}`);
  }

  if (fromStatus === "archived") {
    throw new Error(`Cannot transition from "archived" — it is a terminal state`);
  }

  if (toStatus === "archived") {
    return;
  }

  const rule = config.transitions[type];
  if (rule) {
    const allowed = rule.allowed[fromStatus];
    if (!allowed || !allowed.includes(toStatus)) {
      throw new Error(
        `Invalid transition for "${type}": "${fromStatus}" → "${toStatus}". Allowed: ${
          allowed ? allowed.join(", ") : "none"
        }`
      );
    }
    return;
  }
}

export interface CreateMessageInput {
  type: string;
  title: string;
  body: string;
  author: string;
  channel?: string | null;
  parent_id?: string | null;
  refs?: string[];
  metadata?: Record<string, unknown>;
}

export function createMessage(config: Config, input: CreateMessageInput): Message {
  const rule = config.transitions[input.type];
  const initialStatus: Status = rule?.initial ?? "draft";
  const now = new Date().toISOString();

  return {
    id: generateId(),
    type: input.type,
    status: initialStatus,
    title: input.title,
    body: input.body,
    author: input.author,
    channel: input.channel ?? null,
    parent_id: input.parent_id ?? null,
    refs: input.refs ?? [],
    metadata: input.metadata ?? {},
    created_at: now,
    updated_at: now,
  };
}
