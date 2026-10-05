// HTTP 上传处理器（2026-09-2x 从 handlers.js 拆出：上传接收/缓冲/续传/清理/去重落定）
// 与 handlers.js 同目录；handlers.js 经 re-export 保对外 API（index.js import 不变）。

import { existsSync, statSync, mkdirSync, readFileSync, readdirSync, renameSync, createReadStream, createWriteStream, writeFileSync, unlinkSync, openSync, readSync, closeSync, appendFileSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { join, normalize, extname, basename } from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { ALLOWED_UPLOAD_EXT, ALLOWED_MUSIC_UPLOAD_EXT, ALLOWED_COVER_UPLOAD_EXT, VIDEO_EXT, UPLOAD_ACCEPT, uploadLimitBytes } from './config.js';
import { musicDir, wallpaperDir, onlineDir } from './paths.js';
import { readDebugConfig, logEnabled } from './debug.js';
import { loadLabels, loadMusicLabels, saveLabels, saveMusicLabels } from './labels.js';
import { nextAvailableName, uploadErrorResponse, finalizeUpload } from './handlers-log.js';

// 响应头与 URL 前缀公共片段（与 handlers.js 各自一份——避免循环依赖）
const HDR_JSON = { 'content-type': 'application/json; charset=utf-8' };
const WP_PREFIX = '/theme-mediascape-assets/wallpaper/';
const MUSIC_PREFIX = '/theme-mediascape-assets/music/';

// 内存缓冲上限 = 可用内存 20%（下限 16MB，防低内存机器算出过小阈值频繁转 tmp）
const MEM_BUFFER_RATIO = 0.2;
const MEM_BUFFER_FLOOR = 16 * 1024 * 1024;
function memBufferLimit() {
  return Math.max(MEM_BUFFER_FLOOR, Math.floor(os.freemem() * MEM_BUFFER_RATIO));
}

function receiveBody(req, { tmpPath, partPath, limit, offset = 0 }) {
  return new Promise((resolve) => {
    let size = 0;
    let aborted = false;      // 超限（413）
    let interrupted = false;  // 请求中断（暂停/取消/断网 → 落 .part 快照，非错误）
    let settled = false;
    let ended = false;
    let mode = offset > 0 ? 'part' : 'buffer'; // 续传=直接 append .part；常规=先内存（不落盘）
    let chunks = [];
    let ws = null;
    let paused = false;
    const tryResume = () => { if (paused && !aborted) { paused = false; req.resume(); } };
    const settle = (v) => { if (!settled) { settled = true; resolve(v); } };
    const dropWs = () => { if (ws) { try { ws.destroy(); } catch { /* 已关闭则忽略 */ } ws = null; } };
    // buffer → .part 落盘（暂停快照）并释放内存（硬约束：落盘即释放）
    const flushBufferToPart = () => {
      if (!chunks || chunks.length === 0) return;
      try { writeFileSync(partPath, Buffer.concat(chunks)); } catch (e) { console.error('[upload] 暂停落盘 .part 失败:', e?.message ?? e); }
      chunks.length = 0; chunks = null;
    };
    if (mode === 'part') {
      try { ws = createWriteStream(partPath, { flags: 'a' }); ws.on('drain', tryResume); } catch { ws = null; }
    }
    req.on('data', (c) => {
      if (aborted) return;
      size += c.length;
      if (size > limit) {
        // 超限：清理中间态，drain 剩余 body（等客户端发完自然关闭，保持反代 keep-alive 连接池健康）
        aborted = true;
        dropWs();
        if (mode === 'buffer') chunks = null;
        else { try { unlinkSync(mode === 'tmp' ? tmpPath : partPath); } catch { /* 未创建则忽略 */ } }
        req.on('data', () => {});
        req.resume();
        settle({ aborted: true });
        return;
      }
      if (mode === 'buffer') {
        if (size > memBufferLimit()) {
          // 超内存缓冲上限（可用内存 20%）：转写 .tmp 保底（合并已收 buffer 续写，功能不变仅保留中间态）
          mode = 'tmp';
          try {
            ws = createWriteStream(tmpPath);
            ws.on('drain', tryResume);
            ws.write(Buffer.concat(chunks));
            chunks = null;
          } catch (e) {
            console.error('[upload] 转写 .tmp 失败:', e?.message ?? e);
            ws = null; mode = 'buffer'; chunks.push(c); // 极端 IO 错误退回内存（宁可占内存不丢数据）
            return;
          }
        } else {
          chunks.push(c);
          return;
        }
      }
      // tmp / part 模式：边收边写（写缓冲满 → 暂停读取请求体，ws drain 再恢复；防缓冲堆积退化）
      if (ws && !ws.write(c)) { paused = true; req.pause(); }
    });
    req.on('end', () => {
      ended = true;
      if (aborted) return;
      if (mode === 'buffer') {
        const buf = chunks ? Buffer.concat(chunks) : Buffer.alloc(0);
        chunks = null;
        settle({ aborted: false, size, payload: { mode: 'buffer', buf } });
        return;
      }
      const lastMode = mode;
      const srcPath = lastMode === 'tmp' ? tmpPath : partPath;
      if (ws) ws.end(() => settle({ aborted: false, size, payload: { mode: lastMode, [lastMode === 'tmp' ? 'tmpPath' : 'partPath']: srcPath } }));
      else settle({ aborted: false, size, payload: { mode: lastMode, [lastMode === 'tmp' ? 'tmpPath' : 'partPath']: srcPath } });
    });
    const onInterrupt = (label, err) => {
      if (aborted || settled) return;
      if (!ended) {
        // 中断（暂停/取消/断网）：已收数据落盘为 .part 暂停快照（可续传）；buffer 同步释放
        if (mode === 'buffer') flushBufferToPart();
        else if (mode === 'tmp') { try { renameSync(tmpPath, partPath); } catch { /* rename 失败（未创建/并发）则忽略 */ } }
        // part 续传模式中断：已存在的 .part 保留现状（下次继续 append）
      }
      dropWs();
      if (err) console.error(`[upload] stream ${label}:`, err?.message ?? err);
      settle({ aborted: false, interrupted: true });
    };
    req.on('error', (e) => onInterrupt('error', e));
    req.on('close', () => { if (!settled && !ended) onInterrupt('close'); });
  });
}

/** 清理孤儿中间文件（上传中断/取消/崩溃残留）：清 `.upload-*.tmp` 与 `*.part`，均超龄才删。 */
function cleanupOrphanParts(dir, maxAgeMs = 24 * 3600 * 1000) {
  try {
    if (!existsSync(dir)) return;
    const now = Date.now();
    for (const f of readdirSync(dir)) {
      const isOrphan = (f.startsWith('.upload-') && f.endsWith('.tmp')) || f.endsWith('.part');
      if (!isOrphan) continue;
      const p = join(dir, f);
      try { if (now - statSync(p).mtimeMs > maxAgeMs) unlinkSync(p); } catch { /* 并发已删则忽略 */ }
    }
  } catch { /* 目录不可读则忽略 */ }
}

/**
 * 处理上传（统一实现，2026-09-2x 重写：壁纸/音乐共用同一逻辑，按 kind 分流目录/扩展名/music.json）。
 * 流程：receiveBody 中途不落盘（内存缓冲，可用内存 20% 动态上限，超限转 .tmp 保底）→
 * 请求中断（暂停/取消 abort）已收部分落盘 <正式名>.part（暂停快照，内存即释放）→
 * ?offset= 续传 append 到 .part → 收完按「文件名+大小」去重（同名同大复用 / 同名不同大小 (1)(2) 后缀）→ 落定。
 * 响应：{ok, existing, id, kind, label, traceId, uploaded, url}（音乐另带 name）。
 * 日志：请求接收 / 大小 / 落盘或复用决策 / 响应均带 traceId，全流程可追踪。
 */
function handleFileUpload(req, res, { kind }) {
  const isMusic = kind === 'music';
  const tag = isMusic ? 'music-upload' : 'upload';
  const traceId = (isMusic ? 'MU' : 'U') + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dir = isMusic ? musicDir() : wallpaperDir();
  const extSet = isMusic ? ALLOWED_MUSIC_UPLOAD_EXT : ALLOWED_UPLOAD_EXT;
  const limit = uploadLimitBytes(dir);
  console.log(`[${tag}][${traceId}] receive request`);
  const url = new URL(req.url ?? '/', 'http://x');
  // 显示名（原始文件名）从 ?name= 查询参数取（客户端带 file.name 编码而来）；
  // 手机/平板系统给的 file.name 可能是数字等，绕不回去，json 存什么显示什么。
  const rawName = decodeURIComponent(url.searchParams.get('name') ?? (isMusic ? 'music' : 'wallpaper'));
  // 名字清洗：取 basename 去路径分隔（防 ../ 穿越），Windows 反斜杠视为分隔替换为 _
  const safeName = basename(rawName.replace(/[\\/]/g, '_'));
  const ext = extname(safeName).toLowerCase();
  if (!ext || !extSet.has(ext)) {
    console.warn(`[${tag}][${traceId}] reject unsupported type=${ext}`);
    res.writeHead(400, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: 'unsupported type: ' + ext, traceId }));
    return;
  }
  // 断点续传（2026-09-2x 恢复，新语义）：?offset=<已传字节> → 服务端对 <正式名>.part 追加续写
  const offsetRaw = parseInt(url.searchParams.get('offset') || '0', 10);
  const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? offsetRaw : 0;
  const tmpPath = join(dir, '.upload-' + traceId + '.tmp'); // 大文件保底中间态（超内存上限才出现）
  const partPath = join(dir, safeName + '.part');           // 暂停快照 / 续传目标
  // 2026-09-2x 续传健壮性：offset>0 必须存在大小一致的 <正式名>.part 快照，否则 409（前端从头重传），
  // 杜绝「.part 缺失/大小不匹配 → append 残缺 → 文件不完整却 rename 落定」的静默损坏。
  if (offset > 0) {
    let partSize = -1;
    try { if (existsSync(partPath) && statSync(partPath).isFile()) partSize = statSync(partPath).size; } catch { /* 瞬态读失败按缺失处理 */ }
    if (partSize !== offset) {
      console.warn(`[${tag}][${traceId}] resume part mismatch offset=${offset} partSize=${partSize} → 409`);
      res.writeHead(409, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'resume part mismatch, please upload from scratch', offset, partSize, traceId }));
      return;
    }
  }
  cleanupOrphanParts(dir); // 顺带清上传中断/取消/崩溃残留的中间文件
  receiveBody(req, { tmpPath, partPath, limit, offset }).then(async (r) => {
    // 中断（暂停/取消/断网）：已落 <正式名>.part 暂停快照，连接已断不写响应（也不误报 413）
    if (r.interrupted) {
      console.log(`[${tag}][${traceId}] interrupted（暂停/取消）→ 已落 .part 快照（可 ?offset= 续传）`);
      return;
    }
    if (r.aborted) {
      const mb = Math.round(limit / 1024 / 1024);
      console.warn(`[${tag}][${traceId}] reject too large limit=${limit} limitMb=${mb}`);
      res.writeHead(413, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'file too large', limit, limitMb: mb, traceId }));
      return;
    }
    const size = r.size;
    console.log(`[${tag}][${traceId}] received name=${safeName} size=${size} ext=${ext} offset=${offset}`);
    try {
      if (isMusic) await mkdirAsync(dir, { recursive: true });
      const itemKind = VIDEO_EXT.has(ext) ? 'video' : 'image';
      const base = safeName.replace(/\.[^.]+$/, '') || (isMusic ? 'music' : 'wallpaper');
      // 落定（公共函数）：同名同大小复用 → (1)(2)… 后缀 → 中间态转正式名（buffer 写盘即释放内存）。
      const { fileName, reused } = await finalizeUpload(dir, r.payload, safeName, size);
      // 2026-09-2x：完整上传/复用落定后清理同名的孤儿 <正式名>.part 快照——
      // 上次中断（如旧 XHR 超时/暂停未续传）残留的快照已无用，直接清掉（实测「上传成功但目录残留 .part」）
      try { if (existsSync(partPath) && statSync(partPath).isFile()) { unlinkSync(partPath); console.log(`[${tag}][${traceId}] cleaned orphan part: ${safeName}.part`); } } catch { /* 忽略 */ }
      if (reused) {
        // 音乐复用同样保证 music.json 有登记（列表按目录扫描，json 仅存显示名/封面）
        if (isMusic) {
          const mm = loadMusicLabels();
          const reuseBase = fileName.replace(/\.[^.]+$/, '');
          mm[reuseBase] = { name: fileName, cover: mm[reuseBase]?.cover || '' };
          saveMusicLabels(mm);
        }
        console.log(`[${tag}][${traceId}] duplicate name+size → reuse file=${fileName} label=${base}`);
        res.writeHead(200, { ...HDR_JSON });
        res.end(JSON.stringify({
          ok: true,
          existing: true, // 告知客户端「已有同文件名同大小」，不重复入列表
          id: base,
          ...(isMusic ? {} : { kind: itemKind }),
          label: base,
          ...(isMusic ? { name: fileName } : {}),
          traceId,
          url: (isMusic ? MUSIC_PREFIX : WP_PREFIX) + encodeURIComponent(fileName),
        }));
        return;
      }
      const finalBase = fileName.replace(/\.[^.]+$/, ''); // id 用最终落盘名（含 (1) 后缀时同样唯一）
      if (isMusic) {
        const mm = loadMusicLabels();
        mm[finalBase] = { name: fileName, cover: mm[finalBase]?.cover || '' };
        saveMusicLabels(mm);
      }
      console.log(`[${tag}][${traceId}] saved file=${fileName} label=${finalBase} size=${size}`);
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({
        ok: true,
        existing: false,
        id: finalBase,
        ...(isMusic ? {} : { kind: itemKind }),
        label: finalBase,
        ...(isMusic ? { name: fileName } : {}),
        traceId,
        uploaded: size, // 本次实际写入字节
        url: (isMusic ? MUSIC_PREFIX : WP_PREFIX) + encodeURIComponent(fileName),
      }));
    } catch (e) {
      uploadErrorResponse(res, r.payload, traceId, e, tag);
    }
  });
}

/** 壁纸上传入口（POST /theme-mediascape-assets/upload）——统一实现见 handleFileUpload。 */
export function handleUpload(req, res) {
  handleFileUpload(req, res, { kind: 'wallpaper' });
}

/** 音乐上传入口（POST /theme-mediascape-assets/music/upload）——统一实现见 handleFileUpload。 */
export function handleMusicUpload(req, res) {
  handleFileUpload(req, res, { kind: 'music' });
}

/**
 * 音乐封面上传（真实落盘，2026-09-21 改）：封面图落盘 music/<音乐文件名去扩展名><ext>（与音乐同名不同后缀，
 * 前端 resolveCover 同名推断自动命中）→ music.json[<文件名去扩展名>].cover = <文件名去扩展名><ext>。
 * 前端「封面」经 fetch POST /theme-mediascape-assets/music/cover?id=<musicId>&ext=<ext> 调用（musicId = 文件名去扩展名）。
 */
export function handleCoverUpload(req, res) {
  const traceId = 'CV' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const dir = musicDir();
  const limit = uploadLimitBytes(dir);
  // 封面上传保留原设计（定稿：自动按音乐重命名）——仅接收通道统一走 receiveBody（内存缓冲不落盘，
  // 封面是小图无大文件风险）；落盘名 = <音乐文件名去扩展名><ext> 不变。
  cleanupOrphanParts(dir); // 顺带清上传中断/取消/崩溃残留的中间文件
  console.log(`[cover-upload][${traceId}] receive request`);
  const url = new URL(req.url ?? '/', 'http://x');
  const musicId = (url.searchParams.get('id') || '').trim();
  const extRaw = (url.searchParams.get('ext') || '').toLowerCase(); // 前端传「png」无点
  const ext = extRaw.startsWith('.') ? extRaw : '.' + extRaw; // 统一带点与 ALLOWED_COVER_UPLOAD_EXT 比对
  console.log(`[cover-upload][${traceId}] received id=${musicId} ext=${ext}`);
  // musicId = 音乐文件名去扩展名（2026-09-21 改，不再是 40 位 hash）：允许中文/符号/空格，
  // 但禁止路径分隔符与空值（防穿越/越界）。
  if (!musicId || /[\\/]/.test(musicId) || musicId === '.' || musicId === '..') {
    res.writeHead(400, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: 'invalid music id', traceId }));
    return;
  }
  if (!ext || !ALLOWED_COVER_UPLOAD_EXT.has(ext)) {
    res.writeHead(400, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: 'unsupported cover type: ' + ext, traceId }));
    return;
  }
  const tmpPath = join(dir, '.upload-' + traceId + '.tmp');
  const partPath = join(dir, musicId + ext + '.part');
  receiveBody(req, { tmpPath, partPath, limit, offset: 0 }).then(async (r) => {
    if (r.interrupted) {
      console.log(`[cover-upload][${traceId}] interrupted（暂停/取消）→ 不落盘`);
      return;
    }
    if (r.aborted) {
      console.warn(`[cover-upload][${traceId}] reject too large`);
      res.writeHead(413, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'file too large', traceId }));
      return;
    }
    const size = r.size;
    console.log(`[cover-upload][${traceId}] received size=${size}`);
    try {
      const mm = loadMusicLabels();
      // 封面无内容去重：直接落定（finalizeUpload checkReuse=false 跳过复用判定）
      await finalizeUpload(dir, r.payload, musicId + ext, null, { checkReuse: false });
      mm[musicId] = { name: mm[musicId]?.name || musicId, cover: musicId + ext };
      saveMusicLabels(mm);
      console.log(`[cover-upload][${traceId}] saved cover=${musicId}${ext} for music=${musicId}`);
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({
        ok: true, id: musicId, traceId,
        url: MUSIC_PREFIX + encodeURIComponent(musicId + ext),
      }));
    } catch (e) {
      uploadErrorResponse(res, r.payload, traceId, e, 'cover-upload');
    }
  });
}