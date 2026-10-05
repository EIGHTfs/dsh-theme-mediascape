// 积木化浏览器测试 + 自动录像（2026-09-2x）：
// 每个点击/动作 = 一块积木（block），按顺序执行；playwright recordVideo 自动录屏。
// 积木库见 BLOCK_LIB（点击 dock 按钮/打开选择器/选择壁纸项/勾选移除/音量滑块/刷新/等待/截图），
// 流程 = 积木数组（数据驱动，可增删改顺序）；内置默认流程：
//   进入网页 → 景 → 选择壁纸 → 选择另一个 → 刷新网页 → 乐 → 移除 → 声 → 壁纸音
// 用法：node test/e2e/ui-blocks-recorder.mjs            # 跑默认流程
//       node test/e2e/ui-blocks-recorder.mjs --list     # 列流程
//       node test/e2e/ui-blocks-recorder.mjs --flow custom --blocks '[{"b":"wait","arg":500}]'
// 运行前提同 ui-dock-upload-remove-check（chromium/运行库/CJK 字体，env 可覆盖）。
// PLAYWRIGHT_BROWSERS_PATH 需在 import playwright 前设置（库启动时读取，launch env 不影响）。
process.env.PLAYWRIGHT_BROWSERS_PATH = process.env.MS_PWBROWSERS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers';
import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const RECORDS_DIR = process.env.MS_RECORDS || join(SELF_DIR, 'records');
mkdirSync(RECORDS_DIR, { recursive: true });

const CHROME = process.env.MS_CHROME || '/volume1/@appdata/DeepSeekHarness-NAS/0.1.6-alpha.1/工作区/.pwviewer/browsers/chromium-1243/chrome-linux64/chrome';
const MS_LIBS = process.env.MS_CHROMELIBS || '/volume1/VirtualDSM/DeepSeekHarness/pwviewer-libs';
const MS_FONTS = process.env.MS_FONTCONF || '/volume1/VirtualDSM/DeepSeekHarness/fonts/fonts.conf';
const BASE = process.env.MS_PREVIEW || 'http://127.0.0.1:30999';

// ── 积木库：每块 = { name, run(ctx) }，ctx 提供 page/日志；执行器按序 await ──
const BLOCK_LIB = {
  // 进入网页（一次）
  open: async (ctx, arg) => { await ctx.page.goto(typeof arg === 'string' ? arg : BASE + '/?mode=full', { waitUntil: 'load', timeout: 30000 }); },
  // 等渲染（dock「景」按钮出现）
  readyDock: async (ctx) => { await ctx.page.waitForSelector('button.mediascape-dsh-bg-toggle, button.mediascape-dsh-upload-toggle', { timeout: 20000 }); },
  // 点 dock 按钮（景/乐/声/字/传——文字匹配）
  clickDock: async (ctx, arg) => {
    const ok = await ctx.page.evaluate((t) => {
      const btn = [...document.querySelectorAll('.mediascape-dsh-dock-btn')].find((b) => b.textContent === t);
      if (!btn) return false; btn.click(); return true;
    }, arg);
    if (!ok) throw new Error('dock 按钮不存在: ' + arg);
  },
  // 点文字按钮（页面任意）
  clickText: async (ctx, arg) => {
    const ok = await ctx.page.evaluate((t) => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === t);
      if (!btn) return false; btn.click(); return true;
    }, arg);
    if (!ok) throw new Error('按钮不存在: ' + arg);
  },
  // 壁纸面板「视频/图片」开关：切到视频壁纸模式（当前为图片模式才点；无视频素材时按钮 disabled → 抛错）
  videoWallpaperToggle: async (ctx) => {
    const r = await ctx.page.evaluate(() => {
      const btn = document.querySelector('[data-video-toggle]');
      if (!btn) return { ok: false, why: '视频开关不存在' };
      if (btn.disabled) return { ok: false, why: '无视频素材，无法切换视频壁纸' };
      if (btn.textContent === '视频') return { ok: true, why: '已是视频模式' }; // 已开 → 跳过
      btn.click(); return { ok: true, why: '已切换' };
    });
    if (!r.ok) throw new Error(r.why);
  },
  // 壁纸选择器按名称选（视频列表里选知更鸟等——按文字匹配比 index 稳；选择器未开则先点「选择壁纸」）
  selectWallpaperByName: async (ctx, arg) => {
    await ctx.page.evaluate(() => {
      const picker = document.querySelector('.mediascape-dsh-bg-picker');
      if (!picker || !picker.classList.contains('open')) {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '选择壁纸');
        if (btn) btn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 500));
    const ok = await ctx.page.evaluate((name) => {
      const items = [...document.querySelectorAll('.mediascape-dsh-bg-picker-item')];
      const target = items.find((it) => (it.textContent || '').includes(name));
      if (!target) return false;
      target.click(); return true;
    }, arg);
    if (!ok) throw new Error('壁纸选择器未找到名称含「' + arg + '」的项');
  },
  // 点 CSS 选择器（evaluate 派发真实事件，不要求元素可见——reload 后面板打开时序中
  // playwright page.click 的 visible 等待会超时；存在性重试 5s）
  clickSel: async (ctx, arg) => {
    for (let i = 0; i < 10; i++) {
      const ok = await ctx.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (!el) return false;
        el.click(); return true;
      }, arg);
      if (ok) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error('选择器不存在: ' + arg);
  },
  // 等 N 毫秒
  wait: async (ctx, arg) => { await new Promise((r) => setTimeout(r, Number(arg) || 500)); },
  // 刷新网页
  reload: async (ctx) => { await ctx.page.reload({ waitUntil: 'load', timeout: 30000 }); await ctx.page.waitForSelector('button.mediascape-dsh-bg-toggle, button.mediascape-dsh-upload-toggle', { timeout: 20000 }); },
  // 壁纸选择器选第 N 项（0 起；选择器未开则先点「选择壁纸」）
  selectWallpaperItem: async (ctx, arg) => {
    const idx = Number(arg) || 0;
    await ctx.page.evaluate(() => {
      const picker = document.querySelector('.mediascape-dsh-bg-picker');
      if (!picker || !picker.classList.contains('open')) {
        const btn = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '选择壁纸');
        if (btn) btn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 500));
    const ok = await ctx.page.evaluate((i) => {
      const items = [...document.querySelectorAll('.mediascape-dsh-bg-picker-item')];
      if (i >= items.length) return false;
      items[i].click(); return true;
    }, idx);
    if (!ok) throw new Error('壁纸选择器项越界: index=' + idx);
  },
  // 音乐歌单：勾选第 N 首（0 起）
  checkMusicItem: async (ctx, arg) => {
    const idx = Number(arg) || 0;
    const ok = await ctx.page.evaluate((i) => {
      const rows = [...document.querySelectorAll('.mediascape-dsh-ms-item')];
      if (i >= rows.length) return false;
      const cb = rows[i].querySelector('input[type=checkbox]');
      if (!cb) return false;
      if (!cb.checked) cb.click();
      return true;
    }, idx);
    if (!ok) throw new Error('音乐歌单项越界: index=' + idx);
  },
  // 点「移除」（壁纸选择器或音乐歌单的移除按钮）——含诊断：点前打印各 picker 状态，点后验证服务端列表。
  // 2026-09-2x 修：选择器必须限定「当前 open 的 picker」——壁纸选择器常驻 DOM（未 open 时
  // display:none），固定「先壁纸后音乐」的选择器会匹配到隐藏的壁纸移除按钮（点错对象静默无反应）。
  removeSelected: async (ctx) => {
    const diag = await ctx.page.evaluate(() => {
      const bp = document.querySelector('.mediascape-dsh-bg-picker');
      const mp = document.querySelector('.mediascape-dsh-ms-picker');
      const openPicker = [bp, mp].find((p) => p && p.classList.contains('open'));
      const btn = openPicker ? openPicker.querySelector('.mediascape-dsh-bg-remove') : null;
      const rows = [...document.querySelectorAll('.mediascape-dsh-ms-item')];
      const checked = rows.filter((r) => r.querySelector('input[type=checkbox]')?.checked).length;
      return {
        bgPickerOpen: bp ? bp.classList.contains('open') : null,
        msPickerOpen: mp ? mp.classList.contains('open') : null,
        target: openPicker ? (openPicker === mp ? 'music' : 'wallpaper') : 'none',
        btnExists: !!btn, btnDisabled: btn ? btn.disabled : null,
        msRows: rows.length, checked,
      };
    });
    console.log('  [remove 诊断]', JSON.stringify(diag));
    if (diag.target === 'none') throw new Error('没有打开的移除面板');
    const ok = await ctx.page.evaluate(() => {
      const bp = document.querySelector('.mediascape-dsh-bg-picker');
      const mp = document.querySelector('.mediascape-dsh-ms-picker');
      const openPicker = [bp, mp].find((p) => p && p.classList.contains('open'));
      const btn = openPicker ? openPicker.querySelector('.mediascape-dsh-bg-remove') : null;
      if (!btn || btn.disabled) return false;
      btn.click(); return true;
    });
    if (!ok) throw new Error('移除按钮不存在或未勾选');
  },
  // 壁纸音量滑块（「声」面板，值 0-100）
  wallpaperVolume: async (ctx, arg) => {
    const numVal = Number(arg);
    const ok = await ctx.page.evaluate((v) => {
      const input = document.querySelector('input[type=range]');
      if (!input) return false;
      input.value = String(v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }, val);
    if (!ok) throw new Error('音量滑块不存在');
  },
  // 服务端验证：音乐移除后断言列表中不含指定名（判定删除真实生效，2026-09-2x 加——
  // 之前只看前端列表刷新，服务端文件是否删除要靠 API 判定）
  verifyMusicAbsent: async (ctx, arg) => {
    // 2026-09-2x 低风险优化：fetch 加 10s 超时（防服务端异常时永久挂起）
    const res = await fetch(ctx.base + '/theme-mediascape-assets/music/list', { signal: AbortSignal.timeout(10000) });
    const body = await res.json();
    const list = (body.items || []).map((x) => x.name);
    const still = list.filter((n) => n.includes(arg));
    console.log('  [验证] 服务端音乐列表:', (list.join(', ') || '(空)') + ' | 含「' + arg + '」:', (still.join(', ') || '无'));
    if (still.length) throw new Error('移除后服务端仍含: ' + still.join(', '));
  },
  // 截图积木（辅助观察）
  shot: async (ctx, arg) => { await ctx.page.screenshot({ path: join(RECORDS_DIR, String(arg) + '.png') }); },
};

// ── 预设流程（积木数组，数据驱动可改）──
const FLOWS = {
  default: {
    desc: '进入网页 → 景→切视频壁纸→初始花火视频播放 10s → 切换知更鸟 → 刷新 → 乐→移除(服务端验证) → 声→壁纸音',
    blocks: [
      { b: 'open' }, { b: 'readyDock' }, { b: 'shot', arg: '01-enter' },
      { b: 'clickDock', arg: '景' }, { b: 'wait', arg: 500 },
      { b: 'videoWallpaperToggle' }, { b: 'wait', arg: 600 }, { b: 'shot', arg: '02-video-mode' },
      // 初始壁纸用花火（火花角色PV）视频（确定性：当前残留可能不是它，先明确选中）
      { b: 'clickText', arg: '选择壁纸' }, { b: 'wait', arg: 500 },
      { b: 'selectWallpaperByName', arg: '火花' }, { b: 'wait', arg: 1500 }, { b: 'shot', arg: '03-first-firefly' },
      // 换动态壁纸前多给等待时间：花火视频播放 10s 稳定后再切换
      { b: 'wait', arg: 10000 }, { b: 'shot', arg: '04-firefly-10s' },
      { b: 'clickText', arg: '选择壁纸' }, { b: 'wait', arg: 500 },
      { b: 'selectWallpaperByName', arg: '知更鸟' }, { b: 'wait', arg: 1500 }, { b: 'shot', arg: '05-knowbird' },
      { b: 'reload' }, { b: 'wait', arg: 1500 }, { b: 'shot', arg: '06-reload' },
      { b: 'clickDock', arg: '乐' }, { b: 'wait', arg: 500 },
      { b: 'clickSel', arg: '[data-act="select"]' }, { b: 'wait', arg: 500 },
      { b: 'checkMusicItem', arg: 0 },
      { b: 'removeSelected' }, { b: 'wait', arg: 3000 },
      { b: 'verifyMusicAbsent', arg: 'ms-flow-test' }, { b: 'shot', arg: '07-music-removed' },
      { b: 'clickDock', arg: '声' }, { b: 'wait', arg: 500 },
      { b: 'wallpaperVolume', arg: 30 }, { b: 'wait', arg: 500 }, { b: 'shot', arg: '08-sound-volume' },
    ],
  },
};

// ── 执行器 ──
const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log('可用流程:');
  for (const [k, v] of Object.entries(FLOWS)) console.log(`  ${k} — ${v.desc}`);
  process.exit(0);
}
const flowName = args[args.indexOf('--flow') + 1] || 'default';
const customBlocks = args[args.indexOf('--blocks') + 1] ? JSON.parse(args[args.indexOf('--blocks') + 1]) : null;
const flow = customBlocks ? { desc: 'custom', blocks: customBlocks } : FLOWS[flowName];
if (!flow) { console.error('流程不存在: ' + flowName); process.exit(1); }

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const videoPath = join(RECORDS_DIR, `${flowName}-${stamp}.webm`);
const browser = await chromium.launch({
  executablePath: CHROME, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'],
  // 录像 ffmpeg 经 PLAYWRIGHT_BROWSERS_PATH（脚本顶部已设）定位
  env: { ...process.env, LD_LIBRARY_PATH: MS_LIBS, FONTCONFIG_FILE: MS_FONTS },
});
const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: RECORDS_DIR, size: { width: 1280, height: 800 } } });
const page = await context.newPage();
await page.addInitScript(() => {
  window.addEventListener('unhandledrejection', (e) => console.error('  [rejection]', String(e.reason?.stack || e.reason).slice(0, 300)));
  window.addEventListener('error', (e) => console.error('  [window error]', e.message));
});
page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 150)));
page.on('request', (r) => { if (r.method() === 'DELETE') console.log('  [DELETE 请求]', r.url()); });
page.on('response', (r) => { if (r.request().method() === 'DELETE') r.text().then((t) => console.log('  [DELETE 响应]', r.status(), t.slice(0, 90))).catch(() => {}); });

let fails = 0;
console.log(`▶ 流程「${flowName}」开始（${flow.blocks.length} 块积木）`);
for (let i = 0; i < flow.blocks.length; i++) {
  const b = flow.blocks[i];
  const lib = BLOCK_LIB[b.b];
  if (!lib) { console.log(`[${i + 1}/${flow.blocks.length}] ✗ 未知积木: ${b.b}`); fails++; continue; }
  const label = b.arg !== undefined ? `${b.b}(${typeof b.arg === 'object' ? JSON.stringify(b.arg) : b.arg})` : b.b;
  try {
    await lib({ page, base: BASE }, b.arg);
    console.log(`[${i + 1}/${flow.blocks.length}] ✓ ${label}`);
  } catch (e) {
    console.log(`[${i + 1}/${flow.blocks.length}] ✗ ${label} → ${String(e.message).slice(0, 120)}`);
    fails++;
  }
}
await page.waitForTimeout(500); // 收尾一帧
await context.close(); // 结束录像（webm 落盘）
const finalVideo = join(dirname(videoPath), videoPath.split('/').pop());
console.log(fails ? `\n${fails} 块积木失败` : '\n全部积木执行通过');
console.log('录像: ' + (existsSync(finalVideo) ? finalVideo : videoPath));
process.exit(fails ? 1 : 0);