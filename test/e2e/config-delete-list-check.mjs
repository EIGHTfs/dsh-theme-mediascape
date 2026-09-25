// 配置读取 + 删除/列表 回归测试（2026-09-23 新增；2026-09-2x 更新：删除=真实删除语义）
// 覆盖 handleConfig（uploadAccept 派生）/ handleDelete（真实删除 unlink）/ handleList（过滤中间态）。
// 隔离策略：import 真实 lib/handlers.js + 本地 HTTP server + 独立 DSH_HOME（不污染真实数据）。
// 路径纪律：相对自身推导；临时目录 os.tmpdir() + mkdtempSync；双验证（HTTP + 磁盘）。
import { mkdtempSync, existsSync, readdirSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-cfg-del-'));
process.env.DSH_HOME = TMP_HOME;
const WALLPAPER_DIR = join(TMP_HOME, 'theme-mediascape', 'wallpaper');
mkdirSync(WALLPAPER_DIR, { recursive: true });

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const { handleConfig, handleDelete, handleList } = mod;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const path = url.pathname;
  if (path === '/config') return handleConfig(res);
  if (path === '/wallpaper/list') return handleList(res);
  if (path.startsWith('/wallpaper/') && req.method === 'DELETE') return handleDelete(req, res, decodeURIComponent(path.slice('/wallpaper/'.length)));
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const httpReq = (method, path) => new Promise((resolve) => {
  const req = http.request(new URL(path, BASE), { method }, (res) => {
    let respText = '';
    res.on('data', (c) => (respText += c));
    res.on('end', () => resolve({ code: res.statusCode, body: respText }));
  });
  req.on('error', (e) => resolve({ code: 0, body: 'ERR ' + e.message }));
  req.end();
});

try {
  // ── A. 配置读取 ──
  const cfg = await httpReq('GET', '/config');
  const cfgJson = JSON.parse(cfg.body || '{}');
  check(cfg.code === 200 && cfgJson.ok === true, 'A1. GET /config → 200 ok', `HTTP ${cfg.code}`);
  check(typeof cfgJson.uploadAccept === 'string' && cfgJson.uploadAccept.includes('.png') && cfgJson.uploadAccept.includes('.mp4'),
    'A2. uploadAccept 含 .png/.mp4（与 ALLOWED_UPLOAD_EXT 派生一致）', cfgJson.uploadAccept || '');

  // ── B. 删除 + 列表 ──
  // 预置两个壁纸文件 + 一个孤儿 .part
  writeFileSync(join(WALLPAPER_DIR, '壁纸A.png'), 'pngA');
  writeFileSync(join(WALLPAPER_DIR, '壁纸B.jpg'), 'jpgB');
  writeFileSync(join(WALLPAPER_DIR, '.upload-orphan123.part'), 'partial');

  const list1 = await httpReq('GET', '/wallpaper/list');
  const items1 = (JSON.parse(list1.body || '{}').items || []).map((i) => i.id);
  check(list1.code === 200 && items1.includes('壁纸A') && items1.includes('壁纸B'), 'B1. list 返回预置壁纸', items1.join(','));
  check(!items1.some((i) => i.includes('.part')), 'B2. list 过滤孤儿 .part', items1.join(','));

  // 2026-09-23 改：删除 = 真实删除（unlink 运行态文件）——「移除=删除运行态文件，list 刷新显示」。
  const del = await httpReq('DELETE', '/wallpaper/' + encodeURIComponent('壁纸A.png'));
  check(del.code === 200, 'B3. DELETE 壁纸A → 200', `HTTP ${del.code}`);
  const after = readdirSync(WALLPAPER_DIR);
  check(!after.includes('壁纸A.png'), 'B4. 壁纸A 已移出正式名', after.join(','));
  check(!after.some((f) => f.includes('壁纸A')), 'B5. 壁纸A 已真实删除（不进 .trash 回收）', after.join(','));

  const list2 = await httpReq('GET', '/wallpaper/list');
  const items2 = (JSON.parse(list2.body || '{}').items || []).map((i) => i.id);
  check(!items2.includes('壁纸A'), 'B6. list 不再返回已删壁纸A', items2.join(','));
  check(items2.includes('壁纸B'), 'B7. 壁纸B 仍保留', items2.join(','));

} finally {
  server.close();
  rmSync(TMP_HOME, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
console.log('DONE');
