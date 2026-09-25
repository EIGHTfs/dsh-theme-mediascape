import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
const reqs = {};
page.on('request', (r) => { const u = r.url(); if (/wallpaper\/1048|wallpaper\/list|boot\/boot.json/.test(u)) reqs[u] = (reqs[u] || 0) + 1; });
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const bootVid = window.__mediascapeDshBootVideo || null;
    const bgVid = document.querySelector('.mediascape-dsh-bg video');
    const bootOv = document.querySelector('.mediascape-dsh-boot');
    return {
      bootOverlay: !!bootOv,
      handoff: bootVid ? { id: bootVid.id, src: (bootVid.el.getAttribute('src') || '').split('/').pop(), tag: bootVid.el.tagName, cls: bootVid.el.className } : null,
      bgVideo: bgVid ? { src: (bgVid.getAttribute('src') || '').split('/').pop(), paused: bgVid.paused, t: bgVid.currentTime.toFixed(1), cls: bgVid.className } : null,
      sameElement: bootVid ? (bgVid === bootVid.el) : null,
    };
  });
  console.log(`[${label}] overlay=${s.bootOverlay} handoff=${JSON.stringify(s.handoff)} bg=${JSON.stringify(s.bgVideo)} sameEl=${s.sameElement}`);
};
await page.goto('http://127.0.0.1:30999/js/auto-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
await snap('t+1.5s 开屏播放中');
await page.waitForTimeout(3000);
await snap('t+4.5s 开屏结束(移交后)');
await page.waitForTimeout(2000);
await snap('t+6.5s 壁纸接管稳定');
console.log('请求统计:', JSON.stringify(reqs));
await browser.close();
console.log('DONE');
