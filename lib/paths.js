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

/** 开屏动画素材目录：theme-mediascape/boot/（运行态：boot.json + 素材，2026-09-22 起由运行态目录提供）。 */
export function bootDir() { return join(themeDir(), 'boot'); }

/** 运行态日志目录：theme-mediascape/logs/（壁纸切换等运行日志，log/pid 等运行态文件统一放运行态目录）。 */
export function logsDir() { return join(themeDir(), 'logs'); }

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

/**
 * 胶囊配方运行态路径：$DSH_HOME/theme-mediascape/capsules.json。
 * 2026-09-23 起胶囊配方读写都走运行态（外部开发操作动仓库 theme-studio/ 不影响 build 与保存）；
 * 仓库 theme-studio/capsules.json 仅作回退可读（build 读取时运行态缺失 → 从仓库复制一份初始化）。
 */
export function runtimeCapsulesPath() { return join(themeDir(), 'capsules.json'); }
