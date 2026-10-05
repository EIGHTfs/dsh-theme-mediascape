#!/usr/bin/env node
// 插件启动时间排序（参数化，无硬编码绝对路径）——
// 测量 DSH 页面加载时各 /plugins/ 分组请求的资源耗时（TTFB+传输，Performance Resource Timing），
// 按耗时从高到低输出 Top N。DSH 将插件 client.js 按组分批加载（一个 /plugins/??... 请求含多个插件），
// 该请求耗时即该组插件的「网络加载+排队」耗时近似；单插件精确初始化耗时需 DSH 侧内部计时（脚本标注口径）。
//
// 用法（所有路径参数均可被命令行 --xxx 或同名环境变量覆盖；不传时尝试相对探测）：
//   node test/e2e/plugin-startup-times.mjs --url <DSH入口> [--top 5] [--wait 6000]
//                          [--pw <playwright index.mjs>] [--chrome <chromium可执行>]
//                          [--libs <LD_LIBRARY_PATH>] [--fonts <fonts.conf>]
//   --url    DSH 入口（必传，如 http://host:30800；自动走 302+token 认证）
//   --top    输出前 N 名（默认 5）        --wait  页面加载后采样等待 ms（默认 6000）
//   --pw     playwright 入口（环境变量 DSH_PW）；默认相对探测：<repoRoot>/.pwviewer/node_modules/playwright/index.mjs
//   --chrome chromium 可执行（DSH_CHROME）；默认相对探测：<repoRoot>/.pwviewer/browsers/chromium-*/chrome
//   --libs   运行库目录（附加进 LD_LIBRARY_PATH，DSH_LIBS）
//   --fonts  Fontconfig 配置（FONTCONFIG_FILE，DSH_FONTS_CONF）
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const pick = (name, def) => {
  const i = args.indexOf('--' + name);
  if (i >= 0 && args[i + 1]) return args[i + 1];
  return process.env[({ pw: 'DSH_PW', chrome: 'DSH_CHROME', libs: 'DSH_LIBS', fonts: 'DSH_FONTS_CONF' }[name] || '')] || (def ?? '');
};
const pickInt = (name, def) => {
  const v = parseInt(pick(name, String(def)), 10);
  return Number.isFinite(v) && v > 0 ? v : def;
};
const repoRoot = new URL('../..', import.meta.url).pathname; // <repoRoot>/（脚本在 <repoRoot>/test/e2e/）

// 相对探测：.pwviewer 下的 playwright/chromium（与运行环境解耦，换机只需目录随项目走）
const pwPath = pick('pw', '') || (() => {
  const p = `${repoRoot}.pwviewer/node_modules/playwright/index.mjs`;
  return existsSync(p) ? p : '';
})();
const chromePath = pick('chrome', '') || (() => {
  const base = `${repoRoot}.pwviewer/browsers`;
  if (!existsSync(base)) return '';
  for (const name of readdirSync(base)) {
    const cand = `${base}/${name}/chrome-linux64/chrome`;
    if (existsSync(cand)) return cand;
  }
  return '';
})();

if (!pwPath) { console.error('未找到 playwright 入口：传 --pw 或设置 DSH_PW（默认探测 <repoRoot>/.pwviewer/node_modules）'); process.exit(1); }
if (!chromePath) { console.error('未找到 chromium：传 --chrome 或设置 DSH_CHROME（默认探测 <repoRoot>/.pwviewer/browsers）'); process.exit(1); }

const TARGET = pick('url', '');
if (!TARGET) { console.error('必须传 --url <DSH入口> 或设置 DSH_URL'); process.exit(1); }
const TOP = pickInt('top', 5);
const WAIT = pickInt('wait', 6000);
const LIBS = pick('libs', '');
const FONTS = pick('fonts', '');

const { chromium } = await import(pwPath.startsWith('file://') ? pwPath : `file://${pwPath}`);
import { execSync } from 'node:child_process';

// 认证（同预览服务流程）：GET / → 302 token → 带 token 拿 dsh-auth cookie
function authCookie(base) {
  const loc = execSync(`curl -s -m 5 -D - -o /dev/null "${base}/"`).toString();
  const t = (loc.match(/token=[A-Za-z0-9_-]+/) || [])[0];
  if (!t) return '';
  const resp = execSync(`curl -s -m 5 -D - -o /dev/null "${base}/?${t}"`).toString();
  return (resp.match(/dsh-auth-[^;]*/) || [''])[0];
}

const browserEnv = {
  ...process.env,
  ...(LIBS ? { LD_LIBRARY_PATH: LIBS } : {}),
  ...(FONTS ? { FONTCONFIG_FILE: FONTS } : {}),
};
const browser = await chromium.launch({
  executablePath: chromePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: browserEnv,
});
const ctx = await browser.newContext();
const cookie = authCookie(TARGET);
if (cookie) {
  await ctx.addCookies([{ name: cookie.split('=')[0], value: cookie.split('=').slice(1).join('='), url: TARGET }]);
}
// 长任务收集：主线程解析/执行阻塞（聚合 JS 解析 + 各插件 apply 的「启动」大头，resource timing 测不到）
await ctx.addInitScript(() => {
  window.__longTasks = [];
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__longTasks.push({ s: Math.round(e.startTime), d: Math.round(e.duration) });
    }).observe({ entryTypes: ['longtask'] });
  } catch (e) { /* longtask 不支持可忽略 */ }
});
const page = await ctx.newPage();
try {
  const tStart = Date.now();
  await page.goto(TARGET, { waitUntil: 'domcontentloaded', timeout: 60000 });
  // 采样开屏出现时间（goto 返回后到 .mediascape-dsh-boot 出现）
  let bootAt = -1;
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 200));
    const hasBoot = await page.evaluate(() => !!document.querySelector('.mediascape-dsh-boot'));
    if (hasBoot) { bootAt = Date.now() - tStart; break; }
  }
  await new Promise((r) => setTimeout(r, WAIT));
  const rows = await page.evaluate(() =>
    performance.getEntriesByType('resource')
      .filter((e) => e.name.includes('/plugins/'))
      .map((e) => ({
        url: e.name,
        start: Math.round(e.startTime),
        ttfb: Math.round(e.responseStart - e.requestStart),
        total: Math.round(e.duration),
        size: Number(e.transferSize || 0),
      }))
  );
  const byUrl = new Map();
  for (const r of rows) {
    const k = r.url.replace(/\?.*$/, '').split('/plugins/')[1]?.slice(0, 70) || r.url.slice(0, 70);
    const prev = byUrl.get(k);
    if (!prev || r.total > prev.total) byUrl.set(k, { ...r, key: k });
  }
  const sorted = [...byUrl.values()].sort((a, b) => b.total - a.total).slice(0, TOP);
  const netTotal = byUrl.values().reduce((s2, r) => s2 + r.total, 0);
  const longTasks = await page.evaluate(() => window.__longTasks || []);
  const ltCount = longTasks.length;
  const ltTotal = longTasks.reduce((s2, e) => s2 + e.d, 0);
  const ltMax = longTasks.reduce((m, e) => Math.max(m, e.d), 0);
  console.log(`\n=== 插件分组加载耗时（网络传输）Top ${TOP}（${TARGET}，共 ${byUrl.size} 个 /plugins/ 分组请求）===\n`);
  sorted.forEach((r, i) => {
    const plugins = r.key.replace(/^@deepseek-ai\//, '').split(',@');
    console.log(`${String(i + 1).padStart(2)}. ${String(r.total).padStart(6)}ms (TTFB ${r.ttfb}ms, ${(r.size / 1024).toFixed(0)}KB, ${plugins.length} 插件)  ${plugins[0]}`);
  });
  if (!sorted.length) console.log('未采集到 /plugins/ 资源（页面未加载/认证失败）');
  console.log(`\n=== 启动时间构成（网络之外的大头 = JS 解析+执行，resource timing 测不到）===\n`);
  console.log(`开屏出现（goto 起）: ${bootAt > 0 ? bootAt + 'ms' : '未检测到'}`);
  console.log(`聚合 JS 网络传输合计: ${netTotal}ms`);
  console.log(`主线程长任务（>50ms 阻塞）: ${ltCount} 个，合计 ${ltTotal}ms，最大 ${ltMax}ms —— 聚合 JS 解析+各插件 apply 的启动主体`);
} finally {
  await browser.close();
}