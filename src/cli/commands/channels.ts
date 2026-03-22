import type { Command } from "commander";
import { Store } from "../../core/store";
import { formatChannels } from "../formatters/text";
import { formatChannelsJson } from "../formatters/json";
import { join } from "path";

export function registerChannels(program: Command): void {
  program
    .command("channels")
    .description("List channels with message counts")
    .action(() => {
      const globalOpts = program.opts();
      const root = globalOpts._resolvedRoot as string;

      const store = new Store(join(root, "store.db"));
      const channels = store.getChannels();
      store.close();

      if (globalOpts.json) {
        console.log(formatChannelsJson(channels));
      } else if (channels.length > 0) {
        console.log(formatChannels(channels));
      }
    });
}
