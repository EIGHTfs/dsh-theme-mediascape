/**
 * HTTP 处理器（删除 / 列表 / 上传）
 */

import { existsSync, statSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { ALLOWED_UPLOAD_EXT, UPLOAD_ACCEPT, uploadLimitBytes } from './config.js';
import { loadLabels, saveLabels } from './labels.js';
import { LABELS_FILE, ONLINE_DIR_NAME, onlineDir, wallpaperDir } from './paths.js';

/** 客户端配置：返回上传允许的扩展名串（客户端 input.accept 读此值，单一权威源）。 */
export function handleConfig(res) {
  res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    ok: true,
    uploadAccept: UPLOAD_ACCEPT, // 由 config.js ALLOWED_UPLOAD_EXT 派生（".png,.jpg,.jpeg,.webp,.mp4"；扩展名形式→系统选择器保留「文件」入口）
  }));
}

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

/**
 * 处理上传（自研重写 2026-09-20）：收集 raw body → SHA-1 内容指纹（仅作内部去重判定）→
 * 落盘为「原始文件名」（同名不同内容自动加 (1)(2)… 后缀，绝不覆盖既有文件）→ 返回 {ok, url, existing}。
 * 日志：请求接收 / 大小 / 落盘或复用决策 / 响应均带 traceId，全流程可追踪。
 */
export function handleUpload(req, res) {
  const traceId = 'U' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const chunks = [];
  let size = 0;
  let aborted = false;
  // 内容指纹：SHA-1 流式累计（40 位 hex）做磁盘文件名主键（内容寻址，同内容天然去重）；
  // 显示名存 .labels.json（hash → 原始文件名去扩展名），用户可手动编辑改显示名。
  const hash = createHash('sha1');
  const dir = wallpaperDir();
  const limit = uploadLimitBytes(dir);
  console.log(`[upload][${traceId}] receive request`);
  req.on('data', (c) => {
    if (aborted) return;
    size += c.length;
    hash.update(c);
    if (size > limit) { // 单文件上限：按磁盘剩余空间动态计算（uploadLimitBytes）
      aborted = true;
      const mb = Math.round(limit / 1024 / 1024);
      console.warn(`[upload][${traceId}] reject too large size=${size} limit=${limit}`);
      res.writeHead(413, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'file too large', limit, limitMb: mb, traceId }));
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
    // 显示名（原始文件名）从 ?name= 查询参数取（客户端 fetch 带 file.name 编码而来）；
    // 手机/平板系统给的 file.name 可能是数字等，绕不回去，json 存什么显示什么。
    const url = new URL(req.url ?? '/', 'http://x');
    const rawName = decodeURIComponent(url.searchParams.get('name') ?? 'wallpaper');
    // 名字清洗：取 basename 去路径分隔（防 ../ 穿越），Windows 反斜杠视为分隔替换为 _
    const safeName = basename(rawName.replace(/[\\/]/g, '_'));
    const ext = extname(safeName).toLowerCase();
    console.log(`[upload][${traceId}] received name=${safeName} size=${size} ext=${ext}`);
    if (!ext || !ALLOWED_UPLOAD_EXT.has(ext)) {
      console.warn(`[upload][${traceId}] reject unsupported type=${ext}`);
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'unsupported type: ' + ext, traceId }));
      chunks.length = 0;
      return;
    }
    try {
      const digest = hash.digest('hex'); // SHA-1 40 位 hex：磁盘文件名主干 + 列表 id + 去重主键
      const kind = ext === '.mp4' ? 'video' : 'image';
      const label = safeName.replace(/\.[^.]+$/, '') || 'wallpaper'; // 显示名 = 原始文件名去扩展名
      mkdirSync(dir, { recursive: true });
      const file = join(dir, digest + ext);
      const map = loadLabels();
      // 重复判断（json + 磁盘双重权威）：
      //   json 已有同 hash 主键 或 磁盘已存在同 hash 文件 → 重复，复用既有文件不写盘，
      //   仅把显示名更新为本次上传名（名称永远取最新一次，与 json 可编辑语义一致）。
      if (map[digest] !== undefined || existsSync(file)) {
        map[digest] = label;
        saveLabels(map);
        chunks.length = 0;
        console.log(`[upload][${traceId}] duplicate content → reuse file=${digest}${ext} label=${label}`);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          ok: true,
          existing: true, // 告知客户端「已有同内容」，不重复入列表
          id: digest,
          kind,
          label,
          traceId,
          url: '/theme-mediascape-assets/wallpapers/' + encodeURIComponent(digest + ext),
        }));
        return;
      }
      writeFileSync(file, Buffer.concat(chunks));
      map[digest] = label;
      saveLabels(map); // 先写盘再存映射；chunks 引用随后清空，避免大文件期间持有内存副本
      chunks.length = 0;
      console.log(`[upload][${traceId}] saved file=${digest}${ext} label=${label} sha1=${digest.slice(0, 8)}`);
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true,
        existing: false,
        id: digest,
        kind,
        label,
        traceId,
        url: '/theme-mediascape-assets/wallpapers/' + encodeURIComponent(digest + ext),
      }));
    } catch (e) {
      console.error(`[upload][${traceId}] error:`, e?.message ?? e);
      res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e), traceId }));
    }
  });
  req.on('error', (e) => {
    if (!aborted) {
      console.error(`[upload][${traceId}] stream error:`, e?.message ?? e);
      res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: false, error: 'stream error', traceId }));
    }
  });
}
