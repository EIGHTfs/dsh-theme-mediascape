// 上传速度回归测试（2026-09-23 新增，保留自 2026-09-22 手工测速脚本）：
// 生成随机文件 → 用真实 lib/handlers.js 的 handleUpload 上传（隔离 DSH_HOME）→ 测速 → 断言局域网阈值。
// 背景：曾多次出现「上传慢」误报（.bin 被 400 拒收导致测速失真；代理层 cookie 等待期 body 流失）。
// 本测试固定用 .mp4（服务端真正接收写盘），断言 MB/s ≥ 阈值（局域网正常应 > 10MB/s；CI/慢盘放宽 5）。
// 强制写日志：结果落盘 $DSH_HOME/theme-mediascape/logs/upload-speed-test.log（直接 appendFileSync，
//   不受 debug.json log 开关控制——测试记录必须可查证，与业务日志开关解耦；文件 *.log 不入库）。
// 用法：node test/e2e/upload-speed-check.mjs [--mb 20] [--min-mbps 5]
//   返回 0 = 通过；1 = 速度低于阈值（或失败）。
import { mkdtempSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync, rmSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');
const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-upload-speed-'));
process.env.DSH_HOME = TMP_HOME;

// ── 参数：--mb 文件大小（默认 20MB）；--min-mbps 速度阈值（默认 5，局域网实测 40-76）──
const argv = process.argv.slice(2);
const mbArg = argv.includes('--mb') ? parseInt(argv[argv.indexOf('--mb') + 1], 10) : 20;
const minMbps = argv.includes('--min-mbps') ? parseFloat(argv[argv.indexOf('--min-mbps') + 1]) : 5;
const MB = Math.max(1, Math.min(mbArg, 512));

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
  if (!ok) fails++;
};

const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const handleUpload = mod.handleUpload;

function makeReq(url) { const r = new Readable({ read() {} }); r.url = url; r.headers = {}; return r; }
function makeRes() { return { status: 0, body: '', done: false, writeHead(s) { this.status = s; }, end(d) { this.body = String(d || ''); this.done = true; } }; }
async function waitDone(res, timeout = 60000) {
  const t0 = Date.now();
  while (!res.done && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 10));
}
async function pump(req, buf, chunk = 256 * 1024) {
  for (let off = 0; off < buf.length; off += chunk) {
    req.push(buf.subarray(off, Math.min(off + chunk, buf.length)));
    await new Promise((r) => setImmediate(r));
  }
  req.push(null);
}

/** 强制写测试结果日志（不受 debug.json log 开关控制；直接 appendFileSync 到运行态 logs/）。 */
function forceLog(line) {
  try {
    const dir = join(process.env.DSH_HOME, 'theme-mediascape', 'logs');
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, 'upload-speed-test.log'), line + '\n', 'utf8');
  } catch { /* 测试日志写失败不影响结果 */ }
}

try {
  const wdir = join(TMP_HOME, 'theme-mediascape', 'wallpaper');
  mkdirSync(wdir, { recursive: true });

  const name = 'speed-test.mp4';
  const buf = Buffer.alloc(MB * 1024 * 1024, 7); // 固定字节（确定性内容）
  const t0 = Date.now();
  const req = makeReq('/theme-mediascape-assets/upload?name=' + encodeURIComponent(name));
  const res = makeRes();
  handleUpload(req, res);
  await pump(req, buf);
  await waitDone(res);
  const ms = Date.now() - t0;
  const mbps = (MB / (ms / 1000)).toFixed(2);

  const j = JSON.parse(res.body || '{}');
  check('上传响应 200 ok', res.status === 200 && j.ok === true, `status=${res.status} ${JSON.stringify(j).slice(0, 90)}`);
  const savedSize = statSync(join(wdir, name)).size;
  check('落盘大小一致', savedSize === buf.length, `磁盘=${savedSize} 期望=${buf.length}`);
  check('无 .part 残留', !readdirSync(wdir).some((f) => f.endsWith('.part')));
  check(`速度 ≥ ${minMbps} MB/s`, parseFloat(mbps) >= minMbps, `${MB}MB 耗时 ${ms}ms → ${mbps} MB/s`);

  // 强制写日志（含通过/失败结果，供 API 查证：curl logs/upload-speed-test.log）
  const line = JSON.stringify({ ts: new Date().toISOString(), event: 'upload-speed-test', sizeMb: MB, ms, mbps: parseFloat(mbps), pass: fails === 0, minMbps });
  forceLog(line);
  console.log('结果日志: ' + line);

  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
} finally {
  rmSync(TMP_HOME, { recursive: true, force: true });
}
process.exit(fails ? 1 : 0);