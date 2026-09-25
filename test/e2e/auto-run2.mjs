import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
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
