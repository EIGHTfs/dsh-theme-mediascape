import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
const reqs = {};
page.on('request', (r) => { const u = r.url(); if (/wallpaper\/10(48|49)/.test(u)) reqs[u.split('/').pop()] = (reqs[u.split('/').pop()] || 0) + 1; });
const snap = async (label) => {
  const s = await page.evaluate(() => {
    const bootVid = window.__mediascapeDshBootVideo;
    const bgVid = document.querySelector('.mediascape-dsh-bg video');
    return {
      handoff: bootVid ? bootVid.id : null,
      bg: bgVid ? { src: (bgVid.getAttribute('src') || '').split('/').pop(), t: bgVid.currentTime.toFixed(1), paused: bgVid.paused } : null,
      sameEl: bootVid ? (bgVid === bootVid.el) : null,
      ls: localStorage.getItem('mediascape-dsh-bg-vid-id'),
    };
  });
  console.log(`[${label}] handoff=${s.handoff} bg=${s.bg ? s.bg.src + '@' + s.bg.t + 's p=' + s.bg.paused : '无'} same=${s.sameEl} ls=${s.ls}`);
};
await page.goto('http://127.0.0.1:30999/js/boot-auto-final.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
await snap('t+1s 开屏中');
await page.waitForTimeout(3500);
await snap('t+4.5s 开屏结束');
await page.waitForTimeout(1500);
await snap('t+6s 壁纸接管');
console.log('1048/1049 请求:', JSON.stringify(reqs));
await browser.close();
console.log('DONE');
