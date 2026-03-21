import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { Store } from "../../src/core/store";
import type { Message } from "../../src/types";

function makeTempDb(): { store: Store; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), "ac-store-test-"));
  const store = new Store(join(dir, "test.db"));
  return { store, dir };
}

function makeMsg(overrides: Partial<Message> = {}): Message {
  const now = new Date().toISOString();
  return {
    id: `msg_${Math.random().toString(36).slice(2, 18)}`,
    type: "task",
    status: "draft",
    title: "Test message",
    body: "",
    author: "test-agent",
    channel: null,
    parent_id: null,
    refs: [],
    metadata: {},
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

describe("Store", () => {
  let store: Store;
  let dir: string;

  beforeEach(() => {
    const t = makeTempDb();
    store = t.store;
    dir = t.dir;
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  describe("constructor and schema", () => {
    test("sets WAL mode and user_version", () => {
      expect(store.getSchemaVersion()).toBe(1);
    });
  });

  describe("insert and getById", () => {
    test("inserts and retrieves a message", () => {
      const msg = makeMsg({ title: "Hello" });
      store.insert(msg);
      const retrieved = store.getById(msg.id);
      expect(retrieved).not.toBeNull();
      expect(retrieved!.id).toBe(msg.id);
      expect(retrieved!.title).toBe("Hello");
      expect(retrieved!.refs).toEqual([]);
      expect(retrieved!.metadata).toEqual({});
      expect(retrieved!.channel).toBeNull();
      expect(retrieved!.parent_id).toBeNull();
    });

    test("returns null for nonexistent id", () => {
      expect(store.getById("msg_nonexistent12345")).toBeNull();
    });

    test("preserves refs and metadata as parsed JSON", () => {
      const msg = makeMsg({
        refs: ["msg_ref1234567890ab"],
        metadata: { priority: "high", count: 42 },
      });
      store.insert(msg);
      const retrieved = store.getById(msg.id)!;
      expect(retrieved.refs).toEqual(["msg_ref1234567890ab"]);
      expect(retrieved.metadata).toEqual({ priority: "high", count: 42 });
    });
  });

  describe("update", () => {
    test("updates status", () => {
      const msg = makeMsg();
      store.insert(msg);
      store.update(msg.id, { status: "open" });
      expect(store.getById(msg.id)!.status).toBe("open");
    });

    test("updates body", () => {
      const msg = makeMsg();
      store.insert(msg);
      store.update(msg.id, { body: "new body" });
      expect(store.getById(msg.id)!.body).toBe("new body");
    });

    test("updates title", () => {
      const msg = makeMsg();
      store.insert(msg);
      store.update(msg.id, { title: "new title" });
      expect(store.getById(msg.id)!.title).toBe("new title");
    });

    test("merges metadata", () => {
      const msg = makeMsg({ metadata: { a: 1, b: 2 } });
      store.insert(msg);
      store.update(msg.id, { metadata: { b: 3, c: 4 } });
      const updated = store.getById(msg.id)!;
      expect(updated.metadata).toEqual({ a: 1, b: 3, c: 4 });
    });

    test("updates updated_at timestamp", async () => {
      const msg = makeMsg({
        created_at: "2025-01-01T00:00:00.000Z",
        updated_at: "2025-01-01T00:00:00.000Z",
      });
      store.insert(msg);
      store.update(msg.id, { body: "changed" });
      const after = store.getById(msg.id)!.updated_at;
      expect(after).not.toBe("2025-01-01T00:00:00.000Z");
    });

    test("throws for nonexistent message", () => {
      expect(() => store.update("msg_nonexistent12345", { body: "x" })).toThrow(
        "Message not found"
      );
    });
  });

  describe("addRef / removeRef", () => {
    test("adds a ref", () => {
      const msg = makeMsg();
      store.insert(msg);
      store.addRef(msg.id, "msg_ref1234567890ab");
      expect(store.getById(msg.id)!.refs).toEqual(["msg_ref1234567890ab"]);
    });

    test("does not duplicate refs", () => {
      const msg = makeMsg();
      store.insert(msg);
      store.addRef(msg.id, "msg_ref1234567890ab");
      store.addRef(msg.id, "msg_ref1234567890ab");
      expect(store.getById(msg.id)!.refs).toEqual(["msg_ref1234567890ab"]);
    });

    test("removes a ref", () => {
      const msg = makeMsg({ refs: ["msg_a00000000000000", "msg_b00000000000000"] });
      store.insert(msg);
      store.removeRef(msg.id, "msg_a00000000000000");
      expect(store.getById(msg.id)!.refs).toEqual(["msg_b00000000000000"]);
    });

    test("throws for nonexistent message", () => {
      expect(() => store.addRef("msg_nonexistent12345", "msg_x")).toThrow("Message not found");
      expect(() => store.removeRef("msg_nonexistent12345", "msg_x")).toThrow("Message not found");
    });
  });

  describe("list", () => {
    test("returns messages in created_at ASC order", () => {
      const m1 = makeMsg({ created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" });
      const m2 = makeMsg({ created_at: "2025-01-02T00:00:00Z", updated_at: "2025-01-02T00:00:00Z" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({});
      expect(results.length).toBe(2);
      expect(results[0].id).toBe(m1.id);
      expect(results[1].id).toBe(m2.id);
    });

    test("excludes archived by default", () => {
      const m1 = makeMsg({ status: "open" });
      const m2 = makeMsg({ status: "archived" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({});
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(m1.id);
    });

    test("includes archived when option set", () => {
      const m1 = makeMsg({ status: "open" });
      const m2 = makeMsg({ status: "archived" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({}, { includeArchived: true });
      expect(results.length).toBe(2);
    });

    test("filters by type", () => {
      const m1 = makeMsg({ type: "task" });
      const m2 = makeMsg({ type: "note", status: "open" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({ type: "task" });
      expect(results.length).toBe(1);
      expect(results[0].type).toBe("task");
    });

    test("filters by status", () => {
      const m1 = makeMsg({ status: "draft" });
      const m2 = makeMsg({ status: "open" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({ status: "open" });
      expect(results.length).toBe(1);
    });

    test("filters by channel", () => {
      const m1 = makeMsg({ channel: "backend" });
      const m2 = makeMsg({ channel: "frontend" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({ channel: "backend" });
      expect(results.length).toBe(1);
    });

    test("filters by author", () => {
      const m1 = makeMsg({ author: "alice" });
      const m2 = makeMsg({ author: "bob" });
      store.insert(m1);
      store.insert(m2);
      const results = store.list({ author: "alice" });
      expect(results.length).toBe(1);
    });

    test("supports limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        store.insert(
          makeMsg({
            created_at: `2025-01-0${i + 1}T00:00:00Z`,
            updated_at: `2025-01-0${i + 1}T00:00:00Z`,
          })
        );
      }
      const results = store.list({}, { limit: 2, offset: 1 });
      expect(results.length).toBe(2);
    });
  });

  describe("feed", () => {
    test("returns messages in created_at DESC order", () => {
      const m1 = makeMsg({ created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" });
      const m2 = makeMsg({ created_at: "2025-01-02T00:00:00Z", updated_at: "2025-01-02T00:00:00Z" });
      store.insert(m1);
      store.insert(m2);
      const results = store.feed({});
      expect(results.length).toBe(2);
      expect(results[0].id).toBe(m2.id);
      expect(results[1].id).toBe(m1.id);
    });

    test("excludes archived messages", () => {
      const m1 = makeMsg({ status: "open" });
      const m2 = makeMsg({ status: "archived" });
      store.insert(m1);
      store.insert(m2);
      const results = store.feed({});
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(m1.id);
    });

    test("filters by since", () => {
      const m1 = makeMsg({});
      m1.created_at = "2026-01-01T00:00:00Z";
      m1.updated_at = "2026-01-01T00:00:00Z";
      const m2 = makeMsg({});
      m2.created_at = "2026-01-02T00:00:00Z";
      m2.updated_at = "2026-01-02T00:00:00Z";
      store.insert(m1);
      store.insert(m2);
      const results = store.feed({ since: "2026-01-01T00:00:00Z" });
      expect(results.length).toBe(1);
      expect(results[0].id).toBe(m2.id);
    });

    test("filters by channel", () => {
      const m1 = makeMsg({ channel: "ops" });
      const m2 = makeMsg({ channel: "dev" });
      store.insert(m1);
      store.insert(m2);
      const results = store.feed({ channel: "ops" });
      expect(results.length).toBe(1);
    });

    test("supports limit", () => {
      for (let i = 0; i < 5; i++) {
        store.insert(makeMsg());
      }
      const results = store.feed({}, { limit: 3 });
      expect(results.length).toBe(3);
    });
  });

  describe("getChildren", () => {
    test("returns children of a parent message", () => {
      const parent = makeMsg();
      store.insert(parent);
      const child1 = makeMsg({ parent_id: parent.id, created_at: "2025-01-01T00:00:00Z", updated_at: "2025-01-01T00:00:00Z" });
      const child2 = makeMsg({ parent_id: parent.id, created_at: "2025-01-02T00:00:00Z", updated_at: "2025-01-02T00:00:00Z" });
      store.insert(child1);
      store.insert(child2);
      const children = store.getChildren(parent.id);
      expect(children.length).toBe(2);
      expect(children[0].id).toBe(child1.id);
      expect(children[1].id).toBe(child2.id);
    });

    test("returns empty array when no children", () => {
      const parent = makeMsg();
      store.insert(parent);
      expect(store.getChildren(parent.id)).toEqual([]);
    });
  });

  describe("logTransition and getStateLog", () => {
    test("logs and retrieves transitions", () => {
      const msg = makeMsg();
      store.insert(msg);
      store.logTransition(msg.id, null, "draft", "system");
      store.logTransition(msg.id, "draft", "open", "test-agent");
      const log = store.getStateLog(msg.id);
      expect(log.length).toBe(2);
      expect(log[0].from_status).toBeNull();
      expect(log[0].to_status).toBe("draft");
      expect(log[1].from_status).toBe("draft");
      expect(log[1].to_status).toBe("open");
      expect(log[1].changed_by).toBe("test-agent");
    });

    test("returns empty array for no transitions", () => {
      const msg = makeMsg();
      store.insert(msg);
      expect(store.getStateLog(msg.id)).toEqual([]);
    });
  });

  describe("getChannels", () => {
    test("returns channels with counts", () => {
      store.insert(makeMsg({ channel: "backend" }));
      store.insert(makeMsg({ channel: "backend" }));
      store.insert(makeMsg({ channel: "frontend" }));
      const channels = store.getChannels();
      expect(channels.length).toBe(2);
      expect(channels[0]).toEqual({ channel: "backend", count: 2 });
      expect(channels[1]).toEqual({ channel: "frontend", count: 1 });
    });

    test("excludes messages with null channel", () => {
      store.insert(makeMsg({ channel: null }));
      store.insert(makeMsg({ channel: "ops" }));
      const channels = store.getChannels();
      expect(channels.length).toBe(1);
      expect(channels[0].channel).toBe("ops");
    });

    test("excludes archived messages", () => {
      store.insert(makeMsg({ channel: "backend", status: "archived" }));
      store.insert(makeMsg({ channel: "backend", status: "open" }));
      const channels = store.getChannels();
      expect(channels.length).toBe(1);
      expect(channels[0].count).toBe(1);
    });
  });
});
