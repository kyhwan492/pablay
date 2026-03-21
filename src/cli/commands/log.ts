import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatStateLog } from "../formatters/text";
import { formatStateLogJson } from "../formatters/json";
import { join } from "path";

export function registerLog(program: Command): void {
  program
    .command("log <id>")
    .description("Show state transition history for a message")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const msg = store.getById(id);

      if (!msg) {
        console.error(`Message not found: ${id}`);
        store.close();
        process.exit(2);
      }

      const log = store.getStateLog(id);
      store.close();

      if (globalOpts.json) {
        console.log(formatStateLogJson(log));
      } else if (log.length > 0) {
        console.log(formatStateLog(log));
      }
    });
}
