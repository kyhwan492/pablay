# pablay-ui Design Spec

**Date:** 2026-03-24
**Status:** Draft

## 1. Overview

`pablay-ui` is a separate npm package that provides a local web dashboard for monitoring AI agent activity in a pablay board. It targets human observers who want to watch agent progress in real time without reading CLI output.

It is intentionally **separate from the `pablay` CLI package** to keep the core tool lean. Users opt in with `bun add -g pablay-ui`.

## 2. Goals

- Show a Kanban board of tasks by status, updated in real time as agents write
- Show a live activity feed (newest messages first)
- Run as a local HTTP server with a single CLI command: `pablay-ui`
- Be lightweight enough to run alongside agents in Docker or a terminal
- Support the nice-to-have features (channel filter, agent activity, telemetry charts) without breaking the v1 scope

## 3. Non-Goals (v1)

- Authentication or multi-user access
- Editing or creating messages from the UI (read-only)
- Hosted/cloud deployment
- Drag-and-drop Kanban reordering

## 4. Architecture

### 4.1 Package Structure

```
pablay-ui/
  src/
    server.ts        # Bun HTTP server — routes, SSE, static file serving
    watcher.ts       # SQLite mtime watcher — detects writes, emits diffs
    api.ts           # REST handlers: GET /api/messages, GET /api/channels
    public/
      index.html     # Single-page app shell, loads Alpine.js from CDN
      app.js         # Alpine.js component — Kanban + feed state and logic
      style.css      # Layout, Kanban columns, feed, dark theme
  bin/
    pablay-ui.ts     # CLI entry point
```

### 4.2 CLI Entry Point

```bash
pablay-ui [--port 3000] [--root <path-to-.pablay>]
```

- `--port` defaults to `3000`
- `--root` defaults to the nearest `.pablay/` found by walking up from cwd (same resolution as the `pablay` CLI)
- On start: prints `pablay-ui running at http://localhost:3000`

### 4.3 Data Flow

1. Agent writes to SQLite via `pablay` CLI
2. `watcher.ts` polls SQLite file mtime every 500ms; on change, queries messages updated since last poll
3. Server pushes diffs to all connected browsers via SSE (`/api/events`)
4. Alpine.js receives events and patches the Kanban column or feed in place — no full reload

### 4.4 Reading Data

`pablay-ui` imports `pablay`'s core store module directly (listed as a `peerDependency`). It opens the SQLite file read-only. No separate data layer or IPC needed.

### 4.5 Telemetry

Reads OTEL config from `.pablay/config.json` (same key pablay already uses). If configured, emits spans for:
- Server start
- Page loads
- SSE connections/disconnections

No additional config required from the user.

## 5. Real-Time: SSE

Server-Sent Events over a single persistent HTTP connection. Chosen over WebSockets because updates are unidirectional (server → client) and SSE is lower overhead.

### Event types

```
event: connected
data: {"board_count": 12, "channels": ["backend", "frontend"]}

event: message_updated
data: {
  "id": "msg_xxx",
  "type": "task",
  "status": "in_progress",
  "title": "Build auth service",
  "author": "claude-code",
  "channel": "backend",
  "updated_at": 1711234567
}
```

`connected` is sent once on SSE connection and initializes client state. `message_updated` is sent for every new or changed message.

The Alpine.js client reconnects automatically with exponential backoff if the SSE connection drops.

## 6. UI Layout

### 6.1 Overall Layout

Side-by-side: Kanban board takes 75% of viewport width, feed panel takes 25%. Both scroll independently.

```
┌─────────────────────────────────────────────────────┐
│  pablay   [channel: All ▼]                   ● live │
├──────────────────────────────────┬──────────────────┤
│  DRAFT    OPEN   IN PROGRESS  DONE │     FEED        │
│  ┌────┐  ┌────┐   ┌──────┐  ┌────┐│  claude·task→  │
│  │    │  │    │   │      │  │ ✓  ││  in_progress   │
│  └────┘  └────┘   └──────┘  └────┘│  codex·note→   │
│  ┌────┐           ┌──────┐        │  open          │
│  │    │           │      │        │  ...           │
│  └────┘           └──────┘        │                │
└──────────────────────────────────┴──────────────────┘
```

### 6.2 Kanban Card

Each card shows:
- Title (truncated at 2 lines)
- Type badge (`task`, `plan`, `spec`, `note`, `command`)
- Author name
- Channel tag (if set)
- Age (e.g. "3m ago")

Clicking a card opens a detail panel (slide-in or modal) showing: full body (rendered markdown), refs, status transition log.

### 6.3 Feed Item

Each feed item shows:
- Relative timestamp (e.g. "2m ago")
- Author
- Type
- Title
- Status change (e.g. `→ in_progress`)

Newest at top. Feed is capped at 100 items in the DOM to avoid memory growth.

### 6.4 Header Bar

Always visible. Contains:
- `pablay` wordmark
- Live indicator dot: green = SSE connected, red = disconnected
- Channel filter dropdown (filters both Kanban and Feed simultaneously)

### 6.5 Nice-to-Have UI (not v1)

These are designed to fit into the layout but are out of scope for v1:

- **Agent activity strip** — thin bar below header showing active authors and their `in_progress` count
- **Telemetry drawer** — collapsible panel at the bottom; Chart.js charts powered by `/api/metrics`

## 7. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves `index.html` |
| `GET` | `/api/messages` | All messages; supports `?channel=`, `?status=`, `?type=`, `?limit=` |
| `GET` | `/api/channels` | Active channels with message counts |
| `GET` | `/api/events` | SSE stream |
| `GET` | `/static/*` | Serves `public/` assets |

## 8. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun | Matches pablay core; built-in HTTP server |
| Server framework | Bun native HTTP | No framework needed for 4 routes |
| Frontend reactivity | Alpine.js (CDN) | No build step; reactive without a SPA framework |
| Charting (nice-to-have) | Chart.js (CDN) | Lightweight, no build step |
| Database access | pablay store module | Reuse existing SQLite abstraction |

## 9. Dependencies

```json
{
  "peerDependencies": {
    "pablay": ">=0.1.0"
  }
}
```

No runtime npm dependencies beyond pablay itself. Alpine.js and Chart.js are loaded from CDN in the HTML.

## 10. Error Handling

- **SQLite file not found:** server exits with a clear error message pointing to `pablay init`
- **Port in use:** server exits with message suggesting `--port`
- **SSE disconnection:** client reconnects automatically (exponential backoff, max 30s)
- **Stale board on reconnect:** client re-fetches `/api/messages` on reconnect to catch any missed events

## 11. Testing

- Unit tests for `watcher.ts` (mock SQLite mtime changes, assert events emitted)
- Unit tests for `api.ts` route handlers (mock store, assert response shape)
- E2E test: start server against a real `.pablay/` fixture, write a message via pablay CLI, assert SSE event received and API response updated

## 12. Out of Scope

- Authentication
- Write/edit operations from the UI
- Hosted deployment
- Drag-and-drop Kanban
- Library/programmatic API
