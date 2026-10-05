// 配色盘 jscolor 调色盘交互验证（2026-09-26 新增）：
// ①右格调色盘改用 jscolor 后，验证 pick-col 挂载了 jscolor 实例
// ②点击右格第 4 列色块（chip2）→ jscolor 弹层（.jscolor-wrap/.jscolor-picker）呼出可见
// ③jscolor 选色（fromString 模拟）触发 input 事件 → RIGHTCOLOR/色块联动（事件链不断）
// 只读验证（不写盘不污染真源）；运行环境 chromium/运行库/CJK 字体路径可 env 覆盖。
import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';

const CHROME = process.env.MS_CHROME || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/.pwviewer/browsers/chromium-1243/chrome-linux64/chrome';
const MS_LIBS = process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs';
const MS_FONTS = process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf';
const BASE = process.env.MS_PREVIEW || 'http://127.0.0.1:30999';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  → ' + d : '')); if (!ok) fails++; };

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
});
const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 150)));

try {
  await page.goto(BASE + '/theme-swatch.html', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('#pairList .comp-pair', { timeout: 20000 });

  // ① jscolor 实例挂载（pick-col.jscolor 存在 + 是实例）
  const instState = await page.evaluate(() => {
    const pick = document.querySelector('#pairList .comp-pair .pick-col');
    return { hasInput: !!pick, hasInst: !!(pick && pick.jscolor), hasShow: !!(pick && pick.jscolor && typeof pick.jscolor.show === 'function'), type: pick && pick.type };
  });
  check('pick-col 存在（非 type=color，jscolor 接管）', instState.hasInput && instState.type !== 'color', JSON.stringify(instState));
  check('pick-col 挂载 jscolor 实例（含 show 方法）', instState.hasInst && instState.hasShow);

  // ② 点击右格第 4 列色块 → jscolor 弹层呼出可见
  await page.click('#pairList .comp-pair .comp-row:nth-child(2) .chip2');
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => {
    const wrap = document.querySelector('body > .jscolor-wrap');
    if (!wrap) return { wrap: false };
    const box = wrap.querySelector('.jscolor-picker');
    const vis = box && getComputedStyle(box).display !== 'none';
    return { wrap: true, picker: !!box, visible: vis, display: box && getComputedStyle(box).display };
  });
  check('点击色块呼出 jscolor 弹层（.jscolor-wrap 含 .jscolor-picker）', opened.wrap && opened.picker, JSON.stringify(opened));
  check('弹层可见（picker display 非 none）', opened.visible === true, opened.display || 'n/a');

  // ③ 事件链：jscolor 真实选色会向 valueElement 派发 input（源码 triggerInputEvent，3044 行证实），
  // 这里等价模拟该派发（pick.value 更新 + dispatch input）→ 页面 input 监听 → 色块联动
  const pickInfo = await page.evaluate(() => {
    const pair = document.querySelector('#pairList .comp-pair');
    const pick = pair.querySelector('.pick-col');
    const chip = pair.querySelector('.comp-row:nth-child(2) .chip2');
    const before = pick.value;
    pick.value = '#12AB34';
    pick.dispatchEvent(new Event('input', { bubbles: true }));
    const after = pick.value;
    return { before, after, chipBg: chip.style.background };
  });
  // rgb(18, 171, 52) → #12AB34 比对（chip.style.background 是 rgb 格式）
  const rgbToHex = (rgb) => { const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb || ''); return m ? '#' + [1,2,3].map((i) => parseInt(m[i], 10).toString(16).padStart(2, '0')).join('').toUpperCase() : ''; };
  check('jscolor 选色派发 input → 页面监听触发色块联动', rgbToHex(pickInfo.chipBg) === '#12AB34', `${pickInfo.before} → ${pickInfo.after} | chip ${pickInfo.chipBg} → ${rgbToHex(pickInfo.chipBg)}`);

  console.log('\n结果: ' + (fails ? fails + ' 项失败' : '全部通过'));
} finally {
  await browser.close();
}
process.exit(fails ? 1 : 0);
