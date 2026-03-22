# Seamless Setup UX for Vibe-Coders and Agents

**Date:** 2026-03-23
**Status:** Approved

---

## Problem

Setting up Pablay across multiple projects has three friction points:

1. **Manual init** — humans must remember to run `pablay init` in every new project directory
2. **Agent ignorance** — agents (Claude Code, Codex, OpenClaw) have no instructions on how to use Pablay or set it up themselves
3. **No automatic wiring** — there is no hook or mechanism that connects Pablay into an agent's session automatically

This design resolves all three with a single install command, lazy auto-init, a global project registry, and agent instruction files.

---

## Goals

- One-time human setup: `pablay install` handles everything permanently
- Zero manual init: agents and humans never need to think about `pablay init` again
- Project-based agents (Claude Code, Codex) get instructions via `CLAUDE.md` / `AGENTS.md`
- Centralized agents (OpenClaw) get cross-project read+write via `--root` flag and a system prompt template
- Centralized agents are decoupled — they coordinate via Pablay messages, never touch project files directly

## Non-Goals

- No daemon or persistent background process
- No network or multi-machine sync
- No authentication or permissions model
- No changes to the core message/store/sync architecture

---

## Design

### 1. `pablay install`

A new CLI command, run once globally by the human:

```sh
pablay install
```

**What it does:**

1. **Shell hook** — Detects the active shell (`zsh`/`bash`) and appends a `chpwd` function to `~/.zshrc` and/or `~/.bashrc`. The hook runs `pablay init --silent` whenever the user enters a directory that is a git repo and does not have `.pablay/`.

   ```sh
   # Added by pablay install
   _pablay_chpwd() {
     if git rev-parse --git-dir > /dev/null 2>&1; then
       if [ ! -d ".pablay" ]; then
         pablay init --silent
       fi
     fi
   }
   chpwd_functions+=(_pablay_chpwd)
   ```

2. **Global init** — Runs `pablay init --global` to ensure `~/.pablay/` exists.

3. **Registry bootstrap** — Creates `~/.pablay/projects.json` as `[]` if it does not already exist.

4. **Agent instruction injection** — If `CLAUDE.md` or `AGENTS.md` exist in the current directory, appends a Pablay usage section (see Agent Instructions below). Does not overwrite existing content.

5. **System prompt generation** — Writes `~/.pablay/system-prompt.md` for centralized agents.

**Idempotent:** Safe to run multiple times. Detects existing hook and skips re-injection. Prints a summary of what was done and reminds the user to `source ~/.zshrc`.

---

### 2. Lazy Auto-Init

Every `pablay` command (except `install` and `init` themselves) checks whether `.pablay/` exists in the resolved root before executing. If it does not exist and the current directory is inside a git repo, Pablay silently runs `init` before proceeding.

This means:
- Agents never need to know about `init`; Pablay self-heals on first use
- A fresh `git clone` + first `pablay list` just works
- No error is thrown for missing `.pablay/`

Implementation: the existing pre-action hook in `src/cli/index.ts` (currently used for telemetry) is extended to call a `lazyInit(cwd)` helper before every command.

**`--silent` flag on `init`:** Suppresses all stdout output. Used internally by lazy init and the shell hook so humans only see output when they explicitly run `pablay init`.

---

### 3. Global Project Registry

Location: `~/.pablay/projects.json`

Schema:
```json
[
  {
    "path": "/absolute/path/to/project",
    "name": "project-name",
    "added_at": "2026-03-23T10:00:00Z"
  }
]
```

**Behaviour:**
- Every `pablay init` (explicit, lazy, or shell hook) appends the project to the registry if not already present.
- On every registry read, entries whose `path` no longer exists on disk are silently pruned.
- `name` defaults to the directory basename.

**New command: `pablay projects`**

```
pablay projects [--json]
```

Lists all registered projects with their path, name, and message count (queried live from each project's SQLite). Stale entries are pruned before output. Supports `--json` for piping.

---

### 4. `--root <path>` Global Flag

Alongside the existing `--global` flag, a new `--root <path>` flag lets any command target an arbitrary project by absolute path:

```sh
pablay --root /path/to/project list --type task --status open
pablay --root /path/to/project create task --title "Review auth PR" --channel backend
```

This is the primary interface for centralized agents. They discover projects via `pablay projects --json`, then read and write to each project's board using `--root`.

---

### 5. Agent Instructions

#### Project-based agents (Claude Code, Codex)

`pablay install` appends the following section to `CLAUDE.md` and `AGENTS.md` in the current directory (and any project directory when lazy init fires for the first time):

```markdown
## Pablay — Task Coordination

Pablay is the task and message board for this project. It lives in `.pablay/`.

**Self-setup:** If `.pablay/` does not exist, run `pablay init` before doing anything else.

**Core workflow:**
- `pablay create task --title "..." --channel <area>` — create a task
- `pablay list --type task --status open` — see what's open
- `pablay start <id>` — claim a task
- `pablay complete <id>` — mark done
- `pablay thread <id>` — get full context on a task

**Conventions:**
- Use channel names matching the work area: `backend`, `frontend`, `infra`, `docs`
- For sub-5-minute work, skip tasks — use `pablay create note` instead
- Always `pablay start <id>` before working on a task so others know it's claimed

**Output:** Use `--json` flag when piping to other tools.
```

#### Centralized agents (OpenClaw and similar)

`~/.pablay/system-prompt.md` is generated by `pablay install`:

```markdown
## Pablay — Cross-Project Coordination

You have read+write access to Pablay task boards across all registered projects.

**Discover projects:**
pablay projects --json

**Read a project's board:**
pablay --root <path> list --type task --status open --json

**Create a task in a project:**
pablay --root <path> create task --title "..." --channel <area> --author <your-agent-name>

**IMPORTANT — Hard rules:**
- Never modify files inside a project directory directly
- Your role is coordination only: create tasks, update status, read context
- Do not mark tasks complete — that is the project agent's responsibility
- Always set --author to your agent name so humans can audit your actions
```

---

## File Changes

### New files
| File | Purpose |
|------|---------|
| `src/cli/commands/install.ts` | `pablay install` command |
| `src/cli/commands/projects.ts` | `pablay projects` command |
| `src/core/registry.ts` | Read/write/prune `~/.pablay/projects.json` |

### Modified files
| File | Change |
|------|--------|
| `src/cli/index.ts` | Add `--root <path>` global flag; extend pre-action hook with `lazyInit()` |
| `src/cli/commands/init.ts` | Add `--silent` flag; call `registry.add()` on successful init |
| `src/core/config.ts` | `resolveRoot()` accepts explicit root path override (for `--root` flag) |

### Generated files (outside repo)
| File | Generated by |
|------|-------------|
| `~/.zshrc` / `~/.bashrc` (appended) | `pablay install` |
| `~/.pablay/projects.json` | `pablay install` + every `init` |
| `~/.pablay/system-prompt.md` | `pablay install` |
| `<project>/CLAUDE.md` (appended) | `pablay install` |
| `<project>/AGENTS.md` (appended) | `pablay install` |

---

## Error Handling

- `pablay install` on an unsupported shell (fish, etc.): prints a manual snippet instead of injecting automatically
- Lazy init in a non-git directory with no `.pablay/`: fails with a clear error — "Not a git repo and no .pablay/ found. Run `pablay init` explicitly."
- `--root <path>` pointing to a path without `.pablay/`: fails with "No Pablay store at `<path>`. Run `pablay init` there first."
- Registry stale entries: silently pruned, no error

---

## Testing

- Unit: `registry.ts` add/read/prune logic
- Unit: `resolveRoot()` with explicit root path override
- Unit: `lazyInit()` — git repo detection, silent init trigger
- Integration: `pablay install` in a temp dir — verify shell file appended, registry created, system prompt written
- Integration: `pablay projects` — verify stale pruning, live message counts
- E2E: `pablay list` in a git repo with no `.pablay/` — verify lazy init fires and command succeeds
