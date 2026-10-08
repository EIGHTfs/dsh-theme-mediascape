// ── Range/206 分片静态服务（**公共实现，唯一真源**）──
// 2026-10-09 抽出：原先 lib/index.js 与 theme-studio/start-preview.mjs 各有一份**逐字复制**的实现
//   （两处注释都写着“两处保持一致”），实际已经分叉：预览那份**缺图片 ETag 分支**、也**缺 1MB HWM 与
//   close 守卫**（后者是本模块修“开屏 auto 视频卡住”回归的关键）。改为单一真源后，两边行为自动一致。
//
// 服务语义（仅 media = video/* | audio/*）：
//   · 媒体 + Range 合法        → 206 + Accept-Ranges + Content-Range + 分片流
//   · 媒体 + If-Range 不匹配   → 200 全量（文件已换，绝不返回旧分片）
//   · 无 Range / 非媒体        → 200 全量（媒体带 1 天强缓存 + ETag；图片 no-cache + ETag；其它 no-cache）
//   · Range 非法或越界         → 416 + Content-Range: bytes */<total>
//   仅整数解析（RFC7233 bytes=<start>-<end> / bytes=<start>- / bytes=-<suffix>）。
//
// 与调用方的约定（抽公共模块时并入）：**本模块自己做存在性检查**——statSync 失败或非普通文件 → 404。
//   调用方只需保证路径已过“目录白名单 + 穿越校验”。（零额外成本：本模块本来就要 statSync 取 size；
//   而原先实机侧靠调用方检查、预览侧靠函数内检查，存在两套口径。）
import { createReadStream, statSync } from 'node:fs';

/** text/plain 响应头片段（404/416 用）。 */
export const HDR_TEXT_PLAIN = { 'content-type': 'text/plain; charset=utf-8' };
/** 媒体/静态 1 天强缓存。 */
export const HDR_CACHE_DAY = { 'cache-control': 'public, max-age=86400' };
/** 配置/页面即时生效（不缓存）。 */
export const HDR_CACHE_NONE = { 'cache-control': 'no-cache' };
/** 静态流大块（1MB）：减少事件循环开销、提升大文件流式吞吐。 */
export const STREAM_HIGH_WATER_MARK = 1024 * 1024;

/**
 * 解析 Range 头（RFC7233 整数形式）。
 * 2026-09-23 拆（审计 max-cyclomatic 29）：非法或越界返回 null（调用方回 416）；
 * bytes=-<suffix> 后缀语义、边界钳制都在此完成。
 * @param {string} range Range 头原文
 * @param {number} total 文件总字节
 * @returns {{start:number,end:number}|null}
 */
export function parseRange(range, total) {
  if (!range) return null;
  const rangeMatch = /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (!rangeMatch) return null; // 非法 Range（不是 bytes=N-M 形）
  let start = null, end = null;
  if (rangeMatch[1] !== '') start = Number(rangeMatch[1]);
  if (rangeMatch[2] !== '') end = Number(rangeMatch[2]);
  // bytes=-<suffix>：末尾 suffix 字节 —— **必须同时把 end 从「后缀长度」改成 total-1**。
  //   历史 bug（2026-10-09 公共模块验收时实测暴露）：旧实现只改 start、把 end 留成后缀长度（如 100），
  //   于是在大文件上 start=total-100 > end=100 ⇒ 被判非法 ⇒ 对 `bytes=-100` 这类**尾部探测请求回 416**
  //   （播放器读 MP4 尾部 moov 会用到后缀 Range）。预览那份当年写对了（end=total-1），实机这份一直是错的；
  //   抽公共模块时按预览的正确写法统一。
  if (start === null && end !== null && Number.isInteger(end) && end >= 0) { start = Math.max(total - end, 0); end = total - 1; }
  if (start === null) start = 0;
  if (end === null || end >= total) end = total - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start > end || start >= total) return null;
  return { start, end };
}

/**
 * 统一读流管道（写死 1MB 大块 + 生命周期兜底）。
 * 2026-09-2x 下载防退化（长时运行连接/FD 累积）+ 修复实机开屏 auto 视频卡住：
 *   ①1MB 大块（highWaterMark）减少事件循环开销提速；
 *   ②读流错误 → 关响应（防悬挂连接）；
 *   ③客户端中断释放读流——**仅当响应未正常完成**（writableFinished=false）才销毁：
 *     Node 的 res 'close' 在正常 keep-alive 连接关闭时也触发（浏览器对视频 Range 流缓冲足够即关连接、
 *     需要再续），若无条件 rs.destroy() 会把进行中的大视频流掐断 → 实机开屏 auto 视频无数据卡住（回归）。
 * @param {import('node:http').ServerResponse} res
 * @param {string} file
 * @param {{start:number,end:number}} [range]
 */
export function pipeFile(res, file, range) {
  const rs = createReadStream(file, range ? { ...range, highWaterMark: STREAM_HIGH_WATER_MARK } : { highWaterMark: STREAM_HIGH_WATER_MARK });
  rs.on('error', () => { try { res.destroy(); } catch { /* 连接已断：忽略 */ } });
  res.on('close', () => { if (!res.writableFinished) rs.destroy(); }); // 正常完成不销毁；真中断才释放
  rs.pipe(res);
}

/**
 * 按 HTTP 语义发送一个静态文件（媒体走 Range 分片）。
 * @param {import('node:http').ServerResponse} res
 * @param {import('node:http').IncomingMessage} req
 * @param {string} file 绝对路径（调用方已过白名单/穿越校验）
 * @param {string} mime content-type（调用方按扩展名给出）
 */
export function serveStream(res, req, file, mime) {
  // 存在性/普通文件检查（抽公共模块时并入：实机侧原先由调用方检查、预览侧原先在函数内检查）
  let st;
  try {
    st = statSync(file);
  } catch {
    res.writeHead(404, { ...HDR_TEXT_PLAIN });
    res.end('not found');
    return;
  }
  if (!st.isFile()) {
    res.writeHead(404, { ...HDR_TEXT_PLAIN });
    res.end('not found');
    return;
  }
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
