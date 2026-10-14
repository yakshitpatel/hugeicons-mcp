import { test, after } from "node:test";
import assert from "node:assert/strict";
import { link, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../dist/index.js", import.meta.url).pathname], stderr: "pipe" });
const client = new Client({ name: "test", version: "0" });
await client.connect(transport);
const dir = await mkdtemp(join(tmpdir(), "hugeicons-mcp-"));
after(async () => { await client.close(); await rm(dir, { recursive: true, force: true }); });

const call = (name, args) => client.callTool({ name, arguments: args });
const text = (res) => res.content.map((c) => c.text).join("\n");

test("lists the four tools with strict schemas", async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).toSorted(), ["compare_styles", "get_icon", "list_styles", "search_icons"]);
  for (const t of tools) assert.equal(t.inputSchema.additionalProperties, false, t.name);
});

test("search_icons finds icons by meaning", async () => {
  const res = await call("search_icons", { query: "delivery truck", limit: 5 });
  assert.ok(!res.isError);
  const top = text(res).split("\n")[0].split(" | ")[0];
  assert.ok(top.includes("delivery") && top.includes("truck"), top);
});

test("get_icon returns only SVG markup, in the requested style and colour", async () => {
  const res = await call("get_icon", { name: "delivery-truck-01", style: "duotone-rounded", size: 32, color: "#0f172a", secondary_color: "#f97316" });
  assert.ok(!res.isError, text(res));
  assert.equal(res.content[0].text, "delivery-truck-01 · duotone-rounded");
  const svg = res.content[1].text;
  assert.match(svg, /^<svg[^>]+width="32"[^>]*>.*<\/svg>$/s);
  assert.match(svg, /opacity="0.4"/);
  assert.match(svg, /#f97316/);
  assert.match(svg, /#0f172a/);
  assert.doesNotMatch(svg, /import|currentColor/);
});

test("get_icon accepts code-style names and aliases", async () => {
  assert.equal((await call("get_icon", { name: "Settings01Icon" })).content[0].text, "settings-01 · stroke-rounded");
});

test("get_icon saves to a file and refuses to overwrite by default", async () => {
  const path = join(dir, "nested", "truck.svg");
  const first = await call("get_icon", { name: "delivery-truck-01", style: "solid-rounded", save_to: path });
  assert.ok(!first.isError, text(first));
  assert.match(first.content[0].text, /saved to/);
  assert.equal(await readFile(path, "utf8"), first.content[1].text);
  const second = await call("get_icon", { name: "delivery-truck-01", save_to: path });
  assert.ok(second.isError);
  assert.match(text(second), /already exists/);
  const third = await call("get_icon", { name: "delivery-truck-01", style: "bulk-rounded", save_to: path, overwrite: true });
  assert.ok(!third.isError, text(third));
  assert.equal(await readFile(path, "utf8"), third.content[1].text);
});

test("get_icon rejects non-svg paths, bad colours, unknown names and unknown keys", async () => {
  assert.match(text(await call("get_icon", { name: "home-01", save_to: join(dir, "x.txt") })), /must be a file path ending in \.svg/);
  assert.ok((await call("get_icon", { name: "home-01", color: 'red" onload="x' })).isError);
  const unknown = await call("get_icon", { name: "calender" });
  assert.ok(unknown.isError);
  assert.match(text(unknown), /No icon named "calender"\. Closest: calendar/);
  assert.ok((await call("get_icon", { name: "home-01", colour: "red" })).isError);
  assert.ok((await call("get_icon", { name: "home-01", style: "glass" })).isError);
});

test("compare_styles returns every installed style", async () => {
  const res = await call("compare_styles", { name: "home-01" });
  const body = text(res);
  for (const s of ["stroke-rounded", "solid-sharp", "duotone-standard", "twotone-rounded", "bulk-rounded"]) assert.match(body, new RegExp(`^${s}\\n<svg`, "m"));
  assert.equal(body.match(/<svg/g).length, 10);
});

test("list_styles reports all ten styles", async () => {
  const lines = text(await call("list_styles", {})).split("\n");
  assert.equal(lines.length, 10);
  assert.ok(lines.every((l) => /: \d+ icons/.test(l)), lines.join("\n"));
});

test("get_icon expands ~ and refuses relative paths", async () => {
  const name = `hugeicons-mcp-test-${process.pid}.svg`;
  const res = await call("get_icon", { name: "home-01", save_to: `~/${name}` });
  try {
    assert.ok(!res.isError, text(res));
    assert.match(res.content[0].text, new RegExp(`saved to ${join(homedir(), name)}$`));
  } finally {
    await rm(join(homedir(), name), { force: true });
  }
  assert.match(text(await call("get_icon", { name: "home-01", save_to: "rel/home.svg" })), /must be an absolute path/);
});

test("get_icon never writes through a symlink, even with overwrite", async () => {
  const victim = join(dir, "victim.txt");
  await writeFile(victim, "keep me");
  await symlink(victim, join(dir, "link.svg"));
  await symlink(join(dir, "new-target.txt"), join(dir, "dangling.svg"));
  for (const overwrite of [false, true]) {
    for (const f of ["link.svg", "dangling.svg"]) {
      const res = await call("get_icon", { name: "home-01", save_to: join(dir, f), overwrite });
      assert.ok(res.isError, `${f} overwrite=${overwrite}`);
      assert.match(text(res), /symbolic link/);
    }
  }
  assert.equal(await readFile(victim, "utf8"), "keep me");
  await assert.rejects(readFile(join(dir, "new-target.txt")));
});

test("get_icon explains when save_to is a folder", async () => {
  await mkdir(join(dir, "folder.svg"));
  for (const overwrite of [false, true]) {
    assert.match(text(await call("get_icon", { name: "home-01", save_to: join(dir, "folder.svg"), overwrite })), /is a folder/);
  }
});

test("get_icon refuses hard links and named pipes instead of writing through or hanging", async () => {
  const victim = join(dir, "victim2.txt");
  await writeFile(victim, "keep me too");
  await link(victim, join(dir, "hard.svg"));
  const hard = await call("get_icon", { name: "home-01", save_to: join(dir, "hard.svg"), overwrite: true });
  assert.ok(hard.isError);
  assert.match(text(hard), /single link/);
  assert.equal(await readFile(victim, "utf8"), "keep me too");
  execFileSync("mkfifo", [join(dir, "pipe.svg")]);
  const pipe = await client.callTool({ name: "get_icon", arguments: { name: "home-01", save_to: join(dir, "pipe.svg"), overwrite: true } }, undefined, { timeout: 3000 });
  assert.ok(pipe.isError);
  assert.match(text(pipe), /not a regular file/);
});

test("spelling correction fixes typos but leaves unknown real words alone", async () => {
  const fixed = text(await call("search_icons", { query: "seting", limit: 3 }));
  assert.match(fixed, /^Corrected spelling: seting → setting/);
  for (const word of ["purple", "unicorn", "toaster", "qwerty"]) {
    assert.doesNotMatch(text(await call("search_icons", { query: word, limit: 3 })), /Corrected spelling/, word);
  }
});

test("filler words do not push meaningful words past the query cap", async () => {
  const res = text(await call("search_icons", { query: "small blue icon of a person holding a shopping cart", limit: 10 }));
  assert.match(res, /shopping-cart/);
});
