import type { Command } from "commander";
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
      const root = globalOpts._resolvedRoot as string;

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
