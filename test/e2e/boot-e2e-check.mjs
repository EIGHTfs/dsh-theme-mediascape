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
// 2026-10-09 修复：此处原先缺失赋值前缀，只留下孤儿三元 ⇒ 文件根本无法解析（SyntaxError: Unexpected token '?'），
//   该 e2e 从未真正跑起来过。按姊妹文件 theme-studio/tests/ms-boot-render-check.mjs 的同一写法补回。
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
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const media = document.querySelector('.mediascape-dsh-boot .mediascape-dsh-gif');
    return {
      boot: !!document.querySelector('.mediascape-dsh-boot'),
      mediaTag: media ? media.tagName : null,
      mediaSrc: media ? (media.getAttribute('src') || '').split('/').pop() : null,
      ready: media && media.tagName === 'VIDEO' ? (media.readyState >= 1 ? 'have-data' : 'load' + media.readyState) : null,
      logs: (window.__mediascapeTestLog || []).slice(-8),
    };
  });
  console.log(`[${label}] boot=${s.boot} media=${s.mediaTag} src=${s.mediaSrc} ${s.ready ? 'ready=' + s.ready : ''}`);
  return s;
};
await page.goto('http://127.0.0.1:30999/js/boot-shim-check.html', { waitUntil: 'domcontentloaded' });
// 立即（浮层已插、配置可能未回）—— 检查是否有页面错误
await page.waitForTimeout(300);
await snap('t+0.3s 立即');
await page.waitForTimeout(1200);
await snap('t+1.5s  配置取回后');
await page.waitForTimeout(2500);
await snap('t+4.0s  应切到视频');
// 看完整截图
await page.screenshot({ path: '/tmp/boot-check.png' });
await browser.close();
console.log('DONE');
