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

A new CLI command, run once per machine by the human. It should be run from a project directory when the human wants to inject agent instructions into that project's `CLAUDE.md`/`AGENTS.md`. Global setup (shell hook, registry, system prompt) always happens regardless of working directory.

```sh
pablay install
```

**What it does:**

1. **Shell hook** — Detects the active shell and appends a hook to the appropriate rc file(s). The hook runs `pablay init --silent` whenever the user enters a directory that is a git repo and does not have `.pablay/`.

   Detection marker: the hook block is wrapped with `# Added by pablay install` and `# End pablay install`. Idempotency check: if this marker string is found in the target rc file, injection is skipped.

   **zsh** (`~/.zshrc`):
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
   # End pablay install
   ```

   **bash** (`~/.bashrc`):
   ```sh
   # Added by pablay install
   _pablay_prompt_command() {
     if [ "$PWD" != "$_PABLAY_LAST_PWD" ]; then
       _PABLAY_LAST_PWD="$PWD"
       if git rev-parse --git-dir > /dev/null 2>&1; then
         if [ ! -d ".pablay" ]; then
           pablay init --silent
         fi
       fi
     fi
   }
   PROMPT_COMMAND="_pablay_prompt_command${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
   # End pablay install
   ```

   If the shell is neither zsh nor bash (e.g. fish), `pablay install` prints a manual setup snippet to stdout instead of attempting injection.

   **Git worktrees and submodules:** Each worktree or submodule directory that satisfies `git rev-parse --git-dir` will get its own `.pablay/` store when the hook fires. This is intentional — each worktree is treated as an independent project with its own message board, mirroring how git treats them as separate working trees.

2. **Global init** — Runs `pablay init --global` to ensure `~/.pablay/` exists.

3. **Registry bootstrap** — Creates `~/.pablay/projects.json` as `[]` if it does not already exist.

4. **Agent instruction injection** — If `CLAUDE.md` or `AGENTS.md` exist in the **current working directory**, appends a Pablay usage section (see Agent Instructions below). Before appending, checks whether the string `## Pablay — Task Coordination` already exists in the file; if it does, injection is skipped silently (idempotent). Does not inject into files outside the cwd. If neither file exists, skips silently (does not create them).

5. **System prompt generation** — Writes `~/.pablay/system-prompt.md` for centralized agents. Overwrites if already exists (always reflects latest version).

`pablay install` prints a summary of each action taken and reminds the user to `source ~/.zshrc` (or the relevant rc file).

---

### 2. Lazy Auto-Init

Every `pablay` command (except `install`, `init`, and `projects`) checks whether `.pablay/` exists in the resolved root before executing. `projects` is excluded because it operates on the global registry across multiple projects and must not init the cwd as a side effect. If it does not exist and the current directory is inside a git repo, Pablay silently runs `init` before proceeding. **Lazy init never injects into `CLAUDE.md` or `AGENTS.md`** — that is exclusively a `pablay install` action.

**Pre-action hook call order** (inside `src/cli/index.ts`):
```
lazyInit(cwd) → resolveRoot(cwd, global, root) → loadConfig(resolvedRoot) → initTelemetry(config)
```

`lazyInit()` must complete before `resolveRoot()` is called, so that the root is non-null when telemetry initialises.

Commander's `preAction` hook receives the current action command as its second argument. The full guard logic inside the hook, executed in this exact order:

```
1. Validate --root: if set and not absolute path → fail immediately, before lazyInit
2. Skip lazyInit if any of:
   - actionCommand.name() is one of ['install', 'init', 'projects']
   - program.opts().global === true
   - program.opts().root is set (--root implies targeting a specific known project, not cwd)
3. lazyInit(cwd)
4. resolveRoot(cwd, global, root) → store as _resolvedRoot
5. loadConfig(_resolvedRoot)
6. initTelemetry(config)
```

Validating `--root` before `lazyInit()` prevents a `.pablay/` from being created in the cwd on what will ultimately be an erroring command.

The resolved root is stored on the program options object via `program.setOptionValue('_resolvedRoot', resolvedRoot)` inside the pre-action hook. All command handlers read `opts._resolvedRoot` (already injected by the hook) instead of calling `resolveRoot()` themselves. This avoids duplicating `--root`/`--global` logic across every command and ensures a single call site for root resolution.

**Error cases:**
- In a non-git directory with no `.pablay/` found: fail with clear error — `"Not a git repo and no .pablay/ found. Run 'pablay init' explicitly."`
- Lazy init fails (e.g. disk full): error is printed to stderr, command aborts. Never silently swallowed.

**`--silent` flag on `init`:** Suppresses stdout only. Errors always go to stderr regardless of `--silent`. Used internally by lazy init and the shell hook.

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

- `path` is always the **project root directory** (parent of `.pablay/`), not the `.pablay/` directory itself.
- `name` defaults to the directory basename. It is informational only — all commands target projects by `path`, never by `name`. No uniqueness constraint. Name collisions are harmless.
- Every `pablay init` (explicit, lazy, or shell hook) appends to the registry if the path is not already present. Comparison is by exact `path` string.
- Registry writes are **skipped when `--global` is passed** to `init`. A global init creates `~/.pablay/` itself, which is not a project and must not appear in the registry.
- `registry.add()` must be self-bootstrapping: it ensures `~/.pablay/` exists (`mkdir -p`) and creates `projects.json` as `[]` if absent before appending. This allows lazy init to write to the registry on machines where `pablay install` has never been run.
- On every registry read, entries whose `path` no longer exists on disk are silently pruned before the result is returned or displayed.

**New command: `pablay projects`**

```
pablay projects [--json]
```

Lists all registered projects. For each project, queries its SQLite for a live message count. If a project's SQLite is missing, locked, or corrupt, that project is shown with `count: null` and a `"(unreadable)"` marker — it is not skipped or fatal. Supports `--json` for piping.

---

### 4. `--root <path>` Global Flag

A new `--root <path>` global flag lets any command target an arbitrary project by its **project root directory** (the parent of `.pablay/`). The value must be an **absolute path** — if a relative path is provided, the command fails immediately with: `"--root requires an absolute path"`. The flag passes the project root to `resolveRoot()`, which appends `.pablay/` internally.

```sh
pablay --root /path/to/project list --type task --status open
pablay --root /path/to/project create task --title "Review auth PR" --channel backend
```

**Precedence rules:**
- `--root` and `--global` are mutually exclusive. If both are passed, the command fails immediately with: `"--root and --global cannot be used together"`.
- `--root` takes precedence over the cwd-based walk in `resolveRoot()`.
- If `--root <path>` points to a directory without a `.pablay/` subdirectory, the command fails with: `"No Pablay store at '<path>/.pablay/'. Run 'pablay init' there first."` Lazy init does **not** fire for `--root` paths.

This is the primary interface for centralized agents. They discover projects via `pablay projects --json`, then read and write to each project's board using `--root`.

---

### 5. Agent Instructions

#### Project-based agents (Claude Code, Codex)

`pablay install` appends the following section to `CLAUDE.md` and/or `AGENTS.md` in the **current working directory** when those files exist:

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

**IMPORTANT — Hard rules for centralized agents:**
- Never modify files inside a project directory directly
- Your role is coordination only: create tasks, update status, read context
- Do not mark tasks complete — only the project-level agent working inside that repo should do that
- Always set --author to your agent name so humans can audit your actions
- --root and --global cannot be used together

Note: project-level agents (Claude Code, Codex) running inside a project directory are permitted to complete tasks. This restriction applies to centralized agents only.
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
| `src/cli/index.ts` | Add `--root <path>` global flag; change `preAction` hook signature to `(thisCommand, actionCommand)` so `actionCommand.name()` is available for the lazy-init guard; call `lazyInit()` before `resolveRoot()`; store result as `program.setOptionValue('_resolvedRoot', resolvedRoot)` |
| `src/cli/commands/init.ts` | Add `--silent` flag; call `registry.add()` on successful init (skip when `--global`) |
| `src/core/config.ts` | `resolveRoot(cwd, global, root?)` — when `root` is provided, skip directory walk and return `root + '/.pablay'` directly |
| `src/cli/commands/list.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/create.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/update.ts` | Refactor `performUpdate()` to accept `resolvedRoot: string` as a parameter instead of computing it internally; all five entry points (`update`, `start`, `complete`, `cancel`, `archive`) pass `opts._resolvedRoot` through |
| `src/cli/commands/show.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/thread.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/feed.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/log.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/sync.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/export.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/channels.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |
| `src/cli/commands/children.ts` | Replace `resolveRoot()` call with `opts._resolvedRoot` |

### Generated files (outside repo)
| File | Generated by |
|------|-------------|
| `~/.zshrc` / `~/.bashrc` (appended) | `pablay install` |
| `~/.pablay/projects.json` | `pablay install` + every `init` |
| `~/.pablay/system-prompt.md` | `pablay install` |
| `<project>/CLAUDE.md` (appended, if exists) | `pablay install` (cwd only) |
| `<project>/AGENTS.md` (appended, if exists) | `pablay install` (cwd only) |

---

## Error Handling

| Scenario | Behaviour |
|----------|-----------|
| `--root` and `--global` both passed | Fail: `"--root and --global cannot be used together"` |
| `--root <path>` has no `.pablay/` | Fail: `"No Pablay store at '<path>/.pablay/'. Run 'pablay init' there first."` |
| Lazy init in non-git dir with no `.pablay/` | Fail: `"Not a git repo and no .pablay/ found. Run 'pablay init' explicitly."` |
| Lazy init fails (e.g. disk full) | Print error to stderr, abort command |
| `pablay install` on fish/unsupported shell | Print manual snippet to stdout, continue with other install steps |
| `pablay projects` — project SQLite unreadable | Show `count: null` + `"(unreadable)"` marker, continue |
| Registry stale entries | Silently pruned on read, no error |

---

## Testing

| Type | Case |
|------|------|
| Unit | `registry.ts` — add, read, prune stale entries |
| Unit | `resolveRoot()` with explicit `root` override |
| Unit | `resolveRoot()` with `--root` + `--global` both set returns error |
| Unit | `lazyInit()` — git repo detection, triggers silent init |
| Unit | `lazyInit()` — non-git dir, no `.pablay/`, returns error |
| Unit | `--silent` flag suppresses stdout, not stderr |
| Integration | `pablay install` in a temp dir — verify shell rc appended with marker, registry created, system prompt written |
| Integration | `pablay install` run twice — verify shell rc not double-injected |
| Integration | `pablay projects` — verify stale pruning, live message counts, unreadable SQLite shows null |
| Integration | `pablay --root <path> list` — targets correct project, not cwd |
| E2E | `pablay list` in a git repo with no `.pablay/` — lazy init fires, command succeeds |
| E2E | `pablay list` in a non-git dir with no `.pablay/` — returns clear error |
| Unit | `resolveRoot()` with a relative `root` argument — returns error |
| Unit | `pablay init --global` — registry is not written |
| Integration | `pablay install` in a temp dir with no `CLAUDE.md`/`AGENTS.md` — verify neither file is created |
| Integration | `pablay --root <relative-path> list` — fails with `"--root requires an absolute path"` |
