// Runs against whatever Hugeicons packages are installed; skips styles that are not.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { installedStyles, loadIcon, parseIconModule } from "../dist/styles.js";
import { renderSvg } from "../dist/svg.js";
import { buildCatalog, loadMetadata, normalize, resolveName, spellNumbers } from "../dist/catalog.js";

const styles = await installedStyles();

test("at least one style is installed", () => assert.ok(styles.length > 0));

for (const s of styles) {
  test(`${s.style}: every icon file parses and renders`, async () => {
    let count = 0;
    for (const base of s.files.keys()) {
      const data = parseIconModule(await readFile(join(s.dir, `${base}Icon.js`), "utf8"));
      assert.ok(data.length > 0, base);
      for (const [tag] of data) assert.ok(["path", "circle", "rect", "ellipse"].includes(tag), `${base}: ${tag}`);
      assert.match(renderSvg(data), /^<svg [^>]+>(<(path|circle|rect|ellipse) [^<>]*\/>)+<\/svg>$/, base);
      count++;
    }
    assert.equal(count, s.files.size);
  });

  test(`${s.style}: parsed data equals the package's own export (every 25th icon)`, async () => {
    const bases = [...s.files.keys()].filter((_, i) => i % 25 === 0);
    for (const base of bases) {
      const mod = await import(pathToFileURL(join(s.dir, `${base}Icon.js`)).href);
      assert.deepEqual(await loadIcon(s, base), mod.default, base);
    }
  });
}

test("site names map onto package icons", async () => {
  const meta = await loadMetadata();
  if (meta.length === 0) return;
  const cat = buildCatalog(styles[0], meta);
  const unmatched = meta.filter((m) => !cat.byKey.has(normalize(m.name)) && !cat.byKey.has(spellNumbers(m.name)));
  console.log(`site icons: ${meta.length}, without a package icon: ${unmatched.length}`, unmatched.map((m) => m.name));
  assert.ok(unmatched.length <= 20, `${unmatched.length} site icons unmatched`);
  const untagged = cat.entries.filter((e) => e.tags.length === 0 && e.category === "");
  console.log(`package icons without site metadata: ${untagged.length}`, untagged.map((e) => e.id));
  assert.ok(untagged.length <= 20);
  const fileByKey = new Map([...styles[0].files.keys()].map((f) => [normalize(f), f]));
  const wrong = [];
  for (const m of meta) {
    const expected = fileByKey.get(spellNumbers(m.name)) ?? fileByKey.get(normalize(m.name));
    const got = resolveName(cat, m.name);
    if (!got || (expected && got.file !== expected)) wrong.push(`${m.name} → ${got?.file} (expected ${expected})`);
  }
  assert.deepEqual(wrong, []);
  const unclean = cat.entries.filter((e) => !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id)).map((e) => e.id);
  assert.deepEqual(unclean, []);
  assert.equal(resolveName(cat, "arrow-down-0-1").file, "ArrowDownZeroOne");
  assert.equal(resolveName(cat, "arrow-up-0-1").file, "ArrowUpZeroOne");
  assert.equal(resolveName(cat, "arrow-down-1-0").file, "ArrowDownOneZero");
  assert.equal(resolveName(cat, "arrow-down-01").file, "ArrowDown01");
  assert.equal(resolveName(cat, "1st-bracket").file, "FirstBracket");
});
