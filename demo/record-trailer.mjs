import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.argv[2] ?? "frames");
const APP = "http://localhost:3000";
const LOGO = fs.readFileSync(process.argv[3], "utf8");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

const TRUSTED = "0x63b85a4785552aa79e9884da6d203c939375e343fb45240c62808fc05f7a8f15";
const LOOKALIKE = "0x63b85a1111111111111111111111111111111111111111111111111111118f15";
const FRIEND = "0x0000000000000000000000000000000000000000000000000000000000000005";

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
  args: ["--hide-scrollbars", "--force-color-profile=srgb"],
  defaultViewport: { width: 1100, height: 619, deviceScaleFactor: 1920 / 1100 },
});
const page = await browser.newPage();
const cdp = await page.createCDPSession();

// ---- frame capture (CDP screencast) ----
const frames = []; // {file, t}
let recording = false;
cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
  cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  if (!recording) return;
  const file = path.join(OUT, `f${String(frames.length).padStart(5, "0")}.jpg`);
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  frames.push({ file, t: metadata.timestamp });
});
await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const marks = [];
const mark = (name) => marks.push({ name, t: Date.now() / 1000 });

// Keeps the screencast emitting frames even on static screens.
async function hold(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    await page.evaluate(() => {
      let d = document.getElementById("__tick");
      if (!d) ((d = document.createElement("div")), (d.id = "__tick"), (d.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:.01;pointer-events:none;z-index:99999"), document.body.appendChild(d));
      d.style.background = d.style.background === "red" ? "blue" : "red";
    });
    await sleep(40);
  }
}

// ---- title cards ----
const cardHtml = (inner) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;height:100%;background:radial-gradient(1100px 600px at 15% -10%,#0f2a24 0%,transparent 60%),radial-gradient(900px 500px at 110% 120%,#1e1438 0%,transparent 60%),#07080b;color:#ededed;font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display","Helvetica Neue",sans-serif;overflow:hidden}
  .wrap{height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 90px;box-sizing:border-box}
  .k{font:600 15px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.28em;text-transform:uppercase;color:#34d399;opacity:0;animation:in .7s .1s forwards}
  h1{font-size:64px;line-height:1.08;letter-spacing:-.02em;margin:18px 0 0;font-weight:700;opacity:0;animation:in .8s .35s forwards}
  h1 em{font-style:normal;background:linear-gradient(90deg,#34d399,#a78bfa);-webkit-background-clip:text;color:transparent}
  p{font-size:26px;color:#a1a1aa;margin:22px 0 0;max-width:900px;opacity:0;animation:in .8s .8s forwards}
  .logo{width:120px;height:120px;opacity:0;animation:pop .9s .1s forwards}
  .row{display:flex;gap:14px;margin-top:34px;opacity:0;animation:in .8s 1.1s forwards}
  .chip{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);border-radius:999px;padding:10px 20px;font-size:20px;color:#d4d4d8}
  .chip b{color:#fff}
  .bad{color:#fda4af}
  @keyframes in{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}
  @keyframes pop{from{opacity:0;transform:scale(.7) rotate(-8deg)}to{opacity:1;transform:none}}
</style></head><body><div class="wrap">${inner}</div></body></html>`;

async function card(inner, ms) {
  if (!page.url().startsWith("about:")) await page.goto("about:blank");
  await page.setContent(cardHtml(inner), { waitUntil: "domcontentloaded" });
  await sleep(50);
  recording = true;
  await hold(ms);
  recording = false;
}

// ---- app helpers ----
async function caption(text) {
  await page.evaluate((text) => {
    let c = document.getElementById("__cap");
    if (!c) {
      c = document.createElement("div");
      c.id = "__cap";
      c.style.cssText =
        "position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:99998;padding:14px 26px;border-radius:999px;background:rgba(7,8,11,.86);border:1px solid rgba(52,211,153,.45);color:#fff;font:600 21px -apple-system,BlinkMacSystemFont,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.6);backdrop-filter:blur(8px);transition:opacity .25s;white-space:nowrap";
      document.body.appendChild(c);
    }
    c.style.opacity = "0";
    setTimeout(() => ((c.textContent = text), (c.style.opacity = "1")), 180);
  }, text);
}

async function clickText(text, root = "button") {
  await page.evaluate(
    (text, root) => {
      const el = [...document.querySelectorAll(root)].find((b) => b.textContent.trim() === text || b.textContent.includes(text));
      el?.click();
    },
    text,
    root,
  );
}

async function paste(selector, value) {
  await page.evaluate(
    (sel, v) => {
      const el = [...document.querySelectorAll(sel)].pop();
      el.focus();
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    selector,
    value,
  );
}

async function waitText(text, timeout = 30000) {
  await page.waitForFunction((t) => document.body.innerText.includes(t), { timeout }, text).catch(() => console.log("timeout waiting for", text));
}

const APP_CSS = `
  nextjs-portal, [data-nextjs-toast], #__next-build-watcher { display:none !important; }
  header p { display:none !important; }
  header { margin-bottom: 1.25rem !important; }
  html { scroll-behavior: smooth; }
`;

// ================= SCENES =================

// 1. Problem
await card(
  `<div class="k">The problem</div>
   <h1>One wrong address.<br/><span class="bad">Funds gone forever.</span></h1>
   <p>Address-poisoning, fake tokens and blind signing drain wallets every day, and your wallet forgets everything you&rsquo;ve learned.</p>`,
  3300,
);
mark("solution");
// 2. Solution
await card(
  `<div class="logo">${LOGO}</div>
   <h1 style="margin-top:22px">Tantum <em>Guard</em></h1>
   <p>A Sui wallet companion that <b style="color:#fff">remembers</b> who you trust and checks every send &amp; swap before you sign.</p>
   <div class="row"><span class="chip"><b>Walrus Memory</b> · memory you own</span><span class="chip"><b>Tatum</b> · chain data + simulation</span></div>`,
  4000,
);

// 3. App: Check address
mark("check");
await page.goto(`${APP}/#check`, { waitUntil: "networkidle2" });
await page.addStyleTag({ content: APP_CSS });
await page.waitForSelector('input[placeholder^="Paste a Sui address"]');
await sleep(400);
recording = true;
await caption("Paste any address and it's scanned instantly");
await hold(500);
await paste('input[placeholder^="Paste a Sui address"]', TRUSTED);
await waitText("What do you want to do next");
await hold(1500);

await caption("A lookalike? Your memory catches it.");
await paste('input[placeholder^="Paste a Sui address"]', LOOKALIKE);
await page.waitForFunction(() => document.body.innerText.includes("address-poisoning"), { timeout: 30000 }).catch(() => {});
await hold(900);
await page.evaluate(() => window.scrollTo({ top: 300, behavior: "smooth" }));
await hold(1800);
await caption("Then choose: send, swap & send, trust or block");
await page.evaluate(() => window.scrollTo({ top: 620, behavior: "smooth" }));
await hold(1700);
recording = false;

// 4. App: Swap
mark("swap");
await clickText("Swap", "nav button");
await page.evaluate(() => window.scrollTo({ top: 0 }));
await sleep(500);
recording = true;
await caption("Swap at the best price across Sui DEXs");
await hold(500);
const amt = 'input[inputmode="decimal"]';
await page.waitForSelector(amt);
await page.type(amt, "25", { delay: 120 });
await waitText("Minimum received", 20000);
await hold(1300);
await caption("Every token, with logos and live prices");
await page.evaluate(() => {
  const pills = [...document.querySelectorAll("button")].filter((b) => b.querySelector("svg path[d^='M3 4.5']"));
  pills[1]?.click();
});
await hold(1700);
await page.keyboard.press("Escape");
await hold(300);
await caption("Or swap and deliver to a friend's wallet");
await page.evaluate(() => document.querySelector('[role="switch"]')?.click());
await hold(400);
await page.evaluate(() => window.scrollTo({ top: 230, behavior: "smooth" }));
await hold(300);
await paste('input[placeholder^="Paste a Sui address"]', FRIEND);
await hold(2300);
recording = false;

// 5. App: Send
mark("send");
await clickText("Send", "nav button");
await page.evaluate(() => window.scrollTo({ top: 0 }));
await sleep(400);
recording = true;
await caption("Every send is checked and simulated by Tatum before you sign");
await page.type(amt, "120", { delay: 70 });
await paste('input[placeholder^="Paste a Sui address"]', LOOKALIKE);
await page.waitForFunction(() => [...document.querySelectorAll("span")].some((s) => s.textContent === "Stop"), { timeout: 30000 }).catch(() => {});
await hold(2600);
recording = false;

// 6. Outro
mark("outro");
await card(
  `<div class="logo">${LOGO}</div>
   <h1 style="margin-top:22px">Remembers what you trust.<br/><em>Stops what you&rsquo;ve blocked.</em></h1>
   <p>Simulated on Sui Mainnet before you sign.</p>
   <div class="row"><span class="chip"><b>Tantum Guard</b></span><span class="chip">Tatum × Walrus Memory · Total Recall</span></div>`,
  4000,
);

await cdp.send("Page.stopScreencast");
await browser.close();
fs.writeFileSync(path.join(OUT, "frames.json"), JSON.stringify({ frames, marks }, null, 0));
console.log("frames:", frames.length, "span:", (frames.at(-1).t - frames[0].t).toFixed(1), "s");
