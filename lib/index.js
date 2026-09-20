import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import http from 'node:http';
import { ALLOWED_DIRS, MIME, ROOT } from './config.js';
import { handleDelete, handleList, handleUpload } from './handlers.js';
import { ensureOnlineDownload } from './online.js';
import { wallpaperDir } from './paths.js';

/**
 * 服务端半注册 HTTP 前缀路由（真实 API：webServer.register({kind:'prefix', path, handler})）。
 * 分流规则：
 *   POST /theme-mediascape-assets/upload → 接收 raw body 写入 wallpapers/，返回 {ok, url}
 *   GET  /theme-mediascape-assets/wallpapers/<file> → 静态服务用户壁纸
 *   GET  /theme-mediascape-assets/<assets|GIF|music>/<file> → 静态服务内置素材
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
          if (req.method === 'DELETE' && top === 'wallpapers') {
            handleDelete(req, res, rel);
            return;
          }

          // ── GET 用户壁纸清单 ──
          if (req.method === 'GET' && rel === 'wallpapers/list') {
            handleList(res);
            return;
          }

          // ── 目录白名单（wallpapers 在 wallpapersDir，其余在插件根）──
          if (!ALLOWED_DIRS.has(top)) {
            res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
            res.end('not found');
            return;
          }
          const base = top === 'wallpapers' ? wallpaperDir() : ROOT;
          // rel 含顶层目录（如 wallpapers/custom-x.mp4），wallpapers 时 base 已是目录，去掉顶层
          const relFile = top === 'wallpapers' ? rel.slice('wallpapers/'.length) : rel;
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
  registerAssets(ctx);
  // 在线资源：主题启动时后台静默下载缺失项（配置为空自动跳过）
  ensureOnlineDownload();
}
