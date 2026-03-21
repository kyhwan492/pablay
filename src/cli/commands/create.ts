import type { Command } from "commander";
import { resolveRoot, loadConfig, resolveAuthor } from "../../core/config";
import { Store } from "../../core/store";
import { createMessage } from "../../core/message";
import { SyncEngine } from "../../core/sync";
import { join } from "path";

export function registerCreate(program: Command): void {
  program
    .command("create <type>")
    .description("Create a new message")
    .requiredOption("--title <title>", "Message title")
    .option("--body <body>", "Message body (markdown)")
    .option("--channel <channel>", "Channel/topic")
    .option("--parent <id>", "Parent message ID")
    .option("--author <author>", "Author name")
    .option("--refs <ids>", "Comma-separated ref IDs")
    .option("--metadata <json>", "JSON metadata")
    .action(async (type: string, opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .agent-comm/ found. Run `ac init` first.");
        process.exit(1);
      }

      const config = loadConfig(root);
      const author = resolveAuthor(config, opts.author);

      let body = opts.body ?? "";
      if (!body && !process.stdin.isTTY) {
        body = await new Response(process.stdin as any).text();
        body = body.trim();
      }

      const msg = createMessage(config, {
        type,
        title: opts.title,
        body,
        author,
        channel: opts.channel ?? null,
        parent_id: opts.parent ?? null,
        refs: opts.refs ? opts.refs.split(",") : [],
        metadata: opts.metadata ? JSON.parse(opts.metadata) : {},
      });

      const store = new Store(join(root, "store.db"));
      store.insert(msg);
      store.logTransition(msg.id, null, msg.status, author);

      const sync = new SyncEngine(store, join(root, "messages"));
      sync.renderOne(msg.id);

      store.close();

      if (globalOpts.json) {
        console.log(JSON.stringify(msg, null, 2));
      } else {
        console.log(msg.id);
      }
    });
}
