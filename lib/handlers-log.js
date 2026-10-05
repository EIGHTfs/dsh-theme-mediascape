// 壁纸日志 + 上传辅助（finalizeUpload/nextAvailableName/uploadErrorResponse/handleUploadPartDelete）
// （2026-09-2x 从 handlers.js 拆出）。与 handlers.js 同目录；handlers.js 经 re-export 保对外 API。

import { statSync, openSync, readSync, closeSync, unlinkSync, existsSync, readdirSync, renameSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, basename, extname } from 'node:path';
import { logsDir, musicDir, wallpaperDir } from './paths.js';

// JSON 响应头（uploadErrorResponse/handleWallpaperLog 等共用）
const HDR_JSON = { 'content-type': 'application/json; charset=utf-8' };
const WALLPAPER_LOG_FILE = 'wallpaper.log';
const WALLPAPER_LOG_MAX_LINES = 5000; // 循环截断上限（防无限增长，兼容旧文件）

import { readDebugConfig, logEnabled } from './debug.js';
import { writeLog } from './log.js';

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
export function nextAvailableName(dir, base, ext) {
  let n = 1;
  while (existsSync(join(dir, base + '(' + n + ')' + ext))) n++;
  return base + '(' + n + ')' + ext;
}

/** 上传落定失败统一响应：清理中间态（buffer 释放内存 / tmp/part unlink）+ 500 JSON（上传 handler 共用）。 */
export function uploadErrorResponse(res, payload, traceId, e, tag) {
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
export async function finalizeUpload(dir, payload, safeName, size, opts = {}) {
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