import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// 在页面里挂 MutationObserver 记录 .mediascape-dsh-boot 内状态变化
await page.addInitScript(() => {
  window.__marks = [];
  const t0 = performance.now();
  const mk = (n) => window.__marks.push({ t: Math.round((performance.now() - t0) * 10) / 10, n });
  window.__mk = mk;
  mk('脚本启动');
  const obs = new MutationObserver((muts) => {
    const ov = document.querySelector('.mediascape-dsh-boot');
    if (ov && !window.__ovSeen) { window.__ovSeen = true; mk('overlay插入'); }
    const v = ov && ov.querySelector('video');
    if (v && !window.__vidSeen) { window.__vidSeen = true; mk('video元素出现'); }
    const img = ov && ov.querySelector('img.mediascape-dsh-gif');
    if (img && !window.__imgSeen) { window.__imgSeen = true; mk('img元素出现'); }
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
});
page.on('request', (r) => {
  const u = r.url();
  if (u.includes('boot.json') || u.includes('wallpaper/list') || /wallpaper\/10(48|49)/.test(u)) {
    page.evaluate((n) => { if (window.__mk) window.__mk('REQ ' + n); }, u.split('/').pop()).catch(() => {});
  }
});
await page.goto('http://127.0.0.1:30999/js/boot-timeline.html', { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(3000);
const m = await page.evaluate(() => {
  const v = document.querySelector('.mediascape-dsh-boot video, .mediascape-dsh-bg video');
  return {
    marks: window.__marks || [],
    bootVid: !!(document.querySelector('.mediascape-dsh-boot video')),
    bgVid: !!(document.querySelector('.mediascape-dsh-bg video')),
    canplay: v ? (v.readyState >= 2) : false,
    cur: v ? v.currentTime.toFixed(2) : null,
  };
});
(m.marks || []).forEach((x) => console.log('+' + x.t + 'ms  ' + x.n));
console.log('bootVid=' + m.bootVid + ' bgVid=' + m.bgVid + ' canplay=' + m.canplay + ' cur=' + m.cur);
await browser.close();
console.log('DONE');