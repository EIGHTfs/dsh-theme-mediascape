// playwright 截图（2026-09-2x）：dock 与每个二级面板单独截图 → docs/screenshots/（入库，README 配图素材）。
// 截图清单：dock（收起态）→ 字/景/声/乐/传 五个二级面板展开态 → 景选择壁纸、乐歌单两个深度面板。
// 运行前提：headless chromium + 运行库 + CJK 字体（LD_LIBRARY_PATH / FONTCONFIG_FILE 均可环境变量覆盖，
// 默认值指向 /volume1/VirtualDSM/DeepSeekHarness/ 下的持久副本——见 README「theme-studio/ 预览环境」）。
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.MS_BROWSERS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers';
const { chromium } = await import('file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs');
import { mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const CHROME = process.env.MS_CHROME || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/.pwviewer/browsers/chromium-1243/chrome-linux64/chrome';
const MS_LIBS = process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs';
const MS_FONTS = process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf';
const BASE = process.env.MS_PREVIEW || 'http://127.0.0.1:30999';
const SHOT_DIR = process.env.MS_SHOT_DIR || join(process.cwd(), 'docs', 'screenshots');

// 截图计划：toggle 选择器 → 面板名（存盘文件名，中文名便于 README 引用）
const PLAN = [
  ['dock 收起态（无 toggle）', 'dock'],
  ['button.mediascape-dsh-font-toggle', 'panel-字'],
  ['button.mediascape-dsh-bg-toggle', 'panel-景'],
  ['button.mediascape-dsh-snd-toggle', 'panel-声'],
  ['button.mediascape-dsh-music-toggle', 'panel-乐'],
  ['button.mediascape-dsh-upload-toggle', 'panel-传'],
];

mkdirSync(SHOT_DIR, { recursive: true });
for (const f of readdirSync(SHOT_DIR)) { try { rmSync(join(SHOT_DIR, f), { force: true }); } catch {} }

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? ' → ' + d : '')); if (!ok) fails++; };

try {
  await page.goto(BASE + '/?mode=full', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('button.mediascape-dsh-upload-toggle', { timeout: 20000 });
  console.log('dock 已渲染');
  await wait(800); // 等壁纸/开屏等初始动画落定再截 dock

  const snap = async (name) => {
    const p = join(SHOT_DIR, name + '.png');
    await page.screenshot({ path: p });
    check(`截图 ${name}.png`, true);
  };

  // 1) dock 收起态
  await snap('dock');

  // 2) 五个二级面板：点 toggle 展开 → 截图 → 再点收起
  for (const [sel, name] of PLAN.slice(1)) {
    await page.click(sel);
    await wait(700); // 面板展开动画
    await snap(name);
    await page.click(sel); // 收起，避免影响下一张
    await wait(400);
  }

  // 3) 深度面板：景→选择壁纸、乐→选择歌单
  await page.click('button.mediascape-dsh-bg-toggle');
  await wait(600);
  const bgPick = await page.$('button.mediascape-dsh-bg-pick');
  if (bgPick) { await bgPick.click(); await wait(600); await snap('panel-景-选择壁纸'); await page.click('button.mediascape-dsh-bg-toggle'); }
  await wait(400);
  await page.click('button.mediascape-dsh-music-toggle');
  await wait(600);
  const msSel = await page.$('[data-act="select"]');
  if (msSel) { await msSel.click(); await wait(600); await snap('panel-乐-选择歌单'); await page.click('button.mediascape-dsh-music-toggle'); }

  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
} catch (e) {
  console.log('脚本异常:', String(e).slice(0, 300));
  fails++;
} finally {
  await context.close();
  await browser.close();
}
process.exit(fails ? 1 : 0);
