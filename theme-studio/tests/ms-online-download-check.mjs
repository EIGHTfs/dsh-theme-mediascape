// 在线下载自动测试（2026-09-21 改）：启动本地 HTTP 服务器提供视频/图片/音乐三类测试素材，
// 用独立 DSH_HOME + 临时 sources.json 配置，实测 ensureOnlineDownload 启动时在线下载：
//   - 视频（kind=wallpaper）→ wallpaper/online/<原始文件名>.mp4（落盘用原始名，不再 hash 命名）
//   - 图片（kind=wallpaper）→ wallpaper/online/<原始文件名>.png
//   - 音乐（kind=music）   → music/<原始文件名>.mp3 + music.json[文件名去扩展名] 记录
// 校验点：文件按原始名落盘、SHA-1 与配置 hash 一致、music.json 已登记（壁纸显示名 = 文件名，
// 前端直接显示，不做 hash→显示名 映射）、幂等（已存在跳过）。
// ⚠️ 强制独立 DSH_HOME（不允许继承环境变量，防写入真实数据目录）；sources.json 用临时副本注入。
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, statSync, readdirSync, rmSync, copyFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const D = mkdtempSync(join(os.tmpdir(), 'ms-online-dl-test-'));
const SRC_JSON = join(ROOT, 'lib', 'sources.json');
const SRC_JSON_BAK = SRC_JSON + '.testbak';

process.env.DSH_HOME = D;

// ── 1) 测试素材（本地服务器提供；内容即 hash 源，实测 SHA-1 校验链路）──
const assets = {
  'video-1.mp4': 'fake-mp4-bytes-for-online-dl-test-001',
  'image-1.png': 'fake-png-bytes-for-online-dl-test-002',
  'music-1.mp3': 'fake-mp3-bytes-for-online-dl-test-003',
};
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const hashes = {};
for (const [name, content] of Object.entries(assets)) hashes[name] = sha1(content);

// ── 2) 启动本地 HTTP 服务器（提供 /<name> 静态下载）──
const server = http.createServer((req, res) => {
  const name = decodeURIComponent((req.url || '/').replace(/^\//, ''));
  const content = assets[name];
  if (!content) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'content-type': 'application/octet-stream' });
  res.end(content);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}`;
console.log(`本地下载服务器: ${BASE}（素材: ${Object.keys(assets).join(', ')}）`);

// ── 3) 备份并注入临时 sources.json（含 dirs 不写——目录迁移不属本次范围）──
let hadBackup = false;
if (existsSync(SRC_JSON)) {
  copyFileSync(SRC_JSON, SRC_JSON_BAK);
  hadBackup = true;
}
const testCfg = {
  _comment: '在线下载自动测试注入（ms-online-download-check.mjs）',
  sources: {
    [hashes['video-1.mp4']]: { name: 'video-1.mp4', url: `${BASE}/video-1.mp4`, kind: 'wallpaper' },
    [hashes['image-1.png']]: { name: 'image-1.png', url: `${BASE}/image-1.png`, kind: 'wallpaper' },
    [hashes['music-1.mp3']]: { name: 'music-1.mp3', url: `${BASE}/music-1.mp3`, kind: 'music' },
  },
  dirs: {},
};
writeFileSync(SRC_JSON, JSON.stringify(testCfg, null, 2));

// ── 4) 触发在线下载（动态 import，保证读到注入后的 sources.json）──
try {
  const { ensureOnlineDownload } = await import('../../lib/online.js');
  ensureOnlineDownload();
  // setImmediate 后台执行：轮询等待三个文件全部落盘（最长 15s）
  const deadline = Date.now() + 15000;
  const musicDir = join(D, 'theme-mediascape', 'music');
  const onlineDir = join(D, 'theme-mediascape', 'wallpaper', 'online');
  const want = [
    [join(onlineDir, 'video-1.mp4'), '视频 wallpaper'],
    [join(onlineDir, 'image-1.png'), '图片 wallpaper'],
    [join(musicDir, 'music-1.mp3'), '音乐 music'],
  ];
  let allDone = false;
  while (Date.now() < deadline && !allDone) {
    allDone = want.every(([p]) => existsSync(p) && statSync(p).size > 0);
    if (!allDone) await new Promise((r) => setTimeout(r, 300));
  }

  // ── 5) 断言 ──
  let pass = 0, fail = 0;
  const ok = (cond, msg) => { if (cond) { pass++; console.log(`  ✓ ${msg}`); } else { fail++; console.log(`  ✗ ${msg}`); } };

  console.log('\n── 落盘断言（原始文件名）──');
  for (const [p, label] of want) ok(existsSync(p) && statSync(p).size > 0, `${label} 已落盘: ${p.replace(D, '')}`);

  console.log('\n── SHA-1 校验断言（下载内容与配置 hash 一致）──');
  for (const [name, h] of Object.entries(hashes)) {
    const dir = name.startsWith('music') ? join(D, 'theme-mediascape', 'music') : join(D, 'theme-mediascape', 'wallpaper', 'online');
    const p = join(dir, name); // 落盘名 = 原始文件名（不再 hash 命名）
    if (!existsSync(p)) { ok(false, `${name} 文件缺失，无法校验 hash`); continue; }
    const got = createHash('sha1').update(readFileSync(p)).digest('hex');
    ok(got === h, `${name} sha1 一致 (${got.slice(0, 8)})`);
  }

  console.log('\n── music.json 记录断言 ──');
  const { loadMusicLabels } = await import('../../lib/labels.js');
  const mm = loadMusicLabels();
  const musicBase = 'music-1';
  ok(!!mm[musicBase], `music.json[${musicBase}] 已登记`);
  ok(mm[musicBase]?.name === 'music-1.mp3', `music.json name=${mm[musicBase]?.name}`);

  console.log('\n── 幂等断言（再次触发不重复下载）──');
  const mtimes1 = want.map(([p]) => statSync(p).mtimeMs);
  ensureOnlineDownload(); // onlineStarted 节流：同进程只触发一次，第二次调用应直接返回
  await new Promise((r) => setTimeout(r, 500));
  const mtimes2 = want.map(([p]) => existsSync(p) ? statSync(p).mtimeMs : -1);
  ok(JSON.stringify(mtimes1) === JSON.stringify(mtimes2), '重复触发未改动文件（在线下载节流）');
  const onlineFiles = readdirSync(onlineDir).filter((f) => !f.endsWith('.part'));
  ok(onlineFiles.length === 2, `wallpaper/online 只有视频+图片 2 个文件（实际 ${onlineFiles.length}）`);

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
  if (fail > 0) process.exitCode = 1;
} finally {
  // ── 6) 恢复 sources.json + 关服务器 + 清理测试目录 ──
  server.close();
  if (hadBackup) {
    copyFileSync(SRC_JSON_BAK, SRC_JSON);
    rmSync(SRC_JSON_BAK, { force: true });
    console.log('已恢复 lib/sources.json（原配置还原）');
  } else {
    rmSync(SRC_JSON, { force: true });
  }
  rmSync(D, { recursive: true, force: true });
}
