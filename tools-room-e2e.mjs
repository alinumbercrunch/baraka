// Drives room.html in real headless Chrome: what arithmetic can't prove. No dependencies.
// With --real it instead records transitions in a visible window on the real graphics card,
// which shows faults headless can't: the black flash and the gaps between rooms were only seen there.
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { extname, join, normalize } from "node:path";
import assert from "node:assert/strict";

const REAL = process.argv.includes("--real");

const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".jpg": "image/jpeg" };
const site = createServer(async (q, a) => {
  try {
    const f = normalize(new URL(q.url, "http://x").pathname.slice(1)) || "index.html";
    const body = await readFile(f);
    a.writeHead(200, { "content-type": TYPES[extname(f)] || "text/plain" }).end(body);
  } catch { a.writeHead(404).end() }
}).listen(0, "127.0.0.1");
await new Promise(r => site.once("listening", r));
const home = `http://127.0.0.1:${site.address().port}/index.html`;
const base = home.replace("index", "room");

const profile = await mkdtemp(join(tmpdir(), "baraka-"));
const chrome = spawn(CHROME, [...(REAL ? [] : ["--headless=new"]), "--remote-debugging-port=0", "--user-data-dir=" + profile,
  "--window-size=1440,900", "--no-first-run", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const ws0 = await new Promise(r => chrome.stderr.on("data", d => {
  const m = /ws:\/\/\S+/.exec(String(d)); if (m) r(m[0]) }));
const http = ws0.replace("ws://", "http://").replace(/\/devtools.*/, "");
const tab = await (await fetch(http + "/json/new?about:blank", { method: "PUT" })).json();

const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener("open", r));
let seq = 0; const waiting = new Map(), crashes = [], frames = [];
ws.addEventListener("message", e => {
  const m = JSON.parse(e.data);
  if (m.id) waiting.get(m.id)(m.result);
  if (m.method === "Page.screencastFrame") {
    frames.push({ data: m.params.data, at: Date.now() });
    cdp("Page.screencastFrameAck", { sessionId: m.params.sessionId });
  }
  if (m.method === "Runtime.exceptionThrown") crashes.push(m.params.exceptionDetails.exception?.description);
});
const cdp = (method, params = {}) => new Promise(r => {
  waiting.set(++seq, r); ws.send(JSON.stringify({ id: seq, method, params })) });
const js = async x => (await cdp("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result.value;
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (x, ms = 3000) => { for (let t = 0; t < ms; t += 50) { if (await js(x)) return true; await wait(50) } return false };
const load = async hash => {
  await cdp("Page.navigate", { url: "about:blank" });
  await cdp("Page.navigate", { url: base + hash });
  assert.ok(await until(`document.readyState==="complete"&&!!document.querySelector(".wall")`), "room built");
};
const key = async (key, code = key) => {
  for (const type of ["keyDown", "keyUp"])
    await cdp("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: { Escape: 27, ArrowRight: 39, Tab: 9 }[key] });
};
const open = `document.getElementById("panel").open`;

await cdp("Page.enable"); await cdp("Runtime.enable");

const checks = {
  "clicking a work opens its panel and gives it a link": async () => {
    await load("#mori");
    await js(`document.getElementById("hBK-052").click()`);
    assert.ok(await until(open));
    assert.equal(await js("location.hash"), "#mori/BK-052");
    assert.equal(await js(`document.getElementById("pt").textContent`), "海辺の家");
    const shade = `getComputedStyle(document.querySelector(".wall"),"::before").visibility`;
    assert.ok(await js(`document.getElementById("stage").classList.contains("look")`), "room dims");
    assert.equal(await js(shade), "visible");
    await key("Escape");
    assert.ok(await until(`!document.getElementById("stage").classList.contains("look")`), "room lifts");
    assert.ok(await until(`${shade}==="hidden"`, 3000), "shade gone, so new walls can't flash it");
  },
  "Esc closes, clears the link, and puts focus back on the work": async () => {
    await load("#mori/BK-052");
    await until(open);
    await key("Escape");
    assert.ok(await until(`!${open}`));
    assert.ok(await until(`location.hash==="#mori"`), "link cleared");
    assert.ok(await until(`document.activeElement.id==="hBK-052"`), "focus back");
  },
  "focus returns to the work you ended on, not the one you opened": async () => {
    await load("#mori/BK-014");
    await until(open);
    await key("ArrowRight");
    assert.ok(await until(`location.hash==="#mori/BK-052"`));
    await key("Escape");
    assert.ok(await until(`document.activeElement.id==="hBK-052"`), "focus back");
  },
  "the back button closes the panel": async () => {
    await load("#mori");
    await js(`location.hash="#mori/BK-014"`);
    await until(open);
    await js("history.back()");
    assert.ok(await until(`!${open}`));
    assert.ok(await until(`document.activeElement.id==="hBK-014"`), "focus back");
  },
  "leaving for another room with the panel open doesn't crash": async () => {
    await load("#mori/BK-014");
    await until(open);
    await js(`location.hash="#nakamura"`);
    assert.ok(await until(`!${open}&&document.getElementById("ttl").textContent.startsWith("中村")`));
  },
  "a sold work offers no way to buy, and a lone work no way to turn": async () => {
    await load("#ishii/BK-021");
    await until(open);
    for (const id of ["padd", "pe", "pn"]) assert.ok(await js(`document.getElementById("${id}").hidden`), id);
    assert.equal(await js(`document.getElementById("ps").hidden`), false);
    assert.equal(await js(`document.querySelectorAll(".here .hung.sold").length`), 1);
  },
  "reused panel: an unsold work after a sold one can be bought": async () => {
    await load("#ishii/BK-021");
    await until(open);
    await js(`location.hash="#mori/BK-014"`);
    assert.ok(await until(`document.getElementById("pt").textContent==="朝の輪郭"`));
    assert.equal(await js(`document.getElementById("padd").hidden`), false);
    assert.equal(await js(`document.getElementById("ps").hidden`), true);
  },
  "adding to the list keeps the visitor's saved wall": async () => {
    await load("#mori/BK-014");
    await js(`localStorage.setItem("bk3",'{"w":"3400","h":"2400","p":{"BK-052":{"room":"201"}}}')`);
    await until(open);
    await js(`document.getElementById("padd").click()`);
    const s = JSON.parse(await js(`localStorage.getItem("bk3")`));
    assert.equal(s.w, "3400");
    assert.deepEqual(Object.keys(s.p).sort(), ["BK-014", "BK-052"]);
    assert.equal(await js(`document.getElementById("padd").getAttribute("aria-pressed")`), "true");
    await js(`localStorage.clear()`);
  },
  "corrupt saved data doesn't stop the panel": async () => {
    await load("#mori");
    await js(`localStorage.setItem("bk3","{oops")`);
    await js(`location.hash="#mori/BK-014"`);
    assert.ok(await until(open));
    await js(`localStorage.clear()`);
  },
  "a hostile link does nothing": async () => {
    await load("#mori");
    await js(`location.hash="#<img src=x onerror=window.pwned=1>"`);
    await wait(300);
    assert.equal(await js("window.pwned"), undefined);
    assert.equal(await js(open), false);
    assert.equal(await js(`document.querySelectorAll("[onerror]").length`), 0);
  },
  "every room stands ready, and walking only moves the camera": async () => {
    await load("#mori");
    await wait(1000);
    assert.equal(await js(`document.querySelectorAll(".rm").length`), 4, "the whole row, from the start");
    assert.ok(await js(`[...document.querySelectorAll(".rm img")].every(i=>i.complete&&i.naturalWidth)`), "images ready");
    await js(`window.mark=document.querySelector('.rm[data-a="nakamura"]')`);
    await js(`document.getElementById("toNext").click()`);
    assert.equal(await js(`location.hash`), "#nakamura");
    assert.ok(await until(`document.querySelector(".rm.here").dataset.a==="nakamura"`, 3000));
    assert.equal(await js(`document.querySelectorAll(".rm.here .hung").length`), 2);
    assert.ok(await js(`window.mark.isConnected`), "the same room, not a new one");
  },
  "you can only tab to the room you are in, and only its work travels": async () => {
    await load("#nakamura");
    await wait(1200);
    assert.deepEqual(await js(`[...document.querySelectorAll(".rm")].map(r=>r.inert)`), [true, false, true, true]);
    assert.deepEqual(await js(`[...document.querySelectorAll(".rm img")].map(i=>getComputedStyle(i).viewTransitionName).filter(n=>n!=="none")`), ["hero-work"]);
  },
  "from the far end of the row, a painting is still faced head-on": async () => {
    await load("#ishii/BK-021");
    assert.ok(await until(`document.getElementById("panel").open`));
    await wait(2100);
    const r = await js(`(()=>{const b=document.getElementById("hBK-021").getBoundingClientRect(),s=document.getElementById("stage").getBoundingClientRect();return [b.left-s.left, s.right-b.right, b.top-s.top, s.bottom-b.bottom]})()`);
    assert.ok(r.every(v => v >= 0), "whole, on stage: " + r.map(Math.round));
  },
  "arriving in the next room is one landing: nothing moves afterwards": async () => {
    await load("#mori");
    await wait(1000);
    await js(`location.hash="#nakamura"`);
    assert.ok(await until(`document.querySelector(".rm.here").dataset.a==="nakamura"`, 3000));
    await wait(450);
    const seen = await js(`new Promise(done=>{
      const el=document.getElementById("hBK-007"), xs=[], t0=performance.now();
      (function frame(){ xs.push(el.getBoundingClientRect().x);
        performance.now()-t0<700 ? requestAnimationFrame(frame) : done(Math.max(...xs)-Math.min(...xs)) })();
    })`);
    assert.ok(seen < 2, "painting drifted " + Math.round(seen) + "px after landing");
  },
  "from the home page the painting carries you in: one move, no stop at the door": async () => {
    await cdp("Page.navigate", { url: "about:blank" });
    await cdp("Page.navigate", { url: home });
    assert.ok(await until(`document.readyState==="complete"`));
    await wait(500);
    await js(`document.querySelector('.hero a[href^="room.html"]').click()`);
    assert.ok(await until(`location.pathname.endsWith("room.html")&&!!document.querySelector(".wall")`));
    assert.equal(await js(`getComputedStyle(document.querySelector(".here .lead img")).viewTransitionName`), "hero-work");
    assert.equal(await js(`document.getElementById("card").classList.contains("off")`), true, "card waits for it to land");
    assert.ok(await until(`!(document.getElementById("room").style.transform.startsWith("translate3d(0px, 0px, 0px)"))`, 400), "already inside");
    assert.equal(await js(`document.getElementById("room").style.transition`), "none", "no second move");
    assert.ok(await until(`!document.getElementById("card").classList.contains("off")`, 3000), "then the title rises");
  },
  "a new shape of window reshapes the room": async () => {
    await load("#mori");
    await wait(1200);
    const wide = await js(`document.querySelector(".rm").style.getPropertyValue("--wide")`);
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 800, deviceScaleFactor: 1, mobile: false });
    assert.ok(await until(`document.querySelector(".rm").style.getPropertyValue("--wide")!==${JSON.stringify(wide)}`), "rebuilt");
    assert.ok(await js(`(()=>{const b=document.querySelector(".wall.back"),s=document.getElementById("stage");return s.clientHeight>0&&b.isConnected})()`));
    await cdp("Emulation.clearDeviceMetricsOverride");
  },
  "browsers without page transitions still walk in": async () => {
    const { identifier } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `delete Window.prototype.onpagereveal; delete window.onpagereveal;
      addEventListener("pagereveal", e => e.stopImmediatePropagation(), true)` });
    await load("#mori");
    assert.ok(await until(`!document.getElementById("card").classList.contains("off")`), "not stranded at the door");
    await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier });
  },
  "a click during the walk in still opens the work": async () => {
    await load("#mori");
    await js(`location.hash="#mori/BK-052"`);
    assert.ok(await until(`document.getElementById("panel").open`, 3000));
  },
  "the pointer tilts the room, but not a painting you are looking at": async () => {
    await load("#mori");
    await wait(1000);
    const before = await js(`document.getElementById("room").style.transform`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 100, y: 200 });
    assert.ok(await until(`document.getElementById("room").style.transform!==${JSON.stringify(before)}`));
    await js(`location.hash="#mori/BK-014"`);
    await until(open);
    await wait(100);
    const held = await js(`document.getElementById("room").style.transform`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", x: 900, y: 500 });
    await wait(200);
    assert.equal(await js(`document.getElementById("room").style.transform`), held);
  },
  "hovering a side work brings up its light, not a line": async () => {
    await load("#mori");
    await wait(1200);
    const box = await js(`(()=>{const r=document.getElementById("hBK-052").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...box });
    const glow = `getComputedStyle(document.getElementById("hBK-052"),"::before").opacity==="1"`;
    assert.ok(await until(glow), "light up");
    assert.equal(await js(`getComputedStyle(document.getElementById("hBK-052")).outlineColor`), "rgba(0, 0, 0, 0)");
    await js(`document.getElementById("hBK-052").focus()`);
  },
  "tabbing to a work shows the focus outline": async () => {
    await load("#mori");
    await js(`document.getElementById("toNext").focus()`);
    await key("Tab");
    assert.ok(await until(`document.activeElement.classList.contains("hung")`), "reached a work");
    assert.notEqual(await js(`getComputedStyle(document.activeElement).outlineColor`), "rgba(0, 0, 0, 0)");
  },
  "the title card follows the room, and steps aside for a work": async () => {
    await load("#mori");
    const card = id => `document.getElementById("${id}").textContent`, off = `document.getElementById("card").classList.contains("off")`;
    assert.ok(await until(`!${off}`), "shown on arrival");
    assert.equal(await js(card("cn")), "森\n柊");
    await js(`location.hash="#nakamura"`);
    assert.ok(await until(off), "leaves with the room");
    assert.ok(await until(`!${off}&&${card("cn")}==="中村あかり"`), "returns with the next");
    await js(`location.hash="#ishii"`);
    assert.ok(await until(`${card("cd")}.endsWith("完売")`, 4000), "sold out says so");
    await js(`document.querySelector(".hung").click()`);
    assert.ok(await until(`getComputedStyle(document.getElementById("card")).opacity==="0"`), "clear of the work");
  },
  "a long or translated name stays whole on the stage": async () => {
    await load("#nakamura");
    for (const name of ["Akari Nakamura", "Yuma Ishii-Nakamura", "Wolfeschlegelsteinhausen"]) {
      await js(`document.getElementById("cn").textContent=${JSON.stringify(name)}`);
      await wait(150);
      const r = await js(`(()=>{const c=document.getElementById("cn"),b=document.createRange();b.selectNodeContents(c);const t=b.getBoundingClientRect(),s=document.getElementById("card").getBoundingClientRect();return [t.left-s.left,s.right-t.right,t.top-s.top,s.bottom-t.bottom]})()`);
      assert.ok(r.every(v => v >= 0), name + ": " + r.map(Math.round));
    }
  },
  "the light changes the room and never the painting": async () => {
    await load("#mori");
    assert.equal(await js(`getComputedStyle(document.getElementById("hall")).transitionDuration`), "0s", "no fade on arrival");
    const pick = id => `document.querySelector('#sun [data-sun="${id}"]').click()`;
    await js(pick("evening"));
    assert.equal(await js(`document.getElementById("hall").dataset.sun`), "evening");
    assert.equal(await js(`document.querySelector('#sun [data-sun="evening"]').getAttribute("aria-pressed")`), "true");
    assert.equal(await js(`document.querySelector('#sun [data-sun="noon"]').getAttribute("aria-pressed")`), "false");
    const surface = `getComputedStyle(document.querySelector(".here .wall.back"),"::after").backgroundImage`;
    await wait(2700);
    const evening = await js(surface);
    await js(pick("noon"));
    assert.ok(await until(`${surface}!==${JSON.stringify(evening)}`), "wall changes");
    const art = await js(`(()=>{const i=document.querySelector(".hung img"),c=getComputedStyle(i),h=getComputedStyle(i.parentNode);return [c.filter,c.mixBlendMode,c.opacity,h.filter].join()})()`);
    assert.equal(art, "none,normal,1,none");
  },
  "every work has a label, and only artists with words get lettering": async () => {
    await load("#mori");
    assert.equal(await js(`document.querySelectorAll(".here .hung .lab").length`), 3);
    assert.equal(await js(`document.querySelectorAll(".here .says").length`), 1);
    assert.ok((await js(`document.querySelector(".says").textContent`)).startsWith("描き終えた絵"));
    await load("#komatsu");   // has wall space but no statement: nothing is invented
    assert.equal(await js(`document.querySelectorAll(".here .says").length`), 0);
  },
  "reduced motion: no walking, no glide": async () => {
    await cdp("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await load("#mori");
    await js(`location.hash="#komatsu"`);
    await wait(100);
    assert.equal(await js(`document.querySelector(".rm.here").dataset.a`), "komatsu");
    assert.equal(await js(`document.getElementById("ttl").textContent.startsWith("小松")`), true);
    assert.equal(await js(`document.getElementById("room").style.transition`), "none");
    await cdp("Emulation.setEmulatedMedia", { features: [] });
  },
  "phone: one flat wall, wider than the screen, with the work in the panel": async () => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 2, mobile: true });
    await load("#mori");
    assert.equal(await js(`document.querySelectorAll(".wall").length`), 1);
    assert.equal(await js(`document.querySelectorAll(".here .hung").length`), 3);
    assert.ok(await js(`document.getElementById("stage").scrollWidth>document.getElementById("stage").clientWidth`));
    await js(`location.hash="#mori/BK-014"`);
    await until(open);
    assert.ok(await js(`document.getElementById("pi").getBoundingClientRect().height>0`));
    assert.ok(await js(`document.getElementById("panel").getBoundingClientRect().bottom<=innerHeight+1`));
    await cdp("Emulation.clearDeviceMetricsOverride");
  },
};

// Empty space is painted magenta, so any gap between rooms can be counted, frame by frame.
const measure = (data) => js(`new Promise(done => { const i = new Image(); i.onload = () => {
  const c = document.createElement("canvas"); c.width = 144; c.height = 90;
  const x = c.getContext("2d"); x.drawImage(i, 0, 0, 144, 90);
  const p = x.getImageData(0, 18, 144, 72).data; let gap = 0, dark = 0;
  for (let k = 0; k < p.length; k += 4) {
    if (p[k] > 190 && p[k + 1] < 90 && p[k + 2] > 190) gap++;
    if (.2126 * p[k] + .7152 * p[k + 1] + .0722 * p[k + 2] < 45) dark++;
  }
  done([gap, dark].map(n => 100 * n / (p.length / 4))) }; i.src = "data:image/jpeg;base64,${data}" })`);
const record = async (name, start, ms = 2800) => {
  frames.length = 0;
  await cdp("Page.bringToFront");
  await cdp("Page.startScreencast", { format: "jpeg", quality: 70, everyNthFrame: 1 });
  await wait(150);
  const t0 = Date.now();
  await start();
  await wait(ms);
  await cdp("Page.stopScreencast");
  await wait(150);
  const got = frames.filter(f => f.at >= t0);
  await cdp("Page.navigate", { url: "about:blank" });
  await wait(150);
  let gap = 0, dark = 0;
  for (const f of got) { const [g, d] = await measure(f.data); f.g = g; gap = Math.max(gap, g); dark = Math.max(dark, d) }
  if (process.env.WORST && got.length) { const w = got.reduce((a, b) => b.g > a.g ? b : a); (await import("node:fs")).writeFileSync(process.env.WORST + "/" + name.replace(/\W+/g, "-") + ".jpg", Buffer.from(w.data, "base64")); console.log("   worst at", w.at - t0, "ms; empty% by time:", got.filter(f => f.g > .5).map(f => (f.at - t0) + ":" + f.g.toFixed(0)).join(" ")) }
  console.log(`  ${name}: ${got.length} frames, empty ${gap.toFixed(1)}%, dark ${dark.toFixed(1)}%`);
  return { frames: got.length, gap, dark };
};
const magenta = `addEventListener("DOMContentLoaded", () => document.head.insertAdjacentHTML("beforeend",
  "<style>#stage{background:#f0f !important}</style>"))`;
if (REAL) {
  await cdp("Page.enable"); await cdp("Runtime.enable"); await cdp("Page.bringToFront");
  await cdp("Page.addScriptToEvaluateOnNewDocument", { source: magenta });
  const walk = async (from, to) => {
    await cdp("Page.navigate", { url: base + from }); await wait(2500);
    return record(`${from} to ${to}`, () => js(`location.hash=${JSON.stringify(to)}`));
  };
  const hover = async () => {
    await cdp("Page.navigate", { url: home }); await wait(1500);
    const at = await js(`(()=>{const r=document.querySelector('.hero a[href^="room.html"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
    await cdp("Input.dispatchMouseEvent", { type: "mouseMoved", ...at });
    await wait(900);
    return at;
  };
  const results = [await walk("#mori", "#nakamura"), await walk("#nakamura", "#mori"), await walk("#ishii", "#mori")];
  const at = await hover();
  results.push(await record("home to room", async () => {
    await cdp("Input.dispatchMouseEvent", { type: "mousePressed", ...at, button: "left", clickCount: 1 });
    await cdp("Input.dispatchMouseEvent", { type: "mouseReleased", ...at, button: "left", clickCount: 1 });
  }));
  await cdp("Page.navigate", { url: base + "#nakamura" }); await wait(2500);
  results.push(await record("facing a side work", () => js(`location.hash="#nakamura/BK-032"`), 2400));
  const bad = results.filter(r => r.frames < 10 || r.gap > .5 || r.dark > 15).length;
  console.log(bad ? `\n  ${bad} recording(s) show gaps or a flash` : "\n  no gaps, no flash");
  ws.close(); chrome.kill(); site.close();
  await wait(300); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(bad ? 1 : 0);
}

let failed = 0;
for (const [name, run] of Object.entries(checks)) {
  crashes.length = 0;
  try {
    await run();
    assert.deepEqual(crashes, [], "uncaught error");
    console.log("  ok   " + name);
  } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message.replace(/\s+/g, " ").slice(0, 200)) }
}
console.log(`\n  ${Object.keys(checks).length - failed} passed, ${failed} failed`);
ws.close(); chrome.kill(); site.close();
await wait(200); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
process.exit(failed ? 1 : 0);
