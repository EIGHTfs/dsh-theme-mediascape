// 壁纸切换日志链路 回归测试（2026-09-23 新增）
// 覆盖 handleWallpaperLog（POST 上报落盘）+ handleWallpaperLogRead（GET 读回）+ writeLog 总开关。
// api-verifiable 核心：切换是否发生有日志可查证（AI/预览页自检依赖此链路，此前无测试）。
// 隔离策略：import 真实 lib/handlers.js + 本地 HTTP server + 独立 DSH_HOME；debug.json log 开关可控。
// 路径纪律：相对自身推导；临时目录 os.tmpdir() + mkdtempSync。
import { mkdtempSync, existsSync, readFileSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-wlog-'));
process.env.DSH_HOME = TMP_HOME;
const DATA_DIR = join(TMP_HOME, 'theme-mediascape');
const LOGS_DIR = join(DATA_DIR, 'logs');
mkdirSync(LOGS_DIR, { recursive: true });

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const { handleWallpaperLog, handleWallpaperLogRead } = mod;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  if (url.pathname === '/wallpaper/log' && req.method === 'POST') return handleWallpaperLog(req, res);
  if (url.pathname === '/wallpaper/log') return handleWallpaperLogRead(req, res, url);
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const httpReq = (method, path, body) => new Promise((resolve) => {
  const req = http.request(new URL(path, BASE), { method, headers: body ? { 'content-type': 'application/json' } : {} }, (res) => {
    let respText = '';
    res.on('data', (c) => (respText += c));
    res.on('end', () => resolve({ code: res.statusCode, body: respText }));
  });
  req.on('error', (e) => resolve({ code: 0, body: 'ERR ' + e.message }));
  if (body !== undefined) req.write(body);
  req.end();
});

try {
  // ── 1. debug.json log 开启（默认三键全 true 由 readDebugConfig 兜底，先显式写）──
  const debugDir = join(TMP_HOME, 'theme-mediascape');
  writeFileSync(join(debugDir, 'debug.json'), JSON.stringify({ log: true }));

  // ── 2. POST 上报一条切换事件 ──
  const post = await httpReq('POST', '/wallpaper/log', JSON.stringify({ event: 'switch', kind: 'image', fromId: '壁纸A', toId: '壁纸B', mode: 'random', label: '测试壁纸' }));
  check(post.code === 200, '1. POST 切换事件 → 200', `HTTP ${post.code}`);

  // ── 3. 磁盘落盘 wallpaper.log ──
  const logFile = join(LOGS_DIR, 'wallpaper.log');
  check(existsSync(logFile), '2. wallpaper.log 已落盘');
  const diskLog = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '';
  check(diskLog.includes('"event":"switch"'), '3. 日志含 event=switch', diskLog.split('\n').filter(Boolean).length + ' 行');

  // ── 4. GET 读回同一条（字段全等）──
  const get = await httpReq('GET', '/wallpaper/log?lines=10');
  const gj = JSON.parse(get.body || '{}');
  check(get.code === 200 && gj.ok === true, '4. GET /wallpaper/log → 200 ok', `HTTP ${get.code} count=${gj.count}`);
  const latest = (gj.lines || [])[gj.lines.length - 1] || {};
  check(latest.event === 'switch' && latest.kind === 'image' && latest.fromId === '壁纸A' && latest.toId === '壁纸B',
    '5. 读回字段全等（event/kind/fromId/toId）', JSON.stringify(latest).slice(0, 80));

  // ── 5. log 关闭 → GET 返回空数组（writeLog 总开关拦截）──
  // ⚠️ readDebugConfig 有 500ms 短缓存（改 debug.json 后≤0.5s 生效）——先等 600ms 越过缓存再断言
  writeFileSync(join(debugDir, 'debug.json'), JSON.stringify({ log: false }));
  await new Promise((r) => setTimeout(r, 600));
  const get2 = await httpReq('GET', '/wallpaper/log?lines=10');
  const g2 = JSON.parse(get2.body || '{}');
  check(g2.lines.length === 0, '6. log 关闭 → 空数组', `count=${g2.count}`);

  // ── 6. 非法 body → 400 ──
  const bad = await httpReq('POST', '/wallpaper/log', '{bad json');
  check(bad.code === 400, '7. 非法 body → 400', `HTTP ${bad.code}`);

} finally {
  server.close();
  rmSync(TMP_HOME, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
console.log('DONE');
