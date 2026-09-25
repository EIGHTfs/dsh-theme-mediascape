import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
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
