/**
 * 运行态日志统一写入（re-export 兼容层，2026-09-22 收编：实现已并入 lib/debug.js）。
 *
 * 历史：原本文件承载 writeLog/logTs/轮转实现；2026-09-22 实现整体迁至 lib/debug.js
 * （开关/路径/轮转/时间戳都在那里，杜绝绕过 debug 开关的日志）。本文件保留仅作
 * 向后兼容 re-export——旧调用方 import { writeLog } from './log.js' 无需改动，实际逻辑走 debug.js。
 */

export { writeLog, logTs } from './debug.js';
