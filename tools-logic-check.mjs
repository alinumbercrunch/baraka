// Asserts the rules every page shares, against the real browser scripts.
import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const saved = new Map();
globalThis.localStorage = {
  getItem: k => saved.get(k) ?? null,
  setItem: (k, v) => { if (saved.get("full")) throw new Error("quota"); saved.set(k, v) },
};
const files = ["works.js", "room.js"].filter(existsSync);
const api = new Function(files.map(f => readFileSync(f, "utf8")).join("\n") +
  `;return { WORKS, hang, byNo, page, loadStore, saveStore, loadPicks, togglePick,
     ...(typeof plan === "undefined" ? {} : { ROOM, route, plan, camera, artistKey }) }`)();
const { WORKS, hang, byNo, page, loadStore, saveStore, loadPicks, togglePick } = api;

test("hang: eye level, lowered only when the top would crowd the ceiling", () => {
  assert.equal(hang({ h: 960 }, 2400), 1500);
  assert.equal(hang({ h: 1500 }, 2400), 1500);      // top lands exactly on the limit
  assert.equal(hang({ h: 1600 }, 2400), 1450);
});

test("page: a work's number names its page", () => assert.equal(page(byNo("BK-014")), "bk014.html"));

test("saved data: corrupt or wrong-shaped values read as empty", () => {
  for (const bad of ["{oops", "null", "[1]", "3", '"x"']) {
    saved.set("bk3", bad);
    assert.deepEqual(loadStore(), {}, bad);
  }
  for (const p of ["x", 3, null, [1]]) {
    saved.set("bk3", JSON.stringify({ p }));
    assert.deepEqual(loadPicks(), {}, String(p));
  }
  saved.clear();
});

test("saved data: a partial save keeps the other fields, and a full disk doesn't throw", () => {
  saved.clear();
  saveStore({ w: 3400 });
  saveStore({ p: { "BK-014": { room: "" } } });
  assert.deepEqual(loadStore(), { w: 3400, p: { "BK-014": { room: "" } } });
  saved.set("full", true);
  assert.doesNotThrow(() => saveStore({ w: 1 }));
  saved.clear();
});

test("list: toggles on and off, keeps others, never takes a sold work", () => {
  const k = byNo("BK-014"), other = { "BK-052": { room: "201" } };
  const on = togglePick(other, k);
  assert.deepEqual(Object.keys(on).sort(), ["BK-014", "BK-052"]);
  assert.deepEqual(togglePick(on, k), other);
  assert.deepEqual(other, { "BK-052": { room: "201" } }, "input not mutated");
  assert.deepEqual(togglePick({}, WORKS.find(w => w.sold)), {});
});
