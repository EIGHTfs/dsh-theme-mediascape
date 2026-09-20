/**
 * HTTP 处理器（删除 / 列表 / 上传）
 */

import { existsSync, statSync, mkdirSync, writeFileSync, readdirSync, renameSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { ALLOWED_UPLOAD_EXT, uploadLimitBytes } from './config.js';
import { loadLabels, saveLabels } from './labels.js';
import { LABELS_FILE, ONLINE_DIR_NAME, onlineDir, wallpaperDir } from './paths.js';

/** 删除用户壁纸文件（仅允许 wallpapers/ 目录内）。 */
export function handleDelete(req, res, rel) {
  try {
    const dir = wallpaperDir();
    const relFile = rel.startsWith('wallpapers/') ? rel.slice('wallpapers/'.length) : rel;
    const file = normalize(join(dir, relFile));
    // 仅允许 wallpapers/ 目录内的常规文件（排除 .trash-* 回收文件自身）
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile() || basename(file).startsWith('.trash-')) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'bad file' }));
      return;
    }
    if (!existsSync(file)) {
      res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'not found' }));
      return;
    }
    // 用 rename 到回收命名（.trash 前缀），保留可恢复性而非直接删
    const trash = join(dir, '.trash-' + Date.now().toString(36) + '-' + rel.replace(/[/\\]/g, '_'));
    mkdirSync(dir, { recursive: true });
    renameSync(file, trash);
    // 同步清理名字映射，避免列表残留已删壁纸的 label 记录
    const id = basename(file).replace(/\.[^.]+$/, '');
    const map = loadLabels();
    if (map[id]) { delete map[id]; saveLabels(map); }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/** 列出用户已上传壁纸（wallpapers/ 目录扫描）+ 在线下载资源（wallpapers/online/），返回 [{id, kind, label, url}]。 */
export function handleList(res) {
  try {
    const dir = wallpaperDir();
    if (!existsSync(dir)) {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, items: [] }));
      return;
    }
    const labels = loadLabels();
    const items = readdirSync(dir)
      .filter((f) => !f.startsWith('.trash-') && f !== LABELS_FILE && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
      .map((f) => {
        const ext = extname(f).toLowerCase();
        const id = f.replace(/\.[^.]+$/, '');
        return {
          id,
          kind: ext === '.mp4' ? 'video' : 'image',
          // 优先用上传时保存的原始文件名（label），没有（老文件）才回退磁盘名
          label: labels[id] || f.replace(/\.[^.]+$/, ''),
          url: '/theme-mediascape-assets/wallpapers/' + encodeURIComponent(f),
        };
      })
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    // ── 合并在线下载资源（wallpapers/online/）：同 id（同内容 hash）顶层用户文件优先 ──
    const odir = onlineDir();
    if (existsSync(odir)) {
      const ids = new Set(items.map((x) => x.id));
      const online = readdirSync(odir)
        .filter((f) => !f.startsWith('.trash-') && !f.endsWith('.part') && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
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
            kind: ext === '.mp4' ? 'video' : 'image',
            label: labels[id] || f.replace(/\.[^.]+$/, ''),
            url: '/theme-mediascape-assets/wallpapers/' + ONLINE_DIR_NAME + '/' + encodeURIComponent(f),
          };
        });
      items.push(...online);
    }
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/** 处理上传：收集 raw body → SHA-1(hash) 做键 → 校验扩展名 → 写入 wallpapers/ → 返回 {ok, url}。 */
export function handleUpload(req, res) {
  const chunks = [];
  let size = 0;
  let aborted = false;
  // 内容寻址：SHA-1 流式累计（40 位 hex 做磁盘文件名键），同内容天然去重。
  // 弃用 custom-<时间戳><随机> 键：同内容会落两份、列表重名混乱；
  // hash 键让服务器成为去重权威（前端 name:size 只作发送前快速跳过）。
  const hash = createHash('sha1');
  const dir = wallpaperDir();
  const limit = uploadLimitBytes(dir);
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    hash.update(c);
    if (size > limit) { // 单文件上限：按磁盘剩余空间动态计算（uploadLimitBytes）
      aborted = true;
      const mb = Math.round(limit / 1024 / 1024);
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'file too large', limit, limitMb: mb }));
      // 不 req.destroy()：粗暴断连会在 DSH 反代的 keep-alive 连接池留下半死连接，
      // 后续请求复用它会 EPIPE/408/502（实测：214MB 超限 destroy 后，反代对后续上传全挂）。
      // 用 drain 丢弃剩余 body，等客户端发完再自然关闭，保持连接池健康。
      req.on('data', () => {});
      req.resume();
      return;
    }
    chunks.push(c);
  });
  req.on('end', () => {
    if (aborted) return;
    // 文件名从 ?name= 查询参数取（客户端 fetch 时带上）
    const url = new URL(req.url ?? '/', 'http://x');
    const name = decodeURIComponent(url.searchParams.get('name') ?? 'wallpaper');
    const ext = extname(name).toLowerCase();
    if (!ALLOWED_UPLOAD_EXT.has(ext)) {
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'unsupported type: ' + ext }));
      return;
    }
    try {
      const id = hash.digest('hex'); // SHA-1 40 位 hex，兼作磁盘文件名主干与列表 id
      const file = join(dir, id + ext);
      const kind = ext === '.mp4' ? 'video' : 'image';
      // 保存原始文件名（去扩展名）到 labels 映射，使列表能显示用户上传时的名字而非 hash 键
      const label = name.replace(/\.[^.]+$/, '');
      mkdirSync(dir, { recursive: true });
      const map = loadLabels();
      if (existsSync(file)) {
        // 同内容已存在：不写盘（复用既有文件），仅把文件名映射更新为本次上传名。
        // 用户决策：同内容只重命名，不保留旧文件名（防重名混乱，名称永远取最新一次）。
        map[id] = label;
        saveLabels(map);
        chunks.length = 0;
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: true,
          existing: true, // 告知客户端「已有同内容」，不重复入列表
          id,
          kind,
          label,
          url: '/theme-mediascape-assets/wallpapers/' + encodeURIComponent(id + ext),
        }));
        return;
      }
      writeFileSync(file, Buffer.concat(chunks));
      map[id] = label;
      saveLabels(map); // 注意：先清空 chunks 引用，避免大文件期间持有内存副本
      chunks.length = 0;
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        id,
        kind,
        label,
        url: '/theme-mediascape-assets/wallpapers/' + encodeURIComponent(id + ext),
      }));
    } catch (e) {
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
    }
  });
  req.on('error', () => { if (!aborted) { res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'stream error' })); } });
}
