import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { IconData } from "./svg.js";

export const STYLES = [
  "stroke-rounded",
  "stroke-sharp",
  "stroke-standard",
  "solid-rounded",
  "solid-sharp",
  "solid-standard",
  "duotone-rounded",
  "duotone-standard",
  "twotone-rounded",
  "bulk-rounded",
] as const;
export type Style = (typeof STYLES)[number];

const FREE_PACKAGE = "@hugeicons/core-free-icons";

export type StyleIndex = {
  style: Style;
  packageName: string;
  isFree: boolean;
  dir: string;
  // File base name (e.g. "DeliveryTruck01") to the other names the package exports it under.
  files: Map<string, string[]>;
};

const proPackage = (style: Style) => `@hugeicons-pro/core-${style}`;
const pascal = (s: string) => s.replace(/(^|-)([a-z])/g, (_, __, c: string) => c.toUpperCase());

function resolveEntry(packageName: string): string | null {
  try {
    return fileURLToPath(import.meta.resolve(packageName));
  } catch {
    return null;
  }
}

const EXPORT_LINE = /export \{([^}]*)\} from '\.\/(\w+)Icon\.js'/g;

export function parseIndex(source: string, styleSuffix: string): Map<string, string[]> {
  const files = new Map<string, string[]>();
  for (const match of source.matchAll(EXPORT_LINE)) {
    const base = match[2]!;
    const aliases = match[1]!
      .split(",")
      .map((s) => s.trim().replace(/^default as /, ""))
      .map((n) => (n.endsWith("Icon") ? n.slice(0, -4) : n))
      .filter((n) => n !== base && !n.endsWith(styleSuffix));
    files.set(base, [...new Set(aliases)]);
  }
  return files;
}

async function readStyle(style: Style, packageName: string, isFree: boolean): Promise<StyleIndex | null> {
  const entry = resolveEntry(packageName);
  if (!entry) return null;
  const source = await readFile(entry, "utf8");
  const files = parseIndex(source, isFree ? "FreeIcons" : pascal(style));
  if (files.size === 0) throw new Error(`${packageName} has an index format this server does not recognise`);
  return { style, packageName, isFree, dir: dirname(entry), files };
}

const indexes = new Map<Style, Promise<StyleIndex | null>>();

// The free package is the stroke-rounded set, so it stands in when the Pro one is absent.
export function loadStyle(style: Style): Promise<StyleIndex | null> {
  let pending = indexes.get(style);
  if (!pending) {
    pending = readStyle(style, proPackage(style), false).then(
      (pro) => pro ?? (style === "stroke-rounded" ? readStyle(style, FREE_PACKAGE, true) : null),
    );
    indexes.set(style, pending);
  }
  return pending;
}

export async function installedStyles(): Promise<StyleIndex[]> {
  const all = await Promise.all(STYLES.map(loadStyle));
  return all.filter((s): s is StyleIndex => s !== null);
}

export const installHint = (style: Style) =>
  `${proPackage(style)} needs a Hugeicons Pro licence key: add it to ~/.npmrc (see README), then run pnpm install in the server folder.`;

// Read as JSON rather than import()ed, so no package code runs and the cache below stays bounded.
export function parseIconModule(source: string): IconData {
  const start = source.indexOf("[");
  const end = source.lastIndexOf("];");
  if (start === -1 || end === -1) throw new Error("no icon array found");
  const json = source.slice(start, end + 1).replace(/([{,]\s*)([A-Za-z_]\w*):/g, '$1"$2":');
  const data: unknown = JSON.parse(json);
  if (!Array.isArray(data)) throw new Error("icon data is not an array");
  return data as IconData;
}

const MAX_CACHED_ICONS = 500;
const iconCache = new Map<string, IconData>();

export async function loadIcon(index: StyleIndex, base: string): Promise<IconData | null> {
  if (!index.files.has(base)) return null;
  const key = `${index.packageName}:${base}`;
  const hit = iconCache.get(key);
  if (hit) {
    iconCache.delete(key);
    iconCache.set(key, hit);
    return hit;
  }
  const source = await readFile(join(index.dir, `${base}Icon.js`), "utf8");
  let data: IconData;
  try {
    data = parseIconModule(source);
  } catch (error) {
    throw new Error(`could not read ${base} from ${index.packageName}`, { cause: error });
  }
  iconCache.set(key, data);
  if (iconCache.size > MAX_CACHED_ICONS) iconCache.delete(iconCache.keys().next().value!);
  return data;
}
