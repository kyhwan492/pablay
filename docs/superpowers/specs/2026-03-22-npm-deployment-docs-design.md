# Pablay — npm Deployment & Documentation Design

**Date:** 2026-03-22
**Status:** Draft

## Overview

Prepare `pablay` for public npm publication by: (1) fixing the build pipeline so the compiled package runs on Node.js and Bun, (2) completing `package.json` with all required npm metadata, and (3) writing a comprehensive `README.md`, `CLAUDE.md`, and `AGENTS.md`.

## 1. Build & Package Setup

### Problem

`package.json` `bin` entries currently point at raw TypeScript source files (`src/cli/index.ts`). These work under Bun (which runs TS natively) but fail under Node.js. npm consumers doing `npm install -g pablay` or `npx pablay` would get a broken install.

### Solution

Compile to `dist/index.js` via `bun build` with `--target node`. The Node shebang is injected via `--banner`:

```bash
bun build src/cli/index.ts --outdir dist --target node --banner '#!/usr/bin/env node'
```

Update `bin` in `package.json`:

```json
"bin": {
  "pablay": "dist/index.js",
  "pb": "dist/index.js"
}
```

Add `"files"` to restrict what gets published to npm:

```json
"files": ["dist", "README.md", "LICENSE"]
```

Add a `prepublishOnly` script to ensure `dist/` is always fresh before publishing:

```json
"prepublishOnly": "bun run build"
```

### package.json Fields to Add

| Field | Value |
|-------|-------|
| `version` | `"0.1.0"` |
| `description` | `"Async message board for AI agent teams — local, file-based, no servers"` |
| `keywords` | `["ai-agent", "agent-communication", "cli", "async", "claude-code", "codex"]` |
| `license` | `"MIT"` |
| `author` | user's name/email |
| `repository` | GitHub repo URL |
| `homepage` | GitHub repo URL |
| `engines` | `{ "node": ">=18" }` |

## 2. README.md Structure

Single `README.md` in the project root. Optimized for the npm package page and GitHub. Sections in order:

### 2.1 Header
- Package name (`pablay`), badge row: npm version, license
- One-liner: "Async message board for AI agent teams. Local, file-based, zero infrastructure."

### 2.2 What is Pablay?
3–4 sentences covering:
- The problem: AI agents are short-lived CLI processes that need to coordinate asynchronously
- The solution: structured message board on the local filesystem — any CLI tool can read/write
- Key differentiator: no servers, no network, human-readable markdown files

### 2.3 Install
```bash
# npm / Node
npm install -g pablay
npx pablay init

# Bun
bun add -g pablay
bunx pablay init
```

### 2.4 Quick Start
Minimal 5–6 command example showing the core loop:
1. `pablay init`
2. `pablay create task --title "..." --channel backend`
3. `pablay list --type task --status open`
4. `pablay update <id> --status in_progress`
5. `pablay complete <id>`
6. `pablay feed`

### 2.5 Core Concepts

**Messages** — everything is a message. Key fields: `id`, `type`, `status`, `title`, `body`, `author`, `channel`, `parent_id`.

**Built-in types** (extensible — any string is valid):

| Type | Purpose |
|------|---------|
| `task` | Unit of work |
| `plan` | High-level breakdown |
| `spec` | Design document |
| `note` | Freeform observation |
| `command` | Instruction to another agent |

**Statuses:** `draft → open → in_progress → completed | cancelled`. `archived` for soft delete.

**Channels:** Optional topic grouping (e.g. `--channel backend`). Messages without a channel are on the shared board.

**Hierarchy:** `--parent <id>` links tasks to plans. `pablay children <id>` and `pablay thread <id>` traverse relationships.

**Scope:** Project scope (walks up from cwd for `.pablay/`) or machine scope (`--global` → `~/.pablay/`).

### 2.6 Command Reference

Grouped table covering all commands: init, create, show, list, feed, update, start/complete/cancel/archive, log, children, thread, channels, sync, export. Each row: command, purpose.

### 2.7 Agent Integration
Short section pointing to `CLAUDE.md` and `AGENTS.md` for agent-specific setup. Mentions:
- Set `PABLAY_AUTHOR=<agent-name>` so messages are attributed correctly
- Use `--json` flag for machine-parseable output

### 2.8 Observability (OpenTelemetry)
Opt-in. Show the minimal config block. Mention what's captured (command latency, message lifecycle, state transitions).

### 2.9 Roadmap
Brief mention of planned UI: metrics dashboard and Kanban board for visualizing agent work.

### 2.10 License
MIT.

## 3. CLAUDE.md

Root-level file, read automatically by Claude Code. Kept short and command-focused.

Sections:
1. **Setup** — check for `.pablay/`, run `pablay init` if missing
2. **Identity** — set `PABLAY_AUTHOR` to a stable agent name for attribution
3. **Session Start** — run `pablay feed --json` to read recent activity
4. **Core Patterns** — claim a task, post a note, complete work (3–5 shell commands each)
5. **Channels** — use `--channel` to scope work; run `pablay channels` to see active ones

No prose explanations — just the commands agents need.

## 4. AGENTS.md

Root-level file, read by Codex and other agents that follow the `AGENTS.md` convention. Same content as `CLAUDE.md`, same structure, same brevity. Functionally identical — both files exist so each agent framework picks up the right one.

## 5. Files Produced

| File | Description |
|------|-------------|
| `README.md` | Human-facing docs for npm + GitHub |
| `CLAUDE.md` | Agent instructions for Claude Code |
| `AGENTS.md` | Agent instructions for Codex and others |
| `LICENSE` | MIT license text |
| `package.json` | Updated with all npm metadata + build config |
| `dist/index.js` | Compiled CLI output (generated, not committed) |

`dist/` should be added to `.gitignore` but NOT to `.npmignore` (it must be published).

## 6. Out of Scope

- Hosted docs site (deferred to later)
- Library exports / programmatic API (CLI-only for now)
- Automated npm publish CI (manual `npm publish` for initial release)
