import { readdirSync, existsSync } from "fs";
import { join } from "path";
import { Store } from "./store";
import { writeMessageFile, readMessageFile } from "./markdown";

export class SyncEngine {
  constructor(
    private store: Store,
    private messagesDir: string
  ) {}

  /** Render all messages from SQLite to markdown files */
  renderAll(): void {
    const messages = this.store.list({}, { limit: 100000, includeArchived: true });
    for (const msg of messages) {
      writeMessageFile(this.messagesDir, msg);
    }
  }

  /** Render a single message to markdown */
  renderOne(id: string): void {
    const msg = this.store.getById(id);
    if (msg) {
      writeMessageFile(this.messagesDir, msg);
    }
  }

  /** Rebuild SQLite from markdown files (for disaster recovery) */
  rebuild(): { imported: number; skipped: number } {
    let imported = 0;
    let skipped = 0;

    if (!existsSync(this.messagesDir)) {
      return { imported, skipped };
    }

    const typeDirs = readdirSync(this.messagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const typeDir of typeDirs) {
      const dirPath = join(this.messagesDir, typeDir);
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".md") && !f.endsWith(".conflict.md") && !f.endsWith(".tmp"));

      for (const file of files) {
        try {
          const msg = readMessageFile(join(dirPath, file));
          this.store.insert(msg);
          imported++;
        } catch {
          skipped++;
        }
      }
    }

    return { imported, skipped };
  }

  /** Sync edited markdown files back to SQLite */
  syncFromMarkdown(): { updated: number; conflicts: number } {
    let updated = 0;
    let conflicts = 0;

    if (!existsSync(this.messagesDir)) {
      return { updated, conflicts };
    }

    const typeDirs = readdirSync(this.messagesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);

    for (const typeDir of typeDirs) {
      const dirPath = join(this.messagesDir, typeDir);
      const files = readdirSync(dirPath).filter((f) => f.endsWith(".md") && !f.endsWith(".conflict.md") && !f.endsWith(".tmp"));

      for (const file of files) {
        try {
          const filePath = join(dirPath, file);
          const mdMsg = readMessageFile(filePath);
          const dbMsg = this.store.getById(mdMsg.id);

          if (!dbMsg) {
            this.store.insert(mdMsg);
            updated++;
          } else if (mdMsg.updated_at > dbMsg.updated_at) {
            this.store.update(mdMsg.id, {
              status: mdMsg.status,
              title: mdMsg.title,
              body: mdMsg.body,
              metadata: mdMsg.metadata,
            });
            updated++;
          }
        } catch {
          conflicts++;
        }
      }
    }

    return { updated, conflicts };
  }
}
