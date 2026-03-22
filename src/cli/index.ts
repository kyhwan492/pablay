#!/usr/bin/env bun
import { Command } from "commander";
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
import { initTelemetry, shutdownTelemetry } from "../telemetry/index";
import { loadConfig, resolveRoot } from "../core/config";

const program = new Command();

program
  .name("pablay")
  .description("Async communication tool for agent teams")
  .version("0.1.0")
  .option("--global", "Use machine-wide scope (~/.pablay)")
  .option("--json", "Output in JSON format");

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

program.hook("preAction", () => {
  const opts = program.opts();
  const root = resolveRoot(process.cwd(), opts.global);
  if (root) {
    const config = loadConfig(root);
    initTelemetry(config.otel);
  } else {
    initTelemetry(null);
  }
});

program.hook("postAction", async () => {
  await shutdownTelemetry();
});

program.parse();
