import type { Command } from "commander";
import { resolveRoot, loadConfig, resolveAuthor } from "../../core/config";
import { Store } from "../../core/store";
import { validateTransition } from "../../core/message";
import { SyncEngine } from "../../core/sync";
import { join } from "path";
import type { Status } from "../../types";
import { recordStateTransition } from "../../telemetry/metrics";
import { logStateTransition } from "../../telemetry/logs";

function performUpdate(
  program: Command,
  id: string,
  opts: { status?: string; body?: string; metadata?: string; addRef?: string; removeRef?: string; author?: string }
): void {
  const globalOpts = program.opts();
  const root = resolveRoot(process.cwd(), globalOpts.global);
  if (!root) {
    console.error("No .agent-comm/ found. Run `ac init` first.");
    process.exit(1);
  }

  const config = loadConfig(root);
  const store = new Store(join(root, "store.db"));
  const msg = store.getById(id);

  if (!msg) {
    console.error(`Message not found: ${id}`);
    store.close();
    process.exit(2);
  }

  const author = resolveAuthor(config, opts.author);

  if (opts.status) {
    const newStatus = opts.status as Status;
    validateTransition(config, msg.type, msg.status, newStatus);
    store.update(id, { status: newStatus });
    store.logTransition(id, msg.status, newStatus, author);
    recordStateTransition(msg.status, newStatus);
    logStateTransition(id, msg.status, newStatus, author);
  }

  if (opts.body) {
    store.update(id, { body: opts.body });
  }

  if (opts.metadata) {
    store.update(id, { metadata: JSON.parse(opts.metadata) });
  }

  if (opts.addRef) {
    store.addRef(id, opts.addRef);
  }
  if (opts.removeRef) {
    store.removeRef(id, opts.removeRef);
  }

  const sync = new SyncEngine(store, join(root, "messages"));
  sync.renderOne(id);

  if (globalOpts.json) {
    const updated = store.getById(id);
    console.log(JSON.stringify(updated, null, 2));
  } else {
    console.log(id);
  }

  store.close();
}

export function registerUpdate(program: Command): void {
  program
    .command("update <id>")
    .description("Update a message")
    .option("--status <status>", "New status")
    .option("--body <body>", "New body")
    .option("--metadata <json>", "Metadata to merge (JSON)")
    .option("--add-ref <id>", "Add a ref")
    .option("--remove-ref <id>", "Remove a ref")
    .option("--author <author>", "Author of this change")
    .action((id: string, opts: any) => {
      try {
        performUpdate(program, id, opts);
      } catch (e: any) {
        console.error(e.message);
        process.exit(1);
      }
    });

  for (const [cmd, status, desc] of [
    ["start", "in_progress", "Transition to in_progress"],
    ["complete", "completed", "Transition to completed"],
    ["cancel", "cancelled", "Transition to cancelled"],
    ["archive", "archived", "Archive (soft delete)"],
  ] as const) {
    program
      .command(`${cmd} <id>`)
      .description(desc)
      .option("--metadata <json>", "Metadata to merge")
      .option("--body <body>", "Update body")
      .option("--author <author>", "Author of this change")
      .action((id: string, opts: any) => {
        try {
          performUpdate(program, id, { ...opts, status });
        } catch (e: any) {
          console.error(e.message);
          process.exit(1);
        }
      });
  }
}
