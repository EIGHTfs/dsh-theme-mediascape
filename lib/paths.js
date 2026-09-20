/**
 * 路径推导（壁纸目录 / labels 文件 / 在线下载子目录）
 */

import { join } from 'node:path';
import os from 'node:os';

/** 用户壁纸存储目录：$DSH_HOME/theme-mediascape/wallpapers/（DSH_HOME 缺失时回退 ~/.dsh）。 */
export function wallpaperDir() {
  const base = process.env.DSH_HOME || join(os.homedir(), '.dsh');
  return join(base, 'theme-mediascape', 'wallpapers');
}

export const ONLINE_DIR_NAME = 'online';

export function onlineDir() { return join(wallpaperDir(), ONLINE_DIR_NAME); }

/**
 * 用户上传壁纸的名字映射表：wallpapers/.labels.json（{ "custom-xxx": "原始文件名去掉扩展名" }）。
 * 历史遗留（1.0.1 内容寻址时期）：落盘文件曾是 custom-*.ext，靠 labels 存原始名。
 * 1.0.3 起落盘即原始文件名，新上传不再写 labels；此文件仅兼容读取旧数据。
 * 缓存快照归 labels.js 私有管理（读盘/写盘/刷新同模块），此处只提供路径推导。
 */
export const LABELS_FILE = '.labels.json';

export function labelsFilePath() { return join(wallpaperDir(), LABELS_FILE); }
