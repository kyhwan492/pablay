import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { join } from "path";

export function registerExport(program: Command): void {
  program
    .command("export")
    .description("Export all messages")
    .option("--format <format>", "Output format: json (NDJSON) or md (tar)", "json")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));

      if (opts.format === "json") {
        const messages = store.list({}, { limit: 100000, includeArchived: true });
        for (const msg of messages) {
          console.log(JSON.stringify(msg));
        }
      } else if (opts.format === "md") {
        const proc = Bun.spawnSync(["tar", "-cf", "-", "-C", root, "messages"], {
          stdout: "inherit",
          stderr: "pipe",
        });
        if (proc.exitCode !== 0) {
          console.error("Failed to create tar archive");
          process.exit(1);
        }
      }

      store.close();
    });
}
