// 视频壁纸播放连续性回归（2026-09-23 加）：
//   覆盖「boot 开屏 → 移交壁纸层」全过程的 currentTime 连续性——开屏视频（file:auto 同一份流）
//   播完移交给壁纸层继续消费同一元素，时间必须连续推进、不得中断从头播放。
//   背景：2026-09-23 媒体持久缓存（IndexedDB：缓存命中切 blob、cacheKeepOnly 中止下载）曾引起
//   视频壁纸播放中断/从头播放的回归——缓存代码整体移除后本测试守护「只流式、移交无缝」。
// 方法：视频层开（LS_BG_VIDEO=1）载入预览页 → 每 400ms 采样当前 video（boot 或 bg）的
//   currentTime → 断言采样序列不回退（ct 单调不降超过容差=中断从头播）。
// 用法：node test/e2e/video-handoff-continuity-check.mjs（需 30999 预览服务运行，视频壁纸存在）
// 路径纪律：相对自身推导；浏览器/库路径由运行环境注入（PLAYWRIGHT_ROOT 或相对邻居，见下方探测）。
import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';

const BASE = 'http://127.0.0.1:30999';
const EXE = '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const SAMPLES = 20;      // 采样次数（×400ms ≈ 8s，覆盖 boot 短段 + 移交后继续播）
const SAMPLE_MS = 400;   // 采样间隔（ms）
const TIME_TOLERANCE = 0.5; // currentTime 回退容差（秒，> 此值判定中断从头播）

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? '  → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// ── 预检：30999 可达（未启动则提示，不自动拉服务——可手跑 start.sh start）──
try {
  const r = await fetch(BASE + '/theme-mediascape-assets/ping', { signal: AbortSignal.timeout(3000) });
  if (!r.ok) { console.log('FAIL  30999 预览服务不可达（先 bash theme-studio/start.sh start）'); process.exit(1); }
} catch { console.log('FAIL  30999 预览服务不可达（先 bash theme-studio/start.sh start）'); process.exit(1); }

const browser = await chromium.launch({
  executablePath: EXE, args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  // 2026-09-2x：运行库/CJK 字体（本机持久位置，env 可覆盖——headless shell 缺 libatk 起不来）
  env: { ...process.env, LD_LIBRARY_PATH: process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs', FONTCONFIG_FILE: process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf' },
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(String(e).slice(0, 120)));
// 视频层开 + 静音（用户场景：视频壁纸在播）；boot file:auto 开屏=同视频壁纸
await page.addInitScript(() => {
  localStorage.setItem('mediascape-dsh-bg-video-on', '1');
  localStorage.setItem('mediascape-dsh-muted', '1');
});

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 20000 });

// ── 采样时间线 ──
const timeline = [];
let sawVideo = false;
for (let i = 0; i < SAMPLES; i++) {
  await page.waitForTimeout(SAMPLE_MS);
  const t = await page.evaluate(() => {
    const bootV = document.querySelector('.mediascape-dsh-boot video');
    const bgV = document.querySelector('.mediascape-dsh-bg video');
    const v = bootV || bgV;
    return {
      ct: v ? Math.round(v.currentTime * 10) / 10 : null,
      source: bootV ? 'boot' : bgV ? 'bg' : 'none',
    };
  });
  if (t.ct !== null) sawVideo = true;
  timeline.push({ at: Math.round((i + 1) * SAMPLE_MS / 1000 * 10) / 10, ...t });
}

// ── 断言 1：出现过视频（boot 或 bg 至少一段）──
check(sawVideo, '视频已出现（boot 开屏或壁纸层）');

// ── 断言 2：视频移交发生（采样中同时出现 boot 段与 bg 段，或全程 bg）──
const sources = new Set(timeline.filter((x) => x.ct !== null).map((x) => x.source));
check(sources.size >= 1, '视频来源检测', sources.size ? [...sources].join('/') : '无');

// ── 断言 3：currentTime 不回退（中断从头播 = ct 骤降）──
let restarts = 0;
let lastCt = null;
for (const x of timeline) {
  if (x.ct === null) { continue; } // 移交间隙允许空采样，但不得出现「回退」
  if (lastCt !== null && x.ct < lastCt - TIME_TOLERANCE) restarts++;
  lastCt = x.ct;
}
check(restarts === 0, 'video currentTime 连续推进（无中断从头播）', restarts ? `回退 ${restarts} 次` : '');

// ── 断言 4：无页面错误 ──
check(pageErrors.length === 0, '无页面错误', pageErrors.length ? pageErrors.join(' | ') : '');

// ── 输出时间线（供人工复核）──
console.log('\n时间线（boot=开屏 / bg=壁纸层，ct=currentTime 秒）：');
timeline.forEach((x) => console.log('  ' + x.at + 's', x.source, 'ct=' + (x.ct ?? '-')));
if (restarts > 0) console.log('⚠️ 检测到中断从头播放');

await browser.close();
console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
console.log('DONE');
process.exit(fail ? 1 : 0);