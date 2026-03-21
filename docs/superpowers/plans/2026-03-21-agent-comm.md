# Agent-Comm (ac) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `ac`, a CLI-first async communication tool for agent teams, with dual SQLite + markdown storage.

**Architecture:** Message-centric — everything is a Message with type, status, and metadata. Core library (`src/core/`) handles storage, validation, and rendering. CLI (`src/cli/`) is a thin shell using Commander.js. Telemetry (`src/telemetry/`) is opt-in OTEL that no-ops when unconfigured.

**Tech Stack:** Bun, TypeScript, better-sqlite3, nanoid, yaml, commander, @opentelemetry/api

**Spec:** `docs/superpowers/specs/2026-03-21-agent-comm-design.md`

---

## Chunk 1: Project Setup & Core Types

### Task 1: Initialize Bun project and install dependencies

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `bunfig.toml`
- Create: `src/types.ts`

- [ ] **Step 1: Initialize Bun project**

Run: `bun init -y`
Expected: `package.json` and `tsconfig.json` created.

- [ ] **Step 2: Install dependencies**

Run: `bun add better-sqlite3 nanoid yaml commander @opentelemetry/api @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http @opentelemetry/exporter-metrics-otlp-http`
Run: `bun add -d @types/better-sqlite3 bun-types`

- [ ] **Step 3: Configure tsconfig.json**

Overwrite `tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun-types"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create bunfig.toml**

```toml
[test]
preload = []
```

- [ ] **Step 5: Add scripts to package.json**

Add to `package.json`:
```json
{
  "name": "agent-comm",
  "bin": {
    "ac": "src/cli/index.ts",
    "agent-comm": "src/cli/index.ts"
  },
  "scripts": {
    "dev": "bun run src/cli/index.ts",
    "test": "bun test",
    "build": "bun build src/cli/index.ts --outdir dist --target node",
    "link": "bun link"
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add package.json tsconfig.json bunfig.toml bun.lockb
git commit -m "chore: initialize Bun project with dependencies"
```

### Task 2: Define core types

**Files:**
- Create: `src/types.ts`

- [ ] **Step 1: Write the test for types**

Create `tests/core/types.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import type { Message, StateLogEntry, Config, TransitionRule } from "../../src/types";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/types.test.ts`
Expected: FAIL — cannot resolve `../../src/types`

- [ ] **Step 3: Implement types**

Create `src/types.ts`:

```typescript
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/types.test.ts`
Expected: PASS — all 3 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/core/types.test.ts
git commit -m "feat: add core type definitions (Message, Config, StateLogEntry)"
```

### Task 3: Implement config loader with scope resolution

**Files:**
- Create: `src/core/config.ts`
- Create: `tests/core/config.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/config.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { resolveRoot, loadConfig, defaultConfig } from "../../src/core/config";

const TEST_DIR = join(import.meta.dir, ".tmp-config-test");
const NESTED_DIR = join(TEST_DIR, "a", "b", "c");

beforeEach(() => {
  mkdirSync(NESTED_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("resolveRoot", () => {
  test("finds .agent-comm in current directory", () => {
    mkdirSync(join(TEST_DIR, ".agent-comm"));
    const root = resolveRoot(TEST_DIR);
    expect(root).toBe(join(TEST_DIR, ".agent-comm"));
  });

  test("walks up to find .agent-comm", () => {
    mkdirSync(join(TEST_DIR, ".agent-comm"));
    const root = resolveRoot(NESTED_DIR);
    expect(root).toBe(join(TEST_DIR, ".agent-comm"));
  });

  test("returns null if not found", () => {
    const root = resolveRoot(NESTED_DIR);
    expect(root).toBeNull();
  });

  test("global scope returns ~/.agent-comm", () => {
    const root = resolveRoot(TEST_DIR, true);
    expect(root).toBe(join(process.env.HOME!, ".agent-comm"));
  });
});

describe("loadConfig", () => {
  test("returns default config if no config.json", () => {
    mkdirSync(join(TEST_DIR, ".agent-comm"));
    const config = loadConfig(join(TEST_DIR, ".agent-comm"));
    expect(config.version).toBe(1);
    expect(config.transitions.task.initial).toBe("draft");
    expect(config.transitions.note.initial).toBe("open");
  });

  test("loads config from file", () => {
    mkdirSync(join(TEST_DIR, ".agent-comm"));
    writeFileSync(
      join(TEST_DIR, ".agent-comm", "config.json"),
      JSON.stringify({ version: 1, author: "my-agent", transitions: {}, otel: null })
    );
    const config = loadConfig(join(TEST_DIR, ".agent-comm"));
    expect(config.author).toBe("my-agent");
  });
});

describe("defaultConfig", () => {
  test("has all built-in type transitions", () => {
    const cfg = defaultConfig();
    expect(cfg.transitions.task).toBeDefined();
    expect(cfg.transitions.plan).toBeDefined();
    expect(cfg.transitions.spec).toBeDefined();
    expect(cfg.transitions.note).toBeDefined();
    expect(cfg.transitions.command).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/config.test.ts`
Expected: FAIL — cannot resolve `../../src/core/config`

- [ ] **Step 3: Implement config.ts**

Create `src/core/config.ts`:

```typescript
import { existsSync, readFileSync } from "fs";
import { join, dirname, parse } from "path";
import { userInfo } from "os";
import type { Config, TransitionRule } from "../types";

export function defaultConfig(): Config {
  const linearFlow: TransitionRule = {
    initial: "draft",
    allowed: {
      draft: ["open"],
      open: ["in_progress", "cancelled"],
      in_progress: ["completed", "cancelled"],
    },
  };

  return {
    version: 1,
    author: null,
    transitions: {
      task: { ...linearFlow },
      plan: { ...linearFlow },
      spec: { ...linearFlow },
      note: { initial: "open", allowed: { open: ["cancelled"] } },
      command: {
        initial: "open",
        allowed: {
          open: ["in_progress", "cancelled"],
          in_progress: ["completed", "cancelled"],
        },
      },
    },
    otel: null,
  };
}

export function resolveRoot(cwd: string, global = false): string | null {
  if (global) {
    return join(process.env.HOME ?? userInfo().homedir, ".agent-comm");
  }

  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".agent-comm");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }
  return null;
}

export function loadConfig(root: string): Config {
  const configPath = join(root, "config.json");
  const defaults = defaultConfig();

  if (!existsSync(configPath)) {
    return defaults;
  }

  const raw = JSON.parse(readFileSync(configPath, "utf-8"));
  return {
    version: raw.version ?? defaults.version,
    author: raw.author ?? defaults.author,
    transitions: { ...defaults.transitions, ...raw.transitions },
    otel: raw.otel ?? defaults.otel,
  };
}

export function resolveAuthor(config: Config, cliAuthor?: string): string {
  if (cliAuthor) return cliAuthor;
  if (process.env.AC_AUTHOR) return process.env.AC_AUTHOR;
  if (config.author) return config.author;
  return userInfo().username;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/config.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/config.ts tests/core/config.test.ts
git commit -m "feat: add config loader with scope resolution and author precedence"
```

### Task 4: Implement message validation and state machine

**Files:**
- Create: `src/core/message.ts`
- Create: `tests/core/message.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/message.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { generateId, validateTransition, createMessage } from "../../src/core/message";
import { defaultConfig } from "../../src/core/config";
import { CANONICAL_STATUSES } from "../../src/types";
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/message.test.ts`
Expected: FAIL — cannot resolve `../../src/core/message`

- [ ] **Step 3: Implement message.ts**

Create `src/core/message.ts`:

```typescript
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
  // Validate both statuses are canonical
  if (!CANONICAL_STATUSES.includes(toStatus)) {
    throw new Error(`Invalid status: "${toStatus}". Must be one of: ${CANONICAL_STATUSES.join(", ")}`);
  }
  if (!CANONICAL_STATUSES.includes(fromStatus)) {
    throw new Error(`Invalid status: "${fromStatus}". Must be one of: ${CANONICAL_STATUSES.join(", ")}`);
  }

  // archived is a terminal state — nothing can leave it
  if (fromStatus === "archived") {
    throw new Error(`Cannot transition from "archived" — it is a terminal state`);
  }

  // any non-archived → archived is always allowed (system-level operation)
  if (toStatus === "archived") {
    return;
  }

  // If type has configured transitions, enforce them
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

  // Unknown types: unrestricted transitions between canonical statuses
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/message.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/message.ts tests/core/message.test.ts
git commit -m "feat: add message creation with ID generation and state machine validation"
```

## Chunk 2: Storage Layer (SQLite + Markdown)

### Task 5: Implement SQLite store

**Files:**
- Create: `src/core/store.ts`
- Create: `tests/core/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/store.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import { Store } from "../../src/core/store";
import { createMessage } from "../../src/core/message";
import { defaultConfig } from "../../src/core/config";

const TEST_DIR = join(import.meta.dir, ".tmp-store-test");
const DB_PATH = join(TEST_DIR, "store.db");

let store: Store;
const config = defaultConfig();

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
  store = new Store(DB_PATH);
});

afterEach(() => {
  store.close();
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("Store", () => {
  test("initializes database with schema", () => {
    const version = store.getSchemaVersion();
    expect(version).toBe(1);
  });

  test("inserts and retrieves a message", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Test task",
      body: "Some content",
      author: "test-agent",
      channel: "backend",
    });
    store.insert(msg);
    const retrieved = store.getById(msg.id);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe("Test task");
    expect(retrieved!.channel).toBe("backend");
    expect(retrieved!.refs).toEqual([]);
    expect(retrieved!.metadata).toEqual({});
  });

  test("returns null for nonexistent id", () => {
    expect(store.getById("msg_nonexistent12345")).toBeNull();
  });

  test("updates message status", () => {
    const msg = createMessage(config, {
      type: "note",
      title: "Note",
      body: "",
      author: "test",
    });
    store.insert(msg);
    store.update(msg.id, { status: "cancelled" });
    const updated = store.getById(msg.id);
    expect(updated!.status).toBe("cancelled");
  });

  test("updates message metadata (merge)", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Task",
      body: "",
      author: "test",
      metadata: { priority: "high" },
    });
    store.insert(msg);
    store.update(msg.id, { metadata: { assignee: "agent-b" } });
    const updated = store.getById(msg.id);
    expect(updated!.metadata).toEqual({ priority: "high", assignee: "agent-b" });
  });

  test("lists messages with filters", () => {
    const msg1 = createMessage(config, { type: "task", title: "T1", body: "", author: "a" });
    const msg2 = createMessage(config, { type: "note", title: "T2", body: "", author: "a" });
    const msg3 = createMessage(config, { type: "task", title: "T3", body: "", author: "b", channel: "fe" });
    store.insert(msg1);
    store.insert(msg2);
    store.insert(msg3);

    expect(store.list({ type: "task" })).toHaveLength(2);
    expect(store.list({ author: "b" })).toHaveLength(1);
    expect(store.list({ channel: "fe" })).toHaveLength(1);
    expect(store.list({})).toHaveLength(3);
  });

  test("list excludes archived by default", () => {
    const msg = createMessage(config, { type: "note", title: "N", body: "", author: "a" });
    store.insert(msg);
    store.update(msg.id, { status: "archived" });
    expect(store.list({})).toHaveLength(0);
    expect(store.list({}, { includeArchived: true })).toHaveLength(1);
  });

  test("list supports limit and offset", () => {
    for (let i = 0; i < 5; i++) {
      store.insert(createMessage(config, { type: "task", title: `T${i}`, body: "", author: "a" }));
    }
    expect(store.list({}, { limit: 2 })).toHaveLength(2);
    expect(store.list({}, { limit: 2, offset: 3 })).toHaveLength(2);
  });

  test("gets children by parent_id", () => {
    const parent = createMessage(config, { type: "plan", title: "Plan", body: "", author: "a" });
    store.insert(parent);
    const child1 = createMessage(config, { type: "task", title: "C1", body: "", author: "a", parent_id: parent.id });
    const child2 = createMessage(config, { type: "task", title: "C2", body: "", author: "a", parent_id: parent.id });
    store.insert(child1);
    store.insert(child2);
    expect(store.getChildren(parent.id)).toHaveLength(2);
  });

  test("logs state transitions", () => {
    const msg = createMessage(config, { type: "note", title: "N", body: "", author: "a" });
    store.insert(msg);
    store.logTransition(msg.id, null, "open", "a");
    store.logTransition(msg.id, "open", "cancelled", "b");
    const log = store.getStateLog(msg.id);
    expect(log).toHaveLength(2);
    expect(log[0].from_status).toBeNull();
    expect(log[0].to_status).toBe("open");
    expect(log[1].from_status).toBe("open");
    expect(log[1].to_status).toBe("cancelled");
  });

  test("gets channels with counts", () => {
    store.insert(createMessage(config, { type: "task", title: "T1", body: "", author: "a", channel: "be" }));
    store.insert(createMessage(config, { type: "task", title: "T2", body: "", author: "a", channel: "be" }));
    store.insert(createMessage(config, { type: "note", title: "N1", body: "", author: "a", channel: "fe" }));
    const channels = store.getChannels();
    expect(channels).toEqual([
      { channel: "be", count: 2 },
      { channel: "fe", count: 1 },
    ]);
  });

  test("feeds messages sorted by created_at descending", () => {
    const m1 = createMessage(config, { type: "task", title: "T1", body: "", author: "a" });
    const m2 = createMessage(config, { type: "task", title: "T2", body: "", author: "a" });
    store.insert(m1);
    store.insert(m2);
    const feed = store.feed({});
    expect(feed[0].id).toBe(m2.id);
    expect(feed[1].id).toBe(m1.id);
  });

  test("adds and removes refs", () => {
    const msg = createMessage(config, { type: "task", title: "T", body: "", author: "a", refs: ["msg_ref1"] });
    store.insert(msg);
    store.addRef(msg.id, "msg_ref2");
    let updated = store.getById(msg.id);
    expect(updated!.refs).toEqual(["msg_ref1", "msg_ref2"]);
    store.removeRef(msg.id, "msg_ref1");
    updated = store.getById(msg.id);
    expect(updated!.refs).toEqual(["msg_ref2"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/store.test.ts`
Expected: FAIL — cannot resolve `../../src/core/store`

- [ ] **Step 3: Implement store.ts**

Create `src/core/store.ts`:

```typescript
import Database from "better-sqlite3";
import type { Message, StateLogEntry, Status } from "../types";
import { join } from "path";

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA user_version = ${SCHEMA_VERSION};

CREATE TABLE IF NOT EXISTS messages (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL,
  channel     TEXT,
  parent_id   TEXT REFERENCES messages(id),
  refs        TEXT NOT NULL DEFAULT '[]',
  metadata    TEXT NOT NULL DEFAULT '{}',
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_type      ON messages(type);
CREATE INDEX IF NOT EXISTS idx_messages_status    ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_channel   ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_author    ON messages(author);

CREATE TABLE IF NOT EXISTS state_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL REFERENCES messages(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,
  changed_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_state_log_message_id ON state_log(message_id);
`;

export interface ListFilters {
  type?: string;
  status?: string;
  channel?: string;
  author?: string;
  parent_id?: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

export interface FeedFilters {
  channel?: string;
  since?: string;
}

function deserializeMessage(row: any): Message {
  return {
    ...row,
    refs: JSON.parse(row.refs),
    metadata: JSON.parse(row.metadata),
  };
}

export class Store {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  getSchemaVersion(): number {
    return this.db.pragma("user_version", { simple: true }) as number;
  }

  insert(msg: Message): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, type, status, title, body, author, channel, parent_id, refs, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        msg.id,
        msg.type,
        msg.status,
        msg.title,
        msg.body,
        msg.author,
        msg.channel,
        msg.parent_id,
        JSON.stringify(msg.refs),
        JSON.stringify(msg.metadata),
        msg.created_at,
        msg.updated_at
      );
  }

  getById(id: string): Message | null {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id);
    return row ? deserializeMessage(row) : null;
  }

  update(id: string, fields: Partial<Pick<Message, "status" | "body" | "metadata" | "title">>): void {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Message not found: ${id}`);

    const now = new Date().toISOString();
    const metadata = fields.metadata
      ? JSON.stringify({ ...existing.metadata, ...fields.metadata })
      : JSON.stringify(existing.metadata);

    this.db
      .prepare(
        `UPDATE messages SET status = ?, body = ?, title = ?, metadata = ?, updated_at = ? WHERE id = ?`
      )
      .run(
        fields.status ?? existing.status,
        fields.body ?? existing.body,
        fields.title ?? existing.title,
        metadata,
        now,
        id
      );
  }

  addRef(id: string, refId: string): void {
    const msg = this.getById(id);
    if (!msg) throw new Error(`Message not found: ${id}`);
    const refs = [...msg.refs, refId];
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE messages SET refs = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(refs), now, id);
  }

  removeRef(id: string, refId: string): void {
    const msg = this.getById(id);
    if (!msg) throw new Error(`Message not found: ${id}`);
    const refs = msg.refs.filter((r) => r !== refId);
    const now = new Date().toISOString();
    this.db
      .prepare("UPDATE messages SET refs = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(refs), now, id);
  }

  list(filters: ListFilters, options: ListOptions = {}): Message[] {
    const conditions: string[] = [];
    const params: any[] = [];

    if (!options.includeArchived) {
      conditions.push("status != 'archived'");
    }

    if (filters.type) {
      conditions.push("type = ?");
      params.push(filters.type);
    }
    if (filters.status) {
      conditions.push("status = ?");
      params.push(filters.status);
    }
    if (filters.channel) {
      conditions.push("channel = ?");
      params.push(filters.channel);
    }
    if (filters.author) {
      conditions.push("author = ?");
      params.push(filters.author);
    }
    if (filters.parent_id) {
      conditions.push("parent_id = ?");
      params.push(filters.parent_id);
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 50;
    const offset = options.offset ?? 0;

    const rows = this.db
      .prepare(`SELECT * FROM messages ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset);

    return rows.map(deserializeMessage);
  }

  feed(filters: FeedFilters, options: ListOptions = {}): Message[] {
    const conditions: string[] = ["status != 'archived'"];
    const params: any[] = [];

    if (filters.channel) {
      conditions.push("channel = ?");
      params.push(filters.channel);
    }
    if (filters.since) {
      conditions.push("created_at > ?");
      params.push(filters.since);
    }

    const where = `WHERE ${conditions.join(" AND ")}`;
    const limit = options.limit ?? 50;

    const rows = this.db
      .prepare(`SELECT * FROM messages ${where} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit);

    return rows.map(deserializeMessage);
  }

  getChildren(parentId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE parent_id = ? AND status != 'archived' ORDER BY created_at ASC")
      .all(parentId);
    return rows.map(deserializeMessage);
  }

  logTransition(messageId: string, fromStatus: Status | null, toStatus: Status, changedBy: string): void {
    const now = new Date().toISOString();
    this.db
      .prepare("INSERT INTO state_log (message_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)")
      .run(messageId, fromStatus, toStatus, changedBy, now);
  }

  getStateLog(messageId: string): StateLogEntry[] {
    return this.db
      .prepare("SELECT * FROM state_log WHERE message_id = ? ORDER BY changed_at ASC")
      .all(messageId) as StateLogEntry[];
  }

  getChannels(): { channel: string; count: number }[] {
    return this.db
      .prepare(
        "SELECT channel, COUNT(*) as count FROM messages WHERE channel IS NOT NULL AND status != 'archived' GROUP BY channel ORDER BY count DESC"
      )
      .all() as { channel: string; count: number }[];
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/store.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/store.ts tests/core/store.test.ts
git commit -m "feat: add SQLite store with CRUD, filtering, state log, and channel queries"
```

### Task 6: Implement markdown renderer and parser

**Files:**
- Create: `src/core/markdown.ts`
- Create: `tests/core/markdown.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/markdown.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, readFileSync, existsSync, writeFileSync } from "fs";
import { join } from "path";
import { renderMarkdown, parseMarkdown, writeMessageFile, readMessageFile } from "../../src/core/markdown";
import { createMessage } from "../../src/core/message";
import { defaultConfig } from "../../src/core/config";
import type { Message } from "../../src/types";

const TEST_DIR = join(import.meta.dir, ".tmp-markdown-test");
const config = defaultConfig();

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("renderMarkdown", () => {
  test("renders message as frontmatter + body", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Test task",
      body: "# Test\n\nSome content",
      author: "test-agent",
      channel: "backend",
    });
    const md = renderMarkdown(msg);
    expect(md).toContain("---");
    expect(md).toContain(`id: ${msg.id}`);
    expect(md).toContain("type: task");
    expect(md).toContain("title: Test task");
    expect(md).toContain("# Test\n\nSome content");
  });

  test("handles null channel and parent_id", () => {
    const msg = createMessage(config, {
      type: "note",
      title: "Note",
      body: "",
      author: "a",
    });
    const md = renderMarkdown(msg);
    expect(md).toContain("channel: null");
    expect(md).toContain("parent_id: null");
  });
});

describe("parseMarkdown", () => {
  test("parses frontmatter + body back to Message", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "Test task",
      body: "Some content",
      author: "test-agent",
      channel: "backend",
      refs: ["msg_ref12345678901"],
      metadata: { priority: "high" },
    });
    const md = renderMarkdown(msg);
    const parsed = parseMarkdown(md);
    expect(parsed.id).toBe(msg.id);
    expect(parsed.type).toBe("task");
    expect(parsed.title).toBe("Test task");
    expect(parsed.body).toBe("Some content");
    expect(parsed.refs).toEqual(["msg_ref12345678901"]);
    expect(parsed.metadata).toEqual({ priority: "high" });
  });

  test("handles body containing --- delimiter", () => {
    const msg = createMessage(config, {
      type: "note",
      title: "Note",
      body: "Before\n---\nAfter",
      author: "a",
    });
    const md = renderMarkdown(msg);
    const parsed = parseMarkdown(md);
    expect(parsed.body).toBe("Before\n---\nAfter");
  });
});

describe("writeMessageFile / readMessageFile", () => {
  test("writes and reads a message file", () => {
    const msg = createMessage(config, {
      type: "task",
      title: "File test",
      body: "Content",
      author: "a",
    });
    const messagesDir = join(TEST_DIR, "messages");
    writeMessageFile(messagesDir, msg);

    const filePath = join(messagesDir, "task", `${msg.id}.md`);
    expect(existsSync(filePath)).toBe(true);

    const read = readMessageFile(filePath);
    expect(read.id).toBe(msg.id);
    expect(read.title).toBe("File test");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/markdown.test.ts`
Expected: FAIL — cannot resolve `../../src/core/markdown`

- [ ] **Step 3: Implement markdown.ts**

Create `src/core/markdown.ts`:

```typescript
import { stringify, parse } from "yaml";
import { mkdirSync, writeFileSync, readFileSync, renameSync } from "fs";
import { join, dirname } from "path";
import type { Message } from "../types";

export function renderMarkdown(msg: Message): string {
  const frontmatter: Record<string, unknown> = {
    id: msg.id,
    type: msg.type,
    status: msg.status,
    title: msg.title,
    author: msg.author,
    channel: msg.channel,
    parent_id: msg.parent_id,
    refs: msg.refs,
    metadata: msg.metadata,
    created_at: msg.created_at,
    updated_at: msg.updated_at,
  };

  const yamlStr = stringify(frontmatter, { lineWidth: 0 });
  return `---\n${yamlStr}---\n\n${msg.body}`;
}

export function parseMarkdown(content: string): Message {
  // Find the first two --- delimiters
  const firstDelim = content.indexOf("---");
  if (firstDelim === -1) throw new Error("Invalid markdown: no frontmatter start delimiter");

  const secondDelim = content.indexOf("---", firstDelim + 3);
  if (secondDelim === -1) throw new Error("Invalid markdown: no frontmatter end delimiter");

  const yamlStr = content.slice(firstDelim + 3, secondDelim).trim();
  const body = content.slice(secondDelim + 3).trim();

  const fm = parse(yamlStr) as Record<string, unknown>;

  return {
    id: fm.id as string,
    type: fm.type as string,
    status: fm.status as Message["status"],
    title: fm.title as string,
    body,
    author: fm.author as string,
    channel: (fm.channel as string) ?? null,
    parent_id: (fm.parent_id as string) ?? null,
    refs: (fm.refs as string[]) ?? [],
    metadata: (fm.metadata as Record<string, unknown>) ?? {},
    created_at: fm.created_at as string,
    updated_at: fm.updated_at as string,
  };
}

export function writeMessageFile(messagesDir: string, msg: Message): string {
  const typeDir = join(messagesDir, msg.type);
  mkdirSync(typeDir, { recursive: true });

  const filePath = join(typeDir, `${msg.id}.md`);
  const tmpPath = `${filePath}.tmp`;
  const content = renderMarkdown(msg);

  // Atomic write: write to temp file, then rename
  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);

  return filePath;
}

export function readMessageFile(filePath: string): Message {
  const content = readFileSync(filePath, "utf-8");
  return parseMarkdown(content);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/markdown.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/markdown.ts tests/core/markdown.test.ts
git commit -m "feat: add markdown renderer and parser with atomic file writes"
```

### Task 7: Implement sync engine

**Files:**
- Create: `src/core/sync.ts`
- Create: `tests/core/sync.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/core/sync.test.ts`:

```typescript
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
    // Write a markdown file directly (simulating SQLite being deleted)
    const msg = createMessage(config, { type: "task", title: "Rebuilt", body: "data", author: "a" });
    writeMessageFile(messagesDir, msg);

    // Rebuild into a fresh store
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
    // Write an invalid file
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

    // Edit the markdown file directly
    const filePath = join(messagesDir, "task", `${msg.id}.md`);
    const edited = { ...msg, title: "Edited", updated_at: new Date(Date.now() + 10000).toISOString() };
    writeFileSync(filePath, renderMarkdown(edited));

    sync.syncFromMarkdown();
    const updated = store.getById(msg.id);
    expect(updated!.title).toBe("Edited");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/core/sync.test.ts`
Expected: FAIL — cannot resolve `../../src/core/sync`

- [ ] **Step 3: Implement sync.ts**

Create `src/core/sync.ts`:

```typescript
import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { Store } from "./store";
import { writeMessageFile, readMessageFile } from "./markdown";

export class SyncEngine {
  constructor(
    private store: Store,
    private messagesDir: string
  ) {}

  /** Render all messages from SQLite to markdown files */
  renderAll(): void {
    const messages = this.store.list({}, { limit: 100000, includeArchived: true });
    for (const msg of messages) {
      writeMessageFile(this.messagesDir, msg);
    }
  }

  /** Render a single message to markdown */
  renderOne(id: string): void {
    const msg = this.store.getById(id);
    if (msg) {
      writeMessageFile(this.messagesDir, msg);
    }
  }

  /** Rebuild SQLite from markdown files (for disaster recovery) */
  rebuild(): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;

    if (!existsSync(this.messagesDir)) {
      return { imported, skipped };
    }

    const typeDirs = readdirSync(this.messagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const typeDir of typeDirs) {
      const dirPath = join(this.messagesDir, typeDir);
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".md") && !f.endsWith(".conflict.md") && !f.endsWith(".tmp"));

      for (const file of files) {
        try {
          const msg = readMessageFile(join(dirPath, file));
          this.store.insert(msg);
          imported++;
        } catch {
          skipped++;
        }
      }
    }

    return { imported, skipped };
  }

  /** Sync edited markdown files back to SQLite */
  syncFromMarkdown(): { updated: number; conflicts: number } {
    let updated = 0;
    let conflicts = 0;

    if (!existsSync(this.messagesDir)) {
      return { updated, conflicts };
    }

    const typeDirs = readdirSync(this.messagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const typeDir of typeDirs) {
      const dirPath = join(this.messagesDir, typeDir);
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".md") && !f.endsWith(".conflict.md") && !f.endsWith(".tmp"));

      for (const file of files) {
        try {
          const filePath = join(dirPath, file);
          const mdMsg = readMessageFile(filePath);
          const dbMsg = this.store.getById(mdMsg.id);

          if (!dbMsg) {
            // New message found in markdown — insert
            this.store.insert(mdMsg);
            updated++;
          } else if (mdMsg.updated_at > dbMsg.updated_at) {
            // Markdown is newer — update SQLite
            this.store.update(mdMsg.id, {
              status: mdMsg.status,
              title: mdMsg.title,
              body: mdMsg.body,
              metadata: mdMsg.metadata,
            });
            updated++;
          }
        } catch {
          conflicts++;
        }
      }
    }

    return { updated, conflicts };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test tests/core/sync.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 5: Commit**

```bash
git add src/core/sync.ts tests/core/sync.test.ts
git commit -m "feat: add sync engine for SQLite ↔ markdown reconciliation"
```

## Chunk 3: CLI Commands (Part 1 — Init, Create, Show, List, Update)

### Task 8: Implement CLI entry point and init command

**Files:**
- Create: `src/cli/index.ts`
- Create: `src/cli/commands/init.ts`
- Create: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/cli/commands.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".tmp-cli-test");
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

async function run(args: string, cwd = TEST_DIR): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args.split(" ").filter(Boolean)], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, AC_AUTHOR: "test-agent" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("ac init", () => {
  test("creates .agent-comm directory with artifacts", async () => {
    const result = await run("init");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(TEST_DIR, ".agent-comm"))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".agent-comm", "store.db"))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".agent-comm", "config.json"))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".agent-comm", "messages"))).toBe(true);
  });

  test("is idempotent", async () => {
    await run("init");
    const result = await run("init");
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test tests/cli/commands.test.ts`
Expected: FAIL — CLI entry point doesn't exist

- [ ] **Step 3: Implement CLI entry point**

Create `src/cli/index.ts`:

```typescript
#!/usr/bin/env bun
import { Command } from "commander";
import { registerInit } from "./commands/init";

const program = new Command();

program
  .name("ac")
  .description("Async communication tool for agent teams")
  .version("0.1.0")
  .option("--global", "Use machine-wide scope (~/.agent-comm)")
  .option("--json", "Output in JSON format");

registerInit(program);

program.parse();
```

- [ ] **Step 4: Implement init command**

Create `src/cli/commands/init.ts`:

```typescript
import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Store } from "../../core/store";
import { defaultConfig } from "../../core/config";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize .agent-comm/ in the current directory")
    .action(() => {
      const opts = program.opts();
      const root = opts.global
        ? join(process.env.HOME ?? "", ".agent-comm")
        : join(process.cwd(), ".agent-comm");

      mkdirSync(root, { recursive: true });
      mkdirSync(join(root, "messages"), { recursive: true });

      // Config — don't overwrite if exists
      const configPath = join(root, "config.json");
      if (!existsSync(configPath)) {
        writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2), "utf-8");
      }

      // Initialize database (creates if not exists, runs migrations)
      const store = new Store(join(root, "store.db"));
      store.close();

      // Touch .last_sync
      const lastSyncPath = join(root, ".last_sync");
      if (!existsSync(lastSyncPath)) {
        writeFileSync(lastSyncPath, new Date().toISOString(), "utf-8");
      }

      console.log(`Initialized ${root}`);
    });
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/index.ts src/cli/commands/init.ts tests/cli/commands.test.ts
git commit -m "feat: add CLI entry point and init command"
```

### Task 9: Implement create command

**Files:**
- Create: `src/cli/commands/create.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac create", () => {
  test("creates a task and returns id", async () => {
    await run("init");
    const result = await run('create task --title "Test task"');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^msg_/);
  });

  test("creates with all options", async () => {
    await run("init");
    const result = await run('create task --title "Full task" --body "Content" --channel backend --author my-agent');
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toMatch(/^msg_/);
  });

  test("creates with --json outputs full message", async () => {
    await run("init");
    const result = await run('create task --title "JSON task" --json');
    expect(result.exitCode).toBe(0);
    const msg = JSON.parse(result.stdout);
    expect(msg.type).toBe("task");
    expect(msg.title).toBe("JSON task");
  });

  test("creates note with initial status open", async () => {
    await run("init");
    const result = await run('create note --title "A note" --json');
    const msg = JSON.parse(result.stdout);
    expect(msg.status).toBe("open");
  });

  test("reads body from stdin", async () => {
    await run("init");
    const proc = Bun.spawn(["bun", "run", CLI, "create", "spec", "--title", "Stdin spec"], {
      cwd: TEST_DIR,
      stdin: new TextEncoder().encode("Body from stdin"),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, AC_AUTHOR: "test-agent" },
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout.trim()).toMatch(/^msg_/);
  });

  test("fails without --title", async () => {
    await run("init");
    const result = await run("create task");
    expect(result.exitCode).toBe(1);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `bun test tests/cli/commands.test.ts`
Expected: New "ac create" tests FAIL

- [ ] **Step 3: Implement create command**

Create `src/cli/commands/create.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot, loadConfig, resolveAuthor } from "../../core/config";
import { Store } from "../../core/store";
import { createMessage } from "../../core/message";
import { SyncEngine } from "../../core/sync";
import { join } from "path";

export function registerCreate(program: Command): void {
  program
    .command("create <type>")
    .description("Create a new message")
    .requiredOption("--title <title>", "Message title")
    .option("--body <body>", "Message body (markdown)")
    .option("--channel <channel>", "Channel/topic")
    .option("--parent <id>", "Parent message ID")
    .option("--author <author>", "Author name")
    .option("--refs <ids>", "Comma-separated ref IDs")
    .option("--metadata <json>", "JSON metadata")
    .action(async (type: string, opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const config = loadConfig(root);
      const author = resolveAuthor(config, opts.author);

      // Read body from stdin if not provided and stdin is piped
      let body = opts.body ?? "";
      if (!body && !process.stdin.isTTY) {
        body = await new Response(process.stdin as any).text();
        body = body.trim();
      }

      const msg = createMessage(config, {
        type,
        title: opts.title,
        body,
        author,
        channel: opts.channel ?? null,
        parent_id: opts.parent ?? null,
        refs: opts.refs ? opts.refs.split(",") : [],
        metadata: opts.metadata ? JSON.parse(opts.metadata) : {},
      });

      const store = new Store(join(root, "store.db"));
      store.insert(msg);
      store.logTransition(msg.id, null, msg.status, author);

      const sync = new SyncEngine(store, join(root, "messages"));
      sync.renderOne(msg.id);

      store.close();

      if (globalOpts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(msg.id);
      }
    });
}
```

- [ ] **Step 4: Register create in index.ts**

Add to `src/cli/index.ts` after the init import:

```typescript
import { registerCreate } from "./commands/create";
```

And after `registerInit(program);`:

```typescript
registerCreate(program);
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS — all tests pass

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/create.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add create command with stdin support and markdown rendering"
```

### Task 10: Implement show command

**Files:**
- Create: `src/cli/commands/show.ts`
- Create: `src/cli/formatters/text.ts`
- Create: `src/cli/formatters/json.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac show", () => {
  test("shows a message by id", async () => {
    await run("init");
    const created = await run('create task --title "Show me"');
    const id = created.stdout;
    const result = await run(`show ${id}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Show me");
    expect(result.stdout).toContain(id);
  });

  test("shows in JSON format", async () => {
    await run("init");
    const created = await run('create task --title "JSON show"');
    const id = created.stdout;
    const result = await run(`show ${id} --json`);
    const msg = JSON.parse(result.stdout);
    expect(msg.id).toBe(id);
    expect(msg.title).toBe("JSON show");
  });

  test("exits with 2 for nonexistent id", async () => {
    await run("init");
    const result = await run("show msg_nonexistent12345");
    expect(result.exitCode).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/commands.test.ts`
Expected: New "ac show" tests FAIL

- [ ] **Step 3: Implement formatters**

Create `src/cli/formatters/text.ts`:

```typescript
import type { Message, StateLogEntry } from "../../types";

export function formatMessage(msg: Message): string {
  const lines: string[] = [];
  lines.push(`[${msg.id}] ${msg.title}`);
  lines.push(`  Type: ${msg.type}  Status: ${msg.status}  Author: ${msg.author}`);
  if (msg.channel) lines.push(`  Channel: ${msg.channel}`);
  if (msg.parent_id) lines.push(`  Parent: ${msg.parent_id}`);
  if (msg.refs.length) lines.push(`  Refs: ${msg.refs.join(", ")}`);
  if (Object.keys(msg.metadata).length) lines.push(`  Metadata: ${JSON.stringify(msg.metadata)}`);
  lines.push(`  Created: ${msg.created_at}  Updated: ${msg.updated_at}`);
  if (msg.body) {
    lines.push("");
    lines.push(msg.body);
  }
  return lines.join("\n");
}

export function formatMessageList(messages: Message[]): string {
  return messages
    .map((msg) => {
      const ch = msg.channel ? ` #${msg.channel}` : "";
      return `${msg.id}  ${msg.status.padEnd(12)} ${msg.type.padEnd(8)} ${msg.title}${ch}`;
    })
    .join("\n");
}

export function formatStateLog(entries: StateLogEntry[]): string {
  return entries
    .map((e) => `${e.changed_at}  ${e.from_status ?? "(created)"} → ${e.to_status}  by ${e.changed_by}`)
    .join("\n");
}

export function formatChannels(channels: { channel: string; count: number }[]): string {
  return channels.map((c) => `#${c.channel}  ${c.count} messages`).join("\n");
}
```

Create `src/cli/formatters/json.ts`:

```typescript
import type { Message, StateLogEntry } from "../../types";

export function formatMessageJson(msg: Message): string {
  return JSON.stringify(msg, null, 2);
}

export function formatMessageListJson(messages: Message[]): string {
  return JSON.stringify(messages, null, 2);
}

export function formatStateLogJson(entries: StateLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function formatChannelsJson(channels: { channel: string; count: number }[]): string {
  return JSON.stringify(channels, null, 2);
}
```

- [ ] **Step 4: Implement show command**

Create `src/cli/commands/show.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot, loadConfig } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessage } from "../formatters/text";
import { formatMessageJson } from "../formatters/json";
import { join } from "path";

export function registerShow(program: Command): void {
  program
    .command("show <id>")
    .description("Show a single message")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const msg = store.getById(id);
      store.close();

      if (!msg) {
        console.error(`Message not found: ${id}`);
        process.exit(2);
      }

      if (globalOpts.json) {
        console.log(formatMessageJson(msg));
      } else {
        console.log(formatMessage(msg));
      }
    });
}
```

- [ ] **Step 5: Register show in index.ts**

Add import and registration for `registerShow`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/show.ts src/cli/formatters/text.ts src/cli/formatters/json.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add show command with text and JSON formatters"
```

### Task 11: Implement list command

**Files:**
- Create: `src/cli/commands/list.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac list", () => {
  test("lists all messages", async () => {
    await run("init");
    await run('create task --title "Task 1"');
    await run('create note --title "Note 1"');
    const result = await run("list");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Task 1");
    expect(result.stdout).toContain("Note 1");
  });

  test("filters by type", async () => {
    await run("init");
    await run('create task --title "Task 1"');
    await run('create note --title "Note 1"');
    const result = await run("list --type task");
    expect(result.stdout).toContain("Task 1");
    expect(result.stdout).not.toContain("Note 1");
  });

  test("filters by channel", async () => {
    await run("init");
    await run('create task --title "FE task" --channel frontend');
    await run('create task --title "BE task" --channel backend');
    const result = await run("list --channel frontend");
    expect(result.stdout).toContain("FE task");
    expect(result.stdout).not.toContain("BE task");
  });

  test("--json outputs array", async () => {
    await run("init");
    await run('create task --title "JSON list"');
    const result = await run("list --json");
    const msgs = JSON.parse(result.stdout);
    expect(Array.isArray(msgs)).toBe(true);
    expect(msgs.length).toBe(1);
  });

  test("empty list returns exit 0", async () => {
    await run("init");
    const result = await run("list");
    expect(result.exitCode).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/commands.test.ts`
Expected: New "ac list" tests FAIL

- [ ] **Step 3: Implement list command**

Create `src/cli/commands/list.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessageList } from "../formatters/text";
import { formatMessageListJson } from "../formatters/json";
import { join } from "path";

export function registerList(program: Command): void {
  program
    .command("list")
    .description("List messages with optional filters")
    .option("--type <type>", "Filter by type")
    .option("--status <status>", "Filter by status")
    .option("--channel <channel>", "Filter by channel")
    .option("--author <author>", "Filter by author")
    .option("--parent <id>", "Filter by parent ID")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Skip results", "0")
    .option("--include-archived", "Include archived messages")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const messages = store.list(
        {
          type: opts.type,
          status: opts.status,
          channel: opts.channel,
          author: opts.author,
          parent_id: opts.parent,
        },
        {
          limit: parseInt(opts.limit),
          offset: parseInt(opts.offset),
          includeArchived: opts.includeArchived,
        }
      );
      store.close();

      if (globalOpts.json) {
        console.log(formatMessageListJson(messages));
      } else if (messages.length === 0) {
        // Empty — exit 0 with no output
      } else {
        console.log(formatMessageList(messages));
      }
    });
}
```

- [ ] **Step 4: Register list in index.ts**

Add import and registration for `registerList`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/list.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add list command with type/status/channel/author filters"
```

### Task 12: Implement update and state transition shorthands

**Files:**
- Create: `src/cli/commands/update.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac update", () => {
  test("updates status", async () => {
    await run("init");
    const created = await run('create task --title "Update me"');
    const id = created.stdout;
    await run(`update ${id} --status open`);
    const result = await run(`show ${id} --json`);
    const msg = JSON.parse(result.stdout);
    expect(msg.status).toBe("open");
  });

  test("updates body", async () => {
    await run("init");
    const created = await run('create task --title "Body test"');
    const id = created.stdout;
    await run(`update ${id} --body "New body"`);
    const result = await run(`show ${id} --json`);
    const msg = JSON.parse(result.stdout);
    expect(msg.body).toBe("New body");
  });

  test("rejects invalid transition", async () => {
    await run("init");
    const created = await run('create task --title "Bad transition"');
    const id = created.stdout;
    const result = await run(`update ${id} --status completed`);
    expect(result.exitCode).toBe(1);
  });
});

describe("ac start/complete/cancel/archive", () => {
  test("start transitions to in_progress", async () => {
    await run("init");
    const created = await run('create command --title "Start me"');
    const id = created.stdout;
    const result = await run(`start ${id}`);
    expect(result.exitCode).toBe(0);
    const show = await run(`show ${id} --json`);
    expect(JSON.parse(show.stdout).status).toBe("in_progress");
  });

  test("complete transitions to completed", async () => {
    await run("init");
    const created = await run('create command --title "Complete me"');
    const id = created.stdout;
    await run(`start ${id}`);
    const result = await run(`complete ${id}`);
    expect(result.exitCode).toBe(0);
    const show = await run(`show ${id} --json`);
    expect(JSON.parse(show.stdout).status).toBe("completed");
  });

  test("archive works from any state", async () => {
    await run("init");
    const created = await run('create task --title "Archive me"');
    const id = created.stdout;
    const result = await run(`archive ${id}`);
    expect(result.exitCode).toBe(0);
    const show = await run(`show ${id} --json`);
    expect(JSON.parse(show.stdout).status).toBe("archived");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/cli/commands.test.ts`
Expected: New tests FAIL

- [ ] **Step 3: Implement update command with shorthands**

Create `src/cli/commands/update.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot, loadConfig, resolveAuthor } from "../../core/config";
import { Store } from "../../core/store";
import { validateTransition } from "../../core/message";
import { SyncEngine } from "../../core/sync";
import { join } from "path";
import type { Status } from "../../types";

function performUpdate(
  program: Command,
  id: string,
  opts: { status?: string; body?: string; metadata?: string; addRef?: string; removeRef?: string; author?: string }
): void {
  const globalOpts = program.opts();
  const root = resolveRoot(process.cwd(), globalOpts.global);
  if (!root) {
    console.error("No .agent-comm/ found. Run `ac init` first.");
    process.exit(1);
  }

  const config = loadConfig(root);
  const store = new Store(join(root, "store.db"));
  const msg = store.getById(id);

  if (!msg) {
    console.error(`Message not found: ${id}`);
    store.close();
    process.exit(2);
  }

  const author = resolveAuthor(config, opts.author);

  // Status transition
  if (opts.status) {
    const newStatus = opts.status as Status;
    validateTransition(config, msg.type, msg.status, newStatus);
    store.update(id, { status: newStatus });
    store.logTransition(id, msg.status, newStatus, author);
  }

  // Body update
  if (opts.body) {
    store.update(id, { body: opts.body });
  }

  // Metadata merge
  if (opts.metadata) {
    store.update(id, { metadata: JSON.parse(opts.metadata) });
  }

  // Ref operations
  if (opts.addRef) {
    store.addRef(id, opts.addRef);
  }
  if (opts.removeRef) {
    store.removeRef(id, opts.removeRef);
  }

  const sync = new SyncEngine(store, join(root, "messages"));
  sync.renderOne(id);

  store.close();

  if (globalOpts.json) {
    const updated = new Store(join(root, "store.db"));
    const result = updated.getById(id);
    updated.close();
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(id);
  }
}

export function registerUpdate(program: Command): void {
  program
    .command("update <id>")
    .description("Update a message")
    .option("--status <status>", "New status")
    .option("--body <body>", "New body")
    .option("--metadata <json>", "Metadata to merge (JSON)")
    .option("--add-ref <id>", "Add a ref")
    .option("--remove-ref <id>", "Remove a ref")
    .option("--author <author>", "Author of this change")
    .action((id: string, opts: any) => {
      try {
        performUpdate(program, id, opts);
      } catch (e: any) {
        console.error(e.message);
        process.exit(1);
      }
    });

  // Shorthands
  for (const [cmd, status, desc] of [
    ["start", "in_progress", "Transition to in_progress"],
    ["complete", "completed", "Transition to completed"],
    ["cancel", "cancelled", "Transition to cancelled"],
    ["archive", "archived", "Archive (soft delete)"],
  ] as const) {
    program
      .command(`${cmd} <id>`)
      .description(desc)
      .option("--metadata <json>", "Metadata to merge")
      .option("--body <body>", "Update body")
      .option("--author <author>", "Author of this change")
      .action((id: string, opts: any) => {
        try {
          performUpdate(program, id, { ...opts, status });
        } catch (e: any) {
          console.error(e.message);
          process.exit(1);
        }
      });
  }
}
```

- [ ] **Step 4: Register update in index.ts**

Add import and registration for `registerUpdate`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/update.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add update command with state transition validation and shorthands"
```

## Chunk 4: CLI Commands (Part 2 — Feed, Thread, Children, Channels, Log, Sync, Export)

### Task 13: Implement feed command

**Files:**
- Create: `src/cli/commands/feed.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac feed", () => {
  test("shows recent messages", async () => {
    await run("init");
    await run('create task --title "Feed task"');
    await run('create note --title "Feed note"');
    const result = await run("feed");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Feed note");
    expect(result.stdout).toContain("Feed task");
  });

  test("filters by channel", async () => {
    await run("init");
    await run('create task --title "FE" --channel frontend');
    await run('create task --title "BE" --channel backend');
    const result = await run("feed --channel frontend");
    expect(result.stdout).toContain("FE");
    expect(result.stdout).not.toContain("BE");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement feed command**

Create `src/cli/commands/feed.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessageList } from "../formatters/text";
import { formatMessageListJson } from "../formatters/json";
import { join } from "path";

export function registerFeed(program: Command): void {
  program
    .command("feed")
    .description("Show recent messages chronologically")
    .option("--channel <channel>", "Filter by channel")
    .option("--since <timestamp>", "Only messages after this ISO timestamp")
    .option("--limit <n>", "Max results", "50")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const messages = store.feed(
        { channel: opts.channel, since: opts.since },
        { limit: parseInt(opts.limit) }
      );
      store.close();

      if (globalOpts.json) {
        console.log(formatMessageListJson(messages));
      } else if (messages.length > 0) {
        console.log(formatMessageList(messages));
      }
    });
}
```

- [ ] **Step 4: Register feed in index.ts**

- [ ] **Step 5: Run tests to verify they pass**

- [ ] **Step 6: Commit**

```bash
git add src/cli/commands/feed.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add feed command with channel and since filters"
```

### Task 14: Implement thread, children, channels, and log commands

**Files:**
- Create: `src/cli/commands/thread.ts`
- Create: `src/cli/commands/children.ts`
- Create: `src/cli/commands/channels.ts`
- Create: `src/cli/commands/log.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac children", () => {
  test("lists child messages", async () => {
    await run("init");
    const parent = await run('create plan --title "Parent plan"');
    const parentId = parent.stdout;
    await run(`create task --title "Child 1" --parent ${parentId}`);
    await run(`create task --title "Child 2" --parent ${parentId}`);
    const result = await run(`children ${parentId}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Child 1");
    expect(result.stdout).toContain("Child 2");
  });
});

describe("ac thread", () => {
  test("shows message with children", async () => {
    await run("init");
    const parent = await run('create plan --title "Thread plan"');
    const parentId = parent.stdout;
    await run(`create task --title "Thread child" --parent ${parentId}`);
    const result = await run(`thread ${parentId}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Thread plan");
    expect(result.stdout).toContain("Thread child");
  });
});

describe("ac channels", () => {
  test("lists channels with counts", async () => {
    await run("init");
    await run('create task --title "T1" --channel backend');
    await run('create task --title "T2" --channel backend');
    await run('create note --title "N1" --channel frontend');
    const result = await run("channels");
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("backend");
    expect(result.stdout).toContain("frontend");
  });
});

describe("ac log", () => {
  test("shows state transition history", async () => {
    await run("init");
    const created = await run('create command --title "Log me"');
    const id = created.stdout;
    await run(`start ${id}`);
    await run(`complete ${id}`);
    const result = await run(`log ${id}`);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("open");
    expect(result.stdout).toContain("in_progress");
    expect(result.stdout).toContain("completed");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement thread command**

Create `src/cli/commands/thread.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessage, formatMessageList } from "../formatters/text";
import { join } from "path";

export function registerThread(program: Command): void {
  program
    .command("thread <id>")
    .description("Show message with full thread (parent + children + refs)")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const msg = store.getById(id);

      if (!msg) {
        console.error(`Message not found: ${id}`);
        store.close();
        process.exit(2);
      }

      const children = store.getChildren(id);
      const refs = msg.refs.map((refId) => store.getById(refId)).filter(Boolean);

      store.close();

      if (globalOpts.json) {
        console.log(JSON.stringify({ message: msg, children, refs }, null, 2));
      } else {
        console.log(formatMessage(msg));
        if (children.length) {
          console.log("\n--- Children ---");
          console.log(formatMessageList(children));
        }
        if (refs.length) {
          console.log("\n--- Refs ---");
          console.log(formatMessageList(refs as any));
        }
      }
    });
}
```

- [ ] **Step 4: Implement children command**

Create `src/cli/commands/children.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessageList } from "../formatters/text";
import { formatMessageListJson } from "../formatters/json";
import { join } from "path";

export function registerChildren(program: Command): void {
  program
    .command("children <id>")
    .description("List child messages of a parent")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const children = store.getChildren(id);
      store.close();

      if (globalOpts.json) {
        console.log(formatMessageListJson(children));
      } else if (children.length > 0) {
        console.log(formatMessageList(children));
      }
    });
}
```

- [ ] **Step 5: Implement channels command**

Create `src/cli/commands/channels.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatChannels } from "../formatters/text";
import { formatChannelsJson } from "../formatters/json";
import { join } from "path";

export function registerChannels(program: Command): void {
  program
    .command("channels")
    .description("List channels with message counts")
    .action(() => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const channels = store.getChannels();
      store.close();

      if (globalOpts.json) {
        console.log(formatChannelsJson(channels));
      } else if (channels.length > 0) {
        console.log(formatChannels(channels));
      }
    });
}
```

- [ ] **Step 6: Implement log command**

Create `src/cli/commands/log.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatStateLog } from "../formatters/text";
import { formatStateLogJson } from "../formatters/json";
import { join } from "path";

export function registerLog(program: Command): void {
  program
    .command("log <id>")
    .description("Show state transition history for a message")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const msg = store.getById(id);

      if (!msg) {
        console.error(`Message not found: ${id}`);
        store.close();
        process.exit(2);
      }

      const log = store.getStateLog(id);
      store.close();

      if (globalOpts.json) {
        console.log(formatStateLogJson(log));
      } else if (log.length > 0) {
        console.log(formatStateLog(log));
      }
    });
}
```

- [ ] **Step 7: Register all four commands in index.ts**

Add imports and registrations for `registerThread`, `registerChildren`, `registerChannels`, `registerLog`.

- [ ] **Step 8: Run tests to verify they pass**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/cli/commands/thread.ts src/cli/commands/children.ts src/cli/commands/channels.ts src/cli/commands/log.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add thread, children, channels, and log commands"
```

### Task 15: Implement sync and export commands

**Files:**
- Create: `src/cli/commands/sync.ts`
- Create: `src/cli/commands/export.ts`
- Modify: `src/cli/index.ts`
- Modify: `tests/cli/commands.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `tests/cli/commands.test.ts`:

```typescript
describe("ac sync", () => {
  test("sync runs without error", async () => {
    await run("init");
    await run('create task --title "Sync test"');
    const result = await run("sync");
    expect(result.exitCode).toBe(0);
  });
});

describe("ac export", () => {
  test("exports messages as NDJSON", async () => {
    await run("init");
    await run('create task --title "Export 1"');
    await run('create note --title "Export 2"');
    const result = await run("export");
    expect(result.exitCode).toBe(0);
    const lines = result.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).title).toBeDefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement sync command**

Create `src/cli/commands/sync.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { SyncEngine } from "../../core/sync";
import { join } from "path";
import { writeFileSync } from "fs";

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Reconcile markdown files with SQLite")
    .option("--rebuild", "Rebuild SQLite from markdown files")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const sync = new SyncEngine(store, join(root, "messages"));

      if (opts.rebuild) {
        const result = sync.rebuild();
        console.log(`Rebuilt: ${result.imported} imported, ${result.skipped} skipped`);
      } else {
        const result = sync.syncFromMarkdown();
        sync.renderAll();
        console.log(`Synced: ${result.updated} updated, ${result.conflicts} conflicts`);
      }

      // Update .last_sync
      writeFileSync(join(root, ".last_sync"), new Date().toISOString(), "utf-8");

      store.close();
    });
}
```

- [ ] **Step 4: Implement export command**

Create `src/cli/commands/export.ts`:

```typescript
import { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { join } from "path";

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("Export all messages")
    .option("--format <format>", "Output format: json (NDJSON) or md (tar)", "json")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));

      if (opts.format === "json") {
        const messages = store.list({}, { limit: 100000, includeArchived: true });
        for (const msg of messages) {
          console.log(JSON.stringify(msg));
        }
      } else if (opts.format === "md") {
        // Tar the messages directory to stdout
        const messagesDir = join(root, "messages");
        const proc = Bun.spawnSync(["tar", "-cf", "-", "-C", root, "messages"], {
          stdout: "inherit",
          stderr: "pipe",
        });
        if (proc.exitCode !== 0) {
          console.error("Failed to create tar archive");
          process.exit(1);
        }
      }

      store.close();
    });
}
```

- [ ] **Step 5: Register sync and export in index.ts**

Add imports and registrations for `registerSync` and `registerExport`.

- [ ] **Step 6: Run tests to verify they pass**

Run: `bun test tests/cli/commands.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/cli/commands/sync.ts src/cli/commands/export.ts src/cli/index.ts tests/cli/commands.test.ts
git commit -m "feat: add sync and export commands"
```

## Chunk 5: Telemetry (OpenTelemetry)

### Task 16: Implement OTEL telemetry layer

**Files:**
- Create: `src/telemetry/index.ts`
- Create: `src/telemetry/metrics.ts`
- Create: `src/telemetry/traces.ts`
- Create: `src/telemetry/logs.ts`
- Create: `tests/telemetry/telemetry.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/telemetry/telemetry.test.ts`:

```typescript
import { describe, expect, test } from "bun:test";
import { initTelemetry, getTracer, getMetrics, shutdownTelemetry } from "../../src/telemetry/index";

describe("telemetry", () => {
  test("returns no-op tracer when unconfigured", () => {
    initTelemetry(null);
    const tracer = getTracer();
    expect(tracer).toBeDefined();
    // Should not throw when creating spans
    const span = tracer.startSpan("test");
    span.end();
  });

  test("returns no-op metrics when unconfigured", () => {
    initTelemetry(null);
    const meter = getMetrics();
    expect(meter).toBeDefined();
    // Should not throw when creating counters
    const counter = meter.createCounter("test_counter");
    counter.add(1);
  });

  test("shutdown does not throw when unconfigured", async () => {
    initTelemetry(null);
    await expect(shutdownTelemetry()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test tests/telemetry/telemetry.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement telemetry index**

Create `src/telemetry/index.ts`:

```typescript
import { trace, metrics, type Tracer, type Meter } from "@opentelemetry/api";
import type { OtelConfig } from "../types";

let initialized = false;
let sdk: any = null;

export function initTelemetry(config: OtelConfig | null): void {
  if (initialized) return;
  initialized = true;

  if (!config) return; // No-op — OTEL API returns no-op implementations by default

  // Lazy-load the SDK only when configured
  try {
    const { NodeSDK } = require("@opentelemetry/sdk-node");
    const { OTLPTraceExporter } = require("@opentelemetry/exporter-trace-otlp-http");
    const { OTLPMetricExporter } = require("@opentelemetry/exporter-metrics-otlp-http");
    const { PeriodicExportingMetricReader } = require("@opentelemetry/sdk-metrics");

    sdk = new NodeSDK({
      serviceName: "agent-comm",
      traceExporter: new OTLPTraceExporter({ url: `${config.endpoint}/v1/traces` }),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${config.endpoint}/v1/metrics` }),
        exportIntervalMillis: 5000,
      }),
    });
    sdk.start();
  } catch {
    // If SDK packages aren't available, silently fall back to no-op
  }
}

export function getTracer(): Tracer {
  return trace.getTracer("agent-comm");
}

export function getMetrics(): Meter {
  return metrics.getMeter("agent-comm");
}

export async function shutdownTelemetry(): Promise<void> {
  if (sdk) {
    await sdk.shutdown();
  }
}
```

- [ ] **Step 4: Implement metrics helpers**

Create `src/telemetry/metrics.ts`:

```typescript
import { getMetrics } from "./index";

export function recordMessageCreated(type: string, channel: string | null): void {
  const meter = getMetrics();
  const counter = meter.createCounter("ac.messages.created", {
    description: "Number of messages created",
  });
  counter.add(1, { type, channel: channel ?? "none" });
}

export function recordStateTransition(type: string, from: string | null, to: string): void {
  const meter = getMetrics();
  const counter = meter.createCounter("ac.messages.transitions", {
    description: "Number of state transitions",
  });
  counter.add(1, { type, from: from ?? "none", to });
}

export function recordCommandLatency(command: string, durationMs: number): void {
  const meter = getMetrics();
  const histogram = meter.createHistogram("ac.command.duration_ms", {
    description: "CLI command duration in milliseconds",
  });
  histogram.record(durationMs, { command });
}
```

- [ ] **Step 5: Implement traces helpers**

Create `src/telemetry/traces.ts`:

```typescript
import { SpanStatusCode, type Span } from "@opentelemetry/api";
import { getTracer } from "./index";

export function startCommandSpan(command: string, args: Record<string, string> = {}): Span {
  const tracer = getTracer();
  return tracer.startSpan(`ac.${command}`, {
    attributes: {
      "ac.command": command,
      ...Object.fromEntries(Object.entries(args).map(([k, v]) => [`ac.${k}`, v])),
    },
  });
}

export function endSpanOk(span: Span): void {
  span.setStatus({ code: SpanStatusCode.OK });
  span.end();
}

export function endSpanError(span: Span, error: Error): void {
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
  span.recordException(error);
  span.end();
}
```

- [ ] **Step 6: Implement logs helpers**

Create `src/telemetry/logs.ts`:

```typescript
import { getTracer } from "./index";

export function logStateTransition(
  messageId: string,
  fromStatus: string | null,
  toStatus: string,
  changedBy: string
): void {
  const tracer = getTracer();
  const span = tracer.startSpan("ac.state_transition", {
    attributes: {
      "ac.message_id": messageId,
      "ac.from_status": fromStatus ?? "none",
      "ac.to_status": toStatus,
      "ac.changed_by": changedBy,
    },
  });
  span.end();
}

export function logSyncConflict(messageId: string, resolution: string): void {
  const tracer = getTracer();
  const span = tracer.startSpan("ac.sync_conflict", {
    attributes: {
      "ac.message_id": messageId,
      "ac.resolution": resolution,
    },
  });
  span.end();
}
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `bun test tests/telemetry/telemetry.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/telemetry/ tests/telemetry/
git commit -m "feat: add opt-in OpenTelemetry with metrics, traces, and structured logs"
```

## Chunk 6: Integration & Polish

### Task 17: Wire telemetry into CLI commands

**Files:**
- Modify: `src/cli/index.ts`
- Modify: `src/cli/commands/create.ts`
- Modify: `src/cli/commands/update.ts`

- [ ] **Step 1: Add telemetry initialization to CLI entry point**

In `src/cli/index.ts`, after parsing but before command execution, add:

```typescript
import { initTelemetry, shutdownTelemetry } from "../telemetry/index";
import { loadConfig, resolveRoot } from "../core/config";
```

Add a hook that runs before any command:

```typescript
program.hook("preAction", () => {
  const opts = program.opts();
  const root = resolveRoot(process.cwd(), opts.global);
  if (root) {
    const config = loadConfig(root);
    initTelemetry(config.otel);
  } else {
    initTelemetry(null);
  }
});

program.hook("postAction", async () => {
  await shutdownTelemetry();
});
```

- [ ] **Step 2: Add telemetry calls to create command**

In `src/cli/commands/create.ts`, after inserting the message, add:

```typescript
import { recordMessageCreated } from "../../telemetry/metrics";
import { startCommandSpan, endSpanOk } from "../../telemetry/traces";
```

Wrap the action body with span tracking and call `recordMessageCreated(type, opts.channel)`.

- [ ] **Step 3: Add telemetry calls to update command**

In `src/cli/commands/update.ts`, after successful status transition, add:

```typescript
import { recordStateTransition } from "../../telemetry/metrics";
import { logStateTransition } from "../../telemetry/logs";
```

Call `recordStateTransition(msg.type, msg.status, newStatus)` and `logStateTransition(id, msg.status, newStatus, author)`.

- [ ] **Step 4: Run all tests to verify nothing is broken**

Run: `bun test`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli/index.ts src/cli/commands/create.ts src/cli/commands/update.ts
git commit -m "feat: wire OpenTelemetry into create and update commands"
```

### Task 18: Add end-to-end integration test

**Files:**
- Create: `tests/e2e/workflow.test.ts`

- [ ] **Step 1: Write the integration test**

Create `tests/e2e/workflow.test.ts`:

```typescript
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync } from "fs";
import { join } from "path";

const TEST_DIR = join(import.meta.dir, ".tmp-e2e-test");
const CLI = join(import.meta.dir, "../../src/cli/index.ts");

beforeEach(() => {
  mkdirSync(TEST_DIR, { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

async function run(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args.split(" ").filter(Boolean)], {
    cwd: TEST_DIR,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, AC_AUTHOR: "orchestrator" },
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;
  return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
}

describe("full agent workflow", () => {
  test("plan → tasks → execute → complete", async () => {
    // Init
    await run("init");

    // Orchestrator creates a plan
    const plan = await run('create plan --title "Auth redesign" --body "Redesign the auth system" --channel backend');
    expect(plan.exitCode).toBe(0);
    const planId = plan.stdout;

    // Orchestrator creates tasks under the plan
    const task1 = await run(`create task --title "Add JWT middleware" --parent ${planId} --channel backend`);
    const task1Id = task1.stdout;
    const task2 = await run(`create task --title "Write auth tests" --parent ${planId} --channel backend`);
    const task2Id = task2.stdout;

    // Verify children
    const children = await run(`children ${planId} --json`);
    const childList = JSON.parse(children.stdout);
    expect(childList).toHaveLength(2);

    // Agent picks up task 1: draft → open → in_progress → completed
    await run(`update ${task1Id} --status open`);
    await run(`start ${task1Id}`);
    await run(`complete ${task1Id} --metadata '{"result": "JWT middleware added"}'`);

    // Verify task 1 is completed
    const show1 = await run(`show ${task1Id} --json`);
    const msg1 = JSON.parse(show1.stdout);
    expect(msg1.status).toBe("completed");
    expect(msg1.metadata.result).toBe("JWT middleware added");

    // Check state log
    const log = await run(`log ${task1Id} --json`);
    const logEntries = JSON.parse(log.stdout);
    expect(logEntries.length).toBeGreaterThanOrEqual(3);

    // Verify markdown files exist
    expect(existsSync(join(TEST_DIR, ".agent-comm", "messages", "plan", `${planId}.md`))).toBe(true);
    expect(existsSync(join(TEST_DIR, ".agent-comm", "messages", "task", `${task1Id}.md`))).toBe(true);

    // Check channels
    const channels = await run("channels --json");
    const chList = JSON.parse(channels.stdout);
    expect(chList.find((c: any) => c.channel === "backend")).toBeDefined();

    // Archive task 2 (no longer needed)
    await run(`archive ${task2Id}`);
    const list = await run("list --type task --json");
    const tasks = JSON.parse(list.stdout);
    expect(tasks.find((t: any) => t.id === task2Id)).toBeUndefined(); // excluded by default

    // Export
    const exported = await run("export");
    expect(exported.exitCode).toBe(0);
    const lines = exported.stdout.split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThanOrEqual(3); // plan + 2 tasks (including archived)
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `bun test tests/e2e/workflow.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/workflow.test.ts
git commit -m "test: add end-to-end agent workflow integration test"
```

### Task 19: Make CLI executable and verify bun link

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Ensure the CLI shebang is correct**

Verify `src/cli/index.ts` starts with `#!/usr/bin/env bun`.

- [ ] **Step 2: Link the package locally**

Run: `bun link`
Expected: `ac` and `agent-comm` commands become available globally.

- [ ] **Step 3: Verify the CLI works end-to-end**

Run in a temp directory:
```bash
mkdir /tmp/ac-test && cd /tmp/ac-test
ac init
ac create task --title "Hello from CLI"
ac list
ac show <id-from-above>
```
Expected: All commands succeed.

- [ ] **Step 4: Run all tests**

Run: `bun test`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add package.json
git commit -m "chore: verify CLI linkability and add final polish"
```

### Task 20: Run full test suite and final cleanup

- [ ] **Step 1: Run complete test suite**

Run: `bun test`
Expected: All tests pass with no warnings.

- [ ] **Step 2: Verify no TypeScript errors**

Run: `bun run tsc --noEmit`
Expected: No errors.

- [ ] **Step 3: Final commit if any cleanup needed**

```bash
git add -A
git commit -m "chore: final cleanup and type checking"
```
