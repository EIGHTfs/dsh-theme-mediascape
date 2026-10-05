/**
 * 启动引导：按 lib/sources.json 的目录迁移配置，把仓库根目录「整个目录」复制一份到真实数据目录。
 *
 * 背景（2026-09-21 目录结构改造）：
 *   - 主题分发时，仓库根自带素材目录（如 music/、wallpaper/），以及在线资源清单。
 *   - 插件 apply 时，按 sources.json 里登记的目录迁移条目，把「整个目录」复制到
 *     $DSH_HOME/theme-mediascape/<dst>/（真实数据目录），而不是按文件逐个搬。
 *   - **只复制一次（幂等）**：目标目录已存在（非空）即视为「已复制过」，跳过不重复复制。
 *     目标目录「存在」由真实数据目录预置（手动建好 / 上次启动已复制）共同覆盖。
 *   - **仓库根资源保留（不删源）**：link 安装下安装目录=工作区同一份，删源会把工作区素材搬空；
 *     改为复制语义后，仓库根永远保留素材（分发的干净副本），数据目录获得一份运行副本。
 *   - **以后加目录只改 json**：在 lib/sources.json 的 dirs 里加一条 { "<src>": "<dst>" } 即可，
 *     无需改代码。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { themeDir } from './paths.js';

const DIRS_CONFIG_FILE = join(ROOT, 'lib', 'sources.json');

/**
 * 读取 sources.json 里的目录迁移映射（dirs 字段：{ "<仓库根目录名>": "<真实数据子目录名>" }）。
 * 解析失败/无 dirs → 空对象（不抛错）。
 */
function loadDirMigrations() {
  try {
    if (!existsSync(DIRS_CONFIG_FILE)) return {};
    const cfg = JSON.parse(readFileSync(DIRS_CONFIG_FILE, 'utf8'));
    const dirs = cfg?.dirs;
    if (!dirs || typeof dirs !== 'object') return {};
    const out = {};
    for (const [src, dst] of Object.entries(dirs)) {
      if (!src || typeof dst !== 'string' || !dst) continue;
      out[src] = dst;
    }
    return out;
  } catch { return {}; }
}

/**
 * 把仓库根的一个目录复制一份到真实数据目录（幂等：目标已存在非空 → 跳过）。
 * 复制语义：仓库根资源保留（不删源），数据目录获得运行副本。
 * @param {string} srcName 仓库根下的目录名（如 music / wallpaper）
 * @param {string} dstName 真实数据目录子目录名（如 music / wallpaper）
 * @returns {boolean} 是否发生了复制
 */
function copyOnce(srcName, dstName) {
  const src = join(ROOT, srcName);
  if (!existsSync(src)) return false; // 仓库根本没有 → 无需复制
  const dst = join(themeDir(), dstName);
  // 目标已存在且非空 → 已复制过（或用户预置），幂等跳过
  if (existsSync(dst)) {
    const hasContent = (() => { try { return readdirSync(dst).length > 0; } catch { return false; } })();
    if (hasContent) return false;
  }
  try {
    mkdirSync(join(dst, '..'), { recursive: true });
    copyDirInto(src, dst);
    return true;
  } catch (e) {
    console.warn(`[mediascape] 复制 ${srcName}/ → 数据目录失败（跳过，用仓库原位）: ${e?.message ?? e}`);
    return false;
  }
}

/** 复制单个文件（目标父目录自动创建；已存在则不覆盖）。 */
function copyInto(s, d) {
  if (existsSync(d)) return;
  mkdirSync(join(d, '..'), { recursive: true });
  copyFileSync(s, d);
}

/** 递归复制目录（已存在文件跳过不覆盖）。 */
function copyDirInto(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = join(src, f);
    const dstPath = join(dst, f);
    if (statSync(s).isDirectory()) copyDirInto(s, d);
    else copyInto(s, d);
  }
}

/** 插件启动时调用：按 sources.json 的 dirs 配置整目录复制到数据目录（幂等，只复制一次，仓库根保留）。 */
export function bootstrapDataDirs() {
  const dirs = loadDirMigrations();
  for (const [src, dst] of Object.entries(dirs)) {
    if (copyOnce(src, dst)) console.log(`[mediascape] 已复制仓库 ${src}/ → 数据目录 ${dst}/（仓库根保留）`);
  }
}
