/**
 * HTTP 处理器（删除 / 列表 / 上传）
 */

import { existsSync, statSync, mkdirSync, readFileSync, readdirSync, renameSync, createReadStream, createWriteStream, writeFileSync, unlinkSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { join, normalize, extname, basename } from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { ALLOWED_UPLOAD_EXT, ALLOWED_MUSIC_UPLOAD_EXT, ALLOWED_COVER_UPLOAD_EXT, VIDEO_EXT, UPLOAD_ACCEPT, uploadLimitBytes } from './config.js';
import { loadLabels, loadMusicLabels, saveLabels, saveMusicLabels } from './labels.js';
import { MUSIC_LABELS_FILE, ONLINE_DIR_NAME, WALLPAPER_LABELS_FILE, logsDir, musicDir, musicLabelsPath, onlineDir, wallpaperDir } from './paths.js';
import { readDebugConfig, logEnabled } from './debug.js';
import { writeLog } from './log.js';

// 2026-09-23 去重（审计 no-repeated-hardcoded-literals）：响应头与 URL 前缀公共片段提取（须在文件顶部，
// 供下方所有 handler 使用——声明在使用之前，避免 TDZ）
const HDR_JSON = { 'content-type': 'application/json; charset=utf-8' }; // JSON 响应头（29 处共用）
const WP_PREFIX = '/theme-mediascape-assets/wallpaper/'; // 壁纸资源 URL 前缀（4 处合成）
const MUSIC_PREFIX = '/theme-mediascape-assets/music/';   // 音乐资源 URL 前缀（4 处合成）

// 2026-09-2x 音乐封面图片扩展名（列表「同名推断封面」与删除「扫描删除封面」共用单一权威）：
// 封面有两种来源——music.json 的 cover 记录 / 磁盘同名图片推断（歌名.mp3 ↔ 歌名.png）；
// 删除音乐时必须两种都覆盖，否则 json 未记录/未同步时封面残留（重传同名音乐封面又回来）。
const MUSIC_COVER_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// 2026-09-2x 上传内存缓冲（定稿「上传中途不落盘 part，暂停落盘 part，继续从 part 续传」）：
// 上传数据先攒内存 buffer（不落盘），上限 = 可用内存 20%（动态，os.freemem() 实时取），
// 超限自动转写 .upload-<traceId>.tmp 保底（超大文件不 OOM）；请求中断（暂停/取消 abort）→
// 已收数据落盘为 <正式目标名>.part（暂停快照），内存即刻释放。落盘即释放是本方案的硬约束。
const MEM_BUFFER_RATIO = 0.2;                    // 内存缓冲上限 = 可用内存 20%（定稿）
const MEM_BUFFER_FLOOR = 16 * 1024 * 1024;       // 内存缓冲下限 16MB（防低内存机器算出过小阈值频繁转 tmp）
function memBufferLimit() {
  return Math.max(MEM_BUFFER_FLOOR, Math.floor(os.freemem() * MEM_BUFFER_RATIO));
}

/** 客户端配置：返回上传允许的扩展名串（客户端 input.accept 读此值，单一权威源）。 */
export function handleConfig(res) {
  res.writeHead(200, { ...HDR_JSON });
  res.end(JSON.stringify({
    ok: true,
    uploadAccept: UPLOAD_ACCEPT, // 由 config.js ALLOWED_UPLOAD_EXT 派生（".png,.jpg,.jpeg,.webp,.mp4"；扩展名形式→系统选择器保留「文件」入口）
  }));
}

/** 删除用户壁纸文件（仅允许 wallpaper/ 目录内）。 */
export function handleDelete(req, res, rel) {
  try {
    const dir = wallpaperDir();
    const relFile = rel.startsWith('wallpaper/') ? rel.slice('wallpaper/'.length) : rel;
    const file = normalize(join(dir, relFile));
    // 仅允许 wallpaper/ 目录内的常规文件（2026-09-2x 删 .trash- 保护：删除=unlink 真实删除，不再产生回收文件）
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(400, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'bad file' }));
      return;
    }
    if (!existsSync(file)) {
      res.writeHead(404, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    // 2026-09-23 改：真实删除（unlink 运行态目录文件）——「移除=删除运行态文件，list 刷新显示」，
    // 不再 rename 回收。删除后 list 重新扫描即不显示（文件已不存在）。
    unlinkSync(file);
    // 同步清理名字映射，避免列表残留已删壁纸的 label 记录
    const id = basename(file).replace(/\.[^.]+$/, '');
    const map = loadLabels();
    if (map[id]) { delete map[id]; saveLabels(map); }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/** 列出用户已上传壁纸（wallpaper/ 目录扫描）+ 在线下载资源（wallpaper/online/），返回 [{id, kind, label, url}]。 */
export function handleList(res) {
  try {
    const dir = wallpaperDir();
    if (!existsSync(dir)) {
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: true, items: [] }));
      return;
    }
    const labels = loadLabels();
    const items = readdirSync(dir)
      .filter((f) => !f.endsWith('.part') && !f.endsWith('.tmp') && f !== WALLPAPER_LABELS_FILE && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
      .map((f) => {
        const ext = extname(f).toLowerCase();
        const id = f.replace(/\.[^.]+$/, '');
        // 2026-09-2x 统一「真实可用」判断：文件不可 stat（被外部移动/删除/瞬态损坏）→ 剔除失效项，
        // 列表只返回真实存在可读的素材（前端去重/移除只认可用项，测试覆盖见 assert-file-usable-check）
        let st = null;
        try { st = statSync(join(dir, f)); } catch (e) { return null; }
        return {
          id,
          kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
          // 优先用上传时保存的原始文件名（label），没有（老文件）才回退磁盘名
          label: labels[id] || f.replace(/\.[^.]+$/, ''),
          // file = 磁盘原始文件名（带扩展名）：前端上传预检「文件名+大小」去重基准
          file: f,
          size: st.size,
          url: WP_PREFIX + encodeURIComponent(f),
        };
      })
      .filter(Boolean)
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    // ── 合并在线下载资源（wallpaper/online/）：同 id（同内容 hash）顶层用户文件优先 ──
    const odir = onlineDir();
    if (existsSync(odir)) {
      const ids = new Set(items.map((x) => x.id));
      const online = readdirSync(odir)
        .filter((f) => !f.endsWith('.part') && !f.endsWith('.tmp') && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
        .filter((f) => {
          const id = f.replace(/\.[^.]+$/, '');
          if (ids.has(id)) return false; // 顶层已有同 hash → 顶层优先
          ids.add(id);
          return true;
        })
        .map((f) => {
          const ext = extname(f).toLowerCase();
          const id = f.replace(/\.[^.]+$/, '');
          return {
            id,
            kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
            label: labels[id] || f.replace(/\.[^.]+$/, ''),
            url: WP_PREFIX + ONLINE_DIR_NAME + '/' + encodeURIComponent(f),
          };
        });
      items.push(...online);
    }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/**
 * 列出音乐（music/ 目录扫描）+ music.json 显示名，返回 [{id, name, cover, url, custom}]。
 * 运行时拉取（build 不再内嵌音乐清单）；目录缺失返回空列表。
 */
export function handleMusicList(res) {
  try {
    const dir = musicDir();
    if (!existsSync(dir)) {
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: true, items: [] }));
      return;
    }
    const meta = loadMusicLabels();
    const audioExts = new Set(['.mp3', '.ogg', '.m4a', '.wav']);
    const imgExts = new Set(MUSIC_COVER_EXTS);
    const files = readdirSync(dir);
    const audioFiles = files.filter((f) => audioExts.has(extname(f).toLowerCase()) && !f.endsWith('.part') && !f.endsWith('.tmp'));
    const items = audioFiles
      .map((f) => {
        const id = f.replace(/\.[^.]+$/, '');
        // 2026-09-2x 统一「真实可用」判断：文件不可 stat（被外部移动/删除）→ 剔除失效项
        let st = null;
        try { st = statSync(join(dir, f)); } catch (e) { return null; }
        const metaEntry = meta[id];
        // 封面判定与「json 无记录（填空）」保持一致：
        //   ① json 记录的 cover 必须「文件真实存在」才采用——记录指向的文件被手动删除时，
        //      丢弃该孤儿值（否则前端 fetch 404），不阻挡后续回退；
        //   ② json 无有效 cover → 自动找同名图片文件（歌名.mp3 ↔ 歌名.png）；
        //   ③ 同名也没有 → 无封面 ''（前端显示 ♪ 占位）。
        const coverValid = typeof metaEntry?.cover === 'string' && metaEntry.cover && files.includes(metaEntry.cover);
        const cover = coverValid
          ? metaEntry.cover
          : (files.find((g) => imgExts.has(extname(g).toLowerCase()) && g.replace(/\.[^.]+$/, '') === id) || '');
        return {
          id,
          name: (typeof metaEntry?.name === 'string' && metaEntry.name) || f,
          // file = 磁盘原始文件名（带扩展名）；size：前端上传预检「文件名+大小」去重基准
          file: f,
          size: st.size,
          cover,
          url: MUSIC_PREFIX + encodeURIComponent(f),
          custom: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    // 自动同步 music.json：把扫描到的实际内容写回清单——新增音乐自动登记、删除的自动移除、
    // 同名封面自动补 cover；保留用户已保存的 name/cover（不覆盖），仅当清单与目录有差异才落盘（避免无谓 IO）。
    const synced = {};
    for (const it of items) {
      const prev = meta[it.id];
      synced[it.id] = {
        name: (typeof prev?.name === 'string' && prev.name) || it.name,
        // 自动同步的 cover 只保留「文件真实存在」的值；孤儿 cover（记录在但文件被删）回退
        // 为同名扫描结果或空，下次 list 就已清洗——与 items 内封面判定口径一致（不保留孤儿）
        cover: (typeof prev?.cover === 'string' && prev.cover && files.includes(prev.cover)) ? prev.cover : it.cover,
      };
    }
    if (JSON.stringify(synced) !== JSON.stringify(meta)) {
      try { saveMusicLabels(synced); }
      catch (e) { console.warn('[music] labels 保存失败（不影响本次响应）:', e?.message ?? e); }
    }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}


/**
 * 接收上传 body（2026-09-2x 重写，「上传中途不落盘 part，暂停落盘 part，继续从 part 续传」）：
 *  - 常规（offset=0）：数据先攒内存 buffer（不落盘），上限 = 可用内存 20%（动态）；超过自动转写
 *    tmpPath（.upload-<traceId>.tmp）保底——超大文件不 OOM；请求中断（客户端暂停/取消 abort，
 *    触发 req error/close）→ 已收数据落盘为 partPath（<正式目标名>.part，暂停快照），内存即刻释放。
 *  - 续传（offset>0）：直接以追加模式（flags:'a'）打开 partPath 边收边写；end 后由调用方 rename 落定。
 * 超限（>limit）→ 清理中间态、drain 剩余 body（保持反代 keep-alive 连接池健康——粗暴 destroy
 * 会留半死连接，后续请求复用 EPIPE/408/502）→ resolve { aborted: true }。
 * @returns {Promise<{aborted:boolean, interrupted?:boolean, size?:number,
 *   payload?:{mode:'buffer'|'tmp'|'part', buf?:Buffer, tmpPath?:string, partPath?:string}}>}
 */
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

/**
 * 删除音乐（DELETE /theme-mediascape-assets/music/<file>）：
 * 与壁纸 handleDelete 同模式——真实删除（unlink 运行态文件）：
 * ①删除依据 music.json 记录（cover 字段）删封面文件；②json 未记录/未自动同步时，
 * 同名推断封面（歌名.mp3 ↔ 歌名.png）也一并扫描删除——否则封面残留，重新上传同名音乐会
 * 再次推断出封面（实测「音乐只能临时移除封面」）；③删完真实文件后 music.json 自动重新生成
 * （handleMusicList 每次列表按目录自动同步重建，被删项自然消失；此处同步清除记录保持一致）。
 * 背景：音乐此前无删除 API，前端删除只走本地 IDB（服务端文件不删），测试也只能 fs 模拟——
 * 补真实 API 后删除/删除后重传都可走 API 验证（api-verifiable-frontend）。
 */
export function handleMusicDelete(req, res, rel) {
  try {
    const dir = musicDir();
    const relFile = rel.startsWith('music/') ? rel.slice('music/'.length) : rel;
    const file = normalize(join(dir, relFile));
    // 仅允许 music/ 目录内常规文件（排除 music.json 登记文件）
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile() || basename(file) === MUSIC_LABELS_FILE) {
      res.writeHead(400, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'bad file' }));
      return;
    }
    // 真实删除音乐文件（「移除=删除运行态文件，list 刷新显示」）；music.json 记录随后自动重建
    unlinkSync(file);
    const id = basename(file).replace(/\.[^.]+$/, '');
    const mm = loadMusicLabels();
    // ① 依据 json 记录删封面（cover 字段指向的文件）
    const cover = mm[id]?.cover;
    if (cover) {
      const coverFile = normalize(join(dir, cover));
      if (coverFile.startsWith(dir) && existsSync(coverFile) && statSync(coverFile).isFile() && basename(coverFile) !== MUSIC_LABELS_FILE) {
        unlinkSync(coverFile);
      }
    }
    // ② 同名推断封面也删（json 未记录/未同步时——与 handleMusicList 推断对称，封面不残留）
    for (const ext of MUSIC_COVER_EXTS) {
      const p = normalize(join(dir, id + ext));
      try {
        if (p.startsWith(dir) && existsSync(p) && statSync(p).isFile() && basename(p) !== MUSIC_LABELS_FILE) unlinkSync(p);
      } catch (e) { /* 删除竞争/权限异常：忽略（下次列表同步仍不引用它） */ }
    }
    // ③ music.json 记录同步清除（下次列表也会按目录自动重建，这里即时保持一致）
    if (mm[id]) { delete mm[id]; saveMusicLabels(mm); }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, id, cover: cover || null }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/**
 * 壁纸切换日志（运行态日志：$DSH_HOME/theme-mediascape/logs/wallpaper.log）。
 *
 * 前端 wallpaper.js 在关键切换点（视频 ended 切下一张 / 图片随机定时切换 / 手动切壁纸 / 模式切换）
 * POST 上报一行 JSON；服务端写入运行态日志文件（logs/ 目录自动创建，lib/log.js 统一轮转+时间戳）。
 * GET 可读取最近 N 行（AI/预览页自检用——api-verifiable-frontend：切换是否发生有日志可查证）。
 *
 * POST body: { event, kind: 'video'|'image', mode: 'single'|'switch'|'random', fromId?, toId?, label? }
 * GET ?lines=50 → { ok, lines: [ {ts, event, kind, mode, fromId, toId, label} ] }（最近 N 行，默认 DEFAULT_LOG_LINES）
 */
const WALLPAPER_LOG_FILE = 'wallpaper.log';
const WALLPAPER_LOG_MAX_LINES = 5000; // 循环截断上限（防无限增长，兼容旧文件）

function wallpaperLogPath() { return join(logsDir(), WALLPAPER_LOG_FILE); }

/** 追加一行壁纸切换日志（受 debug 配置 log 开关控制；写失败静默——日志不影响壁纸功能）。 */
export function appendWallpaperLog(entry) {
  writeLog(WALLPAPER_LOG_FILE, entry);
}

// 2026-09-23 危险档优化（io-risk 真问题）：readWallpaperLog 原 readFileSync 全量读日志再
// slice(-n)——日志文件持续追加可能数百万字节，请求路径每次全量进内存（阻塞 + 内存翻倍）。
// 改为只读文件尾部 maxBytes 缓冲（日志行通常 <200B，256KB 足够容纳 500 行上限），行为不变
// （仍返回最近 N 行，解析失败/不存在/log 关闭 → 空数组）。
const TAIL_READ_BYTES = 256 * 1024; // 尾部读取缓冲上限（256KB ≈ 500 行 × 平均行长的安全余量）
// 2026-09-23 魔数命名化（审计 magic-number-smart）：日志读取行数 + 上报字段截断长度
const DEFAULT_LOG_LINES = 50;    // 读日志默认行数
const MAX_LOG_LINES = 500;       // 读日志行数上限（防一次拉爆）
const TRIM_EVENT_LEN = 40;       // event 字段截断长度
const TRIM_MODE_LEN = 10;        // mode 字段截断长度
const TRIM_ID_LEN = 80;          // fromId/toId 字段截断长度
const TRIM_LABEL_LEN = 120;      // label 字段截断长度

/** 读取文件末尾若干行（流式不整载）：只读尾部块，跨块边界丢弃首行不完整部分。返回 string[]。 */
function readFileTail(file, maxLines) {
  const st = statSync(file);
  if (!st.isFile() || st.size <= 0) return [];
  const readLen = Math.min(st.size, TAIL_READ_BYTES);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(readLen);
    readSync(fd, buf, 0, readLen, st.size - readLen);
    let text = buf.toString('utf8');
    // 仅当缓冲起点落在文件中间（读的是尾部块）时，首行是上一行的半截 → 丢弃到第一个换行；
    // 缓冲覆盖整个文件（readLen === size）时首行完整，不能丢。
    if (readLen < st.size) {
      const firstNl = text.indexOf('\n');
      if (firstNl !== -1) text = text.slice(firstNl + 1);
    }
    const lines = text.split('\n').filter(Boolean);
    return lines.slice(-maxLines);
  } finally {
    closeSync(fd);
  }
}

/** 读最近 N 行壁纸切换日志（解析失败/文件不存在/log 关闭 → 空数组）。 */
export function readWallpaperLog(lines = DEFAULT_LOG_LINES) {
  try {
    if (!logEnabled('wallpaper')) return []; // wallpaper 日志类别关闭 → 不返回日志
    const file = wallpaperLogPath();
    if (!existsSync(file)) return [];
    const n = Math.max(1, Math.min(parseInt(lines, 10) || DEFAULT_LOG_LINES, MAX_LOG_LINES));
    return readFileTail(file, n).map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });
  } catch (e) { return []; }
}

/** 同名冲突找下一个可用文件名（base(1).ext、base(2).ext…），三处上传共用（2026-09-22 提取）。 */
function nextAvailableName(dir, base, ext) {
  let n = 1;
  while (existsSync(join(dir, base + '(' + n + ')' + ext))) n++;
  return base + '(' + n + ')' + ext;
}

/** 上传落定失败统一响应：清理中间态（buffer 释放内存 / tmp/part unlink）+ 500 JSON（上传 handler 共用）。 */
function uploadErrorResponse(res, payload, traceId, e, tag) {
  console.error(`[${tag}][${traceId}] error:`, e?.message ?? e);
  if (payload) {
    // 落盘即释放是硬约束：buffer 置 null；tmp/part 遗留文件 unlink
    const p = payload.mode === 'tmp' ? payload.tmpPath : (payload.mode === 'part' ? payload.partPath : null);
    if (p) { try { unlinkSync(p); } catch { /* 忽略 */ } }
    if (payload.mode === 'buffer') payload.buf = null;
  }
  res.writeHead(500, { ...HDR_JSON });
  res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e), traceId }));
}

/**
 * 落定上传：中间态 → 最终名（2026-09-2x 重写：payload 三态统一——buffer 内存 / tmp 大文件保底 / part 暂停续传快照）。
 * 三处上传 handler 共用（handleFileUpload / handleCoverUpload）。
 * ⚠️ 去重规则（定稿）：**只比较「文件名 + 大小」**——同名且大小一致 → 复用（existing:true，
 * 清理中间态不落新盘）；同名但大小不同 → 自动加 (1)(2)… 后缀落盘。不做 SHA-1 内容指纹比对。
 * 落盘即释放内存（硬约束）：buffer 模式写盘后 payload.buf 置 null。
 * @param {object} payload 中间态 { mode:'buffer'|'tmp'|'part', buf?|tmpPath?|partPath? }
 * @param {number|null} size 本次上传字节数（null=封面等无去重场景，直接落盘）
 * @returns {Promise<{fileName:string, reused:boolean}>}
 */
async function finalizeUpload(dir, payload, safeName, size, opts = {}) {
  const { checkReuse = true } = opts;
  const ext = extname(safeName).toLowerCase();
  const base = safeName.replace(/\.[^.]+$/, '') || 'wallpaper';
  const srcPath = payload.mode === 'tmp' ? payload.tmpPath : (payload.mode === 'part' ? payload.partPath : null);
  let fileName = safeName;
  if (checkReuse && size !== null && existsSync(join(dir, fileName))) {
    // 去重只比较文件名+大小：同名文件存在且大小一致 → 复用（内容指纹不比对）
    try {
      if (statSync(join(dir, fileName)).size === size) {
        if (srcPath) { try { unlinkSync(srcPath); } catch { /* 复用命中，删中间态 */ } }
        if (payload.mode === 'buffer') payload.buf = null; // 释放内存
        return { fileName, reused: true };
      }
    } catch { /* stat 失败（瞬态删除）→ 按不存在处理，直接落盘 */ }
    fileName = nextAvailableName(dir, base, ext);
  }
  mkdirSync(dir, { recursive: true });
  if (payload.mode === 'buffer') {
    writeFileSync(join(dir, fileName), payload.buf);
    payload.buf = null; // 写盘后释放内存（硬约束）
  } else if (srcPath) {
    renameSync(srcPath, join(dir, fileName));
  }
  return { fileName, reused: false };
}

/**
 * 取消上传：清理暂停快照 .part（DELETE /theme-mediascape-assets/upload/part?name=<file>，2026-09-2x 加）。
 * 暂停（请求中断）会由服务端自动落 <正式目标名>.part（暂停快照，供续传）；用户点「取消」时
 * 前端调本接口删除该快照，不留残留。壁纸/音乐共用同一路由（暂停快照在目标目录，两个目录都查）。
 */
export function handleUploadPartDelete(req, res) {
  try {
    const url = new URL(req.url ?? '/', 'http://x');
    const rawName = decodeURIComponent(url.searchParams.get('name') ?? '');
    const safeName = basename(rawName.replace(/[\\/]/g, '_'));
    if (!safeName) {
      res.writeHead(400, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'invalid name' }));
      return;
    }
    let removed = 0;
    for (const dir of [wallpaperDir(), musicDir()]) {
      const p = join(dir, safeName + '.part');
      try {
        if (existsSync(p) && statSync(p).isFile()) { unlinkSync(p); removed++; }
      } catch { /* 并发已删则跳过 */ }
    }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, removed }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/** POST /wallpaper/log：接收前端上报的切换事件并落盘。 */
export function handleWallpaperLog(req, res) {
  let chunks = [];
  let aborted = false;
  req.on('data', (c) => { chunks.push(c); });
  req.on('end', () => {
    try {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      const event = typeof body.event === 'string' ? body.event.slice(0, TRIM_EVENT_LEN) : 'unknown';
      const kind = body.kind === 'image' ? 'image' : (body.kind === 'video' ? 'video' : null);
      const mode = typeof body.mode === 'string' ? body.mode.slice(0, TRIM_MODE_LEN) : null;
      const entry = {
        event,
        ...(kind ? { kind } : {}),
        ...(mode ? { mode } : {}),
        ...(typeof body.fromId === 'string' ? { fromId: body.fromId.slice(0, TRIM_ID_LEN) } : {}),
        ...(typeof body.toId === 'string' ? { toId: body.toId.slice(0, TRIM_ID_LEN) } : {}),
        ...(typeof body.label === 'string' ? { label: body.label.slice(0, TRIM_LABEL_LEN) } : {}),
      };
      appendWallpaperLog(entry);
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      if (!aborted) {
        res.writeHead(400, { ...HDR_JSON });
        res.end(JSON.stringify({ ok: false, error: 'bad log entry' }));
      }
    }
  });
  req.on('error', () => { aborted = true; try { res.writeHead(400); res.end(); } catch { /* 连接已断开：写响应抛错可忽略 */ } });
}

/** GET /wallpaper/log：返回最近 N 行壁纸切换日志（?lines=50）。 */
export function handleWallpaperLogRead(req, res, url) {
  const lines = url?.searchParams?.get('lines') || String(DEFAULT_LOG_LINES);
  const entries = readWallpaperLog(lines);
  res.writeHead(200, { ...HDR_JSON });
  res.end(JSON.stringify({ ok: true, file: WALLPAPER_LOG_FILE, count: entries.length, lines: entries }));
}
