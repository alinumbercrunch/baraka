// Asserts the rules every page shares, against the real browser scripts.
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { test } from "node:test";

const saved = new Map();
globalThis.localStorage = {
  getItem: k => saved.get(k) ?? null,
  setItem: (k, v) => { if (saved.get("full")) throw new Error("quota"); saved.set(k, v) },
};
const files = ["works.js", "room.js"];
const api = new Function(files.map(f => readFileSync(f, "utf8")).join("\n") +
  `;return { ARTIST, WORKS, hang, byNo, page, loadStore, saveStore, loadPicks, togglePick,
     ROOM, ARTISTS, route, plan, place, lens, face, tilt, neighbour, sunAt }`)();
const { ARTIST, WORKS, hang, byNo, page, loadStore, saveStore, loadPicks, togglePick,
  ROOM, ARTISTS, route, plan, place, lens, face, tilt, neighbour, sunAt } = api;

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

const STAGES = [{ w: 1440, h: 770 }, { w: 800, h: 900 }, { w: 2560, h: 1000 }];
const many = n => Array.from({ length: n }, (_, i) => ({ no: "X" + i, w: 1000 + i, h: 800 }));
const rooms = [...ARTISTS.map(a => route("#" + a).works), many(1), many(30)];

test("route: anything but a known artist and their own work falls back safely", () => {
  const home = route("").artist;
  assert.equal(home, "mori");
  for (const bad of ["#nobody", "#constructor", "#__proto__", "#<img src=x onerror=alert(1)>", "#/", "#%00"]) {
    const r = route(bad);
    assert.equal(r.artist, home, bad);
    assert.equal(r.work, null, bad);
  }
  assert.equal(route("#mori/BK-021").work, null, "another artist's work");
  assert.equal(route("#mori/BK-014").work.no, "BK-014");
  assert.equal(route("#ishii").works.length, 1);
});

test("every artist has a romanised name and a place for their title card", () => {
  for (const a of ARTISTS) assert.ok(ARTIST[a]?.ro && ARTIST[a]?.pl, a);
});

test("sun: reads the hour in Japan, wherever the visitor's clock is", () => {
  const jst = (h, m = 0) => new Date(Date.UTC(2026, 9, 1, h - 9, m));
  assert.equal(sunAt(jst(4, 59)), "evening");
  assert.equal(sunAt(jst(5)), "morning");
  assert.equal(sunAt(jst(10, 59)), "morning");
  assert.equal(sunAt(jst(11)), "noon");
  assert.equal(sunAt(jst(15, 59)), "noon");
  assert.equal(sunAt(jst(16)), "evening");
  assert.equal(sunAt(jst(23, 59)), "evening");
  assert.equal(sunAt(jst(0)), "evening");
});

test("words: stand on the back wall clear of the work, or don't appear", () => {
  for (const works of rooms) {
    const room = plan(works);
    if (!room.says) continue;
    const half = ROOM.says / 2, first = Math.min(...room.spots.filter(p => p.wall === "back").map(p => p.x - p.k.w / 2));
    assert.equal(room.says.wall, "back");
    assert.ok(room.says.x - half >= ROOM.clear, "clear of the corner");
    assert.ok(room.says.x + half <= first - ROOM.clear, "clear of the work");
  }
  assert.ok(plan(route("#mori").works).says, "Mori's room has space");
  assert.equal(plan([{ no: "W", w: 4000, h: 800 }]).says, null, "a wall-filling work leaves no space");
});

test("neighbour: artists wrap round both ways", () => {
  assert.equal(neighbour(ARTISTS[0], -1), ARTISTS.at(-1));
  assert.equal(neighbour(ARTISTS.at(-1), 1), ARTISTS[0]);
});

test("plan: every work hangs, whole, on one wall, clear of every other", () => {
  for (const flat of [false, true]) for (const works of rooms) {
    const room = plan(works, flat);
    assert.equal(room.spots.length, works.length, "nothing left off the wall");
    for (const { k, wall, x, y } of room.spots) {
      const len = wall === "back" ? room.w : room.d;
      assert.ok(x - k.w / 2 >= 0 && x + k.w / 2 <= len, "inside the wall");
      assert.ok(y - k.h / 2 > 0 && y + k.h / 2 < room.h, "between floor and ceiling");
    }
    for (const id of ["back", "left", "right"]) {
      const on = room.spots.filter(s => s.wall === id).sort((a, b) => a.x - b.x);
      on.slice(1).forEach((s, i) =>
        assert.ok(s.x - s.k.w / 2 > on[i].x + on[i].k.w / 2, "no overlap"));
    }
    if (flat) assert.ok(room.spots.every(s => s.wall === "back"));
  }
});

test("plan: the largest work faces you, and a crowded room grows", () => {
  assert.equal(plan(route("#mori").works).spots.find(s => s.wall === "back").k.no, "BK-014");
  assert.equal(plan(many(1)).w, ROOM.w);
  assert.ok(plan(many(30)).d > ROOM.d);
});

test("rest: from the doorway no work is cut by the edge of the stage, even at full tilt", () => {
  for (const stage of STAGES) for (const works of rooms) {
    const room = plan(works), { u, p } = lens(room, stage);
    for (const s of room.spots) for (const dx of [-s.k.w / 2, s.k.w / 2]) {
      const c = place(room, { ...s, x: s.x + dx });
      const z = (c.z - room.d / 2 + ROOM.step * room.w) * u, f = p / (p - z);
      const margin = 1 + 2 * Math.sin(3 * Math.PI / 180);   // what 3° of tilt can swing a point
      assert.ok(z < 0 && Math.abs(c.x) * u * f * margin <= stage.w / 2 * 1.2, s.k.no);
      assert.ok(Math.abs(c.x) * u * f <= stage.w / 2, s.k.no + " on stage");
    }
  }
});

test("face: every work fits the free area whole, and small works still look small", () => {
  for (const stage of STAGES) {
    const aim = { x: 0, y: 0, w: stage.w - 340, h: stage.h };
    for (const works of rooms) {
      const room = plan(works), { u } = lens(room, stage);
      for (const s of room.spots) {
        const { f } = face(room, s, stage, aim);
        assert.ok(s.k.w * u * f <= aim.w && s.k.h * u * f <= aim.h, s.k.no);
      }
    }
    const room = plan(route("#mori").works), size = no => {
      const s = room.spots.find(p => p.k.no === no);
      return s.k.w * lens(room, stage).u * face(room, s, stage, aim).f;
    };
    assert.ok(size("BK-061") < size("BK-014") / 2);
  }
});

test("tilt: none at centre, limited to 1° and 3° at the corners", () => {
  const s = { w: 1000, h: 500 };
  assert.deepEqual(tilt(500, 250, s), { rx: 0, ry: 0 });
  assert.deepEqual(tilt(0, 0, s), { rx: 1, ry: -3 });
  assert.deepEqual(tilt(1000, 500, s), { rx: -1, ry: 3 });
});
