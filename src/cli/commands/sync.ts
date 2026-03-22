import type { Command } from "commander";
import { resolveRoot } from "../../core/config";
import { Store } from "../../core/store";
import { SyncEngine } from "../../core/sync";
import { join } from "path";
import { writeFileSync } from "fs";

export function registerSync(program: Command): void {
  program
    .command("sync")
    .description("Reconcile markdown files with SQLite")
    .option("--rebuild", "Rebuild SQLite from markdown files")
    .action((opts: any) => {
      const globalOpts = program.opts();
      const root = resolveRoot(process.cwd(), globalOpts.global);
      if (!root) {
        console.error("No .pablay/ found. Run `pablay init` first.");
        process.exit(1);
      }

      const store = new Store(join(root, "store.db"));
      const sync = new SyncEngine(store, join(root, "messages"));

      if (opts.rebuild) {
        const result = sync.rebuild();
        console.log(`Rebuilt: ${result.imported} imported, ${result.skipped} skipped`);
      } else {
        const result = sync.syncFromMarkdown();
        sync.renderAll();
        console.log(`Synced: ${result.updated} updated, ${result.conflicts} conflicts`);
      }

      writeFileSync(join(root, ".last_sync"), new Date().toISOString(), "utf-8");
      store.close();
    });
}
