import type { Command } from "commander";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";
import { Store } from "../../core/store";
import { defaultConfig } from "../../core/config";
import { add } from "../../core/registry";

export function registerInit(program: Command): void {
  program
    .command("init")
    .description("Initialize .pablay/ in the current directory")
    .option("--silent", "Suppress output")
    .action((cmdOpts: any) => {
      const opts = program.opts();
      const root = opts.global
        ? join(process.env.HOME ?? "", ".pablay")
        : join(process.cwd(), ".pablay");

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

      if (!opts.global) {
        add(resolve(root, ".."));
      }

      if (!cmdOpts.silent) {
        console.log(`Initialized ${root}`);
      }
    });
}
