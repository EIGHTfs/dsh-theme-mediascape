// 胶囊运行态兜底验证（2026-09-23 运行态化定稿：读写走 $DSH_HOME/theme-mediascape/capsules.json，仓库只回退可读、不写）：
// 人为把仓库 theme-studio/capsules.json 改名（模拟外部开发操作移走源）→ build 必须仍成功
// 且 client.js 注入的是运行态副本（12 条胶囊），不产出空产物；日志如实记录「OK 运行态读取」。
// 做法：①先跑一次正常 build 确保运行态副本存在；②把仓库 theme-studio/capsules.json rename 走；
// ③跑 build.cjs（输出透传），断言：
//   ①build 退出码 0（不终止——运行态稳定存在，仓库被移走不影响）
//   ②lib/client.js 的 CAPSULES_DATA 非空（12 条），与运行态副本一致
//   ③运行态 build-capsules.log 有「OK 运行态读取」记录（如实记录来源）
// finally 恢复仓库 capsules.json（运行态保留——它现在是真源）。
import { spawnSync } from 'node:child_process';
import { existsSync, renameSync, readFileSync, mkdirSync, cpSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO_CAPSULES = join(ROOT, 'theme-studio', 'capsules.json');
// 2026-09-2x 改：临时移走目标放 os.tmpdir()（仓库 .trash 回收机制已清理；同卷内 rename 不受 EXDEV 影响）
const REPO_CAPSULES_MOVED = join(os.tmpdir(), 'capsules-repo-renamed-' + Date.now() + '.json');
const CLIENT = join(ROOT, 'lib', 'client.js');
const BUILD = join(ROOT, 'build.cjs');
const NODE = process.env.NODE || process.execPath;

// 运行态路径（与 lib/paths.js runtimeCapsulesPath() 同语义）
const DSH_HOME = process.env.DSH_HOME || join(process.env.HOME || '', '.dsh');
const RUNTIME_CAPSULES = join(DSH_HOME, 'theme-mediascape', 'capsules.json');

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
  if (!ok) fails++;
};

const extractCapsules = (js) => {
  const m = /CAPSULES_DATA = \/\*__CAPSULES_START__\*\/(\[.*?\])\/\*__CAPSULES_END__\*\//.exec(js);
  if (!m) return null;
  try { return JSON.parse(m[1]); } catch { return null; }
};

// 确保运行态目录存在
mkdirSync(join(DSH_HOME, 'theme-mediascape'), { recursive: true });

// 先跑一次正常 build，确保运行态副本存在
console.log('── 步骤 1：先跑正常 build，确保运行态副本存在 ──');
{
  const clean = spawnSync(NODE, [BUILD], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  if (clean.status !== 0) {
    console.log('FAIL  预跑 build 失败（无法建立运行态基线）:' + (clean.stderr || clean.stdout || '').slice(-300));
    process.exit(1);
  }
}
check('运行态 capsules.json 已存在', existsSync(RUNTIME_CAPSULES), RUNTIME_CAPSULES);
const runtimeRules = existsSync(RUNTIME_CAPSULES) ? (JSON.parse(readFileSync(RUNTIME_CAPSULES, 'utf8')).rules || []) : [];
const baselineCount = runtimeRules.length;
check('运行态副本存在胶囊规则', runtimeRules.length > 0, baselineCount + ' 条');
if (runtimeRules.length === 0) { console.log('FAIL  运行态副本为空，无法测试兜底'); process.exit(1); }

// 人为重命名仓库 capsules.json（模拟外部把仓库源改名导致读不到）
console.log('── 步骤 2：人为重命名仓库 capsules.json → 跑 build（应读运行态）──');
cpSync(REPO_CAPSULES, REPO_CAPSULES_MOVED); rmSync(REPO_CAPSULES); // 2026-09-2x：跨设备用拷贝（EXDEV 安全）
console.log('已改名: theme-studio/capsules.json → ' + REPO_CAPSULES_MOVED.split('/').pop());let buildOut = '';
let buildStatus = -1;
try {
  const r = spawnSync(NODE, [BUILD], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  buildOut = (r.stdout || '') + (r.stderr || '');
  buildStatus = r.status;
} finally {
  // 无论 build 是否成功，先恢复仓库源文件（安全第一：不把仓库留在改名状态）
  if (!existsSync(REPO_CAPSULES) && existsSync(REPO_CAPSULES_MOVED)) { cpSync(REPO_CAPSULES_MOVED, REPO_CAPSULES); rmSync(REPO_CAPSULES_MOVED); }
}
console.log('── 步骤 3：断言 ──');
check('build 退出码 0（运行态兜底不终止）', buildStatus === 0, 'status=' + buildStatus + (buildStatus !== 0 ? ' | 输出尾: ' + buildOut.slice(-300) : ''));

const js = existsSync(CLIENT) ? readFileSync(CLIENT, 'utf8') : '';
const injected = extractCapsules(js);
check('client.js 有注入胶囊（非空）', !!injected && injected.length > 0, injected ? injected.length + ' 条' : '无注入');
check('注入条数 = 运行态副本条数', !!injected && injected.length === baselineCount, `${injected ? injected.length : 'N/A'} = ${baselineCount}`);
if (injected && injected.length > 0) {
  const sameKeys = injected.map(x => x.key).join(',') === runtimeRules.map(x => x.key).join(',');
  check('注入键与运行态副本一致', sameKeys, injected.map(x => x.key).slice(0, 6).join(',') + '…');
}

// 日志如实记录「OK 运行态读取」（读运行态非仓库）
console.log('── 步骤 4：日志如实记录 ──');
const logCandidates = [
  join(DSH_HOME, 'theme-mediascape', 'logs', 'build-capsules.log'),
  join('/volume1/VirtualDSM/DeepSeekHarness/.dsh', 'theme-mediascape', 'logs', 'build-capsules.log'),
];
let logRecorded = false, logTail = '';
for (const lp of logCandidates) {
  if (!existsSync(lp)) continue;
  const all = readFileSync(lp, 'utf8').split('\n').filter(Boolean);
  logTail = all.slice(-12).join('\n');
  if (/OK 运行态读取|OK 仓库回退读取/.test(logTail)) { logRecorded = true; break; }
}
check('build-capsules.log 记录「运行态/仓库回退读取」', logRecorded, logTail.split('\n').filter(l => /运行态读取|仓库回退/.test(l)).slice(0, 2).join(' | '));

// 仓库还原后：build 仍读运行态（运行态是当前真源；仓库只回退可读）
console.log('── 步骤 5：仓库已还原 → 跑 build（应仍读运行态）──');
{
  const r3 = spawnSync(NODE, [BUILD], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  const js3 = existsSync(CLIENT) ? readFileSync(CLIENT, 'utf8') : '';
  const injected3 = extractCapsules(js3);
  check('还原后 build 退出码 0', r3.status === 0, 'status=' + r3.status);
  check('还原后注入胶囊非空', !!injected3 && injected3.length > 0, injected3 ? injected3.length + ' 条' : '无');
  let readRuntime = false;
  for (const lp of logCandidates) {
    if (!existsSync(lp)) continue;
    const all = readFileSync(lp, 'utf8').split('\n').filter(Boolean);
    if (/OK 运行态读取/.test(all.slice(-8).join('\n'))) { readRuntime = true; break; }
  }
  check('日志记录「OK 运行态读取」（运行态为真源）', readRuntime, 'build-capsules.log 最新含 OK 运行态读取');
}

console.log('');
console.log(fails === 0 ? '✅ 胶囊运行态兜底测试通过' : `❌ ${fails} 项失败`);
process.exit(fails === 0 ? 0 : 1);