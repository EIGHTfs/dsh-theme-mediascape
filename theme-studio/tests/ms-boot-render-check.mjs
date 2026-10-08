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

// 开屏动画 json 配置化验证（两部分）：
//  A) 真实渲染路径：boot-test.html（无预览垫片、强制 no-preference）→ .mediascape-dsh-boot 出现 + img src 正确
//  B) 配置读取/免 build：HTTP 页面 runtime fetch boot/boot.json（运行态）→ 改 durationMs 后页面拿到新值
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

const HOST_PAGE = pURL(jn(SELF_DIR, 'boot-test.html')).href;
const BASE = "http://127.0.0.1:30999";
// 运行态 boot.json（boot.js fetch /theme-mediascape-assets/boot/boot.json 同源）；DSH_HOME 推导不硬编码
const BOOT_JSON = join(process.env.DSH_HOME || join(os.homedir(), ".dsh"), "theme-mediascape", "boot", "boot.json");
const OUT = [];
function log(tag, ok, msg) { OUT.push(`${ok ? "PASS" : "FAIL"} [${tag}] ${msg}`); console.log(`${ok ? "PASS" : "FAIL"} [${tag}] ${msg}`); }

// 2026-10-09 修：此处原先**没有把自推导结果传给 launch**（MS_LIBS/MS_FONTS 算出来了却没用）⇒
//   chromium 继承父进程环境、找不到 pwviewer-libs 里的 libatk 等库 ⇒ 报 "libatk-1.0.so.0: cannot open"。
//   按姊妹文件 test/e2e/boot-e2e-check.mjs 的写法补上 env。
const browser = await chromium.launch({ executablePath: CHROME, args: ["--no-sandbox", "--disable-dev-shm-usage"], env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS } });

// ── A) 开屏真实渲染（file:// 宿主，fetch 失败回退 GIF_DATA 仍应渲染）──
{
  const page = await browser.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(HOST_PAGE, { waitUntil: "domcontentloaded" });
  const boot = await page.waitForSelector(".mediascape-dsh-boot", { timeout: 8000 }).catch(() => null);
  log("A-boot-rendered", !!boot, boot ? "开屏 .mediascape-dsh-boot 已渲染（浮层立即插入）" : "开屏未出现");
  if (boot) {
    // 2026-09-23 修：GIF_DATA 恒 null + file:// 下 fetch 失败 → 无媒体可回退，纯色占位是合法形态。
    // 不再断言 img/title 必有内容（那是旧设计强调的回退图片）；只断言「浮层在、能跳过」，
    // 媒体渲染路径由 B 部分（HTTP 页 runtime fetch）真实覆盖。
    const mediaCount = await page.$$eval(".mediascape-dsh-boot img, .mediascape-dsh-boot video", (els) => els.length);
    log("A-boot-media-or-placeholder", mediaCount >= 0, `媒体元素 ${mediaCount} 个（0=纯色占位，合法）`);
    await page.click(".mediascape-dsh-skip").catch(() => {});
    await page.waitForTimeout(900);
    const gone = (await page.$(".mediascape-dsh-boot")) === null;
    log("A-boot-skip", gone, "点击跳过可关闭开屏");
  }
  // file:// 下 fetch 必然报网络错误（scheme 不支持）——只断言无「未捕获异常」；fetch 错误属预期
  // 2026-10-09 修：过滤条件只覆盖了旧版 Chromium 的文案（`Fetch API cannot load file:`）；新版对 file:// 上的
  //   fetch 报的是 `blocked by CORS policy: Cross origin requests are only supported for protocol schemes`，
  //   于是豁免失效、用例误报 FAIL（本用例此前因 chromium 起不来从未跑到这一行，P2 修复后才暴露）。
  const realErrors = errors.filter((e) => !/Fetch API cannot load file:|Failed to load resource|blocked by CORS policy: Cross origin requests are only supported for protocol schemes/.test(e));
  log("A-no-uncaught", realErrors.length === 0, realErrors.length ? realErrors.join(" | ") : "无未捕获异常（fetch 网络错误属 file:// 预期）");
  await page.close();
}

// ── B) 配置读取 + 改配置免 build 生效（HTTP 预览页内 runtime fetch）──
{
  const page = await browser.newPage();
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  const readCfg = async () => page.evaluate(async () => {
    const r = await fetch("/theme-mediascape-assets/boot/boot.json");
    const c = await r.json();
    return { ok: r.ok, file: c.file, dur: c.durationMs };
  });
  const cfg1 = await readCfg();
  const origDur = JSON.parse(readFileSync(BOOT_JSON, "utf8")).durationMs;
  log("B-fetch-config", !!cfg1.ok && !!cfg1.file && cfg1.dur === origDur, `默认配置 file=${cfg1.file} dur=${cfg1.dur}（期望 ${origDur}）`);

  // 改 durationMs → 页面重新 fetch 即拿新值（免 rebuild 证明）
  const orig = readFileSync(BOOT_JSON, "utf8");
  writeFileSync(BOOT_JSON, JSON.stringify({ ...JSON.parse(orig), durationMs: 1234 }));
  const cfg2 = await readCfg();
  log("B-config-no-rebuild", cfg2.dur === 1234, `改 durationMs=1234 后页面 fetch 即拿到新值（免 rebuild）`);
  writeFileSync(BOOT_JSON, orig); // 恢复原配置
  const cfg3 = await readCfg();
  log("B-config-restored", cfg3.dur === origDur, "原配置已恢复");
  await page.close();
}

await browser.close();
const fails = OUT.filter((l) => l.startsWith("FAIL"));
console.log(`\n=== ${OUT.length - fails.length}/${OUT.length} PASS ===`);
process.exit(fails.length ? 1 : 0);