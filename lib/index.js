import { existsSync, statSync, readFileSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import { spawn } from 'node:child_process';
import os from 'node:os';
import http from 'node:http';
import { ALLOWED_DIRS, MIME, ROOT, STUDIO_DIR } from './config.js';
// Range/206 分片静态服务抽为公共模块（2026-10-09）：与 theme-studio/start-preview.mjs 共用同一实现
import { serveStream, HDR_TEXT_PLAIN, HDR_CACHE_DAY, HDR_CACHE_NONE } from './stream.js';
import { handleConfig, handleDelete, handleList, handleMusicList, handleUpload, handleMusicUpload, handleCoverUpload, handleUploadPartDelete, handleWallpaperLog, handleWallpaperLogRead } from './handlers.js';
import { installTokenCapture, getDshToken } from './media-token.js';
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
// 2026-10-09 三个 HDR_* 常量随之移入 lib/stream.js（与 serveStream 同源）——此处使用顶部 import 的绑定。
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
      // 2026-10-09（C）媒体请求诊断字段：只**新增**、不改名 ⇒ 既有读日志方式不受影响。
      //   range/ifRange：直接看出是不是 Range 直通（无 Range 或跟 302 后丢 Range = 退化整文件）。
      //   tokened：URL 是否带反代 token（false ⇒ 会被反代 302）。
      //   kind：video/image/other（按扩展名），便于只看视频链路。
      const url = String(req.url || '');
      const ext = (url.split('?')[0].match(/\.[a-z0-9]+$/i) || [''])[0].toLowerCase();
      const kind = ['.mp4', '.webm'].includes(ext) ? 'video' : ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(ext) ? 'image' : 'other';
      const mediaFields = kind === 'other' ? {} : {
        kind,
        tokened: url.includes('token='),
        range: req.headers && req.headers.range ? String(req.headers.range) : null,
        ifRange: req.headers && req.headers['if-range'] ? String(req.headers['if-range']) : null,
      };
      writeLog(isUpload ? 'upload.log' : 'api.log', Object.assign({
        event: isUpload ? 'upload' : 'api',
        method: req.method,
        path: rel,
        status: res.statusCode,
        ms: Date.now() - t0,
      }, mediaFields));
    } catch { /* 日志写失败静默 */ }
  });
}

// ── Range/206 分片静态服务已抽为公共模块 lib/stream.js（2026-10-09）──
// 原先本文件与 theme-studio/start-preview.mjs 各有一份**逐字复制**的实现，且已实际分叉
// （预览那份缺图片 ETag 分支、缺 1MB HWM 与 close 守卫）。现两边共用 lib/stream.js 的
// serveStream / parseRange / pipeFile / HDR_* 常量；本文件只在路由分发处调用 serveStream。

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

  // ── GET 反代鉴权 token（前端拼媒体 URL，使 Range 请求不经 302 重定向）──
  if (req.method === 'GET' && rel === 'media-token') {
    // 取不到时返回空串（前端按无 token 处理，与既有行为一致，不影响媒体加载）
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', ...HDR_CACHE_NONE });
    res.end(JSON.stringify({ token: getDshToken() }));
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
  // 反代 token 捕获钩子：需在 DSH 打印 `dsh web: ...?token=xxx` 之前装好（插件 apply 早于该打印，
  // 插件 apply 早于 DSH 打印访问地址）。只读取输出分片，原样透传，不改变日志行为。
  installTokenCapture();
  // 仓库根 music/、wallpaper/ 整目录一次性迁移到真实数据目录（幂等：已存在非空即跳过）
  bootstrapDataDirs();
  registerAssets(ctx);
  // 在线资源：主题启动时后台静默下载缺失项（配置为空自动跳过）
  ensureOnlineDownload();
  // debug 配色服务：apply 时启动（重启 DSH 自动拉起，幂等）
  ensureDebugServer();
}
