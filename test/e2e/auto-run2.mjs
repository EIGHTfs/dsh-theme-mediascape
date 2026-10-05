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

const browser = await chromium.launch({
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
  executablePath: CHROME,
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
const reqs = {};
page.on('request', (r) => { const u = r.url(); if (/wallpaper\/1048|wallpaper\/list/.test(u)) reqs[u] = (reqs[u] || 0) + 1; });
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const bootVid = window.__mediascapeDshBootVideo;
    const pending = window.__mediascapeDshBootVideoPending;
    const bgVid = document.querySelector('.mediascape-dsh-bg video');
    return {
      pending: pending || null,
      handoff: bootVid ? bootVid.id : null,
      bg: bgVid ? { src: (bgVid.getAttribute('src') || '').split('/').pop(), paused: bgVid.paused, t: bgVid.currentTime.toFixed(1) } : null,
      sameEl: bootVid ? (bgVid === bootVid.el) : null,
      lsVid: localStorage.getItem('mediascape-dsh-bg-vid-id'),
    };
  });
  console.log(`[${label}] pending=${s.pending && s.pending.id} handoff=${s.handoff} bg=${s.bg ? s.bg.src + '@' + s.bg.t + 's paused=' + s.bg.paused : '无'} same=${s.sameEl} ls=${s.lsVid}`);
};
await page.goto('http://127.0.0.1:30999/js/auto-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await snap('t+0.8s 开屏播放中');
await page.waitForTimeout(3200);
await snap('t+4.0s 开屏结束');
await page.waitForTimeout(2000);
await snap('t+6.0s 壁纸接管后');
console.log('请求统计:', JSON.stringify(reqs));
await browser.close();
console.log('DONE');
