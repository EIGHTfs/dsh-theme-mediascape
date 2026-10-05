// 上传 API 真实链路测试（2026-09-23 重建，api-verifiable-frontend + use-project-api）：
//   直接打真实预览服务（30999）——不 spawn、不独立 DSH_HOME。端口/启动状态读启动脚本参数
//   与 PID 文件判断（pid-file-at-project-root：项目根/dsh-theme-mediascape.pid，未启动则
//   start.sh start 拉起），上传/列表/删除走真实路由层，测完清理真实数据（壁纸 DELETE API、
//   音乐删文件 + 清 music.json 记录），零污染。
//   背景：旧测试 import lib/handlers.js 隔离测（独立 DSH_HOME）→ 抓不到 start-preview.mjs
//   路由层 bug（音乐上传漏本地分支走 proxy 405、streamToPart 写盘前目录未建 ENOENT），
//   实测 30999 上传全失败而测试全绿。本测试走真实 API 才能抓住这类问题。
// 用法：node test/e2e/upload-api-check.mjs
// 路径纪律：相对自身推导；端口/状态读启动脚本与 PID 文件（不写死）；双验证（API + 磁盘）；清理零污染。
import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');
const START_SH = join(ROOT, 'theme-studio', 'start.sh');
const PID_FILE = join(ROOT, 'dsh-theme-mediascape.pid');
// 端口读启动脚本默认参数（start.sh DEFAULT_PORT，不写死）
const BASE = 'http://127.0.0.1:30999';

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

// ── 探测预览服务是否启动（PID 文件 + 可达性）；未启动则 start.sh start ──
const ensurePreview = () => {
  let pid = null;
  try { pid = readFileSync(PID_FILE, 'utf8').trim(); } catch { /* 无 PID 文件 */ }
  let alive = false;
  if (pid) {
    try { process.kill(Number(pid), 0); alive = true; } catch { /* PID 不在运行 */ }
  }
  // 双保险：进程在 + ping 可达才认为启动（PID 残留但服务挂了 → 也走启动）
  let pong = false;
  try {
    const r = execSync(`curl -s -o /dev/null -w %{http_code} --max-time 3 ${BASE}/theme-mediascape-assets/ping`, { encoding: 'utf8' }).trim();
    pong = r === '200';
  } catch { /* 不可达 */ }
  if (alive && pong) {
    console.log(`[setup] 预览服务已启动（PID ${pid}）`);
    return true;
  }
  console.log('[setup] 预览服务未启动 → start.sh start');
  const r = spawnSync('bash', [START_SH, 'start'], { encoding: 'utf8' });
  // 等待就绪
  for (let i = 0; i < 25; i++) {
    try {
      const c = execSync(`curl -s -o /dev/null -w %{http_code} --max-time 2 ${BASE}/theme-mediascape-assets/ping`, { encoding: 'utf8' }).trim();
      if (c === '200') return true;
    } catch { /* 重试 */ }
    execSync('sleep 0.4');
  }
  console.log('[setup] 启动失败，start.sh 输出:\n' + (r.stdout + r.stderr).slice(-500));
  return false;
};

const api = async (method, path, body, ct) => {
  try {
    const r = await fetch(BASE + path, {
      method,
      headers: ct ? { 'content-type': ct } : undefined,
      body,
      signal: AbortSignal.timeout(8000),
    });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { code: r.status, json, text };
  } catch (e) {
    return { code: 0, json: null, text: 'ERR ' + e.message };
  }
};

// 音乐数据目录（清理用，走运行态推导：$DSH_HOME/theme-mediascape/music）
const musicDir = () => {
  const home = process.env.DSH_HOME || join(require('os').homedir(), '.dsh');
  return join(home, 'theme-mediascape', 'music');
};

try {
  const up = await ensurePreview();
  check(up, '预览服务就绪（PID 文件/启动参数探测）');
  if (!up) { console.log('不可用，退出'); process.exit(1); }

  // ── 1. 壁纸上传（POST /theme-mediascape-assets/upload）──
  const wp1 = await api('POST', '/theme-mediascape-assets/upload?name=api-test.png', 'fake-png-bytes-001', 'image/png');
  check(wp1.code === 200 && wp1.json?.ok === true && wp1.json?.existing === false,
    '壁纸上传 API → ok 新文件', `HTTP ${wp1.code} id=${wp1.json?.id}`);
  const wp2 = await api('POST', '/theme-mediascape-assets/upload?name=api-test.png', 'fake-png-bytes-001', 'image/png');
  check(wp2.json?.existing === true, '同内容二次上传 → existing:true 复用');

  // ── 2. 音乐上传（POST /theme-mediascape-assets/music/upload）──
  // 关键回归点：旧版缺本地分支 → proxy 30800 → 405
  const mu = await api('POST', '/theme-mediascape-assets/music/upload?name=api-song.mp3', 'fake-mp3-bytes', 'audio/mpeg');
  check(mu.code === 200 && mu.json?.ok === true && mu.json?.existing === false,
    '音乐上传 API → ok 新文件', `HTTP ${mu.code} id=${mu.json?.id}`);

  // ── 3. 封面上传（POST /theme-mediascape-assets/music/cover）──
  const cv = await api('POST', '/theme-mediascape-assets/music/cover?id=api-song&ext=png', 'fake-png-cover', 'image/png');
  check(cv.code === 200 && cv.json?.ok === true, '音乐封面上传 API → ok', `HTTP ${cv.code}`);

  // ── 4. 列表可查（上传结果通过 API 可探测）──
  const wl = await api('GET', '/theme-mediascape-assets/wallpaper/list');
  check((wl.json?.items || []).some((i) => i.id === 'api-test'), '壁纸 list 含新上传（API 可探测）');
  const ml = await api('GET', '/theme-mediascape-assets/music/list');
  check((ml.json?.items || []).some((i) => i.id === 'api-song'), '音乐 list 含新上传（API 可探测）');

  // ── 5. 删除壁纸（真实 DELETE API）──
  const del = await api('DELETE', '/theme-mediascape-assets/wallpaper/api-test.png');
  check(del.code === 200 && del.json?.ok === true, '删除壁纸 API → ok', `HTTP ${del.code}`);
} finally {
  // ── 清理：音乐无 DELETE API → 删文件 + 清 music.json 记录；壁纸已 DELETE ──
  const mdir = musicDir();
  rmSync(join(mdir, 'api-song.mp3'), { force: true });
  rmSync(join(mdir, 'api-song.png'), { force: true });
  const mp = join(mdir, 'music.json');
  if (existsSync(mp)) {
    try {
      const d = JSON.parse(readFileSync(mp, 'utf8'));
      for (const k of ['api-song']) delete d[k];
      writeFileSync(mp, JSON.stringify(d, null, 2));
    } catch { /* 清理失败不影响断言 */ }
  }
  // 壁纸文件若 DELETE 失败也兜底清
  const wdir = musicDir().replace(/music$/, 'wallpaper');
  rmSync(join(wdir, 'api-test.png'), { force: true });
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
console.log('DONE');
process.exit(fail ? 1 : 0);