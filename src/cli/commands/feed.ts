import type { Command } from "commander";
import { Store } from "../../core/store";
import { formatMessageList } from "../formatters/text";
import { formatMessageListJson } from "../formatters/json";
import { join } from "path";

export function registerFeed(program: Command): void {
  program
    .command("feed")
    .description("Show recent messages chronologically")
    .option("--channel <channel>", "Filter by channel")
    .option("--since <timestamp>", "Only messages after this ISO timestamp")
    .option("--limit <n>", "Max results", "50")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = globalOpts._resolvedRoot as string;

      const store = new Store(join(root, "store.db"));
      const messages = store.feed(
        { channel: opts.channel, since: opts.since },
        { limit: parseInt(opts.limit) }
      );
      store.close();

      if (globalOpts.json) {
        console.log(formatMessageListJson(messages));
      } else if (messages.length > 0) {
        console.log(formatMessageList(messages));
      }
    });
}
