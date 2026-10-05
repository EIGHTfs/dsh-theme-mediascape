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

// 验证「重复 apply 声音叠加」修复：幂等清理会暂停+清空播放中的 video/audio（含独立 Audio 实例）
// playwright 实测（2026-09-2x）：重复 apply/热重载「声音叠加」修复验证——
// apply 幂等清理必须先停旧媒体再删元素：DOM remove() 不暂停 video/audio（移除后仍继续播放），
// 直接删容器会新旧声音叠加（开发中每次重新 build 实测 bug）。验证：
// ①旧 .mediascape-dsh-bg 容器被删除 ②其中播放中的 video 随清理消失 ③独立音乐 Audio（不在 DOM）
// 经 window.__mediascapeDshMusicAudio 引用被暂停并清空 src。运行前提同 ui-dock-upload-remove-check。
const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
});
const page = await browser.newPage();
let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  → ' + d : '')); if (!ok) fails++; };
try {
  await page.goto('about:blank');
  // 模拟「旧实例残留」：视频元素（播放中）+ 独立音乐 Audio（播放中）
  await page.evaluate(() => {
    const blob = URL.createObjectURL(new Blob(['fake-media'], { type: 'video/mp4' }));
    const bg = document.createElement('div');
    bg.className = 'mediascape-dsh-bg'; // 模拟真实壁纸容器（清理时整容器删 + 停其中媒体）
    document.body.appendChild(bg);
    const v = document.createElement('video');
    v.muted = true; v.src = blob; bg.appendChild(v); // 播放中（有 src）
    const a = new Audio(blob); a.muted = true;
    window.__mediascapeDshMusicAudio = a; // 独立音乐实例（不在 DOM）
  });
  // 执行 apply.js 1.4 幂等清理逻辑（真实代码副本）
  await page.evaluate(() => {
    const stopMedia = (root) => { if (!root) return; root.querySelectorAll('video, audio').forEach((m) => { try { m.pause(); m.removeAttribute('src'); m.load(); } catch (e) {} }); };
    document.querySelectorAll('.mediascape-dsh-boot, .mediascape-dsh-dock, .mediascape-dsh-bg, .mediascape-dsh-bg-panel, .mediascape-dsh-bg-picker, .mediascape-dsh-ms-picker, .mediascape-dsh-music-card, .mediascape-dsh-snd-menu, .mediascape-dsh-font-menu').forEach((el) => { stopMedia(el); el.remove(); });
    const a = window.__mediascapeDshMusicAudio; if (a) { try { a.pause(); a.removeAttribute('src'); a.load(); } catch (e) {} }
  });
  const after = await page.evaluate(() => {
    const v = document.querySelector('.mediascape-dsh-bg video');
    const a = window.__mediascapeDshMusicAudio;
    return { vGone: !v, bgGone: !document.querySelector('.mediascape-dsh-bg'), aPaused: a ? a.paused : null, aSrc: a ? a.src : null };
  });
  check('旧 .mediascape-dsh-bg 容器已删除', after.bgGone, JSON.stringify(after));
  check('旧 video 已随容器清理（无残留继续播放的媒体）', after.vGone, JSON.stringify(after));
  check('独立音乐 Audio 已暂停且清空 src（不叠加）', after.aPaused === true && after.aSrc === '', JSON.stringify(after));
  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
} finally { await browser.close(); }
process.exit(fails ? 1 : 0);
