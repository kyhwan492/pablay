import { stringify, parse } from "yaml";
import { writeFileSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import type { Message } from "../types.js";

export function renderMarkdown(msg: Message): string {
  const { body, ...frontmatterFields } = msg;
  const yaml = stringify(frontmatterFields, { lineWidth: 0 });
  return `---\n${yaml}---\n\n${body}`;
}

export function parseMarkdown(content: string): Message {
  const firstIdx = content.indexOf("---\n");
  if (firstIdx === -1) throw new Error("Missing frontmatter opening ---");

  const searchStart = firstIdx + 4;
  const secondIdx = content.indexOf("---\n", searchStart);
  if (secondIdx === -1) throw new Error("Missing frontmatter closing ---");

  const yamlStr = content.slice(searchStart, secondIdx);
  const frontmatter = parse(yamlStr);

  // Body starts after "---\n\n"
  const bodyStart = secondIdx + 4;
  let body = content.slice(bodyStart);
  // Strip the leading blank line between frontmatter and body
  if (body.startsWith("\n")) {
    body = body.slice(1);
  }

  return { ...frontmatter, body } as Message;
}

export function writeMessageFile(messagesDir: string, msg: Message): string {
  const dir = join(messagesDir, msg.type);
  mkdirSync(dir, { recursive: true });

  const filePath = join(dir, `${msg.id}.md`);
  const tmpPath = filePath + ".tmp";
  const content = renderMarkdown(msg);

  writeFileSync(tmpPath, content, "utf-8");
  renameSync(tmpPath, filePath);

  return filePath;
}

export function readMessageFile(filePath: string): Message {
  const content = readFileSync(filePath, "utf-8");
  return parseMarkdown(content);
}
