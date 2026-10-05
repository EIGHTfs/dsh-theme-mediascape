// 移动文件健壮性自动测试（2026-09-21）：手动移动/删除壁纸或音乐文件后，服务端是否仍正常
// 场景覆盖：
//   A. 移动壁纸文件（json 未同步）→ /wallpaper/list 不崩、列表不含被移项
//   B. 移动音乐文件 → /music/list 不崩、music.json 自动同步移除被移项
//   C. json 孤儿记录 + 磁盘文件缺失时再次上传同内容 → 不误判「重复复用不存在文件」（回归 L227 修复）
//   D. 静态 GET 已移动文件 → 404 不崩
//   E. 移回文件 → 列表恢复（服务端无残留损坏）
// ⚠️ 强制独立 DSH_HOME（不允许继承环境变量，防写入真实数据目录）
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, renameSync, readFileSync } from 'node:fs';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { registerAssets } from '../../lib/index.js';
import { saveMusicLabels } from '../../lib/labels.js'; // G 段:写盘走统一入口刷新模块缓存（直接 writeFileSync 绕过缓存读不到）

// 内容寻址 SHA-1（与服务端 handleUpload 同语义）：测试文件 id = sha1(内容)
const sha1 = (s) => createHash('sha1').update(s).digest('hex');
const WP_CONTENT_1 = 'wallpaper-video-content-1';
const WP_CONTENT_2 = 'wallpaper-image-content-2';
const WP_ID_1 = sha1(WP_CONTENT_1); // 真实 digest（孤儿记录主键用这个才命中校验）
const WP_ID_2 = sha1(WP_CONTENT_2);

const D = mkdtempSync(join(os.tmpdir(), 'ms-file-move-test-'));
process.env.DSH_HOME = D;

let registeredHandler = null;
const fakeWctx = { get: (k) => k === 'webServer' ? { register: (cfg) => { registeredHandler = cfg.handler; } } : undefined };
let injectCalled = false;
const fakeCtx = {
  inject(services, cb) { injectCalled = true; if (services.includes('webServer')) cb(fakeWctx); },
};

// ── 1) apply 注册链路 ──
registerAssets(fakeCtx);
console.log('handler 已注册:', !!registeredHandler, '| inject 被调:', injectCalled);

// ── 2) 假 req/res 工具（与 ms-split-behavior-check 同款）──
function makeRes() {
  let status = 0, body = '', headers = {};
  return {
    headers,
    writeHead(s, h) { status = s; headers = h || {}; },
    end(b) { body = typeof b === 'string' ? b : String(b ?? ''); },
    get status() { return status; }, get body() { return body; },
  };
}
function makeReq(method, url) {
  const handlers = {};
  return { method, url, on: (ev, cb) => { handlers[ev] = cb; }, emit(ev, data) { handlers[ev]?.(data); } };
}
const call = (method, url, res) => {
  const r = res || makeRes();
  registeredHandler(makeReq(method, url), r);
  return r;
};
const callUpload = (url, bodyBuf) => {
  const res = makeRes();
  const req = makeReq('POST', url);
  registeredHandler(req, res);
  req.emit('data', bodyBuf);
  req.emit('end');
  return res;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  if (ok) pass++; else fail++;
  console.log((ok ? '✅ PASS' : '❌ FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
};

// ── 0) 构造隔离初始状态（真实文件 + labels，防 list 空目录假阴性）──
const W = join(D, 'theme-mediascape', 'wallpaper');
const M = join(D, 'theme-mediascape', 'music');
rmSync(D, { recursive: true, force: true });
mkdirSync(W, { recursive: true });
mkdirSync(M, { recursive: true });
// 壁纸：两个文件（真实 sha1 内容寻址），wallpaper.json 记录 WP_ID_1 显示名
writeFileSync(join(W, WP_ID_1 + '.mp4'), WP_CONTENT_1, 'utf8');
writeFileSync(join(W, WP_ID_2 + '.png'), WP_CONTENT_2, 'utf8');
writeFileSync(join(W, 'wallpaper.json'), JSON.stringify({ [WP_ID_1]: '移动测试视频' }), 'utf8');
// 音乐：两个文件，music.json 记录
writeFileSync(join(M, 'song-aaa.mp3'), 'music-content-aaa', 'utf8');
writeFileSync(join(M, 'song-bbb.mp3'), 'music-content-bbb', 'utf8');
writeFileSync(join(M, 'music.json'), JSON.stringify({ 'song-aaa': { name: '测试歌A.mp3', cover: '' } }), 'utf8');

// ── A) 初始列表正常 ──
{
  const r = call('GET', '/theme-mediascape-assets/wallpaper/list');
  const ok = r.status === 200 && r.body.includes(WP_ID_1) && r.body.includes(WP_ID_2);
  check('A0 初始壁纸列表', ok, `(status=${r.status} 含2项)`);
}
{
  const r = call('GET', '/theme-mediascape-assets/music/list');
  const ok = r.status === 200 && r.body.includes('song-aaa') && r.body.includes('song-bbb');
  check('A0 初始音乐列表', ok, `(status=${r.status} 含2项)`);
}

// ── B) 移动壁纸文件（模拟手动删文件，json 不碰）→ list 不崩且不含被移项 ──
{
  const moved = join(W, WP_ID_1 + '.mp4');
  renameSync(moved, moved + '.moved'); // 移出目录（改名即移动，同卷原子）
  const r = call('GET', '/theme-mediascape-assets/wallpaper/list');
  const ok = r.status === 200 && !r.body.includes(WP_ID_1) && r.body.includes(WP_ID_2);
  check('B 移动壁纸文件后 list 正常', ok, `(status=${r.status} 只剩 WP_ID_2)`);
}

// ── C) json 孤儿记录 + 磁盘缺失时再传同内容 → 应重新落盘（不误判 existing:true）──
{
  // 移动后 wallpaper.json 仍有 WP_ID_1 孤儿记录（B 场景遗留，正是手动删文件的典型状态）。
  // 2026-09-21 改：上传落盘用原始文件名（重传视频.mp4），不再用 SHA 名；磁盘无同名文件 → 正常落盘。
  const r = callUpload('/theme-mediascape-assets/upload?name=' + encodeURIComponent('重传视频.mp4'), Buffer.from(WP_CONTENT_1));
  await sleep(50);
  const body = r.body;
  const ok = r.status === 200 && !body.includes('existing:true') && body.includes('重传视频');
  check('C json孤儿+磁盘缺失→重新落盘', ok, `(status=${r.status} body=${body.slice(0, 90)})`);
  // 落盘后 list 应重新出现该文件（原始文件名）
  const r2 = call('GET', '/theme-mediascape-assets/wallpaper/list');
  check('C2 重传后列表恢复', r2.body.includes('重传视频'), `(status=${r2.status})`);
}

// ── D) 移动音乐文件 → music/list 不崩 + music.json 自动同步移除 ──
{
  const moved = join(M, 'song-aaa.mp3');
  renameSync(moved, moved + '.moved');
  const r = call('GET', '/theme-mediascape-assets/music/list');
  const ok = r.status === 200 && !r.body.includes('song-aaa') && r.body.includes('song-bbb');
  check('D 移动音乐文件后 list 正常', ok, `(status=${r.status} 只剩 song-bbb)`);
  // music.json 应已自动同步（被移项移除）
  const synced = JSON.parse(readFileSync(join(M, 'music.json'), 'utf8'));
  check('D2 music.json 自动同步移除', !('song-aaa' in synced) && 'song-bbb' in synced, JSON.stringify(synced));
}

// ── E) 静态 GET 已移动文件 → 404 不崩 ──
{
  const r = call('GET', '/theme-mediascape-assets/music/song-aaa.mp3');
  check('E 静态GET已移音乐文件=404', r.status === 404, `(status=${r.status})`);
}

// ── F) 移回文件 → 列表恢复 ──
{
  renameSync(join(M, 'song-aaa.mp3.moved'), join(M, 'song-aaa.mp3'));
  renameSync(join(W, WP_ID_1 + '.mp4.moved'), join(W, WP_ID_1 + '.mp4'));
  const rw = call('GET', '/theme-mediascape-assets/wallpaper/list');
  const rm_ = call('GET', '/theme-mediascape-assets/music/list');
  const ok = rw.body.includes(WP_ID_1) && rm_.body.includes('song-aaa');
  check('F 移回后列表恢复', ok, `(wallpaper=${rw.status} music=${rm_.status})`);
}

// ── G) 封面判定：json cover 文件存在→用 json；存在但文件被删→回退同名/无封面 ──
{
  // G1 初始：json 记录 song-aaa 的 cover=song-aaa.png，且文件存在 → cover 用 json 值
  writeFileSync(join(M, 'song-aaa.png'), 'fake-cover', 'utf8');
  saveMusicLabels({ // 走统一入口（刷新模块缓存），不直接覆盖 music.json
    'song-aaa': { name: '测试歌A.mp3', cover: 'song-aaa.png' },
    'song-bbb': { name: '测试歌B.mp3', cover: 'song-aaa.png' }, // 复用同图（覆盖 bbb 同名 bbb.png 不存在）
  });
  let r = call('GET', '/theme-mediascape-assets/music/list');
  let list = JSON.parse(r.body).items || [];
  const a = list.find((x) => x.id === 'song-aaa');
  const b = list.find((x) => x.id === 'song-bbb');
  check('G1 json cover 存在→用 json 值', a?.cover === 'song-aaa.png' && b?.cover === 'song-aaa.png', `(a=${a?.cover} b=${b?.cover})`);

  // G2 删除封面文件（json 仍记录）→ cover 回退：song-aaa 无同名图（png 已删）→ ''；song-bbb 同
  renameSync(join(M, 'song-aaa.png'), join(M, 'song-aaa.png.moved'));
  r = call('GET', '/theme-mediascape-assets/music/list');
  list = JSON.parse(r.body).items || [];
  const a2 = list.find((x) => x.id === 'song-aaa');
  const b2 = list.find((x) => x.id === 'song-bbb');
  check('G2 json cover 文件被删→回退空(无封面)', a2?.cover === '' && b2?.cover === '', `(a=${a2?.cover} b=${b2?.cover})`);
  // G3 自动同步已清洗孤儿 cover（music.json 不再含 song-aaa.png）
  const syncedG = JSON.parse(readFileSync(join(M, 'music.json'), 'utf8'));
  check('G3 自动同步清洗孤儿 cover', syncedG['song-aaa']?.cover !== 'song-aaa.png', JSON.stringify(syncedG['song-aaa']));
  renameSync(join(M, 'song-aaa.png.moved'), join(M, 'song-aaa.png')); // 还原
}

// ── 汇总 ──
console.log(`\n════ 移动文件健壮性测试 ════ ${pass} PASS / ${fail} FAIL`);
if (fail > 0) process.exitCode = 1;
