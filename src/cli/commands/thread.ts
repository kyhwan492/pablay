import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessage, formatMessageList } from "../formatters/text";
import { join } from "path";

export function registerThread(program: Command): void {
  program
    .command("thread <id>")
    .description("Show message with full thread (parent + children + refs)")
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

      const children = store.getChildren(id);
      const refs = msg.refs.map((refId) => store.getById(refId)).filter(Boolean);
      store.close();

      if (globalOpts.json) {
        console.log(JSON.stringify({ message: msg, children, refs }, null, 2));
      } else {
        console.log(formatMessage(msg));
        if (children.length) {
          console.log("\n--- Children ---");
          console.log(formatMessageList(children));
        }
        if (refs.length) {
          console.log("\n--- Refs ---");
          console.log(formatMessageList(refs as any));
        }
      }
    });
}
