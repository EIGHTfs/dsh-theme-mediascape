/**
 * debug 配置读取 + 运行态日志统一写入（2026-09-22 升级：单一 enabled → theme-swatch / preview / log
 * 三个独立开关 + 任意新键自动透传 + isDebug 便捷判断；2026-09-22 统一：所有日志写入收进本模块，
 * 其他模块只调 writeLog(name, entry) 传参，开关/路径/轮转/时间戳都在这里，杜绝绕过 debug 开关的日志）。
 *
 * 配置文件：$DSH_HOME/theme-mediascape/debug.json（运行态，仓库/插件包不含此文件）
 *   结构（log 放最上面 = 总日志开关；theme-swatch / preview 各自独立）：
 *     {
 *       "log": true,          // 总日志开关：开启时壁纸切换 / 配色操作 / 预览服务 都写运行态日志
 *       "theme-swatch": true, // 配色服务开关：主题 apply 时自动拉起配色服务（theme-swatch.html + 配色 API）
 *       "preview": true       // 预览页服务开关：主题 apply 时自动拉起预览页（preview.html）
 *     }
 *   只认新键（旧 {"enabled": true} 不再生效——定稿 2026-09-22）；
 *   键缺失/非法 = false（默认关）。
 * 新增 debug 键（如 "performance": true）无需改本文件：readDebugConfig() 返回对象自动带该键
 *   （值 = cfg[key] === true），消费方用 isDebug('performance') 判断即可。
 * 日志：writeLog(name, entry) —— 受 log 总开关控制（关闭不落盘），单文件 1MB 轮转保留 3 份，
 *   每条自动附本地可读时间戳；消费方只传文件名 + 事件对象，不接触开关/路径/轮转。
 *   落点：$DSH_HOME/theme-mediascape/logs/<name>（wallpaper/theme-swatch/preview/upload/startup/api…）。
 * 消费方：build.cjs（构建自测门 + 胶囊诊断日志）、lib/index.js（apply 拉起服务 + API 日志）、
 *         lib/handlers.js（壁纸切换日志 + 日志读取门）、theme-studio/start-preview.mjs（页面级开关 + 日志）。
 */

import { existsSync, readFileSync, appendFileSync, mkdirSync, renameSync, statSync } from 'node:fs';
import { join } from 'node:path';
import os from 'node:os';
import { logsDir } from './paths.js';

/** debug.json 完整路径。 */
export function debugConfigPath() {
  return join(process.env.DSH_HOME || join(os.homedir(), '.dsh'), 'theme-mediascape', 'debug.json');
}

// 短缓存：500ms 内复用上次结果（高频 API 请求下不反复读盘；改 debug.json 后≤0.5s 生效）
let cache = { at: 0, val: null };
/**
 * 读 debug 配置：{ log, themeSwatch, preview, ...任意新键 }。
 * 任意未知键自动透传（值按 cfg[key] === true 归一为布尔），返回对象为每次读盘新建的浅拷贝，
 * 调用方改返回对象不影响缓存。
 */
export function readDebugConfig(force = false) {
  const now = Date.now();
  if (!force && cache.val && now - cache.at < 500) return { ...cache.val };
  let cfgResult;
  try {
    const cfg = JSON.parse(readFileSync(debugConfigPath(), 'utf8'));
    if (!cfg || typeof cfg !== 'object') {
      cfgResult = { log: false, themeSwatch: false, preview: false };
    } else {
      // 2026-09-22 log 对象化：log 保留原样（true=全开 | 对象 {类别:bool} = 按类开），不再归一布尔；
      //   类别键 = 日志文件名去 .log（api/wallpaper/upload/theme-swatch/startup/build-capsules）。
      //   新增日志类别只需在 debug.json 的 log 对象加键，无需改代码。
      cfgResult = { log: cfg.log === true || (cfg.log && typeof cfg.log === 'object') ? cfg.log : false,
              themeSwatch: cfg['theme-swatch'] === true, preview: cfg.preview === true };
      // 2026-09-22 自动透传未知键：以后加 debug 开关只写 debug.json，本文件无需再改
      for (const k of Object.keys(cfg)) {
        if (!(k in cfgResult)) cfgResult[k] = cfg[k] === true;
      }
    }
  } catch {
    cfgResult = { log: false, themeSwatch: false, preview: false };
  }
  cache = { at: now, val: cfgResult };
  return { ...cfgResult };
}

/**
 * 日志类别开关判断（2026-09-22 log 对象化）：
 *   - log === true         → 全开（旧布尔形态兼容）
 *   - log === {类别:bool}  → 查该类别键；缺失默认关
 *   - log === false        → 全关
 * 类别 = 日志文件名去 .log（如 'wallpaper.log' → 'wallpaper'）。
 */
export function logEnabled(category) {
  const log = readDebugConfig().log;
  if (log === true) return true;
  if (log && typeof log === 'object') return log[category] === true;
  return false;
}

/**
 * 便捷单键判断：isDebug('log') === readDebugConfig().log。
 * 未知键同样有效（自动透传键）：isDebug('performance') 读 debug.json 的 "performance": true。
 */
export function isDebug(key) {
  return readDebugConfig()[key] === true;
}

// ── 运行态日志统一写入（2026-09-22 从 log.js 收编，全部经 debug.log 总开关）──
const MAX_BYTES = 1024 * 1024; // 单文件轮转阈值：1MB
const KEEP = 3;                // 保留历史份数：.1 .2 .3

/** 本地可读时间戳：YYYY-MM-DD HH:mm:ss.SSS。 */
export function logTs(d = new Date()) {
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

function rotate(file) {
  // 滚动：.2 → .3, .1 → .2, file → .1（保留 KEEP 份）
  for (let i = KEEP - 1; i >= 1; i--) {
    const from = file + '.' + i;
    const to = file + '.' + (i + 1);
    if (existsSync(from)) renameSync(from, to);
  }
  if (existsSync(file)) renameSync(file, file + '.1');
}

/**
 * 追加一行运行态日志（唯一日志写入入口——所有模块都走这里，受 debug.json log 类别开关控制）。
 * 2026-09-22 log 对象化：按日志名类别独立开关（logEnabled(category)），不再只有总开关。
 * @param {string} name 日志文件名（如 'wallpaper.log' → 类别 'wallpaper'）
 * @param {object} entry 事件字段（会并入 { ts } 时间戳）
 */
export function writeLog(name, entry) {
  try {
    const category = String(name).replace(/\.log$/, '');
    // build-capsules 是胶囊注入诊断（核心资产定位用），log 为对象时缺省也视为开——保证永远可查
    if (!logEnabled(category) && !(category === 'build-capsules' && readDebugConfig().log !== false)) return;
    const dir = logsDir();
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const file = join(dir, name);
    // 轮转检查（写前看一眼大小，超阈值先滚）
    try {
      const sz = statSync(file).size;
      if (sz > MAX_BYTES) rotate(file);
    } catch { /* 文件不存在 → 无需轮转 */ }
    const line = JSON.stringify(Object.assign({ ts: logTs() }, entry)) + '\n';
    appendFileSync(file, line, 'utf8');
  } catch { /* 日志写失败静默，不影响业务 */ }
}

