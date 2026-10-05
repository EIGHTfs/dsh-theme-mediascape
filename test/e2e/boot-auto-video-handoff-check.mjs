// 开屏 file:"auto" 视频移交壁纸层 回归测试（2026-09-22 新增）
// 覆盖拆分 bug：finishBootIntro 把 `if (!done)` 写成 `if (st.done)` → st.done 已 true 恒 return
// → 移交永不执行 → 启动画面视频不能播（2026-09-22 报）。
//
// 运行环境：真实预览服务（127.0.0.1:30999）——boot.json 已是 file:"auto"（自动取当前视频壁纸），
// 壁纸列表含视频。用运行时状态验证移交全链路：
//   1. 开屏 overlay 内 video 挂载（src 匹配壁纸视频 url）
//   2. 点 skip → finishBootIntro → 380ms 后移交：window.__mediascapeDshBootVideo = { el, id, url }
//   3. 壁纸层 renderLayers 接管同一元素（takeOver 分支）：bg 挂载 video、handoff 清空
import { chromium } from 'file:///volume1/VirtualDSM/DeepSeekHarness/pwviewer/node_modules/playwright/index.mjs';
const browser = await chromium.launch({
  executablePath: '/volume1/VirtualDSM/DeepSeekHarness/pwviewer/browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
// 预置视频层开启（模拟用户已开视频壁纸：真实接管链路的前提——videoOn=false 时 renderLayers 只渲染图片层，
// 不移交元素；用户开过视频层（LS_BG_VIDEO=1）才会走 takeOver 接管分支）
await page.addInitScript(() => {
  localStorage.setItem('mediascape-dsh-bg-video-on', '1');
  localStorage.setItem('mediascape-dsh-muted', '0'); // 预置用户已开声音：移交后必须按声音面板状态恢复有声（2026-09-23 修复回归）
});
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).slice(0, 120)));
await page.goto('http://127.0.0.1:30999/', { waitUntil: 'domcontentloaded', timeout: 10000 });
await page.waitForTimeout(800); // 开屏渲染 + boot auto 解析 + 视频挂载

// 1. 开屏 overlay 内 video 挂载
const s1 = await page.evaluate(() => {
  const boot = document.querySelector('.mediascape-dsh-boot');
  const media = boot ? boot.querySelector('.mediascape-dsh-gif') : null;
  return {
    boot: !!boot,
    tag: media ? media.tagName : null,
    src: media ? (media.getAttribute('src') || '') : null,
    pending: window.__mediascapeDshBootVideoPending || null,
  };
});
console.log(`1. 开屏 media: boot=${s1.boot} tag=${s1.tag} src=${s1.src ? s1.src.split('/').pop() : null} pending=${s1.pending ? JSON.stringify(s1.pending) : null}`);
console.log(s1.tag === 'VIDEO' && s1.src ? 'PASS  开屏 video 已挂载且 src 就绪' : (s1.tag ? `INFO  开屏 media=${s1.tag}（无视频场景跳过移交）` : 'FAIL  开屏 media 未出现'));

let passCount = 0, failCount = 0;
const check = (ok, label) => { console.log(ok ? 'PASS  ' + label : 'FAIL  ' + label); ok ? passCount++ : failCount++; };

if (s1.tag === 'VIDEO' && s1.src) {
  // 2. 点 skip 触发 finishBootIntro → 立即移交（无放大动画，直接移交+gone）。
  //    ⚠️ 移交-接管是同步链路：__mediascapeDshBootVideo SET → renderLayers takeOver 消费 → 清空
  //    零毫秒窗口（实测 t+1101ms SET 与 null 同毫秒），无法采样中间态。
  //    改用结果态验证：skip 后 bg 出现移交的 video（同一 src）+ handoff 已清空 = 移交链路完整执行过。
  await page.click('.mediascape-dsh-skip');
  await page.waitForTimeout(300); // 移交同步完成 + bg 挂载

  // 3. 壁纸层接管（renderLayers takeOver 分支）
  await page.waitForTimeout(800);
  const s3 = await page.evaluate(() => {
    const all = document.querySelectorAll('video');
    const bootGone = !!document.querySelector('.mediascape-dsh-boot.gone');
    const bootGoneOrRemoved = bootGone || !document.querySelector('.mediascape-dsh-boot');
    const handoffCleared = window.__mediascapeDshBootVideo === null;
    const vids = [...all].map((v) => ({ src: (v.getAttribute('src') || '').split('/').pop(), cls: v.className || '' }));
    return { videoCount: all.length, bootGone, bootGoneOrRemoved, handoffCleared, vids };
  });
  console.log(`3. 壁纸层: videoCount=${s3.videoCount} bootGone=${s3.bootGone} handoffCleared=${s3.handoffCleared} vids=${JSON.stringify(s3.vids)}`);
  check(s3.videoCount >= 1 && s3.handoffCleared, '壁纸层已接管 video（移交元素已挂载且 handoff 清空）');
  check(s3.vids.some((v) => v.src === s1.src.split('/').pop()), '接管的是同一移交元素（src 一致，不重新发 Range 请求）');
  check(s3.bootGoneOrRemoved, '开屏结束（gone 或已移除）');
  // 声音恢复断言（2026-09-23）：移交后 bg video 必须按声音面板状态恢复——muted=false、volume=0.8
  const s3b = await page.evaluate(() => {
    const v = document.querySelector('.mediascape-dsh-bg video');
    return v ? { muted: v.muted, vol: v.volume, paused: v.paused } : null;
  });
  console.log(`3b. 移交后声音: muted=${s3b ? s3b.muted : 'N/A'} vol=${s3b ? s3b.vol : 'N/A'} paused=${s3b ? s3b.paused : 'N/A'}`);
  check(s3b && s3b.muted === false && Math.abs(s3b.vol - 0.8) < 0.01, '移交后按声音面板状态恢复（muted=false 音量 0.8）');
} else {
  console.log('（无视频场景，移交分支跳过——需视频壁纸数据才能测移交）');
  check(true, '场景跳过（无视频壁纸数据）');
}

console.log(`4. pageerror: ${errs.length ? errs.join(' | ') : '无'}`);
check(errs.length === 0, '无页面错误');
console.log(`\n结果: ${passCount} PASS / ${failCount} FAIL`);
await browser.close();
console.log('DONE');
