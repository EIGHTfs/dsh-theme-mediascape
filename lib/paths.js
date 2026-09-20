/**
 * 路径推导（壁纸/音乐目录、labels 文件、在线下载子目录）
 */

import { join } from 'node:path';
import os from 'node:os';

function baseDir() {
  return process.env.DSH_HOME || join(os.homedir(), '.dsh');
}

/** 主题数据根：$DSH_HOME/theme-mediascape/（DSH_HOME 缺失时回退 ~/.dsh）。 */
export function themeDir() { return join(baseDir(), 'theme-mediascape'); }

/** 壁纸（图片+视频）存储目录：theme-mediascape/wallpaper/。 */
export function wallpaperDir() { return join(themeDir(), 'wallpaper'); }

/** 音乐存储目录：theme-mediascape/music/。 */
export function musicDir() { return join(themeDir(), 'music'); }

export const ONLINE_DIR_NAME = 'online';

/** 在线下载壁纸子目录：wallpaper/online/。 */
export function onlineDir() { return join(wallpaperDir(), ONLINE_DIR_NAME); }

/**
 * 壁纸名字映射表：wallpaper/wallpaper.json（{ "<sha40>": "显示名（去扩展名）" }）。
 * 缓存快照归 labels.js 私有管理（读盘/写盘/刷新同模块），此处只提供路径推导。
 */
export const WALLPAPER_LABELS_FILE = 'wallpaper.json';

export function wallpaperLabelsPath() { return join(wallpaperDir(), WALLPAPER_LABELS_FILE); }

/**
 * 音乐清单：music/music.json（{ "<sha40>": { "name": "音乐名.mp3", "cover": "封面.png|空" } }）。
 * 缓存快照归 labels.js 私有管理，此处只提供路径推导。
 */
export const MUSIC_LABELS_FILE = 'music.json';

export function musicLabelsPath() { return join(musicDir(), MUSIC_LABELS_FILE); }
