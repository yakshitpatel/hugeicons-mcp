#!/usr/bin/env node
import { constants, readFileSync } from "node:fs";
import { lstat, mkdir, open, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod";
import { buildCatalog, loadMetadata, resolveName, search, type Catalog, type CatalogEntry } from "./catalog.js";
import { installedStyles, installHint, loadIcon, loadStyle, STYLES, type Style } from "./styles.js";
import { COLOR_PATTERN, renderSvg, type RenderOptions } from "./svg.js";

const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };

let catalogPromise: Promise<Catalog> | undefined;

function catalog(): Promise<Catalog> {
  catalogPromise ??= (async () => {
    const styles = await installedStyles();
    const reference = styles[0];
    if (!reference) throw new Error("No Hugeicons package is installed. Run pnpm install in the server folder.");
    return buildCatalog(reference, await loadMetadata());
  })();
  catalogPromise.catch(() => (catalogPromise = undefined));
  return catalogPromise;
}

async function findEntry(name: string): Promise<CatalogEntry> {
  const cat = await catalog();
  const entry = resolveName(cat, name);
  if (entry) return entry;
  const suggestions = search(cat, name, 5).entries.map((e) => e.id);
  throw new Error(
    `No icon named "${name}".` + (suggestions.length ? ` Closest: ${suggestions.join(", ")}.` : " Try search_icons."),
  );
}

async function renderEntry(entry: CatalogEntry, style: Style, options: RenderOptions): Promise<string> {
  const index = await loadStyle(style);
  if (!index) throw new Error(`The ${style} style is not installed. ${installHint(style)}`);
  const data = await loadIcon(index, entry.file);
  if (!data) throw new Error(`${entry.id} is not available in ${style}.`);
  return renderSvg(data, options);
}

function expandPath(target: string): string {
  const expanded = target === "~" ? homedir() : target.startsWith("~/") ? join(homedir(), target.slice(2)) : target;
  if (!isAbsolute(expanded)) throw new Error("save_to must be an absolute path or start with ~/");
  return resolve(expanded);
}

// O_NOFOLLOW refuses a symlink and O_NONBLOCK stops a named pipe from hanging the call; fstat then rules out hard links.
async function openSvgFile(path: string, overwrite: boolean): Promise<FileHandle> {
  const flags =
    constants.O_WRONLY | constants.O_CREAT | constants.O_NOFOLLOW | constants.O_NONBLOCK | (overwrite ? 0 : constants.O_EXCL);
  let handle: FileHandle;
  try {
    handle = await open(path, flags, 0o644);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    const info = await lstat(path).catch(() => null);
    if (info?.isSymbolicLink() || code === "ELOOP") throw new Error(`${path} is a symbolic link. Choose another path.`, { cause: error });
    if (info?.isDirectory() || code === "EISDIR") throw new Error(`${path} is a folder, not a file.`, { cause: error });
    if (code === "EEXIST") throw new Error(`${path} already exists. Pass overwrite: true to replace it.`, { cause: error });
    if (code === "ENXIO") throw new Error(`${path} is not a regular file.`, { cause: error });
    throw error;
  }
  const info = await handle.stat();
  if (!info.isFile() || info.nlink !== 1) {
    await handle.close();
    throw new Error(`${path} is not a regular file with a single link. Choose another path.`);
  }
  await handle.truncate(0);
  return handle;
}

async function saveSvg(target: string, svg: string, overwrite: boolean): Promise<string> {
  const path = expandPath(target);
  if (!path.toLowerCase().endsWith(".svg")) throw new Error("save_to must be a file path ending in .svg");
  await mkdir(dirname(path), { recursive: true });
  await using file = await openSvgFile(path, overwrite);
  await file.writeFile(svg);
  return path;
}

const color = z
  .string()
  .regex(COLOR_PATTERN, "use a hex value (#rgb, #rrggbb), rgb()/hsl()/oklch(), currentColor or transparent");
const size = z.number().int().min(8).max(1024).default(24).describe("Width and height in px. Default 24.");
const iconName = z.string().min(1).max(120).describe("Icon name from search_icons, e.g. delivery-truck-01.");

const server = new McpServer(
  { name: "hugeicons", version },
  {
    instructions:
      "Returns Hugeicons as SVG markup. Find a name with search_icons, then call get_icon. " +
      "Names match hugeicons.com. Use compare_styles to see one icon in every installed style. " +
      "To put an icon in Figma, call get_icon with save_to, then upload that file.",
  },
);

server.registerTool(
  "search_icons",
  {
    title: "Search Hugeicons",
    description: "Find Hugeicons by name, tag or category. Returns names to pass to get_icon.",
    inputSchema: z.strictObject({
      query: z.string().min(1).max(200).describe('What the icon should show, e.g. "delivery truck" or "settings".'),
      limit: z.number().int().min(1).max(50).default(15),
    }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ query, limit }) => {
    const cat = await catalog();
    const { entries: results, corrections } = search(cat, query, limit);
    const corrected = corrections.length ? `Corrected spelling: ${corrections.join(", ")}.\n` : "";
    if (results.length === 0) return { content: [{ type: "text", text: `${corrected}No icons match "${query}".` }] };
    const lines = results.map((e) => {
      const tags = e.tags.slice(0, 8).join(", ");
      return [e.id, e.category, tags && `tags: ${tags}`].filter(Boolean).join(" | ");
    });
    const note = cat.hasMetadata ? "" : "\n(Tags unavailable: hugeicons.com could not be reached, so only names were searched.)";
    return { content: [{ type: "text", text: corrected + lines.join("\n") + note }] };
  },
);

server.registerTool(
  "get_icon",
  {
    title: "Get a Hugeicon as SVG",
    description:
      "Returns one icon as SVG markup in the chosen style. Optionally writes it to an .svg file " +
      "(use an absolute path), for example to upload into Figma.",
    inputSchema: z.strictObject({
      name: iconName,
      style: z.enum(STYLES).default("stroke-rounded"),
      size,
      color: color.optional().describe("Main colour. Default currentColor, which inherits the surrounding text colour."),
      secondary_color: color
        .optional()
        .describe("Colour of the lighter layer in duotone, twotone and bulk styles. Defaults to color."),
      stroke_width: z.number().min(0.25).max(4).optional().describe("Stroke width for stroke-based parts. Icons ship at 1.5."),
      save_to: z.string().min(1).max(1024).optional().describe("Absolute path (or ~/…) of an .svg file to write."),
      overwrite: z.boolean().default(false).describe("Replace save_to if it already exists."),
    }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
  },
  async (args) => {
    const entry = await findEntry(args.name);
    const svg = await renderEntry(entry, args.style, {
      size: args.size,
      color: args.color,
      secondaryColor: args.secondary_color,
      strokeWidth: args.stroke_width,
    });
    const header = `${entry.id} · ${args.style}`;
    if (!args.save_to) return { content: [{ type: "text", text: header }, { type: "text", text: svg }] };
    const path = await saveSvg(args.save_to, svg, args.overwrite);
    return { content: [{ type: "text", text: `${header} · saved to ${path}` }, { type: "text", text: svg }] };
  },
);

server.registerTool(
  "compare_styles",
  {
    title: "Compare one Hugeicon across styles",
    description: "Returns the same icon as SVG in every installed style, to choose between them.",
    inputSchema: z.strictObject({ name: iconName, size, color: color.optional() }),
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  async ({ name, size, color }) => {
    const entry = await findEntry(name);
    const styles = await installedStyles();
    const blocks = await Promise.all(
      styles.map(async (s) => {
        const data = await loadIcon(s, entry.file);
        return data ? `${s.style}\n${renderSvg(data, { size, color })}` : `${s.style}\n(not available in this style)`;
      }),
    );
    return { content: [{ type: "text", text: `${entry.id}\n\n${blocks.join("\n\n")}` }] };
  },
);

server.registerTool(
  "list_styles",
  {
    title: "List installed Hugeicons styles",
    description: "Shows which of the 10 styles are installed and how to add the missing ones.",
    inputSchema: z.strictObject({}),
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  async () => {
    const installed = await installedStyles();
    const names = new Set(installed.map((s) => s.style));
    const lines = installed.map((s) => `${s.style}: ${s.files.size} icons${s.isFree ? " (free set)" : ""}`);
    const missing = STYLES.filter((s) => !names.has(s)).map((s) => `${s}: not installed. ${installHint(s)}`);
    return { content: [{ type: "text", text: [...lines, ...missing].join("\n") }] };
  },
);

await server.connect(new StdioServerTransport());
