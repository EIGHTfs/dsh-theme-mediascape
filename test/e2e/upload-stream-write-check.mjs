// 上传中间态集成测试（2026-09-2x 重写，新语义「上传中途不落盘 part」）：
// 用真实 lib/handlers.js 的 handleUpload + 隔离 DSH_HOME（临时主题目录，不污染运行态），
// 验证：①上传过程中磁盘**不出现**中间态文件（内存缓冲，可用内存 20% 上限）②end 后正式文件落定
// ③列表过滤 .part/.tmp ④同内容复用命中时不落新盘 ⑤同名不同内容自动 (1) 后缀
// ⑥cleanupOrphanParts 清理孤儿 .part（含 <正式名>.part 暂停快照形态）。零依赖，pass 全绿 exit=0。
import { mkdtempSync, writeFileSync, readdirSync, statSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import os from 'node:os';
import { pathToFileURL } from 'node:url';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');
const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-upload-test-'));
// 隔离 DSH_HOME：handlers.js 内部 wallpaperDir()/musicDir() 读 process.env.DSH_HOME
process.env.DSH_HOME = TMP_HOME;

let fails = 0;
const check = (name, ok, detail) => {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  → ' + detail : ''));
  if (!ok) fails++;
};

// 动态 import handlers.js（确保 DSH_HOME 已设）
const handlers = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href);

// ── 构造假 req/fakeResp：req 是 Readable（可控制推送时机观察 .part 中间态）；fakeResp 收集响应 ──
function makeReqRes() {
  const req = new Readable({ read() {} });
  const fakeResp = {
    status: 0, headers: {}, body: '',
    done: false,
    resolved: Promise.resolve(),
    writeHead(st, hd) { this.status = st; this.headers = Object.assign({}, hd); },
    end(data) { this.body = String(data || ''); this.done = true; },
  };
  // 给 fakeResp 加 donePromise：handler 内 `fakeResp.end(...)` 自动置 done，测试轮询等它
  return { req, fakeResp };
}
// 等待响应完成（轮询 done 标志，最长 2s——handler 有 await sha1OfFile 等异步）
async function waitDone(fakeResp, timeout = 2000) {
  const t0 = Date.now();
  while (!fakeResp.done && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 10));
  }
}
// 推送 body：把 buffer 分多块推（模拟流式到达），每块之间可插入检查回调
async function pump(req, buf, chunkSize = 64 * 1024, onChunk) {
  for (let off = 0; off < buf.length; off += chunkSize) {
    req.push(buf.subarray(off, Math.min(off + chunkSize, buf.length)));
    if (onChunk) onChunk(); // 每块推完后回调（如断言 .part 已存在且大小在增长）
    await new Promise((r) => setImmediate(r)); // 让 data 事件消化（pump 内部，保留）
  }
  req.push(null); // end
}

try {
  const wdir = join(TMP_HOME, 'theme-mediascape', 'wallpaper');
  mkdtempSync(join(wdir, '..')).length; // 预热（无操作，仅占位）
  // 先建目录（真实 handler 内部 mkdir，但 onChunk 回调 readdirSync 需目录已存在）
  const { mkdirSync } = await import('node:fs');
  mkdirSync(wdir, { recursive: true });
  // ── 场景 1：新文件上传——中途**不落盘**（内存缓冲），end 后正式文件落定 ──
  {
    const name = '测试视频.mp4';
    const content = Buffer.alloc(1024 * 1024, 7); // 1MB
    const { req, fakeResp } = makeReqRes();
    req.url = '/theme-mediascape-assets/upload?name=' + encodeURIComponent(name);
    let midFiles = [];
    handlers.handleUpload(req, fakeResp);
    await pump(req, content, 256 * 1024, () => {
      // 每块后记录中间态（.part/.tmp 都不应出现——上传中不落盘）
      midFiles.push(readdirSync(wdir).filter((f) => f.endsWith('.part') || f.endsWith('.tmp')));
    });
    await waitDone(fakeResp);
    const fin = JSON.parse(fakeResp.body);
    check('场景1：响应 200 ok', fakeResp.status === 200 && fin.ok === true, JSON.stringify(fin));
    check('场景1：上传过程中无 .part/.tmp 中间态（中途不落盘）', midFiles.every((arr) => arr.length === 0),
      `观测 ${midFiles.length} 次，中间态出现 ${midFiles.filter((a) => a.length).length} 次`);
    const finalFile = join(wdir, name);
    check('场景1：完成后正式文件落定', existsSync(finalFile), finalFile);
    check('场景1：内容完整（size 相等）', statSync(finalFile).size === content.length, `磁盘=${statSync(finalFile).size} 期望=${content.length}`);
    check('场景1：完成后无 .part/.tmp 残留', !readdirSync(wdir).some((f) => f.endsWith('.part') || f.endsWith('.tmp')));
  }

  // ── 场景 2：列表过滤 .part/.tmp（手工放孤儿中间态，handleList 不应返回它）──
  {
    writeFileSync(join(wdir, '.upload-fake.part'), 'partial-data');
    writeFileSync(join(wdir, '孤儿.png.tmp'), 'partial-tmp');
    const fakeResp = { status: 0, body: '', writeHead(st) { this.status = st; }, end(d) { this.body = String(d); } };
    handlers.handleList(fakeResp);
    await waitDone(fakeResp);
    const list = JSON.parse(fakeResp.body);
    const hasPart = list.items.some((x) => x.url.includes('.part'));
    const hasTmp = list.items.some((x) => x.url.includes('.tmp'));
    check('场景2：列表排除 .part/.tmp 中间态', !hasPart && !hasTmp, `items=${list.items.length}`);
    try { rmSync(join(wdir, '.upload-fake.part')); rmSync(join(wdir, '孤儿.png.tmp')); } catch { /* 忽略 */ }
  }

  // ── 场景 3：同内容复用（再传相同文件 → existing:true，且不新增文件/不残留 .part）──
  {
    // 场景 2 故意放的 fake 残留先清掉（它是测试物，不算本次上传的 .part）
    try { rmSync(join(wdir, '.upload-fake.part')); } catch { /* 忽略 */ }
    const name = '测试视频.mp4';
    const content = Buffer.alloc(1024 * 1024, 7);
    const before = readdirSync(wdir).length;
    const { req, fakeResp } = makeReqRes();
    req.url = '/theme-mediascape-assets/upload?name=' + encodeURIComponent(name);
    handlers.handleUpload(req, fakeResp);
    await pump(req, content);
    await waitDone(fakeResp);
    const fin = JSON.parse(fakeResp.body);
    check('场景3：同内容复用 existing:true', fin.existing === true, JSON.stringify(fin));
    check('场景3：未新增文件、无 .part 残留', readdirSync(wdir).length === before && !readdirSync(wdir).some((f) => f.endsWith('.part')),
      `文件数 ${before} → ${readdirSync(wdir).length}`);
  }

  // ── 场景 4：同名不同大小 → 自动 (1) 后缀（去重规则=文件名+大小：同大小视为重复复用）──
  {
    const name = '测试视频.mp4';
    const content = Buffer.alloc(512 * 1024, 8); // 512KB ≠ 场景3 的 1MB（同名不同大小 → 加后缀落新盘）
    const { req, fakeResp } = makeReqRes();
    req.url = '/theme-mediascape-assets/upload?name=' + encodeURIComponent(name);
    handlers.handleUpload(req, fakeResp);
    await pump(req, content);
    await waitDone(fakeResp);
    const fin = JSON.parse(fakeResp.body);
    check('场景4：同名不同大小 → (1) 后缀不覆盖', fin.existing === false && existsSync(join(wdir, '测试视频(1).mp4')),
      `响应=${JSON.stringify(fin)}`);
  }

  // ── 场景 5：孤儿中间态清理（cleanupOrphanParts：覆盖 .upload-*.tmp 与 *.part（含 <正式名>.part 暂停快照），均超龄才删）──
  {
    const orphan = join(wdir, '.upload-old.part');    // 旧 .upload-*.part 形态
    const orphan2 = join(wdir, '暂停快照.mp4.part');  // 新 <正式名>.part 暂停快照形态
    writeFileSync(orphan, 'x');
    writeFileSync(orphan2, 'y');
    const old = new Date(Date.now() - 2 * 24 * 3600 * 1000);
    // 把两个 .part 的 mtime 改为过期（2 天前），再触发一次上传 → cleanupOrphanParts（默认 24h）应全删
    const { utimesSync } = await import('node:fs');
    try { utimesSync(orphan, old, old); utimesSync(orphan2, old, old); } catch { /* 跳过 */ }
    const { req, fakeResp } = makeReqRes();
    const name2 = '孤儿触发.mp4';
    req.url = '/theme-mediascape-assets/upload?name=' + encodeURIComponent(name2);
    handlers.handleUpload(req, fakeResp);
    await pump(req, Buffer.alloc(1024, 1));
    await waitDone(fakeResp);
    check('场景5：上传触发时清理过期孤儿 .part（含暂停快照形态，mtime>24h）', !existsSync(orphan) && !existsSync(orphan2),
      `orphan 存在=${existsSync(orphan)} orphan2 存在=${existsSync(orphan2)}`);
  }

  console.log(fails ? `\n${fails} 项失败` : '\n全部通过');
} finally {
  rmSync(TMP_HOME, { recursive: true, force: true });
}
process.exit(fails ? 1 : 0);