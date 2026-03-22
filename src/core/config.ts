import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
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

export function resolveRoot(cwd: string, global = false, root?: string): string | null {
  if (root !== undefined) {
    return join(root, ".pablay");
  }

  if (global) {
    return join(process.env.HOME ?? userInfo().homedir, ".pablay");
  }

  let dir = cwd;
  while (true) {
    const candidate = join(dir, ".pablay");
    if (existsSync(candidate)) {
      return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
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
  if (process.env.PABLAY_AUTHOR) return process.env.PABLAY_AUTHOR;
  if (config.author) return config.author;
  return userInfo().username;
}
