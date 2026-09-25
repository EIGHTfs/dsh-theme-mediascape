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
    return { boot: !!boot, mediaTag: media ? media.tagName : null, mediaSrc: media ? (media.getAttribute('src') || '').split('/').pop() : null, gone: boot ? boot.classList.contains('gone') : null, logs: (window.__mediascapeTestLog || []).slice(-3) };
  });
  console.log(`[${label}] boot=${s.boot} media=${s.mediaTag} src=${s.mediaSrc} gone=${s.gone} | logs=${JSON.stringify(s.logs)}`);
};
await page.goto('http://127.0.0.1:30999/js/boot-check.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(300);   // t=0.3s 图片应已显示（1s 段内）
await snap('t+0.3s');
await page.waitForTimeout(1200);  // t=1.5s 图片应还在（1s 段未到 2s）
await snap('t+1.5s');
await page.waitForTimeout(700);   // t=2.2s 已过 1s 图片段 → 应切视频（3s 段中）
await snap('t+2.2s');
await page.waitForTimeout(2600);  // t=4.8s 视频段(3s)播完 → 自动淡出
await snap('t+4.8s');
await browser.close();
console.log('DONE');
