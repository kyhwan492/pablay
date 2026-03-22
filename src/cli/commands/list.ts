import type { Command } from "commander";
import { Store } from "../../core/store";
import { formatMessageList } from "../formatters/text";
import { formatMessageListJson } from "../formatters/json";
import { join } from "path";

export function registerList(program: Command): void {
  program
    .command("list")
    .description("List messages with optional filters")
    .option("--type <type>", "Filter by type")
    .option("--status <status>", "Filter by status")
    .option("--channel <channel>", "Filter by channel")
    .option("--author <author>", "Filter by author")
    .option("--parent <id>", "Filter by parent ID")
    .option("--limit <n>", "Max results", "50")
    .option("--offset <n>", "Skip results", "0")
    .option("--include-archived", "Include archived messages")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = globalOpts._resolvedRoot as string;

      const store = new Store(join(root, "store.db"));
      const messages = store.list(
        {
          type: opts.type,
          status: opts.status,
          channel: opts.channel,
          author: opts.author,
          parent_id: opts.parent,
        },
        {
          limit: parseInt(opts.limit),
          offset: parseInt(opts.offset),
          includeArchived: opts.includeArchived,
        }
      );
      store.close();

      if (globalOpts.json) {
        console.log(formatMessageListJson(messages));
      } else if (messages.length > 0) {
        console.log(formatMessageList(messages));
      }
    });
}
