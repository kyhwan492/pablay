import { describe, expect, test } from "bun:test";
import type { Message, StateLogEntry, Config } from "../../src/types";

describe("types", () => {
  test("Message type has all required fields", () => {
    const msg: Message = {
      id: "msg_V1StGXR8_Z5jdHi6",
      type: "task",
      status: "draft",
      title: "Test task",
      body: "Some markdown",
      author: "test-agent",
      channel: null,
      parent_id: null,
      refs: [],
      metadata: {},
      created_at: "2026-03-21T10:00:00Z",
      updated_at: "2026-03-21T10:00:00Z",
    };
    expect(msg.id).toStartWith("msg_");
    expect(msg.type).toBe("task");
  });

  test("StateLogEntry type has all required fields", () => {
    const entry: StateLogEntry = {
      id: 1,
      message_id: "msg_V1StGXR8_Z5jdHi6",
      from_status: "draft",
      to_status: "open",
      changed_by: "test-agent",
      changed_at: "2026-03-21T10:00:00Z",
    };
    expect(entry.message_id).toStartWith("msg_");
  });

  test("Config type has all required fields", () => {
    const config: Config = {
      version: 1,
      author: null,
      transitions: {
        task: {
          initial: "draft",
          allowed: {
            draft: ["open"],
            open: ["in_progress", "cancelled"],
            in_progress: ["completed", "cancelled"],
          },
        },
      },
      otel: null,
    };
    expect(config.version).toBe(1);
  });
});
