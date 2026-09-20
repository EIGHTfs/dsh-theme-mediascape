/**
 * 启动引导：按 lib/sources.json 的目录迁移配置，把仓库根目录「整个目录」一次性迁移到真实数据目录。
 *
 * 背景（2026-09-21 目录结构改造）：
 *   - 主题分发时，仓库根自带素材目录（如 music/、wallpaper/），以及在线资源清单。
 *   - 插件 apply 时，按 sources.json 里登记的目录迁移条目，把「整个目录」移动到
 *     $DSH_HOME/theme-mediascape/<dst>/（真实数据目录），而不是按文件逐个搬。
 *   - **只能移动一次（幂等）**：目标目录已存在（非空）即视为「已搬过」，跳过不重复搬。
 *     目标目录「存在」由真实数据目录预置（用户手动建好 / 上次启动已搬）共同覆盖。
 *   - **以后加目录只改 json**：在 lib/sources.json 的 dirs 里加一条 { "<src>": "<dst>" } 即可，
 *     无需改代码。
 */

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs';
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
 * 迁移仓库根的一个目录到真实数据目录（幂等：目标已存在非空 → 跳过）。
 * 同卷用 rename（秒级原子）；跨设备（EXDEV）降级为递归复制 + 删源（仍是一次性迁移语义）。
 * @param {string} srcName 仓库根下的目录名（如 music / wallpaper）
 * @param {string} dstName 真实数据目录子目录名（如 music / wallpaper）
 * @returns {boolean} 是否发生了移动
 */
function migrateOnce(srcName, dstName) {
  const src = join(ROOT, srcName);
  if (!existsSync(src)) return false; // 仓库根本没有 → 无需搬
  const dst = join(themeDir(), dstName);
  // 目标已存在且非空 → 已搬过（或用户预置），幂等跳过
  if (existsSync(dst)) {
    const hasContent = (() => { try { return readdirSync(dst).length > 0; } catch { return false; } })();
    if (hasContent) return false;
  }
  try {
    mkdirSync(join(dst, '..'), { recursive: true });
    // 目标同名目录已存在但为空 → 直接搬文件进去（不整目录嵌套）
    if (existsSync(dst)) {
      for (const f of readdirSync(src)) {
        const s = join(src, f);
        const d = join(dst, f);
        if (existsSync(d)) continue; // 已存在文件跳过不覆盖
        try { renameSync(s, d); }
        catch (e) { if (e?.code === 'EXDEV') { copyInto(s, d); rmSync(s, { recursive: true, force: true }); } else throw e; }
      }
      return true;
    }
    // 目标不存在 → 整目录 rename（同卷秒级，不落盘拷贝）；跨设备降级复制+删源
    try {
      renameSync(src, dst);
    } catch (e) {
      if (e?.code === 'EXDEV') {
        copyDirInto(src, dst);
        rmSync(src, { recursive: true, force: true });
      } else throw e;
    }
    return true;
  } catch (e) {
    console.warn(`[mediascape] 迁移 ${srcName}/ 失败（跳过，用仓库原位）: ${e?.message ?? e}`);
    return false;
  }
}

/** 复制单个文件（目标父目录自动创建）。 */
function copyInto(s, d) {
  mkdirSync(join(d, '..'), { recursive: true });
  copyFileSync(s, d);
}

/** 递归复制目录。 */
function copyDirInto(src, dst) {
  mkdirSync(dst, { recursive: true });
  for (const f of readdirSync(src)) {
    const s = join(src, f);
    const d = join(dst, f);
    if (statSync(s).isDirectory()) copyDirInto(s, d);
    else copyInto(s, d);
  }
}

/** 插件启动时调用：按 sources.json 的 dirs 配置整目录迁移（幂等，只搬一次）。 */
export function bootstrapDataDirs() {
  const dirs = loadDirMigrations();
  for (const [src, dst] of Object.entries(dirs)) {
    if (migrateOnce(src, dst)) console.log(`[mediascape] 已迁移仓库 ${src}/ → ${dst}/`);
  }
}
