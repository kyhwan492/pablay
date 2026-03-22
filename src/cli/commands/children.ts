import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { formatMessageList } from "../formatters/text";
import { formatMessageListJson } from "../formatters/json";
import { join } from "path";

export function registerChildren(program: Command): void {
  program
    .command("children <id>")
    .description("List child messages of a parent")
    .action((id: string) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .pablay/ found. Run `pablay init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const children = store.getChildren(id);
      store.close();

      if (globalOpts.json) {
        console.log(formatMessageListJson(children));
      } else if (children.length > 0) {
        console.log(formatMessageList(children));
      }
    });
}
