/**
 * dsh-theme-mediascape —— 服务端半。
 * 主题的全部 UI 逻辑在浏览器端（lib/client.js）。
 * 本文件提供三件事：
 *   1. apply：让 cordis.patch.yml 里的 loader 行可以挂载（没有 fiber 的行会导致 boot 扫描失败）。
 *   2. 静态资产路由：把 assets/、GIF/、music/、wallpapers/ 下的壁纸/动图/音乐以
 *      /theme-mediascape-assets/<相对路径> 提供（外置，不内联 base64），
 *      使 client.js 的聚合 bundle 保持小体积（实测内联 base64 会把
 *      lib/client.js 撑到 82MB，导致 client-modules 聚合 95MB、浏览器
 *      Failed to load plugins）。
 *   3. 用户上传壁纸持久化：POST /theme-mediascape-assets/upload 接收上传文件写入
 *      <DSH_HOME>/theme-firefly/wallpapers/（服务器磁盘），刷新/重启/换浏览器
 *      都在——不依赖浏览器 IndexedDB（IndexedDB 会因版本不匹配/配额超限静默失败，
 *      且换浏览器即丢）。
 */
import { createReadStream, existsSync, statSync, statfsSync, mkdirSync, writeFileSync, readFileSync, readdirSync, renameSync, createWriteStream, rmSync } from 'node:fs';
import { join, normalize, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import os from 'node:os';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.mp4': 'video/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.json': 'application/json',
};

/** 允许被静态服务的顶层目录（相对插件根）。 */
const ALLOWED_DIRS = new Set(['assets', 'GIF', 'music', 'wallpapers']);

/** 上传文件允许的扩展名（与客户端 input accept 一致）。 */
const ALLOWED_UPLOAD_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.mp4']);

/**
 * 单文件上传上限（字节）——按磁盘剩余空间动态计算，不写死。
 * 策略：单文件最多占用「当前剩余可用空间」的一定比例（默认 80%），
 * 同时设一个硬底线（默认 512MB）保证常规壁纸/短视频总能传；
 * statfs 不可用时回退 1GB。上限随磁盘余量自动伸缩：装得下就传，快满了自动收紧。
 */
const MAX_UPLOAD_RATIO = 0.8;      // 单文件最多占用剩余空间的 80%
const MIN_UPLOAD_LIMIT = 512 * 1024 * 1024; // 硬底线 512MB
const FALLBACK_UPLOAD_LIMIT = 1024 * 1024 * 1024; // statfs 失败回退 1GB

function uploadLimitBytes(dir) {
  try {
    const s = statfsSync(dir);
    const avail = s.bavail * s.bsize; // bavail=非 root 可用块数，bsize=块大小
    if (!(avail > 0)) return FALLBACK_UPLOAD_LIMIT;
    // 受 2^53 安全整数约束（实际磁盘远达不到），Math.floor 求整
    const bySpace = Math.floor(avail * MAX_UPLOAD_RATIO);
    return Math.max(bySpace, MIN_UPLOAD_LIMIT);
  } catch {
    return FALLBACK_UPLOAD_LIMIT;
  }
}

/** 用户壁纸存储目录：$DSH_HOME/theme-firefly/wallpapers/（DSH_HOME 缺失时回退 ~/.dsh）。 */
function wallpaperDir() {
  const base = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  return join(base, 'theme-firefly', 'wallpapers');
}

/**
 * 用户上传壁纸的名字映射表：wallpapers/.labels.json（{ "custom-xxx": "原始文件名去掉扩展名" }）。
 * 落盘文件被重命名为 custom-*.ext，若不保存原始名，列表只能显示磁盘名（customxxx）。
 * labelMap 快照缓存在模块级，避免每个请求读盘；writeLabels 后同步刷新快照。
 */
const LABELS_FILE = '.labels.json';
let labelMap = null;
function labelsFilePath() { return join(wallpaperDir(), LABELS_FILE); }
/** 读取 labels 映射（懒加载 + 模块级缓存；读不到/解析失败返回空对象）。 */
function loadLabels() {
  if (labelMap) return labelMap;
  try {
    const p = labelsFilePath();
    labelMap = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  } catch { labelMap = {}; }
  return labelMap;
}
/** 写入 labels 映射并刷新缓存（原子写：先写临时文件再 rename）。 */
function saveLabels(map) {
  labelMap = map;
  const dir = wallpaperDir();
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, LABELS_FILE + '.tmp');
  writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  renameSync(tmp, join(dir, LABELS_FILE));
}

/**
 * ── 在线资源下载（与上传同一套 hash 机制，只是来源是 http(s) 而非用户本地文件）──
 * 配置：lib/online-sources.json，格式 { "sources": { "<sha1-40hex>": { "name": "xx.mp4", "url": "http://..." } } }。
 * 行为：
 *   - 内置配置随主题分发；主题 apply 时后台静默启动全量下载（不 await、不阻塞启动）。
 *   - 目标 = wallpapers/online/<hash><ext>，已存在即跳过（内容寻址幂等）。
 *   - 断点续传：下载中状态为 <hash><ext>.part；已有 .part 时按偏移发 Range 请求，
 *     206 追加、200/416 从头重下；中断保留 .part，下次启动从断点继续。
 *   - SHA-1 校验完整文件内容（回读既有 part + 续传新块），一致才 rename 落定并写 labels；
 *     不一致删除 .part 并告警（防错源/篡改）。失败一律保留 .part 供续传。
 *   - 开关：配置存在但 sources 为空 → 直接跳过（骨架状态不做事）。
 */
const ONLINE_SOURCES_FILE = join(ROOT, 'lib', 'online-sources.json');
const ONLINE_DIR_NAME = 'online';
const ONLINE_CONCURRENCY = 3;       // 并发下载数（防一次拉爆带宽/磁盘）
const ONLINE_DL_TIMEOUT = 60 * 1000; // 单请求无数据超时
const ONLINE_DL_RETRY = 2;          // 失败重试次数（断点续传天然可重入）

function onlineDir() { return join(wallpaperDir(), ONLINE_DIR_NAME); }

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
      if (!name || !/^https?:\/\//i.test(url)) continue;
      out.push({ hash: hash.toLowerCase(), name, url });
    }
    return out;
  } catch { return []; }
}

/** 下载单个在线资源（断点续传 + SHA-1 校验），返回 {ok, skipped|downloaded, detail}。 */
function downloadOne(src) {
  return new Promise((resolve) => {
    const dir = onlineDir();
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

    // 回读磁盘 part 全部内容 → { h: 已累计 SHA-1, size: 已下载字节 }
    // 每次下载尝试（含重试/续传）都基于磁盘现状重建 hash，杜绝闭包状态漂移。
    function prehash() {
      return new Promise((res2) => {
        if (!existsSync(part)) { res2({ h: createHash('sha1'), size: 0 }); return; }
        const h = createHash('sha1');
        const rs = createReadStream(part);
        rs.on('data', (c) => h.update(c));
        rs.on('error', () => res2({ h, size: 0 }));
        rs.on('end', () => {
          let sz = 0;
          try { sz = statSync(part).size; } catch {}
          res2({ h, size: sz });
        });
      });
    }

    function retry(msg, triesLeft) {
      if (triesLeft <= 0) { resolve({ ok: false, detail: msg }); return; }
      prehash().then(({ h, size }) => attempt(size, h, triesLeft - 1));
    }

    function attempt(offset, hashAcc, tries) {
      const headers = { 'user-agent': 'dsh-theme-mediascape/1.0.1' };
      if (offset > 0) headers.range = 'bytes=' + offset + '-';
      const req = mod.get(src.url, { headers, timeout: ONLINE_DL_TIMEOUT }, (res) => {
        const status = res.statusCode || 0;
        // 服务器不支持 Range（200 全文）或偏移无效（416）→ 清空 part 从头重下
        if (offset > 0 && (status === 200 || status === 416)) {
          res.resume();
          try { rmSync(part, { force: true }); } catch {}
          attempt(0, createHash('sha1'), tries);
          return;
        }
        if (status !== 200 && status !== 206) {
          res.resume();
          retry('http ' + status, tries);
          return;
        }
        const ws = createWriteStream(part, { flags: 'a' }); // 续传追加 / 从头新建
        let size = offset;                                  // 累计字节，用于超限
        let settled = false;
        const failTo = (msg, t) => {
          if (settled) return; settled = true;
          try { ws.destroy(); } catch {}
          retry(msg, t);
        };
        res.on('data', (c) => {
          size += c.length;
          hashAcc.update(c);
          if (size > limit) {
            if (settled) return; settled = true;
            req.destroy();                    // 中断出站连接（保留/清理 part 由重试路径处理）
            try { ws.destroy(); } catch {}
            try { rmSync(part, { force: true }); } catch {}
            resolve({ ok: false, detail: 'over limit' });
          }
        });
        res.on('error', (e) => failTo(e?.message, tries));
        ws.on('error', (e) => failTo(e?.message, tries));
        ws.on('finish', () => {
          if (settled) return; settled = true;
          const got = hashAcc.digest('hex'); // 续传时 hashAcc 已含既有 part 回读 + 新块
          if (got !== src.hash) {
            try { rmSync(part, { force: true }); } catch {}
            resolve({ ok: false, detail: 'sha1 mismatch got=' + got });
            return;
          }
          try { renameSync(part, final); } catch (e) { resolve({ ok: false, detail: 'rename: ' + e?.message }); return; }
          // 与上传一致：labels[hash] = 文件名去后缀（前端显示不带后缀）
          const map = loadLabels();
          map[src.hash] = src.name.replace(/\.[^.]+$/, '');
          saveLabels(map);
          resolve({ ok: true, downloaded: true, detail: 'saved' });
        });
        res.pipe(ws);
      });
      req.on('timeout', () => { req.destroy(new Error('timeout')); });
      req.on('error', (e) => retry(e?.message, tries));
    }

    prehash().then(({ h, size }) => attempt(size, h, ONLINE_DL_RETRY));
  });
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
function ensureOnlineDownload() {
  if (onlineStarted) return;
  onlineStarted = true;
  // 后台静默：setImmediate 延迟，绝不阻塞 apply / 主题启动
  setImmediate(() => { downloadAllOnline().catch(() => {}); });
}

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

/** 删除用户壁纸文件（仅允许 wallpapers/ 目录内）。 */
function handleDelete(req, res, rel) {
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
function handleList(res) {
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
function handleUpload(req, res) {
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

/** DSH 插件应用入口（DSH 调用）。 */
export function apply(ctx) {
  registerAssets(ctx);
  // 在线资源：主题启动时后台静默下载缺失项（配置为空自动跳过）
  ensureOnlineDownload();
}
