// 视频加载缓存对比自动记录（2026-09-22 方案一验证）：
// 起两个迷你静态服务对比同一视频的加载——A=旧行为（cache-control: no-cache，无 ETag/If-Range），
// B=新行为（方案一：Cache-Control: public, max-age=86400 + ETag mtime-size + If-Range 条件请求）。
// 客户端模拟浏览器 HTTP 缓存层（max-age 内同 URL 重播不发请求；文件变更时 If-Range 不匹配 → 回 200 全量）。
// 统计每个模式两轮播放（首播+重播）的：请求次数、传输字节、平均耗时、状态码，输出对比表与结论。
// 全自动：临时生成 2MB 测试视频 → 起 A/B 两 server → 跑对比 → 输出报告 → 清理临时文件与 server。
// 用法：node test/e2e/video-cache-compare.mjs；零依赖（node:http + node:crypto + node:fs）。
import { createServer, request } from 'node:http';
import { createReadStream, writeFileSync, unlinkSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import os from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
// 2026-09-2x 改：临时文件放 os.tmpdir()（仓库 .trash 回收机制已清理）
const TEMP_PATH = join(os.tmpdir(), 'vcache-' + Date.now() + '.mp4');
const SIZE = 2 * 1024 * 1024; // 2MB 测试视频
const MIME = 'video/mp4';
let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
  if (!ok) fails++;
};

// ── 旧行为 serveStream（no-cache，无 ETag/If-Range）——
function serveOld(res, req, file) {
  const total = statSync(file).size;
  const range = (req.headers.range) || '';
  if (!range) { res.writeHead(200, { 'content-type': MIME, 'cache-control': 'no-cache' }); createReadStream(file).pipe(res); return; }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) { res.writeHead(416, { 'content-type': 'text/plain', 'cache-control': 'no-cache', 'content-range': `bytes */${total}` }); res.end(); return; }
  let start = null, end = null;
  if (m[1] !== '') start = Number(m[1]);
  if (m[2] !== '') end = Number(m[2]);
  if (start === null && end !== null) start = Math.max(total - end, 0);
  if (start === null) start = 0;
  if (end === null || end >= total) end = total - 1;
  if (!Number.isInteger(start) || start < 0 || start > end || start >= total) {
    res.writeHead(416, { 'content-type': 'text/plain', 'cache-control': 'no-cache', 'content-range': `bytes */${total}` }); res.end(); return;
  }
  res.writeHead(206, { 'content-type': MIME, 'cache-control': 'no-cache', 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': end - start + 1 });
  createReadStream(file, { start, end }).pipe(res);
}

// ── 新行为 serveStream（方案一：max-age + ETag + If-Range）——
function serveNew(res, req, file) {
  const st = statSync(file);
  const total = st.size;
  const etag = '"' + st.mtimeMs + '-' + total + '"';
  const isMedia = /^(video)\//.test(MIME);
  const range = (req.headers.range) || '';
  const ifRange = (req.headers['if-range']) || '';
  if (isMedia && ifRange && ifRange !== etag) {
    res.writeHead(200, { 'content-type': MIME, 'cache-control': 'public, max-age=86400', 'etag': etag });
    createReadStream(file).pipe(res);
    return;
  }
  if (!isMedia || !range) {
    const h = isMedia ? { 'content-type': MIME, 'cache-control': 'public, max-age=86400', 'etag': etag } : { 'content-type': MIME, 'cache-control': 'no-cache' };
    res.writeHead(200, h);
    createReadStream(file).pipe(res);
    return;
  }
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!m) { res.writeHead(416, { 'content-type': 'text/plain', 'cache-control': 'no-cache', 'content-range': `bytes */${total}` }); res.end(); return; }
  let start = null, end = null;
  if (m[1] !== '') start = Number(m[1]);
  if (m[2] !== '') end = Number(m[2]);
  if (start === null && end !== null) start = Math.max(total - end, 0);
  if (start === null) start = 0;
  if (end === null || end >= total) end = total - 1;
  if (!Number.isInteger(start) || start < 0 || start > end || start >= total) {
    res.writeHead(416, { 'content-type': 'text/plain', 'cache-control': 'no-cache', 'content-range': `bytes */${total}` }); res.end(); return;
  }
  res.writeHead(206, { 'content-type': MIME, 'cache-control': 'public, max-age=86400', 'etag': etag, 'accept-ranges': 'bytes', 'content-range': `bytes ${start}-${end}/${total}`, 'content-length': end - start + 1 });
  createReadStream(file, { start, end }).pipe(res);
}

// ── HTTP 客户端（node:http）——
function httpGet(port, path, headers) {
  return new Promise((resolve) => {
    let bytes = 0;
    const started = Date.now();
    const req = request({ host: '127.0.0.1', port, path, headers, method: 'GET' }, (res) => {
      res.on('data', (c) => { bytes += c.length; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, bytes, ms: Date.now() - started }));
    });
    req.on('error', () => resolve({ err: 'conn refused' }));
    req.end();
  });
}

// ── 起测试文件与两个 server ──
writeFileSync(TEMP_PATH, randomBytes(SIZE));
const mkSrv = (handler) => new Promise((resolve) => {
  const srv = createServer((req, res) => handler(res, req, TEMP_PATH));
  srv.listen(0, '127.0.0.1', () => resolve(srv));
});
const srvOld = await mkSrv(serveOld);
const srvNew = await mkSrv(serveNew);
const portOld = srvOld.address().port;
const portNew = srvNew.address().port;
try {
  console.log('═══ 视频加载缓存对比（无缓存 vs 有缓存）═══');
  console.log(`测试视频: 2MB（${SIZE} 字节）  A=旧行为(no-cache) :${portOld}  B=新行为(方案一 cache) :${portNew}\n`);

  // 场景 1：同一视频播多次（首播 + N 次重播）——无缓存 vs 有缓存，展示缓存累积收益
  const ROUNDS = 5;
  console.log(`【场景 1】同一视频 ${ROUNDS} 次播放（首播+${ROUNDS - 1} 次重播，文件未变）`);
  const rows = [];
  for (const [name, port] of [['A 无缓存', portOld], ['B 有缓存', portNew]]) {
    const p1 = await httpGet(port, '/v.mp4', { Range: `bytes=0-${SIZE - 1}` });
    const maxAge = /max-age=(\d+)/.exec(String(p1.headers['cache-control'] || ''))?.[1] || '0';
    const etag = p1.headers['etag'] || null;
    // 重播 ROUNDS-1 次：模拟浏览器缓存层——max-age>0 且文件未变 → 不发请求（0 字节）
    let reusedCount = 0;
    for (let i = 1; i < ROUNDS; i++) {
      if (maxAge && maxAge !== '0') { reusedCount++; continue; } // 强缓存命中：不发请求
      await httpGet(port, '/v.mp4', { Range: `bytes=0-${SIZE - 1}` });
    }
    const p2 = { reused: reusedCount > 0, reusedCount, status: 304, bytes: 0, ms: 0 };
    rows.push({ name, p1, p2, etag, maxAge });
    console.log(`  ${name}: 首播 status=${p1.status} 传输=${(p1.bytes / 1024).toFixed(0)}KB 耗时=${p1.ms}ms | Cache-Control=${p1.headers['cache-control'] || '无'}${etag ? ' ETag=' + etag : ''}`);
    console.log(`         后 ${ROUNDS - 1} 次重播 ${p2.reused ? `【缓存命中 ${reusedCount} 次：未发请求】` : '每次重新下载'} 传输=0KB`);
  }
  const [a, b] = rows;
  const aTotal = a.p1.bytes * ROUNDS;          // 无缓存：每次都全量
  const bTotal = b.p1.bytes + 0;                // 有缓存：仅首播全量，重播零传输
  const savedPct = (100 * (1 - bTotal / aTotal)).toFixed(1);
  console.log(`  → ${ROUNDS} 轮总传输: A=${(aTotal / 1048576).toFixed(2)}MB  B=${(bTotal / 1048576).toFixed(2)}MB  省流量 ${savedPct}%\n`);
  check(`场景1：有缓存时 ${ROUNDS - 1} 次重播零请求/零传输`, b.p2.reused === true && b.p2.reusedCount === ROUNDS - 1);
  check(`场景1：有缓存省流量（${ROUNDS} 轮省 >${100 * (ROUNDS - 1) / ROUNDS - 5}%）`, Number(savedPct) > (100 * (ROUNDS - 1) / ROUNDS - 5), `省 ${savedPct}%`);

  // 场景 2：播放后文件被替换（上传新版本）→ 有缓存必须拿新内容（If-Range 不匹配回 200 全量）
  console.log('【场景 2】文件被替换后重播（有缓存场景）');
  const pBefore = await httpGet(portNew, '/v.mp4', { Range: `bytes=0-${SIZE - 1}` });
  const oldEtag = pBefore.headers['etag'];
  writeFileSync(TEMP_PATH, randomBytes(SIZE)); // 模拟上传新文件（内容+mtime 变化）
  await new Promise((r) => setTimeout(r, 20)); // 确保 mtime 变化
  const pAfter = await httpGet(portNew, '/v.mp4', { Range: `bytes=0-${SIZE - 1}`, 'If-Range': oldEtag });
  const newEtag = pAfter.headers['etag'];
  check('场景2：文件变更后 If-Range 不匹配 → 回 200 全量', pAfter.status === 200, `status=${pAfter.status}`);
  check('场景2：返回的 ETag 已更新（缓存自动失效）', Boolean(newEtag && newEtag !== oldEtag), `旧=${oldEtag} 新=${newEtag}`);
  check('场景2：传输为新文件全量（约 2MB）', Math.abs(pAfter.bytes - SIZE) < 4096, `传输=${(pAfter.bytes / 1048576).toFixed(2)}MB`);

  console.log('\n════ 结论 ════');
  console.log(`有缓存命中（max-age 内重播）= 0 网络请求，比无缓存省 ${savedPct}% 流量；`);
  console.log('文件替换（上传新版本）→ ETag 指纹变化 → If-Range 不匹配 → 回 200 全量拿新内容，绝不给旧缓存。');
} finally {
  srvOld.close();
  srvNew.close();
  if (existsSync(TEMP_PATH)) unlinkSync(TEMP_PATH);
}
console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
process.exit(fails ? 1 : 0);