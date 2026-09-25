// 服务端错误路径回归测试（2026-09-23 新增）
// 覆盖 handleUpload / handleDelete / handleWallpaperLog 的错误分支——此前完全无测试，
// boot 移交 bug 能漏到线上的根因就是核心链路无回归。
//
// 隔离策略（与 upload-resume-check 同模式）：import 真实 lib/handlers.js + 本地 HTTP server，
// 设 DSH_HOME 指向隔离临时目录（不走预览服务 30999——那是独立进程，DSH_HOME 无效会污染真实数据）。
// 设计纪律：
//   - 路径全部相对自身推导（dirname(fileURLToPath(import.meta.url))），禁止硬编码绝对路径
//   - 临时数据目录 os.tmpdir() + mkdtempSync，结束清理
//   - 双验证：HTTP 状态码 + 响应体关键字段 + 磁盘无残留文件
import { mkdtempSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-api-err-'));
process.env.DSH_HOME = TMP_HOME;
const WALLPAPER_DIR = join(TMP_HOME, 'theme-mediascape', 'wallpaper');
mkdirSync(WALLPAPER_DIR, { recursive: true });

let passCount = 0, failCount = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`);
  ok ? passCount++ : failCount++;
};

// 真实 handler（隔离 DSH_HOME 生效）
const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const { handleUpload, handleDelete, handleWallpaperLog } = mod;

// 本地 HTTP server：路由到真实 handler（/upload /wallpaper/* /wallpaper/log）
const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const path = url.pathname;
  if (path === '/upload') return handleUpload(req, res);
  if (path.startsWith('/wallpaper/') && req.method === 'DELETE') return handleDelete(req, res, decodeURIComponent(path.slice('/wallpaper/'.length)));
  if (path === '/wallpaper/log') return handleWallpaperLog(req, res);
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = 'http://127.0.0.1:' + PORT;

const httpReq = (method, path, body) => new Promise((resolve) => {
  const u = new URL(path, BASE);
  const req = http.request(u, { method }, (res) => {
    let data = '';
    res.on('data', (c) => (data += c));
    res.on('end', () => resolve({ code: res.statusCode, body: data }));
  });
  req.on('error', (e) => resolve({ code: 0, body: 'ERR ' + e.message }));
  if (body !== undefined) req.write(body);
  req.end();
});

try {
  // ── 1. 非法扩展名 → 400 unsupported type ──
  const r1 = await httpReq('POST', '/upload?name=evil.exe', 'x');
  check(r1.code === 400, '1. 非法扩展名(.exe) → 400', `HTTP ${r1.code} body=${(r1.body || '').slice(0, 50)}`);
  check((r1.body || '').includes('unsupported type'), '   响应含 unsupported type');

  // ── 2. 无扩展名 → 400 ──
  const r2 = await httpReq('POST', '/upload?name=noext', 'x');
  check(r2.code === 400, '2. 无扩展名 → 400', `HTTP ${r2.code}`);

  // ── 3. 合法上传 → 200（基线，确认链路通）──
  const r3 = await httpReq('POST', '/upload?name=ok.png', 'base64img');
  check(r3.code === 200, '3. 合法上传 → 200（基线）', `HTTP ${r3.code}`);
  check(existsSync(join(WALLPAPER_DIR, 'ok.png')), '   文件落盘 ok.png');

  // ── 4. offset>0 续传但 .part 缺失/大小不匹配 → 409（2026-09-2x 新语义：杜绝残缺落盘，前端从头重传）──
  const r4 = await httpReq('POST', '/upload?name=resume.png&offset=100', 'x');
  check(r4.code === 409, '4. 续传 offset>0 但 .part 缺失 → 409', `HTTP ${r4.code}`);
  check((r4.body || '').includes('resume part mismatch'), '   响应含 resume part mismatch');

  // ── 5. DELETE 不存在 → 400 bad file ──
  const r5 = await httpReq('DELETE', '/wallpaper/不存在.png');
  check(r5.code === 400, '5. 删除不存在文件 → 400 bad file', `HTTP ${r5.code}`);

  // ── 6. 非法 log body → 400 bad log entry ──
  const r6 = await httpReq('POST', '/wallpaper/log', '{bad json');
  check(r6.code === 400, '6. 非法 log body → 400', `HTTP ${r6.code}`);

  // ── 7. 磁盘无中间态残留（隔离目录内仅基线 ok.png——409 未落盘）──
  const files = readdirSync(WALLPAPER_DIR);
  check(files.length === 1 && files[0] === 'ok.png' && !files.some((f) => f.endsWith('.part') || f.endsWith('.tmp')),
    '7. 错误路径未产生中间态残留（.part/.tmp）', files.join(', '));

} finally {
  server.close();
  rmSync(TMP_HOME, { recursive: true, force: true });
}

console.log(`\n结果: ${passCount} PASS / ${failCount} FAIL`);
console.log('DONE');
