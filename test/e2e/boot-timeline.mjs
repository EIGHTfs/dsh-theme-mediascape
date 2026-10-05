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
// 在页面里挂 MutationObserver 记录 .mediascape-dsh-boot 内状态变化
await page.addInitScript(() => {
  window.__marks = [];
  const t0 = performance.now();
  const mk = (n) => window.__marks.push({ t: Math.round((performance.now() - t0) * 10) / 10, n });
  window.__mk = mk;
  mk('脚本启动');
  const obs = new MutationObserver((muts) => {
    const ov = document.querySelector('.mediascape-dsh-boot');
    if (ov && !window.__ovSeen) { window.__ovSeen = true; mk('overlay插入'); }
    const v = ov && ov.querySelector('video');
    if (v && !window.__vidSeen) { window.__vidSeen = true; mk('video元素出现'); }
    const img = ov && ov.querySelector('img.mediascape-dsh-gif');
    if (img && !window.__imgSeen) { window.__imgSeen = true; mk('img元素出现'); }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
});
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('boot.json') || u.includes('wallpaper/list') || /wallpaper\/10(48|49)/.test(u)) {
    page.evaluate((n) => { if (window.__mk) window.__mk('REQ ' + n); }, u.split('/').pop()).catch(() => {});
  }
});
await page.goto('http://127.0.0.1:30999/js/boot-timeline.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const m = await page.evaluate(() => {
  const v = document.querySelector('.mediascape-dsh-boot video, .mediascape-dsh-bg video');
  return {
    marks: window.__marks || [],
    bootVid: !!(document.querySelector('.mediascape-dsh-boot video')),
    bgVid: !!(document.querySelector('.mediascape-dsh-bg video')),
    canplay: v ? (v.readyState >= 2) : false,
    cur: v ? v.currentTime.toFixed(2) : null,
  };
});
(m.marks || []).forEach((x) => console.log('+' + x.t + 'ms  ' + x.n));
console.log('bootVid=' + m.bootVid + ' bgVid=' + m.bgVid + ' canplay=' + m.canplay + ' cur=' + m.cur);
await browser.close();
console.log('DONE');