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
- Offline/air-gap support (CDN availability for Alpine.js is assumed; for offline environments, vendor the assets manually into `public/`)
- Frontend JS unit tests (client-side logic is covered by E2E test only in v1)

## 4. Architecture Decision: Database Access

`pablay-ui` uses `bun:sqlite` directly with `{ readonly: true }`, bypassing the `pablay` `Store` class entirely. This avoids the write-on-construction issue in `Store` (which runs DDL on open) and requires no changes to the `pablay` package.

The `pablay` peer dependency is kept as a declaration of the runtime pairing, but no imports from `pablay` are used at runtime.

## 5. Architecture

### 5.1 Package Structure

```
pablay-ui/
  src/
    server.ts        # Bun HTTP server — routes, SSE, static file serving
    watcher.ts       # SQLite mtime watcher — detects writes, re-fetches board
    api.ts           # REST handlers: GET /api/messages, GET /api/channels
    public/
      index.html     # Single-page app shell, loads Alpine.js from CDN
      app.js         # Alpine.js component — Kanban + feed state and logic
      style.css      # Layout, Kanban columns, feed, dark theme
  bin/
    pablay-ui.ts     # CLI entry point
```

### 5.2 CLI Entry Point

```bash
pablay-ui [--port 3000] [--root <path-to-.pablay>]
```

- `--port` defaults to `3000`
- `--root` defaults to the nearest `.pablay/` found by walking up from cwd. `pablay-ui` reimplements this directory-walk in `bin/pablay-ui.ts` (the same algorithm as the `pablay` CLI: check `cwd/.pablay/`, then `../`, etc. until root or `~/.pablay/`)
- On start: prints `pablay-ui running at http://localhost:3000`

### 5.3 Data Flow

1. Agent writes to SQLite via `pablay` CLI
2. `watcher.ts` polls SQLite file mtime every 500ms; on mtime change, re-fetches all non-archived messages via a direct `SELECT * FROM messages WHERE status != 'archived'` query
3. Server diffs the new snapshot against the previous in-memory snapshot, identifies changed/new messages, and pushes `message_updated` events to all connected browsers via SSE (`/api/events`)
4. Alpine.js receives events and patches the Kanban column or feed in place — no full reload

The full re-fetch strategy is simple and correct. At typical board sizes (hundreds of messages) the SQLite query is sub-millisecond.

### 5.4 Reading Data

`pablay-ui` opens the SQLite database in **read-only mode** using `bun:sqlite` directly (`new Database(path, { readonly: true })`). This bypasses the `Store` class entirely, avoiding the write-on-construction issue. No `exports` change to `pablay` is required for reading; however, the `pablay` peer dependency is still declared so that the SQLite file location and config conventions are shared.

### 5.5 Telemetry

Reads OTEL config from `.pablay/config.json` (same key pablay already uses). If configured, emits spans for:
- Server start
- Page loads
- SSE connections/disconnections

No additional config required from the user.

## 6. Real-Time: SSE

Server-Sent Events over a single persistent HTTP connection. Chosen over WebSockets because updates are unidirectional (server → client) and SSE is lower overhead.

### Event types

```
event: connected
data: {
  "messages": [...],
  "channels": ["backend", "frontend"]
}

event: message_updated
data: {
  "id": "msg_xxx",
  "type": "task",
  "status": "in_progress",
  "title": "Build auth service",
  "author": "claude-code",
  "channel": "backend",
  "updated_at": "2026-03-24T10:00:00.000Z"
}
```

- `connected` is sent once on SSE connection. It includes the full current non-archived message list so the client can hydrate the Kanban without a separate REST call. The client derives counts from the array directly.
- `message_updated` is sent for every new or changed non-archived message. `updated_at` is an ISO 8601 string matching the `Message` type in pablay.
- The Alpine.js client reconnects automatically with exponential backoff (initial 1s, max 30s) if the SSE connection drops. On reconnect, the `connected` event re-hydrates the full board state.

## 7. UI Layout

### 7.1 Overall Layout

Side-by-side: Kanban board takes 75% of viewport width, feed panel takes 25%. Both scroll independently.

```
┌─────────────────────────────────────────────────────┐
│  pablay   [channel: All ▼]                   ● live │
├────────────────────────────────────┬────────────────┤
│  DRAFT  OPEN  IN PROGRESS  COMPLETED  CANCELLED     │
│  ┌───┐ ┌───┐   ┌──────┐   ┌──────┐  ┌──────┐  │FEED│
│  │   │ │   │   │      │   │  ✓   │  │  ✗   │  │    │
│  └───┘ └───┘   └──────┘   └──────┘  └──────┘  │    │
└────────────────────────────────────────────────┴────┘
```

**Kanban columns (in order):** `DRAFT`, `OPEN`, `IN PROGRESS`, `COMPLETED`, `CANCELLED`

- `archived` messages are always excluded from the board (consistent with the store's default `list()` behavior)
- `CANCELLED` column is shown but visually muted (lower opacity, grey header)
- Column names display the status in uppercase; the underlying status values are `draft`, `open`, `in_progress`, `completed`, `cancelled`

### 7.2 Kanban Card

Each card shows:
- Title (truncated at 2 lines)
- Type badge (`task`, `plan`, `spec`, `note`, `command`)
- Author name
- Channel tag (if set)
- Age (e.g. "3m ago")

Clicking a card opens a detail panel (slide-in or modal) showing: full body (rendered markdown), refs, status transition log.

### 7.3 Feed Item

Each feed item shows:
- Relative timestamp (e.g. "2m ago")
- Author
- Type
- Title
- Status change (e.g. `→ in_progress`)

Newest at top. Feed is capped at 100 items in the DOM to avoid memory growth.

### 7.4 Header Bar

Always visible. Contains:
- `pablay` wordmark
- Live indicator dot: green = SSE connected, red = disconnected
- Channel filter dropdown (filters both Kanban and Feed simultaneously; "All" shows everything)

### 7.5 Nice-to-Have UI (not v1)

These are designed to fit into the layout but are out of scope for v1:

- **Agent activity strip** — thin bar below header showing active authors and their `in_progress` count
- **Telemetry drawer** — collapsible panel at the bottom; Chart.js charts powered by `/api/metrics`

## 8. API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Serves `index.html` |
| `GET` | `/api/messages` | Non-archived messages; supports `?channel=`, `?status=`, `?type=`, `?limit=` |
| `GET` | `/api/channels` | Active channels with message counts |
| `GET` | `/api/events` | SSE stream |
| `GET` | `/static/*` | Serves `public/` assets |

## 9. Tech Stack

| Layer | Choice | Rationale |
|-------|--------|-----------|
| Runtime | Bun | Matches pablay core; built-in HTTP server |
| Server framework | Bun native HTTP | No framework needed for 5 routes |
| Database | `bun:sqlite` read-only | Direct read avoids Store write-on-construct issue |
| Frontend reactivity | Alpine.js (CDN) | No build step; reactive without a SPA framework |
| Charting (nice-to-have) | Chart.js (CDN) | Lightweight, no build step |

## 10. Dependencies

```json
{
  "peerDependencies": {
    "pablay": ">=0.1.0"
  }
}
```

No runtime npm dependencies. Alpine.js and Chart.js are loaded from CDN with `integrity` hashes to prevent CDN compromise. CDN availability is assumed; for offline/air-gap environments, copy the assets into `public/` manually.

## 11. Error Handling

- **SQLite file not found:** server exits with a clear error message pointing to `pablay init`
- **Port in use:** server exits with message suggesting `--port`
- **SSE disconnection:** client reconnects automatically (exponential backoff: 1s initial, doubles each attempt, max 30s)
- **Board state on reconnect:** the `connected` event on reconnect delivers the full message list, so no state is lost during disconnection

## 12. Testing

- **Unit: `watcher.ts`** — mock SQLite file mtime changes; assert `message_updated` events emitted with correct diff
- **Unit: `api.ts`** — mock database queries; assert response shapes match spec for each endpoint
- **E2E:** start server against a real `.pablay/` fixture; write a message via `pablay create`; assert SSE `message_updated` event received within 1s; assert `GET /api/messages` response includes the new message
- **Frontend:** covered by E2E test only in v1 (Playwright smoke test: open dashboard, assert Kanban columns render, assert live indicator is green)

## 13. Out of Scope

- Authentication
- Write/edit operations from the UI
- Hosted deployment
- Drag-and-drop Kanban
- Library/programmatic API
- Offline/CDN-less operation
