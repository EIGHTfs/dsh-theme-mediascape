import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('request', (r) => {
  const u = r.url();
  if (/wallpaper\/1048|wallpaper\/1049/.test(u)) console.log('[REQ t=' + (Date.now() % 1000000) + '] ' + u.split('/').pop() + ' range=' + (r.headers()['range'] || '-'));
});
page.on('console', (m) => { if (m.text().includes('wallpaper]') || m.text().includes('boot]')) console.log(m.text().slice(0,130)); });
await page.goto('http://127.0.0.1:30999/js/auto-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6500);
await browser.close();
console.log('DONE');
