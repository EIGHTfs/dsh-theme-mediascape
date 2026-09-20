/**
 * 在线资源下载（hash 主键配置、后台静默下载、断点续传 .part）
 */

import { createReadStream, existsSync, statSync, mkdirSync, readFileSync, renameSync, createWriteStream, rmSync } from 'node:fs';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { ROOT, uploadLimitBytes } from './config.js';
import { loadLabels, loadMusicLabels, saveLabels, saveMusicLabels } from './labels.js';
import { musicDir, onlineDir } from './paths.js';

/**
 * ── 在线资源下载（与上传同一套 hash 机制，只是来源是 http(s) 而非用户本地文件）──
 * 配置：lib/sources.json，格式 { "sources": { "<sha1-40hex>": { "name": "xx.mp4", "url": "http://...", "kind": "wallpaper|music" } } }。
 * 行为：
 *   - 内置配置随主题分发；主题 apply 时后台静默启动全量下载（不 await、不阻塞启动）。
 *   - 目标按 kind 分流：wallpaper → wallpaper/online/<hash><ext>；music → music/<hash><ext>。
 *     已存在即跳过（内容寻址幂等）。
 *   - 断点续传：下载中状态为 <hash><ext>.part；已有 .part 时按偏移发 Range 请求，
 *     206 追加、200/416 从头重下；中断保留 .part，下次启动从断点继续。
 *   - SHA-1 校验完整文件内容（回读既有 part + 续传新块），一致才 rename 落定并写 labels；
 *     不一致删除 .part 并告警（防错源/篡改）。失败一律保留 .part 供续传。
 *   - 开关：配置存在但 sources 为空 → 直接跳过（骨架状态不做事）。
 */
const ONLINE_SOURCES_FILE = join(ROOT, 'lib', 'sources.json');

/** 读取在线配置（解析失败/空 sources → []，不抛错）。 */
function loadOnlineSources() {
  try {
    if (!existsSync(ONLINE_SOURCES_FILE)) return [];
    const cfg = JSON.parse(readFileSync(ONLINE_SOURCES_FILE, 'utf8'));
    const out = [];
    for (const [hash, v] of Object.entries(cfg.sources || {})) {
      if (!/^[0-9a-f]{40}$/i.test(hash) || !v || typeof v !== 'object') continue; // 键必须 40 位 hex
      const name = String(v.name ?? '').trim();
      const url = String(v.url ?? '').trim();
      const kind = String(v.kind ?? 'wallpaper').trim() === 'music' ? 'music' : 'wallpaper';
      if (!name || !/^https?:\/\//i.test(url)) continue;
      out.push({ hash: hash.toLowerCase(), name, url, kind });
    }
    return out;
  } catch { return []; }
}

const ONLINE_CONCURRENCY = 3;       // 并发下载数（防一次拉爆带宽/磁盘）

const ONLINE_DL_TIMEOUT = 60 * 1000; // 单请求无数据超时

const ONLINE_DL_RETRY = 2;          // 失败重试次数（断点续传天然可重入）

/** 下载单个在线资源（断点续传 + SHA-1 校验），返回 {ok, skipped|downloaded, detail}。 */
function downloadOne(src) {
  return new Promise((resolve) => {
    // kind 分流：壁纸 → wallpaper/online/；音乐 → music/
    const dir = src.kind === 'music' ? musicDir() : onlineDir();
    mkdirSync(dir, { recursive: true });
    const ext = extname(src.name).toLowerCase();
    const final = join(dir, src.hash + ext);
    const part = join(dir, src.hash + ext + '.part');
    const limit = uploadLimitBytes(dir);
    const mod = /^https:/i.test(src.url) ? https : http;

    // 已校验完成 → 无需任何网络请求
    if (existsSync(final) && statSync(final).isFile()) {
      resolve({ ok: true, skipped: true, detail: 'exists' });
      return;
    }
    const partSize = existsSync(part) ? statSync(part).size : 0;
    if (partSize > limit) { // 既有 part 已超上限 → 没有续传意义，清掉
      try { rmSync(part, { force: true }); } catch {}
      resolve({ ok: false, detail: 'part over limit' });
      return;
    }

    // 下载状态上下文（模块级 helper 通过它访问闭包依赖；避免巨型闭包嵌套）
    const dlCtx = { src, dir, final, part, limit, mod, resolve };
    prehash(dlCtx).then(({ h, size }) => attempt(size, h, ONLINE_DL_RETRY, dlCtx));
  });
}

// ── 下载 helper（模块级；通过 dlCtx 共享路径/上限/结果回调，杜绝巨型闭包）──

/** 回读磁盘 part 全部内容 → { h: 已累计 SHA-1, size: 已下载字节 }。每次尝试都基于磁盘现状重建，杜绝状态漂移。 */
function prehash(ctx) {
  return new Promise((res2) => {
    if (!existsSync(ctx.part)) { res2({ h: createHash('sha1'), size: 0 }); return; }
    const h = createHash('sha1');
    const rs = createReadStream(ctx.part);
    rs.on('data', (c) => h.update(c));
    rs.on('error', () => res2({ h, size: 0 }));
    rs.on('end', () => {
      let sz = 0;
      try { sz = statSync(ctx.part).size; } catch {}
      res2({ h, size: sz });
    });
  });
}

/** 重试：还有次数则基于磁盘现状重建 hash 继续；否则结束失败。 */
function retry(msg, triesLeft, ctx) {
  if (triesLeft <= 0) { ctx.resolve({ ok: false, detail: msg }); return; }
  prehash(ctx).then(({ h, size }) => attempt(size, h, triesLeft - 1, ctx));
}

/** 响应流 → part 落盘 → SHA-1 校验 → rename 落定 + 登记显示名（按 kind 分流）。 */
function handleResponse(res, offset, hashAcc, tries, ctx) {
  const status = res.statusCode || 0;
  // 服务器不支持 Range（200 全文）或偏移无效（416）→ 清空 part 从头重下
  if (offset > 0 && (status === 200 || status === 416)) {
    res.resume();
    try { rmSync(ctx.part, { force: true }); } catch {}
    attempt(0, createHash('sha1'), tries, ctx);
    return;
  }
  if (status !== 200 && status !== 206) {
    res.resume();
    retry('http ' + status, tries, ctx);
    return;
  }
  const ws = createWriteStream(ctx.part, { flags: 'a' }); // 续传追加 / 从头新建
  let size = offset;                                  // 累计字节，用于超限
  let settled = false;
  const failTo = (msg, t) => {
    if (settled) return; settled = true;
    try { ws.destroy(); } catch {}
    retry(msg, t, ctx);
  };
  res.on('data', (c) => {
    size += c.length;
    hashAcc.update(c);
    if (size > ctx.limit) {
      if (settled) return; settled = true;
      req.destroy();                    // 中断出站连接（保留/清理 part 由重试路径处理）
      try { ws.destroy(); } catch {}
      try { rmSync(ctx.part, { force: true }); } catch {}
      ctx.resolve({ ok: false, detail: 'over limit' });
    }
  });
  res.on('error', (e) => failTo(e?.message, tries));
  ws.on('error', (e) => failTo(e?.message, tries));
  ws.on('finish', () => {
    if (settled) return; settled = true;
    const got = hashAcc.digest('hex'); // 续传时 hashAcc 已含既有 part 回读 + 新块
    if (got !== ctx.src.hash) {
      try { rmSync(ctx.part, { force: true }); } catch {}
      ctx.resolve({ ok: false, detail: 'sha1 mismatch got=' + got });
      return;
    }
    try { renameSync(ctx.part, ctx.final); } catch (e) { ctx.resolve({ ok: false, detail: 'rename: ' + e?.message }); return; }
    // 落盘后登记显示名（按 kind 分流）：
    //   壁纸：wallpaper.json[hash] = 文件名去扩展名（前端显示不带后缀）
    //   音乐：music.json[hash] = { name: 文件名, cover: 同名封面|空 }
    if (ctx.src.kind === 'music') {
      const mm = loadMusicLabels();
      mm[ctx.src.hash] = { name: ctx.src.name, cover: '' };
      saveMusicLabels(mm);
    } else {
      const map = loadLabels();
      map[ctx.src.hash] = ctx.src.name.replace(/\.[^.]+$/, '');
      saveLabels(map);
    }
    ctx.resolve({ ok: true, downloaded: true, detail: 'saved' });
  });
  res.pipe(ws);
}

/** 发起一次 HTTP 下载尝试（带 Range 断点续传）。 */
function attempt(offset, hashAcc, tries, ctx) {
  const headers = { 'user-agent': 'dsh-theme-mediascape/1.0.1' };
  if (offset > 0) headers.range = 'bytes=' + offset + '-';
  const req = ctx.mod.get(ctx.src.url, { headers, timeout: ONLINE_DL_TIMEOUT }, (res) => {
    handleResponse(res, offset, hashAcc, tries, ctx);
  });
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.on('error', (e) => retry(e?.message, tries, ctx));
}

/** 后台全量下载在线资源（并发池），全部完成后静默结束。 */
async function downloadAllOnline() {
  const sources = loadOnlineSources();
  if (sources.length === 0) return;
  const dir = onlineDir();
  mkdirSync(dir, { recursive: true });
  let cursor = 0;
  const worker = async () => {
    while (cursor < sources.length) {
      const src = sources[cursor++];
      try {
        const r = await downloadOne(src);
        if (!r.ok) console.warn('[mediascape] 在线资源下载失败：' + src.name + ' → ' + r.detail);
      } catch (e) { console.warn('[mediascape] 在线资源下载异常：' + src.name + ' → ' + String(e?.message ?? e)); }
    }
  };
  const workers = [];
  for (let i = 0; i < Math.min(ONLINE_CONCURRENCY, sources.length); i++) workers.push(worker());
  await Promise.all(workers);
}

// 模块级节流：同一进程只触发一次在线下载（防 apply 多次调用/重复扫描）
let onlineStarted = false;

export function ensureOnlineDownload() {
  if (onlineStarted) return;
  onlineStarted = true;
  // 后台静默：setImmediate 延迟，绝不阻塞 apply / 主题启动
  setImmediate(() => { downloadAllOnline().catch(() => {}); });
}
