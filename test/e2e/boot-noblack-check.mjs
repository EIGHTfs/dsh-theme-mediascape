import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const media = document.querySelector('.mediascape-dsh-boot .mediascape-dsh-gif');
    const boot = document.querySelector('.mediascape-dsh-boot');
    return { boot: !!boot, mediaTag: media ? media.tagName : null, mediaSrc: media ? (media.getAttribute('src') || '').split('/').pop() : null, bg: media ? getComputedStyle(media).backgroundColor : null, gone: boot ? boot.classList.contains('gone') : null };
  });
  console.log(`[${label}] boot=${s.boot} media=${s.mediaTag} src=${s.mediaSrc} bg=${s.bg} gone=${s.gone}`);
};
await page.goto('http://127.0.0.1:30999/js/boot-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(150);   // t+0.15s 立即插入（视频加载中通常黑框的时段）
await snap('t+0.15s 立即');
await page.waitForTimeout(250);
await snap('t+0.4s');
await page.waitForTimeout(1600);  // t=2.0s 已过 1s 图片段 → 切视频
await snap('t+2.0s');
await browser.close();
console.log('DONE');
