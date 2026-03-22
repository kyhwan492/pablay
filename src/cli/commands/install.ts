import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync, readFileSync, appendFileSync } from "fs";
import { join } from "path";
import os from "os";
import { Store } from "../../core/store";
import { defaultConfig } from "../../core/config";

const ZSH_BLOCK = `
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
`;

const BASH_BLOCK = `
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
PROMPT_COMMAND="_pablay_prompt_command\${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
# End pablay install
`;

const AGENT_INSTRUCTIONS_BLOCK = `
## Pablay — Task Coordination

Pablay is the task and message board for this project. It lives in \`.pablay/\`.

**Self-setup:** If \`.pablay/\` does not exist, run \`pablay init\` before doing anything else.

**Core workflow:**
- \`pablay create task --title "..." --channel <area>\` — create a task
- \`pablay list --type task --status open\` — see what's open
- \`pablay start <id>\` — claim a task
- \`pablay complete <id>\` — mark done
- \`pablay thread <id>\` — get full context on a task

**Conventions:**
- Use channel names matching the work area: \`backend\`, \`frontend\`, \`infra\`, \`docs\`
- For sub-5-minute work, skip tasks — use \`pablay create note\` instead
- Always \`pablay start <id>\` before working on a task so others know it's claimed

**Output:** Use \`--json\` flag when piping to other tools.
`;

const SYSTEM_PROMPT_CONTENT = `## Pablay — Cross-Project Coordination

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
`;

export function registerInstall(program: Command): void {
  program
    .command("install")
    .description("Set up Pablay globally (shell hook, registry, agent instructions)")
    .action(() => {
      const homeDir = os.homedir();
      const shell = process.env["SHELL"] ?? "";
      const lines: string[] = [];
      let rcFile: string | null = null;

      // Step 1: Shell hook injection
      if (shell.endsWith("zsh")) {
        rcFile = join(homeDir, ".zshrc");
        const existing = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
        if (existing.includes("# Added by pablay install")) {
          lines.push(`[skipped] shell hook already in ${rcFile}`);
        } else {
          appendFileSync(rcFile, ZSH_BLOCK, "utf-8");
          lines.push(`[ok] shell hook → ${rcFile}`);
        }
      } else if (shell.endsWith("bash")) {
        rcFile = join(homeDir, ".bashrc");
        const existing = existsSync(rcFile) ? readFileSync(rcFile, "utf-8") : "";
        if (existing.includes("# Added by pablay install")) {
          lines.push(`[skipped] shell hook already in ${rcFile}`);
        } else {
          appendFileSync(rcFile, BASH_BLOCK, "utf-8");
          lines.push(`[ok] shell hook → ${rcFile}`);
        }
      } else {
        console.log("Unsupported shell. Add the following to your shell RC file manually:");
        console.log(ZSH_BLOCK);
        lines.push("[skipped] shell hook → unsupported shell, printed snippet");
      }

      // Step 2: Global init
      const globalDir = join(homeDir, ".pablay");
      const messagesDir = join(globalDir, "messages");
      mkdirSync(globalDir, { recursive: true });
      mkdirSync(messagesDir, { recursive: true });

      const configPath = join(globalDir, "config.json");
      if (!existsSync(configPath)) {
        writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2), "utf-8");
      }

      const store = new Store(join(globalDir, "store.db"));
      store.close();

      const lastSyncPath = join(globalDir, ".last_sync");
      if (!existsSync(lastSyncPath)) {
        writeFileSync(lastSyncPath, new Date().toISOString(), "utf-8");
      }

      lines.push(`[ok] global init → ${globalDir}`);

      // Step 3: Registry bootstrap
      const registryPath = join(globalDir, "projects.json");
      if (!existsSync(registryPath)) {
        writeFileSync(registryPath, "[]", "utf-8");
        lines.push(`[ok] registry → ${registryPath}`);
      } else {
        lines.push("[skipped] registry already exists");
      }

      // Step 4: Agent instruction injection
      const cwd = process.cwd();
      const agentFiles = ["CLAUDE.md", "AGENTS.md"];
      for (const filename of agentFiles) {
        const filePath = join(cwd, filename);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, "utf-8");
          if (content.includes("## Pablay — Task Coordination")) {
            lines.push(`[skipped] ${filename} already has Pablay section`);
          } else {
            appendFileSync(filePath, AGENT_INSTRUCTIONS_BLOCK, "utf-8");
            lines.push(`[ok] agent instructions → ${filename}`);
          }
        }
      }

      // Step 5: System prompt generation
      const systemPromptPath = join(globalDir, "system-prompt.md");
      writeFileSync(systemPromptPath, SYSTEM_PROMPT_CONTENT, "utf-8");
      lines.push(`[ok] system prompt → ${systemPromptPath}`);

      // Step 6: Print summary
      for (const line of lines) {
        console.log(line);
      }

      if (rcFile) {
        const rcBasename = rcFile.split("/").pop();
        console.log(`\nRun: source ~/${rcBasename}`);
      }
    });
}
