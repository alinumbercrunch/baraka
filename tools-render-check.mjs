// Executes a page's inline <script> against a minimal DOM stub built from the
// ids actually present in that page's HTML. Catches the exact class of bug that
// killed works.html: a getElementById on an id that isn't there.
import { readFileSync } from "node:fs";

const file = process.argv[2];
const html = readFileSync(file, "utf8");

const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(m => m[1]));
const store = new Map();

const mkEl = id => {
  const el = {
    id, _html: "", value: "", hidden: false, dataset: {}, style: {},
    textContent: "", checked: false, children: [],
    get innerHTML() { return this._html },
    set innerHTML(v) {
      this._html = String(v);
      // crude child synthesis so [...pe.children] loops don't explode
      this.children = [...String(v).matchAll(/<button/g)].map(() => mkEl(id + "-child"));
    },
    setAttribute() {}, getAttribute() { return null }, removeAttribute() {},
    addEventListener() {}, removeEventListener() {},
    appendChild() {}, scrollIntoView() {}, focus() {}, select() {},
    closest() { return null }, querySelector() { return null },
    querySelectorAll() { return [] },
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false } },
    insertAdjacentHTML() {},
  };
  return el;
};

for (const id of ids) store.set(id, mkEl(id));

const asked = new Set();
const askedSel = new Set();

// Resolve a selector only as far as its leading #id, so that "#bSel b" counts as
// present when #bSel exists. Anything else returns an element rather than null:
// this harness is here to catch missing *ids*, not to re-implement CSS matching.
const resolveSel = sel => {
  askedSel.add(sel);
  const m = /^#([A-Za-z0-9_-]+)/.exec(sel.trim());
  if (m) return ids.has(m[1]) ? mkEl(m[1] + "::" + sel) : null;
  return mkEl("sel:" + sel);
};

globalThis.document = {
  getElementById(id) { asked.add(id); return store.get(id) ?? null },
  querySelector: resolveSel,
  querySelectorAll() { return [] },
  addEventListener() {}, createElement: () => mkEl("new"),
  body: mkEl("body"), documentElement: mkEl("html"),
};
globalThis.window = globalThis;
globalThis.location = { hash: "", href: "file://" + file, search: "" };
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null },
  setItem(k, v) { this._d[k] = String(v) },
  removeItem(k) { delete this._d[k] },
};
// Node 22 exposes navigator as a getter-only global
Object.defineProperty(globalThis, "navigator", {
  value: { clipboard: { writeText: () => Promise.resolve() } },
  configurable: true, writable: true,
});
globalThis.scrollTo = () => {};
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });

const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
if (!blocks.length) { console.log("no inline script"); process.exit(0) }

let failed = false;
blocks.forEach((code, i) => {
  try {
    new Function(code)();
    console.log(`  script block ${i + 1}: ran to completion`);
  } catch (e) {
    failed = true;
    console.log(`  script block ${i + 1}: THREW -> ${e.constructor.name}: ${e.message}`);
  }
});

const missing = [...asked].filter(a => !ids.has(a));
if (missing.length) { failed = true; console.log("  getElementById on MISSING ids:", missing.join(", ")) }

const missingSel = [...askedSel].filter(s => {
  const m = /^#([A-Za-z0-9_-]+)/.exec(s.trim());
  return m && !ids.has(m[1]);
});
if (missingSel.length) { failed = true; console.log("  querySelector on MISSING ids:", missingSel.join(", ")) }

// report what actually got rendered
for (const key of (process.argv[3] || "").split(",").filter(Boolean)) {
  const el = store.get(key);
  const n = el ? el._html.length : -1;
  const links = el ? [...el._html.matchAll(/href="([^"]+)"/g)].map(m => m[1]) : [];
  const uniq = [...new Set(links)];
  console.log(`  #${key}: ${n < 0 ? "NO SUCH ELEMENT" : n + " chars"}` +
    (uniq.length ? `, ${uniq.length} distinct links -> ${uniq.slice(0, 8).join(" ")}` : ", no links"));
}
process.exit(failed ? 1 : 0);
