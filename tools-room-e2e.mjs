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
// a stuck browser must fail the run, not hang it
const watchdog = setTimeout(async () => { console.log("  TIMED OUT: browser stopped responding"); try { chrome.kill("SIGKILL") } catch {} process.exit(2) }, REAL ? 120000 : 240000);
watchdog.unref();

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

// CSS transitions are animations too, so this waits out the card's 0.55s rise and any
// re-fit it triggers. Measuring a rect mid-transition reads the transform, not the layout.
const settled = (ms = 4000) => until(`document.getAnimations().every(a=>a.playState!=="running")`, ms);
const nameClear = () => js(`(()=>{const r=document.createRange();r.selectNodeContents(document.getElementById("cn"));
  const lines=[...r.getClientRects()], facts=["cr","ct","cd"].map(id=>document.getElementById(id).getBoundingClientRect());
  return !lines.some(l=>facts.some(f=>l.left+1<f.right&&f.left+1<l.right&&l.top+.2*l.height<f.bottom&&f.top<l.bottom-.2*l.height))})()`);
// chrome.kill() kills the launcher, not the chrome-headless-shell it spawns: those
// survive, pile up across runs and starve the timing-sensitive checks of CPU, which
// looks exactly like flaky tests. Ask the browser to close itself, and only fall back
// to signalling the process we started.
const shutdown = async () => {
  try { await Promise.race([cdp("Browser.close"), wait(2000)]) } catch {}
  try { ws.close() } catch {}
  try { chrome.kill() } catch {}
  await wait(300);
  if (chrome.exitCode === null) { try { chrome.kill("SIGKILL") } catch {} }
  site.close();
};

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
    // Asking whether the card is still down is a race: between two polls the rise can
    // already have happened, and on a slow machine it usually has. The claim is an
    // invariant, not a snapshot — at any instant the card is either still down, or the
    // painting has already landed. That is true whenever it is sampled, or it is false.
    const atArrival = await js(`(()=>{const c=document.getElementById("card"), r=document.getElementById("room");
      return {down:c.classList.contains("off"),
              landed:!(r.style.transform||"translate3d(0px, 0px, 0px)").startsWith("translate3d(0px, 0px, 0px)")}})()`);
    assert.ok(atArrival.down || atArrival.landed,
      "the title rose before the painting landed: " + JSON.stringify(atArrival));
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
  "the first screen is the promise, one painting and one button": async () => {
    for (const [width, height] of [[1440, 900], [390, 780]]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp("Page.navigate", { url: home });
      assert.ok(await until(`document.readyState==="complete"&&!!document.querySelector(".hero .door")`));
      assert.deepEqual(await js(`[...document.querySelectorAll(".hero .door")].map(a=>a.getAttribute("href"))`), ["room.html"]);
      assert.equal(await js(`document.querySelectorAll(".hero img").length`), 1);
      assert.ok(await js(`!!(document.querySelector(".hero .by").compareDocumentPosition(document.querySelector(".hero img"))&Node.DOCUMENT_POSITION_FOLLOWING)`), "the artist is named above the painting");
      assert.equal(await js(`document.querySelector(".hero .by").textContent.includes("お取り置き")`), false, "a hold is about works, so it sits by the prices");
      assert.equal(await js(`document.querySelector(".hero").textContent.includes("¥")`), false, "nothing to read but the promise");
      assert.equal(await js(`document.querySelector(".hero h1").textContent`), "その部屋のための一枚を、まだ知られていない作家から。");
      assert.ok(await js(`document.querySelector(".hero .tag").textContent.startsWith("実際の大きさのまま見て、選んで、買えます。")`), "actual size, and that the works are for sale");
      assert.equal(await js(`document.querySelector(".hero").textContent.includes("卸価格")`), false, "wholesale belongs on the trade page");
      assert.ok((await js(`document.title`)).includes("その部屋のための一枚"), "the tab says what the page says");
      assert.ok((await js(`document.querySelector('meta[name="description"]').content`)).includes("選んで、買えます"), "so does search");
      assert.ok(await js(`document.querySelector(".hero .door").getBoundingClientRect().bottom<=innerHeight`), width + ": button in view without scrolling");
    }
    await cdp("Emulation.clearDeviceMetricsOverride");
    assert.equal(await js(`getComputedStyle(document.querySelector(".hero img")).viewTransitionName`), "hero-work");
    assert.deepEqual(await js(`[...document.images].filter(i=>getComputedStyle(i).viewTransitionName!=="none").length`), 1, "one travelling work, or the transition is skipped");
    assert.ok(await js(`!!(document.querySelector(".circle").compareDocumentPosition(document.querySelector(".proof"))&Node.DOCUMENT_POSITION_FOLLOWING)`), "the why, then the proof");
  },
  "the home page doesn't repeat the nav": async () => {
    await cdp("Page.navigate", { url: home });
    assert.ok(await until(`document.readyState==="complete"`));
    assert.equal(await js(`document.querySelectorAll(".who-for").length`), 0);
    assert.equal(await js(`document.querySelectorAll(".circle .share,.circle .cen").length`), 0);
  },
  "the home page says each thing once, and prices still state tax": async () => {
    await cdp("Page.navigate", { url: home });
    assert.ok(await until(`document.readyState==="complete"&&!!document.querySelector("#grid a")`));
    assert.equal(await js(`document.querySelectorAll('.hero img[src="img/w5.jpg"],.proof img[src="img/w5.jpg"]').length`), 2, "shown, then compared");
    assert.equal(await js(`[...document.images].filter(i=>i.getAttribute("src")==="img/w5.jpg").length`), 2, "and nowhere else");
    for (const gone of [".quote", ".contact", ".note"]) assert.equal(await js(`document.querySelectorAll("${gone}").length`), 0, gone);
    assert.ok(await js(`document.querySelector(".proof").textContent.includes("税込")`), "tax note beside the prices");
    assert.ok(await js(`document.querySelector(".proof").textContent.includes("作品は2週間お取り置きできます")`), "the hold is beside the prices");
    assert.equal(await js(`document.querySelectorAll(".by").length`), 1, "the artist is named once");
  },
  "the month's works open the page, on one floor, at true relative size": async () => {
    // 360 is the commonest Android width, and 890 is where the gap's 3vw outgrows its
    // 18px minimum: both wrapped the row while only 1440 and 390 were being tested
    for (const [width, height] of [[1440, 900], [890, 800], [390, 780], [360, 740], [320, 568]]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp("Page.navigate", { url: home });
      assert.ok(await until(`document.readyState==="complete"&&document.querySelectorAll(".proof #grid .fr").length===3`), "all three in the hero");
      const f = await js(`[...document.querySelectorAll("#grid .fr")].map(e=>{const r=e.getBoundingClientRect();return {w:r.width,b:r.bottom,r:r.right,l:r.left}})`);
      assert.ok(Math.max(...f.map(x => x.b)) - Math.min(...f.map(x => x.b)) < 1,
        `${width}: one floor — widths ${f.map(x => x.w.toFixed(1))} span ` +
        `${(Math.max(...f.map(x => x.r)) - Math.min(...f.map(x => x.l))).toFixed(1)} of ${width}, ` +
        `bottoms ${f.map(x => x.b.toFixed(1))}`);
      assert.ok(Math.abs(f[0].w / f[2].w - 2148 / 364) < .5, width + ": true ratio " + (f[0].w / f[2].w).toFixed(2));
      assert.ok(Math.min(...f.map(x => x.l)) >= 0 && Math.max(...f.map(x => x.r)) <= width, width + ": all on screen");
      assert.equal(await js(`document.documentElement.scrollWidth<=innerWidth`), true,
        width + ": no sideways scroll — " + await js(
          `(()=>{const d=document.documentElement;
             const nm=e=>e.tagName+(typeof e.className==="string"&&e.className.trim()?"."+e.className.trim().split(/\\s+/).join("."):"");
             const past=[...document.querySelectorAll("body *")]
               .map(e=>({t:nm(e),r:Math.round(e.getBoundingClientRect().right)}))
               .filter(x=>x.r>innerWidth).sort((a,b)=>b.r-a.r).slice(0,3).map(x=>x.t+" right "+x.r);
             const inner=[...document.querySelectorAll("body *")]
               .filter(e=>e.scrollWidth>e.clientWidth+1)
               .map(e=>({t:nm(e),o:e.scrollWidth-e.clientWidth})).sort((a,b)=>b.o-a.o).slice(0,3)
               .map(x=>x.t+" spills "+x.o);
             return \`scrollWidth \${d.scrollWidth} vs innerWidth \${innerWidth} (client \${d.clientWidth}); \`
               +\`past edge: \${past.join(", ")||"none"}; overflowing content: \${inner.join(", ")||"none"}\`})()`));
    }
    await cdp("Emulation.clearDeviceMetricsOverride");
    assert.equal(await js(`document.querySelectorAll("#thismonth").length`), 0, "no second introduction");
    assert.equal(await js(`document.querySelectorAll('.hero a[href="artist-mori.html"]').length`), 1, "the artist is named once, and links on");
  },
  "every band is ruled off and its content clears the next rule": async () => {
    for (const [width, height] of [[1440, 900], [390, 780]]) {
      await cdp("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
      await cdp("Page.navigate", { url: home });
      assert.ok(await until(`document.readyState==="complete"&&!!document.querySelector("#grid a")`));
      const bands = await js(`[...document.querySelectorAll(".hero,.circle,.proof,.sec")].map(b=>{
        const r=b.getBoundingClientRect(), cs=getComputedStyle(b);
        const kids=[...b.children].map(k=>k.getBoundingClientRect().bottom);
        return {cls:b.className.split(" ")[0], rule:parseFloat(cs.borderTopWidth),
                head:!!b.querySelector(":scope>h1,:scope>h2,:scope>.en"),
                top:Math.round(parseFloat(cs.paddingTop)),
                clear:Math.round(r.bottom-Math.max(...kids))}})`);
      assert.equal(bands.length, 4, width + ": four bands");
      for (const b of bands) {
        assert.ok(b.rule >= 1, `${width}: ${b.cls} has no rule above it`);
        assert.ok(b.head, `${width}: ${b.cls} has no heading naming it`);
        assert.ok(b.top >= 12, `${width}: ${b.cls} content sits on its own rule (${b.top}px)`);
        assert.ok(b.clear >= 12, `${width}: ${b.cls} content runs into the next rule (${b.clear}px)`);
      }
    }
    await cdp("Emulation.clearDeviceMetricsOverride");
  },
  "designers can reach the wall-size tool from their own section": async () => {
    await cdp("Page.navigate", { url: home.replace("index", "trade") });
    assert.ok(await until(`document.readyState==="complete"`));
    assert.equal(await js(`document.querySelectorAll('#designer a[href="works.html#wallbox"]').length`), 1);
  },
  "past artists stay compact on a phone, and sold out is said once": async () => {
    await cdp("Emulation.setDeviceMetricsOverride", { width: 390, height: 780, deviceScaleFactor: 1, mobile: false });
    await cdp("Page.navigate", { url: home });
    assert.ok(await until(`document.readyState==="complete"&&document.querySelectorAll("#past a").length===3`));
    const heights = await js(`[...document.querySelectorAll("#past a")].map(a=>a.getBoundingClientRect().height)`);
    await cdp("Emulation.clearDeviceMetricsOverride");
    assert.ok(Math.max(...heights) <= 130, "card heights " + heights.map(Math.round));
    assert.equal(await js(`(document.getElementById("past").textContent.match(/完売/g)||[]).length`), 1);
    assert.equal(await js(`document.querySelectorAll("#past img").length`), 3, "each artist still shows their work");
  },
  "browsers without page transitions still walk in": async () => {
    const { identifier } = await cdp("Page.addScriptToEvaluateOnNewDocument", { source: `delete Window.prototype.onpagereveal; delete window.onpagereveal;
      addEventListener("pagereveal", e => e.stopImmediatePropagation(), true)` });
    try {
      await load("#mori");
      assert.ok(await until(`!document.getElementById("card").classList.contains("off")`), "not stranded at the door");
    } finally { await cdp("Page.removeScriptToEvaluateOnNewDocument", { identifier }) }
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
    await cdp("Emulation.setDeviceMetricsOverride", { width: 1000, height: 520, deviceScaleFactor: 1, mobile: false });
    await load("#nakamura");
    await settled();
    for (const name of ["Akari Nakamura", "Yuma Ishii-Nakamura", "Wolfeschlegelsteinhausenbergerdorff"]) {
      await js(`document.getElementById("cn").textContent=${JSON.stringify(name)}`);
      await wait(60);
      await settled();
      const r = await js(`(()=>{const c=document.getElementById("cn"),b=document.createRange();b.selectNodeContents(c);const t=b.getBoundingClientRect(),e=c.getBoundingClientRect(),s=document.getElementById("card").getBoundingClientRect();return [t.left-s.left,s.right-t.right,e.top-s.top,s.bottom-e.bottom]})()`);
      assert.ok(r.every(v => v >= 0), name + ": " + r.map(Math.round) + " — " + await js(
        `(()=>{const c=document.getElementById("cn"),cd=document.getElementById("card"),
                f=document.getElementById("cf"),s=getComputedStyle(cd);
           return \`font \${getComputedStyle(c).fontSize}, name h \${c.offsetHeight}, \`
             +\`card h \${cd.clientHeight}, cf h \${f.offsetHeight}, \`
             +\`room \${Math.round(cd.clientHeight-parseFloat(s.paddingTop)-parseFloat(s.paddingBottom)-f.offsetHeight-8)}, \`
             +\`lines \${Math.round(c.offsetHeight/parseFloat(getComputedStyle(c).lineHeight||1))}\`})()`));
      assert.ok(await nameClear(), name + " clear of the details");
    }
    await cdp("Emulation.clearDeviceMetricsOverride");
    for (const hash of ["#mori", "#nakamura"]) {
      await load(hash);
      await settled();
      assert.ok(await nameClear(), hash + " as written");
      await js(`document.getElementById("cn").textContent="Akari Nakamura"`);
      await wait(60);
      await settled();
      assert.ok(await nameClear(), hash + " translated");
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
  await shutdown();
  await wait(300); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(bad ? 1 : 0);
}

let failed = 0, ran = 0;
const only = process.argv.find(a => a.startsWith("--only="))?.slice(7);
for (const [name, run] of Object.entries(checks)) {
  if (only && !name.includes(only)) continue;
  ran++;
  crashes.length = 0;
  // Several checks deliberately leave a saved wall, saved picks, or corrupt data
  // behind. Inheriting it makes a later check depend on which ran before it, which
  // is how "carries you in" came to pass alone and fail in the suite.
  await cdp("Storage.clearDataForOrigin", { origin: new URL(home).origin, storageTypes: "local_storage" });
  try {
    await run();
    assert.deepEqual(crashes, [], "uncaught error");
    console.log("  ok   " + name);
  } catch (e) { failed++; console.log("  FAIL " + name + "\n       " + e.message.replace(/\s+/g, " ").slice(0, 200)) }
}
console.log(`\n  ${ran - failed} passed, ${failed} failed` +
  (only ? ` (${Object.keys(checks).length - ran} skipped by --only=${only})` : ""));
await shutdown();
await wait(200); await rm(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
process.exit(failed ? 1 : 0);
