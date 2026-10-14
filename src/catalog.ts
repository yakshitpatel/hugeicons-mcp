import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { StyleIndex } from "./styles.js";

const API_URL = "https://hugeicons.com/api/icons";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

export type IconMeta = { name: string; tags: string[]; category: string; featured: boolean };

export type CatalogEntry = {
  id: string;
  file: string;
  names: string[];
  aliases: string[];
  tags: string[];
  category: string;
  featured: boolean;
};

type Terms = { name: string[]; other: string[]; tagWords: Set<string> };

export type Catalog = {
  entries: CatalogEntry[];
  terms: Terms[];
  byName: Map<string, CatalogEntry>;
  byKey: Map<string, CatalogEntry>;
  vocabulary: Map<string, number>;
  hasMetadata: boolean;
};

export const cacheFile = () =>
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "hugeicons-mcp", "icons.json");

// Third-party response: read only the fields we use and skip anything malformed.
export function parseMetadata(body: unknown): IconMeta[] {
  const icons = (body as { icons?: unknown })?.icons;
  if (!Array.isArray(icons)) return [];
  const out: IconMeta[] = [];
  for (const raw of icons) {
    const icon = raw as Record<string, unknown>;
    if (typeof icon.name !== "string") continue;
    out.push({
      name: icon.name,
      tags: typeof icon.tags === "string" ? icon.tags.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean) : [],
      category: typeof icon.category === "string" ? icon.category : "",
      featured: icon.featured === true,
    });
  }
  return out;
}

async function readCache(file: string): Promise<{ body: unknown; fresh: boolean } | null> {
  try {
    const [text, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return { body: JSON.parse(text), fresh: Date.now() - info.mtimeMs < CACHE_TTL_MS };
  } catch {
    return null;
  }
}

// Search still works without tags (names and aliases only) when the site is unreachable.
export async function loadMetadata(): Promise<IconMeta[]> {
  const file = cacheFile();
  const cached = await readCache(file);
  if (cached?.fresh) return parseMetadata(cached.body);
  try {
    const res = await fetch(API_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`hugeicons.com returned ${res.status}`);
    const body: unknown = await res.json();
    const parsed = parseMetadata(body);
    if (parsed.length === 0) throw new Error("hugeicons.com returned no icons");
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(body));
    return parsed;
  } catch (error) {
    console.error("[hugeicons-mcp] icon metadata fetch failed, using cache if present:", (error as Error).message);
    return cached ? parseMetadata(cached.body) : [];
  }
}

export const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const DIGITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
const SPELLED: Record<string, string> = { "1st": "first", "2nd": "second", "3rd": "third", "24": "twentyfour" };

// The site writes "3d-move" and "1st-bracket"; the packages export ThreeDMove and FirstBracket.
export function spellNumbers(name: string): string {
  return name
    .split("-")
    .map((t) => SPELLED[t] ?? (/^\d[a-z]?$/.test(t) ? DIGITS[Number(t[0])] + t.slice(1) : t))
    .join("")
    .replace(/[^a-z0-9]/g, "");
}

const kebab = (pascal: string) =>
  pascal
    .replace(/([a-z])([A-Z0-9])/g, "$1-$2")
    .replace(/([0-9])([A-Za-z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();

const CLEAN_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
// The site has a few names with stray spaces, e.g. "package-add-01 " and "image-flip -horizontal".
const tidy = (name: string) => name.trim().toLowerCase().replace(/\s*-\s*/g, "-").replace(/\s+/g, "-");
const tokenize = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
const singular = (t: string) => (t.length > 3 && t.endsWith("s") ? t.slice(0, -1) : t);

export function buildCatalog(reference: StyleIndex, metadata: IconMeta[]): Catalog {
  // Legacy aliases can collide with other icons' names (ArrowDown10 is not ArrowDownOneZero), so file names win.
  const fileKeys = new Map<string, string>();
  const aliasKeys = new Map<string, string>();
  for (const [file, aliases] of reference.files) {
    fileKeys.set(normalize(file), file);
    for (const alias of aliases) if (!aliasKeys.has(normalize(alias))) aliasKeys.set(normalize(alias), file);
  }
  // Spelled first: "arrow-down-0-1" is ArrowDownZeroOne, while "arrow-down-01" stays ArrowDown01.
  const metasByFile = new Map<string, IconMeta[]>();
  for (const meta of metadata) {
    const plain = normalize(meta.name);
    const spelled = spellNumbers(meta.name);
    const file = fileKeys.get(spelled) ?? fileKeys.get(plain) ?? aliasKeys.get(spelled) ?? aliasKeys.get(plain);
    if (file) metasByFile.set(file, [...(metasByFile.get(file) ?? []), meta]);
  }

  const entries: CatalogEntry[] = [];
  for (const [file, aliases] of reference.files) {
    const metas = metasByFile.get(file) ?? [];
    const names = metas.map((m) => m.name);
    const clean = [...new Set(names.map(tidy))].filter((n) => CLEAN_NAME.test(n));
    entries.push({
      id: clean.find((n) => n === kebab(file)) ?? clean[0] ?? names[0] ?? kebab(file),
      file,
      names,
      aliases: aliases.map(kebab),
      tags: [...new Set(metas.flatMap((m) => m.tags))],
      category: metas.find((m) => m.category)?.category ?? "",
      featured: metas.some((m) => m.featured),
    });
  }

  const byName = new Map<string, CatalogEntry>();
  for (const e of entries) if (!byName.has(e.id)) byName.set(e.id, e);
  for (const e of entries) for (const n of e.names) for (const k of [n.toLowerCase(), tidy(n)]) if (!byName.has(k)) byName.set(k, e);
  const byKey = new Map<string, CatalogEntry>();
  const add = (key: string, e: CatalogEntry) => byKey.has(key) || byKey.set(key, e);
  for (const e of entries) add(normalize(e.file), e);
  for (const e of entries) [e.id, ...e.names].forEach((n) => add(normalize(n), e));
  for (const e of entries) e.aliases.forEach((a) => add(normalize(a), e));

  const terms = entries.map((e) => ({
    name: tokenize(e.id),
    other: [...e.names, ...e.aliases].flatMap(tokenize),
    tagWords: new Set([...e.tags.flatMap(tokenize), ...tokenize(e.category)]),
  }));
  const vocabulary = new Map<string, number>();
  for (const t of terms) for (const w of new Set([...t.name, ...t.other, ...t.tagWords])) vocabulary.set(w, (vocabulary.get(w) ?? 0) + 1);
  return { entries, terms, byName, byKey, vocabulary, hasMetadata: metasByFile.size > 0 };
}

export function resolveName(catalog: Catalog, input: string): CatalogEntry | null {
  const exact = catalog.byName.get(input.toLowerCase()) ?? catalog.byName.get(tidy(input));
  if (exact) return exact;
  const key = normalize(input);
  return (
    catalog.byKey.get(key) ??
    (key.endsWith("icon") ? catalog.byKey.get(key.slice(0, -4)) : undefined) ??
    catalog.byKey.get(spellNumbers(input.trim().toLowerCase())) ??
    null
  );
}

function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + cost);
      best = Math.min(best, row[j]!);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

// A token no icon uses is treated as a typo: same first letter, 1 edit (2 from 8 letters), most-used word wins a tie.
function correct(catalog: Catalog, token: string): string | null {
  if (/^\d+$/.test(token) || token.length < 4) return null;
  const known = catalog.vocabulary;
  if (known.has(token) || known.has(singular(token))) return null;
  for (const word of known.keys()) if (word.startsWith(token)) return null;
  const max = token.length < 8 ? 1 : 2;
  let best: string | null = null;
  let bestDistance = max + 1;
  let bestUses = 0;
  for (const [word, uses] of known) {
    if (word[0] !== token[0]) continue;
    const d = editDistance(token, word, max);
    if (d < bestDistance || (d === bestDistance && uses > bestUses)) {
      best = word;
      bestDistance = d;
      bestUses = uses;
    }
  }
  return bestDistance <= max ? best : null;
}

const MAX_QUERY_TOKENS = 8;
const FILLER = new Set(["a", "an", "the", "of", "for", "with", "and", "or", "to", "in", "on", "at", "by", "icon", "icons", "symbol"]);

function scoreToken(entry: CatalogEntry, terms: Terms, token: string): number {
  if (terms.name.includes(token)) return 10;
  if (terms.name.some((n) => n.startsWith(token))) return 6;
  if (terms.other.includes(token)) return 5;
  if (terms.tagWords.has(token)) return 4;
  if (entry.category.includes(token)) return 2;
  if (entry.tags.some((t) => t.includes(token))) return 2;
  return 0;
}

export type SearchResult = { entries: CatalogEntry[]; corrections: string[] };

export function search(catalog: Catalog, query: string, limit: number): SearchResult {
  const corrections: string[] = [];
  const words = [...new Set(tokenize(query))];
  const meaningful = words.filter((w) => !FILLER.has(w));
  const tokens = (meaningful.length ? meaningful : words).slice(0, MAX_QUERY_TOKENS).map((t) => {
    const fixed = correct(catalog, t);
    if (!fixed) return t;
    corrections.push(`${t} → ${fixed}`);
    return fixed;
  });
  if (tokens.length === 0) return { entries: [], corrections };
  const exact = normalize(query);
  const scored: { entry: CatalogEntry; matched: number; score: number }[] = [];
  catalog.entries.forEach((entry, i) => {
    const terms = catalog.terms[i]!;
    let matched = 0;
    let score = normalize(entry.id) === exact ? 100 : 0;
    for (const token of tokens) {
      const s = Math.max(scoreToken(entry, terms, token), scoreToken(entry, terms, singular(token)));
      if (s > 0) matched++;
      score += s;
    }
    if (matched === 0) return;
    if (entry.featured) score += 1;
    scored.push({ entry, matched, score });
  });
  const entries = scored
    .toSorted((a, b) => b.matched - a.matched || b.score - a.score || a.entry.id.length - b.entry.id.length)
    .slice(0, limit)
    .map((s) => s.entry);
  return { entries, corrections };
}
