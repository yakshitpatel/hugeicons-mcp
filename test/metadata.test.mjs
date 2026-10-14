// Stubs only the network boundary (globalThis.fetch); the cache really goes to disk in a temp folder.
import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { cacheFile, loadMetadata } from "../dist/catalog.js";

const realFetch = globalThis.fetch;
const root = await mkdtemp(join(tmpdir(), "hugeicons-meta-"));
let calls = 0;
const respond = (fn) => { globalThis.fetch = async (...args) => { calls++; return fn(...args); }; };
const body = (names) => JSON.stringify({ icons: names.map((name) => ({ name, tags: "a, b", category: "c" })) });
const seedCache = async (names, ageDays) => {
  const file = cacheFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, body(names));
  const t = new Date(Date.now() - ageDays * 86_400_000);
  await utimes(file, t, t);
};

beforeEach(async (t) => { calls = 0; process.env.XDG_CACHE_HOME = await mkdtemp(join(root, "c-")); });
after(async () => { globalThis.fetch = realFetch; await rm(root, { recursive: true, force: true }); });

test("a fresh cache is used without touching the network", async () => {
  await seedCache(["cached"], 1);
  respond(() => { throw new Error("should not fetch"); });
  assert.deepEqual((await loadMetadata()).map((m) => m.name), ["cached"]);
  assert.equal(calls, 0);
});

test("a stale cache is refreshed and rewritten on success", async () => {
  await seedCache(["old"], 8);
  respond(() => new Response(body(["new"]), { status: 200 }));
  assert.deepEqual((await loadMetadata()).map((m) => m.name), ["new"]);
  assert.match(await readFile(cacheFile(), "utf8"), /"new"/);
});

test("an error status falls back to the stale cache instead of parsing the error body", async () => {
  await seedCache(["old"], 8);
  respond(() => new Response(JSON.stringify({ icons: [{ name: "from-error-body" }] }), { status: 500 }));
  assert.deepEqual((await loadMetadata()).map((m) => m.name), ["old"]);
  assert.match(await readFile(cacheFile(), "utf8"), /"old"/);
});

test("an empty icon list is treated as a failure, not cached", async () => {
  await seedCache(["old"], 8);
  respond(() => new Response(JSON.stringify({ icons: [] }), { status: 200 }));
  assert.deepEqual((await loadMetadata()).map((m) => m.name), ["old"]);
});

test("a network error with no cache returns no metadata rather than throwing", async () => {
  respond(() => { throw new TypeError("fetch failed"); });
  assert.deepEqual(await loadMetadata(), []);
});

test("the request carries an abort signal so a hung site cannot block forever", async () => {
  let signal;
  respond((_url, init) => { signal = init?.signal; return new Response(body(["x"]), { status: 200 }); });
  await loadMetadata();
  assert.ok(signal instanceof AbortSignal);
});

test("a corrupt cache file is ignored", async () => {
  const file = cacheFile();
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, "{not json");
  respond(() => new Response(body(["fresh"]), { status: 200 }));
  assert.deepEqual((await loadMetadata()).map((m) => m.name), ["fresh"]);
});
