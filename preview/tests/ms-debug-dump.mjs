// 开屏动画调试 dump：patch matchMedia → 验证 playTransformIntro 路径
import { chromium } from "/volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs";
const CHROME = "/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.addInitScript(() => {
  // 强制 prefers-reduced-motion: no-preference（headless-shell 默认 reduce）
  const real = window.matchMedia.bind(window);
  window.matchMedia = (q) => {
    const m = real(q);
    if (q.includes("prefers-reduced-motion")) {
      const fake = { matches: false, media: q, onchange: null, addListener(){}, removeListener(){}, addEventListener(){}, removeEventListener(){}, dispatchEvent(){ return false; } };
      return fake;
    }
    return m;
  };
  window.__bootTrace = [];
  const origAppend = Element.prototype.appendChild;
  Element.prototype.appendChild = function (el) {
    if (el && el.className === "ff-boot") window.__bootTrace.push("append-ff-boot@" + Date.now());
    return origAppend.call(this, el);
  };
});
page.on("console", (m) => console.log(`[console:${m.type()}]`, m.text().slice(0, 200)));
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 500)));
page.on("requestfailed", (r) => console.log("[reqfail]", r.url(), r.failure()?.errorText));
await page.goto("http://127.0.0.1:30999/", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4500);
const state = await page.evaluate(() => ({
  reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  bootTrace: window.__bootTrace || [],
  hasBoot: !!document.querySelector(".ff-boot"),
  bodyChildren: document.body.children.length,
  classes: [...document.querySelectorAll("body > *")].map((e) => e.tagName + "." + (typeof e.className === "string" ? e.className : "")).join(" | "),
}));
console.log("[state]", JSON.stringify(state, null, 2));
await browser.close();
