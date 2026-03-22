#!/usr/bin/env bun
import { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import * as path from "path";
import { execSync } from "child_process";
import { registerInit } from "./commands/init";
import { registerCreate } from "./commands/create";
import { registerShow } from "./commands/show";
import { registerList } from "./commands/list";
import { registerUpdate } from "./commands/update";
import { registerFeed } from "./commands/feed";
import { registerThread } from "./commands/thread";
import { registerChildren } from "./commands/children";
import { registerChannels } from "./commands/channels";
import { registerLog } from "./commands/log";
import { registerSync } from "./commands/sync";
import { registerExport } from "./commands/export";
import { registerInstall } from "./commands/install";
import { registerProjects } from "./commands/projects";
import { initTelemetry, shutdownTelemetry } from "../telemetry/index";
import { loadConfig, resolveRoot, defaultConfig } from "../core/config";
import { Store } from "../core/store";
import { add } from "../core/registry";

function lazyInit(cwd: string): void {
  try {
    execSync("git rev-parse --git-dir", { cwd, stdio: "ignore" });
  } catch {
    // Not a git repo — only error if there's also no .pablay/ found
    if (!resolveRoot(cwd, false)) {
      console.error("Not a git repo and no .pablay/ found. Run 'pablay init' explicitly.");
      process.exit(1);
    }
    return;
  }

  // It's a git repo — check if .pablay/ already exists (walk up from cwd)
  const existing = resolveRoot(cwd, false);
  if (existing) return; // already initialized

  // Auto-init in the git repo root (not necessarily cwd)
  let gitRoot: string;
  try {
    gitRoot = execSync("git rev-parse --show-toplevel", { cwd, encoding: "utf-8" }).trim();
  } catch {
    gitRoot = cwd;
  }

  // Run init logic inline (silent)
  const pablayDir = join(gitRoot, ".pablay");
  mkdirSync(pablayDir, { recursive: true });
  mkdirSync(join(pablayDir, "messages"), { recursive: true });

  const configPath = join(pablayDir, "config.json");
  if (!existsSync(configPath)) {
    writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2), "utf-8");
  }

  const store = new Store(join(pablayDir, "store.db"));
  store.close();

  const lastSyncPath = join(pablayDir, ".last_sync");
  if (!existsSync(lastSyncPath)) {
    writeFileSync(lastSyncPath, new Date().toISOString(), "utf-8");
  }

  // Register in global registry
  add(gitRoot);
}

const program = new Command();

program
  .name("pablay")
  .description("Async communication tool for agent teams")
  .version("0.1.0")
  .option("--global", "Use machine-wide scope (~/.pablay)")
  .option("--json", "Output in JSON format")
  .option("--root <path>", "Target a specific project by absolute path");

registerInit(program);
registerCreate(program);
registerShow(program);
registerList(program);
registerUpdate(program);
registerFeed(program);
registerThread(program);
registerChildren(program);
registerChannels(program);
registerLog(program);
registerSync(program);
registerExport(program);
registerInstall(program);
registerProjects(program);

program.hook("preAction", (_thisCommand, actionCommand) => {
  const opts = program.opts();

  // 1. Validate --root before anything else
  if (opts.root !== undefined) {
    if (!path.isAbsolute(opts.root)) {
      console.error("--root requires an absolute path");
      process.exit(1);
    }
    if (opts.global) {
      console.error("--root and --global cannot be used together");
      process.exit(1);
    }
  }

  // 2. Lazy init (skip for install, init, projects, and when --root/--global is set)
  const skipLazyInit = ["install", "init", "projects"].includes(actionCommand.name())
    || opts.global === true
    || opts.root !== undefined;

  if (!skipLazyInit) {
    lazyInit(process.cwd());
  }

  // 3. Resolve root and store it
  const resolvedRoot = resolveRoot(process.cwd(), opts.global, opts.root ?? undefined);

  // 4. Validate --root target exists (only when --root was explicitly passed)
  if (opts.root !== undefined && resolvedRoot !== null) {
    if (!existsSync(resolvedRoot)) {
      console.error(`No Pablay store at '${resolvedRoot}'. Run 'pablay init' there first.`);
      process.exit(1);
    }
  }

  // 5. Store resolved root for command handlers
  program.setOptionValue("_resolvedRoot", resolvedRoot ?? "");

  // 6. Init telemetry
  if (resolvedRoot && existsSync(resolvedRoot)) {
    const config = loadConfig(resolvedRoot);
    initTelemetry(config.otel);
  } else {
    initTelemetry(null);
  }
});

program.hook("postAction", async () => {
  await shutdownTelemetry();
});

program.parse();
