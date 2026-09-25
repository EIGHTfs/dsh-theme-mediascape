/**
 * 在线资源下载（hash 主键配置、后台静默下载、断点续传 .part）
 */

import { createReadStream, existsSync, statSync, mkdirSync, readFileSync, renameSync, createWriteStream, rmSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { ROOT, uploadLimitBytes } from './config.js';
import { loadMusicLabels, saveMusicLabels } from './labels.js';
import { musicDir, onlineDir } from './paths.js';

/**
 * ── 在线资源下载（2026-09-21 改：落盘用原始文件名 src.name，与本地上传一致；SHA-1 仅用于内容校验）──
 * 配置：lib/sources.json，格式 { "sources": { "<sha1-40hex>": { "name": "xx.mp4", "url": "http://...", "kind": "wallpaper|music" } } }。
 * 行为：
 *   - 内置配置随主题分发；主题 apply 时后台静默启动全量下载（不 await、不阻塞启动）。
 *   - 目标按 kind 分流：wallpaper → wallpaper/online/<原始文件名>；music → music/<原始文件名>。
 *     已存在即跳过（文件名命中幂等）。
 *   - 断点续传：下载中状态为 <原始文件名>.part；已有 .part 时按偏移发 Range 请求，
 *     206 追加、200/416 从头重下；中断保留 .part，下次启动从断点继续。
 *   - SHA-1 校验完整文件内容（回读既有 part + 续传新块），与配置 hash 一致才 rename 落定；
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
    // 落盘用原始文件名（与上传/内置素材一致，不做 hash 重命名）
    const final = join(dir, src.name);
    const part = join(dir, src.name + '.part');
    const limit = uploadLimitBytes(dir);
    const mod = /^https:/i.test(src.url) ? https : http;

    // 已校验完成 → 无需任何网络请求
    if (existsSync(final) && statSync(final).isFile()) {
      resolve({ ok: true, skipped: true, detail: 'exists' });
      return;
    }
    const partSize = existsSync(part) ? statSync(part).size : 0;
    if (partSize > limit) { // 既有 part 已超上限 → 没有续传意义，清掉
      try { rmSync(part, { force: true }); } catch { /* 残留 .part 清理尽力而为，删不掉下次重下覆盖 */ }
      resolve({ ok: false, detail: 'part over limit' });
      return;
    }

    // 下载状态上下文（模块级 helper 通过它访问闭包依赖；避免巨型闭包嵌套）
    const dlCtx = { src, dir, final, part, limit, mod, resolve };
    prehash(dlCtx).then(({ hash, size }) => attempt(size, hash, ONLINE_DL_RETRY, dlCtx));
  });
}

// ── 下载 helper（模块级；通过 dlCtx 共享路径/上限/结果回调，杜绝巨型闭包）──

/** 回读磁盘 part 全部内容 → { h: 已累计 SHA-1, size: 已下载字节 }。每次尝试都基于磁盘现状重建，杜绝状态漂移。 */
function prehash(ctx) {
  return new Promise((res2) => {
    if (!existsSync(ctx.part)) { res2({ hash: createHash('sha1'), size: 0 }); return; }
    const hash = createHash('sha1');
    const rs = createReadStream(ctx.part);
    rs.on('data', (c) => hash.update(c));
    rs.on('error', () => res2({ hash, size: 0 }));
    rs.on('end', () => {
      let sz = 0;
      try { sz = statSync(ctx.part).size; } catch { /* 文件刚被并发清理/不存在 → size 保持 0 */ }
      res2({ hash, size: sz });
    });
  });
}

/** 重试：还有次数则基于磁盘现状重建 hash 继续；否则结束失败。 */
function retry(msg, triesLeft, ctx) {
  if (triesLeft <= 0) { ctx.resolve({ ok: false, detail: msg }); return; }
  prehash(ctx).then(({ hash, size }) => attempt(size, hash, triesLeft - 1, ctx));
}

/** 服务器不支持 Range（200 全文）或偏移无效（416）→ 清空 part 从头重下。 */
function handleUnresumable(res, tries, ctx) {
  res.resume();
  try { rmSync(ctx.part, { force: true }); } catch { /* 清 .part 尽力而为：已删/权限异常都跳过，重下覆盖 */ }
  attempt(0, createHash('sha1'), tries, ctx);
}

/** 累积字节超限 → 中断出站连接 + 清 part + 结束（over limit）。 */
function handleOverLimit(size, req, ws, ctx) {
  req.destroy();                    // 中断出站连接（保留/清理 part 由重试路径处理）
  try { ws.destroy(); } catch { /* 连接已结束：destroy 抛错可忽略 */ }
  try { rmSync(ctx.part, { force: true }); } catch { /* 清 .part 尽力而为：已删/权限异常都跳过，重下覆盖 */ }
  ctx.resolve({ ok: false, detail: 'over limit' });
}

/** 下载完成落定：SHA-1 校验 → rename 到最终名 →（music）登记显示名。返回 true=成功。 */
function finalizeDownload(hashAcc, ws, ctx) {
  const got = hashAcc.digest('hex'); // 续传时 hashAcc 已含既有 part 回读 + 新块
  if (got !== ctx.src.hash) {
    try { rmSync(ctx.part, { force: true }); } catch { /* 清 .part 尽力而为：已删/权限异常都跳过，重下覆盖 */ }
    ctx.resolve({ ok: false, detail: 'sha1 mismatch got=' + got });
    return false;
  }
  try { renameSync(ctx.part, ctx.final); } catch (e) { ctx.resolve({ ok: false, detail: 'rename: ' + e?.message }); return false; }
  // 落盘后登记（2026-09-21 改：与上传一致，key = 文件名去扩展名）：
  //   音乐：music.json[文件名去扩展名] = { name: 原始文件名, cover: 同名封面|空 }
  //   壁纸：磁盘文件名即显示名（去扩展名），无需 labels 解析——不再写 wallpaper.json
  if (ctx.src.kind === 'music') {
    const mm = loadMusicLabels();
    mm[ctx.src.name.replace(/\.[^.]+$/, '')] = { name: ctx.src.name, cover: '' };
    saveMusicLabels(mm);
  }
  ctx.resolve({ ok: true, downloaded: true, detail: 'saved' });
  return true;
}

/** 响应流 → part 落盘 → SHA-1 校验 → rename 落定 + 登记显示名（按 kind 分流）。 */
function handleResponse(res, offset, hashAcc, tries, ctx) {
  const status = res.statusCode || 0;
  if (offset > 0 && (status === 200 || status === 416)) {
    handleUnresumable(res, tries, ctx);
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
    try { ws.destroy(); } catch { /* 连接已结束：destroy 抛错可忽略 */ }
    retry(msg, t, ctx);
  };
  res.on('data', (c) => {
    size += c.length;
    hashAcc.update(c);
    if (size > ctx.limit && !settled) {
      settled = true;
      handleOverLimit(size, req, ws, ctx);
    }
  });
  res.on('error', (e) => failTo(e?.message, tries));
  ws.on('error', (e) => failTo(e?.message, tries));
  ws.on('finish', () => {
    if (settled) return; settled = true;
    finalizeDownload(hashAcc, ws, ctx);
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
  await mkdirAsync(dir, { recursive: true }); // 异步路径避免同步阻塞事件循环（recursive 幂等）
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
  setImmediate(() => { downloadAllOnline().catch(() => { /* 后台下载失败不打屏（内部已 console.warn 明细） */ }); });
}
