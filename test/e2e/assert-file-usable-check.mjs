// 素材「真实可用」统一判断测试（2026-09-2x 新增，定稿）：
// 壁纸/音乐列表只返回「磁盘真实存在可 stat」的项——文件被外部移动/删除后立即从列表剔除（失效过滤），
// 前端上传去重基准与移除目标只认可用项（isItemUsable：file/name + size 数字）。
// 验证：①上传落盘的项全部 usable（file+size）②删除文件 → 列表剔除 ③移动文件 → 列表剔除
// ④music.json 孤儿记录随列表同步清洗 ⑤前端 isItemUsable 判定契约（size 数字=可用 / null=失效）。
// 隔离策略：import 真实 lib/handlers.js + 本地 HTTP server + 独立 DSH_HOME（不污染真实数据）。
import { mkdtempSync, writeFileSync, readdirSync, rmSync, mkdirSync, renameSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');
const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-usable-'));
process.env.DSH_HOME = TMP_HOME;
const WALLPAPER_DIR = join(TMP_HOME, 'theme-mediascape', 'wallpaper');
const MUSIC_DIR = join(TMP_HOME, 'theme-mediascape', 'music');
mkdirSync(WALLPAPER_DIR, { recursive: true });
mkdirSync(MUSIC_DIR, { recursive: true });

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const { handleList, handleMusicList, handleMusicDelete } = mod;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const path = url.pathname;
  if (path === '/theme-mediascape-assets/wallpaper/list') return handleList(res);
  if (path === '/theme-mediascape-assets/music/list') return handleMusicList(res);
  // DELETE /theme-mediascape-assets/music/<file> → 真实删除（按 music.json 一并删封面）
  if (path.startsWith('/theme-mediascape-assets/music/') && req.method === 'DELETE') {
    return handleMusicDelete(req, res, decodeURIComponent(path.slice('/theme-mediascape-assets/music/'.length)));
  }
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;
const httpGet = (path) => fetch(BASE + path, { signal: AbortSignal.timeout(10000) }).then((r) => r.json());

// 前端 isItemUsable 判定契约（与 lib/client-parts/scenes/upload.js 公共函数同源）：
// file/name 存在 且 size 为 ≥0 数字 = 磁盘 stat 成功（真实可用）；size null/undefined = 失效。
const isItemUsable = (item) => !!(item && (item.file || item.name) && typeof item.size === 'number' && item.size >= 0);

try {
  // ── 1. 预置素材（模拟上传落盘结果：壁纸 3 + 音乐 2 + 音乐封面 1）──
  writeFileSync(join(WALLPAPER_DIR, '壁纸A.png'), 'pngA');
  writeFileSync(join(WALLPAPER_DIR, '壁纸B.jpg'), 'jpgB');
  writeFileSync(join(WALLPAPER_DIR, '视频C.webm'), 'webmC');
  writeFileSync(join(MUSIC_DIR, '歌曲1.mp3'), 'mp3-1');
  writeFileSync(join(MUSIC_DIR, '歌曲2.mp3'), 'mp3-2');
  writeFileSync(join(MUSIC_DIR, '歌曲1.png'), 'cover1');

  let wl = (await httpGet('/theme-mediascape-assets/wallpaper/list')).items;
  check('壁纸列表返回全部 3 项（含 webm 视频）', wl.length === 3 && wl.some((x) => x.file === '视频C.webm' && x.kind === 'video'), wl.map((x) => x.file).join(','));
  check('壁纸列表项全部「真实可用」（file + size 数字）', wl.every(isItemUsable), JSON.stringify(wl.map((x) => ({ f: x.file, s: x.size }))));
  let ml = (await httpGet('/theme-mediascape-assets/music/list')).items;
  check('音乐列表返回全部 2 项', ml.length === 2, ml.map((x) => x.name).join(','));
  check('音乐列表项全部「真实可用」（file + size 数字）', ml.every(isItemUsable), JSON.stringify(ml.map((x) => ({ f: x.file, s: x.size }))));

  // ── 2. 删除文件 → 列表立即剔除（失效过滤）──
  rmSync(join(WALLPAPER_DIR, '壁纸A.png'));
  rmSync(join(MUSIC_DIR, '歌曲2.mp3'));
  wl = (await httpGet('/theme-mediascape-assets/wallpaper/list')).items;
  check('删除壁纸A 后列表剔除（消失文件不出现在列表）', !wl.some((x) => x.file === '壁纸A.png'), wl.map((x) => x.file).join(','));
  ml = (await httpGet('/theme-mediascape-assets/music/list')).items;
  check('删除歌曲2 后列表剔除', !ml.some((x) => x.file === '歌曲2.mp3'), ml.map((x) => x.file).join(','));

  // ── 3. 移动文件（外部改名/挪走）→ 列表剔除原项 ──
  renameSync(join(WALLPAPER_DIR, '壁纸B.jpg'), join(WALLPAPER_DIR, '壁纸B-改名.jpg'));
  wl = (await httpGet('/theme-mediascape-assets/wallpaper/list')).items;
  check('移动壁纸B 后列表剔除原项、只含新名', !wl.some((x) => x.file === '壁纸B.jpg') && wl.some((x) => x.file === '壁纸B-改名.jpg'), wl.map((x) => x.file).join(','));

  // ── 4. 残留 .part/.tmp 中间态不入列表（仍过滤）──
  writeFileSync(join(WALLPAPER_DIR, '孤儿.mp4.part'), 'partial');
  wl = (await httpGet('/theme-mediascape-assets/wallpaper/list')).items;
  check('残留 .part 不入列表', !wl.some((x) => x.file.endsWith('.part')), wl.map((x) => x.file).join(','));

  // ── 5. 前端 isItemUsable 判定契约 ──
  check('契约：size 数字=可用 / null=失效 / 无 file=失效',
    isItemUsable({ file: 'a.png', size: 10 }) === true &&
    isItemUsable({ file: 'a.png', size: null }) === false &&
    isItemUsable({ file: 'a.png' }) === false &&
    isItemUsable({ name: 'a.mp3', size: 5 }) === true,
    '');

  // ── 6. 移除音乐 → 按 music.json 一并删除封面 + 清登记录（定稿「移除=删文件，封面随 music.json 移除」）──
  writeFileSync(join(MUSIC_DIR, 'music.json'), JSON.stringify({ '歌曲1': { name: '歌曲1.mp3', cover: '歌曲1.png' } }, null, 2));
  const del = await fetch(BASE + '/theme-mediascape-assets/music/' + encodeURIComponent('歌曲1.mp3'), { method: 'DELETE', signal: AbortSignal.timeout(10000) }).then((r) => r.json());
  check('删除音乐响应 ok（含 cover 字段）', del.ok === true && del.cover === '歌曲1.png', JSON.stringify(del));
  check('歌曲1.mp3 已删除', !existsSync(join(MUSIC_DIR, '歌曲1.mp3')));
  check('封面 歌曲1.png 已按 music.json 一并删除', !existsSync(join(MUSIC_DIR, '歌曲1.png')));
  const jsonLeft = JSON.parse(await (await import('node:fs/promises')).readFile(join(MUSIC_DIR, 'music.json'), 'utf8').catch(() => '{}'));
  check('music.json 登记已清除（歌曲1 无记录）', !jsonLeft['歌曲1'], JSON.stringify(jsonLeft));

  // ── 7. 同名推断封面（music.json 未记录/未同步）→ 删除音乐时一并扫描删除（实测「只能临时移除封面」修复）──
  writeFileSync(join(MUSIC_DIR, '歌曲2.mp3'), 'mp3-2');
  writeFileSync(join(MUSIC_DIR, '歌曲2.png'), 'infer-cover'); // 同名图片 = 推断封面（json 无 cover 记录）
  writeFileSync(join(MUSIC_DIR, 'music.json'), '{}');          // 不先列表 → json 未自动同步
  const del2 = await fetch(BASE + '/theme-mediascape-assets/music/' + encodeURIComponent('歌曲2.mp3'), { method: 'DELETE', signal: AbortSignal.timeout(10000) }).then((r) => r.json());
  check('删除响应 ok', del2.ok === true && del2.id === '歌曲2', JSON.stringify(del2));
  check('歌曲2.mp3 已删除', !existsSync(join(MUSIC_DIR, '歌曲2.mp3')));
  check('同名推断封面 歌曲2.png 也一并删除（不残留，重传不重现）', !existsSync(join(MUSIC_DIR, '歌曲2.png')));
  // 删除后 json 自动重新生成（再次列表按目录重建，不含被删项）
  await fetch(BASE + '/theme-mediascape-assets/music/list', { signal: AbortSignal.timeout(10000) });
  const jsonAfter = JSON.parse(await (await import('node:fs/promises')).readFile(join(MUSIC_DIR, 'music.json'), 'utf8').catch(() => '{}'));
  check('music.json 自动重建且不含被删项（歌曲2 无记录）', !jsonAfter['歌曲2'], JSON.stringify(jsonAfter));

  console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
} finally {
  server.close();
  rmSync(TMP_HOME, { recursive: true, force: true });
}
process.exit(fail ? 1 : 0);
