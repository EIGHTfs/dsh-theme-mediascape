// ── 环境自推导（公开插件可移植）：pwviewer / pwviewer-libs / fonts 为仓库邻居目录
// （<harness>/pwviewer 等），从本文件位置向上搜索；env 可覆盖：PW_ROOT / MS_CHROMELIBS / MS_FONTCONF /
// MS_CHROME / MS_BROWSERS / MS_PWIMPORT。找不到时留空（浏览器测试需 env 提供）。
import { fileURLToPath as fURL, pathToFileURL as pURL } from 'node:url';
import { dirname as dName, join as jn, resolve as rslv } from 'node:path';
import { existsSync as exSync } from 'node:fs';
const SELF_DIR = dName(fURL(import.meta.url));
function findNeighbor(name, up = 8) {
  let d = SELF_DIR;
  for (let i = 0; i < up; i++) {
    if (exSync(jn(d, name))) return jn(d, name);
    d = rslv(d, '..');
  }
  return null;
}
const PW_ROOT = process.env.PW_ROOT || findNeighbor('pwviewer');
const PW_BROWSERS = process.env.MS_BROWSERS || (PW_ROOT ? jn(PW_ROOT, 'browsers') : '');
const CHROME = process.env.MS_CHROME || (PW_ROOT
  ? jn(PW_BROWSERS, exSync(jn(PW_BROWSERS, 'chromium-1243')) ? 'chromium-1243/chrome-linux64/chrome' : 'chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell')
  : '');
const MS_LIBS = process.env.MS_CHROMELIBS || findNeighbor('pwviewer-libs');
const MS_FONTS = process.env.MS_FONTCONF || (() => { const f = findNeighbor('fonts'); return f ? jn(f, 'fonts.conf') : ''; })();
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.MS_BROWSERS || PW_BROWSERS || process.env.PLAYWRIGHT_BROWSERS_PATH || '';
const PW_IMPORT = process.env.MS_PWIMPORT || (PW_ROOT ? pURL(jn(PW_ROOT, 'node_modules', 'playwright', 'index.mjs')).href : '');
const { chromium } = await import(PW_IMPORT);

// 开屏动画调试 dump：patch matchMedia → 验证 playTransformIntro 路径
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
    if (el && el.className === "mediascape-dsh-boot") window.__bootTrace.push("append-mediascape-dsh-boot@" + Date.now());
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
  hasBoot: !!document.querySelector(".mediascape-dsh-boot"),
  bodyChildren: document.body.children.length,
  classes: [...document.querySelectorAll("body > *")].map((e) => e.tagName + "." + (typeof e.className === "string" ? e.className : "")).join(" | "),
}));
console.log("[state]", JSON.stringify(state, null, 2));
await browser.close();
