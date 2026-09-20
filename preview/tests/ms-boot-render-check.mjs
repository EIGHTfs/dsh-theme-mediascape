// 开屏动画 json 配置化验证（两部分）：
//  A) 真实渲染路径：boot-test.html（无预览垫片、强制 no-preference）→ .ff-boot 出现 + img src 正确
//  B) 配置读取/免 build：HTTP 页面 runtime fetch GIF/boot.json → 改 durationMs 后页面拿到新值
import { chromium } from "/volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs";
import { readFileSync, writeFileSync } from "node:fs";

const CHROME = "/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell";
const BASE = "http://127.0.0.1:30999";
const HOST_PAGE = "file:///volume1/VirtualDSM/DeepSeekHarness/工作区/dsh-theme-mediascape/preview/tests/boot-test.html";
const BOOT_JSON = "/volume1/VirtualDSM/DeepSeekHarness/工作区/dsh-theme-mediascape/GIF/boot.json";
const OUT = [];
function log(tag, ok, msg) { OUT.push(`${ok ? "PASS" : "FAIL"} [${tag}] ${msg}`); console.log(`${ok ? "PASS" : "FAIL"} [${tag}] ${msg}`); }

const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"] });

// ── A) 开屏真实渲染（file:// 宿主，fetch 失败回退 GIF_DATA 仍应渲染）──
{
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(HOST_PAGE, { waitUntil: "domcontentloaded" });
  const boot = await page.waitForSelector(".ff-boot", { timeout: 8000 }).catch(() => null);
  log("A-boot-rendered", !!boot, boot ? "开屏 .ff-boot 已渲染" : "开屏未出现");
  if (boot) {
    const src = await page.$eval(".ff-boot img.ff-gif", (el) => el.src).catch(() => "");
    const title = await page.$eval(".ff-boot .ff-title", (el) => el.textContent).catch(() => "");
    log("A-boot-src", src.includes("4bfecb05"), `img src=${src}`);
    log("A-boot-title", title.includes("FIREFLY"), `title=${title}`);
    await page.click(".ff-skip").catch(() => {});
    await page.waitForTimeout(900);
    const gone = (await page.$(".ff-boot")) === null;
    log("A-boot-skip", gone, "点击跳过可关闭开屏");
  }
  log("A-no-error", errors.length === 0, errors.length ? errors.join(" | ") : "无控制台错误");
  await page.close();
}

// ── B) 配置读取 + 改配置免 build 生效（HTTP 预览页内 runtime fetch）──
{
  const page = await browser.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const readCfg = async () => page.evaluate(async () => {
    const r = await fetch("/theme-mediascape-assets/GIF/boot.json");
    const c = await r.json();
    return { ok: r.ok, file: c.file, dur: c.durationMs };
  });
  const cfg1 = await readCfg();
  log("B-fetch-config", !!cfg1.ok && !!cfg1.file && cfg1.dur === 10000, `默认配置 file=${cfg1.file} dur=${cfg1.dur}`);

  // 改 durationMs → 页面重新 fetch 即拿新值（免 rebuild 证明）
  const orig = readFileSync(BOOT_JSON, "utf8");
  writeFileSync(BOOT_JSON, JSON.stringify({ ...JSON.parse(orig), durationMs: 1234 }));
  const cfg2 = await readCfg();
  log("B-config-no-rebuild", cfg2.dur === 1234, `改 durationMs=1234 后页面 fetch 即拿到新值（免 rebuild）`);
  writeFileSync(BOOT_JSON, orig); // 恢复原配置
  const cfg3 = await readCfg();
  log("B-config-restored", cfg3.dur === 10000, "原配置已恢复");
  await page.close();
}

await browser.close();
const fails = OUT.filter((l) => l.startsWith("FAIL"));
console.log(`\n=== ${OUT.length - fails.length}/${OUT.length} PASS ===`);
process.exit(fails.length ? 1 : 0);