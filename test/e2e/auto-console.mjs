import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('console', (m) => console.log('[' + m.type() + '] ' + m.text().slice(0, 160)));
await page.goto('http://127.0.0.1:30999/js/auto-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(7000);
await browser.close();
console.log('DONE');
