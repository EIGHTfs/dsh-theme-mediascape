// ── 环境自推导（公开插件可移植）：pwviewer / pwviewer-libs / fonts 为仓库邻居目录
// （<harness>/pwviewer 等），从本文件位置向上搜索；env 可覆盖：PW_ROOT / MS_CHROMELIBS / MS_FONTCONF /
// MS_CHROME / MS_BROWSERS / MS_PWIMPORT / MS_BASE。找不到时留空（浏览器测试需 env 提供）。
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
const BASE = process.env.MS_BASE || 'http://127.0.0.1:30999';

// ── 目标：量化"视频壁纸切换是否连贯"（间歇性问题的量化口径）───────────────────────────────
// 现象（用户实测）：切换**偶尔**不连贯，不是每次复发。
// 设计意图（lib/client-parts/scenes/wallpaper.js）：当前视频剩 VIDEO_PRELOAD_AHEAD_SEC(3s) 时预创建并缓冲
//   下一视频；`ended` 时若 `preloadedVid.url 相同 && readyState>=2` 则**复用同一元素** ⇒ 无缝无加载间隙。
// 因此"不连贯"的可测形态 = 该判据没满足（预载未就绪）⇒ 只能新建元素从头加载 ⇒ 出现出画延迟。
// 本测试重复 N 次"推到接近结尾 → 等切换"，记录：
//   · 每次 ended → 新视频出画面(timeupdate>0) 的间隔 ms
//   · 每次是否命中"复用预载"快路径（靠元素标识：复用的元素仍是同一个 DOM 节点）
// 判定：多数次应命中快路径且间隔很小；把分布打出来，便于抓"偶尔"那几次。
// 前置：预览服务在跑（同目录其它 e2e 同样假设 30999 起服务）。用 MS_BASE 覆盖地址。
// env：MS_ITER（重复次数，默认 5）｜MS_GAP_MS（单次间隔上限，默认 2500）
const ITER = Number(process.env.MS_ITER || 5);
const GAP_LIMIT = Number(process.env.MS_GAP_MS || 2500);
const LS_VIDEO_ON = 'mediascape-dsh-bg-video-on';   // 见 foundation/constants.js
const LS_VID_ID = 'mediascape-dsh-bg-vid-id';

let pass = 0, fail = 0, skipped = 0;
const ok = (cond, label, extra) => {
  if (cond) { pass++; console.log('  ✅ PASS ' + label); } else { fail++; console.log('  ❌ FAIL ' + label + (extra ? '  → ' + extra : '')); }
};
const skipAll = (why) => { skipped++; console.log('  ⏭️ SKIP ' + why); console.log('  结果: ' + pass + ' PASS / ' + fail + ' FAIL / ' + skipped + ' SKIP'); process.exit(0); };

if (!PW_ROOT || !exSync(CHROME)) skipAll('未找到 pwviewer/chromium（env: PW_ROOT / MS_CHROME）');
if (!MS_LIBS) skipAll('未找到 pwviewer-libs（env: MS_CHROMELIBS）');
const { chromium } = await import(process.env.MS_PWIMPORT || pURL(jn(PW_ROOT, 'node_modules', 'playwright', 'index.mjs')).href);

let browser;
try {
  browser = await chromium.launch({
    executablePath: CHROME,
    args: ['--no-sandbox', '--disable-gpu'],
    env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS },
  });
} catch (e) {
  skipAll('chromium 启动失败（' + String(e && e.message).split('\n')[0].slice(0, 80) + '）');
}
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const mediaRequests = [];
page.on('request', (r) => { if (/theme-mediascape-assets\/wallpaper\//.test(r.url())) mediaRequests.push({ url: decodeURIComponent(r.url()).split('/').pop(), range: r.headers()['range'] || '' }); });
page.on('response', (r) => {
  if (!/theme-mediascape-assets\/wallpaper\//.test(r.url())) return;
  const last = mediaRequests.filter((x) => x.url === decodeURIComponent(r.url()).split('/').pop()).slice(-1)[0];
  if (last) last.status = r.status();
});

// 1) 打开一次，取服务端壁纸列表里的第一个**视频**，写进 localStorage 打开视频层，再 reload
try {
  await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 30000 });
} catch (e) {
  await browser.close();
  skipAll('预览页打不开（' + BASE + '）：' + String(e && e.message).split('\n')[0].slice(0, 80));
}
const list = await page.evaluate(async () => {
  try { const r = await fetch('/theme-mediascape-assets/wallpaper/list'); return await r.json(); } catch (e) { return null; }
});
// 接口真实结构：{ ok, items:[{ id(标题,无扩展名), kind:"video"|"image", file, size, url, etag }] }
const vids = (list && (list.items || list.wallpapers || list.list || [])) || [];
const firstVideo = vids.find((v) => v && (v.kind === 'video' || /\.(mp4|webm)$/i.test(String(v.file || v.id || v.name || '')))) || null;
if (!firstVideo) { await browser.close(); skipAll('服务端壁纸列表里没有视频素材 ⇒ 无法验证切换'); }
await page.evaluate(([kOn, kVid, id]) => {
  localStorage.setItem(kOn, '1');
  localStorage.setItem(kVid, id);
}, [LS_VIDEO_ON, LS_VID_ID, String(firstVideo.id || firstVideo.name)]);
await page.reload({ waitUntil: 'domcontentloaded' });
console.log('  使用视频壁纸: ' + String(firstVideo.id || firstVideo.name).slice(0, 40) + ' …');

// 2) 等视频层在播
async function waitPlayingVideo(ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const st = await page.evaluate(() => {
      const v = document.querySelector('.mediascape-dsh-bg video');
      return v ? { ready: v.readyState, paused: v.paused, t: v.currentTime, d: v.duration } : null;
    });
    if (st && st.ready >= 2 && !st.paused) return st;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
const playing = await waitPlayingVideo(25000);
if (!playing) { await browser.close(); skipAll('25s 内没等到正在播放的视频壁纸（预览页未启用视频层？）'); }

// 3) 重复 N 次：推到接近结尾 → 记录 ended→出画面 的间隔与是否复用预载元素
const gaps = [];
for (let i = 0; i < ITER; i++) {
  const prepared = await page.evaluate(() => {
    const v = document.querySelector('.mediascape-dsh-bg video');
    if (!v || !isFinite(v.duration) || v.duration <= 4) return null;
    v.dataset.threadTag = 'A';                       // 标记当前元素（复用时新元素应仍是 A）
    window.__sw = { endedTs: 0, firstTs: 0, reused: null };
    if (!window.__swBound) {
      window.__swBound = true;
      document.addEventListener('ended', (e) => {
        const el = e.target;
        if (!el || el.tagName !== 'VIDEO') return;
        window.__sw.endedTs = performance.now();
        const prevTag = el.dataset.threadTag;
        const t = setInterval(() => {
          const nv = document.querySelector('.mediascape-dsh-bg video');
          if (nv && nv.currentTime > 0 && nv.readyState >= 2 && nv !== el) {
            window.__sw.firstTs = performance.now();
            window.__sw.reused = (nv.dataset.threadTag === prevTag); // 复用预载 ⇒ 同一节点（预载元素被挂载时带同一标记）
            clearInterval(t);
          } else if (nv && nv.currentTime > 0 && nv.readyState >= 2 && nv === el) {
            window.__sw.firstTs = performance.now(); window.__sw.reused = true; clearInterval(t);
          }
        }, 20);
      }, true);
    }
    v.currentTime = Math.max(0, v.duration - 2.5);
    return { d: Math.round(v.duration), tag: prevOf(v) };
    function prevOf(x) { return x.dataset.threadTag; }
  });
  if (!prepared) break;
  await new Promise((r) => setTimeout(r, 9000));
  const sw = await page.evaluate(() => window.__sw || {});
  if (sw.endedTs && sw.firstTs) {
    const gap = Math.round(sw.firstTs - sw.endedTs);
    gaps.push(gap);
    ok(gap <= GAP_LIMIT, '第 ' + (i + 1) + ' 次切换：出画面间隔 ' + gap + 'ms（≤' + GAP_LIMIT + '）', '是否复用预载=' + sw.reused);
  } else {
    ok(false, '第 ' + (i + 1) + ' 次切换：未观测到完整切换序列（ended→出画面）', JSON.stringify(sw));
  }
  await new Promise((r) => setTimeout(r, 1200));
}
if (gaps.length) {
  const sorted = [...gaps].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)];
  const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))];
  console.log('  间隔分布: ' + gaps.join(' / ') + ' ms（p50=' + p50 + ' p90=' + p90 + ' 最差=' + sorted[sorted.length - 1] + '）');
  console.log('  媒体请求数: ' + mediaRequests.length + '（含 Range 头 ' + mediaRequests.filter((x) => x.range).length + ' 条）');
}
await browser.close();
console.log('  结果: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exit(fail ? 1 : 0);
