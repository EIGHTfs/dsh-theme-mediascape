/**
 * 路径推导（壁纸目录 / labels 文件 / 在线下载子目录）
 */

import { join } from 'node:path';
import os from 'node:os';

/** 用户壁纸存储目录：$DSH_HOME/theme-firefly/wallpapers/（DSH_HOME 缺失时回退 ~/.dsh）。 */
export function wallpaperDir() {
  const base = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  return join(base, 'theme-firefly', 'wallpapers');
}

export const ONLINE_DIR_NAME = 'online';

export function onlineDir() { return join(wallpaperDir(), ONLINE_DIR_NAME); }

/**
 * 用户上传壁纸的名字映射表：wallpapers/.labels.json（{ "custom-xxx": "原始文件名去掉扩展名" }）。
 * 落盘文件被重命名为 custom-*.ext，若不保存原始名，列表只能显示磁盘名（customxxx）。
 * 缓存快照归 labels.js 私有管理（读盘/写盘/刷新同模块），此处只提供路径推导。
 */
export const LABELS_FILE = '.labels.json';

export function labelsFilePath() { return join(wallpaperDir(), LABELS_FILE); }
