import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { Store } from "../../src/core/store";
import { SyncEngine } from "../../src/core/sync";
import { createMessage } from "../../src/core/message";
import { writeMessageFile, renderMarkdown } from "../../src/core/markdown";
import { defaultConfig } from "../../src/core/config";

const TEST_DIR = join(import.meta.dir, ".tmp-sync-test");
const config = defaultConfig();

let store: Store;
let sync: SyncEngine;
let messagesDir: string;

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  messagesDir = join(TEST_DIR, "messages");
  mkdirSync(messagesDir, { recursive: true });
  store = new Store(join(TEST_DIR, "store.db"));
  sync = new SyncEngine(store, messagesDir);
});

afterEach(() => {
  store.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("SyncEngine", () => {
  test("renderAll writes markdown for all messages in store", () => {
    const msg = createMessage(config, { type: "task", title: "T", body: "content", author: "a" });
    store.insert(msg);
    sync.renderAll();
    const filePath = join(messagesDir, "task", `${msg.id}.md`);
    expect(existsSync(filePath)).toBe(true);
  });

  test("rebuild reconstructs store from markdown files", () => {
    const msg = createMessage(config, { type: "task", title: "Rebuilt", body: "data", author: "a" });
    writeMessageFile(messagesDir, msg);

    const freshStore = new Store(join(TEST_DIR, "fresh.db"));
    const freshSync = new SyncEngine(freshStore, messagesDir);
    const result = freshSync.rebuild();
    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);

    const retrieved = freshStore.getById(msg.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Rebuilt");
    freshStore.close();
  });

  test("rebuild skips invalid markdown files", () => {
    const typeDir = join(messagesDir, "task");
    mkdirSync(typeDir, { recursive: true });
    writeFileSync(join(typeDir, "bad.md"), "this is not valid frontmatter");

    const freshStore = new Store(join(TEST_DIR, "fresh2.db"));
    const freshSync = new SyncEngine(freshStore, messagesDir);
    const result = freshSync.rebuild();
    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    freshStore.close();
  });

  test("syncFromMarkdown updates store from edited markdown", () => {
    const msg = createMessage(config, { type: "task", title: "Original", body: "", author: "a" });
    store.insert(msg);
    sync.renderAll();

    const filePath = join(messagesDir, "task", `${msg.id}.md`);
    const edited = { ...msg, title: "Edited", updated_at: new Date(Date.now() + 10000).toISOString() };
    writeFileSync(filePath, renderMarkdown(edited));

    sync.syncFromMarkdown();
    const updated = store.getById(msg.id);
    expect(updated!.title).toBe("Edited");
  });
});
