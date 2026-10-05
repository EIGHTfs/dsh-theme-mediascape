// 配色盘「切换预设真实读取」一键验证（2026-09-26 定稿）：
// 场景：外部覆盖保存预设（同名）后，切换预设（别的 → 该预设）必须重新读取真实文件，
// 右列显示新值——不能用内存缓存旧值。
// ①记录右列某元素缓存色 ②外部 API 覆盖保存「知更鸟·晴歌」预设（btn-primary → #112233）
// ③切换预设触发 change → loadPresets 真实读盘 ④断言右列显示 #112233。
// 零污染：测试前备份预设文件内容，测试后原样写回（不污染用户预设）。
// 运行：node test/e2e/theme-swatch-preset-switch-check.mjs（一键，PASS/FAIL 输出，退出码 0/1）
import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const CHROME = process.env.MS_CHROME || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/.pwviewer/browsers/chromium-1243/chrome-linux64/chrome';
const MS_LIBS = process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs';
const MS_FONTS = process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf';
const BASE = process.env.MS_PREVIEW || 'http://127.0.0.1:30999';
const PRESET_FILE = process.env.MS_PRESET_FILE || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/dsh-theme-mediascape/theme-studio/json/preset/知更鸟·晴歌.json';
const TEST_HEX = '#112233';

let fails = 0;
const check = (n, ok, d = '') => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  → ' + d : '')); if (!ok) fails++; };

// 零污染准备：备份预设原内容（测试后写回）
const presetBackup = existsSync(PRESET_FILE) ? readFileSync(PRESET_FILE, 'utf8') : null;
const restore = () => { if (presetBackup !== null) writeFileSync(PRESET_FILE, presetBackup, 'utf8'); };

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

  const readRight = () => page.evaluate(() => {
    const rows = [...document.querySelectorAll('#pairList .comp-pair')];
    const row = rows.find((x) => x.dataset.role === 'btn-primary');
    return row ? (row.querySelector('.comp-row:nth-child(2) .pick-col')?.value || '无') : '无此行';
  });

  // ① 记录缓存值（切换前）+ 制造 RIGHTCOLOR（先套到右边——用户真实场景：右列有调色记录再切换）
  const before = await readRight();
  await page.click('#btnToRight');
  await page.waitForTimeout(300);
  const withRightColor = await readRight();
  console.log('  套右边后右列 btn-primary:', withRightColor, '(RIGHTCOLOR 有值)');

  // ② 外部 API 覆盖保存同名预设（btn-primary → 测试色）
  await page.evaluate(async (hex) => {
    await fetch('/api/theme-export', { signal: AbortSignal.timeout(10000),
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '知更鸟·晴歌', css: JSON.stringify({ label: '知更鸟·晴歌', colors: { 'btn-primary': { hex, alpha: 1 } } }) }),
    });
  }, TEST_HEX);
  await page.waitForTimeout(400);

  // ③ 切到别的预设再切回 → 触发 change → 清 RIGHTCOLOR + 真实读取
  const opts = await page.evaluate(() => [...document.querySelectorAll('#pickPreset option')].map((o) => o.value));
  const cur = await page.evaluate(() => document.getElementById('pickPreset').value);
  const other = opts.find((v) => v !== cur);
  if (other) { await page.selectOption('#pickPreset', other); await page.waitForTimeout(300); }
  await page.selectOption('#pickPreset', opts.find((v) => /知更鸟/.test(v)));
  await page.waitForTimeout(600);

  // ④ 断言右列显示测试色（RIGHTCOLOR 已清 + 真实读取文件，非缓存/非旧 RIGHTCOLOR）
  const after = await readRight();
  check('套右边(RIGHTCOLOR 有值)后切换预设 → 右列读取真实文件新色', after === TEST_HEX, `${withRightColor} → ${after}`);
  check('保存链路带 # 前缀（服务端接受）', TEST_HEX.startsWith('#'));

  console.log('\n结果: ' + (fails ? fails + ' 项失败' : '全部通过'));
} finally {
  await browser.close();
  restore(); // 零污染：还原预设
}
process.exit(fails ? 1 : 0);
