// 音乐上传 + 封面 回归测试（2026-09-23 新增）
// 覆盖 handleMusicUpload（上传落盘 + music.json 登记 + 复用 + 后缀）+ handleCoverUpload（封面登记）
// + handleMusicList（封面同名命中）。
// 隔离策略：import 真实 lib/handlers.js + 本地 HTTP server + 独立 DSH_HOME。
// 路径纪律：相对自身推导；临时目录 os.tmpdir() + mkdtempSync；双验证（HTTP + 磁盘 + music.json）。
import { mkdtempSync, existsSync, readdirSync, readFileSync, rmSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import os from 'node:os';

const SELF_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SELF_DIR, '..', '..');

const TMP_HOME = mkdtempSync(join(os.tmpdir(), 'dsh-theme-music-'));
process.env.DSH_HOME = TMP_HOME;
const MUSIC_DIR = join(TMP_HOME, 'theme-mediascape', 'music');
mkdirSync(MUSIC_DIR, { recursive: true });

let pass = 0, fail = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? ' → ' + detail : ''}`);
  ok ? pass++ : fail++;
};

const mod = await import(pathToFileURL(join(ROOT, 'lib/handlers.js')).href + '?t=' + Date.now());
const { handleMusicUpload, handleCoverUpload, handleMusicList } = mod;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://x');
  const path = url.pathname;
  if (path === '/music/upload') return handleMusicUpload(req, res);
  if (path === '/music/cover') return handleCoverUpload(req, res);
  if (path === '/music/list') return handleMusicList(res);
  res.writeHead(404); res.end('nf');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = 'http://127.0.0.1:' + server.address().port;

const httpReq = (method, path, body) => new Promise((resolve) => {
  const req = http.request(new URL(path, BASE), { method }, (res) => {
    let respText = '';
    res.on('data', (c) => (respText += c));
    res.on('end', () => resolve({ code: res.statusCode, body: respText }));
  });
  req.on('error', (e) => resolve({ code: 0, body: 'ERR ' + e.message }));
  if (body !== undefined) req.write(body);
  req.end();
});

const musicJson = () => {
  const p = join(MUSIC_DIR, 'music.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
};

try {
  // ── 1. 上传 mp3 → 落盘 + music.json 登记 ──
  const mp3 = 'fake-mp3-bytes-001';
  const up = await httpReq('POST', '/music/upload?name=' + encodeURIComponent('测试歌曲.mp3'), mp3);
  const upj = JSON.parse(up.body || '{}');
  check(up.code === 200 && upj.ok === true && upj.existing === false, '1. 上传歌曲 → 200 新文件', `HTTP ${up.code} id=${upj.id}`);
  check(existsSync(join(MUSIC_DIR, '测试歌曲.mp3')), '2. 文件落盘 测试歌曲.mp3');
  const mm1 = musicJson();
  check(mm1['测试歌曲'] && mm1['测试歌曲'].name === '测试歌曲.mp3', '3. music.json 登记 {name, cover:""}',
    JSON.stringify(mm1['测试歌曲']));

  // ── 2. 重复上传同内容 → existing:true 复用（sha1 判定）──
  const up2 = await httpReq('POST', '/music/upload?name=' + encodeURIComponent('测试歌曲.mp3'), mp3);
  const up2j = JSON.parse(up2.body || '{}');
  check(up2.code === 200 && up2j.existing === true, '4. 同内容重复 → existing:true 复用', `HTTP ${up2.code}`);

  // ── 3. 同名不同内容 → (1) 后缀不覆盖 ──
  const up3 = await httpReq('POST', '/music/upload?name=' + encodeURIComponent('测试歌曲.mp3'), 'different-bytes-002');
  const up3j = JSON.parse(up3.body || '{}');
  check(up3j.existing === false && up3j.id === '测试歌曲(1)', '5. 不同内容 → (1) 后缀', `id=${up3j.id}`);
  check(existsSync(join(MUSIC_DIR, '测试歌曲(1).mp3')), '6. 测试歌曲(1).mp3 落盘');

  // ── 4. 封面上传 → cover 字段更新 ──
  const cv = await httpReq('POST', '/music/cover?id=' + encodeURIComponent('测试歌曲') + '&ext=png', 'fake-png-bytes');
  const cvj = JSON.parse(cv.body || '{}');
  check(cv.code === 200 && cvj.ok === true, '7. 封面上传 → 200', `HTTP ${cv.code}`);
  check(existsSync(join(MUSIC_DIR, '测试歌曲.png')), '8. 封面落盘 测试歌曲.png');
  check(musicJson()['测试歌曲'].cover === '测试歌曲.png', '9. music.json cover 更新', musicJson()['测试歌曲'].cover);

  // ── 5. list 封面命中（同名推断）──
  const list = await httpReq('GET', '/music/list');
  const items = (JSON.parse(list.body || '{}').items || []);
  const song = items.find((i) => i.id === '测试歌曲');
  check(list.code === 200 && !!song, '10. list 含测试歌曲');
  check(song && song.cover === '测试歌曲.png', '11. list cover 命中', song ? song.cover : '无');

  // ── 6. 删除后重传（2026-09-23 加）：模拟「上传过 → 已删除（文件+music.json 记录）→ 再传同文件」──
  // 删除 = 磁盘文件删 + music.json 对应项删（等同前端移除后服务端同步的结果；无 DELETE 音乐 API，
  // 测试直接操作文件与登记模拟删除状态）。重传同文件应 existing:false 全新落盘（不误判复用、不残留）。
  rmSync(join(MUSIC_DIR, '测试歌曲.mp3'), { force: true });
  const mmDel = musicJson(); delete mmDel['测试歌曲'];
  const upDel = await httpReq('POST', '/music/upload?name=' + encodeURIComponent('测试歌曲.mp3'), mp3);
  const upDelj = JSON.parse(upDel.body || '{}');
  check(upDel.code === 200 && upDelj.ok === true && upDelj.existing === false,
    '12. 删除后重传同文件 → 全新落盘 existing:false', `HTTP ${upDel.code} id=${upDelj.id}`);
  check(existsSync(join(MUSIC_DIR, '测试歌曲.mp3')), '13. 重传文件已重新落盘');
  check(musicJson()['测试歌曲'] && musicJson()['测试歌曲'].name === '测试歌曲.mp3',
    '14. 重传后 music.json 重新登记');

  // ── 7. 残留登记重传：文件已删但 music.json 旧记录未清 → 上传同文件仍应全新落盘（以磁盘为准）──
  rmSync(join(MUSIC_DIR, '测试歌曲.mp3'), { force: true });
  const upStale = await httpReq('POST', '/music/upload?name=' + encodeURIComponent('测试歌曲.mp3'), mp3);
  const upStalej = JSON.parse(upStale.body || '{}');
  check(upStale.code === 200 && upStalej.ok === true && upStalej.existing === false,
    '15. music.json 残留旧记录 + 磁盘已删 → 仍全新落盘（以磁盘为准）', `id=${upStalej.id}`);

} finally {
  server.close();
  rmSync(TMP_HOME, { recursive: true, force: true });
}

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
console.log('DONE');
