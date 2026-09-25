// 一键测试执行器（2026-09-23 新增）
// 自动扫描并运行全部测试：
//   - test/e2e/*.mjs
//   - theme-studio/tests/ms-*.mjs
// 判定方式：解析每个测试输出的「X PASS / Y FAIL」（或「全部通过」/「结果: X PASS / Y FAIL」）。
// 环境：浏览器类测试（boot-*/video-cache/auto-*/ms-boot-render/ms-debug-dump）需要
//   LD_LIBRARY_PATH 指向 playwright 依赖库——脚本自动探测 pwviewer 相对仓库的位置；
//   可用 env.PLAYWRIGHT_ROOT 覆盖（禁止硬编码绝对路径，探测不到则跳过并提示）。
// 用法：node test/run-all.mjs [--only <子串>] [--list]
// 2026-09-23 加：自动进度日志（不受 debug 开关控制，直写运行态目录 logs/test-run.log）
//   ——每次测试开始/结束/总计各一行 JSON；落点 = $DSH_HOME/theme-mediascape/logs/test-run.log。
import { readdirSync, existsSync, statSync, mkdtempSync, rmSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..');

// ── 运行态进度日志（独立于 debug 开关：测试进度必须可追溯，不看配置）──
// 路径推导与 lib/debug.js 一致（DSH_HOME || ~/.dsh），直写 appendFileSync。
function testLogPath() {
  const home = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  return join(home, 'theme-mediascape', 'logs', 'test-run.log');
}
function testLogTs(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
function testLogWrite(entry) {
  try {
    const file = testLogPath();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(Object.assign({ ts: testLogTs() }, entry)) + '\n', 'utf8');
  } catch { /* 日志写失败不影响测试执行 */ }
}

// ── 探测 playwright 依赖库（相对仓库推导；禁止硬编码）──
// 优先 env.PLAYWRIGHT_ROOT；其次查仓库外已知邻居（通过相对 ROOT 的路径结构推导，可配置）。
// 2026-09-23 修：PLAYWRIGHT_ROOT 可能传 pwviewer 根或 lib 目录——根要先补
// lib/usr/lib/x86_64-linux-gnu 子目录（libatk 所在），否则 LD_LIBRARY_PATH 指向根不含
// libatk → chromium 起不来（kill ESRCH）。
let PW_LIB = '';
if (process.env.PLAYWRIGHT_ROOT) {
  const root = process.env.PLAYWRIGHT_ROOT;
  const libCandidates = [
    join(root, 'lib', 'usr', 'lib', 'x86_64-linux-gnu'), // pwviewer 根 → 补子目录
    root,                                                 // 已传 lib 目录 → 直接用
  ];
  for (const cand of libCandidates) {
    if (existsSync(join(cand, 'libatk-1.0.so.0'))) { PW_LIB = cand; break; }
  }
}
if (!PW_LIB) {
  const candidates = [
    // 邻居：<父>/pwviewer/lib/usr/lib/x86_64-linux-gnu（VirtualDSM 布局，相对推导）
    join(ROOT, '..', 'pwviewer', 'lib', 'usr', 'lib', 'x86_64-linux-gnu'),
    // 上溯两层：<父>/../pwviewer/...（仓库在 DeepSeekHarness/工作区/<repo> 时，pwviewer 在 DeepSeekHarness/pwviewer）
    join(ROOT, '..', '..', 'pwviewer', 'lib', 'usr', 'lib', 'x86_64-linux-gnu'),
    // 或 <父>/playwright/.local/lib（通用布局）
    join(ROOT, '..', 'playwright', '.local', 'lib'),
  ];
  for (const cand of candidates) {
    if (existsSync(join(cand, 'libatk-1.0.so.0'))) { PW_LIB = cand; break; }
  }
}

const TEST_TIMEOUT_MS = 120_000; // 单测试超时（2 分钟，防死循环挂死）
const only = process.argv.includes('--only') ? process.argv[process.argv.indexOf('--only') + 1] : '';
const listOnly = process.argv.includes('--list');

// ── 收集测试文件 ──
const tests = [];
for (const dir of [join(ROOT, 'test', 'e2e'), join(ROOT, 'theme-studio', 'tests')]) {
  if (!existsSync(dir)) continue;
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith('.mjs')) continue;
    if (f === 'run-all.mjs') continue;
    const abs = join(dir, f);
    if (!statSync(abs).isFile()) continue;
    tests.push(abs);
  }
}

if (listOnly) {
  for (const t of tests) console.log(relative(ROOT, t));
  process.exit(0);
}

// ── 执行 ──
let passAll = 0, failAll = 0, skipped = 0;
const results = [];
for (const t of tests) {
  const name = relative(ROOT, t);
  if (only && !name.includes(only)) { skipped++; continue; }
  testLogWrite({ event: 'start', test: name });
  const env = { ...process.env };
  if (PW_LIB) env.LD_LIBRARY_PATH = PW_LIB + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '');
  const r = spawnSync('node', [t], { encoding: 'utf8', timeout: TEST_TIMEOUT_MS, env });
  const out = (r.stdout || '') + (r.stderr || '');
  // 判定：解析 PASS/FAIL 计数（兼容多种格式）
  const mPass = out.match(/(\d+)\s*PASS/i);
  const mFail = out.match(/(\d+)\s*FAIL/i);
  const okText = /全部通过|DONE/.test(out);
  const failText = /项失败|FAIL|Error:/i.test(out);
  const p = mPass ? Number(mPass[1]) : (okText ? 1 : 0);
  const f = mFail ? Number(mFail[1]) : (failText && !okText ? 1 : 0);
  const status = r.status === 0 && f === 0 ? '✅' : '❌';
  if (status === '✅') passAll++; else failAll++;
  results.push({ name, status, p, f, code: r.status });
  testLogWrite({ event: 'end', test: name, pass: p, fail: f, code: r.status, ok: status === '✅' });
  console.log(`${status} ${name}  (${p} PASS / ${f} FAIL)`);
  if (status === '❌' && !process.argv.includes('--quiet')) {
    const errLine = out.split('\n').filter((l) => /FAIL|Error|错误/.test(l)).slice(0, 3).join('\n  ');
    if (errLine) console.log(`    ↳ ${errLine}`);
  }
}

testLogWrite({ event: 'summary', passAll, failAll, skipped, filtered: !!only, pwLib: PW_LIB || '' });
console.log(`\n══════════════════════════════════════`);
console.log(`总计: ${passAll} 通过 / ${failAll} 失败${only ? '（过滤后）' : ''} / ${skipped} 跳过`);
console.log(`playwright 库: ${PW_LIB || '未探测到（浏览器类测试需 PLAYWRIGHT_ROOT）'}`);
process.exit(failAll > 0 ? 1 : 0);
