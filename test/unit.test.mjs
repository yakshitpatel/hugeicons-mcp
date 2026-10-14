import { test } from "node:test";
import assert from "node:assert/strict";
import { renderSvg, COLOR_PATTERN } from "../dist/svg.js";
import { parseIndex, parseIconModule } from "../dist/styles.js";
import { buildCatalog, parseMetadata, resolveName, search, spellNumbers } from "../dist/catalog.js";

const duotone = [
  ["path", { d: "M2 8H8", stroke: "currentColor", strokeWidth: "1.5", strokeLinecap: "round", key: "1" }],
  ["path", { opacity: "0.4", d: "M1 1H2", fill: "currentColor", key: "0" }],
];

test("renderSvg paints the secondary layer first and drops React keys", () => {
  const svg = renderSvg(duotone);
  assert.match(svg, /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">/);
  assert.ok(svg.indexOf('opacity="0.4"') < svg.indexOf('d="M2 8H8"'));
  assert.doesNotMatch(svg, /key=/);
  assert.match(svg, /stroke-linecap="round"/);
});

test("renderSvg applies colour, secondary colour and stroke width", () => {
  const svg = renderSvg(duotone, { size: 48, color: "#111", secondaryColor: "#f60", strokeWidth: 2 });
  assert.match(svg, /width="48" height="48"/);
  assert.match(svg, /stroke="#111"/);
  assert.match(svg, /fill="#f60"/);
  assert.match(svg, /stroke-width="2"/);
  assert.doesNotMatch(svg, /currentColor/);
});

test("renderSvg keeps currentColor when no colour is given", () => {
  assert.match(renderSvg(duotone), /stroke="currentColor"/);
});

test("COLOR_PATTERN accepts colours and rejects attribute injection", () => {
  for (const ok of ["#fff", "#11223344", "#FF0000", "transparent", "Transparent", "currentColor", "currentcolor", "rgba(0,0,0,.5)", "rgb(0 0 0 / 50%)", "oklch(70% 0.1 200)", "rgb(0, 0, 0)", "hsl(200 50% 40% / 0.5)", "oklch(0.7 0.1 200)"]) {
    assert.ok(COLOR_PATTERN.test(ok), ok);
  }
  for (const bad of ['red" onload="alert(1)', "url(#x)", "#ff<script>", "", "rgb(0,0,0)\"/>", "notacolor", "#12345", "#1234567", "rgb(zzz)", "rgb(red)", "oklch(evil)", "hsl(1)", "rgb(--)", "rgb(0 0)"]) {
    assert.ok(!COLOR_PATTERN.test(bad), bad);
  }
});

test("parseIndex keeps aliases and drops the style-suffixed duplicates", () => {
  const src = "export { default as Braces, default as FirstBracketDuotoneRounded, default as FirstBracketIcon } from './FirstBracketIcon.js';";
  assert.deepEqual([...parseIndex(src, "DuotoneRounded")], [["FirstBracket", ["Braces"]]]);
});

test("parseIconModule reads the generated literal", () => {
  const src = 'const XIcon = [\n  ["path", { d: "M1 2,3 4", strokeWidth: "1.5", key: "0" }],\n  ["circle", { cx: "1", cy: "2", r: "3", key: "1" }]\n];\n\nexport { XIcon as default };\n';
  assert.deepEqual(parseIconModule(src), [["path", { d: "M1 2,3 4", strokeWidth: "1.5", key: "0" }], ["circle", { cx: "1", cy: "2", r: "3", key: "1" }]]);
  assert.throws(() => parseIconModule("export default 1;"));
});

test("spellNumbers matches the package naming for digit names", () => {
  assert.equal(spellNumbers("1st-bracket"), "firstbracket");
  assert.equal(spellNumbers("3-d-view"), "threedview");
  assert.equal(spellNumbers("24-hours-clock"), "twentyfourhoursclock");
  assert.equal(spellNumbers("modern-tv-4-k"), "moderntvfourk");
  assert.equal(spellNumbers("delivery-truck-01"), "deliverytruck01");
});

test("parseMetadata tolerates malformed third-party rows", () => {
  assert.deepEqual(parseMetadata(null), []);
  assert.deepEqual(parseMetadata({ icons: [{ name: 1 }, { name: "a", tags: "X, y", extra: true }] }), [
    { name: "a", tags: ["x", "y"], category: "", featured: false },
  ]);
});

const reference = {
  style: "stroke-rounded", packageName: "fake", isFree: false, dir: "/nowhere",
  files: new Map([["FirstBracket", ["Braces"]], ["DeliveryTruck01", ["DeliveryTruck"]], ["Settings01", []], ["ThreeDMove", []]]),
};
const meta = parseMetadata({ icons: [
  { name: "1st-bracket", tags: "parentheses", category: "mathematics" },
  { name: "delivery-truck-01", tags: "shipping, logistics", category: "logistics" },
  { name: "settings-01", tags: "gear, preferences", category: "settings" },
  { name: "3d-move", tags: "", category: "3d" },
] });

test("buildCatalog uses site names and resolves aliases and code names", () => {
  const cat = buildCatalog(reference, meta);
  assert.equal(resolveName(cat, "1st-bracket").file, "FirstBracket");
  assert.equal(resolveName(cat, "braces").id, "1st-bracket");
  assert.equal(resolveName(cat, "DeliveryTruck01Icon").id, "delivery-truck-01");
  assert.equal(resolveName(cat, "delivery truck").id, "delivery-truck-01");
  assert.equal(resolveName(cat, "3d-move").file, "ThreeDMove");
  assert.equal(resolveName(cat, "nope"), null);
});

test("a legacy alias never takes a site name that belongs to another icon", () => {
  const files = new Map([["ArrangeByNumbersOneNine", ["ArrowDown10"]], ["ArrowDownOneZero", []]]);
  const cat = buildCatalog({ ...reference, files }, parseMetadata({ icons: [{ name: "arrow-down-1-0" }, { name: "arrange-by-numbers-1-9" }] }));
  assert.equal(resolveName(cat, "arrow-down-1-0").file, "ArrowDownOneZero");
  assert.equal(resolveName(cat, "arrange-by-numbers-1-9").file, "ArrangeByNumbersOneNine");
});

test("buildCatalog falls back to package names without metadata", () => {
  const cat = buildCatalog(reference, []);
  assert.equal(cat.hasMetadata, false);
  assert.equal(resolveName(cat, "delivery-truck-01").file, "DeliveryTruck01");
  assert.equal(resolveName(cat, "three-d-move").file, "ThreeDMove");
});

test("search ranks name matches above tag matches and handles plurals", () => {
  const cat = buildCatalog(reference, meta);
  assert.equal(search(cat, "trucks", 5).entries[0].id, "delivery-truck-01");
  assert.equal(search(cat, "gear", 5).entries[0].id, "settings-01");
  assert.deepEqual(search(cat, "", 5).entries, []);
  assert.deepEqual(search(cat, "zzzz", 5).entries, []);
});

test("search corrects a misspelled word and says so", () => {
  const cat = buildCatalog(reference, meta);
  const res = search(cat, "delivary trucks", 5);
  assert.equal(res.entries[0].id, "delivery-truck-01");
  assert.deepEqual(res.corrections, ["delivary → delivery"]);
  assert.deepEqual(search(cat, "gear", 5).corrections, []);
});

test("a long query is capped instead of scanning every token", () => {
  const cat = buildCatalog(reference, meta);
  const t = performance.now();
  search(cat, Array.from({ length: 100 }, (_, i) => `word${i}`).join(" "), 5);
  assert.ok(performance.now() - t < 200);
});

test("digit names that differ only by a hyphen stay distinct", () => {
  const files = new Map([["ArrowDown01", []], ["ArrowDownZeroOne", []]]);
  const cat = buildCatalog({ ...reference, files }, parseMetadata({ icons: [{ name: "arrow-down-0-1" }, { name: "arrow-down-01" }] }));
  assert.equal(resolveName(cat, "arrow-down-0-1").file, "ArrowDownZeroOne");
  assert.equal(resolveName(cat, "arrow-down-01").file, "ArrowDown01");
  assert.equal(resolveName(cat, "ArrowDown01Icon").file, "ArrowDown01");
});

test("when several site names share an icon, the clean one becomes its name", () => {
  const files = new Map([["CommentAdd03", []], ["Cpp", ["C"]]]);
  const cat = buildCatalog({ ...reference, files }, parseMetadata({ icons: [{ name: "comment add-03" }, { name: "comment-add-03" }, { name: "c++" }, { name: "cpp" }] }));
  assert.equal(resolveName(cat, "comment add-03").id, "comment-add-03");
  assert.equal(resolveName(cat, "c++").id, "cpp");
});
