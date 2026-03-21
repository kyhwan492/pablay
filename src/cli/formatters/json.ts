import type { Message, StateLogEntry } from "../../types";

export function formatMessageJson(msg: Message): string {
  return JSON.stringify(msg, null, 2);
}

export function formatMessageListJson(messages: Message[]): string {
  return JSON.stringify(messages, null, 2);
}

export function formatStateLogJson(entries: StateLogEntry[]): string {
  return JSON.stringify(entries, null, 2);
}

export function formatChannelsJson(channels: { channel: string; count: number }[]): string {
  return JSON.stringify(channels, null, 2);
}
