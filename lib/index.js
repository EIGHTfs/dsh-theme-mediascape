import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import http from 'node:http';
import { ALLOWED_DIRS, MIME, ROOT } from './config.js';
import { handleConfig, handleDelete, handleList, handleMusicList, handleUpload } from './handlers.js';
import { ensureOnlineDownload } from './online.js';
import { bootstrapDataDirs } from './bootstrap.js';
import { musicDir, wallpaperDir } from './paths.js';

/**
 * 服务端半注册 HTTP 前缀路由（真实 API：webServer.register({kind:'prefix', path, handler})）。
 * 分流规则：
 *   POST /theme-mediascape-assets/upload → 接收 raw body 写入 wallpaper/，返回 {ok, url}
 *   GET  /theme-mediascape-assets/wallpaper/<file> → 静态服务用户壁纸（wallpaper/ 真实数据目录）
 *   GET  /theme-mediascape-assets/music/list → 运行时音乐清单（build 不再内嵌）
 *   GET  /theme-mediascape-assets/<GIF|music>/<file> → 静态服务素材（仓库根 boot/ 与真实数据 music/）
 */
export function registerAssets(ctx) {
  if (typeof ctx?.inject !== 'function') return false;
  let wired = false;
  ctx.inject(['webServer'], (wctx) => {
    const webServer = wctx?.get?.('webServer');
    if (!webServer?.register) return;
    try {
      webServer.register({
        kind: 'prefix',
        path: '/theme-mediascape-assets',
        handler(req, res) {
          const url = new URL(req.url ?? '/', 'http://x');
          const pathname = decodeURIComponent(url.pathname);
          const rel = pathname.replace(/^\/theme-mediascape-assets\//, '');
          const top = rel.split('/')[0];

          // ── POST 上传 ──
          if (req.method === 'POST' && rel === 'upload') {
            handleUpload(req, res);
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

          // ── 目录白名单（wallpaper/music 在真实数据目录，GIF 在插件根）──
          if (!ALLOWED_DIRS.has(top)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
          }
          // wallpaper/music → 真实数据目录；GIF → 仓库根（开屏动画）
          const base = top === 'wallpaper' ? wallpaperDir() : (top === 'music' ? musicDir() : ROOT);
          // rel 含顶层目录（如 wallpaper/custom-x.mp4），base 已是真实数据目录，去掉顶层
          const relFile = top === 'wallpaper' || top === 'music' ? rel.slice((top + '/').length) : rel;
          const file = normalize(join(base, relFile));
          if (!file.startsWith(base) || !existsSync(file) || !statSync(file).isFile() || basename(file).startsWith('.trash-')) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
          }
          const mime = MIME[extname(file).toLowerCase()] ?? 'application/octet-stream';
          res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache' });
          createReadStream(file).pipe(res);
        },
      });
      wired = true;
    } catch (e) {
      /* 注册失败静默，主题其余部分照常 */
    }
  });
  return wired;
}

/** DSH 插件应用入口（DSH 调用）。 */
export function apply(ctx) {
  // 仓库根 music/、wallpaper/ 整目录一次性迁移到真实数据目录（幂等：已存在非空即跳过）
  bootstrapDataDirs();
  registerAssets(ctx);
  // 在线资源：主题启动时后台静默下载缺失项（配置为空自动跳过）
  ensureOnlineDownload();
}
