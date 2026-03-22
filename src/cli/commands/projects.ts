import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import os from "os";
import { Store } from "../../core/store";

interface ProjectEntry {
  path: string;
  name: string;
  added_at: string;
}

export function registerProjects(program: Command): void {
  program
    .command("projects")
    .description("List all registered Pablay projects")
    .action(() => {
      const globalOpts = program.opts();
      const registryPath = join(os.homedir(), ".pablay", "projects.json");

      if (!existsSync(registryPath)) {
        console.log("No projects registered. Run `pablay install` first.");
        process.exit(0);
      }

      let entries: ProjectEntry[] = [];
      try {
        entries = JSON.parse(readFileSync(registryPath, "utf-8")) as ProjectEntry[];
      } catch {
        entries = [];
      }

      // Prune stale entries
      const surviving = entries.filter((entry) => existsSync(entry.path));
      if (surviving.length !== entries.length) {
        writeFileSync(registryPath, JSON.stringify(surviving, null, 2), "utf-8");
      }

      // Count messages per project
      const results: Array<ProjectEntry & { message_count: number | null }> = [];
      for (const entry of surviving) {
        let count: number | null = null;
        try {
          const dbPath = join(entry.path, ".pablay", "store.db");
          const store = new Store(dbPath);
          count = store.list({}, { limit: 99999 }).length;
          store.close();
        } catch {
          count = null;
        }
        results.push({ ...entry, message_count: count });
      }

      if (globalOpts["json"]) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        for (const r of results) {
          const countStr = r.message_count !== null ? `(${r.message_count} messages)` : "(unreadable)";
          console.log(`${r.name}  ${r.path}  ${countStr}`);
        }
      }
    });
}
