import { Database } from "bun:sqlite";
import type { Message, StateLogEntry, Status } from "../types";

export interface ListFilters {
  type?: string;
  status?: Status;
  channel?: string;
  author?: string;
  parent_id?: string;
}

export interface FeedFilters {
  channel?: string;
  since?: string;
}

export interface ListOptions {
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
}

const SCHEMA_SQL = `
PRAGMA journal_mode = WAL;
PRAGMA user_version = 1;
CREATE TABLE IF NOT EXISTS messages (id TEXT PRIMARY KEY, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '', author TEXT NOT NULL, channel TEXT, parent_id TEXT REFERENCES messages(id), refs TEXT NOT NULL DEFAULT '[]', metadata TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_messages_type ON messages(type);
CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
CREATE INDEX IF NOT EXISTS idx_messages_channel ON messages(channel);
CREATE INDEX IF NOT EXISTS idx_messages_parent_id ON messages(parent_id);
CREATE INDEX IF NOT EXISTS idx_messages_author ON messages(author);
CREATE TABLE IF NOT EXISTS state_log (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id TEXT NOT NULL REFERENCES messages(id), from_status TEXT, to_status TEXT NOT NULL, changed_by TEXT NOT NULL, changed_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_state_log_message_id ON state_log(message_id);
`;

function rowToMessage(row: any): Message {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    body: row.body,
    author: row.author,
    channel: row.channel ?? null,
    parent_id: row.parent_id ?? null,
    refs: JSON.parse(row.refs),
    metadata: JSON.parse(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export class Store {
  private db: Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.exec(SCHEMA_SQL);
  }

  getSchemaVersion(): number {
    const row = this.db.prepare("PRAGMA user_version").get() as any;
    return row.user_version;
  }

  insert(msg: Message): void {
    this.db
      .prepare(
        `INSERT INTO messages (id, type, status, title, body, author, channel, parent_id, refs, metadata, created_at, updated_at)
         VALUES ($id, $type, $status, $title, $body, $author, $channel, $parent_id, $refs, $metadata, $created_at, $updated_at)`
      )
      .run({
        $id: msg.id,
        $type: msg.type,
        $status: msg.status,
        $title: msg.title,
        $body: msg.body,
        $author: msg.author,
        $channel: msg.channel,
        $parent_id: msg.parent_id,
        $refs: JSON.stringify(msg.refs),
        $metadata: JSON.stringify(msg.metadata),
        $created_at: msg.created_at,
        $updated_at: msg.updated_at,
      });
  }

  getById(id: string): Message | null {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
    if (!row) return null;
    return rowToMessage(row);
  }

  update(
    id: string,
    fields: Partial<Pick<Message, "status" | "body" | "metadata" | "title">>
  ): void {
    const existing = this.getById(id);
    if (!existing) throw new Error(`Message not found: ${id}`);

    const sets: string[] = [];
    const params: Record<string, any> = { $id: id };

    if (fields.status !== undefined) {
      sets.push("status = $status");
      params.$status = fields.status;
    }
    if (fields.body !== undefined) {
      sets.push("body = $body");
      params.$body = fields.body;
    }
    if (fields.title !== undefined) {
      sets.push("title = $title");
      params.$title = fields.title;
    }
    if (fields.metadata !== undefined) {
      const merged = { ...existing.metadata, ...fields.metadata };
      sets.push("metadata = $metadata");
      params.$metadata = JSON.stringify(merged);
    }

    if (sets.length === 0) return;

    sets.push("updated_at = $updated_at");
    params.$updated_at = new Date().toISOString();

    this.db.prepare(`UPDATE messages SET ${sets.join(", ")} WHERE id = $id`).run(params);
  }

  addRef(id: string, refId: string): void {
    const msg = this.getById(id);
    if (!msg) throw new Error(`Message not found: ${id}`);
    if (msg.refs.includes(refId)) return;
    const newRefs = [...msg.refs, refId];
    this.db
      .prepare("UPDATE messages SET refs = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(newRefs), new Date().toISOString(), id);
  }

  removeRef(id: string, refId: string): void {
    const msg = this.getById(id);
    if (!msg) throw new Error(`Message not found: ${id}`);
    const newRefs = msg.refs.filter((r) => r !== refId);
    this.db
      .prepare("UPDATE messages SET refs = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify(newRefs), new Date().toISOString(), id);
  }

  list(filters: ListFilters, options?: ListOptions): Message[] {
    const clauses: string[] = [];
    const params: Record<string, any> = {};

    if (!options?.includeArchived) {
      clauses.push("status != 'archived'");
    }
    if (filters.type) {
      clauses.push("type = $type");
      params.$type = filters.type;
    }
    if (filters.status) {
      clauses.push("status = $status");
      params.$status = filters.status;
    }
    if (filters.channel) {
      clauses.push("channel = $channel");
      params.$channel = filters.channel;
    }
    if (filters.author) {
      clauses.push("author = $author");
      params.$author = filters.author;
    }
    if (filters.parent_id) {
      clauses.push("parent_id = $parent_id");
      params.$parent_id = filters.parent_id;
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    let sql = `SELECT * FROM messages ${where} ORDER BY created_at ASC`;

    if (options?.limit) {
      sql += ` LIMIT $limit`;
      params.$limit = options.limit;
    }
    if (options?.offset) {
      sql += ` OFFSET $offset`;
      params.$offset = options.offset;
    }

    const rows = this.db.prepare(sql).all(params) as any[];
    return rows.map(rowToMessage);
  }

  feed(filters: FeedFilters, options?: ListOptions): Message[] {
    const clauses: string[] = ["status != 'archived'"];
    const params: Record<string, any> = {};

    if (filters.channel) {
      clauses.push("channel = $channel");
      params.$channel = filters.channel;
    }
    if (filters.since) {
      clauses.push("created_at > $since");
      params.$since = filters.since;
    }

    const where = `WHERE ${clauses.join(" AND ")}`;
    let sql = `SELECT * FROM messages ${where} ORDER BY created_at DESC`;

    if (options?.limit) {
      sql += ` LIMIT $limit`;
      params.$limit = options.limit;
    }
    if (options?.offset) {
      sql += ` OFFSET $offset`;
      params.$offset = options.offset;
    }

    const rows = this.db.prepare(sql).all(params) as any[];
    return rows.map(rowToMessage);
  }

  getChildren(parentId: string): Message[] {
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE parent_id = ? ORDER BY created_at ASC")
      .all(parentId) as any[];
    return rows.map(rowToMessage);
  }

  logTransition(
    messageId: string,
    fromStatus: Status | null,
    toStatus: Status,
    changedBy: string
  ): void {
    this.db
      .prepare(
        "INSERT INTO state_log (message_id, from_status, to_status, changed_by, changed_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(messageId, fromStatus, toStatus, changedBy, new Date().toISOString());
  }

  getStateLog(messageId: string): StateLogEntry[] {
    return this.db
      .prepare("SELECT * FROM state_log WHERE message_id = ? ORDER BY id ASC")
      .all(messageId) as StateLogEntry[];
  }

  getChannels(): { channel: string; count: number }[] {
    return this.db
      .prepare(
        "SELECT channel, COUNT(*) as count FROM messages WHERE channel IS NOT NULL AND status != 'archived' GROUP BY channel ORDER BY channel ASC"
      )
      .all() as { channel: string; count: number }[];
  }

  close(): void {
    this.db.close();
  }
}
