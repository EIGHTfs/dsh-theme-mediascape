// playwright 实测 + 录屏（2026-09-2x）：30999 真实预览页模拟点击——
// ①「传」上传测试 png（列表出现）②同名再传（HUD「已跳过」行出现）③上传测试 mp3（音乐列表出现）
// ④景面板勾选刚上传 png → 移除（列表消失 + 服务端删除）⑤乐面板勾选刚上传 mp3 → 移除（列表消失）
// 全程只使用 /tmp 生成的测试文件，不动用户既有素材。
// 录屏：context recordVideo 录制全过程（WebM）→ ffmpeg 转 MP4；关键步骤额外截图 PNG。
// 产物：test/e2e/videos/（ui-dock-upload-remove.mp4 + step-*.png，git 忽略不入库）。
// 运行前提：headless chromium + 运行库 + CJK 字体 + ffmpeg（路径均可用环境变量覆盖，
// 默认值指向 /volume1/VirtualDSM/DeepSeekHarness/ 下的持久副本——见 README「theme-studio/ 预览环境」）。
import { writeFileSync, rmSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// 录屏需要 playwright 分发的 ffmpeg（recordVideo 用）——指向 pwviewer/browsers（含 ffmpeg-1011/ffmpeg-linux）
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.MS_BROWSERS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers';
// 动态 import：Playwright 在模块初始化时读取 browsers path（录屏 ffmpeg 位置），须先设 env 再加载
const { chromium } = await import('file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs');

const CHROME = process.env.MS_CHROME || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/.pwviewer/browsers/chromium-1243/chrome-linux64/chrome';
const MS_LIBS = process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs';
const MS_FONTS = process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf';
const FFMPEG = process.env.MS_FFMPEG || '/volume1/VirtualDSM/DeepSeekHarness/ffmpeg-x264/ffmpeg'; // 带 libx264 的静态构建（系统 ffmpeg 无 h264 编码器）
const BASE = process.env.MS_PREVIEW || 'http://127.0.0.1:30999';
const VDIR = process.env.MS_VIDEO_DIR || join(process.cwd(), 'test', 'e2e', 'videos');
const MP4_OUT = join(VDIR, 'ui-dock-upload-remove.mp4');
const PNG = '/tmp/ms-pw-test.png';
const MP3 = '/tmp/ms-pw-test.mp3';

let fails = 0;
const check = (n, ok, d) => { console.log((ok ? 'PASS' : 'FAIL') + '  ' + n + (d ? '  → ' + d : '')); if (!ok) fails++; };

// 1x1 红色 png
writeFileSync(PNG, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
writeFileSync(MP3, Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00FAKE-MP3-DATA'));

mkdirSync(VDIR, { recursive: true });
// 清旧产物（保持目录只留本次）
for (const f of readdirSync(VDIR)) { try { rmSync(join(VDIR, f), { force: true }); } catch {} }

const apiList = async (p) => {
  const r = await fetch(BASE + p);
  return (await r.json()).items || [];
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let shotNo = 0;
const shot = async (page, name) => {
  // 关键步骤额外截图（录屏之外再挑关键节点落 PNG，便于文档/演示引用）
  shotNo++;
  const p = join(VDIR, `step-${String(shotNo).padStart(2, '0')}-${name}.png`);
  try { await page.screenshot({ path: p, fullPage: false }); console.log('  [截图] ' + p); } catch (e) { console.log('  [截图失败]', String(e).slice(0, 80)); }
};

const browser = await chromium.launch({
  executablePath: CHROME, headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
});
// recordVideo：全程录屏（WebM，Playwright 官方功能，零额外依赖）
const context = await browser.newContext({
  viewport: { width: 1280, height: 800 },
  recordVideo: { dir: VDIR, size: { width: 1280, height: 800 } },
});
const page = await context.newPage();
page.on('console', (m) => { if (m.type() === 'error') console.log('  [console.error]', m.text().slice(0, 120)); });
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 150)));

try {
  await page.goto(BASE + '/?mode=full', { waitUntil: 'load', timeout: 30000 });
  await page.waitForSelector('button.mediascape-dsh-upload-toggle', { timeout: 20000 });
  console.log('dock 已渲染');

  // ── ① 上传测试 png（壁纸）──
  const fc1 = page.waitForEvent('filechooser', { timeout: 15000 });
  await page.click('button.mediascape-dsh-upload-toggle');
  await (await fc1).setFiles(PNG);
  await wait(2500);
  let items = await apiList('/theme-mediascape-assets/wallpaper/list');
  check('上传后壁纸列表含 ms-pw-test.png', items.some((x) => x.file === 'ms-pw-test.png'), items.map((x) => x.file).join(','));
  await shot(page, '上传后壁纸列表');

  // ── ② 同名再传 → HUD「已跳过」行 ──
  const fc2 = page.waitForEvent('filechooser', { timeout: 15000 });
  await page.click('button.mediascape-dsh-upload-toggle');
  await (await fc2).setFiles(PNG);
  await wait(1800);
  const skipVisible = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.mediascape-dsh-upload-skip .mediascape-dsh-upload-name')];
    return rows.map((r) => r.textContent);
  });
  check('重复上传 HUD 显示「已跳过」行', skipVisible.some((t) => t.includes('已跳过') && t.includes('ms-pw-test.png')), skipVisible.join(' | '));
  items = await apiList('/theme-mediascape-assets/wallpaper/list');
  const pngCount = items.filter((x) => x.file === 'ms-pw-test.png').length;
  check('去重后列表仍只有 1 个 ms-pw-test.png（不重复落盘）', pngCount === 1, `count=${pngCount}`);
  await shot(page, '重复上传已跳过');

  // ── ③ 上传测试 mp3（音乐）──
  const fc3 = page.waitForEvent('filechooser', { timeout: 15000 });
  await page.click('button.mediascape-dsh-upload-toggle');
  await (await fc3).setFiles(MP3);
  await wait(2500);
  const mItems = await apiList('/theme-mediascape-assets/music/list');
  check('上传后音乐列表含 ms-pw-test.mp3', mItems.some((x) => x.name === 'ms-pw-test.mp3'), mItems.map((x) => x.name).join(','));
  await shot(page, '上传后音乐列表');

  // ── ④ 壁纸移除：景 → 选择壁纸 → 勾选 → 移除 ──
  await page.click('button.mediascape-dsh-bg-toggle');
  await wait(600);
  await page.click('button.mediascape-dsh-bg-pick');
  await wait(600);
  const checked = await page.evaluate(() => {
    const cells = [...document.querySelectorAll('.mediascape-dsh-bg-picker-item')];
    const target = cells.find((c) => c.querySelector('span')?.textContent === 'ms-pw-test');
    if (!target) return false;
    target.querySelector('input[type=checkbox]').click();
    return true;
  });
  check('壁纸选择器勾选 ms-pw-test', checked);
  await shot(page, '壁纸勾选待移除');
  await page.click('button.mediascape-dsh-bg-remove');
  await wait(2500);
  items = await apiList('/theme-mediascape-assets/wallpaper/list');
  check('壁纸移除后列表不含 ms-pw-test.png（消失文件不出现在列表）', !items.some((x) => x.file === 'ms-pw-test.png'), items.map((x) => x.file).join(','));
  await shot(page, '壁纸移除后列表');

  // ── ⑤ 音乐移除：乐 → 选择 → 勾选 → 移除 ──
  await page.click('button.mediascape-dsh-music-toggle');
  await wait(600);
  await page.click('[data-act="select"]');
  await wait(600);
  const mChecked = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('.mediascape-dsh-ms-item')];
    const target = rows.find((r) => r.querySelector('.ttl')?.textContent.includes('ms-pw-test'));
    if (!target) return false;
    target.querySelector('input[type=checkbox]').click();
    return true;
  });
  check('音乐歌单勾选 ms-pw-test', mChecked);
  await shot(page, '音乐勾选待移除');
  await page.click('.mediascape-dsh-ms-picker .mediascape-dsh-bg-remove');
  await wait(2500);
  const mItems2 = await apiList('/theme-mediascape-assets/music/list');
  check('音乐移除后列表不含 ms-pw-test.mp3', !mItems2.some((x) => x.name === 'ms-pw-test.mp3'), mItems2.map((x) => x.name).join(','));
  await shot(page, '音乐移除后列表');

  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
} catch (e) {
  console.log('脚本异常:', String(e).slice(0, 300));
  fails++;
} finally {
  await context.close(); // 关闭 context → 录屏落盘（video.webm）
  await browser.close();
  // ── ffmpeg 转 MP4（浏览器兼容 h264 + faststart）──
  try {
    const vpath = await page.video().path();
    if (vpath && existsSync(vpath)) {
      const r = spawnSync(FFMPEG, ['-y', '-i', vpath, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', MP4_OUT], { encoding: 'utf8' });
      console.log(r.status === 0 ? `[录屏] MP4 已生成: ${MP4_OUT}` : `[录屏] ffmpeg 转码失败: ${(r.stderr || '').slice(-300)}`);
      try { rmSync(vpath, { force: true }); } catch {}
    } else {
      console.log('[录屏] 未找到 video.webm（录屏未产出）');
    }
  } catch (e) { console.log('[录屏] 转码异常:', String(e).slice(0, 150)); }
  for (const f of [PNG, MP3]) { try { rmSync(f); } catch {} }
}
process.exit(fails ? 1 : 0);
