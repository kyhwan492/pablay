import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessage } from "../formatters/text";
import { formatMessageJson } from "../formatters/json";
import { join } from "path";

export function registerShow(program: Command): void {
  program
    .command("show <id>")
    .description("Show a single message")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .pablay/ found. Run `pablay init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const msg = store.getById(id);
      store.close();

      if (!msg) {
        console.error(`Message not found: ${id}`);
        process.exit(2);
      }

      if (globalOpts.json) {
        console.log(formatMessageJson(msg));
      } else {
        console.log(formatMessage(msg));
      }
    });
}
