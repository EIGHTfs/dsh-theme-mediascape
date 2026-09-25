// 断点续传集成测试（2026-09-2x 重写，新语义「上传中途不落盘 part，暂停落盘 part，继续从 part 续传」）：
// 用真实 lib/handlers.js 的 handleUpload/handleUploadPartDelete + 隔离 DSH_HOME，模拟新协议：
// ①首程传一半（client 侧 mock：推一半后 destroy 连接=暂停）→ 服务端把已收内存缓冲落盘 <正式名>.part（暂停快照）
// ②「继续」= 二程带 ?offset=<半程> 续传（append 进同一个 <正式名>.part）→ 收完 rename 落定完整文件
// ③校验：最终文件 size == 原文件、无 .part 残留、第二次请求没有重传已传部分
// ④取消 = DELETE /upload/part?name=<文件>：清理对应 <正式名>.part（HUD「取消」按钮路径）
// 用法：node test/e2e/upload-resume-check.mjs；零依赖，全绿 exit=0。
import { mkdtempSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');
const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-upload-resume-'));
process.env.DSH_HOME = TMP_HOME;

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
  if (!ok) fails++;
};

const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const handleUpload = mod.handleUpload;
const handleUploadPartDelete = mod.handleUploadPartDelete;

// ── 假 req/res（真实 handler 只依赖 req.on/req.url/req.headers + res.writeHead/res.end）──
function makeReq(reqUrl) {
  const req = new Readable({ read() {} });
  req.url = reqUrl;
  req.headers = {};
  return req;
}
function makeRes() {
  const res = {
    status: 0, body: '', done: false,
    writeHead(st) { this.status = st; },
    end(d) { this.body = String(d || ''); this.done = true; },
  };
  return res;
}
async function waitDone(res, timeout = 2000) {
  const t0 = Date.now();
  while (!res.done && Date.now() - t0 < timeout) await new Promise((r) => setTimeout(r, 10));
}
async function pump(req, buf, chunkSize = 128 * 1024) {
  for (let off = 0; off < buf.length; off += chunkSize) {
    req.push(buf.subarray(off, Math.min(off + chunkSize, buf.length)));
    await new Promise((r) => setImmediate(r));
  }
  req.push(null);
}

try {
  const wdir = join(TMP_HOME, 'theme-mediascape', 'wallpaper');
  const { mkdirSync } = await import('node:fs');
  mkdirSync(wdir, { recursive: true });

  // ── 场景 A：首程传一半 → 服务端落盘 <正式名>.part（暂停快照，大小为已收半程）──
  const name = '续传测试.mp4';
  const full = Buffer.alloc(4 * 1024 * 1024, 9); // 4MB
  const half = Math.floor(full.length / 2);
  const partPath = join(wdir, name + '.part');
  let partSizeAfterHalf = -1;
  {
    const req = makeReq('/theme-mediascape-assets/upload?name=' + encodeURIComponent(name));
    const res = makeRes();
    handleUpload(req, res);
    // 只推一半就 destroy（模拟暂停：前端 abort 使连接中断）
    const halfBuf = full.subarray(0, half);
    for (let off = 0; off < halfBuf.length; off += 128 * 1024) {
      req.push(halfBuf.subarray(off, Math.min(off + 128 * 1024, halfBuf.length)));
      await new Promise((r) => setImmediate(r));
    }
    req.destroy(); // 中断连接（暂停）
    await new Promise((r) => setTimeout(r, 150));
    check('场景A：暂停后 <正式名>.part 快照存在', existsSync(partPath), partPath);
    if (existsSync(partPath)) partSizeAfterHalf = statSync(partPath).size;
    check('场景A：.part 大小 = 已传半程（内存缓冲整体落盘）', partSizeAfterHalf === half,
      `part=${partSizeAfterHalf} 半程=${half}`);
    check('场景A：正式文件尚未落定', !existsSync(join(wdir, name)), '暂停不产生正式文件');
  }

  // ── 场景 B：二程带 ?offset= 续传（append 进同一个 .part）→ rename 落定完整文件 ──
  let finalSize = -1;
  {
    const offset = partSizeAfterHalf > 0 ? partSizeAfterHalf : 0;
    const req = makeReq('/theme-mediascape-assets/upload?name=' + encodeURIComponent(name) + '&offset=' + offset);
    const res = makeRes();
    handleUpload(req, res);
    // 只发剩余部分（offset 之后）
    const rest = full.subarray(offset);
    await pump(req, rest);
    await waitDone(res);
    const j = JSON.parse(res.body);
    check('场景B：续传响应 200 ok', res.status === 200 && j.ok === true, `status=${res.status} ${JSON.stringify(j)}`);
    check('场景B：响应 uploaded = 本次续传字节', typeof j.uploaded === 'number' && j.uploaded === full.length - offset,
      `uploaded=${j.uploaded} 期望=${full.length - offset}`);
    finalSize = statSync(join(wdir, name)).size;
    check('场景B：完整文件落定（size = 原文件）', finalSize === full.length, `磁盘=${finalSize} 期望=${full.length}`);
    check('场景B：无 .part 残留', !readdirSync(wdir).some((f) => f.endsWith('.part')));
  }

  // ── 场景 C：取消 = DELETE /upload/part?name=<文件> 清理暂停快照 .part（HUD「取消」路径）──
  {
    // 制造一个暂停快照（<正式名>.part），再调取消清理 API
    const fakePart = '取消测试.mp4.part';
    writeFileSync(join(wdir, fakePart), 'partial-data');
    const req = makeReq('/theme-mediascape-assets/upload/part?name=' + encodeURIComponent('取消测试.mp4'));
    const res = makeRes();
    handleUploadPartDelete(req, res);
    await waitDone(res);
    const j2 = JSON.parse(res.body);
    check('场景C：取消清理响应 ok', res.status === 200 && j2.ok === true, JSON.stringify(j2));
    check('场景C：.part 已清理', !existsSync(join(wdir, fakePart)));
    check('场景C：返回 removed=1', j2.removed === 1, `removed=${j2.removed}`);
  }

  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
} finally {
  rmSync(TMP_HOME, { recursive: true, force: true });
}
process.exit(fails ? 1 : 0);
