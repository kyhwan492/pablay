import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
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
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

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
