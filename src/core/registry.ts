import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";

interface RegistryEntry {
  path: string;
  name: string;
  added_at: string;
}

export function registryPath(): string {
  return join(homedir(), ".pablay", "projects.json");
}

function readRegistry(): RegistryEntry[] {
  const rp = registryPath();
  if (!existsSync(rp)) return [];
  try {
    return JSON.parse(readFileSync(rp, "utf-8")) as RegistryEntry[];
  } catch {
    return [];
  }
}

function writeRegistry(entries: RegistryEntry[]): void {
  const rp = registryPath();
  mkdirSync(dirname(rp), { recursive: true });
  writeFileSync(rp, JSON.stringify(entries, null, 2), "utf-8");
}

export function add(projectRoot: string): void {
  const rp = registryPath();
  mkdirSync(dirname(rp), { recursive: true });

  if (!existsSync(rp)) {
    writeFileSync(rp, "[]", "utf-8");
  }

  const entries = readRegistry();
  const alreadyPresent = entries.some((e) => e.path === projectRoot);
  if (alreadyPresent) return;

  entries.push({
    path: projectRoot,
    name: basename(projectRoot),
    added_at: new Date().toISOString(),
  });

  writeRegistry(entries);
}

export function list(): RegistryEntry[] {
  const entries = readRegistry();
  const pruned = entries.filter((e) => existsSync(e.path));
  if (pruned.length !== entries.length) {
    writeRegistry(pruned);
  }
  return pruned;
}

export function remove(projectRoot: string): void {
  const entries = readRegistry();
  const filtered = entries.filter((e) => e.path !== projectRoot);
  writeRegistry(filtered);
}
