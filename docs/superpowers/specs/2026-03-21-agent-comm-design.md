# Agent-Comm (ac) — Design Specification

**Date:** 2026-03-21
**Status:** Draft

## Overview

`ac` is a CLI-first async communication tool for agent teams. It provides a structured message board on the local filesystem that any CLI tool can interact with — no servers, no network, no agent-specific dependencies.

The core problem: developer-facing AI agents (Claude Code, Cursor, Codex, shell scripts, custom agents) are CLI processes that start, do work, and exit. They need to leave structured context for other agents or themselves to pick up asynchronously. Existing protocols (A2A, ACP) solve networked service-to-service communication. `ac` solves **local, file-based, async agent coordination**.

## What Makes `ac` Different

- **Zero infrastructure** — no servers, no network, just `ac init`
- **Any CLI tool can participate** — if it can shell out to `ac` or read a markdown file, it's integrated
- **Human-readable by default** — browse `.agent-comm/messages/` to see what agents are doing
- **Stateful work tracking** — plans, tasks, specs with state transitions, not just message passing
- **Dual representation** — SQLite for structured queries, markdown for humans and file-reading agents
- **Opt-in observability** — OpenTelemetry integration for metrics/traces when a collector is configured

## 1. Core Data Model

Every piece of data is a **Message**. A message has:

| Field | Type | Description |
|-------|------|-------------|
| `id` | `string` | Unique identifier (`msg_` prefix + 16-char nanoid, e.g. `msg_V1StGXR8_Z5jdHi6`) |
| `type` | `string` | Message type: `plan`, `spec`, `task`, `note`, `command`, or custom |
| `status` | `string` | Current state: `draft`, `open`, `in_progress`, `completed`, `cancelled` |
| `title` | `string` | Short summary |
| `body` | `string` | Markdown content |
| `author` | `string` | Agent name or `human`. See Author Resolution section for default behavior |
| `channel` | `string \| null` | Optional topic/channel (e.g. `frontend`, `review`) |
| `parent_id` | `string \| null` | Reference to parent message (e.g. task → plan) |
| `refs` | `string[]` | IDs of related messages. On create: `--refs id1,id2`. On update: `--add-ref id` / `--remove-ref id` |
| `metadata` | `JSON` | Flexible key-value for type-specific data |
| `created_at` | `ISO timestamp` | Creation time |
| `updated_at` | `ISO timestamp` | Last modification time |

### Design Decisions

- **`type` is a string, not an enum** — new types can be added without schema changes.
- **`parent_id`** gives hierarchical relationships (plan → tasks) without a complex relational model.
- **`refs`** allows loose cross-references between any messages.
- **`channel`** is optional — messages without a channel live on the shared board.
- **`metadata`** is the escape hatch for type-specific fields (e.g. a task might have `assignee`, `priority`).

### State Transitions

State transitions are validated per type and defined in `.agent-comm/config.json`:

- **task:** `draft → open → in_progress → completed | cancelled`
- **plan/spec:** `draft → open → in_progress → completed | cancelled`
- **note:** Created directly as `open`. Valid states: `open | cancelled`
- **command:** Created directly as `open`. Valid states: `open → in_progress → completed | cancelled`

The default initial status for `create` is `draft`, except for `note` and `command` which start as `open`.

Custom types are limited to the six canonical statuses (`draft`, `open`, `in_progress`, `completed`, `cancelled`, `archived`) but allow unrestricted transitions between them unless configured otherwise. Arbitrary status strings are not permitted.

### Message Deletion

Messages are **soft-deleted** via `ac archive <id>`, which sets status to `archived`. `ac archive` bypasses normal transition validation — any message in any non-archived state can be archived. It is a system-level operation, not a workflow transition. Archived messages are excluded from `list` and `feed` by default but can be included with `--include-archived`. No hard delete — the message board is an audit trail.

### Author Resolution

The `author` field is resolved with this precedence (highest first):

1. `--author` CLI flag
2. `$AC_AUTHOR` environment variable
3. `author` field in `.agent-comm/config.json`
4. System username (`os.userInfo().username`)

## 2. Storage Layer

Dual storage — SQLite as source of truth, markdown files for readability.

### SQLite (`<root>/.agent-comm/store.db`)

WAL mode enabled for concurrent read access. Schema version tracked via `PRAGMA user_version`.

**DDL:**

```sql
-- Schema version 1
PRAGMA user_version = 1;

CREATE TABLE messages (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'draft',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL,
  channel     TEXT,
  parent_id   TEXT REFERENCES messages(id),
  refs        TEXT NOT NULL DEFAULT '[]',   -- JSON array of message IDs
  metadata    TEXT NOT NULL DEFAULT '{}',   -- JSON object
  created_at  TEXT NOT NULL,                -- ISO 8601
  updated_at  TEXT NOT NULL                 -- ISO 8601
);

CREATE INDEX idx_messages_type      ON messages(type);
CREATE INDEX idx_messages_status    ON messages(status);
CREATE INDEX idx_messages_channel   ON messages(channel);
CREATE INDEX idx_messages_parent_id ON messages(parent_id);
CREATE INDEX idx_messages_author    ON messages(author);

CREATE TABLE state_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  TEXT NOT NULL REFERENCES messages(id),
  from_status TEXT,
  to_status   TEXT NOT NULL,
  changed_by  TEXT NOT NULL,      -- author of the change
  changed_at  TEXT NOT NULL       -- ISO 8601
);

CREATE INDEX idx_state_log_message_id ON state_log(message_id);
```

**Schema migrations:** On `ac init` or first command, the CLI checks `PRAGMA user_version` against the expected version. If behind, it runs migration scripts sequentially. Migrations are embedded in the binary, not external files.

### Markdown Files (`<root>/.agent-comm/messages/<type>/<id>.md`)

One file per message, organized by type directory. Format:

```markdown
---
id: msg_a1b2c3
type: task
status: in_progress
title: Implement auth middleware
author: architect-agent
channel: backend
parent_id: msg_x9y8z7
refs: [msg_d4e5f6]
metadata:
  assignee: coder-agent
  priority: high
created_at: 2026-03-21T10:00:00Z
updated_at: 2026-03-21T11:30:00Z
---

# Implement auth middleware

Add JWT validation middleware to the Express router...
```

### Sync Rules

- **SQLite is the source of truth.** Markdown files are rendered on every write operation.
- **Direct markdown edits** are reconciled via `ac sync`, which compares frontmatter `updated_at` vs SQLite.
- **Conflicts** (both changed): SQLite wins, markdown backup saved as `<id>.conflict.md`.
- **Reconstruction:** If SQLite is deleted, `ac sync --rebuild` reconstructs from markdown (invalid/partial files are skipped with warnings). If markdown is deleted, `ac sync` regenerates from SQLite.
- **Auto-sync:** Before read commands, the CLI compares the mtime of the `messages/` directory against a `.last_sync` timestamp file. If the directory is newer, a full sync runs. This can be disabled with `--no-sync` on any read command.

### Markdown Parsing

Frontmatter is delimited by the first two `---` lines in the file. Everything after the second `---` delimiter is treated as the body. Body content may contain `---` without being misinterpreted as frontmatter.

### Scope Resolution

- **Project scope (default):** The CLI walks up from the current working directory looking for a `.agent-comm/` directory (similar to how git finds `.git/`). If none is found, commands fail with an error suggesting `ac init`.
- **Machine scope:** `~/.agent-comm/` in the user's home directory.
- CLI flag `--global` to target machine scope, bypassing project scope resolution.

### `ac init` Artifacts

Running `ac init` creates:

```
.agent-comm/
├── store.db          # SQLite database (WAL mode)
├── config.json       # Configuration with defaults
├── .last_sync        # Timestamp file for auto-sync
└── messages/         # Markdown file directory (empty)
```

Re-running `ac init` on an existing directory is idempotent: missing files are created, existing files are not overwritten, and schema migrations run if needed.

### `config.json` Schema

```json
{
  "version": 1,
  "author": null,
  "transitions": {
    "task":    { "initial": "draft",  "allowed": {"draft": ["open"], "open": ["in_progress", "cancelled"], "in_progress": ["completed", "cancelled"]} },
    "plan":    { "initial": "draft",  "allowed": {"draft": ["open"], "open": ["in_progress", "cancelled"], "in_progress": ["completed", "cancelled"]} },
    "spec":    { "initial": "draft",  "allowed": {"draft": ["open"], "open": ["in_progress", "cancelled"], "in_progress": ["completed", "cancelled"]} },
    "note":    { "initial": "open",   "allowed": {"open": ["cancelled"]} },
    "command": { "initial": "open",   "allowed": {"open": ["in_progress", "cancelled"], "in_progress": ["completed", "cancelled"]} }
  },
  "otel": null
}
```

| Key | Type | Description |
|-----|------|-------------|
| `version` | `number` | Config schema version |
| `author` | `string \| null` | Default author. See Author Resolution in Section 1 for full precedence |
| `transitions` | `object` | Per-type state machine definitions. `initial` = status on create, `allowed` = valid from→to transitions |
| `otel` | `object \| null` | OpenTelemetry config. `null` = disabled. See Section 5 |

## 3. CLI Interface

The tool is invoked as `ac` (short alias for `agent-comm`).

### Core Commands

```
# Initialize
ac init                              # Create .agent-comm/ in current directory (idempotent — safe to re-run)
ac init --global                     # Create ~/.agent-comm/

# Create messages
ac create <type> --title "..." [--body "..."] [--channel ...] [--parent ...] [--author ...]
echo "markdown content" | ac create spec --title "Auth spec"    # Pipe body from stdin

# Read messages
ac show <id>                         # Show single message
ac list [--type] [--status] [--channel] [--author] [--parent]   # Filter messages
ac feed [--channel] [--since]        # Recent messages, chronological

# Update messages
ac update <id> [--status] [--body] [--metadata '{}']

# State transition shorthands (accept optional --metadata and --body)
ac start <id>                        # → in_progress
ac complete <id>                     # → completed
ac cancel <id>                       # → cancelled
ac archive <id>                      # → archived (soft delete)

# History
ac log <id>                          # Show state transition history for a message

# Relationships
ac children <id>                     # List child messages
ac thread <id>                       # Full thread: parent + children + refs

# Channels
ac channels                          # List channels with message counts

# Sync & maintenance
ac sync                              # Reconcile markdown ↔ SQLite
ac sync --rebuild                    # Reconstruct SQLite from markdown
ac export [--format json|md]         # Dump all messages

# Machine-wide
ac --global list                     # Query machine-scope messages
ac --global create ...               # Create in machine scope
```

### Output Behavior

- Default output is **plain text** for human readability.
- `--json` flag on any command for machine-parseable output.
- All write commands return the message ID to stdout for chaining.
- Exit codes: `0` success (including empty result sets), `1` error, `2` not found (invalid ID lookup only, e.g. `ac show nonexistent_id`).

### Pagination

- `ac list` defaults to 50 results.
- `--limit` and `--offset` for pagination.
- `ac feed` supports `--since` for incremental reads.

### Export Format

- `ac export` defaults to JSON format.
- `ac export --format json`: NDJSON (one JSON object per line, one message per line). Suitable for piping to `jq`.
- `ac export --format md`: Tar archive of the `messages/` directory to stdout. Pipe to file: `ac export --format md > backup.tar`.

## 4. Agent Integration Patterns

### Discovering Work

```bash
ac list --type task --status open --json | jq '.[] | select(.metadata.assignee == "my-agent")'
ac feed --channel backend --since "2026-03-21T10:00:00Z" --json
```

### Context Handoff

```bash
ac create note --title "Handoff: auth implementation" \
  --body "$(cat context.md)" \
  --channel handoff \
  --metadata '{"to": "agent-b", "session_id": "abc123"}'
```

### Commanding Another Agent

```bash
# Orchestrator posts a command
ac create command --title "Run test suite" \
  --metadata '{"to": "test-agent", "args": ["--coverage"]}' \
  --channel commands

# Target agent picks up, executes, completes
ac start msg_xyz
ac complete msg_xyz --metadata '{"result": "all 42 tests passed"}'
```

### Session Resume

```bash
ac thread msg_root --json       # Full context thread
ac feed --channel backend --json  # Channel history
```

### Plan → Task Breakdown

```bash
ac create plan --title "Auth redesign" --body "$(cat plan.md)" --channel backend
ac create task --title "Add JWT middleware" --parent msg_plan_id --channel backend
ac create task --title "Write auth tests" --parent msg_plan_id --channel backend
ac children msg_plan_id
```

## 5. Observability (OpenTelemetry)

OTEL integration is **fully opt-in**. When no exporter is configured, all telemetry code is a no-op with zero performance cost.

### Configuration

Enabled by setting an exporter in `.agent-comm/config.json` or via environment variable:

```json
{
  "otel": {
    "exporter": "otlp",
    "endpoint": "http://localhost:4318"
  }
}
```

Or: `AC_OTEL_ENDPOINT=http://localhost:4318`

When unconfigured, the OTEL SDK is never initialized — no overhead.

### Signals Captured

**Message-level metrics:**
- Messages created/completed per hour, by type, channel, author
- Average time in each state (open → in_progress → completed)
- Active message counts by status

**Agent performance traces:**
- Span per CLI command execution
- Task lifecycle spans: creation → start → completion with duration
- Parent-child span linking for plan → task hierarchies

**System health metrics:**
- CLI command latency (per command type)
- SQLite query duration
- Sync operation duration and conflict counts

**Structured logs:**
- State transition events with before/after states
- Sync conflicts and resolutions
- Errors with full context

### Export Behavior

- Telemetry is batched and flushed on process exit.
- For the CLI (short-lived process), uses a synchronous exporter flush with a short timeout (~100ms).
- A future UI can connect directly to the same OTEL collector (Jaeger, Grafana, etc.).

## 6. Error Handling

- **Invalid state transitions:** Rejected with clear error message and exit code 1.
- **Concurrent writes:** SQLite WAL mode handles serialization. Markdown writes are atomic (write to temp file, rename). Two agents updating the same message simultaneously results in **last-write-wins** semantics — no optimistic locking. This is acceptable for the single-machine use case where true simultaneous writes are rare.
- **Markdown drift:** `ac sync` reconciles. Conflicts: SQLite wins, backup saved as `<id>.conflict.md`.
- **Missing data:** Either storage side (SQLite or markdown) can fully reconstruct the other.
- **No retry logic, no networking, no auth.** Single machine, file-based, trust the filesystem.

## 7. Project Structure

```
agent-comm/
├── package.json
├── tsconfig.json
├── bunfig.toml
├── src/
│   ├── cli/
│   │   ├── index.ts              # Entry point, argument parsing
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── create.ts
│   │   │   ├── show.ts
│   │   │   ├── list.ts
│   │   │   ├── update.ts
│   │   │   ├── feed.ts
│   │   │   ├── thread.ts
│   │   │   ├── children.ts
│   │   │   ├── channels.ts
│   │   │   ├── log.ts
│   │   │   ├── archive.ts
│   │   │   ├── export.ts
│   │   │   └── sync.ts
│   │   └── formatters/
│   │       ├── text.ts           # Human-readable output
│   │       └── json.ts           # Machine-parseable output
│   ├── core/
│   │   ├── message.ts            # Message type, validation, state machine
│   │   ├── store.ts              # SQLite read/write operations
│   │   ├── markdown.ts           # Markdown file render/parse
│   │   ├── sync.ts               # SQLite ↔ markdown reconciliation
│   │   └── config.ts             # Scope resolution, state transition rules
│   ├── telemetry/
│   │   ├── index.ts              # OTEL setup, no-op when unconfigured
│   │   ├── metrics.ts            # Message and system metrics
│   │   ├── traces.ts             # Command and task lifecycle spans
│   │   └── logs.ts               # Structured event logging
│   └── types.ts                  # Shared TypeScript types
└── tests/
    ├── core/
    │   ├── message.test.ts
    │   ├── store.test.ts
    │   ├── markdown.test.ts
    │   └── sync.test.ts
    ├── cli/
    │   └── commands.test.ts
    └── telemetry/
        └── telemetry.test.ts
```

### Dependencies (minimal)

- `better-sqlite3` — SQLite driver
- `nanoid` — ID generation
- `yaml` — frontmatter parsing
- `commander` — CLI argument parsing
- `@opentelemetry/api` — OTEL API (no-op when no exporter configured)
- `@opentelemetry/sdk-node` — OTEL SDK (lazy-loaded only when exporter is set)

## 8. Technology

- **Runtime:** Bun
- **Language:** TypeScript
- **Architecture:** `core/` is the library, `cli/` is a thin shell over it. Future UI imports from `core/` directly.
- **Migration path:** If performance becomes an issue, core logic can be rewritten in Rust/Go while keeping the same CLI interface and storage format.
