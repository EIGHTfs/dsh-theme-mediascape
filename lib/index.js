import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import http from 'node:http';
import { ALLOWED_DIRS, MIME, ROOT, STUDIO_DIR } from './config.js';
import { handleConfig, handleDelete, handleList, handleMusicList, handleUpload, handleMusicUpload, handleCoverUpload, handleUploadPartDelete, handleWallpaperLog, handleWallpaperLogRead } from './handlers.js';
import { ensureOnlineDownload } from './online.js';
import { bootstrapDataDirs } from './bootstrap.js';
import { bootDir, musicDir, wallpaperDir } from './paths.js';
import { readDebugConfig, logEnabled } from './debug.js';
import { writeLog, logTs } from './log.js';

/**
 * 服务端半注册 HTTP 前缀路由（真实 API：webServer.register({kind:'prefix', path, handler})）。
 * 分流规则：
 *   POST /theme-mediascape-assets/upload → 接收 raw body 写入 wallpaper/，返回 {ok, url}
 *   GET  /theme-mediascape-assets/wallpaper/<file> → 静态服务用户壁纸（wallpaper/ 真实数据目录）
 *   GET  /theme-mediascape-assets/music/list → 运行时音乐清单（build 不再内嵌）
 *   GET  /theme-mediascape-assets/<GIF|music>/<file> → 静态服务素材（仓库根 boot/ 与真实数据 music/）
 */
// 2026-09-23 去重（审计 no-repeated-hardcoded-literals）：响应头公共片段提取，组合用展开。
const HDR_TEXT_PLAIN = { 'content-type': 'text/plain; charset=utf-8' };
const HDR_CACHE_DAY = { 'cache-control': 'public, max-age=86400' }; // 媒体/静态 1 天强缓存
const HDR_CACHE_NONE = { 'cache-control': 'no-cache' };             // 配置/页面即时生效原则
/**
 * 统一入口计时（2026-09-22 约束：不在各 handler 函数内打点，只在唯一入口记一次，
 * 且无常驻采集器——仅请求结束时按需写一行，log 关闭时 writeLog 直接返回零开销）：
 *   上传类（upload / music/upload / music/cover）→ upload.log（上传行为）
 *   其余 → api.log（API 请求耗时）
 * 注意：真实 HTTP res 才有 .on；测试 mock res 没有——用 typeof 保护，避免破坏自测。
 */
function logApiRequest(req, res, rel) {
  const isUpload = req.method === 'POST' && (rel === 'upload' || rel === 'music/upload' || rel === 'music/cover');
  if (!(isUpload || logEnabled('api')) || typeof res.on !== 'function') return;
  const t0 = Date.now();
  res.on('finish', () => {
    try {
      writeLog(isUpload ? 'upload.log' : 'api.log', {
        event: isUpload ? 'upload' : 'api',
        method: req.method,
        path: rel,
        status: res.statusCode,
        ms: Date.now() - t0,
      });
    } catch { /* 日志写失败静默 */ }
  });
}

// ── Range/206 分片静态服务（与 theme-studio/start-preview.mjs serveStream 同步实现，两处保持一致）──
// 仅 media（video/* | audio/*）且带 Range 才分片：206 + Accept-Ranges + Content-Range + 分片流；
// 无 Range / 非媒体 → 200 全量（现状不变）；非法 Range → 416 + Content-Range: bytes */<total>。
// 仅整数解析（RFC7233 bytes=<start>-<end> / bytes=<start>- / bytes=-<suffix>）。
// 2026-09-23 拆（审计 max-cyclomatic 29）：Range 解析/校验提为 parseRange——非法或越界返回 null
// （调用方回 416）；bytes=-<suffix> 后缀语义、边界钳制都在此完成。行为与内联逐字一致。
function parseRange(range, total) {
  if (!range) return null;
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!rangeMatch) return null; // 非法 Range（不是 bytes=N-M 形）
  let start = null, end = null;
  if (rangeMatch[1] !== '') start = Number(rangeMatch[1]);
  if (rangeMatch[2] !== '') end = Number(rangeMatch[2]);
  // bytes=-<suffix>：末尾 suffix 字节；bytes=<start>-：到文件尾
  if (start === null && end !== null && Number.isInteger(end) && end >= 0) start = Math.max(total - end, 0);
  if (start === null) start = 0;
  if (end === null || end >= total) end = total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= total) return null;
  return { start, end };
}
// 2026-09-2x 下载防退化（长时运行连接/FD 累积）+ 修复实机开屏 auto 视频卡住：
// 统一读流管道：①1MB 大块（highWaterMark）减少事件循环开销提速；②读流错误 → 关响应（防悬挂连接）；
// ③客户端中断释放读流——但仅当响应「未正常完成」（writableFinished=false，浏览器真中断）才销毁：
// Node 的 res 'close' 在正常 keep-alive 连接关闭时也触发（浏览器对视频 Range 流缓冲足够即关连接、
// 需要再续），此前直接 rs.destroy() 会把进行中的大视频流掐断 → 实机开屏 auto 视频无数据卡住
// （预览走 start-preview 自带 serveStream 无此行故正常；实机走本实现卡住——回归）。
const STREAM_HIGH_WATER_MARK = 1024 * 1024; // 静态流大块（1MB）
function pipeFile(res, file, range) {
  const rs = createReadStream(file, range ? { ...range, highWaterMark: STREAM_HIGH_WATER_MARK } : { highWaterMark: STREAM_HIGH_WATER_MARK });
  rs.on('error', () => { try { res.destroy(); } catch { /* 连接已断：忽略 */ } });
  res.on('close', () => { if (!res.writableFinished) rs.destroy(); }); // 正常完成不销毁；真中断才释放
  rs.pipe(res);
}
function serveStream(res, req, file, mime) {
  const st = statSync(file);
  const total = st.size;
  // 视频 HTTP 缓存（2026-09-22 方案一）：ETag 用 mtime-size 作指纹——文件被替换后指纹变化，
  // 浏览器 If-Range 条件请求拿不到匹配 → 回 200 全量重新下载，绝不返回旧内容。
  // 命中缓存（If-Range 匹配）→ 206 分片（浏览器直接用缓存分片，不重新传输）；未带 If-Range → 正常 206。
  const etag = '"' + st.mtimeMs + '-' + total + '"';
  const isMedia = /^(video|audio)\//.test(mime);
  const isImage = /^image\//.test(mime);
  const range = (req.headers && req.headers.range) || '';
  const ifRange = (req.headers && req.headers['if-range']) || '';
  // 条件请求：客户端缓存了旧分片且 If-Range 与当前 etag 不匹配（文件已变）→ 放弃 206、回 200 全量
  if (isMedia && ifRange && ifRange !== etag) {
    res.writeHead(200, { 'content-type': mime, ...HDR_CACHE_DAY, 'etag': etag });
    pipeFile(res, file);
    return;
  }
  if (!isMedia || !range) {
    // 媒体无 Range → 200 全量 + 缓存；图片 → etag 供持久缓存校验（不强缓存，配置/页面即时生效原则保留）；
    // 其它非媒体 → 保持 no-cache（配置/页面即时生效）
    const isMediaPath = isMedia
      ? { 'content-type': mime, ...HDR_CACHE_DAY, 'etag': etag }
      : isImage
        ? { 'content-type': mime, ...HDR_CACHE_NONE, 'etag': etag }
        : { 'content-type': mime, ...HDR_CACHE_NONE };
    res.writeHead(200, isMediaPath);
    pipeFile(res, file);
    return;
  }
  const parsed = parseRange(range, total);
  if (!parsed) {
    res.writeHead(416, { ...HDR_TEXT_PLAIN, ...HDR_CACHE_NONE, 'content-range': `bytes */${total}` });
    res.end();
    return;
  }
  const { start, end } = parsed;
  res.writeHead(206, {
    'content-type': mime,
    ...HDR_CACHE_DAY,
    'etag': etag,
    'accept-ranges': 'bytes',
    'content-range': `bytes ${start}-${end}/${total}`,
    'content-length': end - start + 1,
  });
  pipeFile(res, file, { start, end });
}

// 2026-09-23 拆（审计 max-cyclomatic 36）：资产路由分发提为独立函数——
// POST/GET/DELETE API 路由 + 目录白名单静态文件服务。registerAssets 只负责注册。
function routeAssetsHandler(req, res, url, rel, top) {
  // ── POST 上传 ──
  if (req.method === 'POST' && rel === 'upload') {
    handleUpload(req, res);
    return;
  }

  // ── POST 音乐上传（真实落盘 music/ + music.json 记录）──
  if (req.method === 'POST' && rel === 'music/upload') {
    handleMusicUpload(req, res);
    return;
  }

  // ── POST 音乐封面上传（真实落盘 music/ + music.json cover 记录）──
  if (req.method === 'POST' && rel === 'music/cover') {
    handleCoverUpload(req, res);
    return;
  }

  // ── POST 壁纸切换日志上报（前端 wallpaper.js 切换点上报，落运行态 logs/）──
  if (req.method === 'POST' && rel === 'wallpaper/log') {
    handleWallpaperLog(req, res);
    return;
  }

  // ── GET 壁纸切换日志（最近 N 行，自检/预览用：?lines=50）──
  if (req.method === 'GET' && rel === 'wallpaper/log') {
    handleWallpaperLogRead(req, res, url);
    return;
  }

  // ── DELETE 取消上传：清理暂停快照 .part（?name=<文件>，2026-09-2x 加）──
  if (req.method === 'DELETE' && rel === 'upload/part') {
    handleUploadPartDelete(req, res);
    return;
  }

  // ── DELETE 删除用户壁纸 ──
  if (req.method === 'DELETE' && top === 'wallpaper') {
    handleDelete(req, res, rel);
    return;
  }

  // ── GET 客户端配置（上传允许的扩展名，input.accept 单一权威源）──
  if (req.method === 'GET' && rel === 'config') {
    handleConfig(res);
    return;
  }

  // ── GET 用户壁纸清单 ──
  if (req.method === 'GET' && rel === 'wallpaper/list') {
    handleList(res);
    return;
  }

  // ── GET 音乐清单（运行时拉取，build 不再内嵌）──
  if (req.method === 'GET' && rel === 'music/list') {
    handleMusicList(res);
    return;
  }

  // ── 目录白名单（wallpaper/music/boot 均走真实运行态数据目录）──
  if (!ALLOWED_DIRS.has(top)) {
    res.writeHead(404, { ...HDR_TEXT_PLAIN });
    res.end('not found');
    return;
  }
  // wallpaper/music/boot → 真实数据目录（开屏动画素材运行态也在 $DSH_HOME/theme-mediascape/boot/，
  // 2026-09-22 改：boot 不再回退插件根，只读运行态目录——用户整理运行态文件即生效）
  const base = top === 'wallpaper' ? wallpaperDir() : (top === 'music' ? musicDir() : bootDir());
  // rel 含顶层目录（如 wallpaper/custom-x.mp4），base 已是真实数据目录，去掉顶层
  const relFile = top === 'wallpaper' || top === 'music' || top === 'boot' ? rel.slice((top + '/').length) : rel;
  const file = normalize(join(base, relFile));
  if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404, { ...HDR_TEXT_PLAIN });
    res.end('not found');
    return;
  }
  const mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
  serveStream(res, req, file, mime);
}

export function registerAssets(ctx) {
  if (typeof ctx?.inject !== 'function') return false;
  let wired = false;
  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx?.get?.('webServer');
    if (!webServer?.register) return;
    try {
      // 启动日志（进程级一次）：服务注册即代表主题服务搭好，记一行 startup.log（2026-09-22 加）
      if (!registerAssets.__loggedStartup) {
        registerAssets.__loggedStartup = true;
        writeLog('startup.log', { event: 'service-startup', pid: process.pid ?? null });
      }
      webServer.register({
        kind: 'prefix',
        path: '/theme-mediascape-assets',
        handler(req, res) {
          const url = new URL(req.url ?? '/', 'http://x');
          const pathname = decodeURIComponent(url.pathname);
          const rel = pathname.replace(/^\/theme-mediascape-assets\//, '');
          const top = rel.split('/')[0];

          // 统一入口计时（实现见上方 logApiRequest）
          logApiRequest(req, res, rel);

          routeAssetsHandler(req, res, url, rel, top);
        },
      });
      wired = true;
    } catch (e) {
      /* 注册失败静默，主题其余部分照常 */
    }
  });
  return wired;
}

/**
 * debug 配色/预览网页服务（2026-09-21 改：从「build 时启动」改为「主题插件 apply 时启动」；
 * 2026-09-22 改：单一 enabled → theme-swatch/preview 独立开关，任一开即拉起同一服务）。
 *
 * 背景：配色盘（theme-studio/theme-swatch.html + start-preview.mjs，端口 30999）过去由 build.cjs
 * 在 debug 模式下（$DSH_HOME/theme-mediascape/debug.json）构建完成后自动重启——那只在「手动跑
 * build」时生效；重启 DSH（主题 apply）时服务不会自动拉起，用户以为 debug 坏了。现在把启动时机
 * 移到 apply：主题每次 apply（= DSH 启动加载主题）时检查 debug.json，theme-swatch 或 preview
 * 任一 true 则后台静默 spawn theme-studio/start.sh start（幂等：已在运行则跳过，不重复起）。
 * 关闭：删除/置 false 对应键后，下次 apply 不再拉起（已在跑的服务不自动停，手动 theme-studio/start.sh stop）。
 */
let debugServerSpawned = false; // 进程级节流：同一进程只 spawn 一次（防 apply 多次调用）
function ensureDebugServer() {
  if (debugServerSpawned) return;
  debugServerSpawned = true;
  try {
    const cfg = readDebugConfig();
    if (!cfg.themeSwatch && !cfg.preview) return; // 配色/预览开关都关 → 不拉起服务
  } catch { return; } // 文件不存在/非法 = 未开启（默认关）
  // 后台静默启动（不 await、不阻塞 apply）；start.sh 自身幂等（已在运行会提示跳过）
  try {
    const child = spawn('bash', [join(ROOT, STUDIO_DIR, 'start.sh'), 'start'], {
      cwd: ROOT,
      stdio: 'ignore',
      detached: true,
    });
    child.unref(); // 不阻塞 DSH 进程退出
    console.log('[mediascape] debug 配色/预览服务启动已触发（theme-studio/start.sh start）');
  } catch (e) {
    console.warn('[mediascape] debug 配色/预览服务启动失败:', String(e?.message ?? e));
  }
}

/** DSH 插件应用入口（DSH 调用）。 */
export function apply(ctx) {
  // 仓库根 music/、wallpaper/ 整目录一次性迁移到真实数据目录（幂等：已存在非空即跳过）
  bootstrapDataDirs();
  registerAssets(ctx);
  // 在线资源：主题启动时后台静默下载缺失项（配置为空自动跳过）
  ensureOnlineDownload();
  // debug 配色服务：apply 时启动（重启 DSH 自动拉起，幂等）
  ensureDebugServer();
}
