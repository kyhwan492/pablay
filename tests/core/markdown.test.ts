import { describe, test, expect } from "bun:test";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  renderMarkdown,
  parseMarkdown,
  writeMessageFile,
  readMessageFile,
} from "../../src/core/markdown.js";
import type { Message } from "../../src/types.js";

function makeMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: "msg-001",
    type: "task",
    status: "open",
    title: "Test message",
    body: "Hello world",
    author: "agent-a",
    channel: "general",
    parent_id: null,
    refs: [],
    metadata: {},
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("renderMarkdown / parseMarkdown", () => {
  test("roundtrip preserves all fields", () => {
    const msg = makeMessage();
    const md = renderMarkdown(msg);
    const parsed = parseMarkdown(md);
    expect(parsed).toEqual(msg);
  });

  test("roundtrip with null channel and parent_id", () => {
    const msg = makeMessage({ channel: null, parent_id: null });
    const md = renderMarkdown(msg);
    const parsed = parseMarkdown(md);
    expect(parsed).toEqual(msg);
  });

  test("roundtrip with non-empty refs and metadata", () => {
    const msg = makeMessage({
      refs: ["ref-1", "ref-2"],
      metadata: { priority: "high", count: 42 },
    });
    const md = renderMarkdown(msg);
    const parsed = parseMarkdown(md);
    expect(parsed).toEqual(msg);
  });

  test("body containing --- is preserved", () => {
    const msg = makeMessage({
      body: "Line one\n---\nLine two\n---\nLine three",
    });
    const md = renderMarkdown(msg);
    const parsed = parseMarkdown(md);
    expect(parsed.body).toBe(msg.body);
    expect(parsed).toEqual(msg);
  });

  test("renderMarkdown produces correct format", () => {
    const msg = makeMessage({ body: "Some body" });
    const md = renderMarkdown(msg);
    expect(md).toMatch(/^---\n/);
    expect(md).toContain("\n---\n\n");
    expect(md.endsWith("Some body")).toBe(true);
  });
});

describe("writeMessageFile / readMessageFile", () => {
  test("write and read roundtrip via filesystem", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ac-test-"));
    try {
      const msg = makeMessage();
      const path = writeMessageFile(tmp, msg);
      expect(path).toBe(join(tmp, "task", "msg-001.md"));

      const read = readMessageFile(path);
      expect(read).toEqual(msg);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("atomic write does not leave .tmp file", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ac-test-"));
    try {
      const msg = makeMessage();
      const path = writeMessageFile(tmp, msg);
      const raw = readFileSync(path, "utf-8");
      expect(raw).toBe(renderMarkdown(msg));

      // .tmp should not exist
      let tmpExists = true;
      try {
        readFileSync(path + ".tmp");
      } catch {
        tmpExists = false;
      }
      expect(tmpExists).toBe(false);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("creates nested type directory automatically", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ac-test-"));
    try {
      const msg = makeMessage({ type: "deep/nested" });
      const path = writeMessageFile(tmp, msg);
      const read = readMessageFile(path);
      expect(read).toEqual(msg);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
