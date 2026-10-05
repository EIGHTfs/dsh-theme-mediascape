/**
 * HTTP 处理器（删除 / 列表 / 上传）
 */

import { existsSync, statSync, mkdirSync, readFileSync, readdirSync, renameSync, createReadStream, createWriteStream, writeFileSync, unlinkSync, appendFileSync, openSync, readSync, closeSync } from 'node:fs';
import { mkdir as mkdirAsync } from 'node:fs/promises';
import { join, normalize, extname, basename } from 'node:path';
import http from 'node:http';
import os from 'node:os';
import { ALLOWED_UPLOAD_EXT, ALLOWED_MUSIC_UPLOAD_EXT, ALLOWED_COVER_UPLOAD_EXT, VIDEO_EXT, UPLOAD_ACCEPT, uploadLimitBytes } from './config.js';
import { loadLabels, loadMusicLabels, saveLabels, saveMusicLabels } from './labels.js';
import { MUSIC_LABELS_FILE, ONLINE_DIR_NAME, WALLPAPER_LABELS_FILE, logsDir, musicDir, musicLabelsPath, onlineDir, wallpaperDir } from './paths.js';
import { readDebugConfig, logEnabled } from './debug.js';
import { writeLog } from './log.js';

// 2026-09-23 去重（审计 no-repeated-hardcoded-literals）：响应头与 URL 前缀公共片段提取（须在文件顶部，
// 供下方所有 handler 使用——声明在使用之前，避免 TDZ）
const HDR_JSON = { 'content-type': 'application/json; charset=utf-8' }; // JSON 响应头（29 处共用）
const WP_PREFIX = '/theme-mediascape-assets/wallpaper/'; // 壁纸资源 URL 前缀（4 处合成）
const MUSIC_PREFIX = '/theme-mediascape-assets/music/';   // 音乐资源 URL 前缀（4 处合成）

// 2026-09-2x 音乐封面图片扩展名（列表「同名推断封面」与删除「扫描删除封面」共用单一权威）：
// 封面有两种来源——music.json 的 cover 记录 / 磁盘同名图片推断（歌名.mp3 ↔ 歌名.png）；
// 删除音乐时必须两种都覆盖，否则 json 未记录/未同步时封面残留（重传同名音乐封面又回来）。
const MUSIC_COVER_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.gif'];

// 2026-09-2x 上传内存缓冲（定稿「上传中途不落盘 part，暂停落盘 part，继续从 part 续传」）：
// 上传数据先攒内存 buffer（不落盘），上限 = 可用内存 20%（动态，os.freemem() 实时取），
// 超限自动转写 .upload-<traceId>.tmp 保底（超大文件不 OOM）；请求中断（暂停/取消 abort）→
// 已收数据落盘为 <正式目标名>.part（暂停快照），内存即刻释放。落盘即释放是本方案的硬约束。
const MEM_BUFFER_RATIO = 0.2;                    // 内存缓冲上限 = 可用内存 20%（定稿）
const MEM_BUFFER_FLOOR = 16 * 1024 * 1024;       // 内存缓冲下限 16MB（防低内存机器算出过小阈值频繁转 tmp）

/** 客户端配置：返回上传允许的扩展名串（客户端 input.accept 读此值，单一权威源）。 */
export function handleConfig(res) {
  res.writeHead(200, { ...HDR_JSON });
  res.end(JSON.stringify({
    ok: true,
    uploadAccept: UPLOAD_ACCEPT, // 由 config.js ALLOWED_UPLOAD_EXT 派生（".png,.jpg,.jpeg,.webp,.mp4"；扩展名形式→系统选择器保留「文件」入口）
  }));
}

/** 删除用户壁纸文件（仅允许 wallpaper/ 目录内）。 */
// 删除单个壁纸文件（校验路径 + 真实 unlink + 清理 label 映射），返回 {ok, error?, status?}
// 2026-09-2x 拆（审计 max-function-length）：handleDelete 的删除动作提为纯函数
function deleteWallpaperFile(file, dir) {
  // 仅允许 wallpaper/ 目录内的常规文件（删除=unlink 真实删除，不再产生回收文件）
  if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile()) {
    return { ok: false, error: 'bad file', status: 400 };
  }
  if (!existsSync(file)) {
    return { ok: false, error: 'not found', status: 404 };
  }
  // 真实删除（unlink 运行态目录文件）——「移除=删除运行态文件，list 刷新显示」，
  // 删除后 list 重新扫描即不显示（文件已不存在）。
  unlinkSync(file);
  // 同步清理名字映射，避免列表残留已删壁纸的 label 记录
  const id = basename(file).replace(/\.[^.]+$/, '');
  const map = loadLabels();
  if (map[id]) { delete map[id]; saveLabels(map); }
  return { ok: true };
}

export function handleDelete(req, res, rel) {
  try {
    const dir = wallpaperDir();
    const relFile = rel.startsWith('wallpaper/') ? rel.slice('wallpaper/'.length) : rel;
    const file = normalize(join(dir, relFile));
    const result = deleteWallpaperFile(file, dir);
    if (!result.ok) {
      res.writeHead(result.status, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: result.error }));
      return;
    }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/** 列出用户已上传壁纸（wallpaper/ 目录扫描）+ 在线下载资源（wallpaper/online/），返回 [{id, kind, label, url}]。 */
// 扫描顶层壁纸目录：过滤 part/tmp/labels 文件 + 只留允许扩展名；stat 失败剔除失效项
// 2026-09-2x 拆（审计 max-function-length）：handleList 的目录扫描提为纯函数
function scanWallpaperDir(dir, labels) {
  return readdirSync(dir)
    .filter((f) => !f.endsWith('.part') && !f.endsWith('.tmp') && f !== WALLPAPER_LABELS_FILE && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
    .map((f) => {
      const ext = extname(f).toLowerCase();
      const id = f.replace(/\.[^.]+$/, '');
      // 文件不可 stat（被外部移动/删除/瞬态损坏）→ 剔除失效项，列表只返回真实存在可读素材
      let st = null;
      try { st = statSync(join(dir, f)); } catch (e) { return null; }
      return {
        id,
        kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
        // 优先用上传时保存的原始文件名（label），没有（老文件）才回退磁盘名
        label: labels[id] || f.replace(/\.[^.]+$/, ''),
        // file = 磁盘原始文件名（带扩展名）：前端上传预检「文件名+大小」去重基准
        file: f,
        size: st.size,
        url: WP_PREFIX + encodeURIComponent(f),
      };
    })
    .filter(Boolean)
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

// 合并在线下载资源（wallpaper/online/）：同 id（同内容 hash）顶层用户文件优先
function mergeOnlineWallpapers(items, labels) {
  const odir = onlineDir();
  if (!existsSync(odir)) return items;
  const ids = new Set(items.map((x) => x.id));
  const online = readdirSync(odir)
    .filter((f) => !f.endsWith('.part') && !f.endsWith('.tmp') && ALLOWED_UPLOAD_EXT.has(extname(f).toLowerCase()))
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
        kind: VIDEO_EXT.has(ext) ? 'video' : 'image',
        label: labels[id] || f.replace(/\.[^.]+$/, ''),
        url: WP_PREFIX + ONLINE_DIR_NAME + '/' + encodeURIComponent(f),
      };
    });
  return items.concat(online);
}

export function handleList(res) {
  try {
    const dir = wallpaperDir();
    if (!existsSync(dir)) {
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: true, items: [] }));
      return;
    }
    const labels = loadLabels();
    const items = mergeOnlineWallpapers(scanWallpaperDir(dir, labels), labels);
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}

/**
 * 列出音乐（music/ 目录扫描）+ music.json 显示名，返回 [{id, name, cover, url, custom}]。
 * 运行时拉取（build 不再内嵌音乐清单）；目录缺失返回空列表。
 */
export function handleMusicList(res) {
  try {
    const dir = musicDir();
    if (!existsSync(dir)) {
      res.writeHead(200, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: true, items: [] }));
      return;
    }
    const meta = loadMusicLabels();
    const audioExts = new Set(['.mp3', '.ogg', '.m4a', '.wav']);
    const imgExts = new Set(MUSIC_COVER_EXTS);
    const files = readdirSync(dir);
    const audioFiles = files.filter((f) => audioExts.has(extname(f).toLowerCase()) && !f.endsWith('.part') && !f.endsWith('.tmp'));
    const items = audioFiles
      .map((f) => {
        const id = f.replace(/\.[^.]+$/, '');
        // 2026-09-2x 统一「真实可用」判断：文件不可 stat（被外部移动/删除）→ 剔除失效项
        let st = null;
        try { st = statSync(join(dir, f)); } catch (e) { return null; }
        const metaEntry = meta[id];
        // 封面判定与「json 无记录（填空）」保持一致：
        //   ① json 记录的 cover 必须「文件真实存在」才采用——记录指向的文件被手动删除时，
        //      丢弃该孤儿值（否则前端 fetch 404），不阻挡后续回退；
        //   ② json 无有效 cover → 自动找同名图片文件（歌名.mp3 ↔ 歌名.png）；
        //   ③ 同名也没有 → 无封面 ''（前端显示 ♪ 占位）。
        const coverValid = typeof metaEntry?.cover === 'string' && metaEntry.cover && files.includes(metaEntry.cover);
        const cover = coverValid
          ? metaEntry.cover
          : (files.find((g) => imgExts.has(extname(g).toLowerCase()) && g.replace(/\.[^.]+$/, '') === id) || '');
        return {
          id,
          name: (typeof metaEntry?.name === 'string' && metaEntry.name) || f,
          // file = 磁盘原始文件名（带扩展名）；size：前端上传预检「文件名+大小」去重基准
          file: f,
          size: st.size,
          cover,
          url: MUSIC_PREFIX + encodeURIComponent(f),
          custom: true,
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    // 自动同步 music.json：把扫描到的实际内容写回清单——新增音乐自动登记、删除的自动移除、
    // 同名封面自动补 cover；保留用户已保存的 name/cover（不覆盖），仅当清单与目录有差异才落盘（避免无谓 IO）。
    const synced = {};
    for (const it of items) {
      const prev = meta[it.id];
      synced[it.id] = {
        name: (typeof prev?.name === 'string' && prev.name) || it.name,
        // 自动同步的 cover 只保留「文件真实存在」的值；孤儿 cover（记录在但文件被删）回退
        // 为同名扫描结果或空，下次 list 就已清洗——与 items 内封面判定口径一致（不保留孤儿）
        cover: (typeof prev?.cover === 'string' && prev.cover && files.includes(prev.cover)) ? prev.cover : it.cover,
      };
    }
    if (JSON.stringify(synced) !== JSON.stringify(meta)) {
      try { saveMusicLabels(synced); }
      catch (e) { console.warn('[music] labels 保存失败（不影响本次响应）:', e?.message ?? e); }
    }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, items }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}


/**
 * 接收上传 body（2026-09-2x 重写，「上传中途不落盘 part，暂停落盘 part，继续从 part 续传」）：
 *  - 常规（offset=0）：数据先攒内存 buffer（不落盘），上限 = 可用内存 20%（动态）；超过自动转写
 *    tmpPath（.upload-<traceId>.tmp）保底——超大文件不 OOM；请求中断（客户端暂停/取消 abort，
 *    触发 req error/close）→ 已收数据落盘为 partPath（<正式目标名>.part，暂停快照），内存即刻释放。
 *  - 续传（offset>0）：直接以追加模式（flags:'a'）打开 partPath 边收边写；end 后由调用方 rename 落定。
 * 超限（>limit）→ 清理中间态、drain 剩余 body（保持反代 keep-alive 连接池健康——粗暴 destroy
 * 会留半死连接，后续请求复用 EPIPE/408/502）→ resolve { aborted: true }。
 * @returns {Promise<{aborted:boolean, interrupted?:boolean, size?:number,
 *   payload?:{mode:'buffer'|'tmp'|'part', buf?:Buffer, tmpPath?:string, partPath?:string}}>}
 */
export function handleMusicDelete(req, res, rel) {
  try {
    const dir = musicDir();
    const relFile = rel.startsWith('music/') ? rel.slice('music/'.length) : rel;
    const file = normalize(join(dir, relFile));
    // 仅允许 music/ 目录内常规文件（排除 music.json 登记文件）
    if (!file.startsWith(dir) || !existsSync(file) || !statSync(file).isFile() || basename(file) === MUSIC_LABELS_FILE) {
      res.writeHead(400, { ...HDR_JSON });
      res.end(JSON.stringify({ ok: false, error: 'bad file' }));
      return;
    }
    // 真实删除音乐文件（「移除=删除运行态文件，list 刷新显示」）；music.json 记录随后自动重建
    unlinkSync(file);
    const id = basename(file).replace(/\.[^.]+$/, '');
    const mm = loadMusicLabels();
    // ① 依据 json 记录删封面（cover 字段指向的文件）
    const cover = mm[id]?.cover;
    if (cover) {
      const coverFile = normalize(join(dir, cover));
      if (coverFile.startsWith(dir) && existsSync(coverFile) && statSync(coverFile).isFile() && basename(coverFile) !== MUSIC_LABELS_FILE) {
        unlinkSync(coverFile);
      }
    }
    // ② 同名推断封面也删（json 未记录/未同步时——与 handleMusicList 推断对称，封面不残留）
    for (const ext of MUSIC_COVER_EXTS) {
      const p = normalize(join(dir, id + ext));
      try {
        if (p.startsWith(dir) && existsSync(p) && statSync(p).isFile() && basename(p) !== MUSIC_LABELS_FILE) unlinkSync(p);
      } catch (e) { /* 删除竞争/权限异常：忽略（下次列表同步仍不引用它） */ }
    }
    // ③ music.json 记录同步清除（下次列表也会按目录自动重建，这里即时保持一致）
    if (mm[id]) { delete mm[id]; saveMusicLabels(mm); }
    res.writeHead(200, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: true, id, cover: cover || null }));
  } catch (e) {
    res.writeHead(500, { ...HDR_JSON });
    res.end(JSON.stringify({ ok: false, error: String(e?.message ?? e) }));
  }
}
// ── 2026-09-2x 拆分 re-export：上传与日志模块独立文件，对外 API 保持不变 ──
export { handleUpload, handleMusicUpload, handleCoverUpload } from './handlers-upload.js';
export { appendWallpaperLog, readWallpaperLog, handleUploadPartDelete, handleWallpaperLog, handleWallpaperLogRead } from './handlers-log.js';
