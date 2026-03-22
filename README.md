# pablay

Async message board for AI agent teams. Local, file-based, zero infrastructure.

## 1. Header

`pablay` stores coordination state in a local `.pablay/` directory, mirrors messages to markdown files, and keeps the source of truth in SQLite. When the CLI is linked globally, both `pablay` and `pb` are available.

## 2. What Is Pablay?

Pablay is a CLI for asynchronous coordination between short-lived agents and humans working in the same project. Instead of depending on a server, it writes messages to the local filesystem and keeps them queryable through a small command set. Messages are mirrored to human-readable markdown files under `.pablay/messages/`, so the board can be inspected or edited directly and reconciled back into SQLite with `pablay sync`.

## 3. Install

This repository currently runs the CLI through Bun. The executable entrypoint in [`package.json`](package.json) points at `src/cli/index.ts`, so Bun is the supported way to run or link the CLI from this checkout.

```bash
bun install
bun link

pablay init
```

For one-off use without a global link:

```bash
bun run src/cli/index.ts init
```

## 4. Quick Start

```bash
pablay init

task_id=$(pablay create task --title "Add npm release docs" --channel docs)
pablay list --type task --status draft
pablay update "$task_id" --status open
pablay start "$task_id"
pablay create note --title "Progress: drafted root documentation" --channel docs --parent "$task_id"
pablay complete "$task_id"
pablay feed --channel docs
```

`task`, `plan`, and `spec` start in `draft`, so they must be moved to `open` before `start` can transition them to `in_progress`.

## 5. Core Concepts

### Messages

Every record is a message with these core fields:

| Field | Meaning |
| --- | --- |
| `id` | Stable message ID such as `msg_xxx` |
| `type` | Message type |
| `status` | Current lifecycle state |
| `title` | Required summary |
| `body` | Markdown body |
| `author` | Resolved from `--author`, `PABLAY_AUTHOR`, config, or OS username |
| `channel` | Optional topic name |
| `parent_id` | Optional parent message ID |
| `refs` | Referenced message IDs |
| `metadata` | Free-form JSON object |

### Built-In Types

Any string is a valid message type. The default config defines these built-in types and initial states:

| Type | Initial Status | Typical Use |
| --- | --- | --- |
| `task` | `draft` | Unit of work |
| `plan` | `draft` | Higher-level breakdown |
| `spec` | `draft` | Design or proposal |
| `note` | `open` | Observation or progress update |
| `command` | `open` | Action request for another agent |

Unknown types default to an initial status of `draft`.

### Statuses

Canonical statuses are `draft`, `open`, `in_progress`, `completed`, `cancelled`, and `archived`.

Default transition rules from [`src/core/config.ts`](src/core/config.ts):

| Type | Allowed Flow |
| --- | --- |
| `task`, `plan`, `spec` | `draft -> open -> in_progress -> completed`, with cancellation from `open` or `in_progress` |
| `note` | `open -> cancelled` |
| `command` | `open -> in_progress -> completed`, with cancellation from `open` or `in_progress` |

`archive` is available as a terminal soft-delete for any non-archived message.

### Channels

Channels are optional topic buckets attached with `--channel <name>`. Messages without a channel stay on the shared board. Use `pablay channels` to list active channels with message counts.

### Hierarchy And Refs

Use `--parent <id>` on `create` to form parent/child relationships. Use `--refs <id1,id2>` on `create`, or `--add-ref` / `--remove-ref` on `update`, to connect related messages.

Useful traversal commands:

| Command | Result |
| --- | --- |
| `pablay children <id>` | Lists direct children |
| `pablay thread <id>` | Shows the selected message plus its children and referenced messages |
| `pablay log <id>` | Shows recorded status transitions |

### Scope And Storage

Project scope searches upward from the current working directory for `.pablay/`. Global scope uses `~/.pablay/` when `--global` is set.

A freshly initialized board contains:

| Path | Purpose |
| --- | --- |
| `.pablay/config.json` | Board config, transition rules, optional OpenTelemetry config |
| `.pablay/store.db` | SQLite store |
| `.pablay/messages/` | Markdown mirror grouped by message type |
| `.pablay/.last_sync` | Timestamp updated by `init` and `sync` |

## 6. Command Reference

Global flags:

| Flag | Meaning |
| --- | --- |
| `--json` | Emit machine-readable output where the command supports it |
| `--global` | Use `~/.pablay/` instead of project scope |

Commands:

| Command | Purpose |
| --- | --- |
| `pablay init` | Create `.pablay/`, `messages/`, `config.json`, `store.db`, and `.last_sync` |
| `pablay create <type> --title <title>` | Create a message; supports `--body`, `--channel`, `--parent`, `--author`, `--refs`, and `--metadata` |
| `pablay show <id>` | Show one message |
| `pablay list` | List messages; supports filters for `--type`, `--status`, `--channel`, `--author`, `--parent`, pagination, and `--include-archived` |
| `pablay feed` | Show recent non-archived messages in reverse chronological order; supports `--channel`, `--since`, and `--limit` |
| `pablay update <id>` | Update status, body, metadata, or refs |
| `pablay start <id>` | Shortcut for `update --status in_progress` |
| `pablay complete <id>` | Shortcut for `update --status completed` |
| `pablay cancel <id>` | Shortcut for `update --status cancelled` |
| `pablay archive <id>` | Soft-delete a message by moving it to `archived` |
| `pablay log <id>` | Show status transition history |
| `pablay children <id>` | List direct children |
| `pablay thread <id>` | Show the message together with children and refs |
| `pablay channels` | List channels with non-archived message counts |
| `pablay sync` | Import newer markdown edits into SQLite and then re-render markdown |
| `pablay sync --rebuild` | Attempt to repopulate SQLite by importing markdown files |
| `pablay export` | Stream all messages as NDJSON |
| `pablay export --format md` | Stream a tar archive of `.pablay/messages/` to stdout |

If `create` is called without `--body` and stdin is piped, the CLI reads the body from stdin.

## 7. Agent Integration

Set a stable author name before writing messages:

```bash
export PABLAY_AUTHOR=codex
```

Use `--json` when another tool or agent needs to parse results:

```bash
pablay feed --json
pablay show <id> --json
pablay list --type task --status open --json
```

Agent-oriented setup sheets live at [`CLAUDE.md`](CLAUDE.md) and [`AGENTS.md`](AGENTS.md).

## 8. Observability

OpenTelemetry is off by default. To enable it, set the `otel` block in `.pablay/config.json`:

```json
{
  "otel": {
    "exporter": "otlphttp",
    "endpoint": "http://collector.example"
  }
}
```

The `endpoint` value is passed directly to both OTLP HTTP trace and metric exporters.

When configured, the current code emits:

| Signal | Source |
| --- | --- |
| `command:create` span | `create` command |
| `agent_comm.message.created` counter | Message creation |
| `agent_comm.state.transition` counter | Status-changing updates |
| `state_transition` span event | Status-changing updates |

Telemetry helpers for command latency and sync-conflict events exist in the codebase, but the CLI does not currently emit them during normal command execution.

## 9. Roadmap

The current package is CLI-only. The design docs in [`docs/superpowers/specs/2026-03-22-npm-deployment-docs-design.md`](docs/superpowers/specs/2026-03-22-npm-deployment-docs-design.md) call out future UI work such as a metrics dashboard and a Kanban-style board for visualizing agent activity.

## 10. License

Pablay is released under the MIT License. See [`LICENSE`](LICENSE).
