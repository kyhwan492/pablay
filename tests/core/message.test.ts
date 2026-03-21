import { describe, expect, test } from "bun:test";
import { generateId, validateTransition, createMessage } from "../../src/core/message";
import { defaultConfig } from "../../src/core/config";
import type { Status } from "../../src/types";

describe("generateId", () => {
  test("generates id with msg_ prefix", () => {
    const id = generateId();
    expect(id).toStartWith("msg_");
  });

  test("generates 20-char total length (msg_ + 16 chars)", () => {
    const id = generateId();
    expect(id.length).toBe(20);
  });

  test("generates unique ids", () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateId()));
    expect(ids.size).toBe(100);
  });
});

describe("validateTransition", () => {
  const config = defaultConfig();

  test("allows valid task transition: draft → open", () => {
    expect(() => validateTransition(config, "task", "draft", "open")).not.toThrow();
  });

  test("rejects invalid task transition: draft → completed", () => {
    expect(() => validateTransition(config, "task", "draft", "completed")).toThrow();
  });

  test("allows any non-archived → archived (bypass)", () => {
    expect(() => validateTransition(config, "task", "draft", "archived")).not.toThrow();
    expect(() => validateTransition(config, "task", "in_progress", "archived")).not.toThrow();
  });

  test("rejects archived → anything", () => {
    expect(() => validateTransition(config, "task", "archived", "open")).toThrow();
  });

  test("allows unrestricted transitions for unknown types", () => {
    expect(() => validateTransition(config, "custom_type", "draft", "completed")).not.toThrow();
  });

  test("rejects non-canonical status strings", () => {
    expect(() =>
      validateTransition(config, "task", "draft", "invalid" as Status)
    ).toThrow();
  });
});

describe("createMessage", () => {
  const config = defaultConfig();

  test("creates a task with default status draft", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Test task",
      body: "",
      author: "test-agent",
    });
    expect(msg.status).toBe("draft");
    expect(msg.id).toStartWith("msg_");
    expect(msg.type).toBe("task");
  });

  test("creates a note with initial status open", () => {
    const msg = createMessage(config, {
      type: "note",
      title: "Test note",
      body: "",
      author: "test-agent",
    });
    expect(msg.status).toBe("open");
  });

  test("creates a command with initial status open", () => {
    const msg = createMessage(config, {
      type: "command",
      title: "Run tests",
      body: "",
      author: "test-agent",
    });
    expect(msg.status).toBe("open");
  });

  test("sets timestamps", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Test",
      body: "",
      author: "test-agent",
    });
    expect(msg.created_at).toBeDefined();
    expect(msg.updated_at).toBe(msg.created_at);
  });

  test("accepts optional fields", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Test",
      body: "content",
      author: "test-agent",
      channel: "backend",
      parent_id: "msg_parent123456789",
      refs: ["msg_ref12345678901"],
      metadata: { priority: "high" },
    });
    expect(msg.channel).toBe("backend");
    expect(msg.parent_id).toBe("msg_parent123456789");
    expect(msg.refs).toEqual(["msg_ref12345678901"]);
    expect(msg.metadata).toEqual({ priority: "high" });
  });
});
