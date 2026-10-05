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
const page = await browser.newPage();
// 拦截 wallpaper/list，dump 返回内容
page.on('response', async (r) => {
  if (r.url().includes('wallpaper/list')) {
    console.log('LIST URL:', r.url());
    try { const j = await r.json(); console.log('LIST ITEMS:', JSON.stringify((j.items||[]).map(x=>({id:x.id,kind:x.kind,url:x.url})))); } catch(e){ console.log('list json err', e.message); }
  }
});
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
page.on('console', (m) => { if (m.text().includes('boot gif') || m.text().includes('auto') || m.text().includes('bootVideo')) console.log('CONSOLE:', m.text()); });
await page.goto('http://127.0.0.1:30999/js/auto-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(5500);
const s = await page.evaluate(() => {
  const bgVid = document.querySelector('.mediascape-dsh-bg video');
  return {
    lsVid: localStorage.getItem('mediascape-dsh-bg-vid-id'),
    lsVideoOn: localStorage.getItem('mediascape-dsh-bg-video-on'),
    currentVidId: window.__capturedFactory ? 'n/a' : 'n/a',
    bgSrc: bgVid ? (bgVid.getAttribute('src')||'') : null,
    handoff: window.__mediascapeDshBootVideo ? window.__mediascapeDshBootVideo.id : null,
  };
});
console.log('STATE:', JSON.stringify(s));
await browser.close();
