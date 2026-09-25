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
    return {
      boot: !!document.querySelector('.mediascape-dsh-boot'),
      mediaTag: media ? media.tagName : null,
      mediaSrc: media ? (media.getAttribute('src') || '').split('/').pop() : null,
      ready: media && media.tagName === 'VIDEO' ? (media.readyState >= 1 ? 'have-data' : 'load' + media.readyState) : null,
      logs: (window.__mediascapeTestLog || []).slice(-8),
    };
  });
  console.log(`[${label}] boot=${s.boot} media=${s.mediaTag} src=${s.mediaSrc} ${s.ready ? 'ready=' + s.ready : ''}`);
  return s;
};
await page.goto('http://127.0.0.1:30999/js/boot-shim-check.html', { waitUntil: 'domcontentloaded' });
// 立即（浮层已插、配置可能未回）—— 检查是否有页面错误
await page.waitForTimeout(300);
await snap('t+0.3s 立即');
await page.waitForTimeout(1200);
await snap('t+1.5s  配置取回后');
await page.waitForTimeout(2500);
await snap('t+4.0s  应切到视频');
// 看完整截图
await page.screenshot({ path: '/tmp/boot-check.png' });
await browser.close();
console.log('DONE');
