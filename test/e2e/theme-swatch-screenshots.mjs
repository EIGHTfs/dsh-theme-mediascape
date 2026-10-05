// 配色盘预览三张完整截图（2026-09-26）：preview.html / 配色盘颜色区 / 配色盘胶囊区
// 产物：docs/screenshots/preview.png、docs/screenshots/配色盘-颜色区.png、docs/screenshots/配色盘-胶囊区.png
// 运行：node test/e2e/theme-swatch-screenshots.mjs（需 30999 预览在跑；MS_PREVIEW/MS_CHROME 可 env 覆盖）
import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
import { mkdirSync } from 'node:fs';

const CHROME = process.env.MS_CHROME || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/.pwviewer/browsers/chromium-1243/chrome-linux64/chrome';
const MS_LIBS = process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs';
const MS_FONTS = process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf';
const BASE = process.env.MS_PREVIEW || 'http://127.0.0.1:30999';
const OUT = process.env.MS_OUT_DIR || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/dsh-theme-mediascape/docs/screenshots';

mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
});
const page = await browser.newPage({ viewport: { width: 1560, height: 1000 } });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 150)));

try {
  // ① preview 完整截图（30999 根路径 = preview.html 内容；/preview.html 是 404）
  // 启动动画判定（复制自 test/e2e/boot-auto-video-handoff-check.mjs）：开屏容器 .mediascape-dsh-boot
  // 存在 = 动画播放中；.gone（opacity 0 + pointer-events none）/移除 = 动画结束
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.mediascape-dsh-boot', { timeout: 8000 }).catch(() => {});
  const bootState = await page.evaluate(() => {
    const boot = document.querySelector('.mediascape-dsh-boot');
    return { boot: !!boot, gone: !!(boot && boot.classList.contains('gone')), mediaReady: !!document.querySelector('.mediascape-dsh-boot .mediascape-dsh-gif.ready') };
  });
  if (bootState.boot && !bootState.gone) {
    // 等媒体就绪（开屏动画真正播放）后 1s 截图（用户定稿：启动动画播放 1s 后截）
    await page.waitForFunction(() => !!document.querySelector('.mediascape-dsh-boot .mediascape-dsh-gif.ready'), { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: OUT + '/preview-启动动画.png', fullPage: true });
    console.log('✓ preview-启动动画.png（开屏动画播放中，媒体就绪后 1s）');
  } else {
    console.log('  开屏未捕获（boot 缺失或已结束），跳过动画截图');
  }
  // 等动画结束（.gone 或元素移除）→ 加载完画面截图
  await page.waitForFunction(() => {
    const boot = document.querySelector('.mediascape-dsh-boot');
    if (!boot) return true;
    return boot.classList.contains('gone');
  }, { timeout: 20000 }).catch(() => console.log('  开屏 20s 未 gone（超时，仍截最终画面）'));
  await page.waitForTimeout(1200); // 壁纸层/主界面稳定
  await page.screenshot({ path: OUT + '/preview.png', fullPage: true });
  console.log('✓ preview.png（启动动画结束后的完整画面）');

  // ② 配色盘颜色区（默认 tab-palette）
  await page.goto(BASE + '/theme-swatch.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#pairList .comp-pair', { timeout: 20000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/配色盘-颜色区.png', fullPage: true });
  console.log('✓ 配色盘-颜色区.png');

  // ③ 配色盘胶囊区（切 tab-capsule）
  await page.evaluate(() => {
    const tab = document.querySelector('.tab[data-tab="capsule"]');
    if (tab) tab.click();
  });
  await page.waitForSelector('#capsuleList .capsule-row', { timeout: 15000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: OUT + '/配色盘-胶囊区.png', fullPage: true });
  console.log('✓ 配色盘-胶囊区.png');

  console.log('三张截图完成 ->', OUT);
} finally {
  await browser.close();
}