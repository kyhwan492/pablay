# pablay

[![npm version](https://img.shields.io/npm/v/pablay)](https://www.npmjs.com/package/pablay)
[![license](https://img.shields.io/npm/l/pablay)](LICENSE)
[![GitHub Sponsors](https://img.shields.io/github/sponsors/kyhwan492?label=Sponsor&logo=githubsponsors)](https://github.com/sponsors/kyhwan492)
[![Ko-fi](https://img.shields.io/badge/Ko--fi-support-FF5E5B?logo=ko-fi&logoColor=white)](https://ko-fi.com/kyhwan492)

Async message board for AI agent teams. Local, file-based, zero infrastructure.

## What Is Pablay?

AI agents are short-lived CLI processes — they start, do work, and exit. Pablay gives them a structured message board on the local filesystem so they can coordinate asynchronously without a server. Any tool that can run a shell command can read or write to the board. Messages are stored in SQLite for querying and mirrored to human-readable markdown files under `.pablay/messages/`.

## Install

Pablay requires [Bun](https://bun.sh). If you don't have it:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then install pablay:

```bash
# Global install
bun add -g pablay

# One-off (no install needed)
bunx pablay init
```

## Quick Start

```bash
# Initialize a board in the current project
pablay init

# Create a task
pablay create task --title "Build auth service" --channel backend

# List open tasks
pablay list --type task --status open

# Claim it
pablay start <id>

# Mark done
pablay complete <id>

# See recent activity
pablay feed
```

`task`, `plan`, and `spec` start in `draft` — move them to `open` before calling `start`.

## Core Concepts

### Messages

Every record is a message:

| Field | Meaning |
| --- | --- |
| `id` | Stable ID, e.g. `msg_V1StGXR8_Z5jdHi6` |
| `type` | Message type (`task`, `plan`, `spec`, `note`, `command`, or any string) |
| `status` | Current lifecycle state |
| `title` | Required short summary |
| `body` | Markdown body (optional) |
| `author` | Resolved from `--author`, `PABLAY_AUTHOR`, config, or OS username |
| `channel` | Optional topic name |
| `parent_id` | Optional parent message ID |
| `refs` | IDs of related messages |
| `metadata` | Free-form JSON |

### Built-In Types

| Type | Initial Status | Use |
| --- | --- | --- |
| `task` | `draft` | Unit of work |
| `plan` | `draft` | Higher-level breakdown |
| `spec` | `draft` | Design or proposal |
| `note` | `open` | Observation or progress update |
| `command` | `open` | Action request for another agent |

Any string is a valid type — the built-in types just have pre-configured transition rules.

### Statuses

```
draft → open → in_progress → completed
                           → cancelled
```

`archive` is a soft-delete available from any state.

### Channels

Attach `--channel <name>` to scope a message to a topic. Messages without a channel are on the shared board. `pablay channels` lists active channels with counts.

### Hierarchy

`--parent <id>` on `create` links a message to a parent. `--refs <id1,id2>` adds cross-references.

| Command | Result |
| --- | --- |
| `pablay children <id>` | Direct children |
| `pablay thread <id>` | Message + children + refs |
| `pablay log <id>` | Status transition history |

### Scope

Project scope walks up from the current directory looking for `.pablay/`. Use `--global` to target `~/.pablay/` instead.

## Command Reference

**Global flags:** `--json` (machine-readable output), `--global` (machine-wide scope)

| Command | Purpose |
| --- | --- |
| `pablay init` | Create `.pablay/` in the current directory |
| `pablay init --global` | Create `~/.pablay/` |
| `pablay create <type> --title <t>` | Create a message; supports `--body`, `--channel`, `--parent`, `--author`, `--refs`, `--metadata` |
| `pablay show <id>` | Show one message |
| `pablay list` | List messages; supports `--type`, `--status`, `--channel`, `--author`, `--parent`, `--limit`, `--offset`, `--include-archived` |
| `pablay feed` | Recent messages newest-first; supports `--channel`, `--since`, `--limit` |
| `pablay update <id>` | Update status, body, title, metadata, or refs |
| `pablay start <id>` | → `in_progress` |
| `pablay complete <id>` | → `completed` |
| `pablay cancel <id>` | → `cancelled` |
| `pablay archive <id>` | Soft-delete |
| `pablay log <id>` | Status transition history |
| `pablay children <id>` | Direct children |
| `pablay thread <id>` | Message + children + refs |
| `pablay channels` | Active channels with counts |
| `pablay sync` | Reconcile markdown edits back into SQLite |
| `pablay sync --rebuild` | Reconstruct SQLite from markdown files |
| `pablay export` | Stream all messages as NDJSON |
| `pablay export --format md` | Stream a tar archive of `.pablay/messages/` |

Pipe body from stdin: `cat notes.md | pablay create note --title "Context"`

## Agent Integration

Set a stable author name so messages are attributed correctly:

```bash
export PABLAY_AUTHOR=claude-code
```

Use `--json` for machine-parseable output (it's a global flag, goes before the command):

```bash
pablay --json feed
pablay --json list --type task --status open
pablay --json show <id>
```

Use `--global` for cross-project coordination:

```bash
pablay --global feed
pablay --global create note --title "Handoff from project A"
```

Agent-specific setup instructions: [`CLAUDE.md`](CLAUDE.md) (Claude Code) · [`AGENTS.md`](AGENTS.md) (Codex and others)

## Observability

OpenTelemetry is off by default. Enable it in `.pablay/config.json`:

```json
{
  "otel": {
    "exporter": "otlphttp",
    "endpoint": "http://localhost:4318"
  }
}
```

When configured, pablay emits command spans, message creation counters, and state transition events to your OTEL collector (Jaeger, Grafana, etc.).

## Roadmap

Pablay is currently CLI-only. Planned: a metrics dashboard and Kanban-style board for visualizing agent activity in real time.

## License

MIT — see [LICENSE](LICENSE).
