import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join } from "path";
import { Store } from "../../core/store";
import { defaultConfig } from "../../core/config";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize .agent-comm/ in the current directory")
    .action(() => {
      const opts = program.opts();
      const root = opts.global
        ? join(process.env.HOME ?? "", ".agent-comm")
        : join(process.cwd(), ".agent-comm");

      mkdirSync(root, { recursive: true });
      mkdirSync(join(root, "messages"), { recursive: true });

      const configPath = join(root, "config.json");
      if (!existsSync(configPath)) {
        writeFileSync(configPath, JSON.stringify(defaultConfig(), null, 2), "utf-8");
      }

      const store = new Store(join(root, "store.db"));
      store.close();

      const lastSyncPath = join(root, ".last_sync");
      if (!existsSync(lastSyncPath)) {
        writeFileSync(lastSyncPath, new Date().toISOString(), "utf-8");
      }

      console.log(`Initialized ${root}`);
    });
}
