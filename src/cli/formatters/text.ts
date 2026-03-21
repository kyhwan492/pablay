import type { Message, StateLogEntry } from "../../types";

export function formatMessage(msg: Message): string {
  const lines: string[] = [];
  lines.push(`[${msg.id}] ${msg.title}`);
  lines.push(`  Type: ${msg.type}  Status: ${msg.status}  Author: ${msg.author}`);
  if (msg.channel) lines.push(`  Channel: ${msg.channel}`);
  if (msg.parent_id) lines.push(`  Parent: ${msg.parent_id}`);
  if (msg.refs.length) lines.push(`  Refs: ${msg.refs.join(", ")}`);
  if (Object.keys(msg.metadata).length) lines.push(`  Metadata: ${JSON.stringify(msg.metadata)}`);
  lines.push(`  Created: ${msg.created_at}  Updated: ${msg.updated_at}`);
  if (msg.body) {
    lines.push("");
    lines.push(msg.body);
  }
  return lines.join("\n");
}

export function formatMessageList(messages: Message[]): string {
  return messages
    .map((msg) => {
      const ch = msg.channel ? ` #${msg.channel}` : "";
      return `${msg.id}  ${msg.status.padEnd(12)} ${msg.type.padEnd(8)} ${msg.title}${ch}`;
    })
    .join("\n");
}

export function formatStateLog(entries: StateLogEntry[]): string {
  return entries
    .map((e) => `${e.changed_at}  ${e.from_status ?? "(created)"} → ${e.to_status}  by ${e.changed_by}`)
    .join("\n");
}

export function formatChannels(channels: { channel: string; count: number }[]): string {
  return channels.map((c) => `#${c.channel}  ${c.count} messages`).join("\n");
}
