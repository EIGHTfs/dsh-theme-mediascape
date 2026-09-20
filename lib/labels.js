/**
 * labels 映射读写（hash 主键 → 展示名）。
 * 壁纸：wallpaper/wallpaper.json = { "<sha40>": "显示名（去扩展名）" }
 * 音乐：music/music.json     = { "<sha40>": { "name": "音乐名.mp3", "cover": "封面.png|空" } }
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { MUSIC_LABELS_FILE, WALLPAPER_LABELS_FILE, musicDir, musicLabelsPath, wallpaperDir, wallpaperLabelsPath } from './paths.js';

// 模块级缓存快照（读盘后常驻，写盘后同步刷新；不跨模块导出——ESM import 绑定只读，跨模块赋值会抛错）
const labelCache = new Map(); // 路径 → 解析后的 map

function readMap(p) {
  if (labelCache.has(p)) return labelCache.get(p);
  let m = {};
  try { m = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {}; } catch { m = {}; }
  labelCache.set(p, m);
  return m;
}

function writeMap(p, map) {
  labelCache.set(p, map);
  const dir = join(p, '..');
  mkdirSync(dir, { recursive: true });
  const tmp = p + '.tmp';
  writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  renameSync(tmp, p);
}

/** 读取壁纸 labels（wallpaper/wallpaper.json）。 */
export function loadWallpaperLabels() { return readMap(wallpaperLabelsPath()); }

/** 写入壁纸 labels 并刷新缓存（原子写）。 */
export function saveWallpaperLabels(map) { writeMap(wallpaperLabelsPath(), map); }

/** 读取音乐清单（music/music.json）。 */
export function loadMusicLabels() { return readMap(musicLabelsPath()); }

/** 写入音乐清单并刷新缓存（原子写）。 */
export function saveMusicLabels(map) { writeMap(musicLabelsPath(), map); }

// ── 兼容别名：旧调用方（handlers/online）用 loadLabels/saveLabels 指壁纸 ──
export function loadLabels() { return loadWallpaperLabels(); }
export function saveLabels(map) { return saveWallpaperLabels(map); }
