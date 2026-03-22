import type { Command } from "commander";
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
      const root = globalOpts._resolvedRoot as string;

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
