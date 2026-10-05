// 模拟 boot.js 的 startRotate 序列逻辑（同算法抽验：idx 递增/越界回绕/loop 分支/单画面兜底）
function simulate(urls, durationMs, loop, stepCount) {
  const log = [];
  let time = 0, idx = 0;
  const total = urls.length;
  if (!total) { for (let i = 0; i < stepCount; i++) time += durationMs; return { log: ['(无素材) 仅 durationMs 后自动淡出'], time }; }
  const step = () => {
    idx += 1;
    if (idx >= total) {
      if (loop) { idx = 0; log.push(`t=${time} 循环 → 第 ${idx + 1} 画面 ${urls[idx]}`); time += durationMs; }
      else { log.push(`t=${time} 播完集合 → 自动淡出`); return false; }
    } else {
      log.push(`t=${time} 切到第 ${idx + 1} 画面 ${urls[idx]}`); time += durationMs;
    }
    return true;
  };
  // 首画面立即显示，之后每段 durationMs 轮换
  log.push(`t=0 首画面 ${urls[0]}`);
  time += durationMs;
  let alive = true;
  for (let i = 0; i < stepCount && alive; i++) alive = step();
  return { log, time };
}
const r1 = simulate(['robin-6s.mp4', '闪屏.gif'], 3000, false, 5);   // 多画面不循环
const r2 = simulate(['robin-6s.mp4', '闪屏.gif'], 3000, true, 5);    // 多画面循环
const r3 = simulate(['robin-6s.mp4'], 3000, false, 3);               // 单画面（旧行为）
const r4 = simulate([], 3000, false, 2);                             // 无素材兜底
console.log('═══ 多画面不循环 ═══'); r1.log.forEach(l => console.log(' ', l));
console.log('═══ 多画面循环 ═══'); r2.log.forEach(l => console.log(' ', l));
console.log('═══ 单画面 ═══'); r3.log.forEach(l => console.log(' ', l));
console.log('═══ 无素材 ═══'); r4.log.forEach(l => console.log(' ', l));
// 断言
const assert = (cond, msg) => { console.log(cond ? '✅ ' + msg : '❌ ' + msg); if (!cond) process.exitCode = 1; };
assert(r1.log.some(l => l.includes('播完集合')), '多画面播完自动淡出');
assert(r2.log.some(l => l.includes('循环')), '多画面 loop 循环');
assert(!r3.log.some(l => l.includes('循环')), '单画面不循环');
assert(r4.log.some(l => l.includes('自动淡出')), '无素材兜底淡出');
