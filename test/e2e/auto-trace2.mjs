import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGE_ERROR:', e.message));
page.on('console', (m) => console.log('CONSOLE[' + m.type() + ']:', m.text().slice(0, 200)));
page.on('requestfailed', (r) => console.log('REQ_FAIL:', r.url()));
await page.goto('http://127.0.0.1:30999/js/auto-trace.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const st = await page.evaluate(() => ({
  factory: typeof window.__capturedFactory,
  trace: (window.__trace || []).slice(0, 12),
}));
console.log('factory:', st.factory);
st.trace.forEach((l) => console.log('  ' + l));
await browser.close();
console.log('DONE');
