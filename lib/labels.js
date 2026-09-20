/**
 * labels 映射读写（hash 主键 → 展示文件名）
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { LABELS_FILE, labelsFilePath, wallpaperDir } from './paths.js';

// 模块级缓存快照（读盘后常驻，写盘后同步刷新；不跨模块导出——ESM import 绑定只读，跨模块赋值会抛错）
let labelMap = null;

/** 读取 labels 映射（懒加载 + 模块级缓存；读不到/解析失败返回空对象）。 */
export function loadLabels() {
  if (labelMap) return labelMap;
  try {
    const p = labelsFilePath();
    labelMap = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  } catch { labelMap = {}; }
  return labelMap;
}

/** 写入 labels 映射并刷新缓存（原子写：先写临时文件再 rename）。 */
export function saveLabels(map) {
  labelMap = map;
  const dir = wallpaperDir();
  mkdirSync(dir, { recursive: true });
  const tmp = join(dir, LABELS_FILE + '.tmp');
  writeFileSync(tmp, JSON.stringify(map, null, 2), 'utf8');
  renameSync(tmp, join(dir, LABELS_FILE));
}
